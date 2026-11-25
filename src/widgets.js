/**
 * 桌面小组件渲染：日历（切月/节气/节日）、待办（编辑/排序/清理）、便签（多页签/Markdown）、
 * 天气（手动刷新/湿度/3日预报）、倒数日（多事件/重复）、模拟时钟
 */
import { state, commit } from './store.js';
import { getLunarInfo, getLunarString, getDaySubtitle } from './lunar.js';
import {
  escapeHtml,
  normalizeNotesData,
  normalizeCountdownData,
  computeNextTarget,
  renderSafeMarkdown,
  fetchWeather,
  searchCityCoords
} from './widgetHelpers.js';

export { fetchWeather, searchCityCoords };

const WEATHER_MAP = {
  0: ['☀️', '晴朗'], 1: ['🌤️', '大部晴'], 2: ['⛅', '多云'], 3: ['☁️', '阴天'],
  45: ['🌫️', '雾'], 48: ['🌫️', '冻雾'],
  51: ['🌦️', '小毛毛雨'], 53: ['🌦️', '毛毛雨'], 55: ['🌧️', '浓毛毛雨'],
  61: ['🌧️', '小雨'], 63: ['🌧️', '中雨'], 65: ['🌧️', '大雨'],
  71: ['🌨️', '小雪'], 73: ['🌨️', '中雪'], 75: ['❄️', '大雪'],
  80: ['🌦️', '阵雨'], 81: ['🌧️', '强阵雨'], 82: ['⛈️', '暴雨'],
  95: ['⛈️', '雷阵雨'], 96: ['⛈️', '雷阵雨冰雹'], 99: ['⛈️', '强雷暴']
};

function getWData(id, defaults) {
  if (!state.widgetData[id]) state.widgetData[id] = { ...defaults };
  return state.widgetData[id];
}

function lockCellDragDuringEdit(el, card) {
  el.addEventListener('mousedown', (e) => e.stopPropagation());
  el.addEventListener('focus', () => {
    const cell = card.closest('.cell');
    if (cell) cell.draggable = false;
  });
  el.addEventListener('blur', () => {
    const cell = card.closest('.cell');
    if (cell) cell.draggable = true;
  });
}

export function renderWidget(item, { onEditCountdown, onEditWeather, onCleanup } = {}) {
  const card = document.createElement('div');
  card.className = `widget-card widget-${item.widget}`;

  switch (item.widget) {
    case 'calendar':
      renderCalendar(card, item);
      break;
    case 'todo':
      renderTodo(card, item);
      break;
    case 'notes':
      renderNotes(card, item, onCleanup);
      break;
    case 'weather':
      renderWeather(card, item, onEditWeather, onCleanup);
      break;
    case 'countdown':
      renderCountdown(card, item, onEditCountdown);
      break;
    case 'clock':
      renderAnalogClock(card, onCleanup);
      break;
    default:
      card.innerHTML = `<div class="widget-head">未知组件</div>`;
  }
  return card;
}

function renderCalendar(card, item) {
  const now = new Date();
  const wk = ['日', '一', '二', '三', '四', '五', '六'];

  if (item.size === '2x1') {
    const info = getLunarInfo(now);
    const badge = info?.festival || info?.solarTerm || '';
    card.innerHTML = `
      <div class="w-cal-today" style="margin:auto 0;justify-content:space-between;">
        <div class="w-cal-today">
          <span class="w-cal-day">${now.getDate()}</span>
          <div class="w-cal-meta">
            <div>${now.getFullYear()}年${now.getMonth() + 1}月 · 星期${wk[now.getDay()]}</div>
            <div>${getLunarString(now)}${badge ? ` <span class="w-cal-tag">${escapeHtml(badge)}</span>` : ''}</div>
          </div>
        </div>
      </div>`;
    return;
  }

  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth();

  const drawMonth = () => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevTotal = new Date(viewYear, viewMonth, 0).getDate();
    const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();
    const headLunar = isCurrentMonth ? getLunarString(now) : getLunarString(new Date(viewYear, viewMonth, 1));

    let cells = wk.map((w) => `<span class="wk">${w}</span>`).join('');
    for (let i = firstDay - 1; i >= 0; i--) {
      cells += `<span class="d dim"><span class="d-num">${prevTotal - i}</span></span>`;
    }
    for (let i = 1; i <= totalDays; i++) {
      const dt = new Date(viewYear, viewMonth, i);
      const isToday = isCurrentMonth && i === now.getDate();
      const sub = getDaySubtitle(dt);
      cells += `<span class="d${isToday ? ' today' : ''}${sub.highlight ? ' is-fest' : ''}" title="${escapeHtml(getLunarString(dt))}">` +
        `<span class="d-num">${i}</span>` +
        `<span class="d-sub">${escapeHtml(sub.text)}</span>` +
        `</span>`;
    }

    card.innerHTML = `
      <div class="widget-head">
        <div class="w-cal-nav">
          <button type="button" class="widget-head-btn w-cal-prev" title="上个月">‹</button>
          <button type="button" class="w-cal-ym" title="点击回到本月">${viewYear}年${viewMonth + 1}月</button>
          <button type="button" class="widget-head-btn w-cal-next" title="下个月">›</button>
        </div>
        <span class="w-sub">${escapeHtml(headLunar)}</span>
      </div>
      <div class="w-cal-grid">${cells}</div>`;

    card.querySelector('.w-cal-prev')?.addEventListener('click', (e) => {
      e.stopPropagation();
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      drawMonth();
    });
    card.querySelector('.w-cal-next')?.addEventListener('click', (e) => {
      e.stopPropagation();
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      drawMonth();
    });
    card.querySelector('.w-cal-ym')?.addEventListener('click', (e) => {
      e.stopPropagation();
      viewYear = now.getFullYear();
      viewMonth = now.getMonth();
      drawMonth();
    });
  };
  drawMonth();
}

function renderTodo(card, item) {
  const data = getWData(item.id, {
    items: [
      { id: 't1', text: '添加常用网址到桌面', done: false },
      { id: 't2', text: '右键图标自定义样式', done: false }
    ]
  });
  if (!Array.isArray(data.items)) data.items = [];

  card.innerHTML = `
    <div class="widget-head">
      <span>待办事项</span>
      <div class="w-head-actions">
        <button type="button" class="w-text-btn w-todo-clear hidden" title="清除所有已完成项">清理已完成</button>
        <span class="w-sub"></span>
      </div>
    </div>
    <div class="w-todo-list"></div>
    <form class="w-todo-form">
      <input type="text" placeholder="添加待办，双击可编辑…" maxlength="80" />
    </form>`;

  const listEl = card.querySelector('.w-todo-list');
  const subEl = card.querySelector('.w-sub');
  const clearBtn = card.querySelector('.w-todo-clear');

  const drawList = () => {
    listEl.innerHTML = '';
    const left = data.items.filter((t) => !t.done).length;
    const doneCount = data.items.length - left;
    subEl.textContent = `${left} 项未完成`;
    clearBtn.classList.toggle('hidden', doneCount === 0);

    data.items.forEach((todo, idx) => {
      const row = document.createElement('div');
      row.className = `w-todo-item${todo.done ? ' done' : ''}`;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!todo.done;
      cb.addEventListener('change', () => {
        todo.done = cb.checked;
        commit('silent');
        drawList();
      });

      const span = document.createElement('span');
      span.textContent = todo.text;
      span.title = '双击编辑';
      span.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const editInput = document.createElement('input');
        editInput.type = 'text';
        editInput.className = 'w-todo-edit';
        editInput.maxLength = 80;
        editInput.value = todo.text;
        lockCellDragDuringEdit(editInput, card);
        row.replaceChild(editInput, span);
        editInput.focus();
        editInput.select();

        let finished = false;
        const finish = (save) => {
          if (finished) return;
          finished = true;
          const cell = card.closest('.cell');
          if (cell) cell.draggable = true;
          if (save) {
            const val = editInput.value.trim();
            if (val) todo.text = val;
            commit('silent');
          }
          drawList();
        };
        editInput.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') { ke.preventDefault(); finish(true); }
          if (ke.key === 'Escape') { ke.preventDefault(); ke.stopPropagation(); finish(false); }
        });
        editInput.addEventListener('blur', () => finish(true));
      });

      const actions = document.createElement('div');
      actions.className = 'w-todo-actions';
      if (idx > 0) {
        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'w-todo-up';
        upBtn.textContent = '↑';
        upBtn.title = '上移';
        upBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          [data.items[idx - 1], data.items[idx]] = [data.items[idx], data.items[idx - 1]];
          commit('silent');
          drawList();
        });
        actions.appendChild(upBtn);
      }
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'w-todo-del';
      del.textContent = '×';
      del.title = '删除';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        data.items = data.items.filter((x) => x.id !== todo.id);
        commit('silent');
        drawList();
      });
      actions.appendChild(del);

      row.append(cb, span, actions);
      listEl.appendChild(row);
    });
  };
  drawList();

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    data.items = data.items.filter((t) => !t.done);
    commit('silent');
    drawList();
  });

  const form = card.querySelector('form');
  const input = form.querySelector('input');
  lockCellDragDuringEdit(input, card);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    data.items.unshift({ id: `t_${Date.now()}`, text, done: false });
    input.value = '';
    commit('silent');
    drawList();
  });
}

function renderNotes(card, item, onCleanup) {
  const data = normalizeNotesData(getWData(item.id, { tabs: [{ id: 'tab_1', title: '便签 1', text: '' }], activeTabId: 'tab_1' }));
  let previewMode = !!data.preview;
  let dirtyTimer = null;

  const flushDirty = () => {
    if (dirtyTimer) {
      clearTimeout(dirtyTimer);
      dirtyTimer = null;
      commit('silent');
    }
  };
  onCleanup?.(flushDirty);

  const draw = () => {
    const activeTab = data.tabs.find((t) => t.id === data.activeTabId) || data.tabs[0];
    card.innerHTML = `
      <div class="widget-head">
        <div class="w-notes-tabs" id="nt-tabs"></div>
        <div class="w-head-actions">
          <button type="button" class="w-text-btn w-notes-mode" title="切换 Markdown 预览">${previewMode ? '编辑' : '预览'}</button>
        </div>
      </div>
      ${previewMode
        ? `<div class="w-notes-preview">${activeTab.text ? renderSafeMarkdown(activeTab.text) : '<span class="w-notes-empty">暂无内容，点击右上角「编辑」开始记录…</span>'}</div>`
        : `<textarea class="w-notes-area" placeholder="支持基础 Markdown（# 标题、**加粗**、- [ ] 待办）…"></textarea>`}`;

    const tabsEl = card.querySelector('.w-notes-tabs');
    data.tabs.forEach((tab) => {
      const wrap = document.createElement('div');
      wrap.className = `w-notes-tab${tab.id === activeTab.id ? ' active' : ''}`;
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'w-notes-tab-btn';
      label.textContent = tab.title || '便签';
      label.title = '单击切换，双击重命名';
      label.addEventListener('click', (e) => {
        e.stopPropagation();
        if (tab.id === data.activeTabId) return;
        flushDirty();
        data.activeTabId = tab.id;
        commit('silent');
        draw();
      });
      label.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const nextName = prompt('重命名便签页签', tab.title || '便签');
        if (nextName && nextName.trim()) {
          tab.title = nextName.trim().slice(0, 12);
          commit('silent');
          draw();
        }
      });
      wrap.appendChild(label);
      if (data.tabs.length > 1) {
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'w-notes-tab-del';
        closeBtn.textContent = '×';
        closeBtn.title = '删除页签';
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          flushDirty();
          data.tabs = data.tabs.filter((x) => x.id !== tab.id);
          if (data.activeTabId === tab.id) data.activeTabId = data.tabs[0].id;
          commit('silent');
          draw();
        });
        wrap.appendChild(closeBtn);
      }
      tabsEl.appendChild(wrap);
    });

    if (data.tabs.length < 6) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'w-notes-tab-add';
      addBtn.textContent = '+';
      addBtn.title = '新建便签页签';
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        flushDirty();
        const nextId = `tab_${Date.now()}`;
        data.tabs.push({ id: nextId, title: `便签 ${data.tabs.length + 1}`, text: '' });
        data.activeTabId = nextId;
        previewMode = false;
        data.preview = false;
        commit('silent');
        draw();
      });
      tabsEl.appendChild(addBtn);
    }

    card.querySelector('.w-notes-mode')?.addEventListener('click', (e) => {
      e.stopPropagation();
      flushDirty();
      previewMode = !previewMode;
      data.preview = previewMode;
      commit('silent');
      draw();
    });

    if (previewMode) {
      const previewEl = card.querySelector('.w-notes-preview');
      previewEl?.querySelectorAll('input[type="checkbox"][data-line]').forEach((cb) => {
        cb.addEventListener('change', (e) => {
          e.stopPropagation();
          const lineIdx = Number(cb.dataset.line);
          const lines = (activeTab.text || '').replace(/\r\n/g, '\n').split('\n');
          if (lines[lineIdx] !== undefined) {
            lines[lineIdx] = cb.checked
              ? lines[lineIdx].replace(/^([-*]\s+\[)\s(\])/, '$1x$2')
              : lines[lineIdx].replace(/^([-*]\s+\[)[xX](\])/, '$1 $2');
            activeTab.text = lines.join('\n');
            commit('silent');
            draw();
          }
        });
      });
    } else {
      const ta = card.querySelector('.w-notes-area');
      ta.value = activeTab.text || '';
      lockCellDragDuringEdit(ta, card);
      ta.addEventListener('input', () => {
        activeTab.text = ta.value;
        clearTimeout(dirtyTimer);
        dirtyTimer = setTimeout(() => {
          dirtyTimer = null;
          commit('silent');
        }, 250);
      });
    }
  };
  draw();
}

function renderWeather(card, item, onEditWeather, onCleanup) {
  const data = getWData(item.id, {
    city: '北京',
    lat: 39.9042,
    lon: 116.4074,
    cache: null
  });
  let loading = false;
  let activeCtrl = null;
  onCleanup?.(() => activeCtrl?.abort());

  const refreshWeather = async () => {
    if (loading || typeof data.lat !== 'number' || typeof data.lon !== 'number') return;
    loading = true;
    paint();
    activeCtrl?.abort();
    activeCtrl = new AbortController();
    const res = await fetchWeather(data.lat, data.lon, activeCtrl.signal);
    loading = false;
    if (res && card.isConnected) {
      data.cache = { ...res, at: Date.now() };
      commit('silent');
    }
    if (card.isConnected) paint();
  };

  const paint = () => {
    const c = data.cache;
    const [emoji, desc] = c ? (WEATHER_MAP[c.code] || ['🌤️', '晴']) : ['🌤️', '点击刷新'];
    const temp = c ? `${Math.round(c.temp)}°` : '--°';
    const wind = c ? `风 ${Math.round(c.wind)}km/h` : '';
    const humidity = c && Number.isFinite(c.humidity) ? `湿度 ${Math.round(c.humidity)}%` : '';
    const isSmall = item.size === '2x1';
    const daily = !isSmall && Array.isArray(c?.daily) ? c.daily.slice(0, 3) : [];
    const dayLabels = ['明', '后', '大后'];

    card.innerHTML = `
      <div class="widget-head">
        <span>${escapeHtml(data.city || '天气')}</span>
        <div class="w-head-actions">
          <button type="button" class="widget-head-btn w-wt-refresh${loading ? ' is-spin' : ''}" title="刷新天气">
            <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
          </button>
          <button type="button" class="widget-head-btn w-wt-city" title="更换城市">
            <svg viewBox="0 0 24 24"><path d="M12 20s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="9" r="2.2"/></svg>
          </button>
        </div>
      </div>
      <div class="w-weather-main${!c ? ' is-clickable' : ''}" title="${!c ? '点击刷新天气' : ''}">
        <div class="w-weather-temp" style="${isSmall ? 'font-size:28px' : ''}">${temp}</div>
        <div class="w-weather-icon" style="${isSmall ? 'font-size:26px' : ''}">${emoji}</div>
      </div>
      ${isSmall ? '' : `
        <div class="w-weather-desc">
          <span>${desc}${humidity ? ` · ${humidity}` : ''}</span>
          <span>${wind}</span>
        </div>
        ${daily.length ? `
          <div class="w-weather-daily">
            ${daily.map((d, i) => {
              const [dEmoji] = WEATHER_MAP[d.code] || ['🌤️'];
              return `<div class="w-wt-day"><span>${dayLabels[i] || ''}</span><span>${dEmoji}</span><small>${Math.round(d.min)}~${Math.round(d.max)}°</small></div>`;
            }).join('')}
          </div>` : ''}`}`;

    card.querySelector('.w-wt-refresh')?.addEventListener('click', (e) => {
      e.stopPropagation();
      refreshWeather();
    });
    card.querySelector('.w-wt-city')?.addEventListener('click', (e) => {
      e.stopPropagation();
      onEditWeather?.(item, data);
    });
    if (!c) {
      card.querySelector('.w-weather-main')?.addEventListener('click', (e) => {
        e.stopPropagation();
        refreshWeather();
      });
    }
  };

  paint();
  const stale = !data.cache || (Date.now() - (data.cache.at || 0)) > 30 * 60 * 1000;
  if (stale) refreshWeather();
}

function renderCountdown(card, item, onEditCountdown) {
  const data = normalizeCountdownData(getWData(item.id, {}));

  const paint = () => {
    const events = data.events;
    const active = events.find((ev) => ev.id === data.activeEventId) || events[0];
    const calc = computeNextTarget(active);
    const others = events.filter((ev) => ev.id !== active.id).slice(0, 2);
    const repeatTag = active.repeat === 'yearly' ? ' · 每年' : active.repeat === 'monthly' ? ' · 每月' : '';

    card.innerHTML = `
      <div class="widget-head">
        <span>倒数日</span>
        <div class="w-head-actions">
          ${events.length > 1 ? `<button type="button" class="widget-head-btn w-cd-next" title="切换下一条">↻</button>` : ''}
          <button type="button" class="widget-head-btn w-cd-edit" title="管理倒数日">
            <svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>
          </button>
        </div>
      </div>
      <div class="w-cd-body">
        <div class="w-cd-title" title="${escapeHtml(active.title)}">${escapeHtml(active.title)}</div>
        <div><span class="w-cd-unit">${calc.label}</span><span class="w-cd-num">${calc.diffDays}</span><span class="w-cd-unit">天</span></div>
      </div>
      ${item.size === '2x1' ? '' : `
        <div class="w-cd-date">目标：${escapeHtml(calc.targetStr)}${repeatTag}</div>
        ${others.length ? `
          <div class="w-cd-others">
            ${others.map((ev) => {
              const c = computeNextTarget(ev);
              return `<button type="button" class="w-cd-mini" data-ev="${escapeHtml(ev.id)}"><span>${escapeHtml(ev.title)}</span><b>${c.label}${c.diffDays}天</b></button>`;
            }).join('')}
          </div>` : ''}`}`;

    card.querySelector('.w-cd-edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      onEditCountdown?.(item, data);
    });
    card.querySelector('.w-cd-next')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = events.findIndex((ev) => ev.id === active.id);
      data.activeEventId = events[(idx + 1) % events.length].id;
      commit('silent');
      paint();
    });
    card.querySelectorAll('.w-cd-mini').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        data.activeEventId = btn.dataset.ev;
        commit('silent');
        paint();
      });
    });
  };
  paint();
}

function renderAnalogClock(card, onCleanup) {
  card.innerHTML = `
    <div class="w-clock-wrap">
      <svg class="w-clock-svg" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="54" stroke="currentColor" stroke-opacity=".18" stroke-width="2" fill="none"/>
        <path d="M60 7 l1.8 4.7 4.7 1.8-4.7 1.8-1.8 4.7-1.8-4.7-4.7-1.8 4.7-1.8z" fill="#f5b942" stroke="none"/>
        <g stroke="currentColor" stroke-opacity=".5" stroke-width="2">
          <line x1="110" y1="60" x2="103" y2="60"/>
          <line x1="60" y1="110" x2="60" y2="103"/>
          <line x1="10" y1="60" x2="17" y2="60"/>
        </g>
        <line class="hand-h" x1="60" y1="60" x2="60" y2="30" stroke="currentColor" stroke-width="3.4"/>
        <line class="hand-m" x1="60" y1="60" x2="60" y2="20" stroke="currentColor" stroke-width="2.4"/>
        <line class="hand-s" x1="60" y1="68" x2="60" y2="16" stroke="var(--miro-red, #e84545)" stroke-width="1.5"/>
        <circle cx="60" cy="60" r="4.2" fill="var(--miro-red, #e84545)" stroke="none"/>
        <circle cx="60" cy="60" r="1.6" fill="#f5b942" stroke="none"/>
      </svg>
    </div>`;

  const update = () => {
    if (!card.isConnected) return;
    const now = new Date();
    const s = now.getSeconds();
    const m = now.getMinutes() + s / 60;
    const h = (now.getHours() % 12) + m / 60;
    card.querySelector('.hand-h')?.setAttribute('transform', `rotate(${h * 30} 60 60)`);
    card.querySelector('.hand-m')?.setAttribute('transform', `rotate(${m * 6} 60 60)`);
    card.querySelector('.hand-s')?.setAttribute('transform', `rotate(${s * 6} 60 60)`);
  };
  update();
  const id = setInterval(() => {
    if (!card.isConnected) { clearInterval(id); return; }
    update();
  }, 1000);
  onCleanup?.(() => clearInterval(id));
}
