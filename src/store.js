/**
 * 全局状态与持久化
 * 使用 localStorage 同步读取（首屏无需等待异步存储，打开即渲染）
 */
import { createDefaultData, uid, BADGE_GRADIENTS } from './presets.js';
import { clearAllCachedIcons, clearAllWallpapers } from './db.js';
import {
  normalizeUrl,
  getHostKey,
  isPrivateSiteUrl,
  clearIconMemoryCache,
  pruneUnusedCachedIcons
} from './iconEngine.js';

const STORAGE_KEY = 'mirotab:state:v1';
const LEGACY_STORAGE_KEY = 'auratab:state:v1';
const DEFAULT_BADGE_GRADIENT = BADGE_GRADIENTS[0];

export const DEFAULT_SETTINGS = {
  theme: 'dark',            // auto | light | dark | miro
  wallpaper: { type: 'gradient', id: 'miro-prism' }, // gradient | bing | custom
  wallpaperBlur: 0,         // 0-30 px
  wallpaperDim: 15,         // 0-70 %
  iconSize: 62,             // px
  iconRadius: 28,           // %
  iconGap: 30,              // px
  gridMaxWidth: 1080,       // px
  showLabels: true,
  openInNewTab: false,
  clock24: true,
  showSeconds: false,
  showLunar: true,
  clockStyle: 'modern',     // modern | miro | bold | serif | flip | neon
  clockSize: 96,            // 64 - 156 px
  clockWeight: 400,         // 200 | 400 | 700
  searchEngine: 'bing',
  customEngines: [],
  hiddenEngines: [],
  searchSuggest: true,
  searchHistory: true,
  searchPredict: true,
  searchNewTab: false,
  minimal: false,
  sidebarAutoHide: true,
  wheelSwitchGroup: true
};

const MAX_SEARCH_HISTORY = 50;

function normalizeSearchHistory(list) {
  if (!Array.isArray(list)) return [];
  const res = [];
  const seen = new Set();
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const item = raw.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    res.push(item);
    if (res.length >= MAX_SEARCH_HISTORY) break;
  }
  return res;
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function sanitizeBadgeGradient(val) {
  if (typeof val !== 'string') return DEFAULT_BADGE_GRADIENT;
  const trimmed = val.trim();
  if (!trimmed || /[;<>"']|url\s*\(/i.test(trimmed)) {
    return DEFAULT_BADGE_GRADIENT;
  }
  return trimmed;
}

function sanitizeCustomEngineUrl(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.includes('%s')) return '';
  const sentinel = '__MIRO_QUERY__';
  const normalized = normalizeUrl(trimmed.replace(/%s/g, sentinel));
  if (!normalized || !normalized.includes(sentinel)) return '';
  return normalized.replaceAll(sentinel, '%s');
}

function sanitizeCustomEngines(list) {
  if (!Array.isArray(list)) return [];
  const res = [];
  const seenIds = new Set();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || uid('ce')).trim();
    const name = String(item.name || '').trim().slice(0, 20);
    const url = sanitizeCustomEngineUrl(item.url);
    if (!id || !name || !url || seenIds.has(id)) continue;
    seenIds.add(id);
    const bang = String(item.bang || '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 10);
    const color = /^#[0-9a-f]{3,8}$/i.test(String(item.color || '')) ? String(item.color) : '#4c8dff';
    res.push({ id, name, url, bang, color, isCustom: true });
  }
  return res;
}

function sanitizeHiddenEngines(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))];
}

function sanitizeCustomIcon(rawIcon) {
  if (typeof rawIcon !== 'string') return '';
  const trimmed = rawIcon.trim();
  if (!trimmed) return '';
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    const clean = normalizeUrl(trimmed);
    if (clean && !isPrivateSiteUrl(clean)) return clean;
  }
  return '';
}

function sanitizeSiteItem(it) {
  if (!it || typeof it !== 'object') return null;
  const cleanUrl = normalizeUrl(it.url);
  if (!cleanUrl) return null;
  const next = { ...it, id: it.id || uid('s'), type: 'site', url: cleanUrl };
  if (next.badgeGradient !== undefined) {
    next.badgeGradient = sanitizeBadgeGradient(next.badgeGradient);
  }
  if (next.customIcon !== undefined) {
    const safeIcon = sanitizeCustomIcon(next.customIcon);
    next.customIcon = safeIcon;
    if (!safeIcon && next.iconMode === 'custom') {
      next.iconMode = 'auto';
    }
  }
  return next;
}

function cleanupOrphanWidgetData(targetState = state) {
  if (!targetState || typeof targetState !== 'object') return;
  const activeWidgetIds = new Set();
  for (const g of targetState.groups || []) {
    for (const it of g?.items || []) {
      if (it?.type === 'widget' && it.id) {
        activeWidgetIds.add(it.id);
      }
    }
  }
  const data = targetState.widgetData;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    targetState.widgetData = {};
    return;
  }
  for (const key of Object.keys(data)) {
    if (!activeWidgetIds.has(key)) {
      delete data[key];
    }
  }
}

function collectActiveIconKeys(targetState = state) {
  const keys = new Set();
  for (const g of targetState?.groups || []) {
    for (const it of g?.items || []) {
      if (it?.type === 'site' && it.url) {
        const hostKey = getHostKey(it.url);
        if (hostKey) keys.add(`site:${hostKey}`);
      } else if (it?.type === 'folder' && Array.isArray(it.children)) {
        for (const child of it.children) {
          if (child?.url) {
            const hostKey = getHostKey(child.url);
            if (hostKey) keys.add(`site:${hostKey}`);
          }
        }
      }
    }
  }
  return keys;
}

function loadRaw() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw && legacyRaw) {
      raw = legacyRaw;
      localStorage.setItem(STORAGE_KEY, raw);
    }
    if (legacyRaw !== null) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function normalize(data) {
  const base = createDefaultData();
  const rawWidgetData = data?.widgetData;
  const state = {
    version: 1,
    groups: Array.isArray(data?.groups) && data.groups.length ? data.groups : base.groups,
    activeGroupId: data?.activeGroupId || null,
    settings: { ...DEFAULT_SETTINGS, ...(data?.settings || {}) },
    widgetData: rawWidgetData && typeof rawWidgetData === 'object' && !Array.isArray(rawWidgetData) ? rawWidgetData : {},
    searchHistory: normalizeSearchHistory(data?.searchHistory)
  };
  state.settings.wallpaper = { ...DEFAULT_SETTINGS.wallpaper, ...(state.settings.wallpaper || {}) };
  state.settings.customEngines = sanitizeCustomEngines(state.settings.customEngines);
  state.settings.hiddenEngines = sanitizeHiddenEngines(state.settings.hiddenEngines);
  const cleanGroups = [];
  for (const g of state.groups) {
    if (!g || typeof g !== 'object') continue;
    g.id = g.id || uid('g');
    const rawItems = Array.isArray(g.items) ? g.items : [];
    const cleanItems = [];
    for (const it of rawItems) {
      if (!it || typeof it !== 'object') continue;
      if (it.type === 'folder') {
        const cleanChildren = (Array.isArray(it.children) ? it.children : [])
          .map((c) => sanitizeSiteItem(c))
          .filter(Boolean);
        if (cleanChildren.length > 0) {
          cleanItems.push({ ...it, id: it.id || uid('s'), children: cleanChildren });
        }
      } else if (it.type === 'site') {
        const cleanSite = sanitizeSiteItem(it);
        if (cleanSite) cleanItems.push(cleanSite);
      } else {
        it.id = it.id || uid('s');
        if (it.badgeGradient !== undefined) {
          it.badgeGradient = sanitizeBadgeGradient(it.badgeGradient);
        }
        cleanItems.push(it);
      }
    }
    g.items = cleanItems;
    cleanGroups.push(g);
  }
  state.groups = cleanGroups.length ? cleanGroups : base.groups;
  if (!state.groups.some((g) => g.id === state.activeGroupId)) {
    state.activeGroupId = state.groups[0].id;
  }
  cleanupOrphanWidgetData(state);
  return state;
}

export const state = normalize(loadRaw());

const listeners = new Set();
let saveTimer = null;
let pruneTimer = null;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 清理孤儿小组件数据与无引用的图标缓存 */
export function cleanupOrphans({ immediateIcons = false } = {}) {
  cleanupOrphanWidgetData(state);
  if (immediateIcons) {
    clearTimeout(pruneTimer);
    return pruneUnusedCachedIcons(collectActiveIconKeys(state)).catch(() => 0);
  }
  clearTimeout(pruneTimer);
  pruneTimer = setTimeout(() => {
    pruneUnusedCachedIcons(collectActiveIconKeys(state)).catch(() => {});
  }, 600);
}

/** 保存并通知重新渲染。scope 用于局部刷新：'grid' | 'sidebar' | 'settings' | 'all' */
export function commit(scope = 'all') {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 120);
  for (const fn of listeners) fn(scope);
}

export function persist() {
  cleanupOrphanWidgetData(state);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[MiroTab] 保存失败', e);
  }
  cleanupOrphans();
}

// 多个标签页之间同步
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY || !e.newValue) return;
  try {
    const next = normalize(JSON.parse(e.newValue));
    Object.assign(state, next);
    for (const fn of listeners) fn('all');
  } catch {}
});

export function getActiveGroup() {
  return state.groups.find((g) => g.id === state.activeGroupId) || state.groups[0];
}

/** 在所有分组与文件夹中定位一个条目 */
export function findItem(id) {
  for (const g of state.groups) {
    for (let i = 0; i < g.items.length; i++) {
      const it = g.items[i];
      if (it.id === id) return { item: it, list: g.items, index: i, group: g, folder: null };
      if (it.type === 'folder') {
        const ci = it.children.findIndex((c) => c.id === id);
        if (ci >= 0) return { item: it.children[ci], list: it.children, index: ci, group: g, folder: it };
      }
    }
  }
  return null;
}

export function removeItem(id) {
  const loc = findItem(id);
  if (!loc) return null;
  loc.list.splice(loc.index, 1);
  // 文件夹只剩 1 个或 0 个时自动解散
  if (loc.folder && loc.folder.children.length <= 1) {
    const fLoc = findItem(loc.folder.id);
    if (fLoc) {
      fLoc.list.splice(fLoc.index, 1, ...loc.folder.children);
    }
  }
  return loc.item;
}

function stripUrlCredentials(rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) return '';
  try {
    const u = new URL(normalized);
    u.username = '';
    u.password = '';
    return u.href;
  } catch {
    return normalized;
  }
}

function sanitizeExportSite(it) {
  if (!it || isPrivateSiteUrl(it.url)) return null;
  const cleanUrl = stripUrlCredentials(it.url);
  if (!cleanUrl) return null;
  return { ...it, url: cleanUrl };
}

export function exportState({ desensitize = false } = {}) {
  if (!desensitize) {
    return JSON.stringify({ app: 'MiroTab', exportedAt: new Date().toISOString(), ...state }, null, 2);
  }
  const cloned = deepClone(state);
  cloned.searchHistory = [];
  cloned.widgetData = {};
  if (cloned.settings?.wallpaper?.type === 'custom') {
    cloned.settings.wallpaper = { type: 'gradient', id: 'miro-prism' };
  }
  if (Array.isArray(cloned.settings?.customEngines)) {
    cloned.settings.customEngines = cloned.settings.customEngines
      .filter((e) => e && !isPrivateSiteUrl(String(e.url || '').replace(/%s/g, 'test')))
      .map((e) => ({ ...e, url: stripUrlCredentials(String(e.url || '').replace(/%s/g, '__MIRO_QUERY__')).replaceAll('__MIRO_QUERY__', '%s') }))
      .filter((e) => e.url && e.url.includes('%s'));
  }
  for (const g of cloned.groups || []) {
    const nextItems = [];
    for (const it of g.items || []) {
      if (it.type === 'site') {
        const safeSite = sanitizeExportSite(it);
        if (safeSite) nextItems.push(safeSite);
      } else if (it.type === 'folder') {
        const safeChildren = (it.children || [])
          .map((c) => sanitizeExportSite(c))
          .filter(Boolean);
        if (safeChildren.length >= 1) {
          nextItems.push({ ...it, children: safeChildren });
        }
      } else {
        nextItems.push(it);
      }
    }
    g.items = nextItems;
  }
  return JSON.stringify({ app: 'MiroTab', exportedAt: new Date().toISOString(), ...cloned }, null, 2);
}

export function inspectBackup(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('文件格式不正确');
  }
  const hasGroups = Array.isArray(data.groups) && data.groups.length > 0;
  const hasSettings = !!(data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings));
  const hasWidgetData = !!(data.widgetData && typeof data.widgetData === 'object' && !Array.isArray(data.widgetData) && Object.keys(data.widgetData).length > 0);
  const hasHistory = Array.isArray(data.searchHistory) && data.searchHistory.length > 0;
  if (!hasGroups && !hasSettings) {
    throw new Error('未在备份中发现有效分组或配置数据');
  }

  let siteCount = 0;
  let widgetCount = 0;
  for (const g of data.groups || []) {
    for (const it of g?.items || []) {
      if (it?.type === 'site') siteCount++;
      else if (it?.type === 'folder') siteCount += Array.isArray(it.children) ? it.children.length : 0;
      else if (it?.type === 'widget') widgetCount++;
    }
  }
  return {
    valid: true,
    data,
    stats: {
      groupCount: hasGroups ? data.groups.length : 0,
      siteCount,
      widgetCount,
      hasGroups,
      hasSettings,
      hasWidgetData,
      hasHistory
    }
  };
}

export function importState(json, modules = { groups: true, settings: true, widgetData: true, searchHistory: true }) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || typeof data !== 'object') throw new Error('文件格式不正确');
  const opts = {
    groups: modules?.groups !== false,
    settings: modules?.settings !== false,
    widgetData: modules?.widgetData !== false,
    searchHistory: modules?.searchHistory !== false
  };
  if (opts.groups && !Array.isArray(data.groups)) {
    throw new Error('备份文件中缺少有效的分组数据');
  }

  const merged = {
    groups: opts.groups ? data.groups : deepClone(state.groups),
    activeGroupId: opts.groups ? data.activeGroupId : state.activeGroupId,
    settings: opts.settings ? (data.settings || {}) : deepClone(state.settings),
    widgetData: opts.widgetData ? (data.widgetData || {}) : deepClone(state.widgetData),
    searchHistory: opts.searchHistory ? (data.searchHistory || []) : deepClone(state.searchHistory)
  };
  const next = normalize(merged);
  Object.assign(state, next);
  persist();
  for (const fn of listeners) fn('all');
}

export async function resetState() {
  clearTimeout(saveTimer);
  clearTimeout(pruneTimer);
  clearIconMemoryCache();
  await Promise.all([clearAllCachedIcons(), clearAllWallpapers()]).catch(() => {});

  const next = normalize(null);
  next.settings = deepClone(DEFAULT_SETTINGS);
  Object.assign(state, next);
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {}
  persist();
  clearTimeout(pruneTimer);
  for (const fn of listeners) fn('all');
}

export function addSearchHistory(query) {
  const clean = typeof query === 'string' ? query.trim() : '';
  if (!clean) return;
  const key = clean.toLowerCase();
  state.searchHistory = [
    clean,
    ...(state.searchHistory || []).filter((item) => item.toLowerCase() !== key)
  ].slice(0, MAX_SEARCH_HISTORY);
  clearTimeout(saveTimer);
  persist();
}

export function removeSearchHistory(query) {
  const clean = typeof query === 'string' ? query.trim() : '';
  if (!clean) return;
  const key = clean.toLowerCase();
  state.searchHistory = (state.searchHistory || []).filter((item) => item.toLowerCase() !== key);
  clearTimeout(saveTimer);
  persist();
}

export function clearSearchHistory() {
  state.searchHistory = [];
  clearTimeout(saveTimer);
  persist();
}
