/**
 * 弹窗模块：图标工作室（新增/编辑网址）、添加面板（小组件/书签导入）、分组编辑、文件夹弹层、小组件配置
 */
import { state, commit, getActiveGroup, findItem, removeItem } from './store.js';
import { uid, BADGE_PALETTE, GROUP_ICONS, WIDGET_TYPES } from './presets.js';
import {
  normalizeUrl,
  computeSmartBadge,
  probeAllSiteIcons,
  compressUploadedImage,
  downloadRemoteIconToDataUrl,
  resolveIconSync,
  resolveIconAsync,
  isExtensionContext
} from './iconEngine.js';
import { searchCityCoords, fetchWeather } from './widgets.js';
import { normalizeCountdownData } from './widgetHelpers.js';
import { renderBookmarksImporter } from './bookmarkImporter.js';

const root = () => document.getElementById('modal-root');

function sanitizeCssBg(val, fallback = '#3b82f6') {
  if (typeof val !== 'string') return fallback;
  const s = val.trim();
  if (!s || /[;<>"'\\\r\n]/.test(s) || /url\s*\(/i.test(s) || /expression\s*\(/i.test(s)) {
    return fallback;
  }
  return s;
}

function isSafeImgSrc(src) {
  if (typeof src !== 'string') return false;
  const s = src.trim();
  if (!s) return false;
  if (/^data:image\//i.test(s)) return true;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function closeModal() {
  root().innerHTML = '';
}

export function toast(msg) {
  const host = document.getElementById('toast-root');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

export function createModal({ title, wide = false, cardClass = '', bodyHtml = '', footHtml = '' }) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card${wide ? ' wide' : ''} ${cardClass}">
      <div class="modal-head">
        <h3>${title}</h3>
        <button class="modal-close" aria-label="关闭">
          <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}
    </div>`;

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });
  backdrop.querySelector('.modal-close').addEventListener('click', closeModal);
  root().appendChild(backdrop);
  return backdrop;
}

/**
 * 打开「添加 / 编辑网址 + 图标工作室」弹窗
 */
export function openSiteModal(existingItem = null, targetList = null) {
  const isEdit = !!existingItem;
  const draft = existingItem
    ? { ...existingItem }
    : {
        id: uid('s'),
        type: 'site',
        title: '',
        url: '',
        iconMode: 'auto', // auto | custom | badge
        customIcon: '',
        fullBleed: false,
        badgeText: '',
        badgeGradient: BADGE_PALETTE[0]
      };

  const modal = createModal({
    title: isEdit ? '编辑网址与图标' : '添加自定义网址',
    bodyHtml: `
      <div class="studio-preview">
        <div id="st-preview" class="studio-icon-big"></div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:15px;" id="st-prev-title">${escapeHtml(draft.title || '新网址')}</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" id="st-prev-url">${escapeHtml(draft.url || '输入网址后可自动抓取网页高清图标')}</div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button type="button" class="btn sm primary" id="st-probe-btn">深度抓取网页图标</button>
            <label class="btn sm" style="cursor:pointer;">
              上传本地图片
              <input type="file" id="st-upload" accept="image/*" hidden />
            </label>
          </div>
        </div>
      </div>

      <div class="field">
        <label>网址 URL</label>
        <input id="st-url" class="input" placeholder="例如 https://github.com 或 http://192.168.1.1:8080" value="${escapeHtml(draft.url)}" />
      </div>

      <div class="field">
        <label>名称</label>
        <input id="st-title" class="input" placeholder="网站显示名称" value="${escapeHtml(draft.title)}" />
      </div>

      <div class="field">
        <label>图标样式</label>
        <div class="tabs" id="st-mode-tabs">
          <button type="button" class="tab" data-mode="auto">自动抓取</button>
          <button type="button" class="tab" data-mode="custom">自定义图片</button>
          <button type="button" class="tab" data-mode="badge">渐变文字徽章</button>
        </div>
      </div>

      <div id="st-pane-auto" class="field">
        <label id="st-cand-tip">点击上方「深度抓取网页图标」可同时探测网页高清图 / Apple 图标 / Edge 缓存供挑选</label>
        <div id="st-candidates" class="studio-candidates"></div>
      </div>

      <div id="st-pane-custom" class="field hidden">
        <label>自定义图片 URL 或本地上传（保存后自动缓存到本地，秒开不走代理）</label>
        <div class="field-row">
          <input id="st-img-url" class="input" placeholder="粘贴图片直链 https://..." value="${draft.customIcon && !draft.customIcon.startsWith('data:') ? escapeHtml(draft.customIcon) : ''}" />
          <button type="button" class="btn sm" id="st-fetch-img">缓存到本地</button>
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:4px;cursor:pointer;">
          <input type="checkbox" id="st-fullbleed" ${draft.fullBleed ? 'checked' : ''} />
          <span>图片铺满整个图标圆角（适合方形封面/头像）</span>
        </label>
      </div>

      <div id="st-pane-badge" class="field hidden">
        <label>文字 / Emoji（1-4 个字符，留空则智能提取名称首字）</label>
        <input id="st-badge-text" class="input" maxlength="4" placeholder="如 NAS / AI / 博客 / 🚀" value="${escapeHtml(draft.badgeText || '')}" />
        <label style="margin-top:6px;">背景渐变 / 纯色</label>
        <div id="st-palette" class="palette"></div>
      </div>
    `,
    footHtml: `
      <button type="button" class="btn" id="st-cancel">取消</button>
      <button type="button" class="btn primary" id="st-save">保存</button>
    `
  });

  const urlInput = modal.querySelector('#st-url');
  const titleInput = modal.querySelector('#st-title');
  const previewBox = modal.querySelector('#st-preview');
  const prevTitle = modal.querySelector('#st-prev-title');
  const prevUrl = modal.querySelector('#st-prev-url');
  const candWrap = modal.querySelector('#st-candidates');
  const candTip = modal.querySelector('#st-cand-tip');
  const badgeTextInput = modal.querySelector('#st-badge-text');
  const paletteEl = modal.querySelector('#st-palette');
  const imgUrlInput = modal.querySelector('#st-img-url');
  const fullBleedCb = modal.querySelector('#st-fullbleed');

  // 渲染调色板
  const drawPalette = () => {
    paletteEl.innerHTML = '';
    for (const bg of BADGE_PALETTE) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = `swatch${draft.badgeGradient === bg ? ' active' : ''}`;
      sw.style.background = bg;
      sw.addEventListener('click', () => {
        draft.badgeGradient = bg;
        draft.iconMode = 'badge';
        syncTabs();
        drawPalette();
        updatePreview();
      });
      paletteEl.appendChild(sw);
    }
  };

  const syncTabs = () => {
    modal.querySelectorAll('#st-mode-tabs .tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === draft.iconMode);
    });
    modal.querySelector('#st-pane-auto').classList.toggle('hidden', draft.iconMode !== 'auto');
    modal.querySelector('#st-pane-custom').classList.toggle('hidden', draft.iconMode !== 'custom');
    modal.querySelector('#st-pane-badge').classList.toggle('hidden', draft.iconMode !== 'badge');
  };

  const updatePreview = () => {
    prevTitle.textContent = draft.title || '新网址';
    prevUrl.textContent = draft.url || '输入网址后可自动抓取网页高清图标';
    previewBox.className = 'studio-icon-big';
    previewBox.innerHTML = '';

    if (draft.iconMode === 'custom' && draft.customIcon) {
      if (isSafeImgSrc(draft.customIcon)) {
        const img = document.createElement('img');
        img.referrerPolicy = 'no-referrer';
        if (draft.fullBleed) img.className = 'full-bleed';
        else img.onload = () => detectDarkGlyph(img, previewBox);
        img.src = draft.customIcon;
        previewBox.appendChild(img);
        return;
      }
    }

    const res = resolveIconSync(draft);
    if (res.type === 'img' && res.src && isSafeImgSrc(res.src)) {
      const img = document.createElement('img');
      img.referrerPolicy = 'no-referrer';
      if (draft.fullBleed) img.className = 'full-bleed';
      else img.onload = () => detectDarkGlyph(img, previewBox);
      img.src = res.src;
      previewBox.appendChild(img);
    } else {
      const b = draft.iconMode === 'badge'
        ? {
            text: draft.badgeText || computeSmartBadge(draft.title, draft.url).text,
            gradient: draft.badgeGradient || computeSmartBadge(draft.title, draft.url).gradient
          }
        : computeSmartBadge(draft.title, draft.url);
      previewBox.classList.add('is-badge');
      const badgeEl = document.createElement('div');
      badgeEl.className = 'tile-badge';
      badgeEl.style.background = sanitizeCssBg(b.gradient);
      badgeEl.textContent = b.text;
      previewBox.appendChild(badgeEl);
    }
  };

  modal.querySelectorAll('#st-mode-tabs .tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      draft.iconMode = btn.dataset.mode;
      syncTabs();
      updatePreview();
    });
  });

  urlInput.addEventListener('input', () => {
    draft.url = urlInput.value.trim();
    updatePreview();
  });
  titleInput.addEventListener('input', () => {
    draft.title = titleInput.value.trim();
    updatePreview();
  });
  badgeTextInput.addEventListener('input', () => {
    draft.badgeText = badgeTextInput.value.trim();
    updatePreview();
  });
  fullBleedCb.addEventListener('change', () => {
    draft.fullBleed = fullBleedCb.checked;
    updatePreview();
  });

  // 深度抓取候选图标
  const runProbe = async () => {
    const raw = urlInput.value.trim();
    if (!raw) {
      toast('请先输入网址');
      urlInput.focus();
      return;
    }
    const probeBtn = modal.querySelector('#st-probe-btn');
    probeBtn.disabled = true;
    probeBtn.textContent = '抓取中…';
    candTip.textContent = '正在直连目标网页并检测 Edge 本地缓存…';
    candWrap.innerHTML = '';

    const { candidates, title } = await probeAllSiteIcons(raw);
    probeBtn.disabled = false;
    probeBtn.textContent = '重新抓取';

    if (title && !titleInput.value.trim()) {
      titleInput.value = title.slice(0, 28);
      draft.title = titleInput.value;
      updatePreview();
    }

    const safeCandidates = candidates.filter((c) => isSafeImgSrc(c.dataUrl));
    if (!safeCandidates.length) {
      candTip.textContent = isExtensionContext()
        ? '未探测到网页图标，建议使用「渐变文字徽章」或「上传本地图片」'
        : '本地预览受跨域限制；加载为 Edge 扩展后即可直连抓取任意内网/外网高清图标';
      return;
    }

    candTip.textContent = `共探测到 ${safeCandidates.length} 个可用图标，点击即可选用并永久缓存到本地：`;
    safeCandidates.forEach((c, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cand-btn${idx === 0 ? ' active' : ''}`;
      const thumb = document.createElement('div');
      thumb.className = 'cand-thumb';
      const img = document.createElement('img');
      img.referrerPolicy = 'no-referrer';
      img.src = c.dataUrl;
      img.alt = '';
      thumb.appendChild(img);
      const labelSpan = document.createElement('span');
      labelSpan.textContent = c.label || '';
      btn.append(thumb, labelSpan);
      btn.addEventListener('click', () => {
        candWrap.querySelectorAll('.cand-btn').forEach((x) => x.classList.remove('active'));
        btn.classList.add('active');
        draft.iconMode = 'custom';
        draft.customIcon = c.dataUrl;
        syncTabs();
        updatePreview();
        toast('已选用该高清图标');
      });
      candWrap.appendChild(btn);
    });

    // 默认选中第一个高清图
    if (safeCandidates[0]?.dataUrl) {
      draft.iconMode = 'custom';
      draft.customIcon = safeCandidates[0].dataUrl;
      updatePreview();
    }
  };

  modal.querySelector('#st-probe-btn').addEventListener('click', runProbe);

  // 本地上传图片
  modal.querySelector('#st-upload').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await compressUploadedImage(file, 192);
    if (!dataUrl) {
      toast('无法解析该图片文件');
      return;
    }
    draft.iconMode = 'custom';
    draft.customIcon = dataUrl;
    syncTabs();
    updatePreview();
    toast('本地图片已加载并压缩缓存');
  });

  // 缓存外部图片 URL 到本地
  modal.querySelector('#st-fetch-img').addEventListener('click', async () => {
    const u = imgUrlInput.value.trim();
    if (!u) return;
    const dataUrl = await downloadRemoteIconToDataUrl(u);
    if (!dataUrl) {
      toast('下载图片失败，请检查链接');
      return;
    }
    draft.iconMode = 'custom';
    draft.customIcon = dataUrl;
    updatePreview();
    toast('图片已转为本地缓存');
  });

  modal.querySelector('#st-cancel').addEventListener('click', closeModal);
  const saveBtn = modal.querySelector('#st-save');
  saveBtn.addEventListener('click', async () => {
    const url = normalizeUrl(urlInput.value);
    if (!url) {
      toast('请输入有效的网址');
      urlInput.focus();
      return;
    }
    draft.url = url;
    draft.title = titleInput.value.trim() || new URL(url).hostname.replace(/^www\./, '');
    if (draft.iconMode === 'custom' && !draft.customIcon && imgUrlInput.value.trim()) {
      draft.customIcon = imgUrlInput.value.trim();
    }
    if (draft.iconMode === 'custom' && /^https?:\/\//i.test(draft.customIcon) && isExtensionContext()) {
      saveBtn.disabled = true;
      saveBtn.textContent = '缓存图标中…';
      try {
        const cachedDataUrl = await downloadRemoteIconToDataUrl(draft.customIcon);
        if (cachedDataUrl && /^data:image\//i.test(cachedDataUrl)) {
          draft.customIcon = cachedDataUrl;
        }
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';
      }
    }

    if (isEdit) {
      Object.assign(existingItem, draft);
    } else {
      const list = targetList || getActiveGroup().items;
      list.push(draft);
    }
    commit('grid');
    closeModal();
    toast(isEdit ? '已更新图标' : '已添加到当前分组');
  });

  drawPalette();
  syncTabs();
  updatePreview();
  if (!isEdit) urlInput.focus();
}

/**
 * 添加中心面板（自定义网址 / 添加小组件 / 一键导入 Edge 书签）
 */
export function openAddHubModal() {
  const modal = createModal({
    title: '添加到当前分组',
    wide: true,
    bodyHtml: `
      <div class="tabs" id="hub-tabs">
        <button type="button" class="tab active" data-tab="widget">添加小组件</button>
        <button type="button" class="tab" data-tab="site">自定义网址</button>
        <button type="button" class="tab" data-tab="bookmarks">导入 Edge 书签</button>
      </div>
      <div id="hub-content"></div>
    `
  });

  const content = modal.querySelector('#hub-content');

  const showTab = (tab) => {
    modal.querySelectorAll('#hub-tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));

    if (tab === 'site') {
      openSiteModal(null);
      return;
    }

    if (tab === 'widget') {
      content.innerHTML = `<div class="pick-grid">${WIDGET_TYPES.map((w) => `
        <button type="button" class="pick-card" data-w="${w.id}" data-sz="${w.sizes[0]}">
          <b>${w.name}</b>
          <small>${w.desc}</small>
        </button>`).join('')}</div>`;
      content.querySelectorAll('.pick-card').forEach((btn) => {
        btn.addEventListener('click', () => {
          getActiveGroup().items.push({
            id: uid('w'),
            type: 'widget',
            widget: btn.dataset.w,
            size: btn.dataset.sz
          });
          commit('grid');
          closeModal();
          toast('小组件已添加');
        });
      });
      return;
    }

    if (tab === 'bookmarks') {
      renderBookmarksImporter(content);
    }
  };

  modal.querySelectorAll('#hub-tabs .tab').forEach((b) => {
    b.addEventListener('click', () => showTab(b.dataset.tab));
  });
  showTab('widget');
}

/**
 * 分组新建/编辑弹窗
 */
export function openGroupModal(existingGroup = null) {
  const isEdit = !!existingGroup;
  let chosenIcon = existingGroup?.icon || 'star';
  const modal = createModal({
    title: isEdit ? '编辑分组' : '新建分组',
    bodyHtml: `
      <div class="field">
        <label>分组名称</label>
        <input id="gp-name" class="input" maxlength="10" placeholder="如 影音 / 工作 / 内网" value="${escapeHtml(existingGroup?.name || '')}" />
      </div>
      <div class="field">
        <label>分组图标</label>
        <div class="icon-picker" id="gp-icons"></div>
      </div>
    `,
    footHtml: `
      <button type="button" class="btn" id="gp-cancel">取消</button>
      <button type="button" class="btn primary" id="gp-save">确定</button>
    `
  });

  const picker = modal.querySelector('#gp-icons');
  const drawIcons = () => {
    picker.innerHTML = '';
    for (const [key, path] of Object.entries(GROUP_ICONS)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `icon-opt${chosenIcon === key ? ' active' : ''}`;
      btn.innerHTML = `<svg viewBox="0 0 24 24">${path}</svg>`;
      btn.addEventListener('click', () => {
        chosenIcon = key;
        drawIcons();
      });
      picker.appendChild(btn);
    }
  };
  drawIcons();

  const nameInput = modal.querySelector('#gp-name');
  nameInput.focus();
  modal.querySelector('#gp-cancel').addEventListener('click', closeModal);
  modal.querySelector('#gp-save').addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { toast('请输入分组名称'); return; }
    if (isEdit) {
      existingGroup.name = name;
      existingGroup.icon = chosenIcon;
    } else {
      const g = { id: uid('g'), name, icon: chosenIcon, items: [] };
      state.groups.push(g);
      state.activeGroupId = g.id;
    }
    commit('all');
    closeModal();
  });
}

/**
 * 文件夹展开弹层
 */
export function openFolderModal(folder, onSiteContextMenu) {
  const modal = createModal({
    title: `<input id="fl-name" class="folder-title-input" value="${escapeHtml(folder.title || '文件夹')}" />`,
    cardClass: 'folder-modal-card',
    bodyHtml: `<div class="folder-grid" id="fl-grid"></div>`,
    footHtml: `
      <button type="button" class="btn sm" id="fl-add">+ 添加网址到文件夹</button>
      <button type="button" class="btn sm" id="fl-ungroup">解散文件夹</button>
    `
  });

  const nameInput = modal.querySelector('#fl-name');
  nameInput.addEventListener('change', () => {
    folder.title = nameInput.value.trim() || '文件夹';
    commit('grid');
  });

  const gridEl = modal.querySelector('#fl-grid');
  let dragChildId = null;

  const draw = () => {
    gridEl.innerHTML = '';
    for (const child of folder.children) {
      const a = document.createElement('a');
      a.className = 'tile';
      a.draggable = true;
      const safeHref = normalizeUrl(child.url);
      a.href = safeHref || '#';
      a.rel = 'noopener noreferrer';
      a.referrerPolicy = 'no-referrer';
      if (!safeHref) {
        a.addEventListener('click', (e) => e.preventDefault());
      }
      if (state.settings.openInNewTab && safeHref) {
        a.target = '_blank';
      }
      const box = document.createElement('div');
      box.className = 'tile-box';
      paintTileBox(box, child);
      const label = document.createElement('div');
      label.className = 'tile-label';
      label.textContent = child.title;
      a.append(box, label);

      a.addEventListener('dragstart', (e) => {
        dragChildId = child.id;
        a.classList.add('is-fl-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', child.id);
      });
      a.addEventListener('dragend', () => {
        dragChildId = null;
        gridEl.querySelectorAll('.is-fl-dragging, .is-fl-over').forEach((el) => {
          el.classList.remove('is-fl-dragging', 'is-fl-over');
        });
      });
      a.addEventListener('dragover', (e) => {
        if (!dragChildId || dragChildId === child.id) return;
        e.preventDefault();
        gridEl.querySelectorAll('.is-fl-over').forEach((el) => el.classList.remove('is-fl-over'));
        a.classList.add('is-fl-over');
      });
      a.addEventListener('drop', (e) => {
        e.preventDefault();
        a.classList.remove('is-fl-over');
        if (!dragChildId || dragChildId === child.id) return;
        const fromIdx = folder.children.findIndex((x) => x.id === dragChildId);
        const toIdx = folder.children.findIndex((x) => x.id === child.id);
        if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
          const [moved] = folder.children.splice(fromIdx, 1);
          folder.children.splice(toIdx, 0, moved);
          dragChildId = null;
          commit('grid');
          draw();
        }
      });

      a.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onSiteContextMenu?.(e, child, () => {
          if (!findItem(folder.id)) closeModal();
          else draw();
        });
      });
      gridEl.appendChild(a);
    }
  };
  draw();

  modal.querySelector('#fl-add').addEventListener('click', () => {
    openSiteModal(null, folder.children);
  });
  modal.querySelector('#fl-ungroup').addEventListener('click', () => {
    const loc = findItem(folder.id);
    if (loc) {
      loc.list.splice(loc.index, 1, ...folder.children);
      commit('grid');
    }
    closeModal();
    toast('文件夹已解散');
  });
}

function detectDarkGlyph(img, box) {
  if (!img || !box || img.classList.contains('full-bleed')) return;
  try {
    const size = 24;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    let transparent = 0;
    let opaque = 0;
    let lumSum = 0;
    let chromaSum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 24) {
        transparent++;
      } else {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        opaque++;
        lumSum += 0.299 * r + 0.587 * g + 0.114 * b;
        chromaSum += Math.max(r, g, b) - Math.min(r, g, b);
      }
    }
    const total = size * size;
    if (opaque > 8 && transparent / total > 0.18 && lumSum / opaque < 68 && chromaSum / opaque < 36) {
      box.classList.add('is-dark-glyph');
    } else {
      box.classList.remove('is-dark-glyph');
    }
  } catch {
    // 跨域图片无法读取像素时保持原样
  }
}

/**
 * 渲染图标盒子并异步补全未缓存的真实图标
 */
export function paintTileBox(box, item) {
  const res = resolveIconSync(item);
  box.classList.remove('is-badge', 'is-dark-glyph');
  box.innerHTML = '';

  const showBadge = () => {
    const b = res.type === 'badge'
      ? res
      : computeSmartBadge(item.title, item.url);
    box.classList.remove('is-dark-glyph');
    box.classList.add('is-badge');
    box.innerHTML = '';
    const badgeEl = document.createElement('div');
    badgeEl.className = 'tile-badge';
    badgeEl.style.background = sanitizeCssBg(b.gradient);
    badgeEl.textContent = b.text;
    box.appendChild(badgeEl);
  };

  const probeRemoteImg = (remoteSrc) => {
    // 外链先在后台离屏解码，成功才替换徽章，杜绝白方块与代理卡顿闪烁
    const probe = new Image();
    probe.referrerPolicy = 'no-referrer';
    let settled = false;
    const timer = setTimeout(() => { settled = true; }, 4000);
    probe.onload = () => {
      if (settled || !box.isConnected) return;
      settled = true;
      clearTimeout(timer);
      if (probe.naturalWidth < 16 || probe.naturalHeight < 16) return;
      box.classList.remove('is-badge', 'is-dark-glyph');
      box.innerHTML = '';
      probe.alt = '';
      if (item.fullBleed) probe.className = 'full-bleed';
      else detectDarkGlyph(probe, box);
      box.appendChild(probe);
    };
    probe.onerror = () => {
      settled = true;
      clearTimeout(timer);
    };
    probe.src = remoteSrc;
  };

  const applyImg = (src) => {
    if (!src || !isSafeImgSrc(src)) return;
    // data: URL 已在本地内存中，0ms 直接渲染
    if (/^data:image\//i.test(src)) {
      box.classList.remove('is-badge', 'is-dark-glyph');
      box.innerHTML = '';
      const img = document.createElement('img');
      img.alt = '';
      if (item.fullBleed) img.className = 'full-bleed';
      else img.onload = () => detectDarkGlyph(img, box);
      img.onerror = showBadge;
      img.src = src;
      box.appendChild(img);
      if (img.complete && !item.fullBleed) detectDarkGlyph(img, box);
      return;
    }
    // 扩展环境下优先后台下载并转为本地 DataURL，避免每次打开新标签页重复请求外部服务器
    if (/^https?:\/\//i.test(src) && isExtensionContext()) {
      downloadRemoteIconToDataUrl(src).then((dataUrl) => {
        if (dataUrl && /^data:image\//i.test(dataUrl)) {
          if (item.iconMode === 'custom') {
            item.customIcon = dataUrl;
            commit('silent');
          }
          if (box.isConnected) applyImg(dataUrl);
          return;
        }
        if (box.isConnected) probeRemoteImg(src);
      });
      return;
    }
    probeRemoteImg(src);
  };

  // 先瞬时渲染本地图标或高颜值渐变徽章，确保 0 白块
  if (res.type === 'img' && res.src && isSafeImgSrc(res.src)) {
    if (!/^data:image\//i.test(res.src)) showBadge();
    applyImg(res.src);
  } else {
    showBadge();
  }

  if (res.needsFetch) {
    resolveIconAsync(item).then((dataUrl) => {
      if (dataUrl && box.isConnected) applyImg(dataUrl);
    });
  }
}

/**
 * 倒数日编辑弹窗（支持多事件管理、重复周期与常用模板）
 */
export function openCountdownModal(item, rawData) {
  const data = normalizeCountdownData(rawData);
  const draftEvents = data.events.map((ev) => ({ ...ev }));
  let activeId = data.activeEventId || draftEvents[0]?.id;

  const modal = createModal({
    title: '管理倒数日',
    bodyHtml: `
      <div class="field">
        <label>快速模板（点击添加）</label>
        <div class="cd-tpl-row">
          <button type="button" class="btn sm" data-tpl="payday">发薪日（每月10日）</button>
          <button type="button" class="btn sm" data-tpl="newyear">元旦（每年1月1日）</button>
          <button type="button" class="btn sm" data-tpl="anniv">周年纪念（每年今日）</button>
        </div>
      </div>
      <div id="cd-events-list" class="cd-events-list"></div>
      <button type="button" class="btn sm" id="cd-add-btn">+ 新增倒数日事件</button>
    `,
    footHtml: `
      <button type="button" class="btn" id="cd-cancel">取消</button>
      <button type="button" class="btn primary" id="cd-save">保存</button>
    `
  });

  const listEl = modal.querySelector('#cd-events-list');

  const drawEvents = () => {
    listEl.innerHTML = '';
    draftEvents.forEach((ev) => {
      const row = document.createElement('div');
      row.className = `cd-ev-row${ev.id === activeId ? ' is-active' : ''}`;
      row.innerHTML = `
        <input type="radio" name="cd-active" ${ev.id === activeId ? 'checked' : ''} title="设为主卡片" />
        <input type="text" class="input cd-ev-title" maxlength="20" placeholder="事件名称" value="${escapeHtml(ev.title)}" />
        <input type="date" class="input cd-ev-date" value="${escapeHtml(ev.date)}" />
        <select class="input cd-ev-repeat">
          <option value="none"${ev.repeat === 'none' ? ' selected' : ''}>单次</option>
          <option value="yearly"${ev.repeat === 'yearly' ? ' selected' : ''}>每年</option>
          <option value="monthly"${ev.repeat === 'monthly' ? ' selected' : ''}>每月</option>
        </select>
        ${draftEvents.length > 1 ? '<button type="button" class="btn sm danger cd-ev-del" title="删除">×</button>' : ''}`;

      row.querySelector('input[type="radio"]').addEventListener('change', () => { activeId = ev.id; drawEvents(); });
      row.querySelector('.cd-ev-title').addEventListener('input', (e) => { ev.title = e.target.value; });
      row.querySelector('.cd-ev-date').addEventListener('change', (e) => { ev.date = e.target.value; });
      row.querySelector('.cd-ev-repeat').addEventListener('change', (e) => { ev.repeat = e.target.value; });
      row.querySelector('.cd-ev-del')?.addEventListener('click', () => {
        const idx = draftEvents.findIndex((x) => x.id === ev.id);
        if (idx >= 0) draftEvents.splice(idx, 1);
        if (activeId === ev.id) activeId = draftEvents[0]?.id;
        drawEvents();
      });
      listEl.appendChild(row);
    });
  };
  drawEvents();

  const addEvent = (title, date, repeat = 'none') => {
    if (draftEvents.length >= 6) {
      toast('最多保留 6 个倒数日事件');
      return;
    }
    const ev = { id: uid('ev'), title, date, repeat };
    draftEvents.push(ev);
    activeId = ev.id;
    drawEvents();
  };

  modal.querySelectorAll('[data-tpl]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      if (btn.dataset.tpl === 'payday') addEvent('发薪日', `${now.getFullYear()}-${pad(now.getMonth() + 1)}-10`, 'monthly');
      else if (btn.dataset.tpl === 'newyear') addEvent('元旦', `${now.getFullYear() + 1}-01-01`, 'yearly');
      else addEvent('纪念日', todayStr, 'yearly');
    });
  });

  modal.querySelector('#cd-add-btn').addEventListener('click', () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    addEvent('新目标', `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, 'none');
  });

  modal.querySelector('#cd-cancel').addEventListener('click', closeModal);
  modal.querySelector('#cd-save').addEventListener('click', () => {
    data.events = draftEvents.map((ev) => ({
      id: ev.id,
      title: (ev.title || '').trim() || '目标日',
      date: ev.date || new Date().toISOString().slice(0, 10),
      repeat: ev.repeat || 'none'
    }));
    data.activeEventId = data.events.some((ev) => ev.id === activeId) ? activeId : data.events[0].id;
    commit('grid');
    closeModal();
  });
}

/**
 * 天气城市编辑弹窗
 */
export function openWeatherModal(item, data) {
  const modal = createModal({
    title: '设置天气城市',
    bodyHtml: `
      <div class="field">
        <label>搜索城市名称（支持中文/拼音）</label>
        <div class="field-row">
          <input id="wt-q" class="input" placeholder="如 上海 / 深圳 / 杭州" value="${escapeHtml(data.city || '')}" />
          <button type="button" class="btn primary sm" id="wt-search" style="flex:none;">搜索</button>
        </div>
      </div>
      <div id="wt-results" class="bm-list"></div>
    `
  });

  const resEl = modal.querySelector('#wt-results');
  const doSearch = async () => {
    const q = modal.querySelector('#wt-q').value.trim();
    if (!q) return;
    resEl.innerHTML = `<div style="font-size:13px;color:var(--text-2);">查询中…</div>`;
    try {
      const list = await searchCityCoords(q);
      if (!list.length) {
        resEl.innerHTML = `<div style="font-size:13px;color:var(--text-2);">未找到匹配城市</div>`;
        return;
      }
      resEl.innerHTML = '';
      for (const c of list) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bm-item';
        btn.style.cursor = 'pointer';
        btn.innerHTML = `<span>${escapeHtml(c.name)}</span><small>${escapeHtml([c.admin1, c.country].filter(Boolean).join(' · '))}</small>`;
        btn.addEventListener('click', async () => {
          data.city = c.name;
          data.lat = c.latitude;
          data.lon = c.longitude;
          const w = await fetchWeather(c.latitude, c.longitude);
          if (w) data.cache = { ...w, at: Date.now() };
          commit('grid');
          closeModal();
          toast(`天气已切换为 ${c.name}`);
        });
        resEl.appendChild(btn);
      }
    } catch {
      resEl.innerHTML = `<div style="font-size:13px;color:#ff5d6c;">查询失败，请检查网络连接</div>`;
    }
  };
  modal.querySelector('#wt-search').addEventListener('click', doSearch);
  modal.querySelector('#wt-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
}

export function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
