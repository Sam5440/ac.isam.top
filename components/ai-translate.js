'use client';

/**
 * Browser-side on-demand translation via any OpenAI-compatible chat
 * completions endpoint configured by the user (settings dialog). The API key
 * never leaves the browser except to the endpoint the user chose.
 *
 * Uses the same placeholder protection as the server pipeline: math
 * ($$$…$$$), inline code, images and bare URLs are masked before the request
 * and spliced back after, with slot-count verification.
 */
import { useEffect, useState } from 'react';
import { protectMath, restoreMath } from '@/lib/mt-protect';

export const AI_MODELS = ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol', 'deepseek-v4-flash', 'glm-5.3-flash', 'kimi-k3'];

export function normalizeBaseUrl(u) {
  const s = String(u || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  return /\/v\d+$/.test(s) ? s : `${s}/v1`;
}

export async function aiTranslate(text, cfg, { signal } = {}) {
  const { masked, stash } = protectMath(text);
  const res = await fetch(`${normalizeBaseUrl(cfg.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content:
            '你是专业的算法竞赛题面翻译器。把用户文本翻译成简体中文：术语遵循算法竞赛惯例（如 greedy=贪心、dp=DP）；' +
            '$$$...$$$ 数学公式、`行内代码`、![](图片链接) 和裸 URL 一律原样保留不翻译；只输出译文，不要任何解释。',
        },
        { role: 'user', content: masked },
      ],
    }),
    // 30s 硬超时（审查 2026-11-09 AI-5）：旧实现无任何超时/外部 signal,
    // 挂死端点会让渠道体检的「停止」失效、ai_custom 体检永久挂起、翻译
    // FIFO 的并发位被占死。外部 signal 与超时任一触发即中止。
    signal: signal ? AbortSignal.any?.([signal, AbortSignal.timeout(30000)]) ?? signal : AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json())?.error?.message || msg;
    } catch {}
    throw new Error(msg);
  }
  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error('空响应');
  const restored = restoreMath(out, stash);
  if (!restored) throw new Error('公式占位符丢失');
  return restored;
}

/* -------- shared cache + small FIFO queue (concurrency 2) -------- */

// key -> { text } | { error, at }。错误结果只保留 60s（AI-20）：旧实现把
// 失败永久写入模块级缓存且 key 不含 apiKey —— 用户修好 Key/网络恢复后
// 同一段永远回放旧错误,只能整页刷新。
const cache = new Map(); // key -> { text } | { error, at }
const ERROR_TTL = 60 * 1000;
const inflight = new Map(); // key -> Promise<string>
const jobQueue = [];
let running = 0;
const CONCURRENCY = 2;

function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && !hit.text && hit.at && Date.now() - hit.at > ERROR_TTL) {
    cache.delete(key);
    return undefined;
  }
  return hit;
}

function pump() {
  while (running < CONCURRENCY && jobQueue.length) {
    running++;
    jobQueue
      .shift()()
      .finally(() => {
        running--;
        pump();
      });
  }
}

function ensureJob(key, text, cfg) {
  const hit = cacheGet(key);
  if (hit) return hit.text ? Promise.resolve(hit.text) : Promise.reject(new Error(hit.error));
  if (inflight.has(key)) return inflight.get(key);
  const p = new Promise((resolve, reject) => {
    jobQueue.push(() => aiTranslate(text, cfg).then(resolve, reject));
  })
    .then((t) => {
      cache.set(key, { text: t });
      return t;
    })
    .catch((e) => {
      cache.set(key, { error: e.message, at: Date.now() });
      throw e;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  pump();
  return p;
}

/**
 * Translate `text` with the user's AI endpoint once (and only once per
 * key); multiple subscribers share the same in-flight request.
 * Returns { status: 'idle'|'loading'|'done'|'error', text?, error? }.
 */
export function useAiSegment(text, cfg, enabled) {
  // key 纳入 apiKey（AI-20）：换 Key 后立即走新请求,不再命中旧 Key
  // 产生的结果/错误缓存（key 只在内存 Map 里,不落盘）
  const key = enabled && cfg?.baseUrl && cfg?.apiKey ? `${cfg.baseUrl}|${cfg.model}|${cfg.apiKey}|${text}` : null;
  const [state, setState] = useState(() => {
    if (!key) return { status: 'idle' };
    const hit = cacheGet(key);
    return hit ? (hit.text ? { status: 'done', text: hit.text } : { status: 'error', error: hit.error }) : { status: 'idle' };
  });

  useEffect(() => {
    if (!key) {
      setState({ status: 'idle' });
      return;
    }
    const hit = cacheGet(key);
    if (hit) {
      setState(hit.text ? { status: 'done', text: hit.text } : { status: 'error', error: hit.error });
      return;
    }
    let alive = true;
    setState({ status: 'loading' });
    ensureJob(key, text, cfg)
      .then((t) => alive && setState({ status: 'done', text: t }))
      .catch((e) => alive && setState({ status: 'error', error: e.message }));
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
