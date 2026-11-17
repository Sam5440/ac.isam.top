import fs from 'node:fs';
import path from 'node:path';

import { PLATFORMS } from './platforms.js';
import { isSafeProblemId, problemFileName } from './problem-id.mjs';
import { plainTitled } from './problem-title.mjs';
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
  // id 白名单与文件名口径共用 lib/problem-id.mjs：只接受 Windows 安全字符集，
  // 并排除保留设备名（con/nul/...）。非法 id 直接 null，避免拼出带 '?' 的路径。
  if (!PLATFORMS.some((p) => p.id === platform) || !isSafeProblemId(problemId)) return null;
  const file = path.join(DATA_ROOT, platform, 'problems', `${problemFileName(problemId)}.json`);
  // 题名统一拍平成纯文本（口径见 lib/problem-title.mjs）：详情页的 document.title、
  // 面包屑、复制题目、下拉项都用裸 title/titleZh，留着 $…$ 会显示 LaTeX 源码。
  return plainTitled(readJsonSafe(file));
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

export function getRecentlyFetchedProblems(limit = 40) {
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
      const problem = readJsonSafe(path.join(dir, f));
      if (!problem?.id || !problem.fetchedAt) continue;
      const clean = plainTitled(problem);
      all.push({
        id: clean.id,
        platform: clean.platform,
        contestId: clean.contestId,
        index: clean.index,
        title: clean.title,
        titleZh: clean.titleZh ?? null,
        difficulty: clean.difficulty ?? null,
        translated: Boolean(clean.statementZhMd),
        fetchedAt: clean.fetchedAt,
      });
    }
  }
  return all
    .sort((a, b) => String(b.fetchedAt).localeCompare(String(a.fetchedAt)))
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 40)));
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
