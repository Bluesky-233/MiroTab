/**
 * 预设数据：徽章渐变色、搜索引擎、默认分组与网址、内置壁纸
 */

// 智能文字徽章的渐变配色（根据域名哈希稳定选取）
export const BADGE_GRADIENTS = [
  'linear-gradient(135deg,#667eea,#764ba2)',
  'linear-gradient(135deg,#f093fb,#f5576c)',
  'linear-gradient(135deg,#4facfe,#00c6fb)',
  'linear-gradient(135deg,#43e97b,#38d9a9)',
  'linear-gradient(135deg,#fa709a,#fee140)',
  'linear-gradient(135deg,#30cfd0,#330867)',
  'linear-gradient(135deg,#ff9a56,#ff6a88)',
  'linear-gradient(135deg,#5ee7df,#b490ca)',
  'linear-gradient(135deg,#f6d365,#fda085)',
  'linear-gradient(135deg,#6a11cb,#2575fc)',
  'linear-gradient(135deg,#0ba360,#3cba92)',
  'linear-gradient(135deg,#ff758c,#ff7eb3)',
  'linear-gradient(135deg,#2b5876,#4e4376)',
  'linear-gradient(135deg,#ee9ca7,#ffdde1)',
  'linear-gradient(135deg,#13547a,#80d0c7)',
  'linear-gradient(135deg,#e65c00,#f9d423)'
];

// 徽章纯色可选色板（图标编辑器中使用）
export const BADGE_PALETTE = [
  ...BADGE_GRADIENTS.slice(0, 12),
  '#1f2937', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff'
];

export const SEARCH_ENGINES = [
  {
    id: 'bing',
    name: '必应',
    bang: 'bi',
    url: 'https://www.bing.com/search?q=%s',
    color: '#00809d',
    svg: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 3v15.4l4.3 2.6 9.7-5.5v-4.2l-6.6-2.3 2.1 5.2-5.2 2.9V5.4L5 3Z" fill="#008373"/><path d="M9.3 17.1l9.7-5.8v4.2L9.3 21v-3.9Z" fill="#21a366"/></svg>'
  },
  {
    id: 'google',
    name: 'Google',
    bang: 'g',
    url: 'https://www.google.com/search?q=%s',
    color: '#4285f4',
    svg: '<svg viewBox="0 0 24 24" fill="none"><path d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.3c1.9-1.8 3-4.4 3-7.5Z" fill="#4285F4"/><path d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.6c-.9.6-2.1 1-3.4 1-2.6 0-4.9-1.8-5.7-4.2H3v2.7A10 10 0 0 0 12 22Z" fill="#34A853"/><path d="M6.3 13.8a6 6 0 0 1 0-3.6V7.5H3a10 10 0 0 0 0 9l3.3-2.7Z" fill="#FBBC05"/><path d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3 7.5l3.3 2.7C7.1 7.8 9.4 6 12 6Z" fill="#EA4335"/></svg>'
  },
  {
    id: 'baidu',
    name: '百度',
    bang: 'bd',
    url: 'https://www.baidu.com/s?wd=%s',
    color: '#2932e1',
    svg: '<svg viewBox="0 0 24 24" fill="none"><ellipse cx="8.6" cy="7.2" rx="1.9" ry="2.6" fill="#2932E1"/><ellipse cx="14.7" cy="6.9" rx="1.9" ry="2.6" fill="#2932E1"/><ellipse cx="5.2" cy="11.6" rx="1.7" ry="2.3" transform="rotate(-15 5.2 11.6)" fill="#2932E1"/><ellipse cx="18.6" cy="11.4" rx="1.7" ry="2.3" transform="rotate(15 18.6 11.4)" fill="#2932E1"/><path d="M12 11c-2.6 0-5.4 2.4-5.4 5.2 0 2 1.5 3.3 3.4 3.3 1 0 1.5-.3 2-.3s1 .3 2 .3c1.9 0 3.4-1.3 3.4-3.3C17.4 13.4 14.6 11 12 11Z" fill="#2932E1"/></svg>'
  },
  {
    id: 'yandex',
    name: 'Yandex',
    bang: 'y',
    url: 'https://yandex.com/search/?text=%s',
    color: '#fc3f1d',
    svg: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#FC3F1D"/><path d="M13.5 18.5h-2.1v-5.3L7.7 6h2.3l2.6 5.2L15 6h2.1l-3.6 7.1v5.4Z" fill="#fff"/></svg>'
  },
  {
    id: 'ddg',
    name: 'DuckDuckGo',
    bang: 'd',
    url: 'https://duckduckgo.com/?q=%s',
    color: '#de5833',
    svg: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#DE5833"/><circle cx="11.5" cy="11.2" r="5" fill="#fff"/><path d="M13 11.8c2-.4 3.8.3 4.3 1.2.4.8-.9 1.6-3.2 1.6-1.4 0-2-.5-2-1.2 0-.8.3-1.4.9-1.6Z" fill="#FBB03B"/><circle cx="10.2" cy="10.2" r="1" fill="#222"/><circle cx="13.2" cy="10" r=".9" fill="#222"/><path d="M9.4 16.2 12 15l2.6 1.2-.5 1.8L12 17l-2.1 1-.5-1.8Z" fill="#5CB85C"/></svg>'
  },
  {
    id: 'github',
    name: 'GitHub',
    bang: 'gh',
    url: 'https://github.com/search?q=%s',
    color: '#24292f',
    svg: '<svg viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.47 2 2 6.58 2 12.24c0 4.52 2.86 8.36 6.84 9.72.5.09.68-.22.68-.49 0-.24-.01-1.05-.01-1.9-2.78.62-3.37-1.21-3.37-1.21-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.71.12 2.5.35 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.26 10.26 0 0 0 22 12.24C22 6.58 17.52 2 12 2Z" fill="#24292F"/></svg>'
  },
  {
    id: 'bilibili',
    name: '哔哩哔哩',
    bang: 'b',
    url: 'https://search.bilibili.com/all?keyword=%s',
    color: '#fb7299',
    svg: '<svg viewBox="0 0 24 24" fill="none"><path d="M7.5 4.2 10 6.8m6.5-2.6L14 6.8" stroke="#FB7299" stroke-width="1.8" stroke-linecap="round"/><rect x="3.5" y="7" width="17" height="12.5" rx="3.5" fill="#FB7299"/><circle cx="9.2" cy="13" r="1.4" fill="#fff"/><circle cx="14.8" cy="13" r="1.4" fill="#fff"/><path d="M10.2 16.2c.6.6 1.2.8 1.8.8s1.2-.2 1.8-.8" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>'
  },
  {
    id: 'zhihu',
    name: '知乎',
    bang: 'zh',
    url: 'https://www.zhihu.com/search?q=%s',
    color: '#1772f6',
    svg: '<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" fill="#1772F6"/><text x="12" y="16.8" text-anchor="middle" fill="#fff" font-size="13" font-weight="700" font-family="sans-serif">知</text></svg>'
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    bang: 'xhs',
    url: 'https://www.xiaohongshu.com/search_result?keyword=%s',
    color: '#ff2442',
    svg: '<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" fill="#FF2442"/><text x="12" y="14.6" text-anchor="middle" fill="#fff" font-size="7.4" font-weight="800" font-family="sans-serif">小红书</text></svg>'
  },
  {
    id: 'youtube',
    name: 'YouTube',
    bang: 'yt',
    url: 'https://www.youtube.com/results?search_query=%s',
    color: '#ff0000',
    svg: '<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="20" height="14" rx="4" fill="#FF0000"/><path d="M10 9.2 15.5 12 10 14.8V9.2Z" fill="#fff"/></svg>'
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    bang: 'p',
    url: 'https://www.perplexity.ai/search?q=%s',
    color: '#1fb8cd',
    svg: '<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" fill="#111827"/><path d="M12 5v14M7 7.5l5 3.5 5-3.5M7 16.5l5-3.5 5 3.5M6.5 12h11" stroke="#22D3EE" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  },
  {
    id: 'translate',
    name: '翻译',
    bang: 'tr',
    url: 'https://www.bing.com/translator?text=%s',
    color: '#7c3aed',
    svg: '<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" fill="#7C3AED"/><path d="M6.5 8.5h7M10 6.5v2M12.2 8.5c-.7 2.8-2.4 5-4.7 6.3M8.2 10.7c.9 1.6 2.1 2.9 3.6 3.8M13.5 17.5l2.5-6.5 2.5 6.5M14.3 15.5h3.4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  }
];

let _id = 0;
const uid = (p = 'i') => `${p}_${Date.now().toString(36)}_${(_id++).toString(36)}`;
export { uid };

function site(title, url) {
  return { id: uid('s'), type: 'site', title, url, iconMode: 'auto' };
}

export function createDefaultData() {
  return {
    groups: [
      {
        id: uid('g'),
        name: '主页',
        icon: 'home',
        items: [
          { id: uid('w'), type: 'widget', widget: 'calendar', size: '2x2' },
          site('哔哩哔哩', 'https://www.bilibili.com'),
          site('GitHub', 'https://github.com'),
          site('知乎', 'https://www.zhihu.com'),
          site('微博', 'https://weibo.com'),
          site('淘宝', 'https://www.taobao.com'),
          site('京东', 'https://www.jd.com'),
          { id: uid('w'), type: 'widget', widget: 'todo', size: '2x2' },
          site('YouTube', 'https://www.youtube.com'),
          site('百度翻译', 'https://fanyi.baidu.com'),
          site('网易云音乐', 'https://music.163.com'),
          site('豆瓣', 'https://www.douban.com')
        ]
      },
      {
        id: uid('g'),
        name: 'AI',
        icon: 'sparkles',
        items: [
          site('ChatGPT', 'https://chatgpt.com'),
          site('Gemini', 'https://gemini.google.com'),
          site('DeepSeek', 'https://chat.deepseek.com'),
          site('Kimi', 'https://kimi.moonshot.cn'),
          site('通义', 'https://tongyi.aliyun.com'),
          site('豆包', 'https://www.doubao.com'),
          site('Claude', 'https://claude.ai'),
          site('Perplexity', 'https://www.perplexity.ai')
        ]
      },
      {
        id: uid('g'),
        name: '开发',
        icon: 'code',
        items: [
          site('GitHub', 'https://github.com'),
          site('Stack Overflow', 'https://stackoverflow.com'),
          site('MDN', 'https://developer.mozilla.org'),
          site('掘金', 'https://juejin.cn'),
          site('V2EX', 'https://www.v2ex.com'),
          site('npm', 'https://www.npmjs.com'),
          { id: uid('w'), type: 'widget', widget: 'notes', size: '2x2' }
        ]
      }
    ]
  };
}

// 侧边栏分组可选图标（简洁线性 SVG path，24x24 viewBox）
export const GROUP_ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5 3.5-5 3.5z"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h9.6a1 1 0 0 0 1-.8L21 7H6"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.2-1-1.6-1-2.6 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  game: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r="1"/><circle cx="18" cy="13.5" r="1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  heart: '<path d="M12 20s-7.5-4.6-9.2-9.4C1.6 7.2 4 4 7.3 4c2 0 3.4 1.1 4.7 2.8C13.3 5.1 14.7 4 16.7 4 20 4 22.4 7.2 21.2 10.6 19.5 15.4 12 20 12 20z"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>'
};

// 内置壁纸（全部为本地 CSS 渐变与极简内联 SVG，零网络、0ms 瞬开）
const MIRO_PRISM_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">` +
  `<defs>` +
  `<radialGradient id="mp1" cx="18%" cy="18%" r="54%"><stop offset="0%" stop-color="#2563eb" stop-opacity="0.58"/><stop offset="100%" stop-color="#070d1f" stop-opacity="0"/></radialGradient>` +
  `<radialGradient id="mp2" cx="84%" cy="16%" r="46%"><stop offset="0%" stop-color="#e84545" stop-opacity="0.34"/><stop offset="100%" stop-color="#070d1f" stop-opacity="0"/></radialGradient>` +
  `<radialGradient id="mp3" cx="72%" cy="86%" r="54%"><stop offset="0%" stop-color="#0ea5e9" stop-opacity="0.44"/><stop offset="100%" stop-color="#070d1f" stop-opacity="0"/></radialGradient>` +
  `<radialGradient id="mp4" cx="14%" cy="88%" r="48%"><stop offset="0%" stop-color="#f5b942" stop-opacity="0.22"/><stop offset="100%" stop-color="#070d1f" stop-opacity="0"/></radialGradient>` +
  `<linearGradient id="prism1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.11"/><stop offset="48%" stop-color="#5eead4" stop-opacity="0.06"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></linearGradient>` +
  `<linearGradient id="prism2" x1="100%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#f5b942" stop-opacity="0.08"/><stop offset="45%" stop-color="#93c5fd" stop-opacity="0.05"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></linearGradient>` +
  `<radialGradient id="redGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#e84545" stop-opacity="0.45"/><stop offset="100%" stop-color="#e84545" stop-opacity="0"/></radialGradient>` +
  `</defs>` +
  `<rect width="1600" height="900" fill="#070d1f"/>` +
  `<rect width="1600" height="900" fill="url(#mp1)"/><rect width="1600" height="900" fill="url(#mp2)"/>` +
  `<rect width="1600" height="900" fill="url(#mp3)"/><rect width="1600" height="900" fill="url(#mp4)"/>` +
  `<polygon points="-80,0 440,0 1080,900 520,900" fill="url(#prism1)"/>` +
  `<polygon points="940,0 1320,0 640,900 320,900" fill="url(#prism2)"/>` +
  `<polygon points="1180,0 1620,0 1620,420 960,900 840,900" fill="url(#prism1)" opacity="0.65"/>` +
  `<path d="M90 220 C 190 130, 300 240, 410 155" fill="none" stroke="#e2e8f0" stroke-width="1.2" opacity="0.18"/>` +
  `<path d="M1190 735 C 1300 660, 1410 770, 1525 655" fill="none" stroke="#e2e8f0" stroke-width="1.2" opacity="0.18"/>` +
  `<circle cx="196" cy="146" r="28" fill="url(#redGlow)"/>` +
  `<circle cx="196" cy="146" r="10" fill="#e84545" opacity="0.9"/>` +
  `<path d="M132 108 l4.5 11.5 11.5 4.5-11.5 4.5-4.5 11.5-4.5-11.5-11.5-4.5 11.5-4.5z" fill="#f5b942" opacity="0.88"/>` +
  `<ellipse cx="1410" cy="158" rx="52" ry="20" transform="rotate(-22 1410 158)" fill="none" stroke="#93c5fd" stroke-width="1.3" opacity="0.32"/>` +
  `<circle cx="1456" cy="136" r="5" fill="#f5b942" opacity="0.82"/>` +
  `<circle cx="1376" cy="196" r="6" fill="#2563eb" opacity="0.72"/>` +
  `<circle cx="1430" cy="760" r="12" fill="#2563eb" opacity="0.62"/>` +
  `<path d="M1325 718 l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#f5b942" opacity="0.76"/>` +
  `<circle cx="165" cy="742" r="4" fill="#e2e8f0" opacity="0.45"/><circle cx="1475" cy="230" r="3" fill="#e2e8f0" opacity="0.5"/>` +
  `</svg>`
);

const MIRO_ATELIER_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">` +
  `<rect width="1600" height="900" fill="#f5efe3"/>` +
  `<circle cx="1320" cy="170" r="140" fill="#e63946" opacity="0.14"/>` +
  `<circle cx="240" cy="720" r="190" fill="#1d4ed8" opacity="0.11"/>` +
  `<circle cx="1180" cy="740" r="115" fill="#eab308" opacity="0.18"/>` +
  `<path d="M120 210 C 310 110, 440 280, 620 190 S 940 90, 1140 210" fill="none" stroke="#181715" stroke-width="2" opacity="0.14"/>` +
  `<path d="M1080 650 C 1220 580, 1380 690, 1510 560" fill="none" stroke="#181715" stroke-width="2" opacity="0.13"/>` +
  `<circle cx="280" cy="180" r="16" fill="#e63946" opacity="0.82"/>` +
  `<circle cx="1360" cy="240" r="12" fill="#181715" opacity="0.72"/>` +
  `<circle cx="1290" cy="710" r="22" fill="#1d4ed8" opacity="0.78"/>` +
  `<circle cx="190" cy="630" r="14" fill="#eab308" opacity="0.88"/>` +
  `<path d="M1395 140 l7 18 18 7-18 7-7 18-7-18-18-7 18-7z" fill="#181715" opacity="0.65"/>` +
  `<path d="M220 250 l5 12 12 5-12 5-5 12-5-12-12-5 12-5z" fill="#1d4ed8" opacity="0.58"/>` +
  `<ellipse cx="320" cy="735" rx="64" ry="26" transform="rotate(-18 320 735)" fill="none" stroke="#181715" stroke-width="2" opacity="0.22"/>` +
  `</svg>`
);

const MIRO_NIGHT_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">` +
  `<defs><radialGradient id="g1" cx="22%" cy="18%" r="55%"><stop offset="0%" stop-color="#1d4ed8" stop-opacity="0.45"/><stop offset="100%" stop-color="#0a1024" stop-opacity="0"/></radialGradient>` +
  `<radialGradient id="g2" cx="82%" cy="22%" r="45%"><stop offset="0%" stop-color="#e63946" stop-opacity="0.28"/><stop offset="100%" stop-color="#0a1024" stop-opacity="0"/></radialGradient>` +
  `<radialGradient id="g3" cx="68%" cy="85%" r="50%"><stop offset="0%" stop-color="#f4b400" stop-opacity="0.22"/><stop offset="100%" stop-color="#0a1024" stop-opacity="0"/></radialGradient></defs>` +
  `<rect width="1600" height="900" fill="#090e1f"/>` +
  `<rect width="1600" height="900" fill="url(#g1)"/>` +
  `<rect width="1600" height="900" fill="url(#g2)"/>` +
  `<rect width="1600" height="900" fill="url(#g3)"/>` +
  `<path d="M160 660 C 380 540, 560 720, 820 590 S 1260 510, 1460 640" fill="none" stroke="#f8fafc" stroke-width="1.5" opacity="0.16"/>` +
  `<circle cx="250" cy="190" r="14" fill="#e63946" opacity="0.88"/>` +
  `<circle cx="1340" cy="210" r="10" fill="#f4b400" opacity="0.9"/>` +
  `<circle cx="1260" cy="700" r="18" fill="#3b82f6" opacity="0.72"/>` +
  `<path d="M1370 140 l6 16 16 6-16 6-6 16-6-16-16-6 16-6z" fill="#f8fafc" opacity="0.75"/>` +
  `<path d="M310 250 l4 11 11 4-11 4-4 11-4-11-11-4 11-4z" fill="#f4b400" opacity="0.72"/>` +
  `<circle cx="840" cy="130" r="3" fill="#fff" opacity="0.6"/><circle cx="1120" cy="310" r="2.5" fill="#fff" opacity="0.5"/><circle cx="420" cy="720" r="3" fill="#fff" opacity="0.55"/>` +
  `</svg>`
);

export const GRADIENT_WALLPAPERS = [
  { id: 'miro-prism', name: '镜棱极光', css: `url('data:image/svg+xml,${MIRO_PRISM_SVG}') center / cover no-repeat, #070d1f` },
  { id: 'miro-atelier', name: '米罗画室', css: `url('data:image/svg+xml,${MIRO_ATELIER_SVG}') center / cover no-repeat, #f5efe3` },
  { id: 'miro-night', name: '米罗星夜', css: `url('data:image/svg+xml,${MIRO_NIGHT_SVG}') center / cover no-repeat, #090e1f` },
  { id: 'aurora', name: '极光', css: 'radial-gradient(at 20% 20%,#3a1c71 0,transparent 55%),radial-gradient(at 80% 10%,#0f9b8e 0,transparent 50%),radial-gradient(at 70% 80%,#d76d77 0,transparent 55%),radial-gradient(at 10% 90%,#1e3c72 0,transparent 60%),#0b1026' },
  { id: 'dawn', name: '晨曦', css: 'radial-gradient(at 0% 0%,#ffd1a9 0,transparent 50%),radial-gradient(at 100% 0%,#ff9a9e 0,transparent 55%),radial-gradient(at 100% 100%,#a18cd1 0,transparent 55%),radial-gradient(at 0% 100%,#fbc2eb 0,transparent 55%),#fde2e4' },
  { id: 'ocean', name: '深海', css: 'radial-gradient(at 30% 10%,#2193b0 0,transparent 55%),radial-gradient(at 80% 70%,#6dd5ed 0,transparent 45%),radial-gradient(at 10% 90%,#0f2027 0,transparent 60%),#203a43' },
  { id: 'forest', name: '森林', css: 'radial-gradient(at 20% 30%,#134e5e 0,transparent 55%),radial-gradient(at 80% 20%,#71b280 0,transparent 50%),radial-gradient(at 60% 90%,#0b3d2e 0,transparent 60%),#16302b' },
  { id: 'sunset', name: '落日', css: 'radial-gradient(at 10% 10%,#ff512f 0,transparent 50%),radial-gradient(at 90% 30%,#dd2476 0,transparent 55%),radial-gradient(at 50% 100%,#3a1c71 0,transparent 60%),#2a0f3a' },
  { id: 'mist', name: '薄雾', css: 'radial-gradient(at 15% 20%,#e0eafc 0,transparent 55%),radial-gradient(at 85% 30%,#cfdef3 0,transparent 55%),radial-gradient(at 50% 90%,#d4fc79 0,transparent 60%),#e8eef5' },
  { id: 'lavender', name: '薰衣草', css: 'radial-gradient(at 20% 0%,#c471f5 0,transparent 55%),radial-gradient(at 90% 50%,#fa71cd 0,transparent 50%),radial-gradient(at 10% 100%,#7f7fd5 0,transparent 60%),#4b3c82' },
  { id: 'night', name: '夜空', css: 'radial-gradient(at 50% 0%,#283c86 0,transparent 60%),radial-gradient(at 0% 100%,#45a247 0,transparent 45%),radial-gradient(at 100% 100%,#141e30 0,transparent 60%),#0a0f1f' },
  { id: 'mono', name: '石墨', css: 'radial-gradient(at 30% 20%,#434343 0,transparent 60%),radial-gradient(at 80% 90%,#1a1a1a 0,transparent 60%),#232526' }
];

export const WIDGET_TYPES = [
  { id: 'calendar', name: '日历', sizes: ['2x2', '2x1'], desc: '月历 + 农历 + 今日' },
  { id: 'todo', name: '待办事项', sizes: ['2x2', '2x3'], desc: '勾选完成、本地保存' },
  { id: 'notes', name: '便签', sizes: ['2x2', '2x3', '3x2'], desc: '随手记，自动保存' },
  { id: 'weather', name: '天气', sizes: ['2x2', '2x1'], desc: 'Open-Meteo 免费天气，无需密钥' },
  { id: 'countdown', name: '倒数日', sizes: ['2x1', '2x2'], desc: '距离重要日子还有几天' },
  { id: 'clock', name: '模拟时钟', sizes: ['2x2'], desc: '指针时钟' }
];
