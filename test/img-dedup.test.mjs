import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractImgSrcs, imgDedup } from '../lib/img-dedup.js';

/** lib/img-dedup.js 纯函数：对照模式图片去重（parse5 解析/序列化）。 */

test('extractImgSrcs: 收集全部 img src', () => {
  const html = '<p>前<img src="https://a/x.png" referrerpolicy="no-referrer">后</p><img src="https://b/y.jpg">';
  assert.deepEqual(extractImgSrcs(html), new Set(['https://a/x.png', 'https://b/y.jpg']));
});

test('extractImgSrcs: parse5 天然解码实体，&amp; 与字面 & 归一', () => {
  assert.deepEqual(
    extractImgSrcs('<img src="https://a/x.png?a=1&amp;b=2">'),
    new Set(['https://a/x.png?a=1&b=2']),
  );
});

test('extractImgSrcs: 无图 / 非字符串 → 空 Set', () => {
  assert.equal(extractImgSrcs('<p>无图</p>').size, 0);
  assert.equal(extractImgSrcs('').size, 0);
  assert.equal(extractImgSrcs(null).size, 0);
  assert.equal(extractImgSrcs(undefined).size, 0);
});

test('imgDedup: 删除 seenSrcs 命中的 img，其余内容原样', () => {
  const html = '<p>文字<img src="https://a/x.png" referrerpolicy="no-referrer" alt="图"></p>';
  assert.equal(imgDedup(html, new Set(['https://a/x.png'])), '<p>文字</p>');
});

test('imgDedup: ZH 独有图片保留', () => {
  const html = '<p><img src="https://zh/only.png">中文独有</p>';
  assert.equal(
    imgDedup(html, new Set(['https://en/x.png'])),
    '<p><img src="https://zh/only.png">中文独有</p>',
  );
});

test('imgDedup: 同段内重复 src 只保留第一张', () => {
  const html = '<p><img src="https://a/x.png">甲<img src="https://a/x.png">乙<img src="https://a/x.png"></p>';
  const out = imgDedup(html, new Set());
  assert.equal((out.match(/<img/g) || []).length, 1);
  assert.equal(out, '<p><img src="https://a/x.png">甲乙</p>');
});

test('imgDedup: 实体转义 src 与 seenSrcs 字面形式命中', () => {
  const html = '<img src="https://a/x.png?a=1&amp;b=2" referrerpolicy="no-referrer">';
  assert.equal(imgDedup(html, new Set(['https://a/x.png?a=1&b=2'])), '');
});

test('imgDedup: referrerpolicy 等属性不参与比较、保留的 img 属性原样', () => {
  const html = '<img src="https://keep/a.png" referrerpolicy="no-referrer" loading="lazy">';
  assert.equal(
    imgDedup(html, new Set(['https://drop/b.png'])),
    '<img src="https://keep/a.png" referrerpolicy="no-referrer" loading="lazy">',
  );
});

test('imgDedup: 非 img 内容（文本/表格/注释外内容）不受影响', () => {
  const html = '<table><tbody><tr><td>1</td></tr></tbody></table><p><strong>粗体</strong></p>';
  assert.equal(imgDedup(html, new Set(['https://a/x.png'])), html);
});

test('imgDedup: 空串 / 非字符串 → 空串', () => {
  assert.equal(imgDedup('', new Set()), '');
  assert.equal(imgDedup(null, new Set()), '');
  assert.equal(imgDedup(undefined, new Set()), '');
});
