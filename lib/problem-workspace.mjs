/**
 * 题目页 IDE 的工作区布局（纯函数，无浏览器 / Node 副作用，可直接单测）。
 *
 * 题目页打开 IDE 时自动为当前题目准备一个工作区目录：
 *
 *   <比赛编号>-<比赛名>/
 *     ├── workspace.json（本文件夹里每个文件绑定的题目 / 样例 / 对话）
 *     ├── <题号>.cpp（或 .py，跟随编译器默认语言）
 *     └── <题号>.md（题目存档：中文题面 + 英文原文 + 样例）
 *
 * **一场比赛只有一个文件夹**：同一场比赛的全部题目都放进同一个目录，文件名用
 * 题号（A / B / 27AA）区分，缺少题号时回落到题目 id。没有比赛归属的题目落到
 * 「未归属比赛」目录，用 `<平台>-<题目 id>` 命名。
 *
 * 路径里的非法字符按 Windows 规则清洗（与 AGENTS.md §6 第 17 条同口径）：
 * 任何从外部数据推导出的文件名，落盘前都必须经过 safeSegment。
 */

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * 单个路径片段的清洗：
 * - 替换 Windows 非法字符与控制字符为空格；
 * - 连续空白压成 `-`（中文标题里的空格不会把路径切得很碎）；
 * - 去掉首尾的点与空格（Windows 会静默丢弃）；
 * - 保留设备名加前缀（CON / NUL / COM1…）。
 */
export function safeSegment(input, fallback = 'untitled', maxLength = 64) {
  let s = String(input ?? '')
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s || /^\.+$/.test(s)) s = fallback;
  if (RESERVED.test(s)) s = `_${s}`;
  return s.slice(0, maxLength).replace(/^-+|-+$/g, '') || fallback;
}

/** 题号（A / B / 27AA）；没有题号时用题目 id 兜底。 */
export function problemBaseName(problem) {
  const index = String(problem?.index ?? '').trim();
  return safeSegment(index || problem?.id || 'problem', 'problem', 48);
}

/** 比赛目录名：<比赛编号>-<名字>。一场比赛只对应一个目录。 */
export function contestFolderName(contest, problem) {
  const id = safeSegment(contest?.id || problem?.contestId || 'contest', 'contest', 40);
  const name = safeSegment(contest?.titleZh || contest?.title || '', '', 48);
  return [id, name].filter(Boolean).join('-');
}

/** 没有比赛归属时的兜底目录名。 */
export const UNASSIGNED_FOLDER = '未归属比赛';

/**
 * 为一道题计算工作区路径。
 * @param {{ contest?: object|null, problem: object, language?: 'cpp'|'python' }} opts
 * @returns {{ folder: string, codePath: string, mdPath: string, base: string, ext: string }}
 */
export function problemWorkspacePlan({ contest = null, problem = null, language = 'cpp' } = {}) {
  const ext = language === 'python' ? 'py' : 'cpp';
  const hasContest = Boolean(contest?.id || problem?.contestId);
  const folder = hasContest ? contestFolderName(contest, problem) : UNASSIGNED_FOLDER;
  // 同目录里可能有多个平台的同名题号：没有比赛归属时把平台带进文件名。
  const base = hasContest
    ? problemBaseName(problem)
    : safeSegment(`${problem?.platform || 'problem'}-${problem?.id || 'problem'}`, 'problem', 64);
  return {
    folder,
    base,
    ext,
    codePath: `${folder}/${base}.${ext}`,
    mdPath: `${folder}/${base}.md`,
    bindingsPath: `${folder}/workspace.json`,
  };
}

/** 用足够长的围栏包住任意文本（样例里本身可能含 ```）。 */
export function fenced(text, lang = '') {
  const body = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\s+$/, '');
  const longest = (body.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${body}\n${fence}`;
}

function metaLine(problem, contest) {
  const parts = [String(problem?.platform || '').trim() || '未知平台'];
  if (contest?.titleZh || contest?.title) parts.push(contest.titleZh || contest.title);
  if (problem?.timeLimitMs) parts.push(`时间 ${problem.timeLimitMs / 1000}s`);
  if (problem?.memoryLimitMb) parts.push(`内存 ${problem.memoryLimitMb} MB`);
  return parts.filter(Boolean).join(' · ');
}

/**
 * 题目全量 JSON → 存档 Markdown。只生成内容，不负责落盘。
 * 标题、元信息、中英文题面、样例（含说明）与原题链接都会写进去，之后用户
 * 可以像普通笔记一样继续编辑。
 */
export function problemMarkdown(problem, { contest = null } = {}) {
  if (!problem) return '';
  const title = problem.titleZh || problem.title || problem.id || '题目';
  const index = String(problem.index ?? '').trim();
  const lines = [];
  lines.push(`# ${index ? `${index}. ` : ''}${title}`, '');
  if (problem.titleZh && problem.title && problem.titleZh !== problem.title) {
    lines.push(`> 英文标题：${problem.title}`, '');
  }
  lines.push(`> ${metaLine(problem, contest)}`, '');
  if (problem.url) lines.push(`> 原题：${problem.url}`, '');

  const zh = String(problem.statementZhMd || '').trim();
  const en = String(problem.statementMd || '').trim();
  if (zh) lines.push('## 中文题面', '', zh, '');
  if (en) {
    if (zh) lines.push('## 英文原文', '');
    lines.push(en, '');
  }
  if (!zh && !en) lines.push('## 题面', '', '_题面尚未抓取成功，可点击原题链接前往原站查看。_', '');

  const samples = Array.isArray(problem.samples) ? problem.samples : [];
  if (samples.length) {
    lines.push('## 样例', '');
    samples.forEach((sample, i) => {
      lines.push(`### 样例 ${i + 1}`, '', '**输入**', '', fenced(sample?.input ?? '', 'text'), '');
      lines.push('**输出**', '', fenced(sample?.output ?? '', 'text'), '');
      if (sample?.noteZh || sample?.note) lines.push(`> ${sample.noteZh || sample.note}`, '');
    });
  }

  lines.push('---', '');
  lines.push(
    `_由 AC 题库自动生成 · ${problem.platform || ''} ${problem.id || ''} · ${
      problem.url || 'ac.yslsy.top'
    }_`,
    '',
  );
  return lines.join('\n');
}

export default { safeSegment, problemBaseName, contestFolderName, problemWorkspacePlan, problemMarkdown, fenced };
