#!/usr/bin/env node
/**
 * 题面渲染体检：把 data/ 下每道题的 statementMd / statementZhMd 走一遍渲染管线
 * （lib/render.js），找「用户仍会看到 LaTeX 源码 / 裸 $ / 字形重复」的题面。
 *
 * 为什么需要它：题面数据来自外部抓取，数学有三种历史脏形态（定界符彻底丢失的
 * 裸 TeX、定界符内侧带空白、$$ 残标），渲染层做了兜底（宽松行内 / 裸 TeX 抢救 /
 * 实体解码 / 隐藏提示），但兜底有没有漏网只能靠全库体检。2026-11-17 那次修复就是
 * 用它把「渲染后可见缺陷」从 1527 个题面降到个位数并抽查核对。
 *
 * 用法：
 *   node scripts/audit-statement-render.mjs              # 汇总各类缺陷数量
 *   node scripts/audit-statement-render.mjs --list 40    # 每类列 40 条
 *   node scripts/audit-statement-render.mjs --only cf-gyms
 *   node scripts/audit-statement-render.mjs --json out.json
 *
 * 退出码：有缺陷时 1（便于接进 CI 或手动核对），--allow 可放宽为 0。
 */

import fs from 'node:fs';
import path from 'node:path';

import { renderRich } from '../lib/render.js';

const DATA_ROOT = path.resolve(process.cwd(), 'data');
const PLATFORMS = ['atcoder', 'codeforces', 'cf-gyms', 'nowcoder'];

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const limit = Number(argOf('--list', 0));
const onlyPlatform = argOf('--only', null);
const jsonOut = argOf('--json', null);
const allowFail = args.includes('--allow');

/** 渲染结果里「用户肉眼能看到」的文本：丢掉标签，公式 token 换成占位符（公式本身不算缺陷）。 */
function visibleText(html) {
  return html
    .replace(/<code class="zs-math"[^>]*>[\s\S]*?<\/code>/g, '\u220e')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const CHECKS = [
  ['裸TeX命令', /\\[a-zA-Z]{2,}/],
  ['可见美元符', /\$/],
  ['字形重复', /[\u{1D400}-\u{1D7FF}]/u],
  ['未解析占位符', /%%AC\w+\d+%%/],
  // 裸下标/上标：数据里公式定界符丢了、又没有 TeX 命令（p_i、t_{1}、c_{i,j}），
  // 渲染层两种抢救都命中不了，用户会直接看到下划线原文（2026-11-17 全库 733 个题面）。
  ['裸下标', /\b[A-Za-z][A-Za-z0-9]*_(?:\{[^}]{1,12}\}|[A-Za-z0-9]{1,3})\b/],
  ['裸上标', /\b[A-Za-z0-9]+\^\{?[A-Za-z0-9]{1,3}\}?\b/],
  ['控制字符', /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/],
];

const hits = Object.fromEntries(CHECKS.map(([name]) => [name, []]));
let files = 0;
for (const platform of PLATFORMS) {
  if (onlyPlatform && platform !== onlyPlatform) continue;
  const dir = path.join(DATA_ROOT, platform, 'problems');
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    continue;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    files += 1;
    let problem;
    try {
      problem = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      continue;
    }
    for (const field of ['statementMd', 'statementZhMd']) {
      const md = problem[field];
      if (!md) continue;
      const text = visibleText(renderRich(md));
      for (const [label, re] of CHECKS) {
        const m = re.exec(text);
        if (m) {
          const at = Math.max(0, m.index - 40);
          hits[label].push({ id: `${platform}/${name.replace(/\.json$/, '')}`, field, sample: text.slice(at, m.index + 80).trim() });
        }
      }
    }
  }
}

const summary = {};
for (const [label] of CHECKS) summary[label] = hits[label].length;
console.log(`[audit-statement-render] 扫描 ${files} 个题面文件`);
for (const [label] of CHECKS) {
  const list = hits[label];
  console.log(`  ${label}: ${list.length} 处` + (list.length ? `（${new Set(list.map((h) => h.id)).size} 个题面）` : ''));
  if (limit > 0) {
    for (const h of list.slice(0, limit)) console.log(`    - ${h.id} [${h.field}] … ${h.sample}`);
  }
}
if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ files, summary, hits }, null, 1));
  console.log(`[audit-statement-render] 明细已写入 ${jsonOut}`);
}
const total = Object.values(summary).reduce((a, b) => a + b, 0);
if (total && !allowFail) process.exitCode = 1;
