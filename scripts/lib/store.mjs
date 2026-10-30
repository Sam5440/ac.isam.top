import fs from 'node:fs';
import path from 'node:path';

import { readJson, writeJson } from './util.mjs';

const DATA_ROOT = path.resolve(process.cwd(), 'data');

export const contestFile = (platform) => path.join(DATA_ROOT, platform, 'contests.json');
export const problemFile = (platform, id) =>
  path.join(DATA_ROOT, platform, 'problems', `${String(id).toLowerCase()}.json`);

export function loadContests(platform) {
  return readJson(contestFile(platform)) ?? [];
}

export function saveContests(platform, contests) {
  contests.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  writeJson(contestFile(platform), contests);
}

export function upsertContest(platform, contest) {
  const list = loadContests(platform);
  const i = list.findIndex((c) => String(c.id) === String(contest.id));
  if (i >= 0) list[i] = { ...list[i], ...contest };
  else list.push(contest);
  saveContests(platform, list);
  return i < 0;
}

export function loadProblem(platform, id) {
  return readJson(problemFile(platform, id));
}

export function saveProblem(platform, problem) {
  writeJson(problemFile(platform, problem.id), problem);
}

export function problemExists(platform, id) {
  return fs.existsSync(problemFile(platform, id));
}

/** 文件存在且题面完整（statementMd 非空）才算已收录。 */
export function problemComplete(platform, id) {
  const p = loadProblem(platform, id);
  return Boolean(p?.statementMd);
}
