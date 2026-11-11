'use client';

/**
 * AI 对话面板（双显示模式）：
 * - float（默认）：视口居中浮窗，头部可拖拽移动、右下角可缩放，几何持久化
 *   stmt-chat-float-v1；移动端（<768px）一律全屏 sheet，几何不生效。
 * - sidebar：现状右侧抽屉。
 * 多会话（lib/chat-store 会话版 API）：头部当前会话下拉 + 历史列表
 * （新建 / 内联重命名 / 删除），按 updatedAt 排序，首条用户消息前 12 字
 * 自动命名（手动改名后不再覆盖）。
 * 思考过程：assistant 消息的 reasoning 渲染为折叠块（纯文本，不走 renderRich），
 * 流式期间实时增长。
 * 上下文注入：题面（含样例开关 includeSamples）、编辑器代码（editor-bridge）、
 * 最近一次编译器运行结果（ide-bus 'run-finished'，includeRunErrors 开关）。
 */

import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  History,
  MessageSquarePlus,
  PanelRight,
  Pencil,
  Scan,
  Square,
  Trash2,
  X,
} from 'lucide-react';

import { useSettings } from '@/components/settings';
import { chatReady, resolveChatCfg, sendChat } from '@/lib/chat';
import { downloadChatMarkdown } from '@/lib/chat-export';
import {
  createSession,
  deleteSession,
  loadActiveMessages,
  loadSessions,
  renameSession,
  saveSessions,
} from '@/lib/chat-store';
import { getCurrentCode } from '@/lib/editor-bridge';
import { on as onIdeBus } from '@/lib/ide-bus';
import { toast } from '@/lib/toast';
import { Spinner } from '@/components/ui/LoadingOverlay';
import { renderRich } from '@/lib/render';

const STATEMENT_CAP = 8000;
const CODE_CAP = 6000;
const RUNRESULT_CAP = 2000;
const TITLE_FROM_MSG = 12;
const FLOAT_KEY = 'stmt-chat-float-v1';
const FLOAT_DEFAULT = { x: null, y: null, w: 560, h: 640 };
const FLOAT_MIN = { w: 380, h: 320 };
const MAX_HISTORY = 20; // 发送给模型的最近消息数

/* ---------- 浮窗几何 ---------- */

function loadFloatGeometry() {
  if (typeof window === 'undefined') return { ...FLOAT_DEFAULT };
  try {
    const v = JSON.parse(window.localStorage.getItem(FLOAT_KEY) || 'null');
    if (v && Number.isFinite(v.w) && Number.isFinite(v.h)) {
      return {
        x: Number.isFinite(v.x) ? v.x : null,
        y: Number.isFinite(v.y) ? v.y : null,
        w: v.w,
        h: v.h,
      };
    }
  } catch {}
  return { ...FLOAT_DEFAULT };
}

function saveFloatGeometry(geo) {
  try {
    window.localStorage.setItem(FLOAT_KEY, JSON.stringify(geo));
  } catch {}
}

/* ---------- 上下文构建 ---------- */

function buildSystemPrompt(problem, { includeStatement, includeCode, includeSamples, runResult }) {
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
    if (includeSamples !== false) {
      const samples = (problem.samples || [])
        .slice(0, 3)
        .map((s, i) => `### 样例 ${i + 1}\n\n输入：\n\`\`\`\n${s.input}\n\`\`\`\n\n输出：\n\`\`\`\n${s.output}\n\`\`\``)
        .join('\n\n');
      if (samples) seg.push(samples);
    }
    if (seg.length) parts.push(`## 题目上下文\n\n${seg.join('\n\n')}`);
  }
  if (includeCode) {
    const code = getCurrentCode().slice(0, CODE_CAP);
    if (code.trim()) parts.push(`## 当前编辑器代码\n\n\`\`\`\n${code}\n\`\`\``);
  }
  if (runResult) {
    const seg = [];
    if (runResult.compileError) {
      seg.push(`编译失败：\n\n\`\`\`\n${runResult.compileError.slice(0, RUNRESULT_CAP)}\n\`\`\``);
    } else if (runResult.cases?.length) {
      const verdictZh = { AC: '通过', WA: '答案错误', RE: '运行时错误', TE: '超时' };
      const lines = runResult.cases
        .map((c) => `- 样例 ${c.index + 1}：${verdictZh[c.verdict] || c.verdict}${c.elapsedMs != null ? `（${c.elapsedMs}ms）` : ''}`)
        .join('\n');
      seg.push(lines);
    }
    if (seg.length) {
      parts.push(`## 最近一次运行\n\n（编译器面板最近一次对拍结果，${runResult.problemKey || '当前题目'}）\n\n${seg.join('\n\n')}`.slice(0, RUNRESULT_CAP));
    }
  }
  return parts.join('\n\n');
}

/* ---------- 消息子组件 ---------- */

/** 思考过程折叠块：纯文本（whitespace-pre-wrap），流式期间实时增长。 */
function ThinkingBlock({ reasoning, streaming }) {
  const [open, setOpen] = useState(false);
  if (!reasoning) return null;
  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] transition-colors"
      >
        <ChevronRight className={`size-3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        思考过程
        {streaming && <span className="text-muted-foreground/60">（生成中…）</span>}
      </button>
      {open && (
        <div className="bg-muted/50 text-muted-foreground mt-1 max-h-48 overflow-y-auto rounded-lg border px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
          {reasoning}
        </div>
      )}
    </div>
  );
}

/** 会话历史列表（新建 / 内联重命名 / 删除），供两种模式的抽屉复用。 */
function SessionList({ sessions, activeId, onSelect, onCreate, onRename, onDelete, onClose }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');

  const startRename = (s) => {
    setEditingId(s.id);
    setDraft(s.title);
  };
  const commitRename = () => {
    const text = draft.trim();
    if (editingId && text) onRename(editingId, text);
    setEditingId(null);
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-[13px] font-semibold">会话历史</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCreate}
            title="新建会话"
            aria-label="新建会话"
            className="text-muted-foreground hover:text-foreground rounded p-1.5 transition-colors"
          >
            <MessageSquarePlus className="size-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="收起列表"
            aria-label="收起列表"
            className="text-muted-foreground hover:text-foreground rounded p-1.5 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {sessions.length === 0 && (
          <p className="text-muted-foreground px-2 py-4 text-center text-xs">还没有会话，点右上角新建一个。</p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors ${
              s.id === activeId ? 'bg-primary/10' : 'hover:bg-accent'
            }`}
          >
            {editingId === s.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="bg-background min-w-0 flex-1 rounded border px-1.5 py-0.5 text-[12px] outline-none focus:border-primary/60"
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className="min-w-0 flex-1 text-left"
                title={s.title}
              >
                <span className="block truncate text-[12px] font-medium">{s.title}</span>
                <span className="text-muted-foreground block text-[10px]">
                  {s.messages.length} 条 · {new Date(s.updatedAt).toLocaleDateString('zh-CN')}
                </span>
              </button>
            )}
            {editingId === s.id ? (
              <button
                type="button"
                onClick={commitRename}
                title="确认重命名"
                aria-label="确认重命名"
                className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1 transition-colors"
              >
                <Check className="size-3.5" />
              </button>
            ) : (
              <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => startRename(s)}
                  title="重命名"
                  aria-label="重命名会话"
                  className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`删除会话「${s.title}」？`)) onDelete(s.id);
                  }}
                  title="删除会话"
                  aria-label="删除会话"
                  className="text-muted-foreground hover:text-red-500 rounded p-1 transition-colors"
                >
                  <Trash2 className="size-3" />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ChatPanel({ problem, open, onClose, embedded = false }) {
  const { settings, setSettings } = useSettings();
  const chatCfg = settings.chat || {};
  // scope = 题目 id 或 'global'（非题目页预留）
  const scope = problem?.id ? String(problem.id) : 'global';
  const problemKey = problem?.platform ? `${problem.platform}:${problem.id}` : null;

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState('');
  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const lastUserRef = useRef('');
  const runResultRef = useRef(null);

  // 多会话状态：{activeId, sessions}；listOpen = 会话列表抽屉/popover
  const [sessionsState, setSessionsState] = useState({ activeId: null, sessions: [] });
  const [listOpen, setListOpen] = useState(false);
  // 消息/会话状态的镜像 ref：落盘与流式更新基于 ref 计算，避免在
  // setState updater 内做副作用（StrictMode 双调用也不重复写库）
  const messagesRef = useRef([]);
  const sessionsRef = useRef({ activeId: null, sessions: [] });

  // 浮窗几何（float 模式）；isMobile = <768px 全屏 sheet
  const [geo, setGeo] = useState(FLOAT_DEFAULT);
  const [isMobile, setIsMobile] = useState(false);
  const panelRef = useRef(null);
  const dragRef = useRef(null); // {mode:'move'|'resize', startX, startY, base}

  const activeSession = sessionsState.sessions.find((s) => s.id === sessionsState.activeId) || null;
  const activeId = activeSession?.id || null;

  /* ---------- ide-bus：最近一次运行结果 ---------- */
  useEffect(() => {
    const off = onIdeBus('run-finished', (payload) => {
      if (payload?.problemKey && (!problemKey || payload.problemKey === problemKey)) {
        runResultRef.current = payload;
      }
    });
    return off;
  }, [problemKey]);

  /* ---------- 会话载入 ---------- */
  // 打开时载入本 scope 的多会话（含旧数据迁移）；无会话则建第一个
  useEffect(() => {
    if (!open) return;
    let state = loadSessions(scope);
    if (!state || !state.sessions.length) {
      state = createSession(scope, problem ? '默认会话' : '全局会话');
    }
    sessionsRef.current = state;
    setSessionsState(state);
    const msgs = loadActiveMessages(scope);
    messagesRef.current = msgs;
    setMessages(msgs);
    setNotice('');
  }, [open, scope, problem]);

  // 组件卸载时中止在途流式请求（AI-17）：题目页切换会卸载 AiFab/ChatPanel,
  // 不中止则请求继续消耗 token,且卸载后 setState 被丢弃、已生成部分不落盘
  useEffect(() => () => abortRef.current?.abort(), []);

  // 新消息 / 流式增长时贴底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  /* ---------- 浮窗几何初始化与 clamp ---------- */
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia('(max-width: 767.98px)');
    const syncMobile = () => setIsMobile(mq.matches);
    syncMobile();
    mq.addEventListener('change', syncMobile);
    setGeo((prev) => {
      const g = prev.x == null ? loadFloatGeometry() : prev;
      const w = Math.max(FLOAT_MIN.w, Math.min(g.w, window.innerWidth * 0.92));
      const h = Math.max(FLOAT_MIN.h, Math.min(g.h, window.innerHeight * 0.88));
      const x = g.x == null ? Math.max(8, (window.innerWidth - w) / 2) : g.x;
      const y = g.y == null ? Math.max(8, (window.innerHeight - h) / 2) : g.y;
      // 刷新后拖出视口的几何 clamp 回来
      return {
        w,
        h,
        x: Math.min(Math.max(x, 8 - w + 80), window.innerWidth - 80),
        y: Math.min(Math.max(y, 8), window.innerHeight - 48),
      };
    });
    return () => mq.removeEventListener('change', syncMobile);
  }, [open]);

  const commitGeo = (next) => {
    setGeo(next);
    if (!isMobile) saveFloatGeometry(next);
  };

  /* ---------- 浮窗拖拽（pointer events + setPointerCapture） ---------- */
  const onDragStart = (mode) => (e) => {
    if (isMobile) return;
    // 落在标题栏按钮/交互元素上的按下不作为拖拽起点，否则 pointer capture
    // 会把 click 吞掉（关闭/历史/导出等按钮点击失效）
    if (e.target.closest?.('button, input, select, textarea, a, [role="menuitem"]')) return;
    e.preventDefault();
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, base: { ...geo } };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onDragMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.mode === 'move') {
      commitGeo({
        ...d.base,
        x: Math.min(Math.max(d.base.x + dx, 8 - d.base.w + 80), window.innerWidth - 80),
        y: Math.min(Math.max(d.base.y + dy, 8), window.innerHeight - 48),
      });
    } else {
      commitGeo({
        ...d.base,
        w: Math.max(FLOAT_MIN.w, Math.min(d.base.w + dx, window.innerWidth * 0.92)),
        h: Math.max(FLOAT_MIN.h, Math.min(d.base.h + dy, window.innerHeight * 0.88)),
      });
    }
  };
  const onDragEnd = () => {
    dragRef.current = null;
  };

  /* ---------- 会话操作 ---------- */
  const persistState = (state) => {
    sessionsRef.current = state;
    saveSessions(scope, state);
    setSessionsState(state);
  };

  const switchSession = (id) => {
    const state = { ...sessionsRef.current, activeId: id };
    persistState(state);
    const msgs = state.sessions.find((s) => s.id === id)?.messages || [];
    messagesRef.current = msgs;
    setMessages(msgs);
    setListOpen(false);
  };

  const newSession = () => {
    persistState(createSession(scope));
    messagesRef.current = [];
    setMessages([]);
    setListOpen(false);
  };

  const renameCurrent = (id, title) => {
    const next = renameSession(scope, id, title);
    if (next) persistState(next);
  };

  const removeSession = (id) => {
    const next = deleteSession(scope, id);
    if (!next) return;
    if (!next.activeId) {
      // 全部删完：直接补一个空会话，面板始终可用
      const state = createSession(scope);
      persistState(state);
      messagesRef.current = [];
      setMessages([]);
      return;
    }
    persistState(next);
    // active 被删回落到别的会话时，同步消息区
    const msgs = next.sessions.find((s) => s.id === next.activeId)?.messages || [];
    if (next.activeId !== activeId || msgs !== messagesRef.current) {
      messagesRef.current = msgs;
      setMessages(msgs);
    }
  };

  // 把消息写回 active 会话（含自动标题：首条用户消息前 12 字，未手动改名时）。
  // 基于 sessionsRef 计算（不在 setState updater 内做 IO），再一次性同步 state。
  const saveActiveMessages = (msgs) => {
    messagesRef.current = msgs;
    const prev = sessionsRef.current;
    const sessions = prev.sessions.map((s) =>
      s.id === prev.activeId
        ? {
            ...s,
            messages: msgs,
            updatedAt: Date.now(),
            title:
              !s.renamed && !s.messages.length && msgs[0]?.role === 'user'
                ? msgs[0].content.slice(0, TITLE_FROM_MSG)
                : s.title,
          }
        : s,
    );
    const state = { activeId: prev.activeId, sessions };
    sessionsRef.current = state;
    saveSessions(scope, state);
    setSessionsState(state);
  };

  const patchChat = (p) => setSettings((prev) => ({ ...prev, chat: { ...(prev.chat || {}), ...p } }));

  const stop = () => {
    abortRef.current?.abort();
  };

  // 导出整段会话为 Markdown 文档（跳过报错中间态）
  const exportChat = () => {
    downloadChatMarkdown(messages, {
      title: `AI 对话记录${problem ? ` · ${problem.titleZh || problem.title}` : ''}`,
      problemId: problem?.id || problem?.titleZh || scope,
      url: typeof window !== 'undefined' ? window.location.href : '',
    });
  };

  const updateLast = (fn) => {
    const next = [...messagesRef.current];
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].role === 'assistant') {
        next[i] = fn(next[i]);
        break;
      }
    }
    messagesRef.current = next;
    setMessages(next);
  };

  const persist = (updater) => {
    const next = typeof updater === 'function' ? updater(messagesRef.current) : updater;
    saveActiveMessages(next);
    setMessages(next);
  };

  const doSend = async (rawText) => {
    const text = String(rawText || '').trim();
    if (!text || streaming) return;
    const cfg = resolveChatCfg(settings);
    if (!chatReady(cfg)) {
      setNotice('尚未配置 AI 接口：请在设置 →「AI 服务商」中填写 Base URL 与 API Key。');
      return;
    }
    setNotice('');
    lastUserRef.current = text;

    const system = buildSystemPrompt(problem, {
      includeStatement: chatCfg.includeStatement !== false,
      includeCode: chatCfg.includeCode !== false,
      includeSamples: chatCfg.includeSamples !== false,
      runResult: chatCfg.includeRunErrors !== false ? runResultRef.current : null,
    });
    const history = messages
      .filter((m) => !m.error && m.content)
      .slice(-MAX_HISTORY)
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
        onDelta: (_d, fullText, reasoningFull) =>
          updateLast((m) => ({ ...m, content: fullText, reasoning: reasoningFull || undefined })),
      });
      updateLast((m) => ({ ...m, streaming: false }));
    } catch (e) {
      const aborted = ctrl.signal.aborted || e?.name === 'AbortError';
      updateLast((m) => ({
        ...m,
        streaming: false,
        error: aborted ? '已停止生成' : e?.message || '请求失败',
      }));
      if (!aborted) toast.error(`发送失败：${e?.message || '请求失败'}`);
    } finally {
      abortRef.current = null;
      setStreaming(false);
      // 流结束后把最终内容（含 reasoning）落盘
      saveActiveMessages(messagesRef.current);
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

  const displayMode = chatCfg.displayMode === 'sidebar' ? 'sidebar' : 'float';
  const isFloat = !embedded && displayMode === 'float' && !isMobile;

  /* ---------- 共享内容块 ---------- */

  const headerNode = (
    <div
      onPointerDown={isFloat ? onDragStart('move') : undefined}
      onPointerMove={isFloat ? onDragMove : undefined}
      onPointerUp={isFloat ? onDragEnd : undefined}
      className={`flex items-center gap-2 border-b px-3 py-2.5 ${isFloat ? 'cursor-move touch-none select-none' : ''}`}
    >
      <span className="bg-primary/10 text-primary grid size-7 shrink-0 place-items-center rounded-lg">
        <Bot className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold">
          AI 对话
          {problem && (
            <span className="text-muted-foreground ml-1.5 font-normal">
              {problem.index ? `${problem.index} · ` : ''}
              {problem.titleZh || problem.title}
            </span>
          )}
        </p>
        {/* 当前会话下拉 */}
        {sessionsState.sessions.length > 0 && (
          <div className="relative mt-0.5 inline-flex max-w-full items-center">
            <select
              value={activeId || ''}
              onChange={(e) => switchSession(e.target.value)}
              aria-label="切换会话"
              className="text-muted-foreground hover:text-foreground max-w-full cursor-pointer appearance-none truncate bg-transparent pr-4 text-[11px] outline-none"
            >
              {sessionsState.sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <ChevronDown className="text-muted-foreground pointer-events-none absolute right-0 size-3" />
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setListOpen((v) => !v)}
        title="会话历史"
        aria-label="会话历史"
        aria-expanded={listOpen}
        className={`rounded p-1.5 transition-colors ${listOpen ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground'}`}
      >
        <History className="size-4" />
      </button>
      <button
        type="button"
        onClick={exportChat}
        disabled={!messages.some((m) => !m.error && m.content?.trim())}
        title="导出对话为 Markdown 文档"
        aria-label="导出对话为 Markdown 文档"
        className="text-muted-foreground hover:text-foreground rounded p-1.5 transition-colors disabled:opacity-40"
      >
        <Download className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeId) {
            messagesRef.current = [];
            setMessages([]);
            persistState({
              ...sessionsRef.current,
              sessions: sessionsRef.current.sessions.map((s) =>
                s.id === activeId ? { ...s, messages: [], updatedAt: Date.now() } : s,
              ),
            });
          } else setMessages([]);
        }}
        title="清空当前会话"
        aria-label="清空当前会话"
        className="text-muted-foreground hover:text-foreground rounded p-1.5 transition-colors"
      >
        <Eraser className="size-4" />
      </button>
      {!embedded && <button
        type="button"
        onClick={() => patchChat({ displayMode: isFloat ? 'sidebar' : 'float' })}
        title={isFloat ? '切换为侧边栏' : '切换为浮窗'}
        aria-label={isFloat ? '切换为侧边栏' : '切换为浮窗'}
        className="text-muted-foreground hover:text-foreground rounded p-1.5 transition-colors"
      >
        {isFloat ? <PanelRight className="size-4" /> : <Scan className="size-4" />}
      </button>}
      {!embedded && <button
        type="button"
        onClick={onClose}
        title="关闭"
        aria-label="关闭"
        className="text-muted-foreground hover:text-foreground rounded p-1.5 transition-colors"
      >
        <X className="size-4" />
      </button>}
    </div>
  );

  const contextNode = (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
      <span className="text-muted-foreground text-[11px]">附带上下文：</span>
      {[
        { key: 'includeStatement', label: '题面', disabled: !problem },
        { key: 'includeSamples', label: '样例', disabled: !problem },
        { key: 'includeCode', label: '当前代码' },
        { key: 'includeRunErrors', label: '运行结果' },
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
  );

  const messagesNode = (
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
          <div key={i} className="group flex w-full flex-col items-start gap-1">
            <ThinkingBlock reasoning={m.reasoning} streaming={m.streaming} />
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
              ) : m.reasoning ? (
                <span className="text-muted-foreground text-[11px]">思考中…</span>
              ) : (
                <span className="inline-flex py-0.5" aria-label="生成中">
                  <Spinner className="size-3.5" />
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
  );

  const inputNode = (
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
  );

  /* ---------- 布局（float / sidebar / 移动端全屏） ---------- */

  if (embedded) {
    // 嵌入模式（/ide 侧栏）：填满父容器，无遮罩 / 浮窗几何，会话历史为面板内 popover
    return (
      <div className="relative flex h-full min-h-0 flex-col" aria-label="AI 对话">
        {headerNode}
        {contextNode}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {listOpen && (
            <div className="bg-popover text-popover-foreground absolute inset-x-2 top-1 z-20 max-h-[70%] overflow-hidden rounded-lg border shadow-xl">
              <SessionList
                sessions={sessionsState.sessions}
                activeId={activeId}
                onSelect={switchSession}
                onCreate={newSession}
                onRename={renameCurrent}
                onDelete={removeSession}
                onClose={() => setListOpen(false)}
              />
            </div>
          )}
          {messagesNode}
        </div>
        {inputNode}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-label="AI 对话">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* 会话历史抽屉：sidebar / 移动端为左侧滑层；float 为面板内 popover */}
      {listOpen && !isFloat && (
        <div className="absolute inset-y-0 left-0 z-10 w-64 border-r bg-card shadow-xl">
          <SessionList
            sessions={sessionsState.sessions}
            activeId={activeId}
            onSelect={switchSession}
            onCreate={newSession}
            onRename={renameCurrent}
            onDelete={removeSession}
            onClose={() => setListOpen(false)}
          />
        </div>
      )}

      {isFloat ? (
        <div
          ref={panelRef}
          className="chat-panel-anim absolute flex flex-col overflow-hidden rounded-xl border bg-card shadow-2xl"
          style={{
            left: geo.x,
            top: geo.y,
            width: geo.w,
            height: geo.h,
            maxWidth: '92vw',
            maxHeight: '88dvh',
          }}
        >
          {headerNode}
          {contextNode}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {/* float 模式：顶部会话条 + 列表 popover */}
            {listOpen && (
              <div className="bg-popover text-popover-foreground absolute inset-x-3 top-1 z-20 max-h-[70%] overflow-hidden rounded-lg border shadow-xl">
                <SessionList
                  sessions={sessionsState.sessions}
                  activeId={activeId}
                  onSelect={switchSession}
                  onCreate={newSession}
                  onRename={renameCurrent}
                  onDelete={removeSession}
                  onClose={() => setListOpen(false)}
                />
              </div>
            )}
            {messagesNode}
          </div>
          {inputNode}
          {/* 右下角缩放手柄 */}
          <div
            onPointerDown={onDragStart('resize')}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            title="拖拽调整大小"
            aria-label="拖拽调整大小"
            className="absolute right-0 bottom-0 size-4 cursor-nwse-resize touch-none"
          >
            <svg viewBox="0 0 16 16" className="text-muted-foreground/50 size-full" aria-hidden>
              <circle cx="14" cy="14" r="1.2" fill="currentColor" />
              <circle cx="10" cy="14" r="1.2" fill="currentColor" />
              <circle cx="14" cy="10" r="1.2" fill="currentColor" />
              <circle cx="6" cy="14" r="1.2" fill="currentColor" />
              <circle cx="14" cy="6" r="1.2" fill="currentColor" />
            </svg>
          </div>
        </div>
      ) : (
        <aside className="chat-panel-anim absolute top-0 right-0 flex h-full w-full flex-col border-l bg-card shadow-2xl sm:w-[420px]">
          {headerNode}
          {contextNode}
          {messagesNode}
          {inputNode}
        </aside>
      )}
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
