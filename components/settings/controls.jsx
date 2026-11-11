'use client';

/**
 * 设置页通用控件：开关（iOS 式）、分段选择、字段容器、分区卡片。
 * 所有布尔类设置一律用 ToggleRow/ToggleSwitch 表达「可控 / 可开 / 可调」。
 */

export const inputCls =
  'w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary/60';

export const textareaCls = `${inputCls} min-h-24 font-mono text-[12px] leading-relaxed`;

export function Field({ label, hint, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="text-muted-foreground/70 block text-[11px] leading-relaxed">{hint}</span>}
    </label>
  );
}

/** iOS 式开关。 */
export function ToggleSwitch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
        checked ? 'border-primary bg-primary' : 'bg-input border-transparent'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <span
        className={`absolute top-0.5 size-4.5 rounded-full bg-background shadow transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
        style={{ width: 18, height: 18 }}
      />
    </button>
  );
}

/** 开关行：左侧标题 + 说明，右侧开关。 */
export function ToggleRow({ label, hint, checked, onChange, disabled, children }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[13px] font-medium">{label}</p>
        {hint && <p className="text-muted-foreground text-[11px] leading-relaxed">{hint}</p>}
        {children}
      </div>
      <div className="pt-0.5">
        <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} label={label} />
      </div>
    </div>
  );
}

/** 分段选择（2-4 个互斥选项）。 */
export function SegButtons({ options, value, onChange, ariaLabel, size = 'md' }) {
  return (
    <div className={`flex rounded-md border p-0.5 ${size === 'sm' ? 'text-[11px]' : ''}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange?.(o.id)}
            className={`flex-1 whitespace-nowrap rounded px-2.5 py-1 text-xs transition-colors ${
              active ? 'bg-primary font-medium text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 多选 chip（保留原有 toggle-chip 交互，用于多选场景）。 */
export function ChipToggle({ on, onClick, children, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
        on ? 'border-primary/60 bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <span className={`inline-block size-2 rounded-full ${on ? 'bg-primary' : 'bg-border'}`} />
      {children}
    </button>
  );
}

/** 设置分区卡片：图标 + 标题 + 描述 + 内容。 */
export function SectionCard({ id, icon: Icon, title, desc, children }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-xl border bg-card">
      <div className="flex items-start gap-3 border-b px-5 py-4">
        {Icon && (
          <span className="bg-primary/10 text-primary mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg">
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {desc && <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{desc}</p>}
        </div>
      </div>
      <div className="space-y-5 px-5 py-4">{children}</div>
    </section>
  );
}

/** 卡片内的小节块（虚线边框分组，沿用原弹窗样式语言）。 */
export function SubBlock({ title, hint, right, children }) {
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      {(title || right) && (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <p className="text-muted-foreground text-xs font-medium">{title}</p>}
            {hint && <p className="text-muted-foreground/70 mt-0.5 text-[11px] leading-relaxed">{hint}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

/* ---------------- v1.8 设置页新版布局原语 ---------------- */

/**
 * 设置组：标题 + 说明 + 一张卡片，内部行以分隔线分开（iOS / macOS 设置风格）。
 * 子元素一般为 <Row />，也可放任意内容（自动加内边距）。
 */
export function Group({ title, desc, right, children, id }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-2">
      {(title || right) && (
        <div className="flex items-end justify-between gap-3 px-1">
          <div className="min-w-0">
            {title && <h3 className="text-[13px] font-semibold tracking-tight">{title}</h3>}
            {desc && <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">{desc}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
      )}
      <div className="bg-card divide-y rounded-xl border">{children}</div>
    </section>
  );
}

/** 设置行：左侧标题 + 说明，右侧控件；`stack` 时控件换到下方占满宽度。 */
export function Row({ label, hint, children, stack = false }) {
  if (stack) {
    return (
      <div className="space-y-2 px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[13px] font-medium">{label}</p>
          {hint && <p className="text-muted-foreground text-[11px] leading-relaxed">{hint}</p>}
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-56 space-y-0.5">
        <p className="text-[13px] font-medium">{label}</p>
        {hint && <p className="text-muted-foreground text-[11px] leading-relaxed">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** 开关行（Row + ToggleSwitch 简写）。 */
export function SwitchRow({ label, hint, checked, onChange, disabled }) {
  return (
    <Row label={label} hint={hint}>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </Row>
  );
}

/** 卡片内的自由内容块（统一内边距）。 */
export function Pad({ children, className = '' }) {
  return <div className={`space-y-3 px-4 py-3 ${className}`}>{children}</div>;
}

/** 高级折叠区：默认收起，放不常用 / 专家向配置。 */
export function Advanced({ title = '高级选项', desc, children, defaultOpen = false }) {
  return (
    <details className="group bg-card rounded-xl border" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">{title}</span>
          {desc && <span className="text-muted-foreground block text-[11px] leading-relaxed">{desc}</span>}
        </span>
        <span aria-hidden className="text-muted-foreground shrink-0 text-xs transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="space-y-5 border-t px-4 py-4">{children}</div>
    </details>
  );
}

/** 小按钮（设置页内统一样式）。 */
export function SmallButton({ children, onClick, disabled, tone = 'default', title, type = 'button' }) {
  const cls =
    tone === 'primary'
      ? 'bg-primary text-primary-foreground border-transparent hover:opacity-90'
      : tone === 'danger'
        ? 'border-red-500/40 text-red-400 hover:bg-red-500/10'
        : 'bg-background text-foreground hover:bg-accent';
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}
