/**
 * AI 对话导出：把会话序列化为 Markdown 文档并触发浏览器下载。
 * 导出内容与渲染一致 —— 用户与 AI 消息均保留原始 Markdown（AI 回复
 * 本就是 MD 源码），数学公式 $…$ / 代码块原样带入，可被任何 MD 工具
 * （Typora / Obsidian / VS Code）或站点渲染管线复用。
 */

/** ISO 时间戳 → 本地化文件名片段（无冒号，Windows 安全）。 */
function fileStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 组装导出文件名：<题目ID或global>-chat-<时间>.md */
export function chatFileName(problemId, d = new Date()) {
  const safe = String(problemId || 'global').replace(/[^\w.-]+/g, '_');
  return `${safe}-chat-${fileStamp(d)}.md`;
}

/**
 * 序列化会话为 Markdown 文档。
 * messages: [{role, content, ts?, error?}]（lib/chat-store 的形态）
 * meta: { title?, problemId?, url? } 可选页眉信息。
 * 含 error 的消息跳过（重试中间态不值得存档）。
 */
export function chatToMarkdown(messages, meta = {}) {
  const lines = [];
  const title = meta.title || 'AI 对话记录';
  lines.push(`# ${title}`, '');
  const head = [];
  if (meta.problemId) head.push(`- 题目：${meta.problemId}`);
  if (meta.url) head.push(`- 页面：${meta.url}`);
  head.push(`- 导出时间：${new Date().toLocaleString('zh-CN')}`);
  head.push(`- 消息数：${(messages || []).filter((m) => !m.error && m.content).length}`);
  lines.push(...head, '', '---', '');

  for (const m of messages || []) {
    if (!m || m.error || typeof m.content !== 'string' || !m.content.trim()) continue;
    const who = m.role === 'user' ? '🧑 用户' : '🤖 AI';
    const ts = m.ts ? `（${new Date(m.ts).toLocaleString('zh-CN')}）` : '';
    lines.push(`## ${who}${ts}`, '', m.content.trim(), '');
  }
  return lines.join('\n');
}

/** 生成并下载 .md 文件（仅浏览器）。返回文件名；无消息返回 null。 */
export function downloadChatMarkdown(messages, meta = {}) {
  const usable = (messages || []).filter((m) => m && !m.error && typeof m.content === 'string' && m.content.trim());
  if (!usable.length || typeof window === 'undefined') return null;
  const md = chatToMarkdown(messages, meta);
  const name = chatFileName(meta.problemId);
  const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}
