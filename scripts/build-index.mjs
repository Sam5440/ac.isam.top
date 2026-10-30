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

function readProblems(platform) {
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
    if (p?.id) out.push(p);
  }
  return out;
}

export function buildIndex() {
  const problems = [];
  const contests = [];
  for (const platform of ['atcoder', 'codeforces']) {
    for (const p of readProblems(platform)) problems.push(p);
    for (const c of readJsonSafe(path.join(DATA_ROOT, platform, 'contests.json')) ?? []) {
      contests.push(c);
    }
  }

  const byPlatform = {};
  for (const platform of ['atcoder', 'codeforces']) {
    const ps = problems.filter((p) => p.platform === platform);
    const cs = contests.filter((c) => c.platform === platform);
    byPlatform[platform] = {
      contests: cs.length,
      problems: ps.length,
      translated: ps.filter((p) => p.statementZhMd).length,
    };
  }

  const contestKey = (c) => `${c.platform}:${c.id}`;
  const problemsByContest = new Map();
  for (const p of problems) {
    const key = contestKey(p);
    (problemsByContest.get(key) ?? problemsByContest.set(key, []).get(key)).push(p);
  }

  const sortedContests = contests
    .slice()
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

  const recentContests = sortedContests.slice(0, 12).map((c) => {
    const ps = problemsByContest.get(contestKey(c)) ?? [];
    return {
      id: c.id,
      platform: c.platform,
      title: c.title,
      titleZh: c.titleZh ?? null,
      startTime: c.startTime,
      problemCount: ps.length || (c.problems ?? []).length,
      translatedCount: ps.filter((p) => p.statementZhMd).length,
    };
  });

  const recentProblems = problems
    .slice()
    .sort((a, b) => String(b.fetchedAt ?? '').localeCompare(String(a.fetchedAt ?? '')))
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

  const index = {
    generatedAt: new Date().toISOString(),
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
