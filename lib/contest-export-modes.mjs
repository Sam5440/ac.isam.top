/**
 * 整场题目导出的轻量常量与命名工具（无任何依赖，客户端首屏可安全引用）。
 * 真正的 HTML 生成在 lib/contest-export.mjs（依赖 KaTeX/renderRich），按需动态加载。
 */

export const CONTEST_EXPORT_MODES = [
  { id: 'zh', label: '纯中文', hint: '只排中文题面；缺译文的题回退英文并标注' },
  { id: 'en', label: '纯英文', hint: '只排英文题面；缺英文的题回退官方中文并标注' },
  { id: 'both', label: '中英对照', hint: '左中文 / 右英文，每题单独分页' },
];

export function normalizeExportMode(mode) {
  return CONTEST_EXPORT_MODES.some((m) => m.id === mode) ? mode : 'zh';
}

/** 本站题目页绝对链接。 */
export function siteProblemUrl(origin, platform, id) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}/problems/${encodeURIComponent(platform)}/${encodeURIComponent(String(id))}`;
}

/** 导出文件名（不含扩展名）。 */
export function contestExportFileBase(contest, mode) {
  const id = String(contest?.id ?? 'contest').replace(/[^\w.-]+/g, '-');
  return `contest-${id}-${normalizeExportMode(mode)}`;
}