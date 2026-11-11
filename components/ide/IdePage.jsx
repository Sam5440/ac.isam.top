"use client";

/**
 * /ide 在线编程工作台（状态中枢）：多文件工作区（lib/ide-workspace，IndexedDB）
 * + Monaco 多标签编辑器 + CPH 风格测试面板 + 文件管理器 + 底部终端。
 *
 * 与题目页 CompilerDock 完全独立：不经 #compiler-dock-root portal，不改
 * body.compiler-open，复用同一客户端运行链（CppClient / PyClient，wasm-clang
 * 同源自托管 + Pyodide CDN + Cache API 缓存）。运行完成经 ide-bus 广播
 * 'run-finished'（source:'ide'），AI 对话「最近一次运行」等消费方照常工作。
 *
 * v1.7 全局铺满布局（参考 VS Code / TRAE）：IdeShell 提供外壳（活动栏 +
 * 可拖拽分栏 + 面板开合），本组件仍是唯一状态中枢，layout prop 决定排布：
 *   - "workspace"（IdeShell 内）：面板容器高度全部 h-full（铺满），
 *     底部区由 shell 的 bottomTab 切换 终端 / CI 日志（ciSlot 注入），
 *     测试面板与文件管理器吸收 shell 计算出的宽度样式（frameW props）。
 *   - "legacy"：旧的纵向卡片布局（独立渲染兜底）。
 * AI 对话浮窗由 IdeShell 承载（活动栏 Chat 按钮，复用题目页 ChatPanel；
 * IDE 页无题目 → scope='global'，编辑器代码经 editor-bridge 注入上下文）。
 * 编辑器接入 AI 补全（getAi/onAiStatus，与 CompilerDock 相同链路）。
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { judgeCase, truncate } from "@/lib/compiler/diff";
import { emit } from "@/lib/ide-bus";
import { loadCpSettings } from "@/lib/compiler/cp-settings";
import { loadSampleCases, defaultCasesFrom } from "@/lib/compiler/samples";
import { CPP_FILES, pythonVersion } from "@/lib/compiler/runtimes";
import { hasRuntime } from "@/lib/compiler/runtime-cache";
import { CppClient } from "@/lib/compiler/cpp-client";
import { PyClient } from "@/lib/compiler/py-client";
import { toast } from "@/lib/toast";
import { Spinner } from "@/components/ui/LoadingOverlay";
import { loadAiSettings } from "@/lib/ai/ai-settings";
import TestPanel from "@/components/ide/TestPanel";
import EditorPane from "@/components/ide/EditorPane";
import FileManager from "@/components/ide/FileManager";
import TerminalPane from "@/components/ide/TerminalPane";
import {
  listFiles,
  putFile,
  deleteFile as wsDeleteFile,
  renameFile as wsRenameFile,
  importFiles,
} from "@/lib/ide-workspace";

const CodeEditor = dynamic(() => import("@/components/compiler/CodeEditor"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-xs text-muted-foreground">
      编辑器加载中…
    </div>
  ),
});

const CONSOLE_CAP = 200 * 1024;

/** 运行时是否已就绪（未就绪 → 首次运行触发下载 toast）。 */
async function runtimeReady(lang, pyVersionId) {
  try {
    if (lang === "python") {
      const v = pythonVersion(pyVersionId);
      return hasRuntime(v.files.map((f) => `${v.indexURL}${f}`));
    }
    return hasRuntime(CPP_FILES.map((f) => `/compiler/${f.name}`));
  } catch {
    return false;
  }
}

export default function IdePage({ layout = "legacy", ciSlot = null, activeBottomTab = "terminal" }) {
  const [mounted, setMounted] = useState(false);
  const [cp, setCp] = useState(null); // 编译器偏好（主题/标准/版本/超时）
  const [files, setFiles] = useState([]); // 工作区记录 [{path,name,lang,content,updatedAt}]
  const [openPaths, setOpenPaths] = useState([]); // 打开的标签（路径）
  const [activePath, setActivePath] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState({}); // path → 已落盘内容（脏状态比对）
  // 测试面板
  const [problem, setProblem] = useState(null); // 全量题目 JSON
  const [cases, setCases] = useState([]); // [{index, verdict, expected, actual, diff, elapsedMs, note}]
  // 运行状态与终端
  const [runState, setRunState] = useState("idle"); // idle | running | waiting-input
  const [stage, setStage] = useState("");
  const [consoleText, setConsoleText] = useState("");
  const [diags, setDiags] = useState([]);
  const [stdinText, setStdinText] = useState("");
  // AI 补全状态：'idle' | 'thinking' | {error} | null（未启用），同 CompilerDock
  const [aiStatus, setAiStatus] = useState(null);

  const cppRef = useRef(null);
  const pyRef = useRef(null);
  const feedRef = useRef(null);
  const runTokenRef = useRef(0);
  const consoleRef = useRef(null);
  const saveTimerRef = useRef(null);
  // 编辑器最新内容（防抖落盘 / Ctrl+S / 运行取值，不进 effect 依赖）
  const contentRef = useRef({});
  const activeRef = useRef(null);

  const activeFile = files.find((f) => f.path === activePath) ?? null;
  const lang = activeFile?.lang ?? "cpp";
  const code = activeFile?.content ?? "";

  contentRef.current = Object.fromEntries(files.map((f) => [f.path, f.content]));
  activeRef.current = activePath;
  const consoleTextRef = useRef("");
  consoleTextRef.current = consoleText;

  const appendConsole = useCallback((text) => {
    setConsoleText((prev) => (prev + text).slice(-CONSOLE_CAP));
  }, []);

  /* ---------- 初始化：偏好 + 工作区 ---------- */
  useEffect(() => {
    setCp(loadCpSettings());
    (async () => {
      try {
        const list = await listFiles();
        if (list.length) {
          setFiles(list);
          setSavedSnapshot(Object.fromEntries(list.map((f) => [f.path, f.content])));
          setOpenPaths(list.slice(0, 4).map((f) => f.path));
          setActivePath(list[0].path);
        } else {
          // 空工作区：建一个 main.cpp 起步
          const rec = await putFile("main.cpp", "");
          setFiles([rec]);
          setSavedSnapshot({ [rec.path]: "" });
          setOpenPaths([rec.path]);
          setActivePath(rec.path);
        }
      } catch (exn) {
        toast.error(`工作区加载失败：${exn.message}`);
      }
      setMounted(true);
    })();
  }, []);

  /* ---------- 编辑：300ms 防抖落盘 ---------- */
  const persist = useCallback(async (path, content) => {
    try {
      await putFile(path, content);
      setSavedSnapshot((prev) => ({ ...prev, [path]: content }));
    } catch {
      toast.error("保存失败：工作区写入出错");
    }
  }, []);

  const scheduleSave = useCallback(
    (path, content) => {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => persist(path, content), 300);
    },
    [persist],
  );

  const handleEditorChange = useCallback(
    (value) => {
      const path = activeRef.current;
      if (!path) return;
      setFiles((prev) => prev.map((f) => (f.path === path ? { ...f, content: value } : f)));
      scheduleSave(path, value);
    },
    [scheduleSave],
  );

  const saveNow = useCallback(async () => {
    const path = activeRef.current;
    if (!path) return;
    clearTimeout(saveTimerRef.current);
    await persist(path, contentRef.current[path] ?? "");
    toast.success("已保存到工作区");
  }, [persist]);

  // Ctrl/⌘S 立即落盘（捕获阶段，抢在浏览器保存网页之前）
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key ?? "").toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        saveNow();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [mounted, saveNow]);

  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  /* ---------- 文件管理动作 ---------- */
  const openFile = useCallback((path) => {
    setOpenPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActivePath(path);
  }, []);

  const closeTab = useCallback((path) => {
    setOpenPaths((prev) => {
      const next = prev.filter((p) => p !== path);
      setActivePath((cur) => (cur === path ? next[next.length - 1] ?? null : cur));
      return next;
    });
  }, []);

  const createFile = useCallback(
    async (path) => {
      const clean = String(path ?? "").trim();
      if (!clean) return;
      if (files.some((f) => f.path === clean)) {
        toast.error(`文件已存在：${clean}`);
        return;
      }
      try {
        const rec = await putFile(clean, "");
        setFiles((prev) => [...prev, rec]);
        setSavedSnapshot((prev) => ({ ...prev, [rec.path]: "" }));
        openFile(rec.path);
        toast.success(`已创建 ${rec.path}`);
      } catch (exn) {
        toast.error(`创建失败：${exn.message}`);
      }
    },
    [files, openFile],
  );

  const removeFile = useCallback(
    async (path) => {
      if (!window.confirm(`确定删除 ${path}？此操作不可撤销。`)) return;
      try {
        await wsDeleteFile(path);
        setFiles((prev) => prev.filter((f) => f.path !== path));
        setSavedSnapshot((prev) => {
          const next = { ...prev };
          delete next[path];
          return next;
        });
        closeTab(path);
        toast.success(`已删除 ${path}`);
      } catch (exn) {
        toast.error(`删除失败：${exn.message}`);
      }
    },
    [closeTab],
  );

  const renameFile = useCallback(
    async (oldPath, newPath) => {
      const clean = String(newPath ?? "").trim();
      if (!clean || clean === oldPath) return;
      if (files.some((f) => f.path === clean)) {
        toast.error(`文件已存在：${clean}`);
        return;
      }
      try {
        const rec = await wsRenameFile(oldPath, clean);
        setFiles((prev) => prev.map((f) => (f.path === oldPath ? rec : f)));
        setSavedSnapshot((prev) => {
          const next = { ...prev };
          delete next[oldPath];
          next[rec.path] = rec.content;
          return next;
        });
        setOpenPaths((prev) => prev.map((p) => (p === oldPath ? rec.path : p)));
        setActivePath((cur) => (cur === oldPath ? rec.path : cur));
        toast.success(`已重命名为 ${rec.path}`);
      } catch (exn) {
        toast.error(`重命名失败：${exn.message}`);
      }
    },
    [files],
  );

  const uploadFiles = useCallback(
    async (fileList) => {
      try {
        const imported = await importFiles(fileList);
        if (!imported.length) return;
        setFiles((prev) => [
          ...prev.filter((f) => !imported.some((r) => r.path === f.path)),
          ...imported,
        ]);
        setSavedSnapshot((prev) => ({
          ...prev,
          ...Object.fromEntries(imported.map((r) => [r.path, r.content])),
        }));
        openFile(imported[0].path);
        toast.success(`已导入 ${imported.length} 个文件`);
      } catch (exn) {
        toast.error(`导入失败：${exn.message}`);
      }
    },
    [openFile],
  );

  const refreshFiles = useCallback(async () => {
    try {
      const list = await listFiles();
      setFiles(list);
      setSavedSnapshot(Object.fromEntries(list.map((f) => [f.path, f.content])));
      if (!list.some((f) => f.path === activeRef.current)) {
        setActivePath(list[0]?.path ?? null);
      }
    } catch {}
  }, []);

  /* ---------- 运行链（与 CompilerDock 同一客户端） ---------- */
  const getCpp = useCallback(() => {
    if (!cppRef.current) {
      const c = new CppClient();
      c.onLog = (t) => appendConsole(t);
      cppRef.current = c;
    }
    return cppRef.current;
  }, [appendConsole]);
  const getPy = useCallback(() => (pyRef.current ??= new PyClient()), []);

  useEffect(
    () => () => {
      cppRef.current?.dispose();
      pyRef.current?.dispose();
    },
    [],
  );

  const timeoutMs = (cp?.timeoutSec ?? 10) * 1000;
  const runToken = () => runTokenRef.current;

  /** 广播运行结果（ide-bus 'run-finished'，source:'ide'）。 */
  const emitRunFinished = useCallback((list, exn) => {
    try {
      if (!problem?.platform || !problem?.id) return;
      const compileErr = exn?.error?.diagnostics?.length
        ? exn.error.diagnostics
            .map((d) => (d.file ? `${d.file}:${d.line}:${d.col}: ` : d.line ? `第 ${d.line} 行: ` : "") + (d.message || ""))
            .join("\n")
        : null;
      emit("run-finished", {
        problemKey: `${problem.platform}:${problem.id}`,
        cases: (list || []).map((c) => ({
          index: c.index,
          verdict: c.verdict,
          ...(c.elapsedMs != null ? { elapsedMs: c.elapsedMs } : {}),
        })),
        compileError: compileErr,
        source: "ide",
      });
    } catch {}
  }, [problem]);

  /** C++ 单例结果 → 展示卡片（语义与 CompilerDock.mapCppResult 一致）。 */
  const mapCppResult = useCallback(
    (sample, r) => {
      const j = judgeCase(sample?.output, r.stdout);
      const re = r.trap || r.exitCode !== 0;
      return {
        ...j,
        verdict: r.overtime ? "TE" : re ? "RE" : j.verdict,
        elapsedMs: r.elapsedMs,
        note: r.overtime
          ? `超过单例时间限制（${Math.round(timeoutMs / 1000)}s）`
          : r.trap
            ? `运行时错误：${truncate(r.trap, 200)}`
            : r.exitCode !== 0
              ? `退出码 ${r.exitCode}`
              : null,
      };
    },
    [timeoutMs],
  );

  const beginRun = useCallback(
    async (langId) => {
      const token = ++runTokenRef.current;
      if (!(await runtimeReady(langId, cp?.pythonVersion))) {
        toast.info(langId === "python" ? "正在下载 Python 运行时…" : "正在下载编译运行时…");
      }
      setRunState("running");
      setStage("");
      setDiags([]);
      return token;
    },
    [cp?.pythonVersion],
  );

  /** 运行全部样例（编译一次多例复用 / Python 逐例）。 */
  const runAllSamples = useCallback(
    async (samples) => {
      if (runState !== "idle" || !samples.length) return;
      const token = await beginRun(lang);
      setCases([]);
      setConsoleText("");
      appendConsole(`── 对拍 ${samples.length} 个样例（${lang === "cpp" ? `C++ · ${cp?.cppStd ?? "c++20"}` : "Python"}）──\n`);
      const source = contentRef.current[activeRef.current] ?? "";
      const ranCases = [];
      try {
        if (lang === "cpp") {
          const res = await getCpp().runCases({
            source,
            std: cp?.cppStd ?? "c++20",
            stdins: samples.map((e) => e.input),
            timeoutMs: 30000 + samples.length * timeoutMs,
            perCaseTimeoutMs: timeoutMs,
            onLog: appendConsole,
            onStage: setStage,
            onCase: ({ index, total, result }) => {
              if (token !== runToken()) return;
              const c = { index, ...mapCppResult(samples[index], result) };
              ranCases[index] = c;
              setCases((prev) => [...prev, c]);
              appendConsole(`样例 ${index + 1}/${total}: ${c.verdict}（${c.elapsedMs}ms）\n`);
            },
          });
          if (token !== runToken()) return;
          const all = res.results.map((r, i) => ({ index: i, ...mapCppResult(samples[i], r) }));
          all.forEach((c, i) => (ranCases[i] = c));
          setCases(all);
          appendConsole(`\n编译一次，运行 ${res.results.length} 个样例完成。\n`);
          emitRunFinished(ranCases.filter(Boolean));
        } else {
          for (let i = 0; i < samples.length; i++) {
            if (token !== runToken()) return;
            setStage(`样例 ${i + 1}/${samples.length}`);
            appendConsole(`\n—— 样例 ${i + 1} ——\n`);
            let out = "";
            let res;
            try {
              res = await getPy().run({
                code: source,
                stdin: samples[i].input,
                versionId: cp?.pythonVersion,
                timeoutMs,
                onOutput: (kind, text) => {
                  if (kind === "out") out += text;
                  appendConsole(text);
                },
                onNeedInput: (feed) => feed?.(""),
              });
            } catch (exn) {
              if (token !== runToken()) return;
              const c = { index: i, verdict: "TE", expected: "", actual: "", diff: null, note: exn.message };
              ranCases[i] = c;
              setCases((prev) => [...prev, c]);
              appendConsole(`样例 ${i + 1}/${samples.length}: TE\n`);
              continue;
            }
            if (token !== runToken()) return;
            const j = judgeCase(samples[i].output, out);
            const c = res.success
              ? { index: i, ...j, elapsedMs: res.elapsedMs }
              : { index: i, ...j, verdict: "RE", note: truncate(res.error, 600) };
            ranCases[i] = c;
            setCases((prev) => [...prev, c]);
            appendConsole(`样例 ${i + 1}/${samples.length}: ${c.verdict}${c.elapsedMs != null ? `（${c.elapsedMs}ms）` : ""}\n`);
          }
          emitRunFinished(ranCases.filter(Boolean));
        }
      } catch (exn) {
        if (token !== runToken()) return;
        appendConsole(`\n✗ ${exn.message}\n`);
        if (exn.error?.diagnostics) setDiags(exn.error.diagnostics);
        emitRunFinished(ranCases.filter(Boolean), exn);
      } finally {
        if (token === runToken()) {
          setRunState("idle");
          setStage("");
        }
      }
    },
    [runState, lang, cp, beginRun, appendConsole, getCpp, getPy, mapCppResult, emitRunFinished, timeoutMs],
  );

  /** 运行单个样例（Python 逐例；C++ 也走 runCases 单例，复用编译缓存）。 */
  const runOneSample = useCallback(
    async (index, samples) => {
      const sample = samples[index];
      if (runState !== "idle" || !sample) return;
      await runAllSamples([sample]);
      // 单例结果归位到原样例序号，方便与样例列表对齐
      setCases((prev) => (prev[0] ? [{ ...prev[0], index }] : prev));
    },
    [runState, runAllSamples],
  );

  /** 终端「运行」：以 stdin 文本框内容喂入运行当前文件（同 dock 交互路径，
      需要输入时经 onNeedInput 由终端续行喂入）。 */
  const runInTerminal = useCallback(async () => {
    if (runState !== "idle" || !activePath) return;
    const token = await beginRun(lang);
    setConsoleText("");
    appendConsole(`—— 运行 ${activePath}（${lang === "cpp" ? `C++ · ${cp?.cppStd ?? "c++20"}` : "Python"}）——\n`);
    const source = contentRef.current[activePath] ?? "";
    const onNeedInput = (feed) => {
      feedRef.current = feed;
      setRunState("waiting-input");
    };
    try {
      if (lang === "cpp") {
        const res = await getCpp().run({
          source,
          std: cp?.cppStd ?? "c++20",
          stdin: stdinText,
          interactive: true,
          timeoutMs,
          onLog: appendConsole,
          onStage: setStage,
          onNeedInput,
        });
        if (token !== runToken()) return;
        appendConsole(`\n程序结束（退出码 ${res.exitCode}，${(res.elapsedMs / 1000).toFixed(2)}s）\n`);
      } else {
        let out = "";
        const res = await getPy().run({
          code: source,
          stdin: stdinText,
          interactive: true,
          versionId: cp?.pythonVersion,
          timeoutMs,
          onOutput: (kind, text) => {
            if (kind === "out") out += text;
            appendConsole(text);
          },
          onStage: setStage,
          onNeedInput,
        });
        if (token !== runToken()) return;
        appendConsole(res.success ? `\n程序结束（${(res.elapsedMs / 1000).toFixed(2)}s）\n` : `\n${res.error}\n`);
      }
    } catch (exn) {
      if (token !== runToken()) return;
      appendConsole(`\n✗ ${exn.message}\n`);
      if (exn.error?.diagnostics) setDiags(exn.error.diagnostics);
    } finally {
      feedRef.current = null;
      if (token === runToken()) {
        setRunState("idle");
        setStage("");
      }
    }
  }, [runState, activePath, lang, cp, beginRun, stdinText, timeoutMs, appendConsole, getCpp, getPy]);

  const sendLine = useCallback(
    (line) => {
      appendConsole(`≫ ${line}\n`);
      feedRef.current?.(lang === "cpp" ? `${line}\n` : line);
      setRunState("running");
    },
    [appendConsole, lang],
  );
  const sendEof = useCallback(() => {
    appendConsole("≪ EOF\n");
    feedRef.current?.("");
    setRunState("running");
  }, [appendConsole]);

  const stopRun = useCallback(() => {
    runTokenRef.current++;
    (lang === "cpp" ? cppRef : pyRef).current?.stop();
    feedRef.current = null;
    setRunState("idle");
    setStage("");
    appendConsole("\n（已手动终止）\n");
  }, [lang, appendConsole]);

  /* ---------- 渲染 ---------- */
  const dirty = (f) => (savedSnapshot[f.path] ?? null) !== f.content;

  if (!mounted || !cp) {
    return (
      <div className={layout === "workspace" ? "grid h-full place-items-center text-sm text-muted-foreground" : "grid min-h-[60vh] place-items-center text-sm text-muted-foreground"}>
        <span className="flex items-center gap-2">
          <Spinner /> 工作区加载中…
        </span>
      </div>
    );
  }

  /* 编辑器 + 终端（workspace 与 legacy 共用的两个主体块） */
  const editorNode = (
    <EditorPane
      openPaths={openPaths}
      files={files}
      activePath={activePath}
      onSelectTab={setActivePath}
      onCloseTab={closeTab}
      code={code}
      lang={lang}
      onChange={handleEditorChange}
      onSave={saveNow}
      theme={cp.editorTheme}
      diagnostics={diags}
      getAi={() => loadAiSettings()}
      onAiStatus={setAiStatus}
      aiStatus={aiStatus}
      fill={layout === "workspace"}
    />
  );
  const terminalNode = (
    <TerminalPane
      text={consoleText}
      stage={stage}
      running={runState !== "idle"}
      waitingInput={runState === "waiting-input"}
      stdin={stdinText}
      onStdinChange={setStdinText}
      onRun={runInTerminal}
      onSendLine={sendLine}
      onSendEof={sendEof}
      onStop={stopRun}
      onClear={() => setConsoleText("")}
      consoleRef={consoleRef}
      fill={layout === "workspace"}
    />
  );

  if (layout === "workspace") {
    /* 铺满布局：测试面板 ｜ 编辑器（flex-1）｜ 文件管理器 + 底部（终端 / CI 日志）。
       宽度/底部高度由 IdeShell 的 CSS 变量（--ide-left/--ide-right/--ide-bottom）
       控制；左右面板宽为 0 时收起。移动端变量为 min(w, 70vw)，行容器
       overflow-hidden 由外壳兜底。这里不感知拖拽。 */
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 shrink-0 flex-col overflow-hidden border-r" style={{ width: "var(--ide-left, 280px)", minWidth: 0 }}>
            <TestPanel
              problem={problem}
              onProblemChange={(p) => {
                setProblem(p);
                setCases([]);
              }}
              cases={cases}
              running={runState !== "idle"}
              stage={stage}
              onRunAll={runAllSamples}
              onRunOne={runOneSample}
              timeoutSec={cp.timeoutSec}
              fill
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">{editorNode}</div>
          <div className="flex min-h-0 shrink-0 flex-col overflow-hidden border-l" style={{ width: "var(--ide-right, 232px)", minWidth: 0 }}>
            <FileManager
              files={files}
              activePath={activePath}
              isDirty={dirty}
              onOpen={openFile}
              onCreate={createFile}
              onRename={renameFile}
              onDelete={removeFile}
              onUpload={uploadFiles}
              onRefresh={refreshFiles}
              fill
            />
          </div>
        </div>
        {activeBottomTab === "ci" && ciSlot ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t">{ciSlot}</div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col" style={{ height: "var(--ide-bottom, 240px)", flex: "0 0 var(--ide-bottom, 240px)" }}>
            {terminalNode}
          </div>
        )}
      </div>
    );
  }

  /* ---------- legacy：旧的纵向卡片布局 ---------- */
  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">IDE 编程台</h1>
        <p className="text-muted-foreground hidden text-xs sm:block">
          多文件工作区（IndexedDB 本地持久化）· Ctrl/⌘S 保存
        </p>
      </div>

      {/* 桌面三栏：测试面板 ｜ 编辑器 ｜ 文件管理器；移动端纵向堆叠 */}
      <div className="grid items-start gap-3 lg:grid-cols-[320px_minmax(0,1fr)_250px]">
        <TestPanel
          problem={problem}
          onProblemChange={(p) => {
            setProblem(p);
            setCases([]);
          }}
          cases={cases}
          running={runState !== "idle"}
          stage={stage}
          onRunAll={runAllSamples}
          onRunOne={runOneSample}
          timeoutSec={cp.timeoutSec}
        />

        {editorNode}

        <FileManager
          files={files}
          activePath={activePath}
          isDirty={dirty}
          onOpen={openFile}
          onCreate={createFile}
          onRename={renameFile}
          onDelete={removeFile}
          onUpload={uploadFiles}
          onRefresh={refreshFiles}
        />
      </div>

      {terminalNode}
    </div>
  );
}
