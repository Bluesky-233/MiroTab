/**
 * 自由桌面网格坐标与碰撞避让算法
 * 每个条目支持 { col, row } (1-based) 与 span (w, h)
 */
import { state } from './store.js';

export function getItemSpan(item) {
  if (item?.type === 'widget') {
    const m = String(item.size || '2x2').match(/^(\d+)x(\d+)$/);
    if (m) return { w: Number(m[1]), h: Number(m[2]) };
    return { w: 2, h: 2 };
  }
  return { w: 1, h: 1 };
}

export function computeGridCols(gridEl) {
  const s = state.settings;
  const cellW = (s.iconSize || 62) + (s.iconGap || 30);
  const avail = gridEl?.clientWidth || Math.min(window.innerWidth - 56, s.gridMaxWidth || 1080);
  return Math.max(4, Math.floor(avail / Math.max(60, cellW)));
}

export function rectsOverlap(a, b) {
  return (
    a.col < b.col + b.w &&
    a.col + a.w > b.col &&
    a.row < b.row + b.h &&
    a.row + a.h > b.row
  );
}

/**
 * 在 occupied 矩形集合中寻找第一个不重叠的 (col, row)
 */
export function findFreeSpot(w, h, cols, occupied) {
  const safeW = Math.min(w, cols);
  let maxOccupiedRow = 0;
  for (const o of occupied) {
    maxOccupiedRow = Math.max(maxOccupiedRow, (o.row || 1) + (o.h || 1) - 1);
  }
  const maxRowLimit = Math.max(60, maxOccupiedRow + 20);
  for (let row = 1; row <= maxRowLimit; row++) {
    for (let col = 1; col <= cols - safeW + 1; col++) {
      const cand = { col, row, w: safeW, h };
      if (!occupied.some((o) => rectsOverlap(cand, o))) {
        return { col, row };
      }
    }
  }
  return { col: 1, row: maxRowLimit + 1 };
}

/**
 * 为分组中所有尚无有效坐标（或窄屏临时重叠）的条目分配渲染坐标
 * 仅对原本无合法坐标的条目持久化写回，窄屏临时避让不覆写原坐标
 */
export function resolveGroupLayout(items, cols) {
  const placed = [];
  const layoutMap = new Map();
  let mutated = false;

  // 1. 先放置已有坐标且不重叠的条目
  for (const it of items) {
    const { w, h } = getItemSpan(it);
    const safeW = Math.min(w, cols);
    if (Number.isInteger(it.col) && it.col >= 1 && Number.isInteger(it.row) && it.row >= 1) {
      const clampedCol = Math.min(it.col, Math.max(1, cols - safeW + 1));
      const rect = { id: it.id, col: clampedCol, row: it.row, w: safeW, h };
      if (!placed.some((p) => rectsOverlap(rect, p))) {
        placed.push(rect);
        layoutMap.set(it.id, rect);
        continue;
      }
    }
    // 暂留待自动分配
    layoutMap.set(it.id, null);
  }

  // 2. 为无坐标或窄屏冲突条目找空位
  for (const it of items) {
    if (layoutMap.get(it.id)) continue;
    const { w, h } = getItemSpan(it);
    const safeW = Math.min(w, cols);
    const spot = findFreeSpot(safeW, h, cols, placed);
    const hasPos = Number.isInteger(it.col) && it.col >= 1 && Number.isInteger(it.row) && it.row >= 1;
    if (!hasPos) {
      it.col = spot.col;
      it.row = spot.row;
      mutated = true;
    }
    const rect = { id: it.id, col: spot.col, row: spot.row, w: safeW, h };
    placed.push(rect);
    layoutMap.set(it.id, rect);
  }

  let maxRow = 1;
  for (const r of placed) {
    maxRow = Math.max(maxRow, r.row + r.h - 1);
  }

  return { layoutMap, maxRow, mutated };
}

/**
 * 将 item 自由移动到 (targetCol, targetRow)：
 * - 落到空位：直接放置
 * - 落到单个同尺寸条目上：丝滑互换
 * - 压到多个或不同尺寸条目：被挡住的条目自动寻找最近空位避让
 */
export function placeItemAt(items, item, targetCol, targetRow, cols) {
  const span = getItemSpan(item);
  const w = Math.min(span.w, cols);
  const h = span.h;
  const col = Math.max(1, Math.min(targetCol, cols - w + 1));
  const row = Math.max(1, targetRow);

  const prevCol = item.col;
  const prevRow = item.row;
  const targetRect = { col, row, w, h };

  const others = items.filter((x) => x.id !== item.id);
  const colliding = others.filter((o) => {
    const os = getItemSpan(o);
    const oc = Math.min(o.col || 1, Math.max(1, cols - Math.min(os.w, cols) + 1));
    return rectsOverlap(targetRect, { col: oc, row: o.row || 1, w: Math.min(os.w, cols), h: os.h });
  });

  // 恰好与 1 个同尺寸条目重合 -> 直接互换位置
  if (colliding.length === 1 && Number.isInteger(prevCol) && Number.isInteger(prevRow)) {
    const other = colliding[0];
    const os = getItemSpan(other);
    if (os.w === span.w && os.h === span.h) {
      other.col = prevCol;
      other.row = prevRow;
      item.col = col;
      item.row = row;
      return;
    }
  }

  // 放到目标坐标，被压住的条目自动避让到最近空闲位
  item.col = col;
  item.row = row;
  if (!colliding.length) return;

  const collidingIds = new Set(colliding.map((c) => c.id));
  const occupied = [{ col, row, w, h }];
  for (const o of others) {
    if (collidingIds.has(o.id)) continue;
    const os = getItemSpan(o);
    const ow = Math.min(os.w, cols);
    occupied.push({ col: Math.min(o.col || 1, cols - ow + 1), row: o.row || 1, w: ow, h: os.h });
  }

  for (const displaced of colliding) {
    const ds = getItemSpan(displaced);
    const spot = findFreeSpot(Math.min(ds.w, cols), ds.h, cols, occupied);
    displaced.col = spot.col;
    displaced.row = spot.row;
    occupied.push({ col: spot.col, row: spot.row, w: Math.min(ds.w, cols), h: ds.h });
  }
}

/**
 * 一键自动整理对齐（按当前顺序从左上角紧凑排布）
 */
export function tidyGroupLayout(items, cols) {
  const occupied = [];
  // 整理时先排小组件，再排文件夹和站点图标，整体视觉更规整
  const ordered = [
    ...items.filter((i) => i.type === 'widget'),
    ...items.filter((i) => i.type !== 'widget')
  ];
  for (const it of ordered) {
    const { w, h } = getItemSpan(it);
    const safeW = Math.min(w, cols);
    const spot = findFreeSpot(safeW, h, cols, occupied);
    it.col = spot.col;
    it.row = spot.row;
    occupied.push({ col: spot.col, row: spot.row, w: safeW, h });
  }
}
