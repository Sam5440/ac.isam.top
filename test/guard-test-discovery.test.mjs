import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 测试发现守卫（2026-11-11 CI 连续 4 红的防复发护栏）。
 *
 * 根因链：裸 `node --test` 的默认发现会递归执行 scripts/、e2e/ 下的
 * 重型脚本（Playwright E2E 在 CI 无浏览器直接报错）；两次修复尝试分别
 * 败于「移动目录后默认发现仍递归捡到」与「Node 22 把 `node --test test/`
 * 目录参数按字面当 module 加载（Cannot find module .../test）」。
 * 最终修复 = package.json 固定显式 glob `test/*.test.mjs` + E2E 脚本改名
 * 迁出。本守卫防止这两层配置日后被无意回退：
 *   1. npm test 必须是「带通配符的显式 glob」，禁止裸 node --test / 目录参数；
 *   2. 类测试命名的文件只允许存在于 test/（防 E2E 命名污染被误发现）；
 *   3. test/ 内所有 *.test.* 必须是 .test.mjs（防被 glob 静默漏收）。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 永不入扫描的目录：依赖、构建产物、大数据、缓存与工作区杂项
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  '.vercel',
  '.zcode',
  '.claude',
  '.playwright-mcp',
  'data',
  'public',
  'sw',
  'coverage',
  'gui-test-screenshots',
  'review-2026-11-09',
]);

// 类测试命名：*.test.* / *.spec.* / *-test.*（历史根因 scripts/ide-v2-visual-test.js）
const TEST_LIKE = /(?:[.\-_]|^)(?:test|spec)\.[cm]?[jt]sx?$|-test\.[cm]?[jt]sx?$/;

function listTestLikeFiles(dir, rel = '') {
  const found = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) {
        found.push(...listTestLikeFiles(path.join(dir, e.name), path.join(rel, e.name)));
      }
      continue;
    }
    if (TEST_LIKE.test(e.name)) found.push(path.join(rel, e.name));
  }
  return found;
}

test('npm test 必须是显式 glob —— 禁止裸 node --test 或目录参数回退', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const cmd = pkg.scripts?.test ?? '';
  assert.match(cmd, /^node --test\b/, `test 脚本应以 node --test 开头，当前为 "${cmd}"`);
  assert.match(cmd, /\*/, `test 脚本必须带 glob 通配符限定 test/ 目录 —— 裸 node --test 会默认发现并执行 e2e/、scripts/ 下的重型脚本（2026-11-11 连续 4 红根因），目录参数在 Node 22 会按字面加载报 Cannot find module。当前为 "${cmd}"`);
});

test('类测试命名的文件只允许存在于 test/ 目录', () => {
  const offenders = listTestLikeFiles(ROOT).filter((f) => !f.startsWith(`test${path.sep}`));
  assert.deepEqual(
    offenders,
    [],
    `test/ 之外的类测试文件会被 node --test 默认发现误执行（Playwright E2E 曾以此打红 CI）。请移入 test/ 或改名去掉 test/spec 后缀：\n${offenders.join('\n')}`,
  );
});

test('test/ 内所有 *.test.* 文件必须是 .test.mjs —— 防被 npm test 的 glob 静默漏收', () => {
  const inTestDir = fs
    .readdirSync(path.join(ROOT, 'test'), { withFileTypes: true })
    .filter((e) => e.isFile() && /\.[cm]?[jt]sx?$/.test(e.name) && !/\.test\.mjs$/.test(e.name) && TEST_LIKE.test(e.name))
    .map((e) => e.name);
  assert.deepEqual(
    inTestDir,
    [],
    `npm test 的 glob 只收 test/*.test.mjs，以下文件会静默不被执行（放进来就必须可被发现）：\n${inTestDir.join('\n')}`,
  );
});
