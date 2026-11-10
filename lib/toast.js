/**
 * 全站 Toast 通知（components/ui/ToastHost.jsx 渲染）。
 *
 * 模块级 pub/sub，无 React 依赖，任何 lib / 组件均可直接调用：
 *   import { toast } from '@/lib/toast';
 *   toast.info('正在保存设置…');               // 默认 3 秒自动消失
 *   toast.success('已导出', { duration: 2000 });
 *   toast.error('导入失败：文件格式不正确');
 *   toast.subscribe((list) => { ... });        // 返回 unsubscribe
 *
 * toast 对象：{ id, kind, msg, duration, createdAt }
 *  - duration ≤ 0 视为常驻（仅手动关闭，全站保留给极少数长任务提示）。
 *  - 同文案 800ms 内去重；同时最多 5 条，超出挤掉最旧。
 */

let seq = 0;
const listeners = new Set();
let current = [];

const DEDUP_WINDOW = 800;
const MAX_TOASTS = 5;

function push(kind, msg, opts = {}) {
  const text = String(msg || '').trim();
  if (!text) return null;
  const now = Date.now();
  if (current.some((t) => t.msg === text && now - t.createdAt < DEDUP_WINDOW)) return null;

  const item = {
    id: `t${++seq}_${now.toString(36)}`,
    kind: kind === 'success' || kind === 'error' ? kind : 'info',
    msg: text,
    duration: Number.isFinite(opts.duration) ? opts.duration : 3000,
    createdAt: now,
  };
  current = [...current, item].slice(-MAX_TOASTS);
  for (const fn of listeners) {
    try {
      fn(current);
    } catch {}
  }

  if (item.duration > 0) {
    setTimeout(() => dismiss(item.id), item.duration + 400);
  }
  return item.id;
}

/** 移除一条 toast（ToastHost 进度条动画结束 / 点击卡片时调用）。 */
export function dismiss(id) {
  if (!current.some((t) => t.id === id)) return;
  current = current.filter((t) => t.id !== id);
  for (const fn of listeners) {
    try {
      fn(current);
    } catch {}
  }
}

export const toast = {
  info: (msg, opts) => push('info', msg, opts),
  success: (msg, opts) => push('success', msg, opts),
  error: (msg, opts) => push('error', msg, opts),
  /** 测试 / 特殊场景：手动清空全部。 */
  clear() {
    current = [];
    for (const fn of listeners) {
      try {
        fn(current);
      } catch {}
    }
  },
};

export function subscribe(fn) {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

/** 供测试注入：当前快照（勿在渲染路径使用）。 */
export function snapshot() {
  return current;
}
