import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_HOME_WEATHER, HOME_LAYOUT_LIMIT, HOME_WIDGETS, groupHistoryContests,
  inferContestId, normalizeCfHandle, normalizeHomeLayout, normalizeHomeWeather,
  parseHomeLayout, sanitizeHomeStyle, selectHistory, selectHomeContests,
  selectHomeProblems, weatherInfo, widgetLimit,
} from '../lib/home-layout.mjs';
import { DEFAULT_HOME_LAYOUT, HOME_PRESETS, VISUAL_HOME_PRESETS } from '../lib/home-presets.mjs';
import { normalizeWidgets, packWidgets } from '../lib/home-grid.mjs';

function elements(nodes, tag = null) {
  const out = [];
  const visit = (items) => {
    for (const node of items) {
      if (node.type === 'element' && (!tag || node.tag === tag)) out.push(node);
      if (node.children) visit(node.children);
    }
  };
  visit(nodes);
  return out;
}

test('首页预设：至少 10 套、id 唯一、全部可解析且不含未知组件', () => {
  assert.ok(HOME_PRESETS.length >= 10);
  assert.equal(new Set(HOME_PRESETS.map((preset) => preset.id)).size, HOME_PRESETS.length);
  const known = new Set(HOME_WIDGETS.map((widget) => widget.tag));
  for (const preset of HOME_PRESETS) {
    const nodes = parseHomeLayout(preset.html);
    assert.ok(nodes.length > 0, preset.id);
    const custom = elements(nodes).filter((node) => node.tag.startsWith('ac-'));
    assert.ok(custom.length > 0, preset.id);
    for (const node of custom) assert.ok(known.has(node.tag), `${preset.id}: ${node.tag}`);
  }
  assert.equal(DEFAULT_HOME_LAYOUT, HOME_PRESETS[0].html);
});

test('可视化预设：恰好 10 套且覆盖手机电脑，单双四列均无重叠', () => {
  assert.equal(VISUAL_HOME_PRESETS.length, 10);
  assert.equal(new Set(VISUAL_HOME_PRESETS.map((preset) => preset.id)).size, 10);
  assert.ok(VISUAL_HOME_PRESETS.some((preset) => preset.device.includes('手机')));
  assert.ok(VISUAL_HOME_PRESETS.some((preset) => preset.device.includes('电脑')));
  for (const preset of VISUAL_HOME_PRESETS) {
    const widgets = normalizeWidgets(preset.widgets);
    assert.equal(widgets.length, preset.widgets.length, preset.id);
    assert.equal(new Set(widgets.map((widget) => widget.id)).size, widgets.length, preset.id);
    for (const columns of [1, 2, 4]) {
      const cells = packWidgets(widgets, columns);
      for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
          const a = cells[i];
          const b = cells[j];
          const overlap = a.col < b.col + b.w && a.col + a.w > b.col && a.row < b.row + b.h && a.row + a.h > b.row;
          assert.equal(overlap, false, `${preset.id} / ${columns} 列：${widgets[i].id} 与 ${widgets[j].id}`);
        }
      }
    }
  }
});

test('HTML 安全：删除脚本/iframe/事件属性/危险 URL，保留文本与安全组件', () => {
  const nodes = parseHomeLayout(`
    <div onclick="alert(1)" style="color: red; background-image: url(https://evil.example)">
      安全文本<script>window.pwned = true</script><iframe src="https://evil.example"></iframe>
      <a id="bad" href="javascript:alert(1)">坏链接</a>
      <a id="good" href="/problems" target="_blank">好链接</a>
      <img src="x" onerror="alert(1)" alt="题图">
      <ac-clock name="<img src=x onerror=alert(1)>"></ac-clock>
    </div>`);
  const serialized = JSON.stringify(nodes);
  assert.ok(!serialized.includes('script'));
  assert.ok(!serialized.includes('iframe'));
  assert.ok(!serialized.includes('onclick'));
  assert.equal(elements(nodes, 'img')[0].attrs.onerror, undefined);
  assert.ok(!serialized.includes('javascript:'));
  assert.ok(!serialized.includes('background-image'));
  assert.ok(serialized.includes('安全文本'));
  assert.equal(elements(nodes, 'a')[0].attrs.href, undefined);
  assert.deepEqual(elements(nodes, 'a')[1].attrs, {
    id: 'good', href: '/problems', target: '_blank', rel: 'noreferrer noopener',
  });
  assert.equal(elements(nodes, 'img')[0].attrs.src, 'x');
  assert.equal(elements(nodes, 'ac-clock')[0].attrs.name, '<img src=x onerror=alert(1)>');
});

test('HTML 解析：支持 ac 组件自闭合、普通 HTML 嵌套组件和实体文本', () => {
  const nodes = parseHomeLayout('<div><ac-clock /><span>&lt;安全&gt;</span><ac-weather city="上海" /></div>');
  assert.deepEqual(elements(nodes).map((node) => node.tag), ['div', 'ac-clock', 'span', 'ac-weather']);
  assert.equal(elements(nodes, 'ac-weather')[0].children.length, 0);
  assert.equal(elements(nodes, 'span')[0].children[0].value, '<安全>');
});

test('行内样式：仅保留布局白名单，拒绝 URL、表达式和 CSS 注入', () => {
  assert.deepEqual(sanitizeHomeStyle('display: grid; grid-template-columns: 1fr 1fr; color: #fff'), {
    display: 'grid', gridTemplateColumns: '1fr 1fr', color: '#fff',
  });
  assert.deepEqual(sanitizeHomeStyle('background: url(x); behavior: expression(x); position: fixed; padding: 4px'), {
    padding: '4px',
  });
});

test('设置归一化：布局长度、Handle、城市坐标和单位均有边界', () => {
  assert.equal(normalizeHomeLayout('', 'fallback'), '');
  assert.equal(normalizeHomeLayout(null, 'fallback'), 'fallback');
  assert.equal(normalizeHomeLayout('x'.repeat(HOME_LAYOUT_LIMIT + 1), 'fallback'), 'fallback');
  assert.equal(normalizeCfHandle('  tourist\n'), 'tourist');
  assert.equal(normalizeCfHandle(42), '');
  assert.deepEqual(normalizeHomeWeather({ city: ' 上海 ', latitude: '31.2', longitude: 121.5, unit: 'fahrenheit' }), {
    city: '上海', latitude: 31.2, longitude: 121.5, unit: 'fahrenheit',
  });
  assert.deepEqual(normalizeHomeWeather({ latitude: 999, longitude: null }), DEFAULT_HOME_WEATHER);
});

const contests = [
  { id: 'past', startTime: '2026-01-01T00:00:00Z' },
  { id: 'now', startTime: '2026-02-01T00:00:00Z' },
  { id: 'future', startTime: '2026-03-01T00:00:00Z' },
];
const now = new Date('2026-02-01T00:00:00Z').getTime();

test('比赛选择：recent/upcoming/latest/fetched 口径与排序正确', () => {
  const data = { contests, fetchedContests: [{ id: 'fetch' }] };
  assert.deepEqual(selectHomeContests(data, 'recent', now).map((c) => c.id), ['now', 'past']);
  assert.deepEqual(selectHomeContests(data, 'upcoming', now).map((c) => c.id), ['future']);
  assert.deepEqual(selectHomeContests(data, 'latest', now).map((c) => c.id), ['future', 'now', 'past']);
  assert.deepEqual(selectHomeContests(data, 'fetched', now).map((c) => c.id), ['fetch']);
  assert.equal(widgetLimit('99'), 24);
  assert.equal(widgetLimit('0'), 1);
  assert.equal(widgetLimit('bad', 7), 7);
});

test('题目选择：recent 与 fetched 不共享排序', () => {
  const data = { recentProblems: [{ id: 'r' }], fetchedProblems: [{ id: 'f' }] };
  assert.equal(selectHomeProblems(data)[0].id, 'r');
  assert.equal(selectHomeProblems(data, 'fetched')[0].id, 'f');
});

const history = [
  {
    platform: 'codeforces', problemId: '2000A', contestId: '2000', contestTitle: 'Round 1',
    lastSeen: 100, lastJudge: { verdict: 'ac', at: 300 },
  },
  {
    platform: 'codeforces', problemId: '2000B', contestId: '2000', contestTitle: 'Round 1',
    contestTitleZh: '第一场', lastSeen: 200, lastJudge: { verdict: 'fail', at: 400 },
  },
  {
    platform: 'atcoder', problemId: 'abc400a', lastSeen: 500,
    lastJudge: { verdict: null, at: null },
  },
];

test('历史选择：practiced 按判题时间排序，viewed 保留未判题记录', () => {
  assert.deepEqual(selectHistory(history, 'practiced').map((r) => r.problemId), ['2000B', '2000A']);
  assert.equal(selectHistory(history, 'viewed').length, 3);
  assert.equal(selectHistory(history, 'viewed')[0].problemId, 'abc400a');
});

test('比赛历史聚合：合并同场题目并兼容旧记录的比赛 id 推导', () => {
  const viewed = groupHistoryContests(history, 'viewed');
  assert.deepEqual(viewed.map((c) => c.id), ['abc400', '2000']);
  assert.equal(viewed[1].problemCount, 2);
  assert.equal(viewed[1].titleZh, '第一场');
  const practiced = groupHistoryContests(history, 'practiced');
  assert.equal(practiced.length, 1);
  assert.equal(practiced[0].lastAt, 400);
  assert.equal(practiced[0].accepted, 1);
  assert.equal(inferContestId({ platform: 'nowcoder', problemId: 'nc143406pa' }), '143406');
  assert.equal(inferContestId({ platform: 'cf-gyms', problemId: '106728E' }), '106728');
  assert.equal(inferContestId({ platform: 'unknown', problemId: 'abc' }), null);
});

test('天气代码：已知与未知代码都有中文说明', () => {
  assert.equal(weatherInfo(0)[0], '晴朗');
  assert.equal(weatherInfo(95)[0], '雷暴');
  assert.equal(weatherInfo(10000)[0], '未知天气');
});
