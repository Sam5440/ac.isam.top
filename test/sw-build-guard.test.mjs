import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SW_SOURCE } from '../lib/pwa/sw-source.js';

/**
 * SW 导航版本门卫（旧界面问题修复）：
 *  - navigationHandler 在线且已知线上构建号时，缓存 HTML 构建号不一致 → 走网络；
 *  - 一致 / 探测失败（离线）→ 仍走 SWR 秒开（离线题库设计不受影响）；
 *  - revalidate 发现换版 → AC_STALE_RELOAD 通知页面自愈；
 *  - SW 源码依旧禁止模板字符串（外层是模板字面量）且必须可解析。
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('SW 源码可被解析为合法 JS（不执行）', () => {
  assert.doesNotThrow(() => new Function(SW_SOURCE));
});

test('SW 源码不含模板字符串（外层模板字面量约束）', () => {
  assert.equal(SW_SOURCE.includes('`'), false);
});

test('导航存在版本门卫：构建号不一致不回缓存', () => {
  assert.match(SW_SOURCE, /var netBuild = cached \? await getBuild\(\) : null;/);
  assert.match(SW_SOURCE, /cached\.headers\.get\('x-ac-build'\) !== netBuild/);
  // 已知过期分支必须先尝试网络，失败再回退缓存
  const start = SW_SOURCE.indexOf("cached.headers.get('x-ac-build') !== netBuild");
  const end = SW_SOURCE.indexOf('return cached;', start) + 'return cached;'.length;
  const staleBranch = SW_SOURCE.slice(start, end);
  assert.match(staleBranch, /await fetch\(req\)/);
  assert.match(staleBranch, /return fresh/);
  assert.match(staleBranch, /return cached/);
});

test('秒开路径保留：一致/未知构建号仍回缓存并后台刷新', () => {
  assert.match(SW_SOURCE, /event\.waitUntil\(revalidate\(req, servedBuild, event\.clientId\)\)/);
  assert.match(SW_SOURCE, /return cached;\s*\n\s*\}\s*\n\s*try \{\s*\n\s*var res = await fetch\(req\);/);
});

test('revalidate 换版时通知页面自愈重载（AC_STALE_RELOAD）', () => {
  assert.match(SW_SOURCE, /servedBuild !== currentBuild/);
  assert.match(SW_SOURCE, /type: 'AC_STALE_RELOAD'/);
});

test('构建号探测带 TTL 与超时，失败退回 SWR 不阻塞离线', () => {
  assert.match(SW_SOURCE, /var BUILD_URL = '\/ac-build\.json';/);
  assert.match(SW_SOURCE, /signal: timeoutSignal\(BUILD_TIMEOUT\)/);
  assert.match(SW_SOURCE, /self\.navigator && self\.navigator\.onLine === false/);
});

test('next.config 全站注入 X-AC-Build 响应头', () => {
  const cfg = readFileSync(join(root, 'next.config.mjs'), 'utf8');
  assert.match(cfg, /key: 'X-AC-Build'/);
  assert.match(cfg, /VERCEL_GIT_COMMIT_SHA/);
});

test('/ac-build.json 路由存在且 force-static', () => {
  const route = readFileSync(join(root, 'app/ac-build.json/route.js'), 'utf8');
  assert.match(route, /export const dynamic = 'force-static';/);
  assert.match(route, /build/);
});

test('PwaRegister 处理 AC_STALE_RELOAD 且按构建号去重', () => {
  const reg = readFileSync(join(root, 'components/PwaRegister.jsx'), 'utf8');
  assert.match(reg, /AC_STALE_RELOAD/);
  assert.match(reg, /sessionStorage/);
  assert.match(reg, /location\.reload\(\)/);
});
