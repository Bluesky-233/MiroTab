/**
 * 小组件辅助函数：安全 Markdown 渲染、倒数日重复推算、Open-Meteo 天气与城市检索
 */

export function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

export function normalizeNotesData(data) {
  if (!Array.isArray(data.tabs) || !data.tabs.length) {
    const initText = typeof data.text === 'string' ? data.text : '';
    const firstId = 'tab_1';
    data.tabs = [{ id: firstId, title: '便签 1', text: initText }];
    data.activeTabId = firstId;
    delete data.text;
  }
  if (!data.tabs.some((t) => t.id === data.activeTabId)) {
    data.activeTabId = data.tabs[0].id;
  }
  return data;
}

export function normalizeCountdownData(data) {
  const nextYear = new Date().getFullYear() + 1;
  if (!Array.isArray(data.events) || !data.events.length) {
    data.events = [{
      id: `ev_${Date.now()}`,
      title: data.title || `${nextYear} 元旦`,
      date: data.date || `${nextYear}-01-01`,
      repeat: data.repeat || 'none'
    }];
    delete data.title;
    delete data.date;
    delete data.repeat;
  }
  if (!data.events.some((ev) => ev.id === data.activeEventId)) {
    data.activeEventId = data.events[0].id;
  }
  return data;
}

function clampDate(y, mZeroBased, day) {
  const maxDay = new Date(y, mZeroBased + 1, 0).getDate();
  return new Date(y, mZeroBased, Math.min(day, maxDay));
}

export function computeNextTarget(ev, baseToday = new Date()) {
  const today = new Date(baseToday.getFullYear(), baseToday.getMonth(), baseToday.getDate());
  const parts = String(ev?.date || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return { target: today, diffDays: 0, label: '还有', targetStr: ev?.date || '' };
  }
  const [y, m, d] = parts;
  const mIdx = Math.max(0, Math.min(11, m - 1));
  let target = clampDate(y, mIdx, d);

  if (ev.repeat === 'yearly') {
    target = clampDate(today.getFullYear(), mIdx, d);
    if (target < today) target = clampDate(today.getFullYear() + 1, mIdx, d);
  } else if (ev.repeat === 'monthly') {
    target = clampDate(today.getFullYear(), today.getMonth(), d);
    if (target < today) target = clampDate(today.getFullYear(), today.getMonth() + 1, d);
  }

  const diffDays = Math.round((target - today) / 86400000);
  const ty = target.getFullYear();
  const tm = String(target.getMonth() + 1).padStart(2, '0');
  const td = String(target.getDate()).padStart(2, '0');
  return {
    target,
    diffDays: Math.abs(diffDays),
    label: diffDays >= 0 ? '还有' : '已过',
    targetStr: `${ty}-${tm}-${td}`
  };
}

function formatInlineMd(escapedText) {
  let out = escapedText.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => (
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  ));
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return out;
}

export function renderSafeMarkdown(raw = '') {
  const lines = String(raw || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };

  lines.forEach((line, lineIdx) => {
    const escaped = escapeHtml(line);
    const taskM = escaped.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (taskM) {
      if (!inList) { html.push('<ul class="md-list">'); inList = true; }
      const checked = taskM[1].toLowerCase() === 'x';
      html.push(
        `<li class="md-task${checked ? ' is-done' : ''}">` +
        `<input type="checkbox" data-line="${lineIdx}" ${checked ? 'checked' : ''} />` +
        `<span>${formatInlineMd(taskM[2])}</span></li>`
      );
      return;
    }

    const ulM = escaped.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
    if (ulM) {
      if (!inList) { html.push('<ul class="md-list">'); inList = true; }
      html.push(`<li>${formatInlineMd(ulM[1])}</li>`);
      return;
    }

    closeList();
    const hM = escaped.match(/^(#{1,3})\s+(.*)$/);
    if (hM) {
      const lv = hM[1].length;
      html.push(`<h${lv} class="md-h${lv}">${formatInlineMd(hM[2])}</h${lv}>`);
      return;
    }
    if (escaped.startsWith('&gt; ')) {
      html.push(`<blockquote class="md-quote">${formatInlineMd(escaped.slice(5))}</blockquote>`);
      return;
    }
    if (!escaped.trim()) {
      html.push('<div class="md-gap"></div>');
      return;
    }
    html.push(`<p class="md-p">${formatInlineMd(escaped)}</p>`);
  });

  closeList();
  return html.join('');
}

export async function fetchWeather(lat, lon, externalSignal = null) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), 5500);
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4`;
    const res = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    });
    if (!res.ok) return null;
    const json = await res.json();
    const cur = json?.current;
    if (!cur) return null;
    const daily = [];
    const dates = json?.daily?.time || [];
    const codes = json?.daily?.weather_code || [];
    const maxs = json?.daily?.temperature_2m_max || [];
    const mins = json?.daily?.temperature_2m_min || [];
    for (let i = 1; i < Math.min(4, dates.length); i++) {
      daily.push({
        date: dates[i],
        code: codes[i],
        max: maxs[i],
        min: mins[i]
      });
    }
    return {
      temp: cur.temperature_2m,
      humidity: cur.relative_humidity_2m,
      code: cur.weather_code,
      wind: cur.wind_speed_10m,
      daily
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

export async function searchCityCoords(cityName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=5&language=zh&format=json`,
      {
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
      }
    );
    if (!res.ok) return [];
    const json = await res.json();
    return json?.results || [];
  } finally {
    clearTimeout(timer);
  }
}
