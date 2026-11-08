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
            className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
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
