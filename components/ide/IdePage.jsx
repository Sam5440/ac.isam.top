"use client";

/**
 * /ide 在线编程工作台（状态中枢）。
 *
 * 默认（嵌入）形态：保留站点全局顶栏与页脚，IDE 作为页内工作区（限宽居中、
 * 圆角边框、固定视口高度）；点「全屏」后仅 IDE 元素进入浏览器全屏
 * （Fullscreen API，不可用时 CSS 兜底），铺满屏幕。
 *
 *   ┌ 左侧栏（默认：样例 / 题面）│ 编辑器（VS Code 式：标签 · 面包屑 · Monaco）│ 右侧栏（默认：文件 / AI / 设置）┐
 *   │                            ├────────────────────────────────────────────┤                                │
 *   │                            │ 终端 · 问题 · CI 日志（可拖拽高度）         │                                │
 *   └ 状态栏 ─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * - 功能块（样例 / 题面 / 文件 / AI 对话 / 设置）摆在左还是右由「设置」决定；
 * - 样例按文件绑定（lib/ide-samples），可从题库导入或手动创建；
 * - 多级文件夹工作区（lib/ide-workspace，IndexedDB）；
 * - 主题 / AI 对话 / AI 补全全部沿用全局设置；编辑器配色 = 全局 IDE 主题联动结果。
 * 运行链与题目页 CompilerDock 同一客户端（CppClient / PyClient），运行完成经
 * ide-bus 广播 'run-finished'（source:'ide'）。
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Braces,
  CircleX,
  FlaskConical,
  LoaderCircle,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Play,
  Sparkles,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { judgeCase, truncate } from "@/lib/compiler/diff";
import { emit } from "@/lib/ide-bus";
import { loadCpSettings, saveCpSettings } from "@/lib/compiler/cp-settings";
import { CPP_FILES, pythonVersion } from "@/lib/compiler/runtimes";
import { hasRuntime } from "@/lib/compiler/runtime-cache";
import { editorThemeDef } from "@/lib/compiler/themes";
import { CppClient } from "@/lib/compiler/cpp-client";
import { PyClient } from "@/lib/compiler/py-client";
import { toast } from "@/lib/toast";
import { Spinner } from "@/components/ui/LoadingOverlay";
import { loadAiSettings, saveAiSettings } from "@/lib/ai/ai-settings";
import EditorPane from "@/components/ide/EditorPane";
import FileManager from "@/components/ide/FileManager";
import TerminalPane from "@/components/ide/TerminalPane";
import SamplesPanel from "@/components/ide/SamplesPanel";
import { IdeSettingsPanel, StatementPanel } from "@/components/ide/IdeSidePanels";
import ChatPanel from "@/components/chat/ChatPanel";
import { ActionButton } from "@/components/ide/vsc";
import { PanelHeader, ProblemsList, QuickOpen, StatusBar, StatusItem } from "@/components/ide/Workbench";
import { LAYOUT_DEFAULTS, modulesOn, useWorkbenchLayout } from "@/components/ide/useWorkbenchLayout";
import {
  listFiles,
  listFolders,
  putFile,
  deleteFile as wsDeleteFile,
  renameFile as wsRenameFile,
  createFolder as wsCreateFolder,
  renameFolder as wsRenameFolder,
  deleteFolder as wsDeleteFolder,
  importFiles,
} from "@/lib/ide-workspace";
import {
  loadAllSamples,
  saveAllSamples,
  sampleSetOf,
  withSampleSet,
  renameKey,
  renamePrefix,
  removeKeys,
  setFromProblem,
} from "@/lib/ide-samples";

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

/** 题目全量 JSON 缓存（按 platform:id），避免切文件反复请求。 */
const problemCache = new Map();
async function fetchProblem(platform, id) {
  const key = `${platform}:${id}`;
  if (problemCache.has(key)) return problemCache.get(key);
  const res = await fetch(`/api/problems/${platform}/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  problemCache.set(key, data);
  return data;
}


export default function IdePage({ ciSlot = null, ciRuns = null, ciActionsUrl = null }) {
  const router = useRouter();
  const wb = useWorkbenchLayout();
  const [quickOpen, setQuickOpen] = useState(false);
  const [recent, setRecent] = useState([]);
  const [cursor, setCursor] = useState({ line: 1, col: 1, sel: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [pseudoFs, setPseudoFs] = useState(false); // 页面内全屏（CSS 铺满视口；也是 Fullscreen API 不可用时的兜底）
  const ideRef = useRef(null);

  const [mounted, setMounted] = useState(false);
  const [cp, setCp] = useState(null); // 编译器偏好（主题/标准/版本/超时）
  const [ai, setAi] = useState(null); // AI 补全设置（全局）
  const [files, setFiles] = useState([]); // [{path,name,lang,content,updatedAt}]
  const [folders, setFolders] = useState([]); // 显式文件夹路径
  const [openPaths, setOpenPaths] = useState([]);
  const [activePath, setActivePath] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState({});
  // 样例（按文件绑定）与运行结果（按文件）
  const [samplesMap, setSamplesMap] = useState({});
  const [resultsMap, setResultsMap] = useState({}); // path → cases[]
  const [problem, setProblem] = useState(null); // 当前文件绑定题目的全量 JSON
  const [problemLoading, setProblemLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  // 运行状态与终端
  const [runState, setRunState] = useState("idle"); // idle | running | waiting-input
  const [stage, setStage] = useState("");
  const [consoleText, setConsoleText] = useState("");
  const [diags, setDiags] = useState([]);
  const [stdinText, setStdinText] = useState("");
  const [aiStatus, setAiStatus] = useState(null);

  const cppRef = useRef(null);
  const pyRef = useRef(null);
  const feedRef = useRef(null);
  const runTokenRef = useRef(0);
  const consoleRef = useRef(null);
  const saveTimerRef = useRef(null);
  const contentRef = useRef({});
  const activeRef = useRef(null);
  const runPathRef = useRef(null); // 本次对拍所属文件（结果落到该文件名下）

  const activeFile = files.find((f) => f.path === activePath) ?? null;
  const lang = activeFile?.lang ?? "cpp";
  const code = activeFile?.content ?? "";
  const sampleSet = sampleSetOf(samplesMap, activePath);
  const cases = resultsMap[activePath] ?? [];
  const setCases = useCallback((upd) => {
    const path = runPathRef.current ?? activeRef.current;
    setResultsMap((prev) => ({ ...prev, [path]: typeof upd === "function" ? upd(prev[path] ?? []) : upd }));
  }, []);

  contentRef.current = Object.fromEntries(files.map((f) => [f.path, f.content]));
  activeRef.current = activePath;

  const appendConsole = useCallback((text) => {
    setConsoleText((prev) => (prev + text).slice(-CONSOLE_CAP));
  }, []);

  /* ---------- 初始化：偏好 + 工作区 + 样例 ---------- */
  useEffect(() => {
    setCp(loadCpSettings());
    setAi(loadAiSettings());
    setSamplesMap(loadAllSamples());
    (async () => {
      try {
        const [list, dirs] = await Promise.all([listFiles(), listFolders()]);
        setFolders(dirs);
        if (list.length) {
          setFiles(list);
          setSavedSnapshot(Object.fromEntries(list.map((f) => [f.path, f.content])));
          setOpenPaths(list.slice(0, 4).map((f) => f.path));
          setActivePath(list[0].path);
        } else {
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

  // 全局设置变化（主题联动 / 设置页修改编译器或 AI 补全）→ 同步
  useEffect(() => {
    const reload = () => {
      setCp(loadCpSettings());
      setAi(loadAiSettings());
    };
    window.addEventListener("ysc-cp-settings-changed", reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("ysc-cp-settings-changed", reload);
      window.removeEventListener("storage", reload);
    };
  }, []);

  const patchCp = useCallback((p) => {
    saveCpSettings(p);
    setCp(loadCpSettings());
    window.dispatchEvent(new Event("ysc-cp-settings-changed"));
  }, []);
  const patchAi = useCallback((p) => {
    saveAiSettings(p);
    setAi(loadAiSettings());
  }, []);

  /* ---------- 样例：持久化 + 当前文件绑定题目 ---------- */
  const updateSamples = useCallback((fn) => {
    setSamplesMap((prev) => {
      const next = fn(prev);
      saveAllSamples(next);
      return next;
    });
  }, []);

  const boundKey = sampleSet.problem ? `${sampleSet.problem.platform}:${sampleSet.problem.id}` : null;
  useEffect(() => {
    if (!boundKey) {
      setProblem(null);
      return;
    }
    const [platform, ...rest] = boundKey.split(":");
    const id = rest.join(":");
    let alive = true;
    setProblemLoading(true);
    fetchProblem(platform, id)
      .then((p) => alive && setProblem(p))
      .catch(() => alive && setProblem(null))
      .finally(() => alive && setProblemLoading(false));
    return () => {
      alive = false;
    };
  }, [boundKey]);

  const importProblem = useCallback(
    async (item) => {
      const path = activeRef.current;
      if (!path) return;
      setImporting(true);
      try {
        const full = await fetchProblem(item.platform, item.id);
        const set = setFromProblem(full);
        updateSamples((m) => withSampleSet(m, path, set));
        setResultsMap((prev) => ({ ...prev, [path]: [] }));
        toast.success(`已导入 ${set.cases.length} 个样例 → ${path}`);
      } catch (exn) {
        toast.error(`导入失败：${exn.message}`);
      } finally {
        setImporting(false);
      }
    },
    [updateSamples],
  );

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

  /* ---------- 文件 / 文件夹管理 ---------- */
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
      const clean = String(path ?? "").trim().replace(/^\/+/, "");
      if (!clean) return;
      if (files.some((f) => f.path === clean)) {
        toast.error(`文件已存在：${clean}`);
        return;
      }
      try {
        const rec = await putFile(clean, "");
        if (clean.includes("/")) {
          await wsCreateFolder(clean.slice(0, clean.lastIndexOf("/")));
          setFolders(await listFolders());
        }
        setFiles((prev) => [...prev, rec].sort((a, b) => a.path.localeCompare(b.path)));
        setSavedSnapshot((prev) => ({ ...prev, [rec.path]: "" }));
        openFile(rec.path);
      } catch (exn) {
        toast.error(`创建失败：${exn.message}`);
      }
    },
    [files, openFile],
  );

  const createFolder = useCallback(async (path) => {
    try {
      await wsCreateFolder(path);
      setFolders(await listFolders());
    } catch (exn) {
      toast.error(`创建文件夹失败：${exn.message}`);
    }
  }, []);

  const removeFile = useCallback(
    async (path) => {
      if (!window.confirm(`确定删除 ${path}？此操作不可撤销。`)) return;
      try {
        await wsDeleteFile(path);
        setFiles((prev) => prev.filter((f) => f.path !== path));
        updateSamples((m) => removeKeys(m, [path]));
        closeTab(path);
      } catch (exn) {
        toast.error(`删除失败：${exn.message}`);
      }
    },
    [closeTab, updateSamples],
  );

  const removeFolder = useCallback(
    async (path) => {
      if (!window.confirm(`确定删除文件夹 ${path} 及其中全部内容？此操作不可撤销。`)) return;
      try {
        const gone = await wsDeleteFolder(path);
        setFiles((prev) => prev.filter((f) => !gone.includes(f.path)));
        setFolders(await listFolders());
        updateSamples((m) => removeKeys(m, gone));
        gone.forEach(closeTab);
      } catch (exn) {
        toast.error(`删除失败：${exn.message}`);
      }
    },
    [closeTab, updateSamples],
  );

  const renameFile = useCallback(
    async (oldPath, newPath) => {
      const clean = String(newPath ?? "").trim().replace(/^\/+/, "");
      if (!clean || clean === oldPath) return;
      if (files.some((f) => f.path === clean)) {
        toast.error(`文件已存在：${clean}`);
        return;
      }
      try {
        const rec = await wsRenameFile(oldPath, clean);
        if (clean.includes("/")) await wsCreateFolder(clean.slice(0, clean.lastIndexOf("/")));
        setFolders(await listFolders());
        setFiles((prev) => prev.map((f) => (f.path === oldPath ? rec : f)).sort((a, b) => a.path.localeCompare(b.path)));
        setSavedSnapshot((prev) => {
          const next = { ...prev };
          delete next[oldPath];
          next[rec.path] = rec.content;
          return next;
        });
        updateSamples((m) => renameKey(m, oldPath, rec.path));
        setResultsMap((prev) => renameKey(prev, oldPath, rec.path));
        setOpenPaths((prev) => prev.map((p) => (p === oldPath ? rec.path : p)));
        setActivePath((cur) => (cur === oldPath ? rec.path : cur));
      } catch (exn) {
        toast.error(`重命名失败：${exn.message}`);
      }
    },
    [files, updateSamples],
  );

  const renameFolder = useCallback(
    async (from, to) => {
      try {
        const { moved } = await wsRenameFolder(from, to);
        const map = new Map(moved.map((m) => [m.from, m.to]));
        const [list, dirs] = await Promise.all([listFiles(), listFolders()]);
        setFiles((prev) => {
          const byPath = new Map(list.map((f) => [f.path, f]));
          // 保留未落盘的编辑内容
          return list.map((f) => {
            const old = prev.find((p) => map.get(p.path) === f.path);
            return old ? { ...byPath.get(f.path), content: old.content } : f;
          });
        });
        setFolders(dirs);
        setSavedSnapshot((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [map.get(k) ?? k, v])));
        updateSamples((m) => renamePrefix(m, from, to));
        setResultsMap((prev) => renamePrefix(prev, from, to));
        setOpenPaths((prev) => prev.map((p) => map.get(p) ?? p));
        setActivePath((cur) => map.get(cur) ?? cur);
      } catch (exn) {
        toast.error(`移动失败：${exn.message}`);
      }
    },
    [updateSamples],
  );

  const uploadFiles = useCallback(
    async (fileList, dir = "") => {
      try {
        const imported = await importFiles(fileList, dir);
        if (!imported.length) return;
        const [list, dirs] = await Promise.all([listFiles(), listFolders()]);
        setFiles(list);
        setFolders(dirs);
        setSavedSnapshot((prev) => ({ ...prev, ...Object.fromEntries(imported.map((r) => [r.path, r.content])) }));
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
      const [list, dirs] = await Promise.all([listFiles(), listFolders()]);
      setFiles(list);
      setFolders(dirs);
      setSavedSnapshot(Object.fromEntries(list.map((f) => [f.path, f.content])));
      if (!list.some((f) => f.path === activeRef.current)) setActivePath(list[0]?.path ?? null);
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
      runPathRef.current = activeRef.current;
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
      const keep = (resultsMap[activeRef.current] ?? []).filter((c) => c.index !== index);
      await runAllSamples([sample]);
      // 单例结果归位到原样例序号，其余样例的上次结果保留
      setCases((prev) => (prev[0] ? [...keep, { ...prev[0], index }].sort((a, b) => a.index - b.index) : keep));
    },
    [runState, runAllSamples, resultsMap],
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


  /* ---------- 快捷键 ---------- */
  // ⌘B 左侧栏 · ⌥⌘B 右侧栏 · ⌘J 终端 · ⌘P 快速打开 · F5 运行 · ⌘Enter 运行全部样例 · F11 全屏
  const keyRef = useRef({});
  keyRef.current = { wb, cases: sampleSet.cases, runInTerminal, runAllSamples, runState };
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e) => {
      const k = keyRef.current;
      const mod = e.metaKey || e.ctrlKey;
      const key = (e.key ?? "").toLowerCase();
      const hit = (fn) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };
      if (mod && e.altKey && (key === "b" || e.code === "KeyB")) hit(() => k.wb.patch((p) => ({ rightOpen: !p.rightOpen })));
      else if (mod && !e.shiftKey && key === "b") hit(() => k.wb.patch((p) => ({ leftOpen: !p.leftOpen })));
      else if (mod && !e.shiftKey && key === "j") hit(() => k.wb.patch((p) => ({ termOpen: !p.termOpen })));
      else if (mod && key === "`") hit(() => k.wb.showTerm("terminal", true));
      else if (mod && !e.shiftKey && key === "p") hit(() => setQuickOpen(true));
      else if (e.key === "F11") hit(() => toggleFullscreenRef.current());
      else if (e.key === "F5") hit(() => k.runState === "idle" && (k.wb.showTerm("terminal"), k.runInTerminal()));
      else if (mod && e.key === "Enter" && k.cases.length)
        hit(() => k.runState === "idle" && (k.wb.showModule("samples"), k.runAllSamples(k.cases)));
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [mounted]);

  /* ---------- 全屏（仅 IDE 元素） ---------- */
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === ideRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => {
    if (!pseudoFs) return;
    const onKey = (e) => e.key === "Escape" && setPseudoFs(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [pseudoFs]);
  const isFull = fullscreen || pseudoFs;
  /** 屏幕全屏：Fullscreen API（浏览器级，隐藏浏览器 UI）；不可用时退化为页面内全屏。 */
  const toggleFullscreen = useCallback(async () => {
    const el = ideRef.current;
    if (!el) return;
    if (document.fullscreenElement) return document.exitFullscreen?.();
    try {
      if (!el.requestFullscreen) throw new Error("unsupported");
      setPseudoFs(false);
      await el.requestFullscreen();
    } catch {
      setPseudoFs(true);
    }
  }, []);
  /** 页面内全屏：IDE 铺满浏览器视口（盖住站点顶栏），保留浏览器标签 / 地址栏。 */
  const togglePageFullscreen = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen?.().catch(() => {});
    setPseudoFs((v) => !v);
  }, []);
  const toggleFullscreenRef = useRef(toggleFullscreen);
  toggleFullscreenRef.current = toggleFullscreen;

  /* ---------- 编辑器配色：沿用全局 IDE 主题（外观设置联动） ---------- */
  const themeDef = editorThemeDef(cp?.editorTheme);
  const editorBg = themeDef?.colors?.["editor.background"];

  useEffect(() => {
    if (activePath) setRecent((prev) => [activePath, ...prev.filter((p) => p !== activePath)].slice(0, 20));
  }, [activePath]);

  /* ---------- 渲染 ---------- */
  const dirty = (f) => (savedSnapshot[f.path] ?? null) !== f.content;
  const L = wb.layout;
  const shellCls = isFull
    ? `vsc flex flex-col overflow-hidden ${pseudoFs ? "ide-pseudo-fullscreen" : ""}`
    : "vsc mx-auto my-3 flex w-full max-w-[1600px] flex-col overflow-hidden rounded-lg border shadow-sm";
  const shellStyle = {
    height: isFull ? "100dvh" : "calc(100dvh - 3.5rem - 1.5rem)",
    minHeight: isFull ? undefined : 520,
    background: "var(--vsc-panel)",
    borderColor: "var(--vsc-border)",
    ...(editorBg ? { "--vsc-editor": editorBg } : {}),
  };

  if (!mounted || !cp || !L) {
    return (
      <div className="ide-fullbleed px-3">
        <div className={shellCls} style={shellStyle}>
          <div className="grid flex-1 place-items-center text-[13px] opacity-70">
            <span className="flex items-center gap-2">
              <Spinner className="size-3.5" /> 正在打开工作区…
            </span>
          </div>
        </div>
      </div>
    );
  }

  const running = runState !== "idle";
  const errCount = diags.filter((d) => d.severity !== "warning" && d.severity !== "note" && d.severity !== "info").length;
  const warnCount = diags.filter((d) => d.severity === "warning").length;
  const passCount = cases.filter((c) => c.verdict === "AC").length;
  const ciCount = Array.isArray(ciRuns) ? ciRuns.length : 0;
  const termTab = L.termTab === "ci" && !ciSlot ? "terminal" : L.termTab;
  const langLabel = lang === "python" ? "Python" : "C++";
  const stdLabel = lang === "python" ? pythonVersion(cp.pythonVersion).label.split(" · ")[0] : (cp.cppStd ?? "c++20").toUpperCase();

  const renderModule = (id) => {
    switch (id) {
      case "samples":
        return (
          <SamplesPanel
            filePath={activePath}
            fileLang={lang}
            set={sampleSet}
            onChangeCases={(cs) => {
              updateSamples((m) => withSampleSet(m, activePath, { ...sampleSet, cases: cs }));
              setResultsMap((prev) => ({ ...prev, [activePath]: [] }));
            }}
            onImportProblem={importProblem}
            onUnbindProblem={() => updateSamples((m) => withSampleSet(m, activePath, { ...sampleSet, problem: null }))}
            importing={importing}
            results={cases}
            running={running}
            stage={stage}
            onRunAll={runAllSamples}
            onRunOne={runOneSample}
            onClearResults={() => setResultsMap((prev) => ({ ...prev, [activePath]: [] }))}
          />
        );
      case "statement":
        return <StatementPanel problem={problem} loading={problemLoading} onGoSamples={() => wb.showModule("samples")} />;
      case "files":
        return (
          <FileManager
            files={files}
            folders={folders}
            activePath={activePath}
            isDirty={dirty}
            onOpen={(p) => {
              openFile(p);
              if (wb.isMobile) wb.patch({ leftOpen: false, rightOpen: false });
            }}
            onCreate={createFile}
            onCreateFolder={createFolder}
            onRename={renameFile}
            onRenameFolder={renameFolder}
            onDelete={removeFile}
            onDeleteFolder={removeFolder}
            onUpload={uploadFiles}
            onRefresh={refreshFiles}
          />
        );
      case "chat":
        return (
          <div className="flex h-full min-h-0 flex-col" style={{ background: "var(--card)" }}>
            <ChatPanel open embedded problem={problem} onClose={() => {}} />
          </div>
        );
      case "settings":
        return (
          <IdeSettingsPanel
            layout={L}
            onAssign={wb.assignModule}
            onPatch={wb.patch}
            cp={cp}
            onCp={patchCp}
            ai={ai}
            onAi={patchAi}
          />
        );
      default:
        return null;
    }
  };

  /** 侧栏：顶部标签条（同侧多个功能块切换）+ 当前功能块。 */
  const Sidebar = ({ side }) => {
    const mods = modulesOn(L, side);
    if (!mods.length) return null;
    const open = side === "left" ? L.leftOpen : L.rightOpen;
    if (!open) return null;
    const tabKey = side === "left" ? "leftTab" : "rightTab";
    const cur = mods.some((m) => m.id === L[tabKey]) ? L[tabKey] : mods[0].id;
    const width = wb.isMobile ? "min(320px, calc(100% - 24px))" : side === "left" ? L.leftW : L.rightW;
    return (
      <aside
        aria-label={side === "left" ? "左侧栏" : "右侧栏"}
        className={`flex min-h-0 shrink-0 flex-col ${side === "left" ? "border-r" : "border-l"} ${
          wb.isMobile ? `absolute top-0 bottom-0 z-40 shadow-xl ${side === "left" ? "left-0" : "right-0"}` : "relative"
        }`}
        style={{ width, background: "var(--vsc-panel)", borderColor: "var(--vsc-border)" }}
      >
        <div role="tablist" className="flex h-[35px] shrink-0 items-stretch border-b" style={{ borderColor: "var(--vsc-border)" }}>
          {mods.map((m) => {
            const on = m.id === cur;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => wb.patch({ [tabKey]: m.id })}
                className="relative px-3 text-[12px]"
                style={{ color: on ? "var(--vsc-fg-strong)" : "var(--vsc-fg-muted)" }}
              >
                {m.label}
                {m.id === "samples" && sampleSet.cases.length > 0 && (
                  <span className="ml-1 text-[10px] tabular-nums opacity-70">{sampleSet.cases.length}</span>
                )}
                {on && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[color:var(--vsc-accent)]" />}
              </button>
            );
          })}
          <span className="flex-1" />
          <button
            type="button"
            title={`收起${side === "left" ? "左" : "右"}侧栏`}
            aria-label={`收起${side === "left" ? "左" : "右"}侧栏`}
            onClick={() => wb.patch({ [side === "left" ? "leftOpen" : "rightOpen"]: false })}
            className="grid w-8 place-items-center opacity-60 hover:opacity-100"
          >
            <X className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
        <div className="min-h-0 flex-1">{renderModule(cur)}</div>
        {!wb.isMobile && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整侧栏宽度"
            className={`vsc-sash top-0 bottom-0 w-1 cursor-col-resize ${side === "left" ? "-right-[3px]" : "-left-[3px]"}`}
            data-active={wb.dragging === side}
            onPointerDown={wb.startDrag(side)}
            onDoubleClick={() => wb.patch({ [side === "left" ? "leftW" : "rightW"]: LAYOUT_DEFAULTS[side === "left" ? "leftW" : "rightW"] })}
          />
        )}
      </aside>
    );
  };

  const termActions =
    termTab === "terminal" ? (
      <>
        {running ? (
          <ActionButton icon={Square} title="终止运行" onClick={stopRun} />
        ) : (
          <ActionButton icon={Play} title="运行当前文件 (F5)" onClick={runInTerminal} disabled={!activePath} />
        )}
        <ActionButton icon={Trash2} title="清除终端" onClick={() => setConsoleText("")} />
      </>
    ) : termTab === "problems" ? (
      <ActionButton icon={Trash2} title="清除问题" onClick={() => setDiags([])} disabled={!diags.length} />
    ) : ciActionsUrl ? (
      <a
        href={ciActionsUrl}
        target="_blank"
        rel="noreferrer"
        title="在 GitHub Actions 中查看"
        className="inline-flex h-[22px] items-center gap-1 rounded-[5px] px-1.5 text-[12px] hover:bg-[color:var(--vsc-statusbar-hover)]"
      >
        Actions <ArrowUpRight className="size-3.5" strokeWidth={1.5} />
      </a>
    ) : null;

  const leftMods = modulesOn(L, "left");
  const rightMods = modulesOn(L, "right");

  return (
    <div className="ide-fullbleed px-3">
      <div ref={ideRef} className={shellCls} style={shellStyle}>
        <div ref={wb.rootRef} className="relative flex min-h-0 flex-1">
          {Sidebar({ side: "left" })}

          {/* 编辑器 + 终端（VS Code 式） */}
          <div ref={wb.bodyRef} className="flex min-w-0 flex-1 flex-col" style={{ background: "var(--vsc-editor)" }}>
            <div className="flex min-h-0 flex-1 flex-col">
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
                onCursor={setCursor}
                isDirty={dirty}
                running={running}
                onRun={() => {
                  wb.showTerm("terminal");
                  runInTerminal();
                }}
                onStop={stopRun}
                onNewFile={() => wb.showModule("files")}
                showRun={L.showRun}
                fullscreen={fullscreen}
                pageFullscreen={pseudoFs}
                onToggleFullscreen={toggleFullscreen}
                onTogglePageFullscreen={togglePageFullscreen}
              />
            </div>

            {L.termOpen && (
              <section
                aria-label="终端面板"
                className="relative flex min-h-0 flex-col border-t"
                style={{ background: "var(--vsc-panel)", borderColor: "var(--vsc-border)", flex: `0 0 ${wb.isMobile ? Math.min(L.termH, 240) : L.termH}px` }}
              >
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="调整终端高度"
                  className="vsc-sash inset-x-0 -top-[3px] h-1 cursor-row-resize"
                  data-active={wb.dragging === "term"}
                  onPointerDown={wb.startDrag("term")}
                  onDoubleClick={() => wb.patch({ termH: LAYOUT_DEFAULTS.termH })}
                />
                <PanelHeader
                  tabs={[
                    { id: "terminal", label: "终端" },
                    { id: "problems", label: "问题", badge: diags.length || null },
                    ...(ciSlot ? [{ id: "ci", label: "CI 日志", badge: ciCount || null }] : []),
                  ]}
                  active={termTab}
                  onTab={(t) => wb.patch({ termTab: t })}
                  actions={termActions}
                  onClose={() => wb.patch({ termOpen: false })}
                />
                <div className="min-h-0 flex-1">
                  {termTab === "terminal" && (
                    <TerminalPane
                      text={consoleText}
                      waitingInput={runState === "waiting-input"}
                      stdin={stdinText}
                      onStdinChange={setStdinText}
                      onSendLine={sendLine}
                      onSendEof={sendEof}
                      consoleRef={consoleRef}
                    />
                  )}
                  {termTab === "problems" && <ProblemsList diags={diags} filePath={activePath} />}
                  {termTab === "ci" && ciSlot}
                </div>
              </section>
            )}
          </div>

          {Sidebar({ side: "right" })}

          {wb.isMobile && (L.leftOpen || L.rightOpen) && (
            <button
              type="button"
              aria-label="关闭侧栏"
              className="absolute inset-0 z-30 bg-black/30"
              onClick={() => wb.patch({ leftOpen: false, rightOpen: false })}
            />
          )}
        </div>

        <StatusBar
          running={running}
          left={
            <>
              {leftMods.length > 0 && (
                <StatusItem title="切换左侧栏 (⌘B)" onClick={() => wb.patch((p) => ({ leftOpen: !p.leftOpen }))}>
                  <PanelLeft className="size-3.5" strokeWidth={1.5} />
                </StatusItem>
              )}
              <StatusItem title="切换终端 (⌘J)" onClick={() => wb.patch((p) => ({ termOpen: !p.termOpen }))}>
                <PanelBottom className="size-3.5" strokeWidth={1.5} />
              </StatusItem>
              <StatusItem title={`错误: ${errCount}, 警告: ${warnCount}`} onClick={() => wb.showTerm("problems", true)}>
                <CircleX className="size-3.5" strokeWidth={1.5} /> {errCount}
                <TriangleAlert className="ml-1 size-3.5" strokeWidth={1.5} /> {warnCount}
              </StatusItem>
              {sampleSet.cases.length > 0 && (
                <StatusItem title="样例结果（点击打开样例）" onClick={() => wb.showModule("samples")}>
                  <FlaskConical className="size-3.5" strokeWidth={1.5} />
                  {cases.length ? `${passCount}/${sampleSet.cases.length}` : `${sampleSet.cases.length} 个样例`}
                </StatusItem>
              )}
              {running && (
                <StatusItem title="运行中">
                  <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.5} />
                  <span className="max-w-60 truncate">{runState === "waiting-input" ? "等待输入…" : stage || "运行中…"}</span>
                </StatusItem>
              )}
            </>
          }
          right={
            <>
              {activePath && (
                <>
                  {aiStatus === "thinking" && (
                    <StatusItem title="AI 补全中">
                      <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.5} /> AI
                    </StatusItem>
                  )}
                  {aiStatus && typeof aiStatus === "object" && aiStatus.error && (
                    <StatusItem title={String(aiStatus.error)} className="text-[color:var(--vsc-error)]">
                      <Sparkles className="size-3.5" strokeWidth={1.5} /> AI 出错
                    </StatusItem>
                  )}
                  <StatusItem title="光标位置" onClick={() => window.__ysMonaco?.editor?.focus()}>
                    行 {cursor.line}，列 {cursor.col}
                    {cursor.sel ? `（已选择 ${cursor.sel}）` : ""}
                  </StatusItem>
                  <StatusItem title="缩进" className="hidden lg:flex">空格: 4</StatusItem>
                  <StatusItem title="编码" className="hidden lg:flex">UTF-8</StatusItem>
                  <StatusItem title="语言模式">
                    <Braces className="size-3.5" strokeWidth={1.5} /> {langLabel}
                  </StatusItem>
                  <StatusItem title="编译器 / 运行时（在 IDE 设置中切换）" onClick={() => wb.showModule("settings")} className="hidden sm:flex">
                    {stdLabel}
                  </StatusItem>
                  <StatusItem title={ai?.enabled ? "AI 补全已开启" : "AI 补全未开启"} onClick={() => wb.showModule("settings")} className="hidden sm:flex">
                    <Sparkles className="size-3.5" strokeWidth={1.5} style={{ opacity: ai?.enabled ? 1 : 0.45 }} />
                  </StatusItem>
                </>
              )}
              {rightMods.length > 0 && (
                <StatusItem title="切换右侧栏 (⌥⌘B)" onClick={() => wb.patch((p) => ({ rightOpen: !p.rightOpen }))}>
                  <PanelRight className="size-3.5" strokeWidth={1.5} />
                </StatusItem>
              )}
            </>
          }
        />

        {quickOpen && (
          <QuickOpen files={files} recent={recent} onPick={openFile} onCreate={createFile} onClose={() => setQuickOpen(false)} />
        )}
      </div>
    </div>
  );
}
