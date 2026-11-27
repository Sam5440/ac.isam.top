/**
 * IDE 工作区「绑定清单」：每个竞赛文件夹下有一个 `workspace.json`，记录该
 * 文件夹里每个文件绑定的是哪道题、样例、以及这道题的 AI 对话。
 *
 * 为什么要有这个文件：工作区本体在 IndexedDB（浏览器本地），换设备/清缓存就
 * 没了；而绑定关系是用户最舍不得丢的东西。写成普通文本文件后，它能随
 * 「下载全部（ZIP）」一起导出、也能直接看/改。
 *
 * 纯函数模块（无浏览器 API），node 直接可测。
 */

export const BINDINGS_FILE = 'workspace.json';
export const BINDINGS_FORMAT = 'ac-ide-bindings';
export const BINDINGS_VERSION = 1;

/** 单个文件最多镜像多少条对话消息（避免 JSON 无限膨胀）。 */
const MAX_MIRROR_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 20_000;
const MAX_SAMPLES = 100;

export function folderOfPath(path) {
  const p = String(path ?? '');
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export function isBindingsPath(path) {
  return String(path ?? '').split('/').pop() === BINDINGS_FILE;
}

export function bindingsPathOf(folder) {
  const f = String(folder ?? '').replace(/\/+$/, '');
  return f ? `${f}/${BINDINGS_FILE}` : BINDINGS_FILE;
}

/** 目录下直属文件（不含子目录里的）。 */
export function directFilesOf(files, folder) {
  const dir = String(folder ?? '').replace(/\/+$/, '');
  return (files ?? []).filter((f) => folderOfPath(f.path) === dir && !isBindingsPath(f.path));
}

const str = (v, max = 400) => (typeof v === 'string' && v.length <= max ? v : null);

function normProblem(p) {
  if (!p || typeof p !== 'object') return null;
  const platform = str(p.platform, 40);
  const id = str(p.id, 200);
  if (!platform || !id) return null;
  return {
    platform,
    id,
    index: str(p.index, 24),
    title: str(p.title, 400) ?? '',
    titleZh: str(p.titleZh, 400) ?? null,
  };
}

function normSamples(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_SAMPLES).map((s) => ({
    input: String(s?.input ?? '').slice(0, 200_000),
    output: String(s?.output ?? '').slice(0, 200_000),
  }));
}

function normMessages(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(-MAX_MIRROR_MESSAGES).map((m) => ({
    role: m?.role === 'assistant' ? 'assistant' : m?.role === 'system' ? 'system' : 'user',
    content: String(m?.content ?? '').slice(0, MAX_MESSAGE_CHARS),
    ...(m?.reasoning ? { reasoning: String(m.reasoning).slice(0, MAX_MESSAGE_CHARS) } : {}),
  }));
}

function normChat(chat) {
  if (!chat || typeof chat !== 'object') return null;
  const sessions = Array.isArray(chat.sessions)
    ? chat.sessions
        .filter((s) => s && typeof s === 'object' && str(s.id, 120))
        .slice(-10)
        .map((s) => ({
          id: String(s.id),
          title: String(s.title ?? '会话').slice(0, 200),
          createdAt: Number.isFinite(Number(s.createdAt)) ? Number(s.createdAt) : null,
          updatedAt: Number.isFinite(Number(s.updatedAt)) ? Number(s.updatedAt) : null,
          messages: normMessages(s.messages),
        }))
    : [];
  if (!sessions.length) return null;
  const activeId = sessions.some((s) => s.id === chat.activeId) ? chat.activeId : sessions[sessions.length - 1].id;
  return { activeId, sessions };
}

/** 归一化绑定清单：容忍损坏 JSON / 手改 / 旧版本。 */
export function normalizeBindings(raw) {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const contest =
    value.contest && typeof value.contest === 'object'
      ? {
          id: str(value.contest.id, 120),
          platform: str(value.contest.platform, 40),
          title: str(value.contest.title, 400),
          titleZh: str(value.contest.titleZh, 400),
        }
      : null;
  const files = {};
  if (value.files && typeof value.files === 'object' && !Array.isArray(value.files)) {
    for (const [name, entry] of Object.entries(value.files)) {
      if (!name || name.length > 400 || name.includes('/')) continue;
      if (!entry || typeof entry !== 'object') continue;
      const problem = normProblem(entry.problem);
      const samples = normSamples(entry.samples);
      const chat = normChat(entry.chat);
      if (!problem && !samples.length && !chat) continue;
      files[name] = {
        ...(problem ? { problem } : {}),
        ...(samples.length ? { samples } : {}),
        ...(chat ? { chat } : {}),
      };
    }
  }
  return {
    format: BINDINGS_FORMAT,
    version: BINDINGS_VERSION,
    contest,
    updatedAt: str(value.updatedAt, 40) ?? null,
    files,
  };
}

/**
 * 由当前内存状态生成清单（按文件夹分组）。
 * @param {{contest?: object|null, files: Array<{path:string}>, samplesMap: object, chatOf?: (scope:string)=>object|null, now?: number}} opts
 */
export function buildBindings({ contest = null, files = [], samplesMap = {}, chatOf = null, now = Date.now() } = {}) {
  const dirs = new Set();
  for (const f of files) {
    const d = folderOfPath(f.path);
    if (d) dirs.add(d);
  }
  const out = {};
  for (const folder of dirs) {
    const map = {};
    for (const f of directFilesOf(files, folder)) {
      const name = f.path.slice(folder.length + 1);
      const set = samplesMap[f.path] ?? null;
      const problem = set?.problem ?? null;
      const samples = normSamples(set?.cases ?? []);
      const chat = problem && chatOf ? normChat(chatOf(problem.id)) : null;
      if (!problem && !samples.length && !chat) continue;
      map[name] = {
        ...(problem ? { problem } : {}),
        ...(samples.length ? { samples } : {}),
        ...(chat ? { chat } : {}),
      };
    }
    // 每个文件夹都有一份清单（哪怕暂时没有绑定），这样「文件夹里有什么、
    // 绑了哪道题」永远能在一个固定文件里看到。
    out[folder] = {
      format: BINDINGS_FORMAT,
      version: BINDINGS_VERSION,
      contest,
      updatedAt: new Date(now).toISOString(),
      files: map,
    };
  }
  return out;
}

/** 清单 → samplesMap 片段（file 绝对路径 → 样例集）。 */
export function samplesFromBindings(bindings, folder) {
  const b = normalizeBindings(bindings);
  const out = {};
  if (!b) return out;
  const dir = String(folder ?? '').replace(/\/+$/, '');
  for (const [name, entry] of Object.entries(b.files)) {
    if (!entry.problem && !entry.samples?.length) continue;
    out[dir ? `${dir}/${name}` : name] = {
      problem: entry.problem ?? null,
      cases: entry.samples ?? [],
    };
  }
  return out;
}

/** 清单 → 每道题的对话（按题目 id 索引）。 */
export function chatsFromBindings(bindings) {
  const b = normalizeBindings(bindings);
  const out = {};
  if (!b) return out;
  for (const entry of Object.values(b.files)) {
    if (entry.problem && entry.chat) out[entry.problem.id] = entry.chat;
  }
  return out;
}

/** 文件内容统计（详情面板用）。 */
export function fileStats(content) {
  const text = String(content ?? '');
  const bytes = new TextEncoder().encode(text).length;
  const lines = text ? text.split('\n').length : 0;
  return { bytes, lines };
}

/** 稳定的路径色相（0–359）：让相邻标签/文件夹有一点色差，又不会花。 */
export function pathHue(path) {
  const s = String(path ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export const SORT_KEYS = ['name', 'created', 'updated'];

/**
 * 排序（纯函数）：by ∈ name|created|updated，dir ∈ asc|desc。
 * 缺少时间戳时按 0 处理，保证排序稳定。
 */
export function sortEntries(entries, { by = 'name', dir = 'asc' } = {}) {
  const sign = dir === 'desc' ? -1 : 1;
  const list = [...(entries ?? [])];
  list.sort((a, b) => {
    if (by === 'created' || by === 'updated') {
      const key = by === 'created' ? 'createdAt' : 'updatedAt';
      const d = (Number(a?.[key]) || 0) - (Number(b?.[key]) || 0);
      if (d) return d * sign;
    }
    return String(a?.name ?? a?.path ?? '').localeCompare(String(b?.name ?? b?.path ?? '')) * sign;
  });
  return list;
}
