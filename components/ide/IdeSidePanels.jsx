"use client";

/**
 * /ide 侧栏的「题面」与「设置」视图。
 *  - 题面：当前文件绑定题目的全量题面，复用站点 StatementBody（对照 / 中英文、
 *    翻译渠道与优先级全部沿用全局设置）+ 时空限制。
 *  - 设置：外观（站点全局主题，一键循环 / 前往完整主题库）、功能块摆放
 *    （样例 / 题面 / 文件 / AI 对话 / 设置 各放左侧还是右侧）、是否显示运行按钮、
 *    编译器（C++ 标准 / 超时）、AI 补全开关（沿用全局 AI 设置），以及全局设置入口。
 */

import Link from "next/link";
import { useMemo } from "react";
import { ExternalLink, Settings as SettingsIcon } from "lucide-react";
import StatementBody from "@/components/StatementBody";
import { ThemeToggleButton, useSettings } from "@/components/settings";
import { pairSegments } from "@/lib/statement-segments";
import { allThemes } from "@/lib/themes";
import { CPP_VERSION } from "@/lib/compiler/runtimes";
import { MODULES } from "@/components/ide/useWorkbenchLayout";
import { ViewHeader } from "@/components/ide/vsc";
import { Spinner } from "@/components/ui/LoadingOverlay";

/* ---------------- 题面 ---------------- */

export function StatementPanel({ problem, loading, onGoSamples }) {
  const segments = useMemo(
    () => (problem?.statementMd ? pairSegments(problem.statementMd, problem.statementZhMd) : []),
    [problem],
  );
  return (
    <section aria-label="题面" className="flex h-full min-w-0 flex-col overflow-hidden">
      <ViewHeader
        title="题面"
        actions={
          problem?.platform && problem?.id ? (
            <Link
              href={`/problems/${problem.platform}/${encodeURIComponent(problem.id)}`}
              target="_blank"
              title="在题目页打开"
              className="inline-flex h-[22px] items-center gap-1 rounded-[5px] px-1.5 text-[12px] hover:bg-[color:var(--vsc-statusbar-hover)]"
            >
              题目页 <ExternalLink className="size-3.5" strokeWidth={1.5} />
            </Link>
          ) : null
        }
      />
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
        {loading ? (
          <p className="flex items-center gap-2 py-2 text-[12px] opacity-75">
            <Spinner className="size-3" /> 题面加载中…
          </p>
        ) : !problem ? (
          <div className="py-2 text-[12px] leading-5 opacity-75">
            <p>当前文件还没有绑定题目。</p>
            <p className="mt-1">
              在
              <button type="button" onClick={onGoSamples} className="mx-1 text-[color:var(--vsc-info)] hover:underline">
                样例
              </button>
              中搜索题库导入样例，题面会同时出现在这里。
            </p>
          </div>
        ) : (
          <>
            <h3 className="text-[15px] leading-6 font-semibold">
              <span className="mr-1.5 font-mono text-[12px] opacity-70">{problem.id}</span>
              {problem.titleZh || problem.title}
            </h3>
            <p className="mt-0.5 mb-3 text-[12px] opacity-70">
              {problem.platform}
              {problem.timeLimitMs ? ` · 时间 ${problem.timeLimitMs / 1000}s` : ""}
              {problem.memoryLimitMb ? ` · 内存 ${problem.memoryLimitMb}MB` : ""}
            </p>
            {problem.statementMd ? (
              <div className="text-[13px]">
                <StatementBody
                  code={problem.id}
                  platform={problem.platform}
                  segments={segments}
                  title={problem.title}
                  titleZh={problem.titleZh}
                  zhModel={problem.translateModel}
                />
              </div>
            ) : (
              <p className="text-[12px] opacity-75">该题题面尚未抓取，可前往题目页查看原题。</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/* ---------------- 设置 ---------------- */

function Row({ label, hint, children }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-4 opacity-60">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Seg({ value, options, onChange, disabled }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border text-[12px]" style={{ borderColor: "var(--vsc-input-border)" }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className="h-6 px-2.5 disabled:opacity-50"
          style={
            value === o.value
              ? { background: "var(--vsc-accent)", color: "var(--vsc-accent-fg)", fontWeight: 600 }
              : { background: "transparent", color: "var(--vsc-fg-muted)" }
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative h-5 w-9 rounded-full transition-colors"
      style={{ background: checked ? "var(--vsc-accent)" : "var(--vsc-input-border)" }}
    >
      <span
        className="absolute top-0.5 size-4 rounded-full shadow transition-[left]"
        style={{ left: checked ? 18 : 2, background: checked ? "var(--vsc-accent-fg)" : "var(--vsc-fg-muted)" }}
      />
    </button>
  );
}

function Group({ title, children }) {
  return (
    <div className="border-b px-4 py-2.5" style={{ borderColor: "var(--vsc-border)" }}>
      <h3 className="mb-1 text-[11px] font-semibold tracking-wide uppercase opacity-70">{title}</h3>
      {children}
    </div>
  );
}

export function IdeSettingsPanel({ layout, onAssign, onPatch, cp, onCp, ai, onAi }) {
  const { settings, customThemes } = useSettings();
  const theme = allThemes(customThemes).find((t) => t.id === settings.theme);
  const leftCount = MODULES.filter((m) => layout.assign[m.id] === "left").length;
  const rightCount = MODULES.length - leftCount;

  return (
    <section aria-label="IDE 设置" className="flex h-full min-w-0 flex-col overflow-hidden">
      <ViewHeader title="设置" />
      <div className="min-h-0 flex-1 overflow-auto pb-6">
        <Group title="外观">
          <Row label="界面主题" hint={`当前：${theme?.label ?? settings.theme} · 与全站外观设置同步`}>
            <span className="flex items-center gap-1.5">
              <ThemeToggleButton />
              <Link href="/settings#appearance" className="text-[12px] text-[color:var(--vsc-info)] hover:underline">
                主题库
              </Link>
            </span>
          </Row>
        </Group>

        <Group title="功能块摆放">
          <p className="mb-1 text-[11px] leading-4 opacity-60">每个功能块放在左侧栏还是右侧栏；同侧多个功能块以标签切换。</p>
          {MODULES.map((m) => {
            const side = layout.assign[m.id];
            // 不允许把某侧唯一的功能块挪走后让另一侧承载全部 —— 允许，但至少保留「设置」可达
            return (
              <Row key={m.id} label={m.label}>
                <Seg
                  value={side}
                  onChange={(v) => onAssign(m.id, v)}
                  options={[
                    { value: "left", label: "左侧" },
                    { value: "right", label: "右侧" },
                  ]}
                />
              </Row>
            );
          })}
          <p className="mt-1 text-[11px] opacity-60">
            左侧 {leftCount} 个 · 右侧 {rightCount} 个
          </p>
        </Group>

        <Group title="编辑器">
          <Row label="显示运行按钮" hint="编辑器标签栏右侧的「运行 / 停止」按钮（F5 始终可用）">
            <Switch checked={layout.showRun} onChange={(v) => onPatch({ showRun: v })} label="显示运行按钮" />
          </Row>
          <Row label="AI 代码补全" hint={ai?.enabled ? "沿用全局 AI 补全设置（服务商 / 模型 / 触发方式）" : "需先在全局设置中接入补全服务"}>
            <Switch checked={!!ai?.enabled} onChange={(v) => onAi({ enabled: v })} label="AI 代码补全" />
          </Row>
        </Group>

        <Group title="编译运行">
          <Row label="C++ 标准">
            <select
              value={cp.cppStd}
              onChange={(e) => onCp({ cppStd: e.target.value })}
              className="vsc-input !h-6 !w-auto !text-[12px]"
            >
              {CPP_VERSION.stds.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Row>
          <Row label="单次运行超时（秒）">
            <input
              type="number"
              min={1}
              max={120}
              value={cp.timeoutSec}
              onChange={(e) => onCp({ timeoutSec: Number(e.target.value) })}
              className="vsc-input !h-6 !w-16 !text-[12px]"
            />
          </Row>
        </Group>

        <div className="px-4 py-3">
          <Link href="/settings" className="vsc-btn vsc-btn-secondary w-full">
            <SettingsIcon className="size-3.5" /> 打开全局设置（主题 / AI / 编译器）
          </Link>
        </div>
      </div>
    </section>
  );
}
