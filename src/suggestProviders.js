/**
 * 共享搜索联想数据源（供扩展页面直连与 Service Worker 兜底共用）
 */

export const SUPPORTED_SUGGEST_PROVIDERS = new Set([
  'bing', 'baidu', 'google', 'youtube', 'ddg', 'bilibili', 'yandex'
]);

export function cleanSuggestions(list) {
  if (!Array.isArray(list)) return [];
  const res = [];
  const seen = new Set();
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const text = raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    res.push(text);
    if (res.length >= 12) break;
  }
  return res;
}

async function fetchJsonSuggest(url, extractor, timeoutMs = 2400) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-cache',
      headers: { Accept: 'application/json, text/plain, */*' }
    });
    if (!res.ok) return { ok: false, list: [] };
    const json = await res.json();
    return { ok: true, list: cleanSuggestions(extractor(json)) };
  } catch {
    return { ok: false, list: [] };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSuggestByProvider(provider, enc, timeoutMs = 2400) {
  const fastTimeout = Math.min(timeoutMs, 1800);
  switch (provider) {
    case 'bing': {
      const cn = await fetchJsonSuggest(
        `https://cn.bing.com/osjson.aspx?query=${enc}&language=zh-CN`,
        (j) => (Array.isArray(j) ? j[1] : []),
        timeoutMs
      );
      if (cn.ok) return cn;
      return fetchJsonSuggest(
        `https://api.bing.com/osjson.aspx?query=${enc}&language=zh-CN`,
        (j) => (Array.isArray(j) ? j[1] : []),
        timeoutMs
      );
    }
    case 'baidu':
      return fetchJsonSuggest(
        `https://www.baidu.com/sugrec?prod=pc&wd=${enc}`,
        (j) => (Array.isArray(j?.g) ? j.g.map((x) => x?.q) : []),
        timeoutMs
      );
    case 'google':
      return fetchJsonSuggest(
        `https://suggestqueries.google.com/complete/search?client=firefox&hl=zh-CN&q=${enc}`,
        (j) => (Array.isArray(j) ? j[1] : []),
        fastTimeout
      );
    case 'youtube':
      return fetchJsonSuggest(
        `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=zh-CN&q=${enc}`,
        (j) => (Array.isArray(j) ? j[1] : []),
        fastTimeout
      );
    case 'ddg':
      return fetchJsonSuggest(
        `https://duckduckgo.com/ac/?q=${enc}&type=list`,
        (j) => (Array.isArray(j) ? j[1] : []),
        fastTimeout
      );
    case 'bilibili':
      return fetchJsonSuggest(
        `https://s.search.bilibili.com/main/suggest?term=${enc}`,
        (j) => (Array.isArray(j?.result?.tag) ? j.result.tag.map((x) => x?.value || x?.term) : []),
        timeoutMs
      );
    case 'yandex':
      return fetchJsonSuggest(
        `https://suggest.yandex.com/suggest-ff.cgi?part=${enc}`,
        (j) => (Array.isArray(j) ? j[1] : []),
        fastTimeout
      );
    default:
      return { ok: true, list: [] };
  }
}
