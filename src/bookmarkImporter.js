/**
 * 浏览器书签目录树导入器：保留目录结构、无截断分页、已存在去重、按目录建分组/桌面文件夹
 */
import { state, commit, getActiveGroup } from './store.js';
import { uid } from './presets.js';
import { normalizeUrl, isExtensionContext } from './iconEngine.js';
import { closeModal, toast, escapeHtml } from './modals.js';

function collectExistingUrlSet() {
  const urls = new Set();
  for (const g of state.groups || []) {
    for (const it of g.items || []) {
      if (it?.type === 'site' && it.url) urls.add(normalizeUrl(it.url) || it.url);
      if (it?.type === 'folder') {
        for (const c of it.children || []) {
          if (c?.url) urls.add(normalizeUrl(c.url) || c.url);
        }
      }
    }
  }
  return urls;
}

export function renderBookmarksImporter(container) {
  if (!isExtensionContext() || !chrome.bookmarks) {
    container.innerHTML = `
      <div style="padding:20px;text-align:center;color:var(--text-2);font-size:13.5px;line-height:1.7;">
        当前处于普通网页预览模式。<br/>
        将本文件夹加载为浏览器扩展后，即可读取完整书签目录并一键导入，自动抓取并本地缓存所有图标。
      </div>`;
    return;
  }

  container.innerHTML = `<div style="color:var(--text-2);font-size:13px;">正在读取书签目录树…</div>`;
  chrome.bookmarks.getTree((tree) => {
    const existingUrls = collectExistingUrlSet();
    const flat = [];
    const walk = (nodes, pathParts = []) => {
      for (const n of nodes || []) {
        if (n.url && /^https?:\/\//i.test(n.url)) {
          const safeUrl = normalizeUrl(n.url) || n.url;
          const folderName = pathParts[pathParts.length - 1] || '根目录';
          flat.push({
            id: n.id || `${flat.length}`,
            title: n.title || n.url,
            url: safeUrl,
            folderName,
            folderPath: pathParts.join(' / ') || '根目录',
            exists: existingUrls.has(safeUrl)
          });
        } else if (n.children) {
          const title = (n.title || '').trim();
          const nextPath = title && n.parentId !== '0' ? [...pathParts, title] : (title && n.id !== '0' ? [title] : pathParts);
          walk(n.children, nextPath);
        }
      }
    };
    walk(tree);

    if (!flat.length) {
      container.innerHTML = `<div style="color:var(--text-2);font-size:13px;">未找到可导入的网页书签。</div>`;
      return;
    }

    container.innerHTML = `
      <div class="field-row" style="margin-bottom:6px;">
        <input id="bm-filter" class="input" placeholder="筛选书签或目录（共 ${flat.length} 条）…" />
        <button type="button" class="btn sm" id="bm-select-all" style="flex:none;">全选当前</button>
        <button type="button" class="btn sm" id="bm-clear-sel" style="flex:none;">清空</button>
      </div>
      <div class="bm-opts-bar">
        <label><input type="checkbox" id="bm-skip-dup" checked /> 自动跳过已存在网址</label>
        <select id="bm-mode" class="bm-mode-select">
          <option value="flat">平铺导入当前分组</option>
          <option value="folder">子目录转为桌面文件夹</option>
          <option value="group">按目录新建独立分组</option>
        </select>
      </div>
      <div class="bm-list" id="bm-list"></div>
      <div class="bm-foot-bar">
        <span id="bm-sel-stat">已选 0 项</span>
        <button type="button" class="btn primary sm" id="bm-import-btn">导入所选书签</button>
      </div>`;

    const listEl = container.querySelector('#bm-list');
    const statEl = container.querySelector('#bm-sel-stat');
    const skipDupEl = container.querySelector('#bm-skip-dup');
    const filterEl = container.querySelector('#bm-filter');
    const selected = new Set();
    const collapsedDirs = new Set();
    let pageLimit = 100;

    const getFiltered = () => {
      const low = filterEl.value.trim().toLowerCase();
      const skipDup = skipDupEl.checked;
      return flat.filter((b) => {
        if (skipDup && b.exists) return false;
        if (!low) return true;
        return (
          b.title.toLowerCase().includes(low) ||
          b.url.toLowerCase().includes(low) ||
          b.folderPath.toLowerCase().includes(low)
        );
      });
    };

    const updateStat = () => {
      statEl.textContent = `已选 ${selected.size} 项`;
    };

    const draw = () => {
      const filtered = getFiltered();
      const visible = filtered.slice(0, pageLimit);
      listEl.innerHTML = '';

      if (!visible.length) {
        listEl.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-3);font-size:13px;">没有匹配的未导入书签</div>`;
        updateStat();
        return;
      }

      const byDir = new Map();
      for (const b of visible) {
        if (!byDir.has(b.folderPath)) byDir.set(b.folderPath, []);
        byDir.get(b.folderPath).push(b);
      }

      for (const [dirPath, items] of byDir.entries()) {
        const isCollapsed = collapsedDirs.has(dirPath);
        const dirBar = document.createElement('div');
        dirBar.className = 'bm-dir-head';
        const allChecked = items.every((x) => selected.has(x.id));
        dirBar.innerHTML = `
          <label class="bm-dir-check"><input type="checkbox" ${allChecked ? 'checked' : ''} /><span>📁 ${escapeHtml(dirPath)}</span></label>
          <button type="button" class="bm-dir-toggle">${isCollapsed ? `展开 (${items.length})` : `收起 (${items.length})`}</button>`;
        dirBar.querySelector('input').addEventListener('change', (e) => {
          for (const x of items) {
            if (e.target.checked) selected.add(x.id);
            else selected.delete(x.id);
          }
          draw();
        });
        dirBar.querySelector('.bm-dir-toggle').addEventListener('click', () => {
          if (isCollapsed) collapsedDirs.delete(dirPath);
          else collapsedDirs.add(dirPath);
          draw();
        });
        listEl.appendChild(dirBar);

        if (isCollapsed) continue;
        for (const b of items) {
          const row = document.createElement('label');
          row.className = `bm-item${b.exists ? ' is-exists' : ''}`;
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = selected.has(b.id);
          cb.addEventListener('change', () => {
            if (cb.checked) selected.add(b.id);
            else selected.delete(b.id);
            updateStat();
          });
          const sp = document.createElement('span');
          sp.textContent = b.title;
          const sm = document.createElement('small');
          sm.textContent = b.exists ? '已存在' : b.url.replace(/^https?:\/\//, '');
          row.append(cb, sp, sm);
          listEl.appendChild(row);
        }
      }

      if (filtered.length > visible.length) {
        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'btn sm bm-load-more';
        moreBtn.textContent = `加载更多（剩余 ${filtered.length - visible.length} 条）`;
        moreBtn.addEventListener('click', () => {
          pageLimit += 100;
          draw();
        });
        listEl.appendChild(moreBtn);
      }
      updateStat();
    };
    draw();

    filterEl.addEventListener('input', () => { pageLimit = 100; draw(); });
    skipDupEl.addEventListener('change', () => { pageLimit = 100; draw(); });
    container.querySelector('#bm-select-all').addEventListener('click', () => {
      for (const b of getFiltered()) selected.add(b.id);
      draw();
    });
    container.querySelector('#bm-clear-sel').addEventListener('click', () => {
      selected.clear();
      draw();
    });

    container.querySelector('#bm-import-btn').addEventListener('click', () => {
      const chosen = flat.filter((b) => selected.has(b.id));
      if (!chosen.length) {
        toast('请至少勾选一个书签');
        return;
      }
      const mode = container.querySelector('#bm-mode').value;
      const toSite = (b) => ({ id: uid('s'), type: 'site', title: b.title, url: b.url, iconMode: 'auto' });

      if (mode === 'flat') {
        const group = getActiveGroup();
        chosen.forEach((b) => group.items.push(toSite(b)));
        commit('grid');
      } else {
        const grouped = new Map();
        for (const b of chosen) {
          const key = b.folderName || '导入书签';
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key).push(b);
        }
        if (mode === 'folder') {
          const group = getActiveGroup();
          for (const [name, list] of grouped.entries()) {
            if (list.length >= 2) {
              group.items.push({ id: uid('f'), type: 'folder', title: name.slice(0, 14), children: list.map(toSite) });
            } else {
              group.items.push(toSite(list[0]));
            }
          }
          commit('grid');
        } else {
          for (const [name, list] of grouped.entries()) {
            const g = { id: uid('g'), name: name.slice(0, 10), icon: 'folder', items: list.map(toSite) };
            state.groups.push(g);
            state.activeGroupId = g.id;
          }
          commit('all');
        }
      }
      closeModal();
      toast(`已导入 ${chosen.length} 个书签，正在后台静默缓存图标`);
    });
  });
}
