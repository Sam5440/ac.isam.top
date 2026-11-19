/**
 * 空选区整行复制 / 剪切：剪贴板文本与删除区间的纯函数。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lineClipboardPayload } from '../lib/compiler/line-clipboard.js';

const caret = (line, col = 1) => ({
  startLineNumber: line,
  startColumn: col,
  endLineNumber: line,
  endColumn: col,
});
const range = (a, b = a, c = 1, d = 1) => ({
  startLineNumber: a,
  startColumn: b,
  endLineNumber: c,
  endColumn: d,
});

test('单行：复制整行内容 + 行尾换行，剪切区间吞掉整行', () => {
  const out = lineClipboardPayload(['aa', 'bb', 'cc'], [caret(2)]);
  assert.deepEqual(out, { text: 'bb\n', ranges: [range(2, 1, 3, 1)] });
});

test('光标在行中任意列都裁到整行', () => {
  assert.equal(lineClipboardPayload(['#include <x>', 'int main() {}'], [caret(2, 5)]).text, 'int main() {}\n');
});

test('最后一行（文件末尾无换行）：删内容 + 前一个换行，不留空行', () => {
  const out = lineClipboardPayload(['aa', 'bb'], [caret(2)]);
  assert.deepEqual(out, { text: 'bb\n', ranges: [range(1, 3, 2, 3)] });
});

test('单行文件：区间覆盖整行内容', () => {
  const out = lineClipboardPayload(['abc'], [caret(1, 2)]);
  assert.deepEqual(out, { text: 'abc\n', ranges: [range(1, 1, 1, 4)] });
});

test('多光标：按行去重升序，相邻行合并成一段（区间不重叠）', () => {
  const out = lineClipboardPayload(['a', 'b', 'c', 'd', 'e'], [caret(4), caret(3), caret(3)]);
  assert.equal(out.text, 'c\nd\n');
  assert.deepEqual(out.ranges, [range(3, 1, 5, 1)]);
});

test('多光标命中末行：合并段同样吞前一个换行', () => {
  const out = lineClipboardPayload(['a', 'b', 'c'], [caret(2), caret(3)]);
  assert.equal(out.text, 'b\nc\n');
  assert.deepEqual(out.ranges, [range(1, 2, 3, 2)]);
});

test('空行也能复制与剪切', () => {
  const out = lineClipboardPayload(['', ''], [caret(1)]);
  assert.deepEqual(out, { text: '\n', ranges: [range(1, 1, 2, 1)] });
});

test('有真实选区时不接管（返回 null，交回浏览器默认复制）', () => {
  const sel = { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 5 };
  assert.equal(lineClipboardPayload(['hello'], [sel]), null);
  assert.equal(lineClipboardPayload(['hello'], [caret(1), sel]), null);
});

test('输入不可用或越界时返回 null', () => {
  assert.equal(lineClipboardPayload([], [caret(1)]), null);
  assert.equal(lineClipboardPayload(['a'], []), null);
  assert.equal(lineClipboardPayload(['a'], null), null);
  assert.equal(lineClipboardPayload(['a'], [caret(2)]), null);
});
