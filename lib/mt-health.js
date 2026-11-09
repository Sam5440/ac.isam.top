'use client';

/**
 * 翻译渠道体检：对每个本机机器翻译渠道连发 N 次真实翻译请求，统计成功率
 * 与平均耗时，结果存 localStorage（stmt-mt-stats-v1），供设置页排行展示与
 * 「按成功率重排优先级链」使用。
 *
 * - 渠道之间并行，渠道内串行节流（gapMs，默认 800ms），比正式翻译的 3s
 *   间隔激进、比无节流安全；随时可通过 signal 中止。
 * - 成功 = 返回非空译文且无异常。
 * - 'ai'（CI 翻译）为仓库存档、无实时接口，不参与测试；'ai_custom' 需要
 *   用户已配置接口（cfg 从设置传入）。
 */

import { mtTranslate } from '@/lib/client-mt';
import { aiTranslate } from '@/components/ai-translate';

export const MT_HEALTH_KEY = 'stmt-mt-stats-v1';

/** 体检样本：一段含公式、行内代码与列表的典型题面（走同一占位符保护路径）。 */
export const HEALTH_SAMPLE = [
  'You are given a tree with $n$ vertices rooted at vertex $1$.',
  'Each vertex $v$ has an integer value `a[v]` written on it.',
  'Your task is to compute the maximum total tastiness along any root-to-leaf path, i.e. $\\max \\sum a[v]$ over all leaves.',
  'It is guaranteed that $1 \\le n \\le 2 \\cdot 10^5$ and $-10^9 \\le a[v] \\le 10^9$.',
].join('\n');

export function loadMtStats() {
  if (typeof window === 'undefined') return {};
  try {
    const v = JSON.parse(window.localStorage.getItem(MT_HEALTH_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function saveMtStats(stats) {
  try {
    window.localStorage.setItem(MT_HEALTH_KEY, JSON.stringify(stats));
  } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 单渠道测试：连发 count 次，返回 { success, attempted, avgMs }。
 * onProgress({ channel, done, success }) 每次请求后回调。
 */
export async function testChannel({ channel, cfg, sample = HEALTH_SAMPLE, count = 50, gapMs = 800, signal, onProgress }) {
  let success = 0;
  let attempted = 0;
  let totalMs = 0;
  for (let i = 1; i <= count; i++) {
    if (signal?.aborted) break;
    const t0 = performance.now();
    try {
      const out = channel === 'ai_custom' ? await aiTranslate(sample, cfg, { signal }) : await mtTranslate(channel, sample);
      const ms = performance.now() - t0;
      if (out && String(out).trim()) {
        success += 1;
        totalMs += ms;
      }
    } catch {}
    attempted = i;
    onProgress?.({ channel, done: i, success });
    if (i < count && !signal?.aborted) await sleep(gapMs);
  }
  return { success, attempted, avgMs: success ? Math.round(totalMs / success) : null };
}

/**
 * 多渠道并行体检。完成后把结果合并进本地统计并持久化（含 testedAt）。
 * 返回 { [channel]: { success, attempted, avgMs, testedAt } }。
 */
export async function runHealthCheck({ channels, cfg, count = 50, gapMs = 800, sample, signal, onProgress }) {
  const settled = await Promise.all(
    channels.map(async (channel) => {
      const r = await testChannel({ channel, cfg, count, gapMs, sample, signal, onProgress });
      return [channel, { ...r, testedAt: new Date().toISOString() }];
    }),
  );
  const next = { ...loadMtStats() };
  for (const [ch, stat] of settled) {
    if (stat.attempted > 0) next[ch] = stat;
  }
  saveMtStats(next);
  return next;
}

/** 清空体检统计。 */
export function clearMtStats() {
  try {
    window.localStorage.removeItem(MT_HEALTH_KEY);
  } catch {}
}

/** 按成功率降序的排行视图：[{ channel, ...stat, rate }]。 */
export function rankedStats(stats) {
  return Object.entries(stats || {})
    .filter(([, s]) => s && s.attempted > 0)
    .map(([channel, s]) => ({
      channel,
      ...s,
      rate: s.success / s.attempted,
    }))
    .sort((a, b) => b.rate - a.rate || (a.avgMs ?? 1e9) - (b.avgMs ?? 1e9));
}
