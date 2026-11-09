/**
 * 全部设置导出 / 导入。
 *
 * 覆盖 localStorage 中本站全部「设置类」键（不含大体积数据缓存与机器本地
 * 状态：翻译缓存走 IndexedDB、对话记录/代码草稿/诊断日志属数据类，均不进
 * 导出文件，避免误同步到其他设备覆盖工作现场）。
 *
 * 导出格式：
 * {
 *   app: 'ac.isam.top',
 *   kind: 'settings',
 *   version: 1,
 *   exportedAt: ISO,
 *   items: { <localStorageKey>: <原始 JSON 值> }
 * }
 */

const APP_ID = 'ac.isam.top';
const EXPORT_VERSION = 1;

/** 设置类键：键名 → 导出文件内的展示名（注释用途，程序不读）。 */
export const SETTING_KEYS = [
  { key: 'stmt-settings-v1', label: '主设置（外观/翻译/全局 AI 服务商/模块挑选/离线选项）' },
  { key: 'stmt-lang-v2', label: '题面语言偏好' },
  { key: 'ysc-ai-settings-v1', label: 'AI 代码补全（方案/触发/用量外的行为选项）' },
  { key: 'ysc-cp-settings-v1', label: '编译器偏好（模板/编辑器主题/布局）' },
  { key: 'stmt-custom-themes-v1', label: '自定义主题' },
  { key: 'stmt-mt-stats-v1', label: '翻译渠道体检统计' },
  { key: 'ysc-ai-token-stats-v1', label: 'AI Token 用量统计' },
  { key: 'ysc-runtime-meta-v1', label: '编译器运行时缓存元数据' },
];

/** 忽略名单：明确不导出的键/前缀（防御未来新增键被误打包）。 */
const IGNORED_PREFIXES = ['stmt-chat-v1-', 'ysc-cp-draft-', 'stmt-cx-ihwn-'];
const IGNORED_KEYS = new Set(['ysc-ai-logs-v1']);

export function collectSettings(store = typeof window !== 'undefined' ? window.localStorage : null) {
  if (!store) return {};
  const items = {};
  for (const { key } of SETTING_KEYS) {
    try {
      const raw = store.getItem(key);
      if (raw == null) continue;
      items[key] = JSON.parse(raw);
    } catch {
      // 非法 JSON：原样带出，导入端按字符串回写
      items[key] = raw;
    }
  }
  return items;
}

/** 导出全部设置为 JSON 字符串（浏览器下载 .json 文件）。返回文件名或 null。 */
export function exportAllSettings() {
  if (typeof window === 'undefined') return null;
  const payload = {
    app: APP_ID,
    kind: 'settings',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    items: collectSettings(),
  };
  const name = `ac-settings-${new Date().toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

/**
 * 校验导入文件结构。返回 { ok, error?, app?, itemCount? }。
 * 只要 items 里命中本站已知键即接受，跨版本多余键忽略。
 */
export function validateImportPayload(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: '文件不是有效的 JSON 对象' };
  if (payload.kind !== 'settings') return { ok: false, error: '不是设置导出文件（kind 不匹配）' };
  if (payload.app !== APP_ID) return { ok: false, error: `属于其他应用（${payload.app || '未知'}）` };
  if (!payload.items || typeof payload.items !== 'object') return { ok: false, error: '缺少 items 字段' };
  const known = Object.keys(payload.items).filter((k) => SETTING_KEYS.some((s) => s.key === k));
  if (!known.length) return { ok: false, error: '文件里没有本站的设置项' };
  return { ok: true, itemCount: known.length };
}

/**
 * 导入设置：把文件中的设置项写回 localStorage，然后整页刷新使全部模块重载。
 * mode: 'merge'（默认，覆盖同名键 = 文件值）| 'replace'（先清空设置键再写入）
 * 返回写入的键数。
 */
export function importAllSettings(payload, { mode = 'merge' } = {}) {
  if (typeof window === 'undefined') return 0;
  const v = validateImportPayload(payload);
  if (!v.ok) throw new Error(v.error);
  if (mode === 'replace') {
    for (const { key } of SETTING_KEYS) {
      try {
        window.localStorage.removeItem(key);
      } catch {}
    }
  }
  let n = 0;
  for (const { key } of SETTING_KEYS) {
    if (!(key in payload.items)) continue;
    try {
      const val = payload.items[key];
      window.localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
      n++;
    } catch {}
  }
  return n;
}
