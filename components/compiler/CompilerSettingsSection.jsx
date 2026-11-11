"use client";

/**
 * 设置页「编程」分区的编译器部分（v1.8 重排为分组）：
 *  运行时下载（Cache API）→ 编辑与运行偏好 → 手机端 → 高级（代码模板 / 观望中的运行时）。
 */

import { useEffect, useState } from "react";
import {
  CPP_FILES,
  CPP_VERSION,
  PLACEHOLDERS,
  PYODIDE_VERSIONS,
} from "@/lib/compiler/runtimes";
import { EDITOR_THEMES } from "@/lib/compiler/themes";
import { useSettings } from "@/components/settings";
import { Advanced, Group, Pad, Row, SwitchRow } from "@/components/settings/controls";
import {
  downloadAll,
  hasRuntime,
  recordDownload,
  removeRuntime,
  runtimeStats,
} from "@/lib/compiler/runtime-cache";
import {
  loadCpSettings,
  saveCpSettings,
  DEFAULT_CPP_TEMPLATE,
  DEFAULT_PY_TEMPLATE,
} from "@/lib/compiler/cp-settings";

const inputCls =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary/60";

function fmtMB(n) {
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function CompilerSettingsSection() {
  const { settings } = useSettings();
  const ideAuto = (settings.ideThemeBinding || "auto") === "auto";
  const [cp, setCp] = useState(null);
  const [pyVersionId, setPyVersionId] = useState(null); // 设置里选中的 Pyodide 版本
  const [cpp, setCpp] = useState({
    state: "checking",
    progress: null,
    error: null,
  });
  const [py, setPy] = useState({
    state: "checking",
    progress: null,
    error: null,
  });
  const [stats, setStats] = useState({});
  const [isolated, setIsolated] = useState(true);

  useEffect(() => {
    const s = loadCpSettings();
    setCp(s);
    setPyVersionId(s.pythonVersion);
    setIsolated(self.crossOriginIsolated === true);
    refresh();
  }, []);

  const pyVersion =
    PYODIDE_VERSIONS.find((v) => v.id === pyVersionId) ?? PYODIDE_VERSIONS[0];

  const pyUrls = pyVersion.files.map((f) => `${pyVersion.indexURL}${f}`);
  const cppUrls = CPP_FILES.map((f) => `/compiler/${f.name}`);

  async function refresh() {
    try {
      const [cppOk, pyOk] = await Promise.all([
        hasRuntime(cppUrls),
        hasRuntime(pyUrls),
      ]);
      setCpp((s) => ({
        ...s,
        state: cppOk ? "ready" : "idle",
        progress: null,
        error: null,
      }));
      setPy((s) => ({
        ...s,
        state: pyOk ? "ready" : "idle",
        progress: null,
        error: null,
      }));
      setStats(runtimeStats());
    } catch {
      setCpp((s) => ({ ...s, state: "idle" }));
      setPy((s) => ({ ...s, state: "idle" }));
    }
  }

  async function downloadCpp() {
    setCpp({ state: "downloading", progress: null, error: null });
    try {
      const sizes = await downloadAll(
        CPP_FILES.map((f) => ({ name: f.name, url: `/compiler/${f.name}` })),
        {
          onProgress: (item, p) => {
            setCpp((s) => ({
              ...s,
              progress: {
                name: item.name,
                got: p.got,
                total: p.total || item.size || 0,
              },
            }));
          },
        },
      );
      recordDownload(cppUrls, sizes, "cpp");
      setCpp({ state: "ready", progress: null, error: null });
      window.dispatchEvent(new Event("ysc-runtime-changed"));
    } catch (exn) {
      setCpp({ state: "error", progress: null, error: exn.message });
    }
  }

  async function downloadPy() {
    setPy({ state: "downloading", progress: null, error: null });
    try {
      const items = pyVersion.files.map((f) => ({
        name: f,
        url: `${pyVersion.indexURL}${f}`,
      }));
      const sizes = await downloadAll(items, {
        onProgress: (item, p) => {
          setPy((s) => ({
            ...s,
            progress: { name: item.name, got: p.got, total: p.total },
          }));
        },
      });
      recordDownload(pyUrls, sizes, `python:${pyVersion.id}`);
      // 记住用户下载的版本为默认版本
      saveCpSettings({ pythonVersion: pyVersion.id });
      setCp((s) => ({ ...s, pythonVersion: pyVersion.id }));
      setPy({ state: "ready", progress: null, error: null });
      window.dispatchEvent(new Event("ysc-runtime-changed"));
      window.dispatchEvent(new Event("ysc-cp-settings-changed"));
    } catch (exn) {
      setPy({ state: "error", progress: null, error: exn.message });
    }
  }

  async function removeCpp() {
    // label 同步清理 meta 汇总条目（编译-25/PWA-18）
    await removeRuntime(cppUrls, "cpp");
    refresh();
    window.dispatchEvent(new Event("ysc-runtime-changed"));
  }

  async function removePy() {
    await removeRuntime(pyUrls, `python:${pyVersionId}`);
    refresh();
    window.dispatchEvent(new Event("ysc-runtime-changed"));
  }

  if (!cp) return null;

  const patch = (p) =>
    setCp((s) => {
      const next = { ...s, ...p };
      saveCpSettings(p);
      // 通知 CompilerDock 等监听方即时刷新（移动端布局 / 编程键盘开关立即生效）
      window.dispatchEvent(new Event("ysc-cp-settings-changed"));
      return next;
    });

  const patchTemplate = (lang, text) =>
    patch({ templates: { ...cp.templates, [lang]: text } });

  const selCls = `${inputCls} w-auto min-w-40`;

  return (
    <div className="space-y-6">
      <Group
        title="运行时"
        desc="浏览器内的 C++ / Python 编译运行环境，下载到本机后离线可用。题目页的编译器需要先下载对应语言。"
      >
        <Pad>
          <RuntimeCard
            title="C++ · Clang/LLVM 22.1.8（wasi-sdk 33）"
            note={`支持 C++11–26 与万能头 bits/stdc++.h；本站同源自托管，共 ${fmtMB(CPP_FILES.reduce((a, f) => a + (f.size || 0), 0))}。`}
            state={cpp}
            total={CPP_FILES.reduce((a, f) => a + (f.size || 0), 0)}
            onDownload={downloadCpp}
            onRemove={removeCpp}
            progressText={
              cpp.progress
                ? `${cpp.progress.name} ${fmtMB(cpp.progress.got)}${cpp.progress.total ? ` / ${fmtMB(cpp.progress.total)}` : ""}`
                : "准备中…"
            }
          />
          <RuntimeCard
            title={`Python · ${pyVersion.label}`}
            note="官方 CPython WebAssembly 构建，共约 12–15 MB。"
            state={py}
            onDownload={downloadPy}
            onRemove={removePy}
            progressText={
              py.progress
                ? `${py.progress.name} ${fmtMB(py.progress.got)}${py.progress.total ? ` / ${fmtMB(py.progress.total)}` : ""}`
                : "准备中…"
            }
            extra={
              <label className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Pyodide 版本</span>
                <select
                  className={`${inputCls} w-auto`}
                  value={pyVersionId}
                  onChange={(e) => {
                    setPyVersionId(e.target.value);
                    saveCpSettings({ pythonVersion: e.target.value });
                    setCp((s) => ({ ...s, pythonVersion: e.target.value }));
                    // 通知已打开的 CompilerDock 刷新（编译-18:漏派发会让已开面板
                    // 的 cp.pythonVersion 滞后,下次运行仍用旧版本）
                    window.dispatchEvent(new Event("ysc-cp-settings-changed"));
                    refresh();
                  }}
                >
                  {PYODIDE_VERSIONS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
            }
          />
          {!isolated && (
            <p className="text-[11px] leading-relaxed text-amber-500">
              当前页面未开启跨域隔离，「交互运行」模式的交互输入将不可用（固定输入/样例对拍不受影响）。
            </p>
          )}
        </Pad>
      </Group>

      <Group title="编辑与运行">
        <Row label="默认语言">
          <select className={selCls} aria-label="默认语言" value={cp.defaultLang} onChange={(e) => patch({ defaultLang: e.target.value })}>
            <option value="cpp">C++</option>
            <option value="python">Python</option>
          </select>
        </Row>
        <Row label="C++ 标准">
          <select className={selCls} aria-label="C++ 标准" value={cp.cppStd} onChange={(e) => patch({ cppStd: e.target.value })}>
            {CPP_VERSION.stds.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Row>
        <Row
          label="编辑器主题"
          hint={
            ideAuto
              ? "当前跟随网页外观自动联动；要自选请把上方「编辑器配色跟随网页外观」改为手动。"
              : "只作用于代码编辑区（One Dark / Dracula / Monokai / GitHub / Solarized 等）。"
          }
        >
          <select
            className={`${selCls}${ideAuto ? " cursor-not-allowed opacity-60" : ""}`}
            aria-label="编辑器主题"
            value={cp.editorTheme}
            disabled={ideAuto}
            onChange={(e) => patch({ editorTheme: e.target.value })}
          >
            {EDITOR_THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="编译器面板默认模式">
          <select className={selCls} aria-label="面板默认模式" value={cp.defaultMode} onChange={(e) => patch({ defaultMode: e.target.value })}>
            <option value="samples">样例测试</option>
            <option value="interactive">交互运行</option>
          </select>
        </Row>
        <Row label="单次运行超时" hint="超过该时间自动终止（1–120 秒）。">
          <input
            className={`${inputCls} w-20`}
            type="number"
            min="1"
            max="120"
            aria-label="单次运行超时（秒）"
            value={cp.timeoutSec}
            onChange={(e) => patch({ timeoutSec: Math.max(1, Number(e.target.value) || 10) })}
          />
          <span className="text-xs text-muted-foreground">秒</span>
        </Row>
        <Row
          label="Ctrl/⌘ + S"
          hint="刷题时习惯性按保存不会弹出浏览器「保存网页」：默认保存代码草稿；也可下载为文件（题目日期_题号_时间）。"
        >
          <select className={selCls} aria-label="Ctrl/⌘S 行为" value={cp.ctrlS} onChange={(e) => patch({ ctrlS: e.target.value })}>
            <option value="save">保存代码草稿（默认）</option>
            <option value="download">下载当前代码文件</option>
            <option value="off">不接管（浏览器保存网页）</option>
          </select>
        </Row>
      </Group>

      <Group title="手机端">
        <Row label="编译器布局">
          <select className={selCls} aria-label="手机端编译器布局" value={cp.mobileLayout} onChange={(e) => patch({ mobileLayout: e.target.value })}>
            <option value="cover">全屏切换（默认）</option>
            <option value="split">上下分屏（题目上 · 编译器下）</option>
          </select>
        </Row>
        <SwitchRow
          label="编程键盘"
          hint={'用站内编程键盘替代系统软键盘：按语言常驻高频符号（C++ ; , . ( ) < > "，Python : _ , ( ) [ ] .），含方向键 / Tab / 撤销，退格长按连删。'}
          checked={!!cp.mobileKeyboard}
          onChange={(v) => patch({ mobileKeyboard: v })}
        />
      </Group>

      <Advanced title="代码模板与实验性运行时" desc="新建 / 重置代码时使用的默认模板；尚未开放的更新版运行时。">
        <TemplateEditor
          label="C++ 模板"
          value={cp.templates.cpp}
          onChange={(t) => patchTemplate("cpp", t)}
          onReset={() => patchTemplate("cpp", DEFAULT_CPP_TEMPLATE)}
          rows={10}
        />
        <TemplateEditor
          label="Python 模板"
          value={cp.templates.python}
          onChange={(t) => patchTemplate("python", t)}
          onReset={() => patchTemplate("python", DEFAULT_PY_TEMPLATE)}
          rows={8}
        />
        {PLACEHOLDERS.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">观望中的更新版运行时（暂不可用）</p>
            <ul className="space-y-1.5">
              {PLACEHOLDERS.map((p) => (
                <li key={p.id} className="text-[11px] leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground/80">{p.label}</span> — {p.note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Advanced>
    </div>
  );
}

function RuntimeCard({
  title,
  note,
  state,
  total,
  onDownload,
  onRemove,
  progressText,
  extra,
}) {
  const pct = state.progress?.total
    ? Math.round((state.progress.got / state.progress.total) * 100)
    : null;
  return (
    <div className="space-y-1.5 rounded-md border p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{title}</span>
        {state.state === "ready" && (
          <span className="text-[11px] text-emerald-500">已下载</span>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {note}
      </p>
      {extra}
      {state.state === "downloading" && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${pct ?? 5}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {progressText}
            {pct != null ? `（${pct}%）` : ""}
          </p>
        </div>
      )}
      {state.error && (
        <p className="text-[11px] text-red-400">✗ {state.error}</p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDownload}
          disabled={state.state === "downloading" || state.state === "checking"}
          className="rounded-md border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          {state.state === "downloading"
            ? "下载中…"
            : state.state === "ready"
              ? "重新下载"
              : "下载"}
        </button>
        {state.state === "ready" && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            删除
          </button>
        )}
      </div>
    </div>
  );
}

function TemplateEditor({ label, value, onChange, onReset, rows }) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        {label}
        <button
          type="button"
          onClick={onReset}
          className="text-[11px] text-primary underline-offset-2 hover:underline"
        >
          恢复默认
        </button>
      </span>
      <textarea
        className={`${inputCls} font-mono text-xs leading-relaxed`}
        rows={rows}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
