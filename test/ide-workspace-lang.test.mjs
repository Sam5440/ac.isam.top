import test from 'node:test';
import assert from 'node:assert/strict';

import { langOf } from '../lib/ide-workspace.js';

test('langOf: 按扩展名识别 IDE 语言', () => {
  assert.equal(langOf('main.cpp'), 'cpp');
  assert.equal(langOf('dir/solution.cc'), 'cpp');
  assert.equal(langOf('a.py'), 'python');
  assert.equal(langOf('notes.md'), 'markdown');
  assert.equal(langOf('notes.markdown'), 'markdown');
  assert.equal(langOf('sample.txt'), 'text');
  assert.equal(langOf('input.out'), 'text');
  assert.equal(langOf('data.json'), 'json');
  assert.equal(langOf('main.js'), 'javascript');
  // 无扩展名保持历史行为（C++）
  assert.equal(langOf('Makefile'), 'cpp');
});