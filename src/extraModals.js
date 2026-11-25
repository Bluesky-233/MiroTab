/**
 * 扩展弹窗模块：搜索引擎管理（自定义 / 隐藏）与分模块备份恢复
 */
import { state, commit, inspectBackup, importState } from './store.js';
import { SEARCH_ENGINES, uid } from './presets.js';
import { getActiveEngines, sanitizeCustomEngineUrl } from './searchTools.js';
import { createModal, closeModal, toast, escapeHtml } from './modals.js';

export function openEnginesModal() {
  const modal = createModal({
    title: '管理搜索引擎',
    wide: true,
    bodyHtml: `
      <div class="field">
        <label>内置搜索引擎（取消勾选可从切换列表隐藏，右侧为 !bang 快捷前缀）</label>
        <div id="eng-builtin-list" class="eng-mgr-grid"></div>
      </div>
      <div class="field">
        <label>自定义搜索引擎</label>
        <div id="eng-custom-list" class="eng-custom-list"></div>
      </div>
      <div class="field eng-add-box">
        <label>添加自定义搜索引擎</label>
        <div class="field-row">
          <input id="eng-add-name" class="input" maxlength="20" placeholder="名称，如 SearXNG / MDN" style="flex:1.1;" />
          <input id="eng-add-bang" class="input" maxlength="10" placeholder="快捷前缀，如 mdn" style="flex:0.7;" />
          <input id="eng-add-color" type="color" value="#4c8dff" class="eng-color-input" title="图标底色" />
        </div>
        <div class="field-row">
          <input id="eng-add-url" class="input" placeholder="搜索 URL（用 %s 代表关键词，如 https://developer.mozilla.org/zh-CN/search?q=%s）" />
          <button type="button" class="btn primary sm" id="eng-add-btn" style="flex:none;">添加</button>
        </div>
      </div>
    `,
    footHtml: `<button type="button" class="btn primary" id="eng-done">完成</button>`
  });

  const builtinEl = modal.querySelector('#eng-builtin-list');
  const customEl = modal.querySelector('#eng-custom-list');

  const ensureValidCurrentEngine = () => {
    const active = getActiveEngines(state.settings);
    if (!active.some((e) => e.id === state.settings.searchEngine)) {
      state.settings.searchEngine = active[0].id;
    }
  };

  const renderLists = () => {
    const hidden = new Set(state.settings.hiddenEngines || []);
    builtinEl.innerHTML = '';
    for (const eng of SEARCH_ENGINES) {
      const visible = !hidden.has(eng.id);
      const row = document.createElement('label');
      row.className = `eng-mgr-item${visible ? '' : ' is-hidden'}`;
      row.innerHTML = `
        <input type="checkbox" ${visible ? 'checked' : ''} />
        <span class="engine-icon" style="${eng.svg ? '' : `background:${eng.color}`}">${eng.svg || escapeHtml(eng.name.slice(0, 1))}</span>
        <span class="eng-mgr-name">${escapeHtml(eng.name)}</span>
        <code class="eng-bang-tag">!${escapeHtml(eng.bang || eng.id)}</code>`;
      const cb = row.querySelector('input');
      cb.addEventListener('change', () => {
        if (!cb.checked && getActiveEngines(state.settings).length <= 1) {
          cb.checked = true;
          toast('至少保留一个可见搜索引擎');
          return;
        }
        const nextHidden = new Set(state.settings.hiddenEngines || []);
        if (cb.checked) nextHidden.delete(eng.id);
        else nextHidden.add(eng.id);
        state.settings.hiddenEngines = [...nextHidden];
        ensureValidCurrentEngine();
        commit('settings');
        renderLists();
      });
      builtinEl.appendChild(row);
    }

    const customs = state.settings.customEngines || [];
    customEl.innerHTML = '';
    if (!customs.length) {
      customEl.innerHTML = `<div class="eng-empty">暂未添加自定义搜索引擎</div>`;
    } else {
      for (const eng of customs) {
        const row = document.createElement('div');
        row.className = 'eng-custom-row';
        row.innerHTML = `
          <span class="engine-icon" style="background:${escapeHtml(eng.color || '#4c8dff')}">${escapeHtml(eng.name.slice(0, 1))}</span>
          <div class="eng-custom-meta">
            <div><b>${escapeHtml(eng.name)}</b>${eng.bang ? ` <code class="eng-bang-tag">!${escapeHtml(eng.bang)}</code>` : ''}</div>
            <small>${escapeHtml(eng.url)}</small>
          </div>
          <button type="button" class="btn sm danger">删除</button>`;
        row.querySelector('button').addEventListener('click', () => {
          if (getActiveEngines(state.settings).length <= 1) {
            toast('至少保留一个可见搜索引擎');
            return;
          }
          state.settings.customEngines = customs.filter((x) => x.id !== eng.id);
          ensureValidCurrentEngine();
          commit('settings');
          renderLists();
          toast(`已删除「${eng.name}」`);
        });
        customEl.appendChild(row);
      }
    }
  };

  modal.querySelector('#eng-add-btn').addEventListener('click', () => {
    const nameEl = modal.querySelector('#eng-add-name');
    const urlEl = modal.querySelector('#eng-add-url');
    const bangEl = modal.querySelector('#eng-add-bang');
    const colorEl = modal.querySelector('#eng-add-color');

    const name = nameEl.value.trim();
    const safeUrl = sanitizeCustomEngineUrl(urlEl.value);
    const bang = bangEl.value.trim().toLowerCase().replace(/^!+/, '').replace(/[^a-z0-9_-]/g, '');
    if (!name) {
      toast('请输入搜索引擎名称');
      nameEl.focus();
      return;
    }
    if (!safeUrl) {
      toast('请输入有效的 http/https 搜索 URL');
      urlEl.focus();
      return;
    }
    if (bang) {
      const conflict = getActiveEngines(state.settings).some(
        (e) => (e.bang && e.bang.toLowerCase() === bang) || e.id.toLowerCase() === bang
      );
      if (conflict) {
        toast(`快捷前缀 !${bang} 已被占用，请换一个`);
        bangEl.focus();
        return;
      }
    }

    if (!Array.isArray(state.settings.customEngines)) state.settings.customEngines = [];
    state.settings.customEngines.push({
      id: uid('ce'),
      name,
      url: safeUrl,
      bang,
      color: colorEl.value || '#4c8dff',
      isCustom: true
    });
    commit('settings');
    nameEl.value = '';
    urlEl.value = '';
    bangEl.value = '';
    renderLists();
    toast(`已添加「${name}」`);
  });

  modal.querySelector('#eng-done').addEventListener('click', closeModal);
  renderLists();
}

export function openImportBackupModal(rawText, onApplied) {
  let inspected;
  try {
    inspected = inspectBackup(rawText);
  } catch (err) {
    toast(`导入失败：${err?.message || '文件格式不正确'}`);
    return;
  }

  const { data, stats } = inspected;
  const modal = createModal({
    title: '选择性恢复备份',
    bodyHtml: `
      <div class="import-summary">
        <div>已识别备份文件：共 <b>${stats.groupCount}</b> 个分组、<b>${stats.siteCount}</b> 个网址、<b>${stats.widgetCount}</b> 个小组件</div>
        <small>勾选需要恢复的模块，未勾选模块将保持当前状态不变</small>
      </div>
      <div class="import-modules">
        <label class="bm-item${stats.hasGroups ? '' : ' is-disabled'}">
          <input type="checkbox" id="imp-groups" ${stats.hasGroups ? 'checked' : 'disabled'} />
          <span>分组与桌面图标</span>
          <small>${stats.hasGroups ? `${stats.groupCount} 个分组` : '备份中无此项'}</small>
        </label>
        <label class="bm-item${stats.hasSettings ? '' : ' is-disabled'}">
          <input type="checkbox" id="imp-settings" ${stats.hasSettings ? 'checked' : 'disabled'} />
          <span>外观与个性化设置</span>
          <small>${stats.hasSettings ? '主题、壁纸、时钟与引擎' : '备份中无此项'}</small>
        </label>
        <label class="bm-item${stats.hasWidgetData ? '' : ' is-disabled'}">
          <input type="checkbox" id="imp-widgets" ${stats.hasWidgetData ? 'checked' : 'disabled'} />
          <span>小组件数据</span>
          <small>${stats.hasWidgetData ? '便签、待办、倒数日与天气城市' : '备份中无此项'}</small>
        </label>
        <label class="bm-item${stats.hasHistory ? '' : ' is-disabled'}">
          <input type="checkbox" id="imp-history" ${stats.hasHistory ? 'checked' : 'disabled'} />
          <span>搜索历史记录</span>
          <small>${stats.hasHistory ? `${data.searchHistory.length} 条记录` : '备份中无此项'}</small>
        </label>
      </div>
    `,
    footHtml: `
      <button type="button" class="btn" id="imp-cancel">取消</button>
      <button type="button" class="btn primary" id="imp-apply">开始恢复</button>
    `
  });

  modal.querySelector('#imp-cancel').addEventListener('click', closeModal);
  modal.querySelector('#imp-apply').addEventListener('click', () => {
    const modules = {
      groups: !!modal.querySelector('#imp-groups')?.checked,
      settings: !!modal.querySelector('#imp-settings')?.checked,
      widgetData: !!modal.querySelector('#imp-widgets')?.checked,
      searchHistory: !!modal.querySelector('#imp-history')?.checked
    };
    if (!modules.groups && !modules.settings && !modules.widgetData && !modules.searchHistory) {
      toast('请至少勾选一个要恢复的模块');
      return;
    }
    try {
      importState(data, modules);
      onApplied?.();
      closeModal();
      toast('所选配置已恢复');
    } catch (err) {
      toast(`导入失败：${err?.message || '恢复出错'}`);
    }
  });
}
