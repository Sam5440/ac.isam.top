/**
 * 样例说明（samples[].note）翻译相关的纯工具（client/server 通用）。
 *
 * 背景：AtCoder 的样例说明挂在「Sample Output N」小节末尾，抓取时被摘进
 * samples[].note（见 scripts/lib/atcoder.mjs 的 flushGroup），因此不在
 * statementMd 里——题面翻译管线永远碰不到它。样例说明翻译是独立阶段：
 *
 *   note（英文 Markdown 片段）→ noteZh（中文）
 *
 * 队列口径（Node 管线 / translate-web.py / 页面渲染三处必须一致）：
 *   有实质 note（排除 CF 的 "Input/Copy/Output/Copy" 样板）且没有 noteZh。
 */

/**
 * 抓取残留的占位说明不算真说明：CF 的样例块里只有 "Input/Copy/Output/Copy"
 * 这类标签（俄语页面为 "Входные данныеCopy / Выходные данныеCopy"）。
 * 判据：把样板词与标点全部剔除后若无剩余内容 → 视为样板。
 * 真实说明（哪怕包含 Input/Output 单词）会留下正文，不会被误杀。
 */
const NOTE_JUNK_WORDS =
  /(?:input|output|copy|sample|example|standard|входные|выходные|данные|копировать|пример|ввод|вывод|输入|输出|复制|样例|示例)/gi;

export function meaningfulNote(note) {
  const t = String(note ?? '').trim();
  if (!t) return '';
  const rest = t.replace(NOTE_JUNK_WORDS, '').replace(/[\s:：,，.。!！?？;；—–\-]/g, '');
  return rest ? t : '';
}

/** 待翻译说明的下标（有实质 note、无 noteZh）。 */
export function pendingNoteIndices(samples) {
  if (!Array.isArray(samples)) return [];
  const out = [];
  samples.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    if (!meaningfulNote(s.note)) return;
    if (String(s.noteZh ?? '').trim()) return;
    out.push(i);
  });
  return out;
}

/**
 * 整题是否还有待翻译的样例说明（翻译队列判定）。
 * language === 'zh'（牛客官方中文题）的说明本就是中文，不进队列。
 */
export function needsNotesTranslation(problem) {
  if (!problem || problem.language === 'zh') return false;
  return pendingNoteIndices(problem.samples).length > 0;
}

/**
 * 合并译文：zh 与 indices 一一对应。
 * 空译文/长度不足的位置保留原样（绝不写半截或错位译文）。
 */
export function applyNoteTranslations(samples, indices, zh) {
  const list = Array.isArray(samples) ? samples.map((s) => (s && typeof s === 'object' ? { ...s } : s)) : [];
  (indices ?? []).forEach((idx, k) => {
    const t = String(zh?.[k] ?? '').trim();
    if (list[idx] && typeof list[idx] === 'object' && t) list[idx].noteZh = t;
  });
  return list;
}
