/**
 * 右侧设置抽屉：主题、壁纸、图标布局、时钟与搜索、本地图标缓存管理、数据导入导出
 */
import { state, commit, exportState, resetState, clearSearchHistory, MAX_BACKUP_BYTES } from './store.js';
import { GRADIENT_WALLPAPERS } from './presets.js';
import {
  getAllCachedIcons,
  clearAllCachedIcons,
  setCustomWallpaper
} from './db.js';
import { resolveIconAsync, clearIconMemoryCache } from './iconEngine.js';
import {
  THIRD_PARTY_ICON_PROVIDERS,
  requestPermissions,
  requestSiteFetchPermissions,
  requestSuggestPermission,
  requestBingWallpaperPermission
} from './permissions.js';
import { clearPredictionCache } from './searchSuggest.js';
import { closeModal, toast } from './modals.js';
import { openEnginesModal, openImportBackupModal, openCleanExportModal } from './extraModals.js';

function compressWallpaperFile(file, maxSide = 2560) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const origDataUrl = reader.result;
      if (typeof origDataUrl !== 'string') { resolve(null); return; }
      const img = new Image();
      img.onerror = () => resolve(origDataUrl);
      img.onload = () => {
        try {
          const w = img.naturalWidth || 0;
          const h = img.naturalHeight || 0;
          if (!w || !h) { resolve(origDataUrl); return; }
          const scale = Math.min(1, maxSide / Math.max(w, h));
          const tw = Math.max(1, Math.round(w * scale));
          const th = Math.max(1, Math.round(h * scale));
          if (scale === 1 && file.size < 1.2 * 1024 * 1024) {
            resolve(origDataUrl);
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = tw;
          canvas.height = th;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(origDataUrl); return; }
          ctx.drawImage(img, 0, 0, tw, th);
          let out = canvas.toDataURL('image/webp', 0.88);
          if (!out.startsWith('data:image/webp')) {
            out = canvas.toDataURL('image/jpeg', 0.88);
          }
          resolve(out && out.length < origDataUrl.length ? out : origDataUrl);
        } catch {
          resolve(origDataUrl);
        }
      };
      img.src = origDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export async function openSettingsDrawer(onWallpaperUpdated) {
  closeModal();
  const root = document.getElementById('modal-root');
  const s = state.settings;
  const cachedEntries = await getAllCachedIcons();

  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  backdrop.innerHTML = `
    <div class="drawer">
      <div class="modal-head">
        <h3>设置与个性化</h3>
        <button class="modal-close" aria-label="关闭">
          <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="modal-body">

        <div class="set-group">
          <div class="set-title">外观主题</div>
          <div class="tabs" id="set-theme">
            <button type="button" class="tab" data-v="auto">自动</button>
            <button type="button" class="tab" data-v="light">浅色</button>
            <button type="button" class="tab" data-v="dark">深色</button>
            <button type="button" class="tab" data-v="miro">Miró 画廊</button>
          </div>
          <div class="set-row">
            <span>极简模式（点击时钟可快速切换）</span>
            <label class="switch"><input type="checkbox" id="set-minimal" /><span></span></label>
          </div>
          <div class="set-row">
            <span>折叠隐藏左侧边栏（默认收起）</span>
            <label class="switch"><input type="checkbox" id="set-sb-hide" /><span></span></label>
          </div>
          <div class="set-row">
            <span>滚轮切换分组</span>
            <label class="switch"><input type="checkbox" id="set-wheel" /><span></span></label>
          </div>
        </div>

        <div class="set-group">
          <div class="set-title">壁纸背景（内置零延迟本地渐变 + 支持上传）</div>
          <div class="wp-grid" id="set-wp-grid">
            ${GRADIENT_WALLPAPERS.map((w) => `
              <div class="wp-card" data-wp="${w.id}" style="background:${w.css};">
                <span>${w.name}</span>
              </div>`).join('')}
          </div>
          <div class="field-row" style="margin-top:4px;">
            <label class="btn sm" style="flex:1;text-align:center;cursor:pointer;">
              上传本地壁纸
              <input type="file" id="set-wp-upload" accept="image/*" hidden />
            </label>
            <button type="button" class="btn sm" id="set-wp-bing" style="flex:1;">必应每日壁纸</button>
            <button type="button" class="btn sm" id="set-wp-bing-next" title="切换最近 8 天的必应精选壁纸">换一张</button>
          </div>
          <div class="set-row">
            <span>背景模糊 <small id="val-blur"></small></span>
            <input type="range" id="set-blur" min="0" max="26" />
          </div>
          <div class="set-row">
            <span>背景暗度 <small id="val-dim"></small></span>
            <input type="range" id="set-dim" min="0" max="70" />
          </div>
        </div>

        <div class="set-group">
          <div class="set-title">图标与网格布局</div>
          <div class="set-row">
            <span>图标尺寸 <small id="val-size"></small></span>
            <input type="range" id="set-size" min="48" max="86" />
          </div>
          <div class="set-row">
            <span>图标圆角 <small id="val-rad"></small></span>
            <input type="range" id="set-rad" min="8" max="50" />
          </div>
          <div class="set-row">
            <span>图标间距 <small id="val-gap"></small></span>
            <input type="range" id="set-gap" min="16" max="54" />
          </div>
          <div class="set-row">
            <span>显示图标名称</span>
            <label class="switch"><input type="checkbox" id="set-labels" /><span></span></label>
          </div>
          <div class="set-row">
            <span>新标签页打开网址</span>
            <label class="switch"><input type="checkbox" id="set-newtab" /><span></span></label>
          </div>
        </div>

        <div class="set-group">
          <div class="set-title">时钟与搜索</div>
          <div class="clock-style-grid" id="set-clock-style">
            <button type="button" class="clock-style-btn" data-v="modern">极简</button>
            <button type="button" class="clock-style-btn" data-v="miro">米罗</button>
            <button type="button" class="clock-style-btn" data-v="bold">海报</button>
            <button type="button" class="clock-style-btn" data-v="serif">衬线</button>
            <button type="button" class="clock-style-btn" data-v="flip">翻页</button>
            <button type="button" class="clock-style-btn" data-v="neon">霓虹</button>
          </div>
          <div class="set-row">
            <span>时钟大小 <small id="val-csize"></small></span>
            <input type="range" id="set-csize" min="64" max="156" />
          </div>
          <div class="set-row">
            <span>字体粗细</span>
            <div class="tabs" id="set-cweight" style="width:165px;">
              <button type="button" class="tab" data-v="200">细</button>
              <button type="button" class="tab" data-v="400">标准</button>
              <button type="button" class="tab" data-v="700">粗</button>
            </div>
          </div>
          <div class="set-row">
            <span>24 小时制</span>
            <label class="switch"><input type="checkbox" id="set-c24" /><span></span></label>
          </div>
          <div class="set-row">
            <span>显示秒数</span>
            <label class="switch"><input type="checkbox" id="set-sec" /><span></span></label>
          </div>
          <div class="set-row">
            <span>显示农历日期</span>
            <label class="switch"><input type="checkbox" id="set-lunar" /><span></span></label>
          </div>
          <div class="set-row">
            <span>显示搜索历史记录</span>
            <label class="switch"><input type="checkbox" id="set-shist" /><span></span></label>
          </div>
          <div class="set-row">
            <span>输入时向当前搜索引擎请求联想词</span>
            <label class="switch"><input type="checkbox" id="set-spred" /><span></span></label>
          </div>
          <div class="set-row">
            <span>搜索框直达已添加网址</span>
            <label class="switch"><input type="checkbox" id="set-sug" /><span></span></label>
          </div>
          <div class="set-row">
            <span>新标签页打开搜索结果</span>
            <label class="switch"><input type="checkbox" id="set-snew" /><span></span></label>
          </div>
          <button type="button" class="btn sm" id="btn-manage-engines">管理搜索引擎（自定义 / 隐藏 / !前缀）</button>
        </div>

        <div class="set-group">
          <div class="set-title">本地图标缓存（默认离线优先 · 按需抓图）</div>
          <div style="font-size:12.5px;color:var(--text-2);" id="cache-stat"></div>
          <div class="set-row">
            <span>主动抓图失败时允许第三方图标兜底</span>
            <label class="switch"><input type="checkbox" id="set-tp-icon" /><span></span></label>
          </div>
          <div class="set-row" id="set-tp-provider-row">
            <span>第三方图标服务</span>
            <select id="set-tp-provider" class="set-select">
              <option value="duckduckgo">DuckDuckGo</option>
              <option value="google">Google S2</option>
              <option value="yandex">Yandex</option>
            </select>
          </div>
          <div class="field-row">
            <button type="button" class="btn sm primary" id="btn-refresh-icons" style="flex:1;">批量重抓全部图标</button>
            <button type="button" class="btn sm" id="btn-clear-icons" style="flex:1;">清空图标缓存</button>
          </div>
        </div>

        <div class="set-group">
          <div class="set-title">数据备份与恢复</div>
          <div class="field-row">
            <button type="button" class="btn sm primary" id="btn-export-clean" style="flex:1;">导出脱敏配置</button>
            <button type="button" class="btn sm" id="btn-export-full" style="flex:1;">导出完整备份</button>
          </div>
          <div class="field-row">
            <label class="btn sm" style="flex:1;text-align:center;cursor:pointer;">
              导入备份恢复
              <input type="file" id="btn-import" accept=".json,application/json" hidden />
            </label>
            <button type="button" class="btn sm danger" id="btn-reset" style="flex:1;">恢复出厂默认配置</button>
          </div>
        </div>

      </div>
    </div>`;

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  backdrop.querySelector('.modal-close').addEventListener('click', closeModal);
  root.appendChild(backdrop);

  // 通过 DOM 属性与 textContent 安全初始化所有控件状态，避免配置值直接拼入 innerHTML
  const setRangeValue = (inputId, labelId, numVal, unit) => {
    const inp = backdrop.querySelector(inputId);
    const lbl = backdrop.querySelector(labelId);
    const safeNum = Number.isFinite(Number(numVal)) ? Number(numVal) : 0;
    if (inp) inp.value = String(safeNum);
    if (lbl) lbl.textContent = `${safeNum}${unit}`;
  };
  const updateCacheStatText = (count) => {
    const statEl = backdrop.querySelector('#cache-stat');
    if (!statEl) return;
    statEl.textContent = `当前已在本地 IndexedDB 永久缓存 ${count} 个网站高清图标`;
  };

  backdrop.querySelectorAll('#set-theme .tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.v === s.theme);
  });
  backdrop.querySelectorAll('#set-wp-grid .wp-card').forEach((card) => {
    card.classList.toggle('active', s.wallpaper?.type === 'gradient' && s.wallpaper?.id === card.dataset.wp);
  });
  backdrop.querySelectorAll('#set-clock-style .clock-style-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.v === (s.clockStyle || 'modern'));
  });
  backdrop.querySelectorAll('#set-cweight .tab').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.v) === Number(s.clockWeight || 400));
  });

  backdrop.querySelector('#set-minimal').checked = !!s.minimal;
  backdrop.querySelector('#set-sb-hide').checked = !!s.sidebarAutoHide;
  backdrop.querySelector('#set-wheel').checked = !!s.wheelSwitchGroup;
  backdrop.querySelector('#set-labels').checked = !!s.showLabels;
  backdrop.querySelector('#set-newtab').checked = !!s.openInNewTab;
  backdrop.querySelector('#set-c24').checked = !!s.clock24;
  backdrop.querySelector('#set-sec').checked = !!s.showSeconds;
  backdrop.querySelector('#set-lunar').checked = !!s.showLunar;
  backdrop.querySelector('#set-shist').checked = s.searchHistory !== false;
  backdrop.querySelector('#set-spred').checked = s.searchPredict === true;
  backdrop.querySelector('#set-sug').checked = !!s.searchSuggest;
  backdrop.querySelector('#set-snew').checked = !!s.searchNewTab;

  const tpToggle = backdrop.querySelector('#set-tp-icon');
  const tpSelect = backdrop.querySelector('#set-tp-provider');
  const tpRow = backdrop.querySelector('#set-tp-provider-row');
  tpToggle.checked = !!s.thirdPartyIconFallback;
  tpSelect.value = THIRD_PARTY_ICON_PROVIDERS[s.thirdPartyIconProvider] ? s.thirdPartyIconProvider : 'duckduckgo';
  tpRow.classList.toggle('hidden', !tpToggle.checked);

  setRangeValue('#set-blur', '#val-blur', s.wallpaperBlur, 'px');
  setRangeValue('#set-dim', '#val-dim', s.wallpaperDim, '%');
  setRangeValue('#set-size', '#val-size', s.iconSize, 'px');
  setRangeValue('#set-rad', '#val-rad', s.iconRadius, '%');
  setRangeValue('#set-gap', '#val-gap', s.iconGap, 'px');
  setRangeValue('#set-csize', '#val-csize', s.clockSize || 96, 'px');
  updateCacheStatText(cachedEntries.length);

  // 主题切换（切到 Miró 画廊时，若当前是内置渐变壁纸则自动联动米罗画室，体验最完整的画廊质感）
  backdrop.querySelectorAll('#set-theme .tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextTheme = btn.dataset.v;
      const prevTheme = s.theme;
      s.theme = nextTheme;
      backdrop.querySelectorAll('#set-theme .tab').forEach((x) => x.classList.toggle('active', x === btn));

      let wpChanged = false;
      if (nextTheme === 'miro' && s.wallpaper?.type === 'gradient' && s.wallpaper.id !== 'miro-atelier') {
        s.wallpaper = { type: 'gradient', id: 'miro-atelier' };
        wpChanged = true;
      } else if (prevTheme === 'miro' && nextTheme !== 'miro' && s.wallpaper?.type === 'gradient' && s.wallpaper.id === 'miro-atelier') {
        s.wallpaper = { type: 'gradient', id: 'miro-prism' };
        wpChanged = true;
      }
      if (wpChanged) {
        backdrop.querySelectorAll('#set-wp-grid .wp-card').forEach((x) =>
          x.classList.toggle('active', x.dataset.wp === s.wallpaper.id)
        );
      }

      commit('settings');
      if (wpChanged) onWallpaperUpdated?.();
    });
  });

  // 开关绑定辅助
  const bindToggle = (id, key, scope = 'settings') => {
    backdrop.querySelector(id).addEventListener('change', (e) => {
      s[key] = e.target.checked;
      commit(scope);
    });
  };
  bindToggle('#set-minimal', 'minimal');
  bindToggle('#set-sb-hide', 'sidebarAutoHide');
  bindToggle('#set-wheel', 'wheelSwitchGroup');
  bindToggle('#set-labels', 'showLabels');
  bindToggle('#set-newtab', 'openInNewTab', 'grid');
  bindToggle('#set-c24', 'clock24');
  bindToggle('#set-sec', 'showSeconds');
  bindToggle('#set-lunar', 'showLunar');
  backdrop.querySelector('#set-shist').addEventListener('change', (e) => {
    s.searchHistory = e.target.checked;
    if (!e.target.checked) {
      clearSearchHistory();
    }
    commit('settings');
  });
  const spredInput = backdrop.querySelector('#set-spred');
  spredInput.addEventListener('change', async (e) => {
    if (e.target.checked) {
      const granted = await requestSuggestPermission(s.searchEngine || 'bing');
      if (!granted) {
        e.target.checked = false;
        s.searchPredict = false;
        toast('未授予联想接口访问权限，已保持关闭联网搜索预测');
        commit('settings');
        return;
      }
      s.searchPredict = true;
      commit('settings');
      toast('已开启当前搜索引擎的联网联想');
      return;
    }
    s.searchPredict = false;
    clearPredictionCache();
    commit('settings');
  });
  bindToggle('#set-sug', 'searchSuggest');
  bindToggle('#set-snew', 'searchNewTab');

  tpToggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      const providerId = tpSelect.value || 'duckduckgo';
      const tp = THIRD_PARTY_ICON_PROVIDERS[providerId];
      const granted = tp ? await requestPermissions({ origins: [tp.origin] }) : false;
      if (!granted) {
        e.target.checked = false;
        s.thirdPartyIconFallback = false;
        tpRow.classList.add('hidden');
        toast('未授予第三方图标服务权限，将继续仅使用本地图标与徽章');
        commit('settings');
        return;
      }
      s.thirdPartyIconFallback = true;
      s.thirdPartyIconProvider = providerId;
      tpRow.classList.remove('hidden');
      commit('settings');
      return;
    }
    s.thirdPartyIconFallback = false;
    tpRow.classList.add('hidden');
    commit('settings');
  });

  tpSelect.addEventListener('change', async () => {
    const providerId = tpSelect.value;
    const tp = THIRD_PARTY_ICON_PROVIDERS[providerId];
    if (!tp) return;
    if (tpToggle.checked) {
      const granted = await requestPermissions({ origins: [tp.origin] });
      if (!granted) {
        tpSelect.value = s.thirdPartyIconProvider || 'duckduckgo';
        toast(`未授予 ${tp.label} 访问权限`);
        return;
      }
    }
    s.thirdPartyIconProvider = providerId;
    commit('settings');
  });

  // 滑块绑定辅助
  const bindRange = (id, valId, key, unit) => {
    const inp = backdrop.querySelector(id);
    const val = backdrop.querySelector(valId);
    inp.addEventListener('input', () => {
      s[key] = Number(inp.value);
      val.textContent = `${s[key]}${unit}`;
      commit('settings');
    });
  };
  bindRange('#set-blur', '#val-blur', 'wallpaperBlur', 'px');
  bindRange('#set-dim', '#val-dim', 'wallpaperDim', '%');
  bindRange('#set-size', '#val-size', 'iconSize', 'px');
  bindRange('#set-rad', '#val-rad', 'iconRadius', '%');
  bindRange('#set-gap', '#val-gap', 'iconGap', 'px');
  bindRange('#set-csize', '#val-csize', 'clockSize', 'px');

  // 时钟样式与字重
  backdrop.querySelectorAll('#set-clock-style .clock-style-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      s.clockStyle = btn.dataset.v;
      backdrop.querySelectorAll('#set-clock-style .clock-style-btn').forEach((x) => x.classList.toggle('active', x === btn));
      commit('settings');
    });
  });
  backdrop.querySelectorAll('#set-cweight .tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      s.clockWeight = Number(btn.dataset.v);
      backdrop.querySelectorAll('#set-cweight .tab').forEach((x) => x.classList.toggle('active', x === btn));
      commit('settings');
    });
  });

  // 内置渐变壁纸
  backdrop.querySelectorAll('#set-wp-grid .wp-card').forEach((card) => {
    card.addEventListener('click', () => {
      s.wallpaper = { type: 'gradient', id: card.dataset.wp };
      backdrop.querySelectorAll('#set-wp-grid .wp-card').forEach((x) => x.classList.toggle('active', x === card));
      commit('settings');
      onWallpaperUpdated?.();
    });
  });

  // 必应每日壁纸
  backdrop.querySelector('#set-wp-bing').addEventListener('click', async () => {
    const granted = await requestBingWallpaperPermission();
    if (!granted) {
      toast('未授予必应壁纸服务访问权限，已保留当前壁纸');
      return;
    }
    s.wallpaper = { type: 'bing', bingIdx: 0 };
    backdrop.querySelectorAll('#set-wp-grid .wp-card').forEach((x) => x.classList.remove('active'));
    commit('settings');
    onWallpaperUpdated?.();
    toast('正在加载今日必应高清壁纸…');
  });

  // 切换往期必应壁纸（0~7天循环）
  backdrop.querySelector('#set-wp-bing-next').addEventListener('click', async () => {
    const granted = await requestBingWallpaperPermission();
    if (!granted) {
      toast('未授予必应壁纸服务访问权限');
      return;
    }
    const nextIdx = s.wallpaper?.type === 'bing' ? ((Number(s.wallpaper.bingIdx) || 0) + 1) % 8 : 1;
    s.wallpaper = { type: 'bing', bingIdx: nextIdx };
    backdrop.querySelectorAll('#set-wp-grid .wp-card').forEach((x) => x.classList.remove('active'));
    commit('settings');
    onWallpaperUpdated?.();
    toast(nextIdx === 0 ? '已切回今日必应壁纸' : `正在加载 ${nextIdx} 天前的必应壁纸…`);
  });

  // 上传本地壁纸（压缩至 <=2560px 节省空间与渲染内存）
  backdrop.querySelector('#set-wp-upload').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await compressWallpaperFile(file, 2560);
    if (!dataUrl) {
      toast('壁纸读取失败');
      return;
    }
    await setCustomWallpaper(dataUrl);
    s.wallpaper = { type: 'custom' };
    backdrop.querySelectorAll('#set-wp-grid .wp-card').forEach((x) => x.classList.remove('active'));
    commit('settings');
    onWallpaperUpdated?.();
    toast('本地壁纸已优化并保存');
  });

  backdrop.querySelector('#btn-manage-engines')?.addEventListener('click', () => {
    openEnginesModal();
  });

  // 图标缓存管理
  backdrop.querySelector('#btn-clear-icons').addEventListener('click', async () => {
    clearIconMemoryCache();
    try {
      await clearAllCachedIcons();
      const statEl = backdrop.querySelector('#cache-stat');
      if (statEl) statEl.textContent = '已清空本地图标缓存，当前将使用浏览器缓存或文字徽章';
      toast('已清空本地图标缓存');
    } catch {
      toast('清空本地图标缓存失败，请稍后重试');
    }
  });

  backdrop.querySelector('#btn-refresh-icons').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const allSites = [];
    for (const g of state.groups) {
      for (const it of g.items) {
        if (it.type === 'site') allSites.push(it);
        if (it.type === 'folder') allSites.push(...it.children);
      }
    }
    const useThirdParty = !!s.thirdPartyIconFallback;
    const provider = s.thirdPartyIconProvider || 'duckduckgo';
    const granted = await requestSiteFetchPermissions(
      allSites.map((site) => site.url),
      { thirdPartyProvider: useThirdParty ? provider : '' }
    );
    if (!granted) {
      toast('未授予站点抓取权限，将继续使用本地缓存与徽章');
      return;
    }

    btn.disabled = true;
    btn.textContent = '抓取中…';
    let ok = 0;
    // 分批并发，避免一次性打满连接
    for (let i = 0; i < allSites.length; i += 4) {
      const batch = allSites.slice(i, i + 4);
      const res = await Promise.all(
        batch.map((site) =>
          resolveIconAsync(site, {
            forceRefresh: true,
            allowNetwork: true,
            allowThirdParty: useThirdParty,
            thirdPartyProvider: provider
          })
        )
      );
      ok += res.filter(Boolean).length;
    }
    btn.disabled = false;
    btn.textContent = '批量重抓全部图标';
    commit('grid');
    const latest = await getAllCachedIcons();
    updateCacheStatText(latest.length);
    toast(`图标抓取完成（成功更新 ${ok} 个）`);
  });

  // 备份导出（脱敏配置 / 完整备份）
  const downloadJson = (content, filename) => {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  backdrop.querySelector('#btn-export-clean').addEventListener('click', () => {
    openCleanExportModal((json, filename) => {
      downloadJson(json, filename);
    });
  });

  backdrop.querySelector('#btn-export-full').addEventListener('click', () => {
    if (!confirm('完整备份包含明文搜索历史、便签/待办内容及全部内网网址，切勿公开分享给他人。确定继续导出完整备份吗？')) {
      return;
    }
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadJson(exportState({ desensitize: false }), `MiroTab-backup-${dateStr}.json`);
    toast('完整备份文件已导出');
  });

  // 备份导入（支持按模块选择性恢复，限制文件大小 <= 5MB）
  backdrop.querySelector('#btn-import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      toast('导入失败：备份文件过大（不能超过 5MB）');
      e.target.value = '';
      return;
    }
    try {
      const text = await file.text();
      openImportBackupModal(text, () => onWallpaperUpdated?.());
    } catch (err) {
      toast(`导入失败：${err.message}`);
    }
  });

  // 恢复出厂设置
  backdrop.querySelector('#btn-reset').addEventListener('click', async () => {
    if (!confirm('确定要恢复出厂默认配置吗？这将清空你的自定义分组、网址、小组件内容（便签/待办/倒数日）、搜索历史，以及本地缓存的图标与壁纸。')) return;
    const res = await resetState();
    onWallpaperUpdated?.();
    closeModal();
    if (res.ok) {
      toast('已恢复默认配置并彻底清空本地缓存');
    } else {
      toast(`已重置配置，但部分缓存清理失败（${res.errors.join('、')}）`);
    }
  });
}
