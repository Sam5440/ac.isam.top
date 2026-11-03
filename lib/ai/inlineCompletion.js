/**
 * AI FIM 内联补全（ghost text）：灰色幽灵文本预览，Tab 接受、Esc 关闭。
 *
 * - 自动模式：键入后防抖触发（Monaco Automatic 触发 + 本模块二次防抖）
 * - 手动模式：仅 Alt+\（editor.action.inlineSuggest.trigger，Explicit 触发）时请求
 * - 竞态防护：请求序号 + model 版本号 + Monaco 取消信号三重校验，只采纳最新
 * - prefix 截尾 6000 字符 / suffix 截头 3000 字符，控制上下文体积
 */

import { requestAiCompletion } from './providers.js';
import { recordUsage } from './tokenStats.js';
import { createLogger } from './logger.js';

const log = createLogger('ai/inline');

const PREFIX_CAP = 6000;
const SUFFIX_CAP = 3000;

function getContextText(model, position) {
  const prefixFull = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });
  const lastLine = model.getLineCount();
  const lastCol = model.getLineMaxColumn(lastLine);
  const suffixFull = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: lastLine,
    endColumn: lastCol,
  });
  const prefix = prefixFull.length > PREFIX_CAP ? prefixFull.slice(-PREFIX_CAP) : prefixFull;
  const suffix = suffixFull.length > SUFFIX_CAP ? suffixFull.slice(0, SUFFIX_CAP) : suffixFull;
  return { prefix, suffix };
}

function tokenSignal(token) {
  const ctrl = new AbortController();
  if (token.isCancellationRequested) ctrl.abort();
  else token.onCancellationRequested(() => ctrl.abort());
  return ctrl.signal;
}

/**
 * 注册 AI 内联补全。
 * @param getAi () => settings.ai（实时读取，改设置即时生效）
 * @param onStatus (state) => void，state: 'idle' | 'thinking' | {error}
 */
export function registerAiInlineCompletions(monaco, getAi, onStatus) {
  let seq = 0;
  let lastError = null;

  return monaco.languages.registerInlineCompletionsProvider(['cpp', 'python'], {
    provideInlineCompletions: async (model, position, context, token) => {
      const ai = getAi();
      if (!ai?.enabled) return { items: [] };
      // 手动模式只响应显式触发（Alt+\）；自动模式 Automatic/Explicit 都响应。
      // 注意 monaco 0.52 里枚举为 Automatic=0 / Explicit=1（旧名 Invoke 已废弃）
      const Explicit = (monaco.languages.InlineCompletionTriggerKind ?? {}).Explicit ?? 1;
      if (ai.trigger === 'manual' && context.triggerKind !== Explicit) return { items: [] };

      const mySeq = ++seq;
      const version = model.getVersionId();
      log.debug(`触发 #${mySeq}`, { 触发类型: context.triggerKind === Explicit ? '手动/显式' : '自动', 方案: ai.name, 模型: ai.model, 防抖ms: ai.trigger === 'manual' ? 0 : Math.min(Number(ai.debounceMs) || 0, 3000) });

      // 防抖（显式触发不防抖）
      const debounceMs = Math.max(0, Math.min(Number(ai.debounceMs) || 0, 3000));
      if (context.triggerKind !== Explicit && debounceMs > 0) {
        await new Promise((r) => setTimeout(r, debounceMs));
        if (token.isCancellationRequested || model.getVersionId() !== version || mySeq !== seq) {
          log.debug(`#${mySeq} 防抖期间作废（新键入/取消）`);
          return { items: [] };
        }
      }

      const { prefix, suffix } = getContextText(model, position);
      if (!prefix.trim()) return { items: [] };

      onStatus?.('thinking');
      const startedAt = Date.now();
      let usage = null;
      try {
        const text = await requestAiCompletion(ai, {
          prefix, suffix, signal: tokenSignal(token),
          onUsage: (u) => { usage = u; },
        });
        // 被取消/被更新的请求同样计了真实费用，也入账
        recordUsage({
          profileId: ai.activeId, profileName: ai.name, model: ai.model,
          prompt: usage?.prompt ?? 0, completion: usage?.completion ?? 0,
          estimated: !!usage?.estimated, latencyMs: Date.now() - startedAt,
        });
        log.debug(`#${mySeq} 返回`, { 耗时ms: Date.now() - startedAt, 文本长度: text.length, usage });
        if (token.isCancellationRequested || mySeq !== seq) return { items: [] };
        if (!text.trim()) return { items: [] };
        lastError = null;
        return { items: [{ insertText: text }] };
      } catch (exn) {
        if (mySeq === seq && !token.isCancellationRequested) {
          log.error(`#${mySeq} 补全失败`, exn);
          lastError = exn?.message ?? String(exn);
          onStatus?.({ error: lastError });
        }
        // 网络失败/主动取消（abort）不计失败次数；服务端报错才计
        if (!token.isCancellationRequested && mySeq === seq) {
          recordUsage({
            profileId: ai.activeId, profileName: ai.name, model: ai.model,
            prompt: usage?.prompt ?? 0, completion: 0, estimated: !!usage?.estimated,
            latencyMs: Date.now() - startedAt, error: true,
          });
        }
        return { items: [] };
      } finally {
        if (mySeq === seq) onStatus?.('idle');
      }
    },
    freeInlineCompletions() {},
    handleItemDidShow() {},
  });
}
