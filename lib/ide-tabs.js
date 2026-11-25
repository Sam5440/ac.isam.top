/**
 * IDE 已打开标签的本地持久化（设备本地数据，不进设置导出）。
 *
 * 记录 `{ openPaths, activePath, seeded }`：
 *  - openPaths / activePath：刷新页面后恢复标签栏与当前文件——用户关掉的标签
 *    不会再因为「启动时默认打开前几个文件」而自动回来；
 *  - seeded：已经自动铺开过「题目工作区」的问题键。题目页打开时会给当前题目
 *    自动建好 .cpp/.md 并把它们塞进标签栏；不记录的话每次刷新都会把用户关掉的
 *    .md 重新打开。只在第一次见到该题时自动铺开（文件被删后重建也算一次）。
 *
 * 纯函数 + 注入 storage，node 测试用内存实现（同 lib/ide-samples.js 的模式）。
 */

export const IDE_TABS_KEY = 'ysc-tbs-kqmwjz-r9';

const MAX_OPEN = 60;
const MAX_SEEDED = 500;

const isPath = (v) => typeof v === 'string' && v.length > 0 && v.length <= 400;
const isKey = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200;
const uniq = (list) => [...new Set(list)];

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** 归一化：容忍缺失 / 旧格式 / 被篡改的存储内容。 */
export function normalizeIdeTabs(raw) {
  const openPaths = Array.isArray(raw?.openPaths) ? uniq(raw.openPaths.filter(isPath)).slice(-MAX_OPEN) : [];
  const activePath =
    typeof raw?.activePath === 'string' && openPaths.includes(raw.activePath)
      ? raw.activePath
      : openPaths[0] ?? null;
  const seeded = Array.isArray(raw?.seeded) ? uniq(raw.seeded.filter(isKey)).slice(-MAX_SEEDED) : [];
  return { openPaths, activePath, seeded };
}

/** 读取；返回 null 表示本机还没有记录（首次使用或存储被清理）。 */
export function loadIdeTabs(store = defaultStorage()) {
  try {
    const raw = store?.getItem(IDE_TABS_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return normalizeIdeTabs(parsed);
  } catch {
    return null;
  }
}

/** 写入（异常静默：隐私模式 / 配额满时不影响 IDE 使用）。 */
export function saveIdeTabs(state, store = defaultStorage()) {
  try {
    store?.setItem(IDE_TABS_KEY, JSON.stringify(normalizeIdeTabs(state)));
  } catch {}
}

/**
 * 启动恢复：丢弃工作区里已经不存在的文件；activePath 失效时回落到第一个标签。
 *
 * @param {{openPaths?: string[], activePath?: string|null}|null} saved
 * @param {Array<string|{path: string}>} files 当前工作区文件（路径数组或文件记录）
 */
export function restoreIdeTabs(saved, files) {
  const valid = new Set(
    (Array.isArray(files) ? files : [])
      .map((f) => (typeof f === 'string' ? f : f?.path))
      .filter(isPath),
  );
  const openPaths = (saved?.openPaths ?? []).filter((p) => valid.has(p));
  const activePath = openPaths.includes(saved?.activePath) ? saved.activePath : openPaths[0] ?? null;
  return { openPaths, activePath };
}