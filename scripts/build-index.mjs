#!/usr/bin/env node
/**
 * 重建 data/index.json：全量题目索引 + 统计 + 首页展示数据。
 * 被 scripts/fetch.mjs 在每次管道末尾调用，也在 next build 前执行
 * （见 package.json 的 build 脚本与 vercel.json 的 buildCommand）。
 */

import fs from 'node:fs';
import path from 'node:path';

import { writeJson } from './lib/util.mjs';

const DATA_ROOT = path.resolve(process.cwd(), 'data');

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readProblems(platform, brokenRef) {
  const dir = path.join(DATA_ROOT, platform, 'problems');
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const p = readJsonSafe(path.join(dir, f));
    // 损坏文件计数并上报（审查 管线-17）：旧实现静默跳过,索引与详情页
    // （直接读文件,同样失败 → notFound）口径不一致还无从排查
    if (!p?.id) {
      if (brokenRef) brokenRef.push(`${platform}/${f}`);
      continue;
    }
    out.push(p);
  }
  return out;
}

export function buildIndex() {
  const problems = [];
  const contests = [];
  const broken = [];
  for (const platform of ['atcoder', 'codeforces', 'cf-gyms', 'nowcoder']) {
    for (const p of readProblems(platform, broken)) problems.push(p);
    for (const c of readJsonSafe(path.join(DATA_ROOT, platform, 'contests.json')) ?? []) {
      contests.push(c);
    }
  }
  if (broken.length) {
    console.warn(`[build-index] ⚠ ${broken.length} 个损坏/空的题面文件未入索引：${broken.slice(0, 10).join(', ')}${broken.length > 10 ? ' …' : ''}`);
  }

  const byPlatform = {};
  for (const platform of ['atcoder', 'codeforces', 'cf-gyms', 'nowcoder']) {
    const ps = problems.filter((p) => p.platform === platform);
    const cs = contests.filter((c) => c.platform === platform);
    byPlatform[platform] = {
      contests: cs.length,
      problems: ps.length,
      translated: ps.filter((p) => p.statementZhMd).length,
    };
  }

  // 比赛聚合键：题面侧必须用 (platform, contestId) 而不是整题 id 拼接 ——
  // 题面 id（1181A / nc143199pa / agc079_a）与比赛 id（1181 / 143199 /
  // agc079）格式不同,旧实现直接 contestKey(problem) 导致 problemsByContest
  // 恒为空映射,recentContests 的 problemCount/translatedCount 长期失真。
  const contestKey = (c) => `${c.platform}:${c.id}`;
  const problemContestKey = (p) => `${p.platform}:${p.contestId}`;
  const problemsByContest = new Map();
  for (const p of problems) {
    const key = problemContestKey(p);
    (problemsByContest.get(key) ?? problemsByContest.set(key, []).get(key)).push(p);
  }
  // 已翻译题面 id 集合：contests.json 里登记但题面文件缺失/损坏的题，
  // translatedCount 也按登记 id 兜底统计（见 recentContests 映射）
  const translatedIds = new Set(problems.filter((p) => p.statementZhMd).map((p) => String(p.id)));

  const t = (c) => (c.startTime ? new Date(c.startTime).getTime() : 0);
  const sortedContests = contests
    .slice()
    .sort((a, b) => t(b) - t(a) || String(b.id).localeCompare(String(a.id), undefined, { numeric: true }));

  const recentContests = sortedContests.slice(0, 12).map((c) => {
    const ps = problemsByContest.get(contestKey(c)) ?? [];
    return {
      id: c.id,
      platform: c.platform,
      title: c.title,
      titleZh: c.titleZh ?? null,
      startTime: c.startTime,
      problemCount: ps.length || (c.problems ?? []).length,
      translatedCount: ps.length
        ? ps.filter((p) => p.statementZhMd).length
        : (c.problems ?? []).filter((id) => translatedIds.has(String(id))).length,
    };
  });

  // 「最新题目」按所属比赛的 startTime 降序（同场内按题号升序）。
  // 旧实现按 fetchedAt 排序 —— 每轮 CI 的 backfill 都会给历史老题打上新鲜
  // 的 fetchedAt,把新比赛的题挤出前 12（2026-11-09 实际触发：周赛 Round 169
  // 入库当晚,首页被 CF 1267 等 2018 年回填题占满,看起来像「新赛没拉到」）。
  const startTimeByContest = new Map(contests.map((c) => [contestKey(c), t(c)]));
  const recentProblems = problems
    .slice()
    .sort(
      (a, b) =>
        (startTimeByContest.get(problemContestKey(b)) ?? 0) -
          (startTimeByContest.get(problemContestKey(a)) ?? 0) ||
        String(a.index ?? '').localeCompare(String(b.index ?? ''), undefined, { numeric: true }) ||
        String(b.fetchedAt ?? '').localeCompare(String(a.fetchedAt ?? '')),
    )
    .slice(0, 12)
    .map((p) => ({
      id: p.id,
      platform: p.platform,
      contestId: p.contestId,
      index: p.index,
      title: p.title,
      titleZh: p.titleZh ?? null,
      difficulty: p.difficulty ?? null,
      translated: Boolean(p.statementZhMd),
    }));

  // 全量轻量索引（/problems 浏览页用）
  const problemIndex = problems.map((p) => ({
    id: p.id,
    platform: p.platform,
    contestId: p.contestId,
    index: p.index,
    title: p.title,
    titleZh: p.titleZh ?? null,
    difficulty: p.difficulty ?? null,
    translated: Boolean(p.statementZhMd),
  }));

  const body = {
    stats: {
      problems: problems.length,
      contests: contests.length,
      translated: problems.filter((p) => p.statementZhMd).length,
      byPlatform,
    },
    recentContests,
    recentProblems,
    problems: problemIndex,
  };

  // generatedAt 仅在内容实体变化时更新（审查 管线-3 根因组合之一）：旧实现
  // 无条件取 new Date(),零数据变更的运行也必然产生一个新提交,与人工 push
  // 撞车概率最大化。内容未变时沿用旧时间戳 → git diff 为空 → CI 跳过提交。
  const existing = readJsonSafe(path.join(DATA_ROOT, 'index.json'));
  const unchanged =
    existing &&
    existing.stats?.problems === body.stats.problems &&
    existing.stats?.contests === body.stats.contests &&
    existing.stats?.translated === body.stats.translated &&
    JSON.stringify(existing.recentContests) === JSON.stringify(body.recentContests) &&
    JSON.stringify(existing.recentProblems) === JSON.stringify(body.recentProblems) &&
    JSON.stringify(existing.problems) === JSON.stringify(body.problems);

  const index = {
    generatedAt: unchanged && existing.generatedAt ? existing.generatedAt : new Date().toISOString(),
    ...body,
  };

  writeJson(path.join(DATA_ROOT, 'index.json'), index);
  return index;
}

// 直接运行时构建
const isMain = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (isMain) {
  const idx = buildIndex();
  console.log(
    `[build-index] problems=${idx.stats.problems} contests=${idx.stats.contests} translated=${idx.stats.translated}`,
  );
}
