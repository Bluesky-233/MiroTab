/**
 * 扩展按需权限管理（遵循最小权限原则，所有主机与书签权限均在用户主动操作时按需申请）
 */

export const THIRD_PARTY_ICON_PROVIDERS = {
  duckduckgo: {
    id: 'duckduckgo',
    label: 'DuckDuckGo 图标源',
    origin: 'https://icons.duckduckgo.com/*'
  },
  google: {
    id: 'google',
    label: 'Google S2 图标源',
    origin: 'https://www.google.com/*'
  },
  yandex: {
    id: 'yandex',
    label: 'Yandex 图标源',
    origin: 'https://favicon.yandex.net/*'
  }
};

export const SUGGEST_PROVIDER_ORIGINS = {
  bing: ['https://cn.bing.com/*', 'https://api.bing.com/*'],
  baidu: ['https://www.baidu.com/*'],
  google: ['https://suggestqueries.google.com/*'],
  youtube: ['https://suggestqueries.google.com/*'],
  ddg: ['https://duckduckgo.com/*'],
  bilibili: ['https://s.search.bilibili.com/*'],
  yandex: ['https://suggest.yandex.com/*']
};

export const BING_WALLPAPER_ORIGINS = [
  'https://cn.bing.com/*',
  'https://www.bing.com/*'
];

function isExtensionPermissionsAvailable() {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.permissions;
}

/**
 * 提取符合 Chrome host permission 格式的 origin pattern（不可包含端口）
 */
export function getOriginPattern(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const isHostPort = /^(?:([a-z0-9-]+\.)*localhost|[a-z0-9-]+(\.[a-z0-9-]+)+):\d+(\/.*)?$/i.test(trimmed);
    const candidate = (!isHostPort && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed))
      ? trimmed
      : `https://${trimmed}`;
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (!u.hostname) return '';
    let host = u.hostname;
    if (host.includes(':') && !host.startsWith('[')) {
      host = `[${host}]`;
    }
    return `${u.protocol}//${host}/*`;
  } catch {
    return '';
  }
}

export async function hasPermissions({ permissions = [], origins = [] } = {}) {
  if (!isExtensionPermissionsAvailable()) return false;
  const cleanPerms = [...new Set(permissions.filter(Boolean))];
  const cleanOrigins = [...new Set(origins.filter(Boolean))];
  if (!cleanPerms.length && !cleanOrigins.length) return true;
  return new Promise((resolve) => {
    try {
      chrome.permissions.contains(
        {
          ...(cleanPerms.length ? { permissions: cleanPerms } : {}),
          ...(cleanOrigins.length ? { origins: cleanOrigins } : {})
        },
        (granted) => {
          if (chrome.runtime.lastError) resolve(false);
          else resolve(!!granted);
        }
      );
    } catch {
      resolve(false);
    }
  });
}

export async function requestPermissions({ permissions = [], origins = [] } = {}) {
  if (!isExtensionPermissionsAvailable()) return false;
  const cleanPerms = [...new Set(permissions.filter(Boolean))];
  const cleanOrigins = [...new Set(origins.filter(Boolean))];
  if (!cleanPerms.length && !cleanOrigins.length) return true;
  return new Promise((resolve) => {
    try {
      chrome.permissions.request(
        {
          ...(cleanPerms.length ? { permissions: cleanPerms } : {}),
          ...(cleanOrigins.length ? { origins: cleanOrigins } : {})
        },
        (granted) => {
          if (chrome.runtime.lastError) resolve(false);
          else resolve(!!granted);
        }
      );
    } catch {
      resolve(false);
    }
  });
}

export async function requestSiteFetchPermissions(urls = [], { thirdPartyProvider = '' } = {}) {
  const origins = [];
  for (const u of urls) {
    const pattern = getOriginPattern(u);
    if (pattern) origins.push(pattern);
  }
  const tp = THIRD_PARTY_ICON_PROVIDERS[thirdPartyProvider];
  if (tp?.origin) origins.push(tp.origin);
  if (!origins.length) return true;
  return requestPermissions({ origins });
}

export async function hasOriginPermission(rawUrl) {
  const pattern = getOriginPattern(rawUrl);
  if (!pattern) return false;
  return hasPermissions({ origins: [pattern] });
}

export async function hasSuggestPermission(engineId) {
  const origins = SUGGEST_PROVIDER_ORIGINS[engineId];
  if (!origins?.length) return true;
  return hasPermissions({ origins });
}

export async function requestSuggestPermission(engineId) {
  const origins = SUGGEST_PROVIDER_ORIGINS[engineId];
  if (!origins?.length) return true;
  return requestPermissions({ origins });
}

export async function hasBingWallpaperPermission() {
  return hasPermissions({ origins: BING_WALLPAPER_ORIGINS });
}

export async function requestBingWallpaperPermission() {
  return requestPermissions({ origins: BING_WALLPAPER_ORIGINS });
}

export async function hasBookmarksPermission() {
  return hasPermissions({ permissions: ['bookmarks'] });
}

export async function requestBookmarksPermission() {
  return requestPermissions({ permissions: ['bookmarks'] });
}
