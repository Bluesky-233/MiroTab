/**
 * 聚合搜索栏：多引擎切换、Tab 快捷键、最近搜索历史、实时搜索预测与站内已添加网址直达
 */
import { state, commit, subscribe, addSearchHistory, removeSearchHistory, clearSearchHistory } from './store.js';
import { normalizeUrl } from './iconEngine.js';
import { getCachedPredictions, fetchSearchPredictions, selectTopPredictions } from './searchSuggest.js';
import { getActiveEngines, evaluateExpression, parseBangQuery, matchSite } from './searchTools.js';
import { openEnginesModal } from './extraModals.js';
import { toast } from './modals.js';

const MAX_HISTORY_DISPLAY = 6;
const MAX_PREDICT_DISPLAY = 6;
const MAX_SITE_MATCH_DISPLAY = 5;
const PREDICT_DEBOUNCE_MS = 100;

const HOST_LOCALHOST_RE = /^([a-z0-9-]+\.)*localhost(:\d+)?(\/.*)?$/i;
const HOST_IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/;
const HOST_IPV6_RE = /^\[[0-9a-f:]+\](:\d+)?(\/.*)?$/i;
const HOST_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i;

/**
 * 判断输入是否为网址、内网地址、算式/指令、邮箱/凭证或疑似密钥，命中时跳过远程联想请求
 */
function shouldSkipRemotePredict(rawQuery) {
  const q = String(rawQuery || '').trim();
  if (!q) return true;
  if (/^[=!！]/.test(q) || evaluateExpression(q)) return true;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(q) || /^www\./i.test(q)) return true;
  if (!/\s/.test(q)) {
    if (HOST_LOCALHOST_RE.test(q) || HOST_IPV4_RE.test(q) || HOST_IPV6_RE.test(q) || HOST_DOMAIN_RE.test(q)) {
      return true;
    }
    if (q.includes('@') || /^\S{32,}$/.test(q)) return true;
  }
  return false;
}

const ICON_HISTORY = '<svg class="suggest-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const ICON_SEARCH = '<svg class="suggest-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const ICON_LINK = '<svg class="suggest-icon" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const ICON_CALC = '<svg class="suggest-icon" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7h8M8 12h2M12 12h4M8 16h2M12 16h4"/></svg>';
const ICON_BANG = '<svg class="suggest-icon" viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>';

export function focusSearchInput() {
  const input = document.getElementById('search-input');
  if (!input) return;
  input.focus();
  input.select();
}

export function initSearch() {
  const engineBtn = document.getElementById('engine-btn');
  const engineIcon = document.getElementById('engine-icon');
  const engineMenu = document.getElementById('engine-menu');
  const input = document.getElementById('search-input');
  const goBtn = document.getElementById('search-go');
  const suggestList = document.getElementById('suggest-list');

  let activeIdx = -1;
  let currentItems = [];
  let mode = 'none'; // 'none' | 'history' | 'predict'
  let menuOpen = false;
  let rawInputBeforeNav = '';
  let debounceTimer = null;
  let predictSeq = 0;

  const getEngines = () => getActiveEngines(state.settings);
  const getEngine = () => {
    const list = getEngines();
    return list.find((e) => e.id === state.settings.searchEngine) || list[0];
  };

  const hideMenus = () => {
    clearTimeout(debounceTimer);
    predictSeq += 1;
    engineMenu.classList.add('hidden');
    suggestList.classList.add('hidden');
    menuOpen = false;
    mode = 'none';
    activeIdx = -1;
    currentItems = [];
  };

  const openUrl = (url) => {
    if (!url) return;
    if (state.settings.searchNewTab) window.open(url, '_blank', 'noopener,noreferrer');
    else window.location.href = url;
  };

  const copyCalcValue = async (calc) => {
    const text = String(calc.value);
    try {
      await navigator.clipboard?.writeText?.(text);
    } catch {}
    toast(`已复制计算结果：${calc.formatted}`);
  };

  const doSearch = (raw, engineOverride = null) => {
    const q = (raw ?? input.value).trim();
    if (!q) return;

    if (!engineOverride) {
      const calc = evaluateExpression(q);
      if (calc) {
        copyCalcValue(calc);
        return;
      }
      const bangRes = parseBangQuery(q, getEngines());
      if (bangRes?.matched) {
        if (bangRes.query) {
          doSearch(bangRes.query, bangRes.engine);
        } else {
          state.settings.searchEngine = bangRes.engine.id;
          commit('settings');
          renderEngine();
          input.value = '';
          hideMenus();
          toast(`已切换搜索引擎为 ${bangRes.engine.name}`);
        }
        return;
      }
    }

    hideMenus();
    // 拦截危险或本地敏感协议，既不跳转也不记入历史或外发搜索
    if (/^(javascript|data|vbscript|file|ftp|sftp|ssh|chrome|edge|about):/i.test(q)) {
      return;
    }
    // 直接输入网址或内网地址时直连跳转，不记入搜索词历史
    const isDirectUrl =
      /^https?:\/\//i.test(q) ||
      (!/\s/.test(q) &&
        (HOST_LOCALHOST_RE.test(q) ||
          HOST_IPV4_RE.test(q) ||
          HOST_IPV6_RE.test(q) ||
          HOST_DOMAIN_RE.test(q)));
    if (isDirectUrl) {
      const safeUrl = normalizeUrl(/^https?:\/\//i.test(q) ? q : `https://${q}`);
      if (safeUrl) {
        openUrl(safeUrl);
        return;
      }
    }
    if (state.settings.searchHistory !== false) addSearchHistory(q);
    input.value = q;
    const eng = engineOverride || getEngine();
    openUrl(eng.url.replace('%s', encodeURIComponent(q)));
  };

  const getMatchingSites = (qLower) => {
    if (!qLower || !state.settings.searchSuggest) return [];
    const sites = [];
    for (const g of state.groups) {
      for (const it of g.items) {
        if (it.type === 'site') sites.push(it);
        if (it.type === 'folder') sites.push(...it.children);
      }
    }
    const seen = new Set();
    const matched = [];
    for (const s of sites) {
      if (seen.has(s.url)) continue;
      if (matchSite(s, qLower)) {
        seen.add(s.url);
        matched.push({ type: 'site', title: s.title || '', url: s.url });
        if (matched.length >= MAX_SITE_MATCH_DISPLAY) break;
      }
    }
    return matched;
  };

  const updateActiveHighlight = () => {
    const rows = suggestList.querySelectorAll('li.suggest-item');
    rows.forEach((row) => {
      row.classList.toggle('active', Number(row.dataset.idx) === activeIdx);
    });
  };

  const renderDropdown = ({ headTitle = '', showClear = false, items = [], siteItems = [], calcItem = null, bangItems = [], query = '' }) => {
    const specialItems = [...(calcItem ? [calcItem] : []), ...bangItems];
    currentItems = [...specialItems, ...items, ...siteItems];
    if (!currentItems.length) {
      suggestList.classList.add('hidden');
      suggestList.innerHTML = '';
      activeIdx = -1;
      return;
    }

    suggestList.innerHTML = '';

    if (calcItem) {
      const li = document.createElement('li');
      li.className = `suggest-item suggest-calc${activeIdx === 0 ? ' active' : ''}`;
      li.dataset.idx = '0';
      li.innerHTML = `${ICON_CALC}<span class="suggest-text">= <b>${escapeHtml(calcItem.calc.formatted)}</b></span><small class="suggest-meta">点击或回车复制结果</small>`;
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        copyCalcValue(calcItem.calc);
      });
      suggestList.appendChild(li);
    }

    bangItems.forEach((bItem, bIdx) => {
      const idx = (calcItem ? 1 : 0) + bIdx;
      const li = document.createElement('li');
      li.className = `suggest-item suggest-bang${idx === activeIdx ? ' active' : ''}`;
      li.dataset.idx = String(idx);
      const tag = escapeHtml(bItem.engine.bang || bItem.engine.id);
      if (bItem.type === 'bang-run') {
        li.innerHTML = `${ICON_BANG}<span class="suggest-text">使用 <b>${escapeHtml(bItem.engine.name)}</b> 搜索：${escapeHtml(bItem.query)}</span><code class="suggest-bang-pill">!${tag}</code>`;
      } else {
        li.innerHTML = `${ICON_BANG}<span class="suggest-text">${escapeHtml(bItem.engine.name)}</span><code class="suggest-bang-pill">!${tag}</code>`;
      }
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        if (bItem.type === 'bang-run') {
          doSearch(bItem.query, bItem.engine);
        } else {
          input.value = `!${bItem.engine.bang || bItem.engine.id} `;
          input.focus();
          showPredictions(input.value, { immediate: true });
        }
      });
      suggestList.appendChild(li);
    });

    if (items.length && headTitle) {
      const head = document.createElement('li');
      head.className = `suggest-head${specialItems.length ? ' with-sep' : ''}`;
      head.innerHTML = `<span>${escapeHtml(headTitle)}</span>${showClear ? '<button type="button" class="suggest-clear-btn">清空</button>' : ''}`;
      if (showClear) {
        const clearBtn = head.querySelector('.suggest-clear-btn');
        clearBtn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        clearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          clearSearchHistory();
          hideMenus();
        });
      }
      suggestList.appendChild(head);
    }

    const baseOffset = specialItems.length;
    items.forEach((item, j) => {
      const idx = baseOffset + j;
      const li = document.createElement('li');
      li.className = `suggest-item${idx === activeIdx ? ' active' : ''}`;
      li.dataset.idx = String(idx);
      if (item.type === 'history') {
        li.innerHTML = `${ICON_HISTORY}<span class="suggest-text">${escapeHtml(item.query)}</span><button type="button" class="suggest-del" title="删除记录">${ICON_CLOSE}</button>`;
        const delBtn = li.querySelector('.suggest-del');
        delBtn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeSearchHistory(item.query);
          showHistory();
        });
      } else {
        li.innerHTML = `${ICON_SEARCH}<span class="suggest-text">${highlightQuery(item.query, query)}</span>`;
      }
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        doSearch(item.query);
      });
      suggestList.appendChild(li);
    });

    if (siteItems.length) {
      const siteHead = document.createElement('li');
      siteHead.className = `suggest-head${(specialItems.length || items.length) ? ' with-sep' : ''}`;
      siteHead.innerHTML = '<span>已添加站点</span>';
      suggestList.appendChild(siteHead);

      siteItems.forEach((s, j) => {
        const idx = baseOffset + items.length + j;
        const li = document.createElement('li');
        li.className = `suggest-item${idx === activeIdx ? ' active' : ''}`;
        li.dataset.idx = String(idx);
        const hostLabel = s.url.replace(/^https?:\/\//, '').slice(0, 32);
        li.innerHTML = `${ICON_LINK}<span class="suggest-text">${highlightQuery(s.title || hostLabel, query)}</span><small class="suggest-meta">${escapeHtml(hostLabel)}</small>`;
        li.addEventListener('mousedown', (e) => e.preventDefault());
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          hideMenus();
          openUrl(normalizeUrl(s.url));
        });
        suggestList.appendChild(li);
      });
    }

    suggestList.classList.remove('hidden');
  };

  const showHistory = () => {
    clearTimeout(debounceTimer);
    predictSeq += 1;
    activeIdx = -1;
    rawInputBeforeNav = '';
    mode = 'history';

    if (state.settings.searchHistory === false || !state.searchHistory?.length) {
      suggestList.classList.add('hidden');
      suggestList.innerHTML = '';
      currentItems = [];
      return;
    }

    const items = state.searchHistory
      .slice(0, MAX_HISTORY_DISPLAY)
      .map((q) => ({ type: 'history', query: q }));
    renderDropdown({ headTitle: '最近搜索', showClear: true, items });
  };

  const showPredictions = (rawValue, { immediate = false } = {}) => {
    const q = (rawValue ?? input.value).trim();
    if (!q) {
      showHistory();
      return;
    }

    clearTimeout(debounceTimer);
    const seq = ++predictSeq;
    activeIdx = -1;
    rawInputBeforeNav = rawValue ?? input.value;
    mode = 'predict';

    const calc = evaluateExpression(q);
    if (calc) {
      renderDropdown({
        calcItem: { type: 'calc', calc },
        siteItems: getMatchingSites(q.toLowerCase()),
        query: q
      });
      return;
    }

    const bangRes = parseBangQuery(q, getEngines());
    if (bangRes) {
      const bangItems = bangRes.matched && bangRes.query
        ? [{ type: 'bang-run', engine: bangRes.engine, query: bangRes.query }]
        : (bangRes.matched ? [bangRes.engine] : bangRes.candidates).slice(0, 8).map((engine) => ({
            type: 'bang-hint',
            engine
          }));
      const siteItems = bangRes.matched && bangRes.query ? getMatchingSites(bangRes.query.toLowerCase()) : [];
      renderDropdown({ bangItems, siteItems, query: bangRes.query || q });
      return;
    }

    const siteItems = getMatchingSites(q.toLowerCase());
    if (state.settings.searchPredict === false) {
      renderDropdown({ items: [], siteItems, query: q });
      return;
    }

    const engId = getEngine().id;
    const historyList = state.settings.searchHistory !== false ? (state.searchHistory || []) : [];
    if (shouldSkipRemotePredict(q)) {
      const localMatches = selectTopPredictions([], q, historyList, MAX_PREDICT_DISPLAY);
      renderDropdown({
        headTitle: localMatches.length ? '搜索预测' : '',
        items: localMatches.map((text) => ({ type: 'predict', query: text })),
        siteItems,
        query: q
      });
      return;
    }

    const cached = getCachedPredictions(engId, q);
    if (cached) {
      const predictions = selectTopPredictions(cached, q, historyList, MAX_PREDICT_DISPLAY);
      renderDropdown({
        headTitle: predictions.length ? '搜索预测' : '',
        items: predictions.map((text) => ({ type: 'predict', query: text })),
        siteItems,
        query: q
      });
      return;
    }

    const localFallback = selectTopPredictions([], q, historyList, MAX_PREDICT_DISPLAY);
    if (localFallback.length || siteItems.length) {
      renderDropdown({
        headTitle: localFallback.length ? '搜索预测' : '',
        items: localFallback.map((text) => ({ type: 'predict', query: text })),
        siteItems,
        query: q
      });
    } else {
      suggestList.classList.add('hidden');
      suggestList.innerHTML = '';
      currentItems = [];
    }

    const runFetch = async () => {
      const raw = await fetchSearchPredictions(engId, q);
      if (seq !== predictSeq || mode !== 'predict' || input.value.trim() !== q) return;
      const predictions = selectTopPredictions(raw, q, historyList, MAX_PREDICT_DISPLAY);
      renderDropdown({
        headTitle: predictions.length ? '搜索预测' : '',
        items: predictions.map((text) => ({ type: 'predict', query: text })),
        siteItems,
        query: q
      });
    };

    if (immediate) runFetch();
    else debounceTimer = setTimeout(runFetch, PREDICT_DEBOUNCE_MS);
  };

  const renderEngine = () => {
    const engines = getEngines();
    const eng = getEngine();
    engineIcon.dataset.engine = eng.id;
    engineIcon.style.background = eng.svg ? '' : eng.color;
    engineIcon.innerHTML = eng.svg || escapeHtml(eng.name.slice(0, 1));
    input.placeholder = `在 ${eng.name} 搜索（/ 聚焦、Tab 切换、= 计算、!前缀）`;

    engineMenu.innerHTML = '';
    for (const e of engines) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `engine-item${e.id === eng.id ? ' active' : ''}`;
      const iconStyle = e.svg ? '' : ` style="background:${escapeHtml(e.color || '#4c8dff')}"`;
      const bangHint = e.bang ? `<small class="engine-bang-sub">!${escapeHtml(e.bang)}</small>` : '';
      btn.innerHTML = `<span class="engine-icon" data-engine="${escapeHtml(e.id)}"${iconStyle}>${e.svg || escapeHtml(e.name.slice(0, 1))}</span><span>${escapeHtml(e.name)}</span>${bangHint}`;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.settings.searchEngine = e.id;
        commit('settings');
        renderEngine();
        hideMenus();
        input.focus();
        if (mode === 'none') {
          if (input.value.trim()) showPredictions(input.value, { immediate: true });
          else showHistory();
        }
      });
      engineMenu.appendChild(btn);
    }

    const mgrBtn = document.createElement('button');
    mgrBtn.type = 'button';
    mgrBtn.className = 'engine-manage-btn';
    mgrBtn.textContent = '管理搜索引擎（自定义 / 隐藏）';
    mgrBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      hideMenus();
      openEnginesModal();
    });
    engineMenu.appendChild(mgrBtn);
  };

  engineBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = engineMenu.classList.contains('hidden');
    hideMenus();
    if (opening) {
      engineMenu.classList.remove('hidden');
      menuOpen = true;
    }
  });

  goBtn.addEventListener('click', () => doSearch());

  const openSuggestOnActivate = () => {
    if (menuOpen) {
      engineMenu.classList.add('hidden');
      menuOpen = false;
    }
    const q = input.value.trim();
    if (!q) {
      if (mode !== 'history' || suggestList.classList.contains('hidden')) showHistory();
    } else if (mode !== 'predict' || suggestList.classList.contains('hidden')) {
      showPredictions(input.value, { immediate: true });
    }
  };

  input.addEventListener('focus', openSuggestOnActivate);
  input.addEventListener('click', openSuggestOnActivate);

  input.addEventListener('compositionend', () => {
    if (!input.value.trim()) showHistory();
    else showPredictions(input.value, { immediate: true });
  });

  input.addEventListener('input', () => {
    if (!input.value.trim()) showHistory();
    else showPredictions(input.value);
  });

  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      const engines = getEngines();
      const idx = Math.max(0, engines.findIndex((x) => x.id === state.settings.searchEngine));
      const nextIdx = e.shiftKey
        ? (idx - 1 + engines.length) % engines.length
        : (idx + 1) % engines.length;
      state.settings.searchEngine = engines[nextIdx].id;
      commit('settings');
      renderEngine();
      if (mode === 'predict' && input.value.trim()) showPredictions(input.value, { immediate: true });
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestList.classList.contains('hidden')) {
        if (input.value.trim()) showPredictions(input.value, { immediate: true });
        else showHistory();
        return;
      }
      if (!currentItems.length) return;
      if (e.key === 'ArrowDown') activeIdx = activeIdx >= currentItems.length - 1 ? -1 : activeIdx + 1;
      else activeIdx = activeIdx <= -1 ? currentItems.length - 1 : activeIdx - 1;

      const selected = activeIdx >= 0 ? currentItems[activeIdx] : null;
      input.value = selected && (selected.type === 'history' || selected.type === 'predict')
        ? selected.query
        : rawInputBeforeNav;
      updateActiveHighlight();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const selected = activeIdx >= 0 ? currentItems[activeIdx] : null;
      if (selected?.type === 'site') {
        hideMenus();
        openUrl(normalizeUrl(selected.url));
      } else if (selected?.type === 'calc') {
        copyCalcValue(selected.calc);
      } else if (selected?.type === 'bang-run') {
        doSearch(selected.query, selected.engine);
      } else if (selected?.type === 'bang-hint') {
        input.value = `!${selected.engine.bang || selected.engine.id} `;
        showPredictions(input.value, { immediate: true });
      } else if (selected) {
        doSearch(selected.query);
      } else {
        doSearch();
      }
      return;
    }
    if (e.key === 'Escape') {
      const hadOverlay = menuOpen || !suggestList.classList.contains('hidden');
      if (activeIdx >= 0) input.value = rawInputBeforeNav;
      hideMenus();
      if (hadOverlay) e.stopPropagation();
    }
  });

  const onOutsidePointerAction = (e) => {
    if (!e.target?.isConnected || e.target.closest('#search')) return;
    hideMenus();
  };
  document.addEventListener('click', onOutsidePointerAction);
  document.addEventListener('contextmenu', onOutsidePointerAction, true);

  subscribe((scope) => {
    if (scope === 'settings' || scope === 'all') renderEngine();
  });

  renderEngine();
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function highlightQuery(text = '', query = '') {
  const raw = String(text);
  const q = String(query).trim();
  if (!q) return escapeHtml(raw);
  const lowerRaw = raw.toLowerCase();
  const lowerQ = q.toLowerCase();
  let idx = 0;
  let out = '';
  while (idx < raw.length) {
    const hit = lowerRaw.indexOf(lowerQ, idx);
    if (hit === -1) {
      out += escapeHtml(raw.slice(idx));
      break;
    }
    if (hit > idx) out += escapeHtml(raw.slice(idx, hit));
    out += `<mark class="suggest-hl">${escapeHtml(raw.slice(hit, hit + q.length))}</mark>`;
    idx = hit + q.length;
  }
  return out;
}
