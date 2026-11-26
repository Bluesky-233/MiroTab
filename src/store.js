/**
 * 全局状态与持久化
 * 使用 localStorage 同步读取（首屏无需等待异步存储，打开即渲染）
 */
import {
  createDefaultData,
  uid,
  BADGE_GRADIENTS,
  SEARCH_ENGINES,
  GRADIENT_WALLPAPERS,
  WIDGET_TYPES
} from './presets.js';
import { clearAllCachedIcons, clearAllWallpapers } from './db.js';
import {
  normalizeUrl,
  getHostKey,
  isPrivateSiteUrl,
  clearIconMemoryCache,
  invalidatePendingIconTasks,
  pruneUnusedCachedIcons
} from './iconEngine.js';

const STORAGE_KEY = 'mirotab:state:v1';
const LEGACY_STORAGE_KEY = 'auratab:state:v1';
const DEFAULT_BADGE_GRADIENT = BADGE_GRADIENTS[0];
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
let resetEpoch = 0;

export function getResetEpoch() {
  return resetEpoch;
}

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
  searchPredict: false,
  searchNewTab: false,
  thirdPartyIconFallback: false,
  thirdPartyIconProvider: 'duckduckgo',
  minimal: false,
  sidebarAutoHide: true,
  wheelSwitchGroup: true
};

export const NUMERIC_SETTING_RULES = {
  wallpaperBlur: { min: 0, max: 30, integer: true },
  wallpaperDim: { min: 0, max: 70, integer: true },
  iconSize: { min: 48, max: 86, integer: true },
  iconRadius: { min: 8, max: 50, integer: true },
  iconGap: { min: 16, max: 54, integer: true },
  gridMaxWidth: { min: 720, max: 1600, integer: true },
  clockSize: { min: 64, max: 156, integer: true }
};

const VALID_THEMES = new Set(['auto', 'light', 'dark', 'miro']);
const VALID_CLOCK_STYLES = new Set(['modern', 'miro', 'bold', 'serif', 'flip', 'neon']);
const VALID_CLOCK_WEIGHTS = new Set([200, 400, 700]);
const VALID_WALLPAPER_TYPES = new Set(['gradient', 'bing', 'custom']);
const VALID_THIRD_PARTY_PROVIDERS = new Set(['duckduckgo', 'google', 'yandex']);
const VALID_WALLPAPER_IDS = new Set(GRADIENT_WALLPAPERS.map((w) => w.id));
const VALID_GROUP_NAMES_DEFAULT = new Set(['主页', 'AI', '开发']);
const WIDGET_SIZE_MAP = new Map(WIDGET_TYPES.map((w) => [w.id, new Set(w.sizes)]));

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

function sanitizeNumericSetting(val, key) {
  const rule = NUMERIC_SETTING_RULES[key];
  if (!rule) return val;
  if (typeof val !== 'number' || !Number.isFinite(val)) return DEFAULT_SETTINGS[key];
  const n = rule.integer ? Math.round(val) : val;
  return Math.min(rule.max, Math.max(rule.min, n));
}

function sanitizeWallpaperSetting(rawWp) {
  const def = { ...DEFAULT_SETTINGS.wallpaper };
  if (!rawWp || typeof rawWp !== 'object' || Array.isArray(rawWp)) return def;
  const type = VALID_WALLPAPER_TYPES.has(rawWp.type) ? rawWp.type : 'gradient';
  if (type === 'gradient') {
    const id = typeof rawWp.id === 'string' && VALID_WALLPAPER_IDS.has(rawWp.id) ? rawWp.id : def.id;
    return { type: 'gradient', id };
  }
  if (type === 'bing') {
    const idx = typeof rawWp.bingIdx === 'number' && Number.isFinite(rawWp.bingIdx)
      ? Math.max(0, Math.min(7, Math.round(rawWp.bingIdx)))
      : 0;
    return { type: 'bing', bingIdx: idx };
  }
  return { type: 'custom' };
}

function sanitizeSettings(rawSettings) {
  const src = rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings) ? rawSettings : {};
  const customEngines = sanitizeCustomEngines(src.customEngines);
  const hiddenEngines = sanitizeHiddenEngines(src.hiddenEngines);
  const validEngineIds = new Set([
    ...SEARCH_ENGINES.map((e) => e.id),
    ...customEngines.map((e) => e.id)
  ]);

  const out = {
    theme: VALID_THEMES.has(src.theme) ? src.theme : DEFAULT_SETTINGS.theme,
    wallpaper: sanitizeWallpaperSetting(src.wallpaper),
    wallpaperBlur: sanitizeNumericSetting(src.wallpaperBlur, 'wallpaperBlur'),
    wallpaperDim: sanitizeNumericSetting(src.wallpaperDim, 'wallpaperDim'),
    iconSize: sanitizeNumericSetting(src.iconSize, 'iconSize'),
    iconRadius: sanitizeNumericSetting(src.iconRadius, 'iconRadius'),
    iconGap: sanitizeNumericSetting(src.iconGap, 'iconGap'),
    gridMaxWidth: sanitizeNumericSetting(src.gridMaxWidth, 'gridMaxWidth'),
    showLabels: typeof src.showLabels === 'boolean' ? src.showLabels : DEFAULT_SETTINGS.showLabels,
    openInNewTab: typeof src.openInNewTab === 'boolean' ? src.openInNewTab : DEFAULT_SETTINGS.openInNewTab,
    clock24: typeof src.clock24 === 'boolean' ? src.clock24 : DEFAULT_SETTINGS.clock24,
    showSeconds: typeof src.showSeconds === 'boolean' ? src.showSeconds : DEFAULT_SETTINGS.showSeconds,
    showLunar: typeof src.showLunar === 'boolean' ? src.showLunar : DEFAULT_SETTINGS.showLunar,
    clockStyle: VALID_CLOCK_STYLES.has(src.clockStyle) ? src.clockStyle : DEFAULT_SETTINGS.clockStyle,
    clockSize: sanitizeNumericSetting(src.clockSize, 'clockSize'),
    clockWeight: VALID_CLOCK_WEIGHTS.has(Number(src.clockWeight)) && typeof src.clockWeight === 'number'
      ? Number(src.clockWeight)
      : DEFAULT_SETTINGS.clockWeight,
    searchEngine: typeof src.searchEngine === 'string' && validEngineIds.has(src.searchEngine)
      ? src.searchEngine
      : DEFAULT_SETTINGS.searchEngine,
    customEngines,
    hiddenEngines,
    searchSuggest: typeof src.searchSuggest === 'boolean' ? src.searchSuggest : DEFAULT_SETTINGS.searchSuggest,
    searchHistory: typeof src.searchHistory === 'boolean' ? src.searchHistory : DEFAULT_SETTINGS.searchHistory,
    searchPredict: typeof src.searchPredict === 'boolean' ? src.searchPredict : DEFAULT_SETTINGS.searchPredict,
    searchNewTab: typeof src.searchNewTab === 'boolean' ? src.searchNewTab : DEFAULT_SETTINGS.searchNewTab,
    thirdPartyIconFallback: typeof src.thirdPartyIconFallback === 'boolean'
      ? src.thirdPartyIconFallback
      : DEFAULT_SETTINGS.thirdPartyIconFallback,
    thirdPartyIconProvider: VALID_THIRD_PARTY_PROVIDERS.has(src.thirdPartyIconProvider)
      ? src.thirdPartyIconProvider
      : DEFAULT_SETTINGS.thirdPartyIconProvider,
    minimal: typeof src.minimal === 'boolean' ? src.minimal : DEFAULT_SETTINGS.minimal,
    sidebarAutoHide: typeof src.sidebarAutoHide === 'boolean' ? src.sidebarAutoHide : DEFAULT_SETTINGS.sidebarAutoHide,
    wheelSwitchGroup: typeof src.wheelSwitchGroup === 'boolean' ? src.wheelSwitchGroup : DEFAULT_SETTINGS.wheelSwitchGroup
  };
  return out;
}

function validateImportSettings(rawSettings) {
  if (rawSettings === undefined) return;
  if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) {
    throw new Error('备份中的 settings 格式不正确');
  }
  for (const [key, rule] of Object.entries(NUMERIC_SETTING_RULES)) {
    if (rawSettings[key] === undefined) continue;
    const val = rawSettings[key];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new Error(`配置项 ${key} 必须为有效数字`);
    }
    if (val < rule.min || val > rule.max) {
      throw new Error(`配置项 ${key} 超出允许范围（${rule.min} ~ ${rule.max}）`);
    }
  }
  if (rawSettings.clockWeight !== undefined) {
    if (typeof rawSettings.clockWeight !== 'number' || !VALID_CLOCK_WEIGHTS.has(rawSettings.clockWeight)) {
      throw new Error('配置项 clockWeight 必须为 200、400 或 700');
    }
  }
  if (rawSettings.theme !== undefined && !VALID_THEMES.has(rawSettings.theme)) {
    throw new Error('配置项 theme 值无效');
  }
  if (rawSettings.clockStyle !== undefined && !VALID_CLOCK_STYLES.has(rawSettings.clockStyle)) {
    throw new Error('配置项 clockStyle 值无效');
  }
  if (rawSettings.wallpaper !== undefined) {
    if (!rawSettings.wallpaper || typeof rawSettings.wallpaper !== 'object' || Array.isArray(rawSettings.wallpaper)) {
      throw new Error('配置项 wallpaper 格式不正确');
    }
    if (rawSettings.wallpaper.type !== undefined && !VALID_WALLPAPER_TYPES.has(rawSettings.wallpaper.type)) {
      throw new Error('配置项 wallpaper.type 值无效');
    }
    if (rawSettings.wallpaper.bingIdx !== undefined) {
      const idx = rawSettings.wallpaper.bingIdx;
      if (typeof idx !== 'number' || !Number.isFinite(idx) || idx < 0 || idx > 7) {
        throw new Error('配置项 wallpaper.bingIdx 超出范围（0 ~ 7）');
      }
    }
  }
}

function sanitizeGridCoord(val) {
  return typeof val === 'number' && Number.isInteger(val) && val >= 1 && val <= 200 ? val : undefined;
}

function sanitizeSiteItem(it) {
  if (!it || typeof it !== 'object' || Array.isArray(it)) return null;
  const rawUrl = typeof it.url === 'string' ? it.url.slice(0, 2048) : '';
  const cleanUrl = normalizeUrl(rawUrl);
  if (!cleanUrl) return null;
  const iconMode = it.iconMode === 'custom' || it.iconMode === 'badge' ? it.iconMode : 'auto';
  const next = {
    id: typeof it.id === 'string' && it.id.trim() ? it.id.trim().slice(0, 64) : uid('s'),
    type: 'site',
    title: typeof it.title === 'string' ? it.title.trim().slice(0, 120) : '',
    url: cleanUrl,
    iconMode,
    fullBleed: !!it.fullBleed
  };
  const col = sanitizeGridCoord(it.col);
  const row = sanitizeGridCoord(it.row);
  if (col !== undefined) next.col = col;
  if (row !== undefined) next.row = row;
  if (typeof it.badgeText === 'string' && it.badgeText.trim()) {
    next.badgeText = it.badgeText.trim().slice(0, 8);
  }
  if (it.badgeGradient !== undefined) {
    next.badgeGradient = sanitizeBadgeGradient(it.badgeGradient);
  }
  if (it.customIcon !== undefined) {
    const safeIcon = sanitizeCustomIcon(it.customIcon);
    next.customIcon = safeIcon;
    if (!safeIcon && next.iconMode === 'custom') {
      next.iconMode = 'auto';
    }
  }
  return next;
}

function sanitizeWidgetItem(it) {
  if (!it || typeof it !== 'object' || Array.isArray(it)) return null;
  const validSizes = WIDGET_SIZE_MAP.get(it.widget);
  if (!validSizes) return null;
  const defaultSize = [...validSizes][0];
  const next = {
    id: typeof it.id === 'string' && it.id.trim() ? it.id.trim().slice(0, 64) : uid('w'),
    type: 'widget',
    widget: it.widget,
    size: validSizes.has(it.size) ? it.size : defaultSize
  };
  const col = sanitizeGridCoord(it.col);
  const row = sanitizeGridCoord(it.row);
  if (col !== undefined) next.col = col;
  if (row !== undefined) next.row = row;
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
    activeGroupId: typeof data?.activeGroupId === 'string' ? data.activeGroupId.slice(0, 64) : null,
    settings: sanitizeSettings(data?.settings),
    widgetData: rawWidgetData && typeof rawWidgetData === 'object' && !Array.isArray(rawWidgetData) ? rawWidgetData : {},
    searchHistory: normalizeSearchHistory(data?.searchHistory)
  };
  const cleanGroups = [];
  for (const g of state.groups) {
    if (!g || typeof g !== 'object' || Array.isArray(g)) continue;
    const gid = typeof g.id === 'string' && g.id.trim() ? g.id.trim().slice(0, 64) : uid('g');
    const gname = typeof g.name === 'string' && g.name.trim() ? g.name.trim().slice(0, 40) : '分组';
    const gicon = typeof g.icon === 'string' && g.icon.trim() ? g.icon.trim().slice(0, 24) : 'home';
    const rawItems = Array.isArray(g.items) ? g.items : [];
    const cleanItems = [];
    for (const it of rawItems) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
      if (it.type === 'folder') {
        const cleanChildren = (Array.isArray(it.children) ? it.children : [])
          .map((c) => sanitizeSiteItem(c))
          .filter(Boolean);
        if (cleanChildren.length > 0) {
          const folder = {
            id: typeof it.id === 'string' && it.id.trim() ? it.id.trim().slice(0, 64) : uid('f'),
            type: 'folder',
            title: typeof it.title === 'string' && it.title.trim() ? it.title.trim().slice(0, 40) : '文件夹',
            children: cleanChildren
          };
          const col = sanitizeGridCoord(it.col);
          const row = sanitizeGridCoord(it.row);
          if (col !== undefined) folder.col = col;
          if (row !== undefined) folder.row = row;
          cleanItems.push(folder);
        }
      } else if (it.type === 'site') {
        const cleanSite = sanitizeSiteItem(it);
        if (cleanSite) cleanItems.push(cleanSite);
      } else if (it.type === 'widget') {
        const cleanWidget = sanitizeWidgetItem(it);
        if (cleanWidget) cleanItems.push(cleanWidget);
      }
    }
    cleanGroups.push({ id: gid, name: gname, icon: gicon, items: cleanItems });
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

function toOriginOnlyUrl(rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) return '';
  try {
    const u = new URL(normalized);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

function sanitizeShareSite(it, { keepTitles = false, keepCustomIcons = false } = {}) {
  if (!it || isPrivateSiteUrl(it.url)) return null;
  const originUrl = toOriginOnlyUrl(it.url);
  if (!originUrl) return null;
  let hostname = '';
  try {
    hostname = new URL(originUrl).hostname.replace(/^www\./, '');
  } catch {
    hostname = 'site';
  }
  const out = {
    id: it.id || uid('s'),
    type: 'site',
    title: keepTitles && typeof it.title === 'string' && it.title.trim() ? it.title.trim().slice(0, 120) : hostname,
    url: originUrl,
    iconMode: 'auto'
  };
  if (keepCustomIcons) {
    out.iconMode = it.iconMode === 'custom' || it.iconMode === 'badge' ? it.iconMode : 'auto';
    if (it.fullBleed) out.fullBleed = true;
    if (it.badgeText) out.badgeText = String(it.badgeText).slice(0, 8);
    if (it.badgeGradient) out.badgeGradient = sanitizeBadgeGradient(it.badgeGradient);
    if (it.customIcon) {
      const safeIcon = sanitizeCustomIcon(it.customIcon);
      if (safeIcon) out.customIcon = safeIcon;
      else if (out.iconMode === 'custom') out.iconMode = 'auto';
    }
  }
  return out;
}

export function exportState({ desensitize = false, cleanOptions = null } = {}) {
  if (!desensitize) {
    return JSON.stringify({ app: 'MiroTab', exportedAt: new Date().toISOString(), ...state }, null, 2);
  }
  const opts = {
    keepTitles: !!cleanOptions?.keepTitles,
    keepCustomIcons: !!cleanOptions?.keepCustomIcons,
    includeCustomEngines: !!cleanOptions?.includeCustomEngines
  };

  const s = state.settings || DEFAULT_SETTINGS;
  const safeCustomEngines = opts.includeCustomEngines && Array.isArray(s.customEngines)
    ? s.customEngines
        .filter((e) => e && !isPrivateSiteUrl(String(e.url || '').replace(/%s/g, 'test')))
        .map((e) => ({
          id: e.id,
          name: e.name,
          url: stripUrlCredentials(String(e.url || '').replace(/%s/g, '__MIRO_QUERY__')).replaceAll('__MIRO_QUERY__', '%s'),
          bang: e.bang || '',
          color: e.color || '#4c8dff',
          isCustom: true
        }))
        .filter((e) => e.url && e.url.includes('%s'))
    : [];

  const allowedEngineIds = new Set([
    ...SEARCH_ENGINES.map((e) => e.id),
    ...safeCustomEngines.map((e) => e.id)
  ]);

  const safeSettings = {
    theme: s.theme,
    wallpaper: s.wallpaper?.type === 'custom' ? { type: 'gradient', id: 'miro-prism' } : deepClone(s.wallpaper),
    wallpaperBlur: s.wallpaperBlur,
    wallpaperDim: s.wallpaperDim,
    iconSize: s.iconSize,
    iconRadius: s.iconRadius,
    iconGap: s.iconGap,
    gridMaxWidth: s.gridMaxWidth,
    showLabels: s.showLabels,
    openInNewTab: s.openInNewTab,
    clock24: s.clock24,
    showSeconds: s.showSeconds,
    showLunar: s.showLunar,
    clockStyle: s.clockStyle,
    clockSize: s.clockSize,
    clockWeight: s.clockWeight,
    searchEngine: allowedEngineIds.has(s.searchEngine) ? s.searchEngine : 'bing',
    customEngines: safeCustomEngines,
    hiddenEngines: [...(s.hiddenEngines || [])],
    searchSuggest: s.searchSuggest,
    searchHistory: s.searchHistory,
    searchPredict: false,
    searchNewTab: s.searchNewTab,
    thirdPartyIconFallback: false,
    thirdPartyIconProvider: s.thirdPartyIconProvider || 'duckduckgo',
    minimal: s.minimal,
    sidebarAutoHide: s.sidebarAutoHide,
    wheelSwitchGroup: s.wheelSwitchGroup
  };

  const safeGroups = [];
  (state.groups || []).forEach((g, idx) => {
    const nextItems = [];
    for (const it of g.items || []) {
      if (it.type === 'site') {
        const safeSite = sanitizeShareSite(it, opts);
        if (safeSite) nextItems.push(safeSite);
      } else if (it.type === 'folder') {
        const safeChildren = (it.children || [])
          .map((c) => sanitizeShareSite(c, opts))
          .filter(Boolean);
        if (safeChildren.length >= 1) {
          const folderObj = {
            id: it.id || uid('f'),
            type: 'folder',
            title: opts.keepTitles && it.title ? String(it.title).slice(0, 40) : '文件夹',
            children: safeChildren
          };
          if (it.col !== undefined) folderObj.col = it.col;
          if (it.row !== undefined) folderObj.row = it.row;
          nextItems.push(folderObj);
        }
      } else if (it.type === 'widget') {
        const widgetObj = { id: it.id, type: 'widget', widget: it.widget, size: it.size };
        if (it.col !== undefined) widgetObj.col = it.col;
        if (it.row !== undefined) widgetObj.row = it.row;
        nextItems.push(widgetObj);
      }
    }
    const rawName = typeof g.name === 'string' ? g.name.trim() : '';
    const safeName = opts.keepTitles || VALID_GROUP_NAMES_DEFAULT.has(rawName) ? (rawName || `分组 ${idx + 1}`) : `分组 ${idx + 1}`;
    safeGroups.push({
      id: g.id,
      name: safeName,
      icon: g.icon || 'home',
      items: nextItems
    });
  });

  const activeGroupId = safeGroups.some((g) => g.id === state.activeGroupId)
    ? state.activeGroupId
    : (safeGroups[0]?.id || null);

  return JSON.stringify({
    app: 'MiroTab',
    exportedAt: new Date().toISOString(),
    version: 1,
    groups: safeGroups,
    activeGroupId,
    settings: safeSettings,
    widgetData: {},
    searchHistory: []
  }, null, 2);
}

function resolveEngineDisplay(engineId, customEngines = []) {
  const customs = sanitizeCustomEngines(customEngines);
  const all = [...SEARCH_ENGINES, ...customs];
  const found = all.find((e) => e.id === engineId) || SEARCH_ENGINES[0];
  let host = '';
  try {
    host = new URL(found.url.replace(/%s/g, 'test')).hostname;
  } catch {}
  return { id: found.id, name: found.name, host, isCustom: !!found.isCustom };
}

export function inspectBackup(json) {
  if (typeof json === 'string' && new Blob([json]).size > MAX_BACKUP_BYTES) {
    throw new Error('备份文件过大（超过 5MB 限制）');
  }
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

  const currentEng = resolveEngineDisplay(state.settings?.searchEngine, state.settings?.customEngines);
  const nextEng = hasSettings
    ? resolveEngineDisplay(data.settings.searchEngine || DEFAULT_SETTINGS.searchEngine, data.settings.customEngines)
    : currentEng;
  const searchEngineChange = {
    changed: hasSettings && (nextEng.id !== currentEng.id || nextEng.host !== currentEng.host),
    fromName: currentEng.name,
    fromHost: currentEng.host,
    toName: nextEng.name,
    toHost: nextEng.host,
    isCustom: nextEng.isCustom
  };

  return {
    valid: true,
    data,
    searchEngineChange,
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
  if (typeof json === 'string' && new Blob([json]).size > MAX_BACKUP_BYTES) {
    throw new Error('备份文件过大（超过 5MB 限制）');
  }
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('文件格式不正确');
  const opts = {
    groups: modules?.groups !== false,
    settings: modules?.settings !== false,
    widgetData: modules?.widgetData !== false,
    searchHistory: modules?.searchHistory !== false
  };
  if (opts.groups && !Array.isArray(data.groups)) {
    throw new Error('备份文件中缺少有效的分组数据');
  }
  if (opts.settings) {
    validateImportSettings(data.settings);
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
  resetEpoch += 1;
  clearTimeout(saveTimer);
  clearTimeout(pruneTimer);
  invalidatePendingIconTasks();

  const [iconRes, wpRes] = await Promise.allSettled([
    clearAllCachedIcons(),
    clearAllWallpapers()
  ]);
  const iconsCleared = iconRes.status === 'fulfilled';
  const wallpapersCleared = wpRes.status === 'fulfilled';

  const next = normalize(null);
  next.settings = deepClone(DEFAULT_SETTINGS);
  Object.assign(state, next);

  let storageReset = true;
  const errors = [];
  if (!iconsCleared) errors.push('图标缓存清理失败');
  if (!wallpapersCleared) errors.push('壁纸缓存清理失败');
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    storageReset = false;
    errors.push('本地配置写入失败');
  }
  clearTimeout(pruneTimer);
  for (const fn of listeners) fn('all');
  return {
    ok: iconsCleared && wallpapersCleared && storageReset,
    iconsCleared,
    wallpapersCleared,
    storageReset,
    errors
  };
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
