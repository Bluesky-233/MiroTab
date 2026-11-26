/**
 * MiroTab Background Service Worker (Manifest V3)
 * 职责：
 * 1. 跨域直连目标网站抓取 HTML、Manifest 与高清 Favicon（自动复用浏览器代理/内网网络）
 * 2. 下载图标并转为 DataURL，返回前端持久化至 IndexedDB
 * 3. 代理多源竞速降级获取图标，解决代理/防爬站点抓取失败问题
 * 4. 点击扩展图标时打开新标签页
 */

import { SUPPORTED_SUGGEST_PROVIDERS, fetchSuggestByProvider } from './src/suggestProviders.js';

const FETCH_TIMEOUT_MS = 6500;
const IMAGE_TIMEOUT_MS = 5000;
const SUGGEST_TIMEOUT_MS = 2400;

chrome.action?.onClicked?.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (_sender?.id && _sender.id !== chrome.runtime.id) return false;
  if (!message || !message.type) return false;

  if (message.type === 'FETCH_SITE_ICONS') {
    handleFetchSiteIcons(message.url, {
      allCandidates: !!message.allCandidates,
      allowThirdParty: !!message.allowThirdParty,
      thirdPartyProvider: String(message.thirdPartyProvider || 'duckduckgo'),
      useRootUrl: message.useRootUrl !== false
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message.type === 'FETCH_IMAGE_AS_DATAURL') {
    let policy = {};
    try {
      const u = new URL(String(message.url || ''));
      const isPrivate = isPrivateOrLocalHost(u.hostname);
      policy = {
        targetIsPrivate: isPrivate,
        targetOrigin: u.origin,
        requireSameOrigin: isPrivate,
        sourceProtocol: u.protocol
      };
    } catch {}
    fetchImageAsDataUrl(message.url, IMAGE_TIMEOUT_MS, policy)
      .then((dataUrl) => sendResponse({ ok: !!dataUrl, dataUrl }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message.type === 'FETCH_BING_WALLPAPER') {
    handleFetchBingWallpaper(Number(message.idx) || 0)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message.type === 'FETCH_SEARCH_SUGGEST') {
    handleFetchSearchSuggest(String(message.engineId || 'bing'), String(message.query || ''))
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, suggestions: [], error: String(err?.message || err) }));
    return true;
  }

  return false;
});

function isHttpUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isDisallowedPublicTarget(u) {
  if (!u) return true;
  if (isPrivateOrLocalHost(u.hostname) || isIpLiteral(u.hostname)) return true;
  return Boolean(u.port && u.port !== '80' && u.port !== '443');
}

function isAllowedResourceUrl(rawUrl, policy = {}) {
  const {
    targetIsPrivate = false,
    targetOrigin = '',
    requireSameOrigin = false,
    sourceProtocol = 'https:',
    allowedHostnames = null
  } = policy;
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (allowedHostnames && !allowedHostnames.has(normalizeHostname(u.hostname))) {
    return false;
  }
  if (targetIsPrivate) {
    return !!targetOrigin && u.origin === targetOrigin;
  }
  if (isDisallowedPublicTarget(u)) return false;
  if (requireSameOrigin && targetOrigin && u.origin !== targetOrigin) return false;
  if (sourceProtocol === 'https:' && targetOrigin && u.origin !== targetOrigin && u.protocol !== 'https:') {
    return false;
  }
  return true;
}

/**
 * 带超时与手动重定向校验的安全 fetch（防止公网页面重定向到内网或内网跨源访问）
 */
async function safeFetch(rawUrl, options = {}, timeoutMs = FETCH_TIMEOUT_MS, policy = {}, maxRedirects = 3) {
  let currentUrl = rawUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (!isAllowedResourceUrl(currentUrl, policy)) return null;
      const res = await fetch(currentUrl, {
        ...options,
        signal: controller.signal,
        redirect: 'manual',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-cache'
      });
      if (REDIRECT_STATUSES.has(res.status)) {
        const loc = res.headers.get('location');
        if (!loc || hop === maxRedirects) return null;
        let nextUrl;
        try {
          nextUrl = new URL(loc, currentUrl).href;
        } catch {
          return null;
        }
        currentUrl = nextUrl;
        continue;
      }
      return { res, finalUrl: currentUrl };
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 将 Blob 转为 DataURL
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 校验并下载单张图片为 DataURL
 */
async function fetchImageAsDataUrl(imageUrl, timeoutMs = IMAGE_TIMEOUT_MS, policy = {}) {
  if (!imageUrl || !isHttpUrl(imageUrl)) return null;
  try {
    const fetched = await safeFetch(imageUrl, {
      headers: {
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    }, timeoutMs, policy);
    const res = fetched?.res;
    if (!res || !res.ok) return null;

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    // 排除明显返回 HTML 错误页的情况
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      return null;
    }

    const blob = await res.blob();
    if (!blob || blob.size < 45 || blob.size > 2.5 * 1024 * 1024) {
      return null;
    }

    // 针对 SVG 或未知类型做头部检查
    if (contentType.includes('svg') || imageUrl.toLowerCase().includes('.svg')) {
      const text = await blob.text();
      if (!text.includes('<svg')) return null;
      const svgBlob = new Blob([text], { type: 'image/svg+xml' });
      return await blobToDataUrl(svgBlob);
    }

    // 检查魔数，防止伪装成图片的文本页
    const headBuf = await blob.slice(0, 16).arrayBuffer();
    const bytes = new Uint8Array(headBuf);
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
    const isIco = bytes[0] === 0x00 && bytes[1] === 0x00 && (bytes[2] === 0x01 || bytes[2] === 0x02);
    const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    const isBmp = bytes[0] === 0x42 && bytes[1] === 0x4d;
    const isSvgStart = bytes[0] === 0x3c; // '<'

    if (!(isPng || isJpg || isGif || isIco || isWebp || isBmp || isSvgStart)) {
      return null;
    }

    // 如果是 XML/SVG 文本
    if (isSvgStart) {
      const text = await blob.text();
      if (!text.includes('<svg')) return null;
      return await blobToDataUrl(new Blob([text], { type: 'image/svg+xml' }));
    }

    // 确保有正确的 MIME
    let mime = blob.type;
    if (!mime || mime === 'application/octet-stream' || mime === 'text/plain') {
      if (isPng) mime = 'image/png';
      else if (isJpg) mime = 'image/jpeg';
      else if (isWebp) mime = 'image/webp';
      else if (isGif) mime = 'image/gif';
      else if (isIco) mime = 'image/x-icon';
      else if (isBmp) mime = 'image/bmp';
    }

    const normalizedBlob = mime && mime !== blob.type ? new Blob([blob], { type: mime }) : blob;
    return await blobToDataUrl(normalizedBlob);
  } catch {
    return null;
  }
}

/**
 * 解析 HTML 标签属性（纯正则轻量解析，兼容 Service Worker 无 DOMParser）
 */
function parseTagAttributes(tagStr) {
  const attrs = {};
  const attrRe = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m;
  while ((m = attrRe.exec(tagStr)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

/**
 * 解析 sizes 属性为最大边像素值，如 "180x180" -> 180, "any" -> 512
 */
function parseSizeScore(sizes = '') {
  const s = sizes.toLowerCase().trim();
  if (!s) return 0;
  if (s === 'any') return 512;
  let max = 0;
  for (const part of s.split(/\s+/)) {
    const m = part.match(/^(\d+)x(\d+)$/);
    if (m) {
      max = Math.max(max, parseInt(m[1], 10), parseInt(m[2], 10));
    }
  }
  return max;
}

/**
 * 解析网页 HTML 中的所有图标候选项与标题
 */
function extractCandidatesFromHtml(html, baseUrl, policy = {}) {
  const candidates = [];
  const seen = new Set();

  // 提取标题
  let title = '';
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].replace(/\s+/g, ' ').trim();
  }

  // 解析 <base href="...">（仅允许同源 base）
  let resolvedBase = baseUrl;
  const baseTagMatch = html.match(/<base\b[^>]*>/i);
  if (baseTagMatch) {
    const baseAttrs = parseTagAttributes(baseTagMatch[0]);
    if (baseAttrs.href) {
      try {
        const nextBase = new URL(baseAttrs.href, baseUrl).href;
        if (isAllowedResourceUrl(nextBase, { ...policy, requireSameOrigin: true })) {
          resolvedBase = nextBase;
        }
      } catch {}
    }
  }

  let manifestUrl = null;

  // 解析所有 <link ...>
  const linkRe = /<link\b[^>]*>/gi;
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    const attrs = parseTagAttributes(match[0]);
    const rel = (attrs.rel || '').toLowerCase();
    const href = (attrs.href || '').trim();
    if (!href) continue;

    let absUrl;
    try {
      absUrl = new URL(href, resolvedBase).href;
    } catch {
      continue;
    }
    if (!isHttpUrl(absUrl)) continue;

    if (rel === 'manifest') {
      if (isAllowedResourceUrl(absUrl, { ...policy, requireSameOrigin: true })) {
        manifestUrl = absUrl;
      }
      continue;
    }

    const isAppleTouch = rel.includes('apple-touch-icon');
    const isIcon = rel.split(/\s+/).includes('icon') || rel.includes('shortcut icon') || rel.includes('fluid-icon');
    const isMaskIcon = rel.includes('mask-icon');

    if (isAppleTouch || isIcon || isMaskIcon) {
      if (!isAllowedResourceUrl(absUrl, policy)) continue;
      if (seen.has(absUrl)) continue;
      seen.add(absUrl);

      const sizeScore = parseSizeScore(attrs.sizes);
      const isSvg = (attrs.type || '').toLowerCase().includes('svg') || absUrl.toLowerCase().includes('.svg');
      const isPng = (attrs.type || '').toLowerCase().includes('png') || absUrl.toLowerCase().includes('.png');

      let priority = 50;
      let label = '网页图标';
      if (isSvg && !isMaskIcon) {
        priority = 120;
        label = '高清 SVG';
      } else if (isAppleTouch) {
        priority = 100 + Math.min(sizeScore, 256) / 10;
        label = sizeScore ? `Apple 图标 (${sizeScore}px)` : 'Apple 高清图标';
      } else if (isIcon) {
        priority = 70 + (isPng ? 15 : 0) + Math.min(sizeScore, 256) / 10;
        label = sizeScore ? `网页图标 (${sizeScore}px)` : '网页图标';
      } else if (isMaskIcon) {
        priority = 40;
        label = '单色矢量图标';
      }

      candidates.push({ url: absUrl, priority, label, source: 'html' });
    }
  }

  // 解析 og:image / msapplication-TileImage 作为备选
  const metaRe = /<meta\b[^>]*>/gi;
  while ((match = metaRe.exec(html)) !== null) {
    const attrs = parseTagAttributes(match[0]);
    const prop = (attrs.property || attrs.name || '').toLowerCase();
    const content = (attrs.content || '').trim();
    if (!content) continue;
    if (prop === 'msapplication-tileimage') {
      try {
        const absUrl = new URL(content, resolvedBase).href;
        if (isAllowedResourceUrl(absUrl, policy) && !seen.has(absUrl)) {
          seen.add(absUrl);
          candidates.push({ url: absUrl, priority: 78, label: '瓷贴图标', source: 'meta' });
        }
      } catch {}
    }
  }

  return { candidates, title, manifestUrl };
}

/**
 * 解析 Web App Manifest 里的 icons
 */
async function extractManifestIcons(manifestUrl, policy = {}) {
  if (!manifestUrl) return [];
  try {
    const fetched = await safeFetch(manifestUrl, {}, 4000, { ...policy, requireSameOrigin: true });
    const res = fetched?.res;
    if (!res || !res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.icons)) return [];
    return data.icons
      .filter((ic) => ic && ic.src)
      .map((ic) => {
        try {
          const absUrl = new URL(ic.src, fetched.finalUrl || manifestUrl).href;
          if (!isAllowedResourceUrl(absUrl, policy)) return null;
          const sz = parseSizeScore(ic.sizes || '');
          return {
            url: absUrl,
            priority: 95 + Math.min(sz, 256) / 10,
            label: sz ? `应用图标 (${sz}px)` : 'PWA 应用图标',
            source: 'manifest'
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

const PRIVATE_DOMAIN_SUFFIXES = [
  '.localhost', '.local', '.lan', '.internal', '.home.arpa', '.ts.net',
  '.localdomain', '.intranet', '.corp', '.home', '.private', '.invalid',
  '.test', '.example'
];

function normalizeHostname(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/\.+$/, '');
}

function isIpLiteral(hostname) {
  const h = normalizeHostname(hostname);
  if (!h) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  return h.replace(/^\[|\]$/g, '').includes(':');
}

function isPrivateIpv4(h) {
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (octets.some((n) => n < 0 || n > 255)) return true;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

/**
 * 判断是否是局域网 / 本地 / 保留地址（不对公网第三方接口发送内网或保留域名）
 */
function isPrivateOrLocalHost(hostname) {
  const h = normalizeHostname(hostname);
  if (!h) return true;

  const bare = h.replace(/^\[|\]$/g, '').split('%')[0];
  if (bare.includes(':')) {
    const v4Mapped = bare.match(/^(?:::ffff:|(?:0+:){5}ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/i);
    if (v4Mapped) return isPrivateOrLocalHost(v4Mapped[1]);
    const hexMapped = bare.match(/^(?:::ffff:|(?:0+:){5}ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return isPrivateOrLocalHost(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
    }
    if (bare === '::1' || bare === '::' || /^(0+:){7}0*1?$/.test(bare)) return true;
    if (/^f[cd][0-9a-f]{2}:/i.test(bare) || /^fe[89ab][0-9a-f]:/i.test(bare)) return true;
    return false;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return isPrivateIpv4(h);
  if (h === 'localhost' || PRIVATE_DOMAIN_SUFFIXES.some((s) => h.endsWith(s))) return true;
  if (!h.includes('.')) return true;
  return false;
}

/**
 * 核心多级智能抓取流程
 */
async function handleFetchSiteIcons(
  rawUrl,
  {
    allCandidates = false,
    allowThirdParty = false,
    thirdPartyProvider = 'duckduckgo',
    useRootUrl = true
  } = {}
) {
  let targetUrl;
  try {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed || trimmed.startsWith('//')) return { best: null, candidates: [], title: '' };
    const isHostPort = /^(?:([a-z0-9-]+\.)*localhost|[a-z0-9-]+(\.[a-z0-9-]+)+):\d+(\/.*)?$/i.test(trimmed);
    const normalized = (!isHostPort && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) ? trimmed : `https://${trimmed}`;
    targetUrl = new URL(normalized);
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return { best: null, candidates: [], title: '' };
    }
    targetUrl.username = '';
    targetUrl.password = '';
  } catch {
    return { best: null, candidates: [], title: '' };
  }

  const origin = targetUrl.origin;
  const hostname = targetUrl.hostname;
  const isPrivate = isPrivateOrLocalHost(hostname);
  const hasNonStandardPort = Boolean(targetUrl.port && targetUrl.port !== '80' && targetUrl.port !== '443');
  const allowThirdPartyHost = !isPrivate && !isIpLiteral(hostname) && !hasNonStandardPort;
  const resourcePolicy = {
    targetIsPrivate: isPrivate,
    targetOrigin: origin,
    requireSameOrigin: isPrivate,
    sourceProtocol: targetUrl.protocol
  };
  const fetchPageUrl = useRootUrl ? `${origin}/` : targetUrl.href;

  const directCandidates = [];
  const seenUrls = new Set();
  const pushCandidate = (item) => {
    if (!item || !item.url || !isAllowedResourceUrl(item.url, resourcePolicy) || seenUrls.has(item.url)) return;
    seenUrls.add(item.url);
    directCandidates.push(item);
  };

  let pageTitle = '';

  // 第 1 级：直接抓取目标站点页面 HTML（默认仅请求根地址，避免发送私有路径或查询参数）
  try {
    const fetched = await safeFetch(fetchPageUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, FETCH_TIMEOUT_MS, resourcePolicy);
    const res = fetched?.res;

    if (res && res.ok) {
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('html') || ct.includes('xml') || !ct) {
        const html = (await res.text()).slice(0, 120000); // 只读取前 120KB 头部足够解析
        const baseForHtml = fetched.finalUrl || fetchPageUrl;
        let finalPolicy = resourcePolicy;
        try {
          const fu = new URL(baseForHtml);
          finalPolicy = {
            targetIsPrivate: isPrivate || isPrivateOrLocalHost(fu.hostname),
            targetOrigin: fu.origin,
            requireSameOrigin: isPrivate,
            sourceProtocol: fu.protocol
          };
        } catch {}
        const parsed = extractCandidatesFromHtml(html, baseForHtml, finalPolicy);
        pageTitle = parsed.title;
        parsed.candidates.forEach(pushCandidate);

        if (parsed.manifestUrl) {
          const manifestIcons = await extractManifestIcons(parsed.manifestUrl, finalPolicy);
          manifestIcons.forEach(pushCandidate);
        }
      }
    }
  } catch {
    // 网页直连超时或失败时，静默进入后续路径
  }

  // 第 2 级：站点标准根目录常见路径（非常适合内网服务、NAS、路由器、精简站点）
  pushCandidate({ url: `${origin}/apple-touch-icon.png`, priority: 66, label: '站点 Apple 图标', source: 'root' });
  pushCandidate({ url: `${origin}/favicon.svg`, priority: 65, label: '站点 SVG 图标', source: 'root' });
  pushCandidate({ url: `${origin}/favicon.png`, priority: 62, label: '站点 PNG 图标', source: 'root' });
  pushCandidate({ url: `${origin}/favicon.ico`, priority: 55, label: '站点默认图标', source: 'root' });

  directCandidates.sort((a, b) => b.priority - a.priority);

  // 第 3 级：仅当用户主动开启第三方图标兜底、且目标为标准端口公网域名时，只请求选定的单一服务
  const cleanHost = normalizeHostname(hostname);
  const thirdPartyMap = {
    duckduckgo: {
      url: `https://icons.duckduckgo.com/ip3/${encodeURIComponent(cleanHost)}.ico`,
      priority: 42,
      label: 'DuckDuckGo 图标源',
      source: 'thirdparty',
      host: 'icons.duckduckgo.com'
    },
    google: {
      url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(cleanHost)}&sz=128`,
      priority: 40,
      label: 'Google 高清图标源',
      source: 'thirdparty',
      host: 'www.google.com'
    },
    yandex: {
      url: `https://favicon.yandex.net/favicon/v2/${encodeURIComponent(`https://${cleanHost}`)}?size=120&stub=1`,
      priority: 38,
      label: 'Yandex 图标源',
      source: 'thirdparty',
      host: 'favicon.yandex.net'
    }
  };
  const selectedTp = (allowThirdParty && allowThirdPartyHost) ? thirdPartyMap[thirdPartyProvider] : null;
  const thirdPartyCandidates = selectedTp ? [selectedTp] : [];

  // 如果是「图标工作室」模式：先并发验证前 8 个直连候选，仅在用户开启第三方兜底且直连全失败时尝试所选第三方
  if (allCandidates) {
    const topSlice = directCandidates.slice(0, 8);
    const results = await Promise.all(
      topSlice.map(async (c) => {
        const dataUrl = await fetchImageAsDataUrl(c.url, 4200, resourcePolicy);
        return dataUrl ? { ...c, dataUrl } : null;
      })
    );
    const valid = [];
    const seenData = new Set();
    for (const r of results) {
      if (!r) continue;
      const sig = `${r.dataUrl.length}:${r.dataUrl.slice(0, 200)}`;
      if (seenData.has(sig)) continue;
      seenData.add(sig);
      valid.push(r);
    }
    if (!valid.length && thirdPartyCandidates.length) {
      for (const c of thirdPartyCandidates) {
        const tpPolicy = {
          targetIsPrivate: false,
          targetOrigin: new URL(c.url).origin,
          requireSameOrigin: false,
          sourceProtocol: 'https:'
        };
        const dataUrl = await fetchImageAsDataUrl(c.url, 4200, tpPolicy);
        if (dataUrl) {
          valid.push({ ...c, dataUrl });
          break;
        }
      }
    }
    return { best: valid[0] || null, candidates: valid, title: pageTitle };
  }

  // 自动静默抓取模式：先分批尝试全部直连候选，全失败后且用户开启兜底时才尝试选定第三方
  for (let i = 0; i < directCandidates.length; i += i === 0 ? 4 : 6) {
    const batch = directCandidates.slice(i, i + (i === 0 ? 4 : 6));
    const timeout = i === 0 ? 4000 : 3800;
    const batchResults = await Promise.all(
      batch.map(async (c) => {
        const dataUrl = await fetchImageAsDataUrl(c.url, timeout, resourcePolicy);
        return dataUrl ? { ...c, dataUrl } : null;
      })
    );
    const bestDirect = batchResults.find(Boolean);
    if (bestDirect) {
      return { best: bestDirect, candidates: [bestDirect], title: pageTitle };
    }
  }

  for (const c of thirdPartyCandidates) {
    const tpPolicy = {
      targetIsPrivate: false,
      targetOrigin: new URL(c.url).origin,
      requireSameOrigin: false,
      sourceProtocol: 'https:'
    };
    const dataUrl = await fetchImageAsDataUrl(c.url, 3800, tpPolicy);
    if (dataUrl) {
      const hit = { ...c, dataUrl };
      return { best: hit, candidates: [hit], title: pageTitle };
    }
  }

  return { best: null, candidates: [], title: pageTitle };
}

/**
 * 直接从微软官方 Bing API 获取每日高清壁纸（支持往期 0~7 天）
 */
async function handleFetchBingWallpaper(idx = 0) {
  const safeIdx = Math.max(0, Math.min(7, idx));
  const bingPolicy = {
    targetIsPrivate: false,
    targetOrigin: 'https://cn.bing.com',
    requireSameOrigin: false,
    sourceProtocol: 'https:',
    allowedHostnames: new Set(['cn.bing.com', 'www.bing.com'])
  };
  const endpoints = [
    `https://cn.bing.com/HPImageArchive.aspx?format=js&idx=${safeIdx}&n=1&mkt=zh-CN`,
    `https://www.bing.com/HPImageArchive.aspx?format=js&idx=${safeIdx}&n=1&mkt=en-US`
  ];

  for (const apiUrl of endpoints) {
    try {
      const fetchedApi = await safeFetch(apiUrl, {}, 7000, bingPolicy);
      const res = fetchedApi?.res;
      if (!res || !res.ok) continue;
      const json = await res.json();
      const img = json?.images?.[0];
      if (!img) continue;

      const host = apiUrl.startsWith('https://cn.bing.com') ? 'https://cn.bing.com' : 'https://www.bing.com';
      const rel = img.urlbase ? `${img.urlbase}_1920x1080.jpg` : img.url;
      const imageUrl = rel.startsWith('http') ? rel : `${host}${rel}`;
      const title = img.title || img.copyright || '必应每日壁纸';

      // 直接转为 DataURL 返回给前端缓存到 IndexedDB，保证下次 0ms 瞬开
      const fetchedImg = await safeFetch(imageUrl, {}, 12000, bingPolicy);
      const imgRes = fetchedImg?.res;
      if (imgRes && imgRes.ok) {
        const blob = await imgRes.blob();
        if (blob && blob.size > 10000) {
          const dataUrl = await blobToDataUrl(blob);
          return { ok: true, dataUrl, imageUrl, title, enddate: img.enddate || '' };
        }
      }
      return { ok: true, dataUrl: null, imageUrl, title, enddate: img.enddate || '' };
    } catch {
      // 尝试下一个微软官方节点
    }
  }
  return { ok: false, error: '无法连接微软必应壁纸服务' };
}

/**
 * 搜索预测：严格仅请求当前搜索引擎自身接口，不跨厂商回退
 */
async function handleFetchSearchSuggest(engineId, rawQuery) {
  const query = rawQuery.trim();
  if (!query || !SUPPORTED_SUGGEST_PROVIDERS.has(engineId)) {
    return { ok: true, suggestions: [] };
  }

  const result = await fetchSuggestByProvider(engineId, encodeURIComponent(query), SUGGEST_TIMEOUT_MS);
  if (result.ok) {
    return { ok: true, suggestions: result.list, provider: engineId };
  }
  return { ok: false, suggestions: [] };
}
