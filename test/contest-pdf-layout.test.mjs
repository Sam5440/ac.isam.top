import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PDF_PAGE,
  coverColumnCount,
  formatTimeLimit,
  limitLine,
  pageFooterLines,
  planSlices,
  problemHeaderMetrics,
  problemStartPages,
  problemTitles,
} from '../lib/contest-pdf-layout.mjs';

test('problemHeaderMetrics: 标题行数与副标题只影响首页可用高度', () => {
  const one = problemHeaderMetrics({ titleLines: 1 });
  const two = problemHeaderMetrics({ titleLines: 2 });
  const sub = problemHeaderMetrics({ titleLines: 1, hasSecondary: true });
  assert.ok(two.contentTop > one.contentTop);
  assert.ok(sub.contentTop > one.contentTop);
  assert.ok(two.firstHeight < one.firstHeight);
  assert.equal(one.height, PDF_PAGE.contentBottom - PDF_PAGE.continuationTop);
  assert.ok(one.firstHeight > 0 && one.height > 0);
});

test('planSlices: 首页与续页容量不同，切片点吸附空白行', () => {
  const breaks = new Set([380, 660, 940]);
  const slices = planSlices(1000, {
    firstHeight: 400,
    height: 300,
    findBreak: (target) => {
      for (let d = 0; d <= 40; d += 1) if (breaks.has(target - d)) return target - d;
      return target;
    },
  });
  assert.deepEqual(
    slices.map((s) => [s.y, s.h]),
    [[0, 380], [380, 280], [660, 280], [940, 60]],
  );
  assert.equal(slices[0].h, 380);
  assert.ok(slices[1].h <= 300);
});

test('planSlices: 没有空白行时按页面容量硬切，绝不超出页面', () => {
  const slices = planSlices(950, { firstHeight: 400, height: 300, findBreak: () => 1 });
  assert.deepEqual(
    slices.map((s) => s.h),
    [400, 300, 250],
  );
});

test('planSlices: 原子块给出的强制断点即使很靠前也保留', () => {
  const slices = planSlices(1000, {
    firstHeight: 400,
    height: 300,
    findBreak: (target, start) => (start === 0 ? { y: 120, force: true } : { y: target, force: false }),
  });
  assert.deepEqual(
    slices.map((s) => s.h),
    [120, 300, 300, 280],
  );
});

test('planSlices: 空内容也给一页占位', () => {
  assert.deepEqual(planSlices(0, { firstHeight: 400, height: 300 }), [{ y: 0, h: 0 }]);
});

test('problemTitles: 中英标题在不同模式下主副互换', () => {
  const problem = { title: 'Three Vertices', titleZh: '三个顶点' };
  assert.deepEqual(problemTitles(problem, 'zh'), { primary: '三个顶点', secondary: 'Three Vertices' });
  assert.deepEqual(problemTitles(problem, 'both'), { primary: '三个顶点', secondary: 'Three Vertices' });
  assert.deepEqual(problemTitles(problem, 'en'), { primary: 'Three Vertices', secondary: '三个顶点' });
  assert.deepEqual(problemTitles({ title: 'Only EN' }, 'zh'), { primary: 'Only EN', secondary: '' });
});

test('题头限制行与页脚文案', () => {
  assert.equal(formatTimeLimit(2000, 'zh'), '时间限制：2 秒');
  assert.equal(formatTimeLimit(1500, 'en'), 'Time limit: 1.5 seconds');
  assert.equal(limitLine({ timeLimitMs: 2000, memoryLimitMb: 1024 }, 'zh'), '时间限制：2 秒　·　内存限制：1024 MB');
  assert.match(limitLine({ timeLimitMs: 2000, memoryLimitMb: 1024 }, 'both'), /Time limit: 2 seconds/);
  const footer = pageFooterLines({ pageNumber: 3, totalPages: 9 });
  assert.equal(footer[0].text, 'ac.yslsy.top');
  assert.equal(footer[1].text, 'Page 3 of 9');
  assert.equal(footer[1].align, 'center');
});

test('封面列数与每题起始页', () => {
  assert.equal(coverColumnCount(4), 1);
  assert.equal(coverColumnCount(15), 2);
  assert.equal(coverColumnCount(40), 3);
  assert.deepEqual(problemStartPages([1, 3, 2]), [1, 2, 5]);
});
