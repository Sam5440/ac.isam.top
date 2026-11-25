"use client";

/**
 * 整场题目导出按钮（正式赛 / 模拟赛共用）。
 *
 * 点击后选版式（纯中文 / 纯英文 / 中英对照），再选择：
 *  - 下载 PDF：ICPC 版式（封面 + 每题从新页开始、连续页码），直接保存文件；
 *  - 下载 HTML：自包含文件（公式是 MathML），离线打开也能正常排版。
 *
 * 题面按需从 /api/problems/<platform>/<id> 拉取（CDN 缓存），并发 4；
 * 拉过的题缓存在组件生命周期内，重复导出不重新请求。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileDown, FileText, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CONTEST_EXPORT_MODES,
  contestExportFileBase,
  normalizeExportMode,
} from "@/lib/contest-export-modes.mjs";
import { originalProblemUrl } from "@/lib/sim-contest.mjs";
import { toast } from "@/lib/toast";

const MODES = CONTEST_EXPORT_MODES;

async function fetchProblem(platform, id) {
  const res = await fetch(`/api/problems/${encodeURIComponent(platform)}/${encodeURIComponent(String(id))}`, {
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** KaTeX / renderRich 只在真正导出时加载，别把几百 KB 塞进比赛页首屏。 */
async function loadExportModules() {
  const [builder, pdf, io] = await Promise.all([
    import("@/lib/contest-export.mjs"),
    import("@/lib/contest-pdf.mjs"),
    import("@/lib/markdown-export.mjs"),
  ]);
  return {
    buildContestExportHtml: builder.buildContestExportHtml,
    buildContestPdf: pdf.buildContestPdf,
    downloadBlob: io.downloadBlob,
  };
}

export default function ContestExportButton({ contest, problems = [], sitePath = "", className = "" }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("both");
  const [busy, setBusy] = useState("");
  const rootRef = useRef(null);
  const cacheRef = useRef(new Map());

  const list = useMemo(
    () =>
      (problems ?? [])
        .filter((p) => p && p.platform && p.id)
        .map((p, i) => ({
          platform: p.platform,
          id: String(p.id),
          index: p.index ?? null,
          label: p.label ?? p.index ?? String(i + 1),
          title: p.title ?? null,
          titleZh: p.titleZh ?? null,
          points: p.points ?? null,
          difficulty: p.difficulty ?? null,
          originalUrl: p.originalUrl ?? null,
          found: p.found,
        })),
    [problems],
  );

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const key = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);

  const loadAll = useCallback(
    async (entries) => {
      const out = new Array(entries.length);
      let cursor = 0;
      let done = 0;
      const report = () => {
        done += 1;
        setBusy(`正在获取题目 ${done}/${entries.length}…`);
      };
      const worker = async () => {
        while (true) {
          const i = cursor;
          cursor += 1;
          if (i >= entries.length) return;
          const p = entries[i];
          const key = `${p.platform}:${p.id}`;
          let data = cacheRef.current.get(key);
          if (!data) {
            try {
              data = await fetchProblem(p.platform, p.id);
              cacheRef.current.set(key, data);
            } catch {
              data = null;
            }
          }
          out[i] = data
            ? { ...data, label: p.label, points: p.points ?? data.points, url: data.url || p.originalUrl || originalProblemUrl(p.platform, p.id), found: true }
            : {
                platform: p.platform,
                id: p.id,
                index: p.index,
                label: p.label,
                title: p.title,
                titleZh: p.titleZh,
                difficulty: p.difficulty,
                points: p.points,
                found: false,
                url: p.originalUrl || originalProblemUrl(p.platform, p.id),
              };
          report();
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
      return out;
    },
    [],
  );

  const generate = useCallback(
    async (entries) => {
      const loaded = await loadAll(entries);
      const origin = window.location.origin;
      const siteUrl = sitePath ? `${origin}${sitePath}` : `${origin}${window.location.pathname}${window.location.hash}`;
      const { buildContestExportHtml } = await loadExportModules();
      return buildContestExportHtml({
        contest,
        problems: loaded,
        mode,
        origin,
        siteUrl,
        exportedAt: new Date().toLocaleDateString("zh-CN"),
      });
    },
    [contest, loadAll, mode, sitePath],
  );

  const run = useCallback(
    async (action) => {
      if (typeof document === "undefined") return;
      if (!list.length) {
        toast.info("本场暂无题目可导出");
        return;
      }
      const entries = list;
      const format = normalizeExportMode(mode);
      setBusy(`正在获取题目 0/${entries.length}…`);
      try {
        const modules = await loadExportModules();
        if (action === "pdf") {
          const loaded = await loadAll(entries);
          const origin = window.location.origin;
          const result = await modules.buildContestPdf({
            contest,
            problems: loaded,
            mode: format,
            origin,
            siteUrl: sitePath ? `${origin}${sitePath}` : `${origin}${window.location.pathname}${window.location.hash}`,
            exportedAt: new Date().toLocaleDateString("zh-CN"),
            onProgress: ({ stage, done, total, page, pages, label, title }) => {
              if (stage === "render") {
                setBusy(`正在排版 ${done + 1}/${total}${label ? `：${label}` : ""}${title ? ` ${title}` : ""}…`);
              } else if (stage === "page") {
                setBusy(`正在生成第 ${page}/${pages} 页${label ? `（${label}）` : ""}…`);
              } else if (stage === "cover") {
                setBusy("正在生成封面…");
              } else if (stage === "write") {
                setBusy("正在写入 PDF…");
              }
            },
          });
          modules.downloadBlob(result.blob, result.filename);
          toast.success(`已导出 PDF（${result.pageCount} 页，每题独立分页）`);
        } else {
          const html = await generate(entries);
          modules.downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), `${contestExportFileBase(contest, format)}.html`);
          toast.success(`已导出整场题目（${MODES.find((m) => m.id === format)?.label}）`);
        }
        setOpen(false);
      } catch (err) {
        toast.error(`导出失败：${err?.message ?? err}`);
      } finally {
        setBusy("");
      }
    },
    [contest, generate, list, loadAll, mode, sitePath],
  );

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={!!busy}
        title="导出整场题目（中文 / 英文 / 中英对照）"
      >
        <Download />
        导出题目
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="导出整场题目"
          className="bg-popover text-popover-foreground fixed inset-x-4 bottom-4 z-50 max-h-[70vh] overflow-y-auto rounded-lg border p-3 shadow-lg sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:bottom-auto sm:mt-1 sm:w-80 sm:max-h-none sm:overflow-visible"
        >
          <p className="text-muted-foreground mb-2 text-xs">
            导出本场 {list.length} 题：PDF 按 ICPC 版式排版，封面后每题从新的一页开始。
          </p>
          <div role="radiogroup" aria-label="导出语言" className="space-y-1">
            {MODES.map((m) => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setMode(m.id)}
                  className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
                    active ? "border-primary bg-primary/5" : "hover:bg-accent border-transparent"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full border ${
                      active ? "border-primary" : "border-muted-foreground/50"
                    }`}
                  >
                    {active ? <span className="bg-primary size-2 rounded-full" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{m.label}</span>
                    <span className="text-muted-foreground block text-xs">{m.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex gap-2">
            <Button type="button" size="sm" className="flex-1" onClick={() => run("pdf")} disabled={!!busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : <FileDown />}
              下载 PDF
            </Button>
            <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => run("download")} disabled={!!busy}>
              <FileText />
              下载 HTML
            </Button>
          </div>

          <p role="status" aria-live="polite" className="text-muted-foreground mt-2 text-[11px]">
            {busy || "下载后即可直接分发/打印，不需要再打开打印窗口另存。"}
          </p>
        </div>
      )}
    </div>
  );
}
