import fs from 'node:fs';
import path from 'node:path';

import { PLATFORMS } from './platforms.js';
import { getIndexData, getProblemSummaries } from './problem-index.js';

export { PLATFORMS, platformOf } from './platforms.js';

const DATA_ROOT = path.join(process.cwd(), 'data');
const jsonCache = new Map();

function readJsonSafe(file) {
  try {
    // Keep only the shared metadata in memory, not every full problem statement.
    const cacheable = file.endsWith(`${path.sep}contests.json`);
    if (!cacheable) return JSON.parse(fs.readFileSync(file, 'utf8'));
    const stat = fs.statSync(file);
    const version = `${stat.mtimeMs}:${stat.size}`;
    const previous = jsonCache.get(file);
    if (previous?.version === version) return previous.value;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    jsonCache.set(file, { version, value });
    return value;
  } catch {
    return null;
  }
}

/** 全部比赛（含三平台），按开始时间倒序（无时间的牛客历史赛按 id 排在其后）。 */
export function getAllContests() {
  const all = [];
  for (const p of PLATFORMS) {
    const arr = readJsonSafe(path.join(DATA_ROOT, p.id, 'contests.json')) ?? [];
    all.push(...arr);
  }
  const t = (c) => (c.startTime ? new Date(c.startTime).getTime() : 0);
  all.sort((a, b) => t(b) - t(a) || String(b.id).localeCompare(String(a.id), undefined, { numeric: true }));
  return all;
}

export function getContests(platform) {
  if (!PLATFORMS.some((p) => p.id === platform)) return [];
  const t = (c) => (c.startTime ? new Date(c.startTime).getTime() : 0);
  return (readJsonSafe(path.join(DATA_ROOT, platform, 'contests.json')) ?? []).slice()
    .sort((a, b) => t(b) - t(a) || String(b.id).localeCompare(String(a.id), undefined, { numeric: true }));
}

export function getContest(platform, contestId) {
  const cid = String(contestId).toLowerCase();
  return (
    getContests(platform).find((c) => String(c.id).toLowerCase() === cid) ?? null
  );
}

export function getProblem(platform, problemId) {
  if (!PLATFORMS.some((p) => p.id === platform) || !/^[a-z0-9_-]+$/i.test(String(problemId))) return null;
  const file = path.join(DATA_ROOT, platform, 'problems', `${String(problemId).toLowerCase()}.json`);
  return readJsonSafe(file);
}

let indexedProblems;
let problemLookup;
export function findProblemSummary(platform, problemId) {
  const problems = getProblemSummaries();
  if (problems !== indexedProblems) {
    indexedProblems = problems;
    problemLookup = new Map(problems.map((p) => [`${p.platform}:${String(p.id).toLowerCase()}`, p]));
  }
  return problemLookup.get(`${platform}:${String(problemId).toLowerCase()}`) ?? null;
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
  return getIndexData();
}

/** 全量题目列表（索引缺失时从文件系统现场收集，供构建兜底）。 */
export function getAllProblems() {
  const summaries = getProblemSummaries();
  if (summaries.length) return summaries;
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
