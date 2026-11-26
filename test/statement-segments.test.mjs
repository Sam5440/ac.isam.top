/**
 * 题面分段（lib/statement-segments.js）单测：跨空行公式不能被切断。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairSegments, splitBlocks } from '../lib/statement-segments.js';

test('splitBlocks: 普通段落按空行切分', () => {
  assert.deepEqual(splitBlocks('a\n\nb\n\nc'), ['a', 'b', 'c']);
  assert.deepEqual(splitBlocks(''), []);
});

test('splitBlocks: 跨空行的大公式保持完整（1060h 的交互表）', () => {
  const md = [
    'para one',
    '',
    '$\\begin{array}{|c|c|} \\hline a & b \\\\',
    '',
    '\\hline c & d \\\\',
    '',
    '\\end{array}$',
    '',
    'para two',
  ].join('\n');
  const blocks = splitBlocks(md);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[1].includes('\\begin{array}'), true);
  assert.equal(blocks[1].includes('\\end{array}$'), true);
});

test('splitBlocks: 围栏代码块内的空行不切分（原有行为不变）', () => {
  assert.deepEqual(splitBlocks('x\n\n```\n\ncode\n\n```\n\ny'), [
    'x',
    '```\n\ncode\n\n```',
    'y',
  ]);
});

test('pairSegments: 中文侧多出纯图片段时仍能逐段配对', () => {
  // 题册解析把插图单独成段、英文侧同图被去重 → 块数不等；
  // 旧实现会整篇退化成单段，除首段外全部拿不到译文
  const en = ['intro text', 'answer'];
  const zh = ['中文引入', '![](data:image/webp;base64,AAAA)', '中文答案'];
  assert.deepEqual(pairSegments(en.join('\n\n'), zh.join('\n\n')), [
    { en: 'intro text', zh: '中文引入' },
    { en: 'answer', zh: '中文答案' },
  ]);
});

test('pairSegments: 中英小节标题一致时逐节对齐（含无标题引言）', () => {
  const en = ['Lead in.', '', '#### Input', '', 'two ints', '', '#### Output', '', 'one int'];
  const zh = ['引言。', '', '#### 输入', '', '两个整数', '', '#### 输出', '', '一个整数'];
  assert.deepEqual(pairSegments(en.join('\n'), zh.join('\n')), [
    { en: 'Lead in.', zh: '引言。' },
    { en: '#### Input', zh: '#### 输入' },
    { en: 'two ints', zh: '两个整数' },
    { en: '#### Output', zh: '#### 输出' },
    { en: 'one int', zh: '一个整数' },
  ]);
});
