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
  if (item?.type === 'folder') {
    const m = String(item.size || '1x1').match(/^(\d+)x(\d+)$/);
    if (m) return { w: Number(m[1]), h: Number(m[2]) };
    return { w: 1, h: 1 };
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

function hasValidCoord(item) {
  return Number.isInteger(item?.col) && item.col >= 1 && Number.isInteger(item?.row) && item.row >= 1;
}

function findNearestFreeSpot(w, h, cols, occupied, prefCol, prefRow) {
  const safeCols = Math.max(1, cols);
  const safeW = Math.min(w, safeCols);
  const maxCol = Math.max(1, safeCols - safeW + 1);
  const targetC = Math.max(1, Math.min(Number.isInteger(prefCol) ? prefCol : 1, maxCol));
  const targetR = Math.max(1, Number.isInteger(prefRow) ? prefRow : 1);

  let maxOccupiedRow = targetR + h - 1;
  for (const o of occupied) {
    maxOccupiedRow = Math.max(maxOccupiedRow, (o.row || 1) + (o.h || 1) - 1);
  }
  const maxRowLimit = Math.max(60, maxOccupiedRow + 20);

  let best = null;
  let bestScore = Infinity;
  for (let row = 1; row <= maxRowLimit; row++) {
    const dr = row - targetR;
    if (dr > 0 && dr * dr > bestScore) break;
    for (let col = 1; col <= maxCol; col++) {
      const cand = { col, row, w: safeW, h };
      if (occupied.some((o) => rectsOverlap(cand, o))) continue;
      const dc = col - targetC;
      const score = dr * dr + dc * dc;
      if (
        score < bestScore ||
        (score === bestScore && (row < best.row || (row === best.row && col < best.col)))
      ) {
        bestScore = score;
        best = { col, row };
        if (score === 0) return best;
      }
    }
  }
  return best || { col: 1, row: maxRowLimit + 1 };
}

/**
 * 将 item 自由移动到 (targetCol, targetRow)：
 * - 落到空位：直接放置
 * - 落到单个同尺寸条目上且原位安全可用：丝滑互换
 * - 压到多个、不同尺寸条目或原位不可互换（如文件夹放大/拖出）：被挡住的条目自动寻找最近空位避让
 */
export function placeItemAt(items, item, targetCol, targetRow, cols) {
  const safeCols = Math.max(1, cols);
  const span = getItemSpan(item);
  const w = Math.min(span.w, safeCols);
  const h = span.h;
  const rawCol = Number.isFinite(targetCol) ? Math.round(targetCol) : 1;
  const rawRow = Number.isFinite(targetRow) ? Math.round(targetRow) : 1;
  const col = Math.max(1, Math.min(rawCol, Math.max(1, safeCols - w + 1)));
  const row = Math.max(1, rawRow);

  const prevCol = item.col;
  const prevRow = item.row;
  const hasPrevPos = Number.isInteger(prevCol) && prevCol >= 1 && Number.isInteger(prevRow) && prevRow >= 1;
  const targetRect = { col, row, w, h };

  const getClampedRect = (o) => {
    const os = getItemSpan(o);
    const ow = Math.min(os.w, safeCols);
    const oc = Math.max(1, Math.min(o.col, Math.max(1, safeCols - ow + 1)));
    return { col: oc, row: o.row, w: ow, h: os.h };
  };

  const others = items.filter((x) => x.id !== item.id);
  const positionedOthers = others.filter(hasValidCoord);
  const colliding = positionedOthers.filter((o) => rectsOverlap(targetRect, getClampedRect(o)));

  // 恰好与 1 个同尺寸条目重合，且原位与目标位及周围条目均不冲突 -> 直接互换位置
  if (colliding.length === 1 && hasPrevPos) {
    const other = colliding[0];
    const os = getItemSpan(other);
    const ow = Math.min(os.w, safeCols);
    if (ow === w && os.h === h) {
      const swapCol = Math.max(1, Math.min(prevCol, Math.max(1, safeCols - ow + 1)));
      const swapRect = { col: swapCol, row: prevRow, w: ow, h: os.h };
      const swapBlocked =
        rectsOverlap(swapRect, targetRect) ||
        positionedOthers.some((o) => o.id !== other.id && rectsOverlap(swapRect, getClampedRect(o)));
      if (!swapBlocked) {
        other.col = swapCol;
        other.row = prevRow;
        item.col = col;
        item.row = row;
        return;
      }
    }
  }

  // 放到目标坐标，被压住的条目自动避让到最近空闲位
  item.col = col;
  item.row = row;
  if (!colliding.length) return;

  const collidingIds = new Set(colliding.map((c) => c.id));
  const occupied = [{ col, row, w, h }];
  for (const o of positionedOthers) {
    if (collidingIds.has(o.id)) continue;
    occupied.push(getClampedRect(o));
  }

  // 多格被遮挡条目优先寻找最近空位，再排单格条目，避免大块被推到过远位置
  const sortedColliding = [...colliding].sort((a, b) => {
    const sa = getItemSpan(a);
    const sb = getItemSpan(b);
    return sb.w * sb.h - sa.w * sa.h;
  });

  for (const displaced of sortedColliding) {
    const ds = getItemSpan(displaced);
    const dw = Math.min(ds.w, safeCols);
    const spot = findNearestFreeSpot(dw, ds.h, safeCols, occupied, displaced.col, displaced.row);
    displaced.col = spot.col;
    displaced.row = spot.row;
    occupied.push({ col: spot.col, row: spot.row, w: dw, h: ds.h });
  }
}

/**
 * 一键自动整理对齐（按当前顺序从左上角紧凑排布）
 */
export function tidyGroupLayout(items, cols) {
  const safeCols = Math.max(1, cols);
  const occupied = [];
  // 整理时将占多格的条目（小组件与大文件夹）优先排在前面，再排单格文件夹和站点，整体视觉更规整
  const isMultiCell = (item) => {
    if (item?.type === 'widget') return true;
    const { w, h } = getItemSpan(item);
    return w > 1 || h > 1;
  };
  const ordered = [
    ...items.filter(isMultiCell),
    ...items.filter((i) => !isMultiCell(i))
  ];
  for (const it of ordered) {
    const { w, h } = getItemSpan(it);
    const safeW = Math.min(w, safeCols);
    const spot = findFreeSpot(safeW, h, safeCols, occupied);
    it.col = spot.col;
    it.row = spot.row;
    occupied.push({ col: spot.col, row: spot.row, w: safeW, h });
  }
}
