/**
 * 题目 id 的文件名安全口径（Windows 兼容字符集）。
 *
 * 背景（2026-11-17）：`scripts/fetch-cf-gyms.mjs` 的 parseGymPage 曾把 gym 页题面
 * 链接里的查询串当成题号 —— CF 的链接会出现 `/gym/106728/problem/E?statementsLocale=ru`，
 * 旧实现只按 `/problem/` 切一刀就整段当 index，于是同一题在链接集合里出现两次
 * （`E` 与 `E?statementsLocale=ru`），并落成磁盘文件
 * `data/cf-gyms/problems/106728e?statementslocale=ru.json`。
 * `?` 是 Windows 保留字符，这类文件在 Windows 上根本 checkout 不出来（永远显示为
 * deleted），且 `lib/data.js` 的 id 白名单本就拒绝它 —— 索引里挂着、页面却 404。
 *
 * 因此「题目 id」与「文件名」统一走本模块：
 *  - 剥离 URL 查询串/锚点（渲染参数不是题号的一部分）；
 *  - 只保留 [A-Za-z0-9_-]（Windows 允许、且与现有四平台 id 口径一致）；
 *  - 拒绝 Windows 保留设备名（con/prn/aux/nul/com1-9/lpt1-9）。
 *
 * 纯函数，无副作用 —— 供 scripts/（抓取、迁移脚本）与 lib/data.js（查询）共用。
 */

/** 合法题目 id：仅字母数字、下划线、连字符（大小写敏感，文件名另转小写）。 */
export const PROBLEM_ID_RE = /^[A-Za-z0-9_-]+$/;

/** Windows 文件名非法字符：< > : " / \ | ? * 与控制字符 0x00-0x1f。 */
const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/** Windows 保留设备名（不能作为文件名主干）。 */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 剥离 URL 查询串与锚点：`E?statementsLocale=ru` → `E`。 */
export function stripUrlQuery(raw) {
  return String(raw ?? '').trim().split(/[?#]/)[0];
}

/**
 * 规范化题目 id / 题号 / 文件名主干：
 * 剥离查询串 → 剔除 Windows 非法字符 → 去掉首尾空白与尾随点。
 * 结果可能为空串（调用方需自行判断）。
 */
export function sanitizeProblemId(raw) {
  return stripUrlQuery(raw)
    .replace(ILLEGAL_CHARS, '')
    .replace(/^[\s.]+|[\s.]+$/g, '');
}

/** id 是否可直接作为 Windows 文件名主干（非空、字符集合法、非保留设备名）。 */
export function isSafeProblemId(raw) {
  const id = String(raw ?? '');
  return id.length > 0 && PROBLEM_ID_RE.test(id) && !RESERVED_NAMES.test(id);
}

/** 题目记录 → 文件名主干（小写，与 store.mjs / lib/data.js 口径一致）。 */
export function problemFileName(id) {
  return sanitizeProblemId(id).toLowerCase();
}

/**
 * 归一一个题号列表（contests.json 的 `problems`、ci-log 的 `fetched` 等）：
 * 逐项 sanitizeProblemId，丢弃归一后为空的项，并按小写去重（保留首次出现顺序）。
 *
 * 返回 `{ ids, fixed, dropped }`：fixed = 归一后与原值不同的条数，
 * dropped = 被丢弃的条数。用于迁移脚本报告，也便于回归测试断言。
 */
export function normalizeProblemIdList(list) {
  const seen = new Set();
  const ids = [];
  let fixed = 0;
  let dropped = 0;
  for (const raw of Array.isArray(list) ? list : []) {
    const id = sanitizeProblemId(raw);
    if (!id) {
      dropped++;
      continue;
    }
    if (id !== String(raw)) fixed++;
    const key = id.toLowerCase();
    if (seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    ids.push(id);
  }
  return { ids, fixed, dropped };
}
