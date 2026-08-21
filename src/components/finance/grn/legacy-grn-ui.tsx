import { forwardRef } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Legacy-skin drop-in replacement for grn-ui.tsx, used ONLY by BudgetLinkedGrnForm.tsx (the
 * Create-GRN form). Every export here matches the prop signature of its grn-ui.tsx counterpart
 * exactly — this is a swap of appearance only, so the ~800 lines of form JSX that already build
 * the (approved) field sequence and the three split editors don't change at all, just what they
 * render through.
 *
 * Purpose: replicate the pre-existing HRMS "Vendor GRN Entry" form's plain, bordered, label-left
 * look (per the reference screenshot) instead of the rounded-card `.grn-scope` design. Nothing
 * here touches grn-ui.tsx, grn.css or any other GRN screen (Search/History/ImprestWorkspace keep
 * their current look) — this file is additive and page-scoped to Create GRN only.
 */

// Tailwind's JIT scanner greps this file's literal source text for class-shaped substrings — it
// never evaluates JS — so every arbitrary-value class below must appear as a full literal string
// (e.g. "border-[#c7d2e0]"). A template literal like `border-[${X}]` would compile fine but emit
// no CSS: the scanner never sees the substituted value, only "${X}" inside the brackets.
const BORDER = "border-[#c7d2e0]";
const BORDER_STRONG = "border-[#a9b8cc]";
const LABEL = "text-[#1e293b]";
const MUTED = "text-[#7c8ba1]";
const TEXT = "text-[#33475b]";
const TITLE = "text-[#3d6089]";
const HEAD_BG = "bg-[#f4f7fa]";

/* ── Unchanged primitives — re-exported as-is, no legacy equivalent needed ── */
export { GrnFieldRow, GrnCellSub, DenseSummaryStrip, DenseFileUpload } from "./grn-ui";

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
      style={style}
      className={cn(
        "rounded-[4px] border bg-white shadow-[0_1px_2px_rgba(30,41,59,0.06)]",
        BORDER,
        className
      )}
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
      className={cn("flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5", BORDER, HEAD_BG, className)}
    >
      <div className="min-w-0">
        <h2 className={cn("text-[13.5px] font-bold", TITLE)}>{title}</h2>
        {description && <p className={cn("mt-0.5 text-[11px]", MUTED)}>{description}</p>}
      </div>
      {action}
    </header>
  );
}

/* ── Controls ─────────────────────────────────────────────────────────────── */

const BUTTON_VARIANTS = {
  default: "border-[#a9b8cc] bg-white text-[#45607e] hover:bg-[#eef2f7]",
  primary: "border-[#5b8fc7] bg-[#5b8fc7] text-white hover:bg-[#4a7bb0]",
  destructive: "border-[#e2b4b4] bg-[#fdf0f0] text-[#c0392b] hover:border-[#c0392b]",
  ok: "border-[#5b8fc7] bg-[#5b8fc7] text-white hover:opacity-90",
  ghost: "border-transparent bg-transparent text-[#64748b] hover:text-[#334155]",
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
    type={type ?? "button"}
    className={cn(
      "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[3px] border text-[12px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
      size === "sm" ? "h-[28px] px-[10px]" : "h-[34px] px-[18px]",
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
      "inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[3px] border bg-white text-[#64748b] transition-colors hover:border-[#5b8fc7] hover:text-[#5b8fc7] disabled:cursor-not-allowed disabled:opacity-50",
      BORDER_STRONG,
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
      "h-[34px] w-full rounded-[3px] border px-[10px] text-[12.5px] text-[#33475b] placeholder:text-[#94a3b8]",
      "focus:outline-none focus:ring-2 focus:ring-[#5b8fc7]/25 focus:border-[#5b8fc7]",
      "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400",
      invalid ? "border-[#c0392b] bg-[#fdf0f0]" : cn(BORDER_STRONG, "bg-white"),
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
      "w-full rounded-[3px] border px-[10px] py-[8px] text-[12.5px] text-[#33475b] placeholder:text-[#94a3b8]",
      "focus:outline-none focus:ring-2 focus:ring-[#5b8fc7]/25 focus:border-[#5b8fc7]",
      "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400",
      invalid ? "border-[#c0392b] bg-[#fdf0f0]" : cn(BORDER_STRONG, "bg-white"),
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
      "rounded-[3px] border bg-white px-[10px] text-[#33475b]",
      BORDER_STRONG,
      small ? "h-[30px] text-[11.5px]" : "h-[34px] text-[12.5px]",
      "focus:border-[#5b8fc7] focus:outline-none focus:ring-2 focus:ring-[#5b8fc7]/25",
      "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400",
      className
    )}
    {...props}
  >
    {children}
  </select>
));
GrnSelect.displayName = "GrnSelect";

/** Vendor GRN / Imprest switch — kept as a two-way toggle (this is new functionality the old
 *  single-purpose form never needed), restyled flat to match the rest of the legacy skin. */
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
    <div role="radiogroup" aria-label={label} className={cn("inline-flex gap-0.5 rounded-[4px] border bg-white p-[3px]", BORDER, className)}>
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
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] px-[16px] py-[7px] text-[12.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              selected ? "bg-[#5b8fc7] text-white" : "text-[#64748b] hover:text-[#334155]"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Tables — the plain bordered look for the split-editor line-item tables ── */

export const GRN_TR = "border-b border-[#c7d2e0] last:border-b-0 hover:bg-[#f4f7fa]";

export function GrnTable({
  children,
  minWidth,
  className,
}: {
  children: React.ReactNode;
  minWidth?: number;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[12px]" style={minWidth ? { minWidth } : undefined}>
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
  sticky?: boolean;
}) {
  return (
    <th
      className={cn(
        "whitespace-nowrap border px-[12px] py-[7px] text-[10.5px] font-bold uppercase tracking-[0.03em]",
        BORDER,
        HEAD_BG,
        LABEL,
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
        "border px-[12px] py-[8px] align-middle",
        BORDER,
        TEXT,
        align === "right" ? "text-right tabular-nums" : align === "center" ? "text-center" : "text-left",
        className
      )}
    >
      {children}
    </td>
  );
}

/* ── Dense field primitives, reskinned as label-left rows ────────────────── */

export function DenseFieldGroup({
  children,
  cols = 3,
  className,
}: {
  children: React.ReactNode;
  cols?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-x-8 gap-y-3 py-1.5",
        cols === 1 && "grid-cols-1",
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

/** Label-left, field-right row — matches the legacy form's field-grid instead of the modern
 *  stacked-label layout. Same props as grn-ui's DenseField, so every call site is unaffected. */
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
    <div
      className={cn(
        "grid grid-cols-[minmax(96px,148px)_1fr] items-center gap-x-3 gap-y-1",
        span === 2 && "sm:col-span-2",
        className
      )}
    >
      <label className={cn("text-right text-[12px] font-bold leading-tight", LABEL)}>
        {label}
        {required && <span className="ml-0.5 text-[#c0392b]">*</span>}
      </label>
      <div className="min-w-0">
        {children}
        {error ? (
          <p className="mt-1 flex items-start gap-1 text-[10.5px] font-semibold text-[#c0392b]">
            <AlertCircle className="mt-px h-3 w-3 shrink-0" />
            <span>{error}</span>
          </p>
        ) : (
          hint && <p className={cn("mt-1 text-[10.5px]", MUTED)}>{hint}</p>
        )}
      </div>
    </div>
  );
}

/** Section divider. `variant="panel"` is the big bordered-panel title (e.g. "Vendor GRN Entry",
 *  "Details Entry"); the default is the small uppercase sub-divider (e.g. "Budget Allocation"). */
export function DenseSection({
  title,
  action,
  className,
  variant = "sub",
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
  variant?: "panel" | "sub";
}) {
  if (variant === "panel") {
    return (
      <div className={cn("mb-4", className)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={cn("text-[16px] font-bold", TITLE)}>{title}</h2>
          {action}
        </div>
        <div className={cn("mt-2 h-px", "bg-[#c7d2e0]")} />
      </div>
    );
  }
  return (
    <div className={cn("flex items-center gap-2 pb-1.5 pt-4 first:pt-0", className)}>
      <span className={cn("text-[10.5px] font-bold uppercase tracking-wider", MUTED)}>{title}</span>
      <div className="h-px flex-1 bg-[#dde5ee]" />
      {action}
    </div>
  );
}
