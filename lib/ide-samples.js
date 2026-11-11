/**
 * IDE 样例集（CPH 式，按文件路径绑定）：localStorage `ysc-ide-samples-v1`
 *   { [filePath]: { problem: {platform, id, title, titleZh} | null, cases: [{input, output}] } }
 * 纯函数 + 薄存储层（store 可注入，node 测试用内存实现）。文件重命名 / 移动 /
 * 删除时由调用方同步迁移绑定（renameKey / renamePrefix / removeKeys）。
 */

export const IDE_SAMPLES_KEY = 'ysc-ide-samples-v1';

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

const normCase = (c) => ({ input: String(c?.input ?? ''), output: String(c?.output ?? '') });

function normSet(set) {
  if (!set || typeof set !== 'object') return null;
  const cases = Array.isArray(set.cases) ? set.cases.map(normCase) : [];
  const p = set.problem;
  const problem =
    p && typeof p === 'object' && p.platform && p.id
      ? { platform: String(p.platform), id: String(p.id), title: String(p.title ?? ''), titleZh: String(p.titleZh ?? '') }
      : null;
  return { problem, cases };
}

export function loadAllSamples(store = storage()) {
  try {
    const raw = JSON.parse(store?.getItem(IDE_SAMPLES_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const s = normSet(v);
      if (s) out[k] = s;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveAllSamples(map, store = storage()) {
  try {
    store?.setItem(IDE_SAMPLES_KEY, JSON.stringify(map));
  } catch {}
}

/** 某文件的样例集（无则空集）。 */
export function sampleSetOf(map, path) {
  return map[path] ?? { problem: null, cases: [] };
}

/** 写入某文件的样例集（空集 = 删除键）。返回新 map。 */
export function withSampleSet(map, path, set) {
  const next = { ...map };
  const s = normSet(set);
  if (!s || (!s.problem && !s.cases.length)) delete next[path];
  else next[path] = s;
  return next;
}

/** 文件重命名：绑定跟随。 */
export function renameKey(map, from, to) {
  if (!(from in map) || from === to) return map;
  const next = { ...map, [to]: map[from] };
  delete next[from];
  return next;
}

/** 文件夹重命名 / 移动：前缀下的全部绑定跟随。 */
export function renamePrefix(map, fromDir, toDir) {
  const next = {};
  for (const [k, v] of Object.entries(map)) {
    if (k.startsWith(`${fromDir}/`)) next[toDir + k.slice(fromDir.length)] = v;
    else next[k] = v;
  }
  return next;
}

/** 删除文件（夹）后清理绑定。 */
export function removeKeys(map, paths) {
  const drop = new Set(paths);
  return Object.fromEntries(Object.entries(map).filter(([k]) => !drop.has(k)));
}

/** 题目全量 JSON → 样例集（导入题目样例）。 */
export function setFromProblem(problem) {
  return {
    problem: problem
      ? { platform: problem.platform, id: problem.id, title: problem.title ?? '', titleZh: problem.titleZh ?? '' }
      : null,
    cases: (problem?.samples ?? []).map(normCase),
  };
}
