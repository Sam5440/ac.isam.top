import fs from 'node:fs';
import path from 'node:path';

import { PLATFORMS } from './platforms.js';

export { PLATFORMS, platformOf } from './platforms.js';

const DATA_ROOT = path.join(process.cwd(), 'data');

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 全部比赛（含两平台），按开始时间倒序。 */
export function getAllContests() {
  const all = [];
  for (const p of PLATFORMS) {
    const arr = readJsonSafe(path.join(DATA_ROOT, p.id, 'contests.json')) ?? [];
    all.push(...arr);
  }
  all.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  return all;
}

export function getContests(platform) {
  return (readJsonSafe(path.join(DATA_ROOT, platform, 'contests.json')) ?? [])
    .slice()
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
}

export function getContest(platform, contestId) {
  const cid = String(contestId).toLowerCase();
  return (
    getContests(platform).find((c) => String(c.id).toLowerCase() === cid) ?? null
  );
}

export function getProblem(platform, problemId) {
  const file = path.join(DATA_ROOT, platform, 'problems', `${String(problemId).toLowerCase()}.json`);
  return readJsonSafe(file);
}

export function getProblemsOfContest(contest) {
  const out = [];
  for (const pid of contest.problems ?? []) {
    const p = getProblem(contest.platform, pid);
    if (p) out.push(p);
  }
  out.sort((a, b) => a.index.localeCompare(b.index, undefined, { numeric: true }));
  return out;
}

/** 轻量题目索引（data/index.json，由 scripts/build-index.mjs 生成）。 */
export function getIndex() {
  return readJsonSafe(path.join(DATA_ROOT, 'index.json'));
}

/** 全量题目列表（索引缺失时从文件系统现场收集，供构建兜底）。 */
export function getAllProblems() {
  const idx = getIndex();
  if (idx?.problems) return idx.problems;
  const all = [];
  for (const p of PLATFORMS) {
    const dir = path.join(DATA_ROOT, p.id, 'problems');
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const p2 = readJsonSafe(path.join(dir, f));
      if (p2) all.push(p2);
    }
  }
  return all;
}
