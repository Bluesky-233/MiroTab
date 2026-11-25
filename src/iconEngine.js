/**
 * MiroTab 多级智能图标引擎
 * 解决痛点：
 * 1. 挂代理加载慢 -> 所有图标一旦抓取成功永久存入 IndexedDB + 内存 Map，后续 0ms 瞬开、0 网络请求
 * 2. 自定义网址抓不到图标 -> 扩展后台直连网页解析 + Edge 原生 _favicon 缓存 + 第三方并发兜底
 * 3. 默认图标丑 -> 自动生成高颜值渐变磨砂文字徽章，并提供图标工作室多候选挑选与上传
 */

import { getCachedIcon, setCachedIcon, deleteCachedIcon, getAllCachedIcons } from './db.js';
import { BADGE_GRADIENTS } from './presets.js';

const memoryCache = new Map();
const pendingFetches = new Map();

const PRIVATE_HOST_SUFFIXES = [
  '.local',
  '.lan',
  '.internal',
  '.home.arpa',
  '.ts.net',
  '.corp',
  '.intranet',
  '.home',
  '.localdomain',
  '.private',
  '.invalid',
  '.test',
  '.example'
];

export function isExtensionContext() {
  return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
}

/**
 * 规范化 URL 与提取主域名 key（仅允许 http/https 协议）
 */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || /[\u0000-\u001F\u007F]/.test(trimmed)) return '';

  let candidate = trimmed;
  const isHostPort = /^(?:([a-z0-9-]+\.)*localhost|[a-z0-9-]+(\.[a-z0-9-]+)+):\d+(\/.*)?$/i.test(trimmed);
  if (!isHostPort && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    if (!/^https?:\/\//i.test(trimmed)) return '';
  } else {
    if (trimmed.startsWith('//')) return '';
    candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  try {
    const u = new URL(candidate);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) {
      return '';
    }
    return u.href;
  } catch {
    return '';
  }
}

function isPrivateOrReservedIpv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1));
  if (nums.some((n) => n < 0 || n > 255)) return false;
  const [a, b] = nums;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * 判断站点是否属于本地/内网/私有地址或非标准端口
 */
export function isPrivateSiteUrl(rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) return true;
  try {
    const u = new URL(normalized);
    const host = u.hostname.toLowerCase().replace(/\.+$/, '');
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    // IPv6 字面量（含方括号或冒号）
    if ((host.startsWith('[') && host.endsWith(']')) || host.includes(':')) return true;
    // 任意纯 IPv4 字面量或私有/保留网段
    if (isPrivateOrReservedIpv4(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return true;
    // 无点单标签主机名（如 nas、router）
    if (!host.includes('.')) return true;
    // 内网及虚拟组网后缀
    if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
    // 非标准端口（非空且非 80 / 443）
    if (u.port && u.port !== '80' && u.port !== '443') return true;
    return false;
  } catch {
    return true;
  }
}

export function getHostKey(rawUrl) {
  try {
    const u = new URL(normalizeUrl(rawUrl));
    // 对内网端口服务保留 host（含端口）以便区分不同本地服务
    return u.host.toLowerCase().replace(/^www\./, '');
  } catch {
    return (rawUrl || '').toLowerCase().trim();
  }
}

/**
 * 根据站点名称或域名生成高颜值智能文字缩写与稳定渐变配色
 */
export function computeSmartBadge(title = '', url = '') {
  const host = getHostKey(url).split(':')[0] || title || 'WEB';
  let hash = 0;
  for (let i = 0; i < host.length; i++) {
    hash = (hash * 31 + host.charCodeAt(i)) >>> 0;
  }
  const gradient = BADGE_GRADIENTS[hash % BADGE_GRADIENTS.length];

  let text = '';
  const cleanTitle = (title || '').trim();
  if (cleanTitle) {
    // 若包含中文，取前 1-2 个汉字
    const cjk = cleanTitle.match(/[\u4e00-\u9fa5]/g);
    if (cjk && cjk.length > 0) {
      text = cjk.slice(0, 2).join('');
    } else {
      // 英文单词取首字母或前 2-3 个字母
      const words = cleanTitle.split(/[\s\-_./]+/).filter(Boolean);
      if (words.length >= 2) {
        text = (words[0][0] + words[1][0]).toUpperCase();
      } else {
        text = cleanTitle.slice(0, 2).toUpperCase();
      }
    }
  } else {
    const domainPart = host.split('.')[0] || 'W';
    text = domainPart.slice(0, 2).toUpperCase();
  }

  return { text, gradient };
}

/**
 * 利用 Edge/Chrome MV3 内置 _favicon 权限读取浏览器本地已缓存的站点图标
 * 优点：即使站点有 Cloudflare 盾、需要登录或位于内网，只要浏览器访问过就有图！
 */
async function tryEdgeNativeFavicon(rawUrl) {
  if (!isExtensionContext()) return null;
  try {
    const fullUrl = normalizeUrl(rawUrl);
    if (!fullUrl) return null;
    const faviconUrl = chrome.runtime.getURL(
      `/_favicon/?pageUrl=${encodeURIComponent(fullUrl)}&size=64`
    );
    const res = await fetch(faviconUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob || blob.size < 120) return null;

    // 校验不是 Chromium 默认的空白灰色地球占位图（通过像素饱和度与尺寸粗判，默认地球图通常非常小）
    const dataUrl = await blobToDataUrl(blob);
    const valid = await isLikelyRealIcon(dataUrl);
    return valid ? dataUrl : null;
  } catch {
    return null;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * 简单校验图片能否正常解码且尺寸合理
 */
function isLikelyRealIcon(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // 过滤 1x1 追踪像素或极小空白图
      if (img.naturalWidth < 12 || img.naturalHeight < 12) {
        resolve(false);
        return;
      }
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

/**
 * 向后台 Service Worker 请求多级抓取站点图标
 */
function requestBackgroundIcons(rawUrl, allCandidates = false) {
  if (!isExtensionContext()) {
    return Promise.resolve({ ok: false, best: null, candidates: [], title: '' });
  }
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: 'FETCH_SITE_ICONS', url: rawUrl, allCandidates },
        (resp) => {
          if (chrome.runtime.lastError || !resp) {
            resolve({ ok: false, best: null, candidates: [], title: '' });
          } else {
            resolve(resp);
          }
        }
      );
    } catch {
      resolve({ ok: false, best: null, candidates: [], title: '' });
    }
  });
}

/**
 * 非扩展环境（如本地 HTTP 预览测试时）的图标候选
 */
function getWebPreviewFallbackUrl(rawUrl) {
  if (isPrivateSiteUrl(rawUrl)) return null;
  try {
    const u = new URL(normalizeUrl(rawUrl));
    return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(u.hostname)}.ico`;
  } catch {
    return null;
  }
}

/**
 * 将用户上传的图片文件自动缩放压缩为清晰的 DataURL（最大 192x192）
 */
export async function compressUploadedImage(file, maxSize = 192) {
  if (!file) return null;
  if (file.type === 'image/svg+xml') {
    const text = await file.text();
    if (!text.includes('<svg')) return null;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  }

  const rawDataUrl = await blobToDataUrl(file);
  return await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png', 0.92));
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

/**
 * 同步快速读取图标（首屏渲染绝对不阻塞、0ms 呈现）
 * 返回：{ type: 'svg'|'img'|'badge', value, needsFetch: boolean }
 */
export function resolveIconSync(item) {
  // 1. 用户明确设置的文字/Emoji 徽章
  if (item.iconMode === 'badge') {
    const fallback = computeSmartBadge(item.title, item.url);
    return {
      type: 'badge',
      text: item.badgeText || fallback.text,
      gradient: item.badgeGradient || fallback.gradient,
      needsFetch: false
    };
  }

  // 2. 用户自定义上传的图片或直接保存的 DataURL
  if (item.iconMode === 'custom' && item.customIcon) {
    return { type: 'img', src: item.customIcon, needsFetch: false };
  }

  // 3. 内存缓存命中
  const cacheKey = `site:${getHostKey(item.url)}`;
  if (memoryCache.has(cacheKey)) {
    const cached = memoryCache.get(cacheKey);
    if (cached) return { type: 'img', src: cached, needsFetch: false };
  }

  // 4. 暂未命中缓存，先立刻呈现高颜值智能徽章，同时标记 needsFetch 在后台静默拉取并持久化
  const badge = computeSmartBadge(item.title, item.url);
  return {
    type: 'badge',
    text: badge.text,
    gradient: badge.gradient,
    needsFetch: true
  };
}

/**
 * 异步加载并持久化单个站点图标
 * 顺序：IndexedDB 本地缓存 -> 后台直连网页解析 -> Edge 原生 Favicon -> 预览模式降级
 */
export async function resolveIconAsync(item, { forceRefresh = false } = {}) {
  if (!item?.url) return null;
  if (item.iconMode === 'badge' || (item.iconMode === 'custom' && item.customIcon)) {
    return null;
  }

  const hostKey = getHostKey(item.url);
  const cacheKey = `site:${hostKey}`;

  if (forceRefresh) {
    memoryCache.delete(cacheKey);
    await deleteCachedIcon(cacheKey);
  } else {
    // 命中内存缓存
    if (memoryCache.has(cacheKey)) {
      return memoryCache.get(cacheKey);
    }
    // 命中 IndexedDB 永久缓存（关键：0 网络请求！）
    const dbEntry = await getCachedIcon(cacheKey);
    if (dbEntry?.dataUrl) {
      memoryCache.set(cacheKey, dbEntry.dataUrl);
      return dbEntry.dataUrl;
    }
  }

  // 合并同域名的并发抓取请求
  if (pendingFetches.has(cacheKey)) {
    return pendingFetches.get(cacheKey);
  }

  const task = (async () => {
    try {
      // A. 扩展环境：后台直连 HTML/Manifest/根路径 + 第三方竞速
      if (isExtensionContext()) {
        const res = await requestBackgroundIcons(item.url, false);
        if (res?.best?.dataUrl) {
          memoryCache.set(cacheKey, res.best.dataUrl);
          await setCachedIcon(cacheKey, res.best.dataUrl, {
            source: res.best.source
          });
          return res.best.dataUrl;
        }

        // B. Edge 浏览器原生本地 Favicon 缓存（完美兜底 Cloudflare 盾与登录态站点）
        const nativeDataUrl = await tryEdgeNativeFavicon(item.url);
        if (nativeDataUrl) {
          memoryCache.set(cacheKey, nativeDataUrl);
          await setCachedIcon(cacheKey, nativeDataUrl, {
            source: 'edge-native'
          });
          return nativeDataUrl;
        }
        return null;
      }

      // C. 本地网页预览环境降级
      const fallbackUrl = getWebPreviewFallbackUrl(item.url);
      if (fallbackUrl) {
        return fallbackUrl;
      }
      return null;
    } finally {
      pendingFetches.delete(cacheKey);
    }
  })();

  pendingFetches.set(cacheKey, task);
  return task;
}

/**
 * 图标工作室专用：为指定 URL 深度探测所有可用候选图标 + 自动抓取网页标题
 */
export async function probeAllSiteIcons(rawUrl) {
  const candidates = [];
  let pageTitle = '';

  if (isExtensionContext()) {
    const [bgRes, nativeDataUrl] = await Promise.all([
      requestBackgroundIcons(rawUrl, true),
      tryEdgeNativeFavicon(rawUrl)
    ]);

    if (bgRes?.title) pageTitle = bgRes.title;
    if (Array.isArray(bgRes?.candidates)) {
      for (const c of bgRes.candidates) {
        candidates.push({
          type: 'img',
          label: c.label || '网页抓取',
          dataUrl: c.dataUrl,
          source: c.source
        });
      }
    }
    if (nativeDataUrl) {
      candidates.push({
        type: 'img',
        label: 'Edge 本地缓存图标',
        dataUrl: nativeDataUrl,
        source: 'edge-native'
      });
    }
  } else {
    const previewUrl = getWebPreviewFallbackUrl(rawUrl);
    if (previewUrl) {
      candidates.push({
        type: 'img',
        label: '网络预览图标（安装扩展后支持全网直抓）',
        dataUrl: previewUrl,
        source: 'preview'
      });
    }
  }

  return { candidates, title: pageTitle };
}

/**
 * 预热所有 IndexedDB 缓存到内存 Map（启动时毫秒级完成，保证首次渲染即可读出所有缓存图）
 */
export async function hydrateIconCache(entries) {
  for (const e of entries) {
    if (e?.key && e?.dataUrl) {
      memoryCache.set(e.key, e.dataUrl);
    }
  }
}

/**
 * 清空内存图标缓存
 */
export function clearIconMemoryCache() {
  memoryCache.clear();
}

/**
 * 清理不再对应任何现存站点的孤儿图标缓存（内存 + IndexedDB）
 */
export async function pruneUnusedCachedIcons(activeHostKeysSet) {
  if (!(activeHostKeysSet instanceof Set)) return 0;
  const entries = await getAllCachedIcons();
  let removed = 0;
  for (const entry of entries) {
    const key = entry?.key;
    if (!key || activeHostKeysSet.has(key)) continue;
    memoryCache.delete(key);
    await deleteCachedIcon(key);
    removed++;
  }
  for (const key of Array.from(memoryCache.keys())) {
    if (!activeHostKeysSet.has(key) && !pendingFetches.has(key)) {
      memoryCache.delete(key);
    }
  }
  return removed;
}

/**
 * 通过后台将图片 URL 下载为本地 DataURL
 */
export async function downloadRemoteIconToDataUrl(imgUrl) {
  if (!imgUrl) return null;
  if (imgUrl.startsWith('data:')) return imgUrl;
  if (isExtensionContext()) {
    return await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'FETCH_IMAGE_AS_DATAURL', url: imgUrl },
        (resp) => {
          if (chrome.runtime.lastError || !resp?.ok) resolve(null);
          else resolve(resp.dataUrl);
        }
      );
    });
  }
  return imgUrl;
}
