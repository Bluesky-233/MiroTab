/**
 * MiroTab 主入口：启动缓存预热、时钟、壁纸、主题、侧边栏、快捷键与事件绑定
 */
import { state, subscribe, commit, removeItem, getResetEpoch } from './store.js';
import { GRADIENT_WALLPAPERS, GROUP_ICONS } from './presets.js';
import { getAllCachedIcons, getCustomWallpaper, setCustomWallpaper, pruneOldBingWallpapers } from './db.js';
import { hydrateIconCache, isExtensionContext, normalizeUrl } from './iconEngine.js';
import { hasBingWallpaperPermission } from './permissions.js';
import { getLunarString } from './lunar.js';
import { initSearch, focusSearchInput } from './search.js';
import {
  renderGrid,
  getDraggingId,
  clearDraggingId,
  openBlankMenu,
  setGridTransitionDir,
  applyWheelPull,
  resetWheelPull
} from './grid.js';
import { openAddHubModal, openGroupModal, openSiteModal, closeModal, toast } from './modals.js';
import { openSettingsDrawer } from './settingsDrawer.js';
import { showContextMenu } from './contextMenu.js';

const mediaDark = window.matchMedia('(prefers-color-scheme: dark)');
let lastRawWallpaperLum = null;
let draggingGroupId = null;
let wallpaperEpoch = 0;
const VALID_CLOCK_STYLES = new Set(['modern', 'miro', 'bold', 'serif', 'flip', 'neon']);

function applyAdaptiveWpTone() {
  const cfg = state.settings.wallpaper || { type: 'gradient', id: 'miro-prism' };
  if (cfg.type === 'gradient') {
    const isLightPreset = cfg.id === 'miro-atelier' || cfg.id === 'dawn' || cfg.id === 'mist';
    document.documentElement.dataset.wpTone = isLightPreset ? 'light' : 'dark';
    return;
  }
  if (typeof lastRawWallpaperLum === 'number') {
    const dim = (state.settings.wallpaperDim || 0) / 100;
    const effective = lastRawWallpaperLum * (1 - dim);
    document.documentElement.dataset.wpTone = effective > 170 ? 'light' : 'dark';
  }
}

function sampleWallpaperTone(src) {
  if (typeof src !== 'string' || !/^data:image\//i.test(src)) {
    lastRawWallpaperLum = null;
    document.documentElement.dataset.wpTone = 'dark';
    return;
  }
  const img = new Image();
  img.onload = () => {
    try {
      const w = 24;
      const h = 14;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      let lumSum = 0;
      const pixels = w * h;
      for (let i = 0; i < data.length; i += 4) {
        lumSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      lastRawWallpaperLum = lumSum / pixels;
      applyAdaptiveWpTone();
    } catch {}
  };
  img.src = src;
}

function applySettings() {
  const s = state.settings;
  const root = document.documentElement;
  const theme = s.theme === 'auto' ? (mediaDark.matches ? 'dark' : 'light') : s.theme;
  root.dataset.theme = theme;
  root.style.setProperty('--icon', `${s.iconSize}px`);
  root.style.setProperty('--radius', `${s.iconRadius}%`);
  root.style.setProperty('--gap', `${s.iconGap}px`);
  root.style.setProperty('--grid-max', `${s.gridMaxWidth}px`);
  root.style.setProperty('--clock-size', `${s.clockSize || 96}px`);
  root.style.setProperty('--clock-weight', String(s.clockWeight || 400));

  document.body.classList.toggle('minimal', !!s.minimal);
  document.body.classList.toggle('hide-labels', !s.showLabels);
  document.body.classList.toggle('sidebar-autohide', !!s.sidebarAutoHide);
  if (!s.sidebarAutoHide) document.body.classList.remove('sidebar-peek');

  const collapseBtn = document.getElementById('btn-sidebar-collapse');
  if (collapseBtn) {
    collapseBtn.title = s.sidebarAutoHide ? '固定展开侧边栏' : '折叠隐藏侧边栏';
  }

  const wp = document.getElementById('wallpaper');
  const mask = document.getElementById('wallpaper-mask');
  if (wp) wp.style.filter = s.wallpaperBlur > 0 ? `blur(${s.wallpaperBlur}px) scale(1.06)` : 'none';
  if (mask) mask.style.opacity = String((s.wallpaperDim || 0) / 100);
  applyAdaptiveWpTone();

  updateClock();
}

function isSafeWallpaperSrc(src) {
  if (typeof src !== 'string') return false;
  const s = src.trim();
  if (!s || /["'()\r\n\\]/.test(s)) return false;
  if (/^data:image\//i.test(s)) return true;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && (u.hostname === 'cn.bing.com' || u.hostname === 'www.bing.com');
  } catch {
    return false;
  }
}

async function applyWallpaper() {
  const wp = document.getElementById('wallpaper');
  if (!wp) return;
  const myWpEpoch = ++wallpaperEpoch;
  const myResetEpoch = getResetEpoch();
  const isStaleTask = () => myWpEpoch !== wallpaperEpoch || myResetEpoch !== getResetEpoch();

  const cfg = state.settings.wallpaper || { type: 'gradient', id: 'miro-prism' };
  lastRawWallpaperLum = null;
  applyAdaptiveWpTone();

  if (cfg.type === 'custom') {
    const dataUrl = await getCustomWallpaper();
    if (isStaleTask()) return;
    if (dataUrl && isSafeWallpaperSrc(dataUrl)) {
      wp.style.background = `url("${dataUrl}") center / cover no-repeat`;
      sampleWallpaperTone(dataUrl);
      return;
    }
  }

  if (cfg.type === 'bing') {
    const idx = Math.max(0, Math.min(7, Number(cfg.bingIdx) || 0));
    const dayKey = new Date().toISOString().slice(0, 10);
    const cacheKey = `bing-${dayKey}-${idx}`;

    // 1. 先检查当天本地 IndexedDB 缓存（0ms 瞬开）
    const cachedDataUrl = await getCustomWallpaper(cacheKey);
    if (isStaleTask()) return;
    if (cachedDataUrl && isSafeWallpaperSrc(cachedDataUrl)) {
      wp.style.background = `url("${cachedDataUrl}") center / cover no-repeat`;
      sampleWallpaperTone(cachedDataUrl);
      return;
    }

    // 未命中前先保留一个深邃渐变底色避免白屏/黑屏
    const fallbackCss = GRADIENT_WALLPAPERS[0].css;
    if (!wp.style.background) wp.style.background = fallbackCss;

    // 2. 扩展环境：检查已授予的必应主机权限后调用后台拉取并缓存到本地
    if (isExtensionContext()) {
      const granted = await hasBingWallpaperPermission();
      if (isStaleTask()) return;
      if (!granted) {
        wp.style.background = fallbackCss;
        return;
      }
      const resp = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: 'FETCH_BING_WALLPAPER', idx }, (r) => {
            if (chrome.runtime.lastError || !r) resolve({ ok: false });
            else resolve(r);
          });
        } catch {
          resolve({ ok: false });
        }
      });
      if (isStaleTask()) return;
      if (resp?.ok && (resp.dataUrl || resp.imageUrl)) {
        const finalSrc = resp.dataUrl || resp.imageUrl;
        if (isSafeWallpaperSrc(finalSrc)) {
          wp.style.background = `url("${finalSrc}") center / cover no-repeat`;
          sampleWallpaperTone(finalSrc);
          if (resp.dataUrl && !isStaleTask()) {
            await setCustomWallpaper(resp.dataUrl, cacheKey);
            if (!isStaleTask()) {
              pruneOldBingWallpapers(10).catch(() => {});
            }
          }
          return;
        }
      }
      toast('必应壁纸暂时拉取失败，请检查网络后重试');
      return;
    }

    // 3. 非扩展预览模式：不请求未披露的第三方接口，保留内置渐变底色
    wp.style.background = fallbackCss;
    toast('网页预览模式暂不直连必应接口，加载为浏览器扩展后即可按需授权拉取必应壁纸');
    return;
  }

  const preset = GRADIENT_WALLPAPERS.find((w) => w.id === cfg.id) || GRADIENT_WALLPAPERS[0];
  wp.style.background = preset.css;
}

function updateClock() {
  const clockEl = document.getElementById('clock');
  const dateEl = document.getElementById('date-line');
  if (!clockEl || !dateEl) return;

  const now = new Date();
  const s = state.settings;
  let h = now.getHours();
  let ampm = '';
  if (!s.clock24) {
    ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
  }
  const hh = String(h).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const style = VALID_CLOCK_STYLES.has(s.clockStyle) ? s.clockStyle : 'modern';

  clockEl.className = `clock-style-${style}`;
  clockEl.setAttribute('aria-label', `${hh}:${mm}${s.showSeconds ? `:${ss}` : ''}${ampm ? ` ${ampm}` : ''}`);
  const miroColon = '<span class="clk-colon" aria-hidden="true"><i class="clk-dot clk-dot-red"></i><i class="clk-dot clk-dot-gold"></i></span>';

  if (style === 'flip') {
    clockEl.innerHTML = `
      <span class="flip-card">${hh}</span>
      <span class="clk-colon flip-colon" aria-hidden="true"><i class="clk-dot clk-dot-red"></i><i class="clk-dot clk-dot-gold"></i></span>
      <span class="flip-card">${mm}</span>
      ${s.showSeconds ? `<span class="clk-colon flip-colon" aria-hidden="true"><i class="clk-dot clk-dot-red"></i><i class="clk-dot clk-dot-gold"></i></span><span class="flip-card flip-sec">${ss}</span>` : ''}
      ${ampm ? `<span class="ampm">${ampm}</span>` : ''}`;
  } else if (style === 'miro') {
    clockEl.innerHTML = `
      <span class="clk-miro-glyph clk-miro-star" aria-hidden="true">✦</span>
      <span class="clk-num">${hh}</span>${miroColon}<span class="clk-num">${mm}</span>
      ${s.showSeconds ? `<span class="sec">${ss}</span>` : ''}
      ${ampm ? `<span class="ampm">${ampm}</span>` : ''}
      <span class="clk-miro-glyph clk-miro-orb" aria-hidden="true"></span>`;
  } else {
    clockEl.innerHTML = `${hh}${miroColon}${mm}${s.showSeconds ? `<span class="sec">:${ss}</span>` : ''}${ampm ? `<span class="ampm">${ampm}</span>` : ''}`;
  }

  const wk = ['日', '一', '二', '三', '四', '五', '六'];
  const datePart = `${now.getMonth() + 1}月${now.getDate()}日 星期${wk[now.getDay()]}`;
  dateEl.innerHTML = `<span class="date-star" aria-hidden="true">✦</span><span>${datePart}</span>${s.showLunar ? `<span class="date-dot" aria-hidden="true"></span><span>${getLunarString(now)}</span>` : ''}`;
}

function switchGroup(targetId, direction = 0) {
  if (!targetId || targetId === state.activeGroupId) return;
  const curIdx = state.groups.findIndex((g) => g.id === state.activeGroupId);
  const nextIdx = state.groups.findIndex((g) => g.id === targetId);
  if (nextIdx < 0) return;

  const dir = direction !== 0 ? direction : (nextIdx > curIdx ? 1 : -1);
  resetWheelPull(true);
  const wrap = document.getElementById('grid-wrap');
  if (wrap) wrap.scrollTop = 0;
  setGridTransitionDir(dir);
  state.activeGroupId = targetId;
  commit('all');
}

function collectGroupUrls(group) {
  const urls = [];
  const seen = new Set();
  const pushUrl = (raw) => {
    const safe = normalizeUrl(raw);
    if (!safe || seen.has(safe)) return;
    seen.add(safe);
    urls.push(safe);
  };
  for (const it of group?.items || []) {
    if (it?.type === 'site') pushUrl(it.url);
    else if (it?.type === 'folder') {
      for (const c of it.children || []) pushUrl(c?.url);
    }
  }
  return urls;
}

function openAllGroupUrls(group) {
  const urls = collectGroupUrls(group);
  if (!urls.length) {
    toast('该分组暂无可打开的网址');
    return;
  }
  if (urls.length > 8 && !confirm(`确定同时打开「${group.name}」内的 ${urls.length} 个网页吗？`)) {
    return;
  }
  if (isExtensionContext() && chrome.tabs?.create) {
    urls.forEach((url) => chrome.tabs.create({ url, active: false }));
  } else {
    urls.forEach((url) => window.open(url, '_blank', 'noopener,noreferrer'));
  }
  toast(`已后台打开 ${urls.length} 个网页`);
}

function renderSidebar() {
  const nav = document.getElementById('group-list');
  if (!nav) return;
  nav.innerHTML = '';

  const activeGroup = state.groups.find((g) => g.id === state.activeGroupId) || state.groups[0];
  const toggleLabel = document.getElementById('sb-toggle-label');
  if (toggleLabel && activeGroup) toggleLabel.textContent = activeGroup.name;

  const clearGroupDropMarks = () => {
    nav.querySelectorAll('.sb-group').forEach((el) => {
      el.classList.remove('drop-target', 'group-drop-before', 'group-drop-after');
    });
  };

  for (const g of state.groups) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `sb-group${g.id === state.activeGroupId ? ' active' : ''}`;
    btn.title = g.name;
    btn.draggable = true;
    const path = GROUP_ICONS[g.icon] || GROUP_ICONS.home;
    btn.innerHTML = `<svg viewBox="0 0 24 24">${path}</svg>`;
    const nameSpan = document.createElement('span');
    nameSpan.textContent = g.name ?? '';
    btn.appendChild(nameSpan);

    btn.addEventListener('click', () => {
      switchGroup(g.id);
    });

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const menu = [
        { label: '一键打开组内全部网址', onClick: () => openAllGroupUrls(g) },
        { label: '编辑分组', onClick: () => openGroupModal(g) }
      ];
      if (state.groups.length > 1) {
        menu.push({ sep: true });
        menu.push({
          label: '删除分组',
          danger: true,
          onClick: () => {
            if (!confirm(`确定删除分组「${g.name}」及其中的所有图标吗？`)) return;
            state.groups = state.groups.filter((x) => x.id !== g.id);
            if (state.activeGroupId === g.id) state.activeGroupId = state.groups[0].id;
            commit('all');
          }
        });
      }
      showContextMenu(e.clientX, e.clientY, menu);
    });

    btn.addEventListener('dragstart', (e) => {
      if (getDraggingId()) return;
      draggingGroupId = g.id;
      btn.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `group:${g.id}`);
    });

    btn.addEventListener('dragend', () => {
      draggingGroupId = null;
      btn.classList.remove('dragging');
      clearGroupDropMarks();
    });

    // 支持把桌面图标拖到左侧分组上跨组移动，或拖拽分组按钮重新排序
    btn.addEventListener('dragover', (e) => {
      if (getDraggingId() && g.id !== state.activeGroupId) {
        e.preventDefault();
        btn.classList.add('drop-target');
        return;
      }
      if (draggingGroupId && draggingGroupId !== g.id) {
        e.preventDefault();
        clearGroupDropMarks();
        const r = btn.getBoundingClientRect();
        const isBefore = e.clientY < r.top + r.height / 2;
        btn.classList.add(isBefore ? 'group-drop-before' : 'group-drop-after');
      }
    });
    btn.addEventListener('dragleave', () => {
      btn.classList.remove('drop-target', 'group-drop-before', 'group-drop-after');
    });
    btn.addEventListener('drop', (e) => {
      e.preventDefault();
      const wasBefore = btn.classList.contains('group-drop-before');
      clearGroupDropMarks();

      const itemId = getDraggingId();
      if (itemId && g.id !== state.activeGroupId) {
        const moved = removeItem(itemId);
        if (moved) {
          delete moved.col;
          delete moved.row;
          g.items.push(moved);
          clearDraggingId();
          commit('grid');
          toast(`已移至「${g.name}」`);
        }
        return;
      }

      if (draggingGroupId && draggingGroupId !== g.id) {
        const fromIdx = state.groups.findIndex((x) => x.id === draggingGroupId);
        const toIdx = state.groups.findIndex((x) => x.id === g.id);
        if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
          const [movedGroup] = state.groups.splice(fromIdx, 1);
          const adjustedIdx = state.groups.findIndex((x) => x.id === g.id);
          const insertAt = wasBefore ? adjustedIdx : adjustedIdx + 1;
          state.groups.splice(insertAt, 0, movedGroup);
          draggingGroupId = null;
          commit('sidebar');
        }
      }
    });

    nav.appendChild(btn);
  }
}

function hasOverlayOpen() {
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot && modalRoot.childElementCount > 0) return true;
  return !!document.querySelector('.pop-menu:not(.hidden)');
}

function initMirrorSheen() {
  let activeEl = null;
  let rafId = 0;
  let pendingX = 0;
  let pendingY = 0;
  let pendingTarget = null;

  const clearActive = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    pendingTarget = null;
    if (activeEl) {
      activeEl.removeAttribute('data-sheen-active');
      activeEl = null;
    }
  };

  document.addEventListener('pointermove', (e) => {
    if (document.body.classList.contains('is-dragging') || hasOverlayOpen()) {
      clearActive();
      return;
    }
    const surface = e.target?.closest?.('.search-box, #grid .widget-card');
    if (!surface) {
      clearActive();
      return;
    }
    pendingTarget = surface;
    pendingX = e.clientX;
    pendingY = e.clientY;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (document.body.classList.contains('is-dragging') || hasOverlayOpen()) {
        clearActive();
        return;
      }
      const target = pendingTarget;
      if (!target || !target.isConnected) return;
      if (activeEl && activeEl !== target) activeEl.removeAttribute('data-sheen-active');
      activeEl = target;
      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      target.style.setProperty('--mx', `${(pendingX - rect.left).toFixed(1)}px`);
      target.style.setProperty('--my', `${(pendingY - rect.top).toFixed(1)}px`);
      target.setAttribute('data-sheen-active', '1');
    });
  }, { passive: true });

  document.addEventListener('click', () => {
    queueMicrotask(() => {
      if (hasOverlayOpen()) clearActive();
    });
  }, true);
  document.addEventListener('focusin', () => {
    if (hasOverlayOpen()) clearActive();
  });
  document.addEventListener('pointerleave', clearActive);
  window.addEventListener('blur', clearActive);
}

function bindEvents() {
  initMirrorSheen();
  const openSettings = () => openSettingsDrawer(applyWallpaper);

  document.getElementById('clock').addEventListener('click', () => {
    state.settings.minimal = !state.settings.minimal;
    commit('settings');
  });
  document.getElementById('btn-add-group').addEventListener('click', () => openGroupModal(null));
  document.getElementById('btn-add-item').addEventListener('click', () => openAddHubModal());
  document.getElementById('btn-settings').addEventListener('click', openSettings);

  const fabAdd = document.getElementById('btn-fab-add');
  fabAdd?.addEventListener('click', () => openSiteModal(null));
  fabAdd?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openAddHubModal();
  });

  // 窗口尺寸变化时自动重算自由网格列数
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderGrid(), 120);
  });

  // 左上角悬浮按钮：点击展开侧边栏（临时展开；再点侧边栏内按钮可固定或收起）
  const sidebarEl = document.getElementById('sidebar');
  const toggleFab = document.getElementById('btn-sidebar-toggle');
  const collapseBtn = document.getElementById('btn-sidebar-collapse');

  toggleFab?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.body.classList.add('sidebar-peek');
  });

  collapseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    // 已固定 -> 折叠隐藏；处于自动折叠预览 -> 固定常驻
    state.settings.sidebarAutoHide = !state.settings.sidebarAutoHide;
    document.body.classList.remove('sidebar-peek');
    commit('settings');
  });

  // 折叠状态下点击主区域空白处收起临时展开的侧边栏
  document.addEventListener('click', (e) => {
    if (!state.settings.sidebarAutoHide) return;
    if (e.target.closest('#sidebar, #btn-sidebar-toggle')) return;
    document.body.classList.remove('sidebar-peek');
  });

  // 鼠标移出侧边栏区域后自动收起
  sidebarEl?.addEventListener('mouseleave', () => {
    if (state.settings.sidebarAutoHide) {
      document.body.classList.remove('sidebar-peek');
    }
  });

  document.getElementById('main').addEventListener('contextmenu', (e) => {
    if (e.target.closest('.cell, #search, #sidebar, .pop-menu')) return;
    e.preventDefault();
    openBlankMenu(e, openSettings);
  });

  // 滚轮阻尼切换分组（累积阈值 + 弹性拉扯 + 惯性尾波抑制）
  const WHEEL_THRESHOLD = 460;
  const SWITCH_COOLDOWN_MS = 820;
  let wheelAccum = 0;
  let wheelLockUntil = 0;
  let lastWheelAt = 0;
  let lastStepAbs = 0;
  let wheelIdleTimer = null;

  const canInnerScroll = (el, dy) => {
    if (!el || el.scrollHeight <= el.clientHeight + 2) return false;
    return dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  };

  document.getElementById('main').addEventListener('wheel', (e) => {
    if (!state.settings.wheelSwitchGroup || state.settings.minimal || state.groups.length <= 1) return;
    if (document.getElementById('modal-root').childElementCount > 0) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (e.target.closest('#sidebar, .pop-menu')) return;

    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 40;
    else if (e.deltaMode === 2) dy *= 240;
    if (Math.abs(dy) < 2) return;

    const innerScrollEl = e.target.closest('.w-todo-list, .w-notes-area');
    if (innerScrollEl && canInnerScroll(innerScrollEl, dy)) return;

    const wrap = document.getElementById('grid-wrap');
    const scrollable = wrap && wrap.scrollHeight > wrap.clientHeight + 8;
    if (scrollable && e.target.closest('#grid-wrap')) {
      const atTop = wrap.scrollTop <= 1 && dy < 0;
      const atBottom = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 2 && dy > 0;
      if (!atTop && !atBottom) {
        wheelAccum = 0;
        return;
      }
    }

    e.preventDefault();

    const step = Math.max(-100, Math.min(100, dy));
    const stepAbs = Math.abs(step);
    const now = Date.now();

    if (now < wheelLockUntil) {
      if (now - lastWheelAt < 110 && stepAbs <= lastStepAbs + 8 && stepAbs < 85) {
        wheelLockUntil = Math.max(wheelLockUntil, now + 180);
      }
      lastWheelAt = now;
      lastStepAbs = stepAbs;
      return;
    }

    lastWheelAt = now;
    lastStepAbs = stepAbs;

    if (wheelAccum !== 0 && Math.sign(step) !== Math.sign(wheelAccum)) {
      wheelAccum *= 0.35;
    }
    wheelAccum += step;

    clearTimeout(wheelIdleTimer);

    const idx = state.groups.findIndex((g) => g.id === state.activeGroupId);
    const len = state.groups.length;

    if (Math.abs(wheelAccum) >= WHEEL_THRESHOLD) {
      const dir = wheelAccum > 0 ? 1 : -1;
      wheelAccum = 0;
      wheelLockUntil = now + SWITCH_COOLDOWN_MS;
      const nextGroup = state.groups[(idx + dir + len) % len];
      if (nextGroup) switchGroup(nextGroup.id, dir);
      return;
    }

    const prevGroup = state.groups[(idx - 1 + len) % len];
    applyWheelPull(wheelAccum / WHEEL_THRESHOLD, prevGroup?.name || '');

    wheelIdleTimer = setTimeout(() => {
      wheelAccum = 0;
      resetWheelPull(false);
    }, 420);
  }, { passive: false });

  // 鼠标或拖拽图标靠左边缘自动唤出隐藏的侧边栏
  document.addEventListener('mousemove', (e) => {
    if (!state.settings.sidebarAutoHide || hasOverlayOpen()) return;
    if (e.clientX <= 12) {
      document.body.classList.add('sidebar-peek');
    } else if (e.clientX > 88 && !e.target.closest?.('#sidebar')) {
      document.body.classList.remove('sidebar-peek');
    }
  });

  document.addEventListener('dragover', (e) => {
    if (!state.settings.sidebarAutoHide || !getDraggingId()) return;
    if (e.clientX <= 36) {
      document.body.classList.add('sidebar-peek');
    }
  });

  // 全局键盘流：/ 或 Ctrl+K 聚焦搜索、Alt+1~9 切分组、Esc 依次关闭弹窗与退出极简模式
  document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    const modalRoot = document.getElementById('modal-root');
    const hasModal = modalRoot && modalRoot.childElementCount > 0;

    if (e.key === 'Escape') {
      if (hasModal) {
        e.preventDefault();
        closeModal();
        return;
      }
      if (state.settings.minimal) {
        state.settings.minimal = false;
        commit('settings');
      }
      return;
    }

    if (hasModal) return;

    const el = document.activeElement;
    const isInput = el && (
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable
    );

    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      focusSearchInput();
      return;
    }

    if (!isInput && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === '/') {
      e.preventDefault();
      focusSearchInput();
      return;
    }

    if (!isInput && e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key) && !state.settings.minimal) {
      const targetGroup = state.groups[Number(e.key) - 1];
      if (targetGroup) {
        e.preventDefault();
        switchGroup(targetGroup.id);
      }
    }
  });

  mediaDark.addEventListener('change', () => {
    if (state.settings.theme === 'auto') applySettings();
  });
}

async function boot() {
  // 1. 立即应用主题、壁纸、时钟、搜索栏，确保首屏无白屏闪烁
  applySettings();
  applyWallpaper();
  initSearch();
  bindEvents();
  setInterval(updateClock, 1000);

  // 2. 毫秒级预热 IndexedDB 本地永久图标缓存后再渲染网格 -> 0 网络延迟瞬间呈现所有缓存图标
  const cached = await getAllCachedIcons();
  await hydrateIconCache(cached);

  renderSidebar();
  renderGrid();

  subscribe((scope) => {
    if (scope === 'silent') return;
    if (scope === 'settings' || scope === 'all') applySettings();
    if (scope === 'sidebar' || scope === 'all') renderSidebar();
    if (scope === 'grid' || scope === 'settings' || scope === 'all') renderGrid();
  });
}

boot();
