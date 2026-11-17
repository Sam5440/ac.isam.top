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
  assert.match(cfg, /import \{ BUILD_ID \} from '\.\/lib\/build-id\.mjs';/);
  assert.match(cfg, /value: BUILD_ID/);
});

test('构建号单一事实来源：lib/build-id.mjs（env 读取只在这里）', () => {
  const lib = readFileSync(join(root, 'lib/build-id.mjs'), 'utf8');
  assert.match(lib, /VERCEL_GIT_COMMIT_SHA/);
  assert.match(lib, /VERCEL_DEPLOYMENT_ID/);
  // 端点与页面 meta 必须同源，否则「本页是否旧版」的判定会自相矛盾
  const route = readFileSync(join(root, 'app/ac-build.json/route.js'), 'utf8');
  assert.match(route, /import \{ BUILD_ID \} from '@\/lib\/build-id\.mjs';/);
  const layout = readFileSync(join(root, 'app/layout.jsx'), 'utf8');
  assert.match(layout, /<meta name="ac-build" content=\{BUILD_ID\} \/>/);
});

test('RSC 载荷也走版本门卫：跨版本不回缓存 + revalidate 带 servedBuild', () => {
  const start = SW_SOURCE.indexOf('async function rscHandler');
  const end = SW_SOURCE.indexOf('async function cacheFirst', start);
  const body = SW_SOURCE.slice(start, end);
  assert.ok(start > 0 && end > start, 'rscHandler 必须存在');
  assert.match(body, /var netBuild = cached \? await getBuild\(\) : null;/);
  assert.match(body, /var servedBuild = cached \? cached\.headers\.get\('x-ac-build'\) : null;/);
  assert.match(body, /cached && netBuild && servedBuild !== netBuild/);
  assert.match(body, /await fetch\(req\)/);
  assert.match(body, /event\.waitUntil\(revalidate\(req, servedBuild, event\.clientId\)\)/);
  // 离线未命中的 307 回退仍必须在（绝不能把 503 HTML 当 flight 载荷）
  assert.match(body, /Response\.redirect\(plain, 307\)/);
});

test('构建号探测失败只短顺延（BUILD_RETRY_TTL），不再长时间盲判', () => {
  assert.match(SW_SOURCE, /var BUILD_RETRY_TTL = \d+ \* 1000;/);
  assert.match(SW_SOURCE, /currentBuildAt = Date\.now\(\) - \(BUILD_TTL - BUILD_RETRY_TTL\);/);
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
test('错误边界：认出换版残留/服务端渲染错误，并提供自愈与清理缓存出口', () => {
  const src = readFileSync(join(root, 'app/error.jsx'), 'utf8');
  // 归类逻辑在纯模块里（可单测），错误边界只消费
  assert.match(src, /classifyClientError/);
  assert.match(src, /'@\/lib\/error-classify\.mjs'/);
  // 换版自愈：本页 meta 构建号 vs 线上 /ac-build.json，一致才判定为真异常
  assert.match(src, /meta\[name="ac-build"\]/);
  assert.match(src, /fetch\('\/ac-build\.json'/);
  assert.match(src, /dropPageCacheEntries/);
  // 主动作是整页刷新（reset 原地重渲对旧缓存无效），并要求清理页面缓存后刷新
  assert.match(src, /location\.reload\(\)/);
  assert.match(src, /清理页面缓存并刷新/);
  // 只丢页面/壳缓存：离线题库资源(ac-assets)、编译器运行时(ac-runtime /
  // compiler-runtime-v1) 所在的桶不得被删 —— 断言清理清单本身的内容
  const purgeDecl = src.match(/const PURGE_CACHES = \[([^\]]*)\];/);
  assert.ok(purgeDecl, 'PURGE_CACHES 必须存在');
  const purged = [...purgeDecl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(purged, ['ac-pages', 'ac-shell']);
});
