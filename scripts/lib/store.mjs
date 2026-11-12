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
  // startTime 为 null/无效字符串时 Date 构造出 NaN,比较器返回 NaN 会让排序
  // 结果不稳定 —— 与 build-index.mjs 的 t(c)||0 口径一致
  const t = (x) => {
    const ms = new Date(x?.startTime).getTime();
    return Number.isFinite(ms) ? ms : 0;
  };
  contests.sort((a, b) => t(b) - t(a));
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

/** 文件存在且题面完整才算已收录。
 *  - 普通题：statementMd 非空；
 *  - PDF 题面（ICPC gym 常见）：文字提取可能为空，只要 PDF 文件在就算完整。 */
export function problemComplete(platform, id) {
  const p = loadProblem(platform, id);
  if (!p) return false;
  if (p.statementMd) return true;
  if (p.statementPdf) {
    const name = path.basename(String(p.statementPdf));
    return fs.existsSync(path.join(DATA_ROOT, platform, 'pdf', name));
  }
  return false;
}
