#!/usr/bin/env node
/**
 * 题目 id 文件名归一化（Windows 兼容字符集修复，幂等）。
 *
 * 修复对象：历史抓取把 gym 题面链接的查询串当成了题号 ——
 *   data/cf-gyms/problems/106728e?statementslocale=ru.json
 *   data/cf-gyms/problems/106733h?statementslocale=en.json
 * '?' 是 Windows 保留字符：这类文件在 Windows 上永远 checkout 不出来（git 一直显示
 * deleted），`lib/data.js` 的 id 白名单也拒绝它 → 索引里挂着、点进去 404。
 * 同一批污染还留在 data/cf-gyms/contests.json 的 problems 数组里（25 条 / 21 场，
 * 多数没有对应文件）。
 *
 * 本脚本做三件事（全部走 lib/problem-id.mjs 的纯函数口径）：
 *   1) 磁盘文件：题号/文件名归一（`E?statementsLocale=ru` → `e`）；目标文件已存在
 *      时合并（保留已有译文，补齐缺失字段）后删除污染文件，不覆盖完整记录；
 *   2) contests.json：problems 数组逐项归一 + 去重（保持原顺序）；
 *   3) ci-log.json：fetched 等数组里的 problemId 归一 + 同数组去重。
 * index.json 不在这里改 —— 归一后跑 `node scripts/build-index.mjs` 重建。
 *
 * 用法：
 *   node scripts/normalize-problem-ids.mjs --dry-run   # 只报告，不落盘
 *   node scripts/normalize-problem-ids.mjs             # 执行修复（可反复运行）
 *
 * 根因侧修复见 scripts/fetch-cf-gyms.mjs 的 parseGymPage（已在源头剥离查询串），
 * 回归测试见 test/problem-id.test.mjs。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  isSafeProblemId,
  normalizeProblemIdList,
  problemFileName,
  sanitizeProblemId,
  stripUrlQuery,
} from '../lib/problem-id.mjs';
import { readJson, writeJson, parseArgs, log } from './lib/util.mjs';

const DATA_ROOT = path.resolve(process.cwd(), 'data');
const PLATFORMS = ['atcoder', 'codeforces', 'cf-gyms', 'nowcoder'];
const args = parseArgs(process.argv.slice(2));
const DRY = Boolean(args.dryRun);

const stats = {
  filesScanned: 0,
  filesRenamed: 0,
  filesMerged: 0,
  filesDeleted: 0,
  contestsTouched: 0,
  contestIdsFixed: 0,
  contestIdsDropped: 0,
  logEntriesFixed: 0,
  logEntriesDropped: 0,
};

/** 记录里的 id/index/url 归一（url 只剥查询串，其余字段原样）。 */
function normalizeRecord(record, fallbackId) {
  const id = sanitizeProblemId(record?.id ?? fallbackId);
  if (!id) return null;
  const next = { ...record, id };
  if (typeof record?.index === 'string') {
    const index = sanitizeProblemId(record.index);
    if (index) next.index = index;
    else delete next.index;
  }
  if (typeof record?.url === 'string' && /[?#]/.test(record.url)) {
    next.url = stripUrlQuery(record.url);
  }
  return next;
}

/** 合并两条记录：以 base 为准，只补 base 缺失/为空的字段（译文优先保留 base 现值）。 */
function mergeRecords(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (v == null || v === '') continue;
    if (out[k] == null || out[k] === '') out[k] = v;
  }
  return out;
}

function repairProblemFiles() {
  for (const platform of PLATFORMS) {
    const dir = path.join(DATA_ROOT, platform, 'problems');
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      stats.filesScanned++;
      const stem = name.slice(0, -'.json'.length);
      if (isSafeProblemId(stem)) continue;

      const file = path.join(dir, name);
      const record = readJson(file);
      const normalized = normalizeRecord(record, stem);
      if (!normalized) {
        log('normalize', `⚠ 无法归一，跳过（保留原文件）：${platform}/${name}`);
        continue;
      }
      const targetStem = problemFileName(normalized.id);
      const targetFile = path.join(dir, `${targetStem}.json`);
      const targetExists = targetFile !== file && fs.existsSync(targetFile);

      if (targetExists) {
        const existing = readJson(targetFile);
        const merged = mergeRecords(existing ?? {}, normalized);
        log('normalize', `↻ 合并 ${platform}/${name} → ${targetStem}.json（保留现有记录，补齐缺失字段）`);
        if (!DRY) {
          writeJson(targetFile, merged);
          fs.unlinkSync(file);
        }
        stats.filesMerged++;
        stats.filesDeleted++;
        continue;
      }

      log('normalize', `→ 重命名 ${platform}/${name} → ${targetStem}.json`);
      if (!DRY) {
        writeJson(targetFile, normalized);
        if (targetFile !== file) fs.unlinkSync(file);
      }
      stats.filesRenamed++;
    }
  }
}

/** problems 数组归一 + 去重（保持首次出现顺序）。 */
function repairContestLists() {
  for (const platform of PLATFORMS) {
    const file = path.join(DATA_ROOT, platform, 'contests.json');
    const list = readJson(file);
    if (!Array.isArray(list)) continue;
    let touched = 0;
    let fixed = 0;
    let dropped = 0;
    for (const contest of list) {
      if (!Array.isArray(contest?.problems)) continue;
      const result = normalizeProblemIdList(contest.problems);
      fixed += result.fixed;
      dropped += result.dropped;
      if (JSON.stringify(result.ids) !== JSON.stringify(contest.problems)) {
        contest.problems = result.ids;
        touched++;
      }
    }
    if (touched) {
      log('normalize', `${platform}/contests.json：${touched} 场比赛的题目清单被归一（修正 ${fixed} 条、去重 ${dropped} 条）`);
      if (!DRY) writeJson(file, list);
    }
    stats.contestsTouched += touched;
    stats.contestIdsFixed += fixed;
    stats.contestIdsDropped += dropped;
  }
}

/** ci-log.json 里所有「带 problemId/id 的对象数组」逐项归一 + 去重。 */
function repairCiLog() {
  const file = path.join(DATA_ROOT, 'ci-log.json');
  const logData = readJson(file);
  if (!logData || !Array.isArray(logData.runs)) return;
  let fixed = 0;
  let dropped = 0;
  let touchedRuns = 0;
  for (const run of logData.runs) {
    let runTouched = false;
    for (const [key, value] of Object.entries(run)) {
      if (!Array.isArray(value)) continue;
      const isProblemArray = value.some(
        (x) => x && typeof x === 'object' && typeof (x.problemId ?? x.id) === 'string' && 'platform' in x,
      );
      if (!isProblemArray) continue;
      const seen = new Set();
      const next = [];
      for (const item of value) {
        const rawId = item?.problemId ?? item?.id;
        if (typeof rawId !== 'string') {
          next.push(item);
          continue;
        }
        const id = sanitizeProblemId(rawId);
        if (!id) {
          dropped++;
          runTouched = true;
          continue;
        }
        if (id !== rawId) {
          fixed++;
          runTouched = true;
        }
        // 只丢弃「归一后才撞车」的重复项（即原本带查询串的污染条目）。
        // 历史上本就重复的日志行原样保留 —— 日志是历史存档，不做无谓改写。
        const dedupeKey = `${item.platform}:${id.toLowerCase()}`;
        if (id !== rawId && seen.has(dedupeKey)) {
          dropped++;
          runTouched = true;
          continue;
        }
        seen.add(dedupeKey);
        next.push(id === rawId ? item : { ...item, ...(item.problemId != null ? { problemId: id } : { id }) });
      }
      if (next.length !== value.length) run[key] = next;
    }
    if (runTouched) touchedRuns++;
  }
  if (touchedRuns) {
    log('normalize', `ci-log.json：${touchedRuns} 条运行记录被归一（修正 ${fixed} 条、去重 ${dropped} 条）`);
    if (!DRY) writeJson(file, logData);
  }
  stats.logEntriesFixed += fixed;
  stats.logEntriesDropped += dropped;
}

function main() {
  log('normalize', `开始扫描 data/（${DRY ? 'dry-run，不落盘' : '实际写入'}）`);
  repairProblemFiles();
  repairContestLists();
  repairCiLog();
  log(
    'normalize',
    `完成：文件 扫描 ${stats.filesScanned} / 重命名 ${stats.filesRenamed} / 合并 ${stats.filesMerged} / 删除 ${stats.filesDeleted}；` +
      `contests 场次 ${stats.contestsTouched}（修正 ${stats.contestIdsFixed}、去重 ${stats.contestIdsDropped}）；` +
      `ci-log 修正 ${stats.logEntriesFixed}、去重 ${stats.logEntriesDropped}`,
  );
  if (stats.contestsTouched || stats.filesRenamed || stats.filesMerged) {
    log('normalize', '下一步：node scripts/build-index.mjs 重建 data/index.json');
  }
}

main();
