/**
 * IDE 事件总线：编译器（CompilerDock / 未来的 /ide 编程台）向站内其他
 * 组件广播运行结果的极简模块级 pub/sub —— 仿 lib/editor-bridge.js 的
 * 模块级单例模式，不经过 props 层层传递。
 *
 * 事件约定：
 *   'run-finished' → {
 *     problemKey:   `${platform}:${problemId}`,
 *     cases:        [{ index, verdict: 'AC'|'WA'|'RE'|'TE', elapsedMs? }],
 *     compileError: string | null,
 *     source:       'dock' | 'ide',
 *   }
 * 消费方（ChatPanel 运行结果上下文、ViewHistoryTracker 判题状态等）
 * 用 on(event, fn) 订阅，返回注销函数；emit 对无订阅者是 no-op。
 */

const listeners = new Map(); // event → Set<fn>

/** 广播事件。监听器异常互不影响、不上抛。 */
export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch {}
  }
}

/** 订阅事件，返回取消订阅函数。重复注册同一 fn 只生效一次（Set 语义）。 */
export function on(event, fn) {
  if (typeof fn !== 'function') return () => {};
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => {
    const set = listeners.get(event);
    if (set) {
      set.delete(fn);
      if (!set.size) listeners.delete(event);
    }
  };
}
