import { HOME_LAYOUT_LIMIT, normalizeHomeLayout } from './home-layout.mjs';
import { DEFAULT_HOME_LAYOUT } from './home-presets.mjs';

export const MAX_WIDTH = 4;
export const MAX_HEIGHT = 8;
export const MAX_WIDGETS = 48;

const kinds = { recent: '近期比赛', latest: '最新比赛', upcoming: '即将开始', fetched: '最近抓取' };
const historyKinds = { viewed: '最近看过', practiced: '最近做过' };
const platform = { label: '平台', options: { '': '全部平台', atcoder: 'AtCoder', codeforces: 'Codeforces', 'cf-gyms': 'CF Gyms', nowcoder: '牛客' } };
const limit = { label: '显示数量', min: 1, max: 24 };
const historyFields = { kind: { label: '记录类型', options: historyKinds }, limit: { ...limit, label: '题目数量' } };

export const CATALOG = {
  hero: { label: '站点介绍', group: '题库与比赛', size: [2, 2] },
  stats: { label: '题库统计', group: '题库与比赛', size: [2, 2] },
  contests: { label: '比赛列表', group: '题库与比赛', size: [2, 4], fields: { kind: { label: '比赛类型', options: kinds }, platform, limit: { ...limit, label: '比赛场数' } } },
  problems: { label: '题目列表', group: '题库与比赛', size: [2, 4], fields: { kind: { label: '题目类型', options: { recent: '最近收录', fetched: '最近抓取' } }, platform, limit: { ...limit, label: '题目数量' } } },
  history: { label: '题目记录', group: '个人记录', size: [2, 3], fields: historyFields },
  'history-contests': { label: '比赛记录', group: '个人记录', size: [2, 3], fields: { kind: historyFields.kind, limit: { ...limit, label: '比赛场数' } } },
  files: { label: '最近编辑', group: '个人记录', size: [2, 3], fields: { limit: { ...limit, label: '文件数量' } } },
  'cf-rating': { label: 'CF Rating', group: '个人记录', size: [2, 2], fields: { handle: { label: 'CF Handle', length: 100 } } },
  clock: { label: '时钟', group: '实用工具', size: [2, 2], fields: { name: { label: '问候称呼', length: 80 } } },
  weather: { label: '天气', group: '实用工具', size: [2, 2], fields: { city: { label: '天气城市', length: 80 }, unit: { label: '温度单位', options: { '': '使用默认', celsius: '摄氏度', fahrenheit: '华氏度' } } } },
  'site-update': { label: '数据更新时间', group: '实用工具', size: [2, 1] },
};

export function gridNumber(value, max, fallback = 1) {
  const number = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.max(1, Math.min(max, Math.round(number))) : fallback;
}

export function createWidget(type, id, raw = {}) {
  const spec = CATALOG[type];
  const height = gridNumber(raw.h, MAX_HEIGHT, spec.size[1]);
  const params = {};
  for (const [key, field] of Object.entries(spec.fields ?? {})) {
    const value = raw.params?.[key];
    if (field.options) params[key] = typeof value === 'string' && Object.hasOwn(field.options, value) ? value : Object.keys(field.options)[0];
    else if (key === 'limit') params.limit = gridNumber(value, limit.max, listCapacity(height));
    else params[key] = typeof value === 'string' ? value.trim().slice(0, field.length) : '';
  }
  return { id, type, params, w: gridNumber(raw.w, MAX_WIDTH, spec.size[0]), h: height };
}

export const DEFAULT_WIDGETS = ['hero', 'stats', 'contests', 'problems'].map((type) => createWidget(type, `classic-${type}`));

function listCapacity(height) {
  return height * 2 - 1;
}

export function resizeWidget(widget, width, height) {
  return { ...widget, w: gridNumber(width, MAX_WIDTH, widget.w), h: gridNumber(height, MAX_HEIGHT, widget.h) };
}

export function normalizeWidgets(raw) {
  if (!Array.isArray(raw)) return DEFAULT_WIDGETS;
  const used = new Set();
  const widgets = [];
  for (const value of raw.slice(0, MAX_WIDGETS)) {
    if (typeof value?.type !== 'string' || !Object.hasOwn(CATALOG, value.type)) continue;
    let id = value.id;
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id) || used.has(id)) {
      let serial = widgets.length + 1;
      do { id = `widget-${serial++}`; } while (used.has(id));
    }
    used.add(id);
    widgets.push(createWidget(value.type, id, value));
  }
  return !widgets.length && raw.length ? DEFAULT_WIDGETS : widgets;
}

export function normalizeHomeConfig(raw) {
  const html = raw?.homeLayout;
  const legacy = typeof html === 'string' && html.length <= HOME_LAYOUT_LIMIT && html !== DEFAULT_HOME_LAYOUT;
  return {
    homeLayoutMode: ['visual', 'html'].includes(raw?.homeLayoutMode) ? raw.homeLayoutMode : legacy ? 'html' : 'visual',
    homeLayout: normalizeHomeLayout(html, DEFAULT_HOME_LAYOUT),
    homeWidgets: normalizeWidgets(raw?.homeWidgets),
  };
}

export function insertWidget(widgets, widget, index) {
  const rest = widgets.filter((item) => item.id !== widget.id);
  rest.splice(Math.max(0, index), 0, widget);
  return rest;
}

export function packWidgets(widgets, columns) {
  const rows = [];
  return widgets.map(({ w, h }) => {
    const width = Math.min(columns, w);
    for (let row = 0; ; row++) {
      for (let col = 0; col <= columns - width; col++) {
        const mask = ((1 << width) - 1) << col;
        let offset = 0;
        while (offset < h && !(rows[row + offset] & mask)) offset++;
        if (offset !== h) continue;
        for (offset = 0; offset < h; offset++) rows[row + offset] = (rows[row + offset] || 0) | mask;
        return { row, col, w: width, h };
      }
    }
  });
}

export function widgetTitle(widget) {
  if (widget.type === 'contests') return kinds[widget.params.kind];
  if (widget.type === 'problems') return widget.params.kind === 'recent' ? '最近收录' : '最近抓取的题目';
  return CATALOG[widget.type].label;
}
