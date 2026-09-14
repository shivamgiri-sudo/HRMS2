import { forwardRef } from "react";
import { AlertCircle, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Dedicated, page-scoped markup for GRN Management — matches the approved artifact preview's
 * CSS exactly (https://claude.ai/code/artifact/d157ced6...), not the shared app-wide
 * Tabs/Card/Badge/Input components used everywhere else in HRMS. Those are Radix-based and their
 * baked-in classes have to be overridden via tailwind-merge, which silently failed once already
 * (a shared component's rounded-xl survived a corner-radius override — verified directly by
 * running twMerge in isolation). Plain elements here mean every class is applied directly: no
 * cascade to reason about blind, no shared component to accidentally affect on other pages.
 *
 * Colours come from the `grn-*` Tailwind namespace, which resolves against CSS variables scoped
 * to `.grn-scope` (src/styles/grn.css). Nothing here renders correctly outside that wrapper —
 * that is the point.
 *
 * Radix is deliberately kept for the three places behaviour beats markup: the review Sheet, the
 * page/sheet Tabs, and SearchableSelect. Those get the class constants at the bottom of this
 * file instead of a replacement component.
 *
 * Sizes that carry a design value are written as explicit pixels rather than Tailwind's rem
 * scale, for two reasons found by measuring this page in a browser:
 *
 *  1. `rounded-lg` is remapped in tailwind.config to `var(--radius)` = 0.9rem, so it is 14.4px —
 *     never the 8px the approved design specifies, at any root size.
 *  2. index.css sets the root font-size, and it has already changed underneath this file once
 *     (14px → 16px), which silently resized every rem-based control here. Pixels do not move
 *     when someone retunes global typography.
 *
 * Spacing already written as an arbitrary value is left alone.
 */

/* ── Surfaces ─────────────────────────────────────────────────────────────── */

export function GrnCard({
  children,
  className,
  style,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn("overflow-hidden rounded-[12px] border border-grn-line bg-grn-card", className)}
      style={style}
    >
      {children}
    </section>
  );
}

export function GrnCardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-center justify-between gap-[12px] border-b border-grn-line bg-grn-line-soft px-[16px] py-[12px]",
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[13px] font-bold text-grn-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[11px] text-grn-ink-soft">{description}</p>}
      </div>
      {action}
    </header>
  );
}

/* ── Controls ─────────────────────────────────────────────────────────────── */

const BUTTON_VARIANTS = {
  default: "border-grn-line bg-grn-card text-grn-ink hover:border-grn-brand hover:text-grn-brand",
  primary: "border-grn-brand bg-grn-brand text-white hover:bg-grn-brand-ink hover:text-white",
  destructive: "border-grn-crit-line bg-grn-crit-bg text-grn-crit hover:border-grn-crit",
  ok: "border-grn-ok bg-grn-ok text-white hover:opacity-90",
  ghost: "border-transparent bg-transparent text-grn-ink-soft hover:text-grn-ink",
} as const;

export const GrnButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: keyof typeof BUTTON_VARIANTS;
    size?: "sm" | "md";
  }
>(({ variant = "default", size = "md", className, children, type, ...props }, ref) => (
  <button
    ref={ref}
    // Defaulting to "button" rather than the HTML default "submit": several of these sit inside
    // the GRN form and would submit it on click.
    type={type ?? "button"}
    className={cn(
      "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] border text-[11.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
      size === "sm" ? "h-[26px] px-[10px]" : "h-[30px] px-[11px]",
      BUTTON_VARIANTS[variant],
      className
    )}
    {...props}
  >
    {children}
  </button>
));
GrnButton.displayName = "GrnButton";

export const GrnIconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, type, ...props }, ref) => (
  <button
    ref={ref}
    type={type ?? "button"}
    className={cn(
      "inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[8px] border border-grn-line bg-grn-card text-grn-ink-soft transition-colors hover:border-grn-brand hover:text-grn-brand disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  >
    {children}
  </button>
));
GrnIconButton.displayName = "GrnIconButton";

export const GrnInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <input
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      "h-[34px] w-full rounded-[8px] border px-[10px] text-[12.5px] text-grn-ink placeholder:text-grn-ink-soft/70",
      "focus:outline-none focus:ring-2 focus:ring-grn-brand/15",
      "disabled:cursor-not-allowed disabled:bg-grn-line-soft disabled:text-grn-ink-soft",
      invalid
        ? "border-grn-crit bg-grn-crit-bg focus:border-grn-crit"
        : "border-grn-line bg-grn-paper focus:border-grn-brand focus:bg-grn-card",
      className
    )}
    {...props}
  />
));
GrnInput.displayName = "GrnInput";

export const GrnTextarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <textarea
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      "w-full rounded-[8px] border px-[10px] py-[8px] text-[12.5px] text-grn-ink placeholder:text-grn-ink-soft/70",
      "focus:outline-none focus:ring-2 focus:ring-grn-brand/15",
      "disabled:cursor-not-allowed disabled:bg-grn-line-soft disabled:text-grn-ink-soft",
      invalid
        ? "border-grn-crit bg-grn-crit-bg focus:border-grn-crit"
        : "border-grn-line bg-grn-paper focus:border-grn-brand focus:bg-grn-card",
      className
    )}
    {...props}
  />
));
GrnTextarea.displayName = "GrnTextarea";

export const GrnSelect = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { small?: boolean }
>(({ className, small, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "rounded-[8px] border border-grn-line bg-grn-card px-[10px] text-grn-ink",
      small ? "h-[32px] text-[11.5px]" : "h-[34px] text-[12.5px]",
      "focus:border-grn-brand focus:outline-none focus:ring-2 focus:ring-grn-brand/15",
      "disabled:cursor-not-allowed disabled:bg-grn-line-soft disabled:text-grn-ink-soft",
      className
    )}
    {...props}
  >
    {children}
  </select>
));
GrnSelect.displayName = "GrnSelect";

/** A label + control row, matching the artifact's .field-grid: fixed label column, hint/error
 *  beneath the control. Label column is top-aligned, not centred — hints and errors wrap to two
 *  lines often enough that centring visibly detaches the label from its control. */
export function GrnFieldRow({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
  className,
  labelWidth = 170,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  className?: string;
  labelWidth?: number;
}) {
  return (
    <div
      className={cn(
        "grn-field-row gap-x-4 gap-y-1 border-b border-grn-line-soft px-4 py-[9px] last:border-b-0 md:items-start",
        className
      )}
      // The two-column rule lives in grn.css behind a media query (a media query cannot be
      // expressed inline); this just feeds it the label width.
      style={{ "--grn-label-w": `${labelWidth}px` } as React.CSSProperties}
    >
      <label htmlFor={htmlFor} className="text-[11.5px] font-semibold text-grn-ink md:pt-2">
        {label}
        {required && <span className="ml-0.5 text-grn-crit">*</span>}
      </label>
      <div className="min-w-0">
        {children}
        {error ? (
          <p className="mt-1 flex items-start gap-1 text-[10.5px] font-semibold text-grn-crit">
            <AlertCircle className="mt-px h-3 w-3 shrink-0" />
            <span>{error}</span>
          </p>
        ) : (
          hint && <p className="mt-1 text-[10.5px] text-grn-ink-soft">{hint}</p>
        )}
      </div>
    </div>
  );
}

/** Search input with a leading icon, matching the artifact's .search (32px tall, 280px cap,
 *  inset paper background so it reads as a field rather than another card surface). */
export const GrnSearchInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { wrapperClassName?: string }
>(({ className, wrapperClassName, ...props }, ref) => (
  <div className={cn("relative w-full max-w-[280px]", wrapperClassName)}>
    <Search className="pointer-events-none absolute left-[9px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-grn-ink-soft" />
    <input
      ref={ref}
      className={cn(
        "h-[32px] w-full rounded-[8px] border border-grn-line bg-grn-paper pl-[32px] pr-[12px] text-[12.5px] text-grn-ink placeholder:text-grn-ink-soft/70",
        "focus:border-grn-brand focus:outline-none focus:ring-2 focus:ring-grn-brand/15",
        className
      )}
      {...props}
    />
  </div>
));
GrnSearchInput.displayName = "GrnSearchInput";

/** The filter-pill row used by History and the Approval Queue (.chip / .chip.active). */
export function GrnChip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-[12px] py-[5px] text-[11.5px] font-semibold transition-colors",
        active
          ? "border-grn-brand bg-grn-brand text-white"
          : "border-grn-line bg-grn-card text-grn-ink-soft hover:border-grn-brand/40 hover:text-grn-brand"
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span className={cn("font-grn-mono text-[10.5px]", active ? "text-white/80" : "text-grn-ink-soft")}>
          {count}
        </span>
      )}
    </button>
  );
}

/** Vendor GRN / Imprest style segmented control (the artifact's inset pill switcher). */
export function GrnSegmented<T extends string>({
  value,
  onChange,
  options,
  disabled,
  className,
  label,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: React.ReactNode }>;
  disabled?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    // Radix's roving-tabindex goes away with the Tabs component, so the role/aria-checked pair
    // is what keeps this announced as a single choice rather than N unrelated buttons.
    <div role="radiogroup" aria-label={label} className={cn("inline-flex gap-0.5 rounded-[11px] bg-grn-line-soft p-[3px]", className)}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[8px] px-[16px] py-[8px] text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              selected ? "bg-grn-card text-grn-brand" : "text-grn-ink-soft hover:text-grn-ink"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Tables ───────────────────────────────────────────────────────────────── */

/** Row class for tbody `<tr>`. The hairline and hover live on the row, not the cell, so a row
 *  spanning N cells draws one continuous rule — which is what the artifact shows. */
export const GRN_TR = "border-b border-grn-line-soft last:border-b-0 hover:bg-grn-line-soft";

/** Table shell matching the artifact's table/thead/tbody rules — sticky header, hairline row
 *  dividers, no zebra striping. Pass <thead>/<tbody> children directly. */
export function GrnTable({
  children,
  minWidth,
  className,
}: {
  children: React.ReactNode;
  minWidth?: number;
  /** Applied to the scroll wrapper — this is where a max-height goes, since a sticky <th> only
   *  sticks inside a scrolling ancestor. */
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-[12.5px]" style={minWidth ? { minWidth } : undefined}>
        {children}
      </table>
    </div>
  );
}

export function GrnTh({
  children,
  align = "left",
  className,
  sticky = true,
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  /** Off for tables that scroll with the page rather than inside a box — a sticky header with
   *  no scrolling ancestor just paints an extra layer for nothing. */
  sticky?: boolean;
}) {
  return (
    <th
      className={cn(
        "whitespace-nowrap border-b border-grn-line bg-grn-card px-[14px] py-[8px] text-[10px] font-bold uppercase tracking-[0.05em] text-grn-ink-soft",
        sticky && "sticky top-0 z-10",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        className
      )}
    >
      {children}
    </th>
  );
}

export function GrnTd({
  children,
  align = "left",
  className,
  colSpan,
  title,
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  colSpan?: number;
  title?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      title={title}
      className={cn(
        "px-[14px] py-[9px] align-middle text-grn-ink",
        align === "right"
          ? "text-right font-grn-mono tabular-nums"
          : align === "center"
            ? "text-center"
            : "text-left",
        className
      )}
    >
      {children}
    </td>
  );
}

/** The 10.5px grey line that sits under a cell's main value. */
export function GrnCellSub({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-px text-[10.5px] font-normal text-grn-ink-soft", className)}>{children}</div>;
}

/* ── Read-only display blocks ─────────────────────────────────────────────── */

/** Three-up figure strip. The 1px seams are a `gap-px` over a tinted background, not borders —
 *  borders double up where two cells meet and read as 2px. */
export function GrnMetricStrip({
  children,
  columns = 3,
  className,
}: {
  children: React.ReactNode;
  columns?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("grid gap-px bg-grn-line-soft", className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

export function GrnMetric({
  label,
  value,
  tone,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: "ok" | "warn" | "crit" | "info";
}) {
  const toneClass =
    tone === "ok"
      ? "text-grn-ok"
      : tone === "warn"
        ? "text-grn-warn"
        : tone === "crit"
          ? "text-grn-crit"
          : tone === "info"
            ? "text-grn-info"
            : "text-grn-ink";
  return (
    <div className="bg-grn-card px-[16px] py-[14px]">
      <div className="text-[10.5px] uppercase tracking-[0.05em] text-grn-ink-soft">{label}</div>
      <div className={cn("mt-[3px] font-grn-mono text-[19px] font-bold tabular-nums", toneClass)}>{value}</div>
    </div>
  );
}

export function GrnKvList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-[20px] gap-y-[10px] p-[16px] text-[12px] sm:grid-cols-2", className)}>
      {children}
    </dl>
  );
}

export function GrnKv({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] uppercase tracking-[0.04em] text-grn-ink-soft">{label}</dt>
      <dd className="mt-0.5 font-semibold text-grn-ink">{children}</dd>
    </div>
  );
}

const ALERT_TONES = {
  ok: "border-grn-ok-line bg-grn-ok-bg",
  info: "border-grn-info-line bg-grn-info-bg",
  warn: "border-grn-warn-line bg-grn-warn-bg",
  crit: "border-grn-crit-line bg-grn-crit-bg",
} as const;

/** Tinted callout box — validation results, the over-budget banner, the "resolve this first"
 *  note above a decision. */
export function GrnAlert({
  tone,
  children,
  className,
}: {
  tone: keyof typeof ALERT_TONES;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[10px] border px-[14px] py-[12px] text-[12px] text-grn-ink", ALERT_TONES[tone], className)}>
      {children}
    </div>
  );
}

export function GrnEmptyState({
  icon,
  title,
  description,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="px-5 py-12 text-center">
      {icon && <div className="mx-auto mb-2.5 flex h-9 w-9 items-center justify-center text-grn-ink-soft/50">{icon}</div>}
      <p className="text-[13px] font-semibold text-grn-ink">{title}</p>
      {description && <p className="mt-1 text-[11.5px] text-grn-ink-soft">{description}</p>}
    </div>
  );
}

/* ── Dense Layout Components ────────────────────────────────────────────────
 *  Compact form primitives for the redesigned GRN form: fields grouped 2-3 per row,
 *  stacked labels, minimal vertical spacing. Use inside a single GrnCard wrapper. */

/** Horizontal field group - arranges children in a 2-4 column grid */
export function DenseFieldGroup({
  children,
  cols = 3,
  className,
}: {
  children: React.ReactNode;
  cols?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 py-1",
        cols === 2 && "grid-cols-1 sm:grid-cols-2",
        cols === 3 && "grid-cols-1 sm:grid-cols-2 md:grid-cols-3",
        cols === 4 && "grid-cols-2 sm:grid-cols-4",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Stacked label + input (label on top, compact height) */
export function DenseField({
  label,
  required,
  error,
  hint,
  children,
  span = 1,
  className,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  span?: 1 | 2;
  className?: string;
}) {
  return (
    <div className={cn("space-y-0.5", span === 2 && "sm:col-span-2", className)}>
      <label className="text-[11px] font-semibold uppercase tracking-wide text-grn-ink-soft">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children}
      {error && <p className="text-[10px] font-medium text-grn-crit">{error}</p>}
      {hint && !error && <p className="text-[10px] text-grn-ink-soft">{hint}</p>}
    </div>
  );
}

/** Thin section divider with label - separates logical groups within the form */
export function DenseSection({
  title,
  action,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 pb-1 pt-3 first:pt-0", className)}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-grn-brand">
        {title}
      </span>
      <div className="h-px flex-1 bg-grn-line" />
      {action}
    </div>
  );
}

/** Sticky footer strip with totals and action buttons - replaces the side rail */
export function DenseSummaryStrip({
  leftContent,
  children,
  className,
}: {
  leftContent?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 flex items-center justify-between gap-4 rounded-b-[12px] border-t border-grn-line bg-grn-card px-4 py-2.5 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]",
        className
      )}
    >
      {leftContent && <div className="flex items-center gap-4 text-[12px]">{leftContent}</div>}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

/** Compact file upload bar - single line with drop zone */
export function DenseFileUpload({
  fileCount,
  onDrop,
  onBrowse,
  disabled,
  className,
}: {
  fileCount: number;
  onDrop?: (files: FileList) => void;
  onBrowse?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      onClick={disabled ? undefined : onBrowse}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled && e.dataTransfer.files.length && onDrop) {
          onDrop(e.dataTransfer.files);
        }
      }}
      className={cn(
        "flex h-[38px] cursor-pointer items-center gap-3 rounded-[8px] border border-dashed border-grn-line bg-grn-paper px-3 text-[12px] text-grn-ink-soft transition-colors hover:border-grn-brand hover:bg-grn-card",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      <span className="text-base">📎</span>
      <span className="flex-1">Drop invoice PDF/JPG here or click to browse</span>
      {fileCount > 0 && (
        <span className="rounded-full bg-grn-brand-soft px-2 py-0.5 text-[10px] font-bold text-grn-brand">
          {fileCount} {fileCount === 1 ? "file" : "files"}
        </span>
      )}
    </div>
  );
}

/* ── Class constants for the Radix pieces we keep ─────────────────────────── */

/* The `!`-prefixed radius utilities are load-bearing. tailwind-merge (default config) does not
 * treat the per-corner radius utilities as conflicting with the shared Tabs component's
 * `rounded-xl` shorthand — verified by running twMerge directly, `rounded-xl` survives the merge
 * either way. The !important these compile to is what actually wins in the browser. */

/** Page-level folder tabs: they sit on the content's top border like document tabs. */
export const GRN_TABS_LIST =
  "h-auto w-full justify-start gap-0.5 overflow-x-auto rounded-none border-0 border-b border-grn-line bg-transparent p-0 shadow-none";

export const GRN_TAB_TRIGGER =
  "group -mb-px !rounded-t-[10px] !rounded-b-none gap-1.5 border border-transparent px-[18px] pb-2.5 pt-[9px] text-[13px] font-semibold text-grn-ink-soft hover:bg-grn-line-soft hover:text-grn-ink data-[state=active]:border-grn-line data-[state=active]:border-b-grn-card data-[state=active]:bg-grn-card data-[state=active]:text-grn-brand data-[state=active]:shadow-none";

/** Count pill inside a page tab. Reads the trigger's data-state via `group`, so it needs no
 *  knowledge of which tab is selected — the Tabs root stays uncontrolled. */
export const GRN_TAB_COUNT =
  "rounded-full bg-grn-line-soft px-1.5 py-px font-grn-mono text-[10.5px] font-semibold text-grn-ink-soft group-data-[state=active]:bg-grn-brand-soft group-data-[state=active]:text-grn-brand";

/** Tabs inside the review Sheet — same idea, smaller, tinted rather than lifted. */
export const GRN_SHEET_TABS_LIST =
  "h-auto w-full justify-start gap-0.5 rounded-none border-0 border-b border-grn-line-soft bg-transparent px-4 pb-0 pt-2.5 shadow-none";

export const GRN_SHEET_TAB_TRIGGER =
  "group !rounded-t-lg !rounded-b-none gap-1.5 px-3 py-[7px] text-[11.5px] font-bold text-grn-ink-soft hover:text-grn-ink data-[state=active]:bg-grn-brand-soft data-[state=active]:text-grn-brand data-[state=active]:shadow-none";
