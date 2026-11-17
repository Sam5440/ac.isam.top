/**
 * 题面分段（lib/statement-segments.js）单测：跨空行公式不能被切断。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBlocks } from '../lib/statement-segments.js';

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
