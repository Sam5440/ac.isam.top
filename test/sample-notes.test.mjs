import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyNoteTranslations,
  meaningfulNote,
  needsNotesTranslation,
  pendingNoteIndices,
} from '../lib/sample-notes.js';

test('meaningfulNote: 过滤 CF 的 Input/Copy/Output/Copy 样板说明', () => {
  assert.equal(meaningfulNote('Input\n\nCopy\n\nOutput\n\nCopy'), '');
  assert.equal(meaningfulNote('  Copy  '), '');
  assert.equal(meaningfulNote(''), '');
  assert.equal(meaningfulNote(null), '');
});

test('meaningfulNote: 过滤俄语页面的样板标签（CF 俄语 locale）', () => {
  assert.equal(meaningfulNote('Входные данныеCopy\n\nВыходные данныеCopy'), '');
  assert.equal(meaningfulNote('Входные данные\n\nCopy\n\nВыходные данные\n\nCopy'), '');
});

test('meaningfulNote: 保留真实说明并去掉首尾空白', () => {
  assert.equal(
    meaningfulNote('  The balls numbered $2,4,6,8,9$ remain on the table.  '),
    'The balls numbered $2,4,6,8,9$ remain on the table.',
  );
  // 说明里出现 Input/Output 单词（非整段样板）不算垃圾
  assert.equal(meaningfulNote('Input 5 3, output is 2.'), 'Input 5 3, output is 2.');
});

test('pendingNoteIndices: 只挑「有实质 note、无 noteZh」的样例', () => {
  const samples = [
    { input: '5', output: '2', note: 'first explanation' },
    { input: '4', output: '-1', note: 'second explanation', noteZh: '第二条说明' },
    { input: '3', output: '6' },
    { input: '2', output: '1', note: 'Input\n\nCopy\n\nOutput\n\nCopy' },
    { input: '1', output: '0', note: '   ' },
  ];
  assert.deepEqual(pendingNoteIndices(samples), [0]);
});

test('pendingNoteIndices: 空/异常输入返回空数组（不抛错）', () => {
  assert.deepEqual(pendingNoteIndices(undefined), []);
  assert.deepEqual(pendingNoteIndices(null), []);
  assert.deepEqual(pendingNoteIndices([]), []);
  assert.deepEqual(pendingNoteIndices([null, 'x', 0]), []);
});

test('needsNotesTranslation: 整题判定与下标口径一致', () => {
  assert.equal(needsNotesTranslation({ samples: [{ note: 'explain' }] }), true);
  assert.equal(needsNotesTranslation({ samples: [{ note: 'explain', noteZh: '说明' }] }), false);
  assert.equal(needsNotesTranslation({ samples: [{ note: 'Input\nCopy' }] }), false);
  assert.equal(needsNotesTranslation({}), false);
  assert.equal(needsNotesTranslation(null), false);
});

test('needsNotesTranslation: 官方中文题（language=zh）不进队列', () => {
  assert.equal(needsNotesTranslation({ language: 'zh', samples: [{ note: '总分为 3×100。' }] }), false);
  assert.equal(needsNotesTranslation({ language: 'en', samples: [{ note: 'explain' }] }), true);
});

test('applyNoteTranslations: 按 indices 一一对应写入，空译文不写', () => {
  const samples = [
    { input: '5', output: '2', note: 'a' },
    { input: '4', output: '-1', note: 'b' },
    { input: '3', output: '6', note: 'c' },
  ];
  const next = applyNoteTranslations(samples, [0, 2], ['甲', '   ']);
  assert.equal(next[0].noteZh, '甲');
  assert.equal(next[2].noteZh, undefined); // 空译文保持原样，下轮重试
  assert.equal(next[1].noteZh, undefined);
  // 其余字段保留
  assert.equal(next[0].note, 'a');
  assert.equal(next[2].input, '3');
  // 不修改入参
  assert.equal(samples[0].noteZh, undefined);
});

test('applyNoteTranslations: 越界下标/异常输入安全', () => {
  const next = applyNoteTranslations([{ note: 'a' }], [5], ['x']);
  assert.equal(next.length, 1);
  assert.equal(next[0].noteZh, undefined);
  assert.deepEqual(applyNoteTranslations(undefined, [0], ['x']), []);
  assert.deepEqual(applyNoteTranslations([null], [0], ['x']), [null]);
});
