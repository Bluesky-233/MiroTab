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

async function fetchJsonSuggest(url, extractor, timeoutMs = 2400, externalSignal = null) {
  if (externalSignal?.aborted) {
    return { ok: false, aborted: true, list: [] };
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onAbort, { once: true });
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
    if (!res.ok) return { ok: false, aborted: false, list: [] };
    const json = await res.json();
    return { ok: true, aborted: false, list: cleanSuggestions(extractor(json)) };
  } catch {
    return { ok: false, aborted: !!externalSignal?.aborted, list: [] };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

export async function fetchSuggestByProvider(provider, enc, timeoutMs = 2400, externalSignal = null) {
  const fastTimeout = Math.min(timeoutMs, 1800);
  switch (provider) {
    case 'bing': {
      const cn = await fetchJsonSuggest(
        `https://cn.bing.com/osjson.aspx?query=${enc}&language=zh-CN`,
        (j) => (Array.isArray(j) ? j[1] : []),
        timeoutMs,
        externalSignal
      );
      if (cn.ok || cn.aborted) return cn;
      return fetchJsonSuggest(
        `https://api.bing.com/osjson.aspx?query=${enc}&language=zh-CN`,
        (j) => (Array.isArray(j) ? j[1] : []),
        timeoutMs,
        externalSignal
      );
    }
    case 'baidu':
      return fetchJsonSuggest(
        `https://www.baidu.com/sugrec?prod=pc&wd=${enc}`,
        (j) => (Array.isArray(j?.g) ? j.g.map((x) => x?.q) : []),
        timeoutMs,
        externalSignal
      );
    case 'google':
      return fetchJsonSuggest(
        `https://suggestqueries.google.com/complete/search?client=firefox&hl=zh-CN&q=${enc}`,
        (j) => (Array.isArray(j) ? j[1] : []),
        fastTimeout,
        externalSignal
      );
    case 'youtube':
      return fetchJsonSuggest(
        `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=zh-CN&q=${enc}`,
        (j) => (Array.isArray(j) ? j[1] : []),
        fastTimeout,
        externalSignal
      );
    case 'ddg':
      return fetchJsonSuggest(
        `https://duckduckgo.com/ac/?q=${enc}&type=list`,
        (j) => (Array.isArray(j) ? j[1] : []),
        fastTimeout,
        externalSignal
      );
    case 'bilibili':
      return fetchJsonSuggest(
        `https://s.search.bilibili.com/main/suggest?term=${enc}`,
        (j) => (Array.isArray(j?.result?.tag) ? j.result.tag.map((x) => x?.value || x?.term) : []),
        timeoutMs,
        externalSignal
      );
    case 'yandex':
      return fetchJsonSuggest(
        `https://suggest.yandex.com/suggest-ff.cgi?part=${enc}`,
        (j) => (Array.isArray(j) ? j[1] : []),
        fastTimeout,
        externalSignal
      );
    default:
      return { ok: true, aborted: false, list: [] };
  }
}
