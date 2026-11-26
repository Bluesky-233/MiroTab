/**
 * 搜索预测模块：扩展页前端直连多引擎联想（零 SW 冷启动/重载依赖）+ 后台兜底 + 本地预览 JSONP + TTL 缓存
 */
import { isExtensionContext } from './iconEngine.js';
import { hasSuggestPermission } from './permissions.js';
import {
  SUPPORTED_SUGGEST_PROVIDERS,
  cleanSuggestions,
  fetchSuggestByProvider
} from './suggestProviders.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 80;
const DIRECT_TIMEOUT_MS = 2400;
const predictCache = new Map();

function getCacheKey(engineId, query) {
  return `${engineId || 'bing'}:${query.trim().toLowerCase()}`;
}

export function getCachedPredictions(engineId, query) {
  const clean = (query || '').trim();
  if (!clean) return null;
  const key = getCacheKey(engineId, clean);
  const hit = predictCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    predictCache.delete(key);
    return null;
  }
  return hit.list;
}

function setCachedPredictions(engineId, query, list) {
  if (!Array.isArray(list)) return;
  const key = getCacheKey(engineId, query);
  if (predictCache.has(key)) predictCache.delete(key);
  predictCache.set(key, { list, ts: Date.now() });
  if (predictCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = predictCache.keys().next().value;
    if (oldestKey !== undefined) predictCache.delete(oldestKey);
  }
}

export function clearPredictionCache() {
  predictCache.clear();
}

async function fetchDirectInExtension(engineId, query, signal = null) {
  if (!SUPPORTED_SUGGEST_PROVIDERS.has(engineId)) {
    return { ok: true, aborted: false, list: [] };
  }
  return fetchSuggestByProvider(engineId, encodeURIComponent(query), DIRECT_TIMEOUT_MS, signal);
}

function fetchViaBackground(engineId, query) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve({ ok: false, list: [] });
      }
    }, 3500);
    try {
      chrome.runtime.sendMessage(
        { type: 'FETCH_SEARCH_SUGGEST', engineId, query },
        (resp) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError || !resp?.ok || !Array.isArray(resp.suggestions)) {
            resolve({ ok: false, list: [] });
          } else {
            resolve({ ok: true, list: cleanSuggestions(resp.suggestions) });
          }
        }
      );
    } catch {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, list: [] });
      }
    }
  });
}

/**
 * 获取搜索预测候选词：仅在开关开启、未中止且已获主机权限时请求当前引擎，中止时阻止后台重试
 */
export async function fetchSearchPredictions(engineId, query, { signal = null, isEnabled = () => true } = {}) {
  const clean = (query || '').trim();
  if (!clean || !isExtensionContext() || signal?.aborted || !isEnabled()) return [];
  if (!SUPPORTED_SUGGEST_PROVIDERS.has(engineId)) return [];

  const cached = getCachedPredictions(engineId, clean);
  if (cached) return cached;

  const allowed = await hasSuggestPermission(engineId);
  if (!allowed || signal?.aborted || !isEnabled()) return [];

  let res = await fetchDirectInExtension(engineId, clean, signal);
  if (res.aborted || signal?.aborted || !isEnabled()) {
    return [];
  }
  if (!res.ok) {
    res = await fetchViaBackground(engineId, clean);
  }
  if (signal?.aborted || !isEnabled()) {
    return [];
  }

  if (res.ok) {
    setCachedPredictions(engineId, clean, res.list);
  }
  return res.list;
}

/**
 * 筛选并补齐最多 limit 条预测：去重、跳过与当前输入完全一致的原词，不足时用历史记录补位
 */
export function selectTopPredictions(rawSuggestions, query, historyList = [], limit = 6) {
  const qClean = (query || '').trim();
  const qLower = qClean.toLowerCase();
  if (!qLower) return [];

  const result = [];
  const seen = new Set();

  const tryPush = (text) => {
    if (result.length >= limit || typeof text !== 'string') return;
    const trimmed = text.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (key === qLower || seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  };

  if (Array.isArray(rawSuggestions)) {
    for (const item of rawSuggestions) tryPush(item);
  }

  if (result.length < limit && Array.isArray(historyList) && historyList.length) {
    const matched = historyList.filter((h) => {
      if (typeof h !== 'string') return false;
      const lower = h.trim().toLowerCase();
      return lower && lower !== qLower && lower.includes(qLower);
    });
    matched.sort((a, b) => {
      const aPrefix = a.trim().toLowerCase().startsWith(qLower) ? 0 : 1;
      const bPrefix = b.trim().toLowerCase().startsWith(qLower) ? 0 : 1;
      return aPrefix - bPrefix;
    });
    for (const item of matched) tryPush(item);
  }

  return result;
}
