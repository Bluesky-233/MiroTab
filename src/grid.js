/**
 * 桌面自由定位网格：自由拖拽至任意格子、落点预览、互换/避让、合并文件夹、右键菜单
 */
import { state, commit, getActiveGroup, findItem, removeItem } from './store.js';
import { uid, WIDGET_TYPES } from './presets.js';
import { normalizeUrl, resolveIconAsync } from './iconEngine.js';
import { renderWidget } from './widgets.js';
import { showContextMenu } from './contextMenu.js';
import {
  getItemSpan,
  computeGridCols,
  resolveGroupLayout,
  placeItemAt,
  tidyGroupLayout
} from './gridLayout.js';
import {
  openSiteModal,
  openAddHubModal,
  openFolderModal,
  openCountdownModal,
  openWeatherModal,
  paintTileBox,
  toast
} from './modals.js';

let dragId = null;
let dragOffset = { col: 0, row: 0 };
let currentCols = 10;
let gridEventsBound = false;
let ghostEl = null;
let pendingTransitionDir = 0;
let nextPeekKey = '';
let clearPeekTimer = null;
let widgetCleanups = [];

export function setGridTransitionDir(dir) {
  pendingTransitionDir = dir;
}

export function getDraggingId() {
  return dragId;
}

export function clearDraggingId() {
  dragId = null;
  document.body.classList.remove('is-dragging');
  hideGhost();
}

function clearNextGroupPeek() {
  clearTimeout(clearPeekTimer);
  clearPeekTimer = null;
  nextPeekKey = '';

  const peek = document.getElementById('grid-next-peek');
  const preview = document.getElementById('grid-next-preview');
  if (peek) {
    peek.classList.remove('peek-active');
    peek.classList.add('hidden');
    peek.style.removeProperty('--peek-opacity');
    peek.style.removeProperty('--peek-blur');
    peek.style.removeProperty('--peek-y');
    peek.style.removeProperty('--peek-scale');
    peek.style.removeProperty('--peek-head-opacity');
  }
  if (preview) preview.innerHTML = '';
}

export function applyWheelPull(progress, prevGroupName = '') {
  const stage = document.getElementById('grid-stage');
  const grid = document.getElementById('grid');
  const peek = document.getElementById('grid-next-peek');
  const hint = document.getElementById('grid-prev-hint');
  if (!stage || !grid) return;

  const clamped = Math.max(-1, Math.min(1, progress));
  const absP = Math.abs(clamped);
  const eased = Math.pow(absP, 0.9);
  const dir = Math.sign(clamped);

  stage.classList.remove('wheel-instant');
  stage.classList.add('wheel-pulling');
  grid.style.transform = `translateY(${(-dir * eased * 34).toFixed(1)}px)`;
  grid.style.opacity = (1 - eased * 0.22).toFixed(3);

  if (dir > 0) {
    if (ensureNextGroupPeekRendered() && peek) {
      peek.classList.add('peek-active');
      peek.style.setProperty('--peek-opacity', (0.14 + eased * 0.56).toFixed(3));
      peek.style.setProperty('--peek-blur', `${(1.1 * (1 - eased * 0.85)).toFixed(2)}px`);
      peek.style.setProperty('--peek-y', `${(24 - eased * 24).toFixed(1)}px`);
      peek.style.setProperty('--peek-scale', (0.975 + eased * 0.025).toFixed(4));
      peek.style.setProperty('--peek-head-opacity', (0.25 + eased * 0.65).toFixed(3));
    }
    if (hint) {
      hint.style.opacity = '0';
      hint.style.transform = 'translate(-50%, -8px)';
    }
  } else if (dir < 0) {
    if (hint) {
      hint.textContent = prevGroupName ? `↑ 上一组 · ${prevGroupName}` : '↑ 上一组';
      hint.style.opacity = Math.min(1, eased * 1.15).toFixed(3);
      hint.style.transform = `translate(-50%, ${(-8 + eased * 14).toFixed(1)}px)`;
    }
    if (peek) {
      peek.classList.remove('peek-active');
    }
  }
}

export function resetWheelPull(instant = false) {
  const stage = document.getElementById('grid-stage');
  const grid = document.getElementById('grid');
  const peek = document.getElementById('grid-next-peek');
  const hint = document.getElementById('grid-prev-hint');

  if (stage) {
    stage.classList.remove('wheel-pulling');
    if (instant) stage.classList.add('wheel-instant');
  }

  if (grid) {
    grid.style.transform = '';
    grid.style.opacity = '';
  }
  if (hint) {
    hint.style.opacity = '';
    hint.style.transform = '';
  }

  if (instant) {
    clearNextGroupPeek();
    if (stage) {
      void stage.offsetWidth;
      stage.classList.remove('wheel-instant');
    }
    return;
  }

  if (peek) {
    peek.classList.remove('peek-active');
    peek.style.removeProperty('--peek-opacity');
    peek.style.removeProperty('--peek-blur');
    peek.style.removeProperty('--peek-y');
    peek.style.removeProperty('--peek-scale');
    peek.style.removeProperty('--peek-head-opacity');
  }
  clearTimeout(clearPeekTimer);
  clearPeekTimer = setTimeout(clearNextGroupPeek, 380);
}

function hideGhost() {
  if (ghostEl) {
    ghostEl.remove();
    ghostEl = null;
  }
}

function getRowHeight() {
  const s = state.settings;
  const labelH = s.showLabels ? 26 : 0;
  return (s.iconSize || 62) + labelH + (s.iconGap || 30);
}

function pointerToCell(grid, clientX, clientY, span) {
  const rect = grid.getBoundingClientRect();
  const colW = rect.width / currentCols;
  const rowH = getRowHeight();
  const rawCol = Math.floor((clientX - rect.left) / colW) + 1 - dragOffset.col;
  const rawRow = Math.floor((clientY - rect.top) / rowH) + 1 - dragOffset.row;
  const w = Math.min(span.w, currentCols);
  return {
    col: Math.max(1, Math.min(rawCol, currentCols - w + 1)),
    row: Math.max(1, rawRow),
    w,
    h: span.h
  };
}

function showGhost(grid, pos) {
  if (!ghostEl) {
    ghostEl = document.createElement('div');
    ghostEl.className = 'grid-drop-ghost';
  }
  if (!ghostEl.isConnected) grid.appendChild(ghostEl);
  ghostEl.style.gridColumn = `${pos.col} / span ${pos.w}`;
  ghostEl.style.gridRow = `${pos.row} / span ${pos.h}`;
}

function ensureGridDropEvents(grid) {
  if (gridEventsBound) return;
  gridEventsBound = true;

  grid.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const srcLoc = findItem(dragId);
    if (!srcLoc) return;

    // 检测是否悬停在另一个站点/文件夹正中央准备合并文件夹
    const overCell = e.target.closest('.cell');
    document.querySelectorAll('.drop-merge').forEach((el) => el.classList.remove('drop-merge'));
    if (overCell && overCell.dataset.id !== dragId && srcLoc.item.type === 'site') {
      const dstLoc = findItem(overCell.dataset.id);
      if (dstLoc && (dstLoc.item.type === 'site' || dstLoc.item.type === 'folder')) {
        const r = overCell.getBoundingClientRect();
        const rx = (e.clientX - r.left) / r.width;
        const ry = (e.clientY - r.top) / r.height;
        if (rx > 0.25 && rx < 0.75 && ry > 0.2 && ry < 0.8) {
          overCell.classList.add('drop-merge');
          hideGhost();
          return;
        }
      }
    }

    const pos = pointerToCell(grid, e.clientX, e.clientY, getItemSpan(srcLoc.item));
    showGhost(grid, pos);
  });

  grid.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && grid.contains(e.relatedTarget)) return;
    hideGhost();
  });

  grid.addEventListener('drop', (e) => {
    e.preventDefault();
    const mergeCell = grid.querySelector('.cell.drop-merge');
    document.querySelectorAll('.drop-merge').forEach((el) => el.classList.remove('drop-merge'));
    hideGhost();

    if (!dragId) return;
    const srcLoc = findItem(dragId);
    if (!srcLoc) return;

    // 1. 合并为文件夹
    if (mergeCell && srcLoc.item.type === 'site') {
      const dstId = mergeCell.dataset.id;
      const dstLoc = findItem(dstId);
      if (dstLoc && dstId !== dragId) {
        const target = dstLoc.item;
        const moved = removeItem(dragId);
        const refreshedDst = findItem(dstId);
        if (moved && refreshedDst) {
          if (target.type === 'folder') {
            target.children.push(moved);
          } else if (target.type === 'site') {
            const folder = {
              id: uid('f'),
              type: 'folder',
              title: '新文件夹',
              col: target.col,
              row: target.row,
              children: [target, moved]
            };
            refreshedDst.list.splice(refreshedDst.index, 1, folder);
          }
          clearDraggingId();
          commit('grid');
          return;
        }
      }
    }

    // 2. 自由定位落到任意格子（支持留白、互换与避让）
    const group = getActiveGroup();
    const pos = pointerToCell(grid, e.clientX, e.clientY, getItemSpan(srcLoc.item));
    placeItemAt(group.items, srcLoc.item, pos.col, pos.row, currentCols);
    clearDraggingId();
    commit('grid');
  });
}

export function renderGrid() {
  const grid = document.getElementById('grid');
  if (!grid) return;
  ensureGridDropEvents(grid);

  for (const fn of widgetCleanups) {
    try { fn(); } catch {}
  }
  widgetCleanups = [];

  const group = getActiveGroup();
  currentCols = computeGridCols(grid);
  const { layoutMap, maxRow, mutated } = resolveGroupLayout(group.items, currentCols);
  if (mutated) commit('silent');

  grid.style.setProperty('--grid-cols', String(currentCols));
  grid.style.setProperty('--grid-rows', String(Math.max(maxRow, 1)));
  grid.innerHTML = '';
  ghostEl = null;

  if (pendingTransitionDir !== 0) {
    const dirClass = pendingTransitionDir > 0 ? 'grid-enter-down' : 'grid-enter-up';
    pendingTransitionDir = 0;
    grid.classList.remove('grid-enter-down', 'grid-enter-up');
    void grid.offsetWidth;
    grid.classList.add(dirClass);
    grid.addEventListener('animationend', () => {
      grid.classList.remove(dirClass);
    }, { once: true });
  }

  for (const item of group.items) {
    const rect = layoutMap.get(item.id);
    if (!rect) continue;

    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.id = item.id;
    cell.draggable = true;
    cell.style.gridColumn = `${rect.col} / span ${rect.w}`;
    cell.style.gridRow = `${rect.row} / span ${rect.h}`;

    if (item.type === 'widget') {
      cell.classList.add('widget-cell');
      const card = renderWidget(item, {
        onEditCountdown: openCountdownModal,
        onEditWeather: openWeatherModal,
        onCleanup: (fn) => {
          if (typeof fn === 'function') widgetCleanups.push(fn);
        }
      });
      cell.appendChild(card);
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openWidgetMenu(e, item);
      });
    } else if (item.type === 'folder') {
      cell.appendChild(createFolderTile(item));
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openFolderMenu(e, item);
      });
    } else {
      cell.appendChild(createSiteTile(item));
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSiteMenu(e, item);
      });
    }

    cell.addEventListener('dragstart', (e) => {
      dragId = item.id;
      document.body.classList.add('is-dragging');
      const r = cell.getBoundingClientRect();
      const span = getItemSpan(item);
      dragOffset = {
        col: Math.min(span.w - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * span.w))),
        row: Math.min(span.h - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * span.h)))
      };
      cell.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.id);
    });

    cell.addEventListener('dragend', () => {
      clearDraggingId();
      document.querySelectorAll('.dragging,.drop-merge,.drop-target').forEach((el) => {
        el.classList.remove('dragging', 'drop-merge', 'drop-target');
      });
    });

    grid.appendChild(cell);
  }

  clearNextGroupPeek();
}

function ensureNextGroupPeekRendered() {
  const peek = document.getElementById('grid-next-peek');
  const preview = document.getElementById('grid-next-preview');
  const nameEl = document.getElementById('next-peek-name');
  if (!peek || !preview || state.groups.length <= 1) return false;

  clearTimeout(clearPeekTimer);
  clearPeekTimer = null;

  const key = `${state.activeGroupId}:${currentCols}`;
  const wasHidden = peek.classList.contains('hidden');

  if (nextPeekKey === key && preview.childElementCount > 0) {
    if (wasHidden) {
      peek.classList.remove('hidden');
      void peek.offsetWidth;
    }
    return true;
  }

  const activeIdx = state.groups.findIndex((g) => g.id === state.activeGroupId);
  const nextGroup = state.groups[(activeIdx + 1) % state.groups.length];
  if (nameEl) nameEl.textContent = nextGroup.name;

  preview.style.setProperty('--grid-cols', String(currentCols));
  preview.innerHTML = '';
  nextPeekKey = key;

  const origItems = nextGroup.items || [];
  if (!origItems.length) {
    const empty = document.createElement('div');
    empty.className = 'next-peek-empty';
    empty.textContent = '空白分组';
    preview.appendChild(empty);
  } else {
    const cloned = origItems.map((it) => ({ ...it }));
    const { layoutMap } = resolveGroupLayout(cloned, currentCols);
    const origById = new Map(origItems.map((it) => [it.id, it]));

    let minRow = Infinity;
    for (const rect of layoutMap.values()) {
      if (rect) minRow = Math.min(minRow, rect.row);
    }
    if (!Number.isFinite(minRow)) minRow = 1;

    for (const it of cloned) {
      const rect = layoutMap.get(it.id);
      if (!rect || rect.row !== minRow) continue;
      const orig = origById.get(it.id) || it;

      const cell = document.createElement('div');
      cell.className = 'cell peek-cell';
      cell.style.gridColumn = `${rect.col} / span ${rect.w}`;
      cell.style.gridRow = `1 / span ${rect.h}`;

      if (orig.type === 'widget') {
        cell.classList.add('widget-cell');
        const def = WIDGET_TYPES.find((w) => w.id === orig.widget);
        const card = document.createElement('div');
        card.className = 'widget-card peek-widget-card';
        card.innerHTML = `
          <div class="widget-head"><span>${def?.name || '小组件'}</span></div>
          <div class="peek-widget-lines"><span></span><span></span></div>`;
        cell.appendChild(card);
      } else if (orig.type === 'folder') {
        const tile = document.createElement('div');
        tile.className = 'tile';
        const box = document.createElement('div');
        box.className = 'tile-box folder-box';
        for (const child of (orig.children || []).slice(0, 4)) {
          const mini = document.createElement('div');
          mini.className = 'folder-mini';
          paintTileBox(mini, child);
          box.appendChild(mini);
        }
        const label = document.createElement('div');
        label.className = 'tile-label';
        label.textContent = orig.title || '文件夹';
        tile.append(box, label);
        cell.appendChild(tile);
      } else {
        const tile = document.createElement('div');
        tile.className = 'tile';
        const box = document.createElement('div');
        box.className = 'tile-box';
        paintTileBox(box, orig);
        const label = document.createElement('div');
        label.className = 'tile-label';
        label.textContent = orig.title || '';
        tile.append(box, label);
        cell.appendChild(tile);
      }

      preview.appendChild(cell);
    }
  }

  if (wasHidden) {
    peek.classList.remove('hidden');
    void peek.offsetWidth;
  }
  return true;
}

export function tidyActiveGroup() {
  const grid = document.getElementById('grid');
  const cols = computeGridCols(grid);
  tidyGroupLayout(getActiveGroup().items, cols);
  commit('grid');
  toast('已自动整理对齐当前分组');
}

function createSiteTile(item) {
  const a = document.createElement('a');
  a.className = 'tile';
  const safeHref = normalizeUrl(item.url);
  a.href = safeHref || '#';
  a.draggable = false;
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
  paintTileBox(box, item);

  const label = document.createElement('div');
  label.className = 'tile-label';
  label.textContent = item.title;
  a.append(box, label);
  return a;
}

function createFolderTile(folder) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tile';
  const box = document.createElement('div');
  box.className = 'tile-box folder-box';
  for (const child of (folder.children || []).slice(0, 4)) {
    const mini = document.createElement('div');
    mini.className = 'folder-mini';
    paintTileBox(mini, child);
    box.appendChild(mini);
  }
  const label = document.createElement('div');
  label.className = 'tile-label';
  label.textContent = folder.title || '文件夹';
  btn.append(box, label);
  btn.addEventListener('click', () => openFolderModal(folder, openSiteMenu));
  return btn;
}

export function openSiteMenu(e, item, afterChange) {
  const moveSub = state.groups
    .filter((g) => g.id !== state.activeGroupId)
    .map((g) => ({
      label: g.name,
      onClick: () => {
        const moved = removeItem(item.id);
        if (moved) {
          delete moved.col;
          delete moved.row;
          g.items.push(moved);
          commit('grid');
          afterChange?.();
          toast(`已移至「${g.name}」`);
        }
      }
    }));

  const safeHref = normalizeUrl(item.url);
  const menu = [
    {
      label: '新标签页打开',
      onClick: () => {
        if (safeHref) window.open(safeHref, '_blank', 'noopener,noreferrer');
      }
    },
    { label: '编辑与定制图标', onClick: () => openSiteModal(item) },
    {
      label: '重新抓取网页图标',
      onClick: async () => {
        item.iconMode = 'auto';
        item.customIcon = '';
        toast('正在重新抓取高清图标…');
        const res = await resolveIconAsync(item, { forceRefresh: true });
        commit('grid');
        afterChange?.();
        toast(res ? '已更新并缓存到本地' : '未抓到网页图标，可点击编辑自定义');
      }
    }
  ];
  const loc = findItem(item.id);
  if (loc?.folder) {
    menu.push({
      label: '移出文件夹到桌面',
      onClick: () => {
        const moved = removeItem(item.id);
        if (moved) {
          delete moved.col;
          delete moved.row;
          loc.group.items.push(moved);
          commit('grid');
          afterChange?.();
          toast('已移出到桌面');
        }
      }
    });
  }
  if (moveSub.length) menu.push({ label: '移动到分组', sub: moveSub });
  menu.push({ sep: true });
  menu.push({
    label: '删除',
    danger: true,
    onClick: () => {
      removeItem(item.id);
      commit('grid');
      afterChange?.();
    }
  });
  showContextMenu(e.clientX, e.clientY, menu);
}

function openFolderMenu(e, folder) {
  showContextMenu(e.clientX, e.clientY, [
    { label: '打开文件夹', onClick: () => openFolderModal(folder, openSiteMenu) },
    {
      label: '解散文件夹',
      onClick: () => {
        const loc = findItem(folder.id);
        if (loc) {
          folder.children.forEach((c) => { delete c.col; delete c.row; });
          loc.list.splice(loc.index, 1, ...folder.children);
          commit('grid');
          toast('文件夹已解散');
        }
      }
    },
    { sep: true },
    {
      label: '删除文件夹',
      danger: true,
      onClick: () => {
        removeItem(folder.id);
        commit('grid');
      }
    }
  ]);
}

function openWidgetMenu(e, item) {
  const def = WIDGET_TYPES.find((w) => w.id === item.widget);
  const menu = [];
  if (def && def.sizes.length > 1) {
    menu.push({
      sizes: def.sizes,
      currentSize: item.size || def.sizes[0],
      onSize: (sz) => {
        item.size = sz;
        commit('grid');
      }
    });
    menu.push({ sep: true });
  }
  menu.push({
    label: '移除小组件',
    danger: true,
    onClick: () => {
      removeItem(item.id);
      commit('grid');
    }
  });
  showContextMenu(e.clientX, e.clientY, menu);
}

export function openBlankMenu(e, onOpenSettings) {
  showContextMenu(e.clientX, e.clientY, [
    { label: '添加自定义网址', onClick: () => openSiteModal(null) },
    { label: '添加小组件 / 导入书签', onClick: () => openAddHubModal() },
    { label: '自动整理对齐图标', onClick: () => tidyActiveGroup() },
    { sep: true },
    {
      label: state.settings.minimal ? '退出极简模式' : '切换极简模式',
      onClick: () => {
        state.settings.minimal = !state.settings.minimal;
        commit('settings');
      }
    },
    { label: '打开设置', onClick: () => onOpenSettings?.() }
  ]);
}
