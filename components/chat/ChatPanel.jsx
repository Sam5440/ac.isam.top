'use client';

/**
 * AI 对话面板：右侧滑入（移动端全屏）。上下文自动注入当前题面与编辑器代码
 * （经 lib/editor-bridge 读取，可在头部开关）；流式回复，失败可重试；
 * 会话按题目持久化（lib/chat-store）。
 */

import { useEffect, useRef, useState } from 'react';
import { Bot, Copy, Eraser, Square, X } from 'lucide-react';

import { useSettings } from '@/components/settings';
import { chatReady, resolveChatCfg, sendChat } from '@/lib/chat';
import { clearChat, loadChat, saveChat } from '@/lib/chat-store';
import { getCurrentCode } from '@/lib/editor-bridge';
import { renderRich } from '@/lib/render';

const STATEMENT_CAP = 8000;
const CODE_CAP = 6000;

function buildSystemPrompt(problem, includeStatement, includeCode) {
  const parts = [
    '你是一位算法竞赛教练与编程助手，用简体中文回答。解答要具体、直接：先给思路与复杂度分析，再给代码（默认 C++20，除非用户要求其他语言）。数学公式用 $...$，代码用 markdown 代码块。',
  ];
  if (problem && includeStatement) {
    const seg = [];
    seg.push(`# 当前题目：${problem.index ? `${problem.index}. ` : ''}${problem.titleZh || problem.title}`);
    if (problem.titleZh && problem.title && problem.titleZh !== problem.title) {
      seg.push(`（原题名：${problem.title}）`);
    }
    if (problem.timeLimitMs) {
      seg.push(
        `时限 ${(problem.timeLimitMs / 1000).toFixed(problem.timeLimitMs % 1000 ? 1 : 0)}s${
          problem.memoryLimitMb ? `，内存 ${problem.memoryLimitMb}MB` : ''
        }`,
      );
    }
    const md = String(problem.statementMd || '').slice(0, STATEMENT_CAP);
    if (md) seg.push(`## 题面\n\n${md}`);
    const samples = (problem.samples || [])
      .slice(0, 3)
      .map((s, i) => `### 样例 ${i + 1}\n\n输入：\n\`\`\`\n${s.input}\n\`\`\`\n\n输出：\n\`\`\`\n${s.output}\n\`\`\``)
      .join('\n\n');
    if (samples) seg.push(samples);
    if (seg.length) parts.push(`## 题目上下文\n\n${seg.join('\n\n')}`);
  }
  if (includeCode) {
    const code = getCurrentCode().slice(0, CODE_CAP);
    if (code.trim()) parts.push(`## 当前编辑器代码\n\n\`\`\`\n${code}\n\`\`\``);
  }
  return parts.join('\n\n');
}

export default function ChatPanel({ problem, open, onClose }) {
  const { settings, setSettings } = useSettings();
  const chatCfg = settings.chat || {};
  const chatId = problem?.id || null;

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState('');
  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const lastUserRef = useRef('');

  // 打开时载入本题会话
  useEffect(() => {
    if (open) {
      setMessages(loadChat(chatId));
      setNotice('');
    }
  }, [open, chatId]);

  // 组件卸载时中止在途流式请求（AI-17）：题目页切换会卸载 AiFab/ChatPanel,
  // 不中止则请求继续消耗 token,且卸载后 setState 被丢弃、已生成部分不落盘
  useEffect(() => () => abortRef.current?.abort(), []);

  // 新消息 / 流式增长时贴底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const patchChat = (p) => setSettings((prev) => ({ ...prev, chat: { ...(prev.chat || {}), ...p } }));

  const stop = () => {
    abortRef.current?.abort();
  };

  const updateLast = (fn) =>
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'assistant') {
          next[i] = fn(next[i]);
          break;
        }
      }
      return next;
    });

  const persist = (updater) =>
    setMessages((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveChat(chatId, next);
      return next;
    });

  const doSend = async (rawText) => {
    const text = String(rawText || '').trim();
    if (!text || streaming) return;
    const cfg = resolveChatCfg(settings);
    if (!chatReady(cfg)) {
      setNotice('尚未配置 AI 接口：请在设置 →「AI 对话」或「翻译」中填写 Base URL 与 API Key。');
      return;
    }
    setNotice('');
    lastUserRef.current = text;

    const includeStatement = chatCfg.includeStatement !== false;
    const includeCode = chatCfg.includeCode !== false;
    const system = buildSystemPrompt(problem, includeStatement, includeCode);
    const history = messages
      .filter((m) => !m.error && m.content)
      .slice(-20)
      .map(({ role, content }) => ({ role, content }));
    const payload = [{ role: 'system', content: system }, ...history, { role: 'user', content: text }];

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreaming(true);
    persist((prev) => [
      ...prev,
      { role: 'user', content: text, ts: Date.now() },
      { role: 'assistant', content: '', streaming: true },
    ]);
    try {
      await sendChat({
        messages: payload,
        cfg,
        signal: ctrl.signal,
        onDelta: (_d, fullText) => updateLast((m) => ({ ...m, content: fullText })),
      });
      updateLast((m) => ({ ...m, streaming: false }));
    } catch (e) {
      const aborted = ctrl.signal.aborted || e?.name === 'AbortError';
      updateLast((m) => ({
        ...m,
        streaming: false,
        error: aborted ? '已停止生成' : e?.message || '请求失败',
      }));
    } finally {
      abortRef.current = null;
      setStreaming(false);
      // 流结束后把最终内容落盘
      setMessages((prev) => {
        saveChat(chatId, prev);
        return prev;
      });
    }
  };

  const retry = () => {
    // 去掉出错的 assistant 回复后重发上一条用户消息
    persist((prev) => {
      const next = [...prev];
      while (next.length && next[next.length - 1].role === 'assistant') next.pop();
      return next;
    });
    if (lastUserRef.current) doSend(lastUserRef.current);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      doSend(input);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-label="AI 对话">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="chat-panel-anim absolute top-0 right-0 flex h-full w-full flex-col border-l bg-card shadow-2xl sm:w-[420px]">
        {/* 头部 */}
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <span className="bg-primary/10 text-primary grid size-7 shrink-0 place-items-center rounded-lg">
            <Bot className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">
              AI 对话
              {problem && <span className="text-muted-foreground ml-1.5 font-normal">{problem.index ? `${problem.index} · ` : ''}{problem.titleZh || problem.title}</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              clearChat(chatId);
              setMessages([]);
            }}
            title="清空本题对话"
            aria-label="清空本题对话"
            className="text-muted-foreground hover:text-foreground rounded p-1.5 transition-colors"
          >
            <Eraser className="size-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
            className="text-muted-foreground hover:text-foreground rounded p-1.5 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* 上下文开关 */}
        <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
          <span className="text-muted-foreground text-[11px]">附带上下文：</span>
          {[
            { key: 'includeStatement', label: '题面', disabled: !problem },
            { key: 'includeCode', label: '当前代码' },
          ].map((c) => {
            const on = chatCfg[c.key] !== false;
            return (
              <button
                key={c.key}
                type="button"
                disabled={c.disabled}
                onClick={() => patchChat({ [c.key]: !on })}
                aria-pressed={on}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40 ${
                  on ? 'border-primary/60 bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {/* 消息列表 */}
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {messages.length === 0 && (
            <div className="text-muted-foreground mt-8 space-y-2 text-center text-xs leading-relaxed">
              <Bot className="mx-auto size-8 opacity-40" />
              <p>基于本题与当前代码向 AI 提问，例如：</p>
              <p>「这道题的贪心策略为什么正确？」「帮我看看现在的代码哪里写错了。」</p>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="bg-primary/10 max-w-[85%] rounded-xl rounded-br-sm px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="group flex flex-col items-start gap-1">
                <div
                  className={`md-body max-w-full overflow-x-auto rounded-xl rounded-bl-sm border px-3 py-2 text-[13px] leading-relaxed ${
                    m.error ? 'border-red-500/40 text-red-400' : ''
                  }`}
                >
                  {m.error ? (
                    <>
                      {m.content && <div className="mb-1 opacity-70">（已生成的部分）</div>}
                      <span>⚠ {m.error}</span>
                      <button
                        type="button"
                        onClick={retry}
                        className="ml-2 rounded border px-1.5 py-0.5 text-[11px] transition-colors hover:bg-accent"
                      >
                        重试
                      </button>
                    </>
                  ) : m.content ? (
                    <div dangerouslySetInnerHTML={{ __html: renderRich(m.content) }} />
                  ) : (
                    <span className="inline-flex gap-1 py-0.5" aria-label="生成中">
                      <span className="bg-muted-foreground size-1.5 animate-bounce rounded-full" />
                      <span className="bg-muted-foreground size-1.5 animate-bounce rounded-full [animation-delay:120ms]" />
                      <span className="bg-muted-foreground size-1.5 animate-bounce rounded-full [animation-delay:240ms]" />
                    </span>
                  )}
                </div>
                {m.content && !m.error && !m.streaming && (
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(m.content)}
                    title="复制回复"
                    aria-label="复制回复"
                    className="text-muted-foreground hover:text-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Copy className="size-3.5" />
                  </button>
                )}
              </div>
            ),
          )}
        </div>

        {/* 输入区 */}
        <div className="border-t px-3 py-2.5">
          {notice && <p className="text-amber-500 mb-1.5 text-[11px] leading-relaxed">{notice}</p>}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder="向 AI 提问…（Enter 发送，Shift+Enter 换行）"
              className="bg-background max-h-32 min-h-11 flex-1 resize-none rounded-lg border px-2.5 py-2 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/60 focus:border-primary/60"
            />
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                title="停止生成"
                aria-label="停止生成"
                className="bg-background hover:bg-accent grid size-9 shrink-0 place-items-center rounded-lg border transition-colors"
              >
                <Square className="size-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => doSend(input)}
                disabled={!input.trim()}
                title="发送"
                aria-label="发送"
                className="bg-primary text-primary-foreground grid size-9 shrink-0 place-items-center rounded-lg transition-opacity disabled:opacity-40"
              >
                <SendIcon className="size-4" />
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function SendIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}
