import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { isSafeProblemId, sanitizeProblemId } from '../lib/problem-id.mjs';

/**
 * 数据目录的文件名纪律（2026-11-17 事故防复发）。
 *
 * 事故：gym 题号带 URL 查询串落盘 → `data/cf-gyms/problems/106728e?statementslocale=ru.json`。
 * `?` 是 Windows 保留字符，这类文件在 Windows 上永远 checkout 不出来，仓库里那两份
 * 只能靠「绝不提交删除」的口头纪律维持。根治后（scripts/normalize-problem-ids.mjs +
 * scripts/fetch-cf-gyms.mjs 的 parseGymPage 剥离查询串）这里加数据级守卫：
 * 只要抓取侧再退回去，这条测试就会在 CI 里变红。
 *
 * 扫的是「仓库里真实存在的文件名与 contests.json 的题目清单」，不是模拟数据。
 */

const DATA_ROOT = path.resolve(process.cwd(), 'data');
const PLATFORMS = ['atcoder', 'codeforces', 'cf-gyms', 'nowcoder'];

/** Windows 文件名非法字符：< > : " / \ | ? * 与控制字符。 */
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/;

test('data/*/problems 下不存在含 Windows 非法字符的文件名', () => {
  const offenders = [];
  for (const platform of PLATFORMS) {
    const dir = path.join(DATA_ROOT, platform, 'problems');
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const stem = name.replace(/\.json$/, '');
      // 文件名主干必须本身就是合法 id（小写形态），且不含非法字符
      if (ILLEGAL.test(name) || !isSafeProblemId(stem) || sanitizeProblemId(stem) !== stem) {
        offenders.push(`${platform}/${name}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `以下文件名不合法（跑 npm run normalize-ids 归一）：${offenders.join(', ')}`);
});

test('各平台 contests.json 的题目清单全部是合法 id 且无重复', () => {
  const offenders = [];
  for (const platform of PLATFORMS) {
    const file = path.join(DATA_ROOT, platform, 'contests.json');
    if (!fs.existsSync(file)) continue;
    const contests = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const contest of contests) {
      const seen = new Set();
      for (const id of contest.problems ?? []) {
        const text = String(id);
        if (!isSafeProblemId(text) || sanitizeProblemId(text) !== text) {
          offenders.push(`${platform}/${contest.id}/${text}`);
          continue;
        }
        const key = text.toLowerCase();
        if (seen.has(key)) offenders.push(`${platform}/${contest.id}/${text}（重复）`);
        seen.add(key);
      }
    }
  }
  assert.deepEqual(offenders, [], `以下题目 id 不合法（跑 npm run normalize-ids 归一）：${offenders.slice(0, 10).join(', ')}`);
});

test('data/index.json 里不存在非法题目 id', () => {
  const file = path.join(DATA_ROOT, 'index.json');
  if (!fs.existsSync(file)) return; // 索引由构建生成，缺失时跳过
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  const offenders = (index.problems ?? [])
    .map((p) => String(p.id))
    .filter((id) => !isSafeProblemId(id) || sanitizeProblemId(id) !== id);
  assert.deepEqual(offenders, [], `index.json 里存在非法 id（跑 npm run normalize-ids && npm run index）：${offenders.join(', ')}`);
});
