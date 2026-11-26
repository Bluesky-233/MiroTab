/**
 * 轻量上下文右键菜单
 */

const menuEl = () => document.getElementById('context-menu');

export function hideContextMenu() {
  const el = menuEl();
  if (el) {
    el.classList.add('hidden');
    el.innerHTML = '';
  }
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('contextmenu', (e) => {
  const el = menuEl();
  if (!el || el.classList.contains('hidden')) return;
  if (e.target?.closest?.('#context-menu')) return;
  hideContextMenu();
}, true);
window.addEventListener('blur', hideContextMenu);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const el = menuEl();
    if (el && !el.classList.contains('hidden')) {
      hideContextMenu();
      e.stopImmediatePropagation();
    }
  }
});

/**
 * items: [{ label, icon?, danger?, sep?, sizes?, currentSize?, onSize?, sub?: [{label, onClick}], onClick? }]
 */
export function showContextMenu(x, y, items) {
  const el = menuEl();
  if (!el) return;
  document.querySelectorAll('[data-sheen-active]').forEach((node) => {
    node.removeAttribute('data-sheen-active');
  });
  el.innerHTML = '';
  el.classList.remove('hidden', 'flip-sub');

  for (const it of items) {
    if (it.sep) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      el.appendChild(sep);
      continue;
    }

    if (it.sizes) {
      const row = document.createElement('div');
      row.className = 'ctx-sizes';
      for (const sz of it.sizes) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = sz;
        if (sz === it.currentSize) b.classList.add('active');
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          hideContextMenu();
          it.onSize?.(sz);
        });
        row.appendChild(b);
      }
      el.appendChild(row);
      continue;
    }

    if (it.sub) {
      const wrap = document.createElement('div');
      wrap.className = 'ctx-sub';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ctx-item';
      btn.innerHTML = `<span style="flex:1">${it.label}</span><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>`;
      const panel = document.createElement('div');
      panel.className = 'pop-menu sub-panel';
      for (const s of it.sub) {
        const sb = document.createElement('button');
        sb.type = 'button';
        sb.className = 'ctx-item';
        sb.textContent = s.label;
        sb.addEventListener('click', (e) => {
          e.stopPropagation();
          hideContextMenu();
          s.onClick?.();
        });
        panel.appendChild(sb);
      }
      wrap.append(btn, panel);
      el.appendChild(wrap);
      continue;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `ctx-item${it.danger ? ' danger' : ''}`;
    btn.textContent = it.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideContextMenu();
      it.onClick?.();
    });
    el.appendChild(btn);
  }

  // 边界防溢出定位
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  const rect = el.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + rect.width > window.innerWidth - 10) left = Math.max(8, window.innerWidth - rect.width - 10);
  if (top + rect.height > window.innerHeight - 10) top = Math.max(8, window.innerHeight - rect.height - 10);
  if (left + rect.width + 160 > window.innerWidth) el.classList.add('flip-sub');
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
