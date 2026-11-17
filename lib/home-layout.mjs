import { parseFragment } from 'parse5';

export const HOME_LAYOUT_LIMIT = 50_000;
export const DEFAULT_HOME_WEATHER = {
  city: '北京',
  latitude: 39.9042,
  longitude: 116.4074,
  unit: 'celsius',
};

export const HOME_WIDGETS = [
  { tag: 'ac-hero', label: '站点介绍', example: '<ac-hero></ac-hero>' },
  { tag: 'ac-stats', label: '题库统计', example: '<ac-stats></ac-stats>' },
  { tag: 'ac-contests', label: '比赛列表', example: '<ac-contests kind="upcoming" platform="codeforces" limit="6"></ac-contests>' },
  { tag: 'ac-problems', label: '题目列表', example: '<ac-problems kind="fetched" limit="8"></ac-problems>' },
  { tag: 'ac-history', label: '最近看过 / 做过的题', example: '<ac-history kind="practiced" limit="6"></ac-history>' },
  { tag: 'ac-history-contests', label: '最近看过 / 做过的比赛', example: '<ac-history-contests kind="viewed" limit="5"></ac-history-contests>' },
  { tag: 'ac-files', label: 'IDE 最近编辑文件', example: '<ac-files limit="6"></ac-files>' },
  { tag: 'ac-cf-rating', label: 'Codeforces Rating', example: '<ac-cf-rating handle="tourist"></ac-cf-rating>' },
  { tag: 'ac-weather', label: '天气', example: '<ac-weather city="上海"></ac-weather>' },
  { tag: 'ac-clock', label: '问候与实时时钟', example: '<ac-clock name="同学"></ac-clock>' },
  { tag: 'ac-site-update', label: '数据更新时间', example: '<ac-site-update></ac-site-update>' },
  { tag: 'ac-section', label: '带标题的内容区', example: '<ac-section title="近期比赛" href="/contests"><ac-contests kind="recent"></ac-contests></ac-section>' },
];

const CUSTOM_TAGS = new Set(HOME_WIDGETS.map((w) => w.tag));
const SAFE_TAGS = new Set([
  'a', 'blockquote', 'br', 'dd', 'details', 'div', 'dl', 'dt', 'em', 'figcaption',
  'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'img',
  'li', 'mark', 'ol', 'p', 'section', 'small', 'span', 'strong', 'sub', 'summary',
  'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
]);
const DROP_TAGS = new Set([
  'base', 'button', 'embed', 'form', 'iframe', 'input', 'link', 'math', 'meta',
  'object', 'script', 'select', 'style', 'svg', 'template', 'textarea',
]);
const CUSTOM_ATTRS = new Set([
  'city', 'compact', 'handle', 'href', 'kind', 'lat', 'latitude', 'limit', 'lon',
  'longitude', 'more', 'name', 'platform', 'subtitle', 'title', 'unit', 'variant',
]);
const GLOBAL_ATTRS = new Set(['aria-label', 'class', 'id', 'style', 'title']);
const SAFE_ATTRS = new Set(['alt', 'colspan', 'height', 'href', 'open', 'rel', 'rowspan', 'src', 'target', 'width']);
const MAX_NODES = 1200;
const MAX_DEPTH = 80;

const STYLE_PROPERTIES = new Set([
  'align-items', 'align-self', 'background', 'background-color', 'border', 'border-bottom',
  'border-left', 'border-radius', 'border-right', 'border-top', 'color', 'column-gap',
  'display', 'flex', 'flex-basis', 'flex-direction', 'flex-grow', 'flex-shrink', 'flex-wrap',
  'font-size', 'font-style', 'font-weight', 'gap', 'grid-column', 'grid-row',
  'grid-template-columns', 'grid-template-rows', 'height', 'justify-content', 'justify-self',
  'letter-spacing', 'line-height', 'margin', 'margin-bottom', 'margin-left', 'margin-right',
  'margin-top', 'max-height', 'max-width', 'min-height', 'min-width', 'opacity', 'overflow',
  'overflow-x', 'overflow-y', 'padding', 'padding-bottom', 'padding-left', 'padding-right',
  'padding-top', 'row-gap', 'text-align', 'text-decoration', 'text-transform', 'width',
]);

function styleName(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

export function sanitizeHomeStyle(value) {
  const style = {};
  for (const declaration of String(value ?? '').split(';').slice(0, 60)) {
    const colon = declaration.indexOf(':');
    if (colon < 1) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    const val = declaration.slice(colon + 1).trim();
    if (!STYLE_PROPERTIES.has(name) || !val || val.length > 240) continue;
    if (/url\s*\(|expression\s*\(|@import|javascript:|vbscript:|[{}<>\\]/i.test(val)) continue;
    style[styleName(name)] = val;
  }
  return style;
}

function safeUrl(value, attr) {
  const original = String(value ?? '').trim();
  const normalized = original.replace(/[\u0000-\u0020\u007f]/g, '');
  if (!normalized || /^(?:javascript|vbscript|data|file):/i.test(normalized)) return null;
  if (normalized.startsWith('#')) return attr === 'href' ? original : null;
  try {
    const url = new URL(normalized, 'https://ac.invalid/');
    return ['http:', 'https:', ...(attr === 'href' ? ['mailto:'] : [])].includes(url.protocol) ? original : null;
  } catch {
    return null;
  }
}

function cleanAttributes(node, tag) {
  const attrs = {};
  for (const { name: rawName, value: rawValue } of node.attrs ?? []) {
    const name = rawName.toLowerCase();
    if (name.startsWith('on')) continue;
    const allowed = GLOBAL_ATTRS.has(name) || SAFE_ATTRS.has(name) || (CUSTOM_TAGS.has(tag) && CUSTOM_ATTRS.has(name));
    if (!allowed) continue;
    if (name === 'style') {
      const style = sanitizeHomeStyle(rawValue);
      if (Object.keys(style).length) attrs.style = style;
      continue;
    }
    if (name === 'href' || name === 'src') {
      const url = safeUrl(rawValue, name);
      if (url) attrs[name] = url;
      continue;
    }
    if (name === 'target') {
      if (rawValue === '_blank') attrs.target = '_blank';
      continue;
    }
    if (name === 'open') {
      attrs.open = true;
      continue;
    }
    attrs[name] = String(rawValue ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, 1000);
  }
  if (attrs.target === '_blank') attrs.rel = 'noreferrer noopener';
  return attrs;
}

function convertTree(parent, depth, budget) {
  const out = [];
  if (depth > MAX_DEPTH) return out;
  for (const child of parent.childNodes ?? []) {
    if (budget.count >= MAX_NODES) break;
    if (child.nodeName === '#text') {
      if (child.value) out.push({ type: 'text', value: child.value });
      continue;
    }
    if (child.nodeName === '#comment') continue;
    const tag = child.tagName?.toLowerCase();
    if (!tag || DROP_TAGS.has(tag)) continue;
    const children = convertTree(child, depth + 1, budget);
    if (!SAFE_TAGS.has(tag) && !CUSTOM_TAGS.has(tag)) {
      if (tag.startsWith('ac-')) {
        budget.count += 1;
        out.push({ type: 'element', tag, attrs: {}, children });
      } else {
        out.push(...children);
      }
      continue;
    }
    budget.count += 1;
    out.push({ type: 'element', tag, attrs: cleanAttributes(child, tag), children });
  }
  return out;
}

export function parseHomeLayout(html) {
  try {
    const source = String(html ?? '').replace(/<(ac-[a-z0-9-]+)([^>]*?)\s*\/\s*>/gi, '<$1$2></$1>');
    return convertTree(parseFragment(source), 0, { count: 0 });
  } catch {
    return [];
  }
}

export function normalizeHomeLayout(value, fallback = '') {
  return typeof value === 'string' && value.length <= HOME_LAYOUT_LIMIT ? value : fallback;
}

export function normalizeCfHandle(value) {
  return typeof value === 'string' ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100) : '';
}

export function normalizeHomeWeather(value) {
  const v = value && typeof value === 'object' ? value : {};
  const numberInRange = (input, min, max, fallback) => {
    if (input === '' || input == null) return fallback;
    const n = Number(input);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    city: typeof v.city === 'string' ? v.city.trim().slice(0, 80) : DEFAULT_HOME_WEATHER.city,
    latitude: numberInRange(v.latitude, -90, 90, DEFAULT_HOME_WEATHER.latitude),
    longitude: numberInRange(v.longitude, -180, 180, DEFAULT_HOME_WEATHER.longitude),
    unit: v.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
  };
}

export function widgetLimit(value, fallback = 6) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(24, Math.max(1, n)) : fallback;
}

const contestTime = (c) => {
  const t = new Date(c?.startTime ?? 0).getTime();
  return Number.isFinite(t) ? t : 0;
};

export function selectHomeContests(data, kind = 'recent', now = Date.now()) {
  if (kind === 'fetched') return [...(data?.fetchedContests ?? [])];
  const list = [...(data?.contests ?? [])];
  if (kind === 'upcoming') return list.filter((c) => contestTime(c) > now).sort((a, b) => contestTime(a) - contestTime(b));
  if (kind === 'latest') return list.sort((a, b) => contestTime(b) - contestTime(a));
  return list.filter((c) => contestTime(c) <= now).sort((a, b) => contestTime(b) - contestTime(a));
}

export function selectHomeProblems(data, kind = 'recent') {
  return [...(kind === 'fetched' ? data?.fetchedProblems ?? [] : data?.recentProblems ?? [])];
}

export function selectHistory(records, kind = 'viewed') {
  const practiced = kind === 'practiced';
  return [...(records ?? [])]
    .filter((r) => !practiced || r?.lastJudge?.at)
    .sort((a, b) => {
      const at = practiced ? (r) => r.lastJudge?.at ?? 0 : (r) => r.lastSeen ?? 0;
      return at(b) - at(a);
    });
}

export function inferContestId(record) {
  if (record?.contestId) return String(record.contestId);
  const id = String(record?.problemId ?? '');
  if (record?.platform === 'atcoder') return /^(?:abc|arc|agc|ahc|apc)\d+/i.exec(id)?.[0] ?? null;
  if (record?.platform === 'nowcoder') {
    const match = /^nc(\d+)/i.exec(id);
    return match?.[1] ?? null;
  }
  return /^\d+/.exec(id)?.[0] ?? null;
}

export function groupHistoryContests(records, kind = 'viewed') {
  const groups = new Map();
  for (const record of selectHistory(records, kind)) {
    const contestId = inferContestId(record);
    if (!contestId) continue;
    const key = `${record.platform}:${contestId}`;
    const at = kind === 'practiced' ? record.lastJudge?.at ?? 0 : record.lastSeen ?? 0;
    const current = groups.get(key);
    if (current) {
      current.problemCount += 1;
      current.lastAt = Math.max(current.lastAt, at);
      if (record.contestTitle) current.title = record.contestTitle;
      if (record.contestTitleZh) current.titleZh = record.contestTitleZh;
      if (record.lastJudge?.verdict === 'ac') current.accepted += 1;
      continue;
    }
    groups.set(key, {
      platform: record.platform,
      id: contestId,
      title: record.contestTitle ?? `${record.platform} · ${contestId}`,
      titleZh: record.contestTitleZh ?? null,
      lastAt: at,
      problemCount: 1,
      accepted: record.lastJudge?.verdict === 'ac' ? 1 : 0,
    });
  }
  return [...groups.values()].sort((a, b) => b.lastAt - a.lastAt);
}

const WEATHER_CODES = {
  0: ['晴朗', 'sun'], 1: ['大部晴朗', 'sun'], 2: ['局部多云', 'cloud-sun'], 3: ['阴天', 'cloud'],
  45: ['有雾', 'fog'], 48: ['雾凇', 'fog'], 51: ['小毛毛雨', 'rain'], 53: ['毛毛雨', 'rain'],
  55: ['大毛毛雨', 'rain'], 56: ['冻毛毛雨', 'rain'], 57: ['强冻毛毛雨', 'rain'],
  61: ['小雨', 'rain'], 63: ['中雨', 'rain'], 65: ['大雨', 'rain'], 66: ['冻雨', 'rain'],
  67: ['强冻雨', 'rain'], 71: ['小雪', 'snow'], 73: ['中雪', 'snow'], 75: ['大雪', 'snow'],
  77: ['雪粒', 'snow'], 80: ['小阵雨', 'rain'], 81: ['阵雨', 'rain'], 82: ['强阵雨', 'storm'],
  85: ['阵雪', 'snow'], 86: ['强阵雪', 'snow'], 95: ['雷暴', 'storm'], 96: ['雷暴伴冰雹', 'storm'],
  99: ['强雷暴伴冰雹', 'storm'],
};

export function weatherInfo(code) {
  return WEATHER_CODES[Number(code)] ?? ['未知天气', 'unknown'];
}
