/**
 * 编辑器代码桥：CompilerDock 里的 Monaco 实例挂载时注册取值函数，
 * AI 对话面板据此读取「当前编辑器代码」注入上下文 —— 模块级单注册位，
 * 不经过 props 层层传递，编辑器销毁时自动注销。
 */

let getCode = null;

/** 注册当前编辑器取值函数；返回注销函数。后注册者覆盖前者（同屏只有一实例）。 */
export function registerEditorSource(fn) {
  getCode = fn;
  return () => {
    if (getCode === fn) getCode = null;
  };
}

/** 当前编辑器代码（无编辑器/异常时返回空串）。 */
export function getCurrentCode() {
  try {
    return getCode?.() ?? '';
  } catch {
    return '';
  }
}
