/**
 * Agent 沙盒执行器（仅浏览器）：把 `lib/ai-agent.mjs` 解析出的 run 请求交给
 * 站内已有的 wasm 运行时（CppClient / PyClient）跑一遍题目样例。
 *
 * 不联网、不落盘：源码与输出都只存在于当前内存；不写 IndexedDB、不写
 * localStorage、不发请求（运行时资源除外，走已缓存的 Cache API）。
 */

'use client';

import { judgeCase } from '@/lib/compiler/diff';
import { CppClient } from '@/lib/compiler/cpp-client';
import { PyClient } from '@/lib/compiler/py-client';
import { loadCpSettings } from '@/lib/compiler/cp-settings';

let cpp = null;
let py = null;

function getCpp() {
  return (cpp ??= new CppClient());
}

function getPy() {
  return (py ??= new PyClient());
}

/** 终止沙盒（停止生成时调用，防止死循环一直占着 worker）。 */
export function stopAgentSandbox() {
  try {
    cpp?.stop?.();
  } catch {}
  try {
    py?.stop?.();
  } catch {}
}

const PER_CASE_TIMEOUT = 10_000;

/**
 * 跑一组样例。
 * @param {{language:string, source:string, stdin:string}} req
 * @param {{samples?: {input:string, output:string}[], onStage?: (s:string)=>void}} opts
 * @returns {Promise<{language:string, source:string, compileError:string|null, results:Array, note?:string}>}
 */
export async function runAgentSandbox(req, { samples = [], onStage } = {}) {
  const language = req.language === 'python' ? 'python' : 'cpp';
  const source = req.source;
  const cases = (samples || []).filter((s) => s && typeof s.input === 'string');
  const cp = loadCpSettings();

  // 没有附带样例：用自定义 stdin（可能为空）跑一次，只回报输出，不判题
  if (!cases.length) {
    onStage?.(language === 'python' ? 'Python 沙盒运行…' : 'C++ 沙盒运行…');
    if (language === 'python') {
      let out = '';
      try {
        const res = await getPy().run({
          code: source,
          stdin: req.stdin || '',
          versionId: cp?.pythonVersion,
          timeoutMs: PER_CASE_TIMEOUT,
          onOutput: (kind, text) => {
            if (kind === 'out') out += text;
          },
        });
        return {
          language,
          source,
          compileError: res.success ? null : String(res.error || '运行失败'),
          results: [{ index: 0, verdict: res.success ? 'AC' : 'RE', actual: out, expected: null, elapsedMs: res.elapsedMs }],
          note: '未附带样例：仅运行一次，未判题',
        };
      } catch (exn) {
        return { language, source, compileError: String(exn?.message || exn), results: [], note: '运行失败' };
      }
    }
    try {
      const res = await getCpp().run({
        source,
        std: cp?.cppStd ?? 'c++20',
        stdin: req.stdin || '',
        timeoutMs: PER_CASE_TIMEOUT,
        onStage,
      });
      return {
        language,
        source,
        compileError: null,
        results: [{ index: 0, verdict: res.exitCode === 0 ? 'AC' : 'RE', actual: res.stdout, expected: null, elapsedMs: res.elapsedMs }],
        note: '未附带样例：仅运行一次，未判题',
      };
    } catch (exn) {
      return { language, source, compileError: String(exn?.message || exn), results: [], note: '运行失败' };
    }
  }

  onStage?.(`${language === 'python' ? 'Python' : 'C++'} 沙盒运行 ${cases.length} 个样例…`);
  const results = [];

  if (language === 'cpp') {
    try {
      const res = await getCpp().runCases({
        source,
        std: cp?.cppStd ?? 'c++20',
        stdins: cases.map((c) => c.input),
        timeoutMs: 30_000 + cases.length * PER_CASE_TIMEOUT,
        onStage,
      });
      res.results.forEach((r, i) => {
        const j = judgeCase(cases[i].output, r.stdout ?? '');
        results.push({
          index: i,
          ...j,
          elapsedMs: r.elapsedMs,
          ...(r.exitCode !== 0 ? { verdict: 'RE', note: `exitCode=${r.exitCode}` } : {}),
        });
      });
      return { language, source, compileError: null, results };
    } catch (exn) {
      const compileError = exn?.error?.diagnostics
        ? exn.error.diagnostics.map((d) => `${d.line}:${d.col} ${d.message}`).join('\n')
        : String(exn?.message || exn);
      return { language, source, compileError, results: [] };
    }
  }

  for (let i = 0; i < cases.length; i += 1) {
    onStage?.(`Python 沙盒 ${i + 1}/${cases.length}…`);
    let out = '';
    try {
      const res = await getPy().run({
        code: source,
        stdin: cases[i].input,
        versionId: cp?.pythonVersion,
        timeoutMs: PER_CASE_TIMEOUT,
        onOutput: (kind, text) => {
          if (kind === 'out') out += text;
        },
      });
      const j = judgeCase(cases[i].output, out);
      results.push({
        index: i,
        ...j,
        elapsedMs: res.elapsedMs,
        ...(res.success ? {} : { verdict: 'RE', note: String(res.error || '').slice(0, 600) }),
      });
    } catch (exn) {
      results.push({ index: i, verdict: 'TE', expected: cases[i].output, actual: out, note: String(exn?.message || exn) });
    }
  }
  return { language, source, compileError: null, results };
}
