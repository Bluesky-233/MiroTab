/**
 * 搜索增强工具：纯本地安全算式计算、!Bang 前缀路由、拼音首字母匹配与引擎列表聚合
 */
import { SEARCH_ENGINES } from './presets.js';
import { normalizeUrl } from './iconEngine.js';

const CALC_FUNCS = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  pow: Math.pow,
  max: Math.max,
  min: Math.min
};

const CALC_CONSTS = { pi: Math.PI, e: Math.E };

function tokenizeExpr(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = '';
      let dots = 0;
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        if (expr[i] === '.') dots++;
        numStr += expr[i++];
      }
      if (dots > 1 || numStr === '.') return null;
      const val = Number(numStr);
      if (!Number.isFinite(val)) return null;
      tokens.push({ type: 'num', val });
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      let ident = '';
      while (i < expr.length && /[a-zA-Z]/.test(expr[i])) ident += expr[i++];
      tokens.push({ type: 'id', val: ident.toLowerCase() });
      continue;
    }
    const mapped = ch === '×' ? '*' : ch === '÷' ? '/' : ch;
    if ('+-*/%^(),'.includes(mapped)) {
      tokens.push({ type: 'op', val: mapped });
      i++;
      continue;
    }
    return null;
  }
  return tokens;
}

function parseTokens(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseAdd() {
    let left = parseMul();
    while (peek()?.type === 'op' && (peek().val === '+' || peek().val === '-')) {
      const op = next().val;
      const right = parseMul();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseMul() {
    let left = parsePow();
    while (peek()?.type === 'op' && (peek().val === '*' || peek().val === '/' || peek().val === '%')) {
      const op = next().val;
      const right = parsePow();
      if ((op === '/' || op === '%') && right === 0) throw new Error('div0');
      left = op === '*' ? left * right : op === '/' ? left / right : left % right;
    }
    return left;
  }

  function parsePow() {
    const base = parseUnary();
    if (peek()?.type === 'op' && peek().val === '^') {
      next();
      return Math.pow(base, parsePow());
    }
    return base;
  }

  function parseUnary() {
    if (peek()?.type === 'op' && (peek().val === '+' || peek().val === '-')) {
      const op = next().val;
      const val = parseUnary();
      return op === '-' ? -val : val;
    }
    return parsePostfix();
  }

  function parsePostfix() {
    let val = parsePrimary();
    while (
      peek()?.type === 'op' &&
      peek().val === '%' &&
      (!tokens[pos + 1] || (tokens[pos + 1].type === 'op' && '+-*/^),'.includes(tokens[pos + 1].val)))
    ) {
      next();
      val /= 100;
    }
    return val;
  }

  function parsePrimary() {
    const tok = peek();
    if (!tok) throw new Error('eof');
    if (tok.type === 'num') {
      next();
      return tok.val;
    }
    if (tok.type === 'id') {
      next();
      if (peek()?.type === 'op' && peek().val === '(') {
        const fn = CALC_FUNCS[tok.val];
        if (!fn) throw new Error('fn');
        next();
        const args = [];
        if (!(peek()?.type === 'op' && peek().val === ')')) {
          args.push(parseAdd());
          while (peek()?.type === 'op' && peek().val === ',') {
            next();
            args.push(parseAdd());
          }
        }
        if (peek()?.type !== 'op' || peek().val !== ')') throw new Error('paren');
        next();
        if (!args.length) throw new Error('args');
        return fn(...args);
      }
      if (Object.prototype.hasOwnProperty.call(CALC_CONSTS, tok.val)) return CALC_CONSTS[tok.val];
      throw new Error('id');
    }
    if (tok.type === 'op' && tok.val === '(') {
      next();
      const val = parseAdd();
      if (peek()?.type !== 'op' || peek().val !== ')') throw new Error('paren');
      next();
      return val;
    }
    throw new Error('token');
  }

  const res = parseAdd();
  if (pos !== tokens.length) throw new Error('extra');
  return res;
}

export function evaluateExpression(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const hasEq = s.startsWith('=');
  const expr = hasEq ? s.slice(1).trim() : s;
  if (!expr) return null;

  if (!hasEq) {
    if (/\s/.test(expr)) return null;
    if (!/^[0-9().+\-*/%^×÷]+$/.test(expr)) return null;
    if (!/[+\-*/%^×÷]/.test(expr.replace(/^[-+]/, ''))) return null;
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(expr)) return null;
  }

  const tokens = tokenizeExpr(expr);
  if (!tokens || !tokens.length) return null;
  try {
    const rawVal = parseTokens(tokens);
    if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) return null;
    const value = Number(rawVal.toPrecision(12));
    if (!Number.isFinite(value)) return null;
    const formatted = Math.abs(value) >= 1e15 || (value !== 0 && Math.abs(value) < 1e-9)
      ? value.toString()
      : value.toLocaleString('en-US', { maximumFractionDigits: 10 });
    return { expr, value, formatted };
  } catch {
    return null;
  }
}

const PINYIN_BOUNDS = [
  ['b', '八'], ['c', '擦'], ['d', '搭'], ['e', '蛾'], ['f', '发'], ['g', '噶'],
  ['h', '哈'], ['j', '击'], ['k', '喀'], ['l', '垃'], ['m', '妈'], ['n', '拿'],
  ['o', '哦'], ['p', '啪'], ['q', '期'], ['r', '然'], ['s', '撒'], ['t', '塌'],
  ['w', '挖'], ['x', '昔'], ['y', '压'], ['z', '匝']
];
const zhCollator = typeof Intl !== 'undefined' ? new Intl.Collator('zh-Hans-CN') : null;
const pinyinCache = new Map();

export function getPinyinInitials(str = '') {
  const s = String(str || '');
  if (!s) return '';
  if (pinyinCache.has(s)) return pinyinCache.get(s);
  let out = '';
  for (const ch of s) {
    if (/[a-zA-Z0-9]/.test(ch)) {
      out += ch.toLowerCase();
    } else if (/[\u4e00-\u9fff]/.test(ch) && zhCollator) {
      let letter = 'a';
      for (let i = PINYIN_BOUNDS.length - 1; i >= 0; i--) {
        if (zhCollator.compare(ch, PINYIN_BOUNDS[i][1]) >= 0) {
          letter = PINYIN_BOUNDS[i][0];
          break;
        }
      }
      out += letter;
    }
  }
  if (pinyinCache.size > 400) pinyinCache.clear();
  pinyinCache.set(s, out);
  return out;
}

export function matchSite(site, qLower) {
  if (!site || !qLower) return false;
  const title = (site.title || '').toLowerCase();
  const url = (site.url || '').toLowerCase();
  if (title.includes(qLower) || url.includes(qLower)) return true;
  if (/^[a-z0-9]+$/.test(qLower)) {
    const py = getPinyinInitials(site.title || '');
    if (py && py.includes(qLower)) return true;
  }
  return false;
}

export function getActiveEngines(settings = {}) {
  const hidden = new Set(Array.isArray(settings.hiddenEngines) ? settings.hiddenEngines : []);
  const builtins = SEARCH_ENGINES.filter((e) => !hidden.has(e.id));
  const customs = Array.isArray(settings.customEngines)
    ? settings.customEngines
        .filter((e) => e && e.id && e.name && e.url)
        .map((e) => ({
          id: String(e.id),
          name: String(e.name),
          bang: String(e.bang || '').toLowerCase().trim(),
          url: String(e.url),
          color: e.color || '#4c8dff',
          isCustom: true
        }))
    : [];
  const merged = [...builtins, ...customs];
  return merged.length ? merged : [SEARCH_ENGINES[0]];
}

export function sanitizeCustomEngineUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const withPlaceholder = trimmed.includes('%s')
    ? trimmed
    : `${trimmed}${trimmed.includes('?') ? '&q=%s' : '?q=%s'}`;
  const sentinel = '__MIRO_QUERY__';
  const normalized = normalizeUrl(withPlaceholder.replace(/%s/g, sentinel));
  if (!normalized || !normalized.includes(sentinel)) return '';
  return normalized.replaceAll(sentinel, '%s');
}

export function parseBangQuery(raw, engines = SEARCH_ENGINES) {
  const s = String(raw || '').trim();
  const m = s.match(/^[!！]([a-zA-Z0-9_-]*)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const prefix = (m[1] || '').toLowerCase();
  const query = (m[2] || '').trim();
  if (prefix) {
    const exact = engines.find(
      (e) => (e.bang && e.bang.toLowerCase() === prefix) || e.id.toLowerCase() === prefix
    );
    if (exact) {
      return { matched: true, engine: exact, prefix, query };
    }
  }
  const candidates = engines.filter((e) => {
    if (!prefix) return true;
    return (
      (e.bang && e.bang.toLowerCase().startsWith(prefix)) ||
      e.id.toLowerCase().startsWith(prefix) ||
      e.name.toLowerCase().includes(prefix)
    );
  });
  return { matched: false, prefix, query, candidates };
}
