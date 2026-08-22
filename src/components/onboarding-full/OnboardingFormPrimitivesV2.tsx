/**
 * Onboarding Form Primitives V2 — MAS HRMS Design Patterns
 *
 * Redesigned primitives with:
 * - Glassmorphism cards
 * - Gradient headers (section-specific)
 * - Colored sections
 * - Enhanced touch targets
 * - Responsive layouts
 *
 * All functional behavior identical to V1 — only styling changed.
 */

import { AlertCircle, CheckCircle2, Info, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Color configurations for sections
export const SECTION_COLORS = {
  blue: { gradient: "from-blue-600 to-indigo-600", bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-600", light: "bg-blue-100" },
  indigo: { gradient: "from-indigo-600 to-purple-600", bg: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-600", light: "bg-indigo-100" },
  purple: { gradient: "from-purple-600 to-violet-600", bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-600", light: "bg-purple-100" },
  pink: { gradient: "from-pink-600 to-rose-600", bg: "bg-pink-50", border: "border-pink-200", text: "text-pink-600", light: "bg-pink-100" },
  violet: { gradient: "from-violet-600 to-purple-600", bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-600", light: "bg-violet-100" },
  cyan: { gradient: "from-cyan-600 to-teal-600", bg: "bg-cyan-50", border: "border-cyan-200", text: "text-cyan-600", light: "bg-cyan-100" },
  teal: { gradient: "from-teal-600 to-emerald-600", bg: "bg-teal-50", border: "border-teal-200", text: "text-teal-600", light: "bg-teal-100" },
  emerald: { gradient: "from-emerald-600 to-green-600", bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-600", light: "bg-emerald-100" },
  amber: { gradient: "from-amber-500 to-orange-500", bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-600", light: "bg-amber-100" },
} as const;

/**
 * Form Field — Enhanced with better styling
 */
export function F({
  label, value, onChange, type = "text", opts, mode, onBlur,
  placeholder, required, prefilled, helpText, error: fieldError,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; opts?: string[];
  mode?: string;
  onBlur?: () => void;
  placeholder?: string; required?: boolean; prefilled?: boolean;
  helpText?: string; error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
        {label}
        {required && <span className="text-rose-500">*</span>}
        {prefilled && (
          <span className="text-[9px] font-black uppercase tracking-wide text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-2 py-0.5">
            Pre-filled
          </span>
        )}
      </Label>
      {opts ? (
        <select
          className={`flex min-h-[52px] w-full rounded-xl border-2 bg-white px-4 py-3 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20 focus-visible:border-indigo-500 transition-all ${
            fieldError
              ? "border-rose-400 bg-rose-50"
              : prefilled
                ? "border-emerald-300 bg-emerald-50"
                : "border-slate-200 hover:border-slate-300"
          }`}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <Input
          type={type}
          inputMode={mode as React.HTMLAttributes<HTMLInputElement>["inputMode"]}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          className={`min-h-[52px] text-base font-medium rounded-xl border-2 transition-all focus-visible:ring-2 focus-visible:ring-indigo-500/20 ${
            fieldError
              ? "border-rose-400 bg-rose-50 focus-visible:border-rose-400"
              : prefilled
                ? "bg-emerald-50 border-emerald-300 focus-visible:border-emerald-400"
                : "border-slate-200 hover:border-slate-300 focus-visible:border-indigo-500"
          }`}
        />
      )}
      {fieldError && (
        <p className="text-xs text-rose-600 font-semibold flex items-center gap-1.5 mt-1">
          <AlertCircle className="h-3.5 w-3.5" /> {fieldError}
        </p>
      )}
      {helpText && !fieldError && (
        <p className="text-xs text-slate-500 mt-1">{helpText}</p>
      )}
    </div>
  );
}

/**
 * Textarea Field — Enhanced
 */
export function T({ label, value, onChange, required, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  required?: boolean; placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-semibold text-slate-700">
        {label}{required && <span className="text-rose-500 ml-1">*</span>}
      </Label>
      <Textarea
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="text-base font-medium rounded-xl border-2 border-slate-200 hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-indigo-500/20 focus-visible:border-indigo-500 min-h-[100px] transition-all"
      />
    </div>
  );
}

/**
 * Read-Only Field — Glassmorphism style with optional icon
 */
export function RO({ label, value, highlight, icon: Icon, color = "slate" }: {
  label: string;
  value?: React.ReactNode;
  highlight?: boolean;
  icon?: React.ElementType;
  color?: keyof typeof SECTION_COLORS | "slate";
}) {
  const c = color !== "slate" ? SECTION_COLORS[color] : null;
  return (
    <div className={`rounded-xl border-2 p-4 transition-all hover:shadow-sm ${
      highlight
        ? "bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200"
        : c
          ? `bg-gradient-to-br ${c.bg} ${c.border}`
          : "bg-slate-50/80 border-slate-200"
    }`}>
      <div className="flex items-center gap-3">
        {Icon && (
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${c ? c.light : "bg-slate-100"}`}>
            <Icon className={`h-4 w-4 ${c ? c.text : "text-slate-600"}`} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-0.5 font-bold text-slate-900 text-sm break-words">{value ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Selection Chip — Enhanced with better visual feedback
 */
export function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-5 py-3 text-sm font-bold border-2 transition-all min-h-[52px] select-none active:scale-95 ${
        active
          ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white border-indigo-600 shadow-lg shadow-indigo-500/25"
          : "bg-white text-slate-700 border-slate-200 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50"
      }`}
    >
      {active && <span className="mr-1.5">✓</span>}{label}
    </button>
  );
}

/**
 * Section Header — Gradient-enabled with icon support
 */
export function SectionHead({
  children,
  sub,
  icon: Icon,
  color = "indigo"
}: {
  children: React.ReactNode;
  sub?: string;
  icon?: React.ElementType;
  color?: keyof typeof SECTION_COLORS;
}) {
  const c = SECTION_COLORS[color];
  return (
    <div className="mt-6 mb-4 flex items-center gap-3">
      {Icon && (
        <div className={`w-9 h-9 rounded-lg ${c.light} flex items-center justify-center`}>
          <Icon className={`h-4 w-4 ${c.text}`} />
        </div>
      )}
      <div className="flex-1 border-b-2 border-slate-100 pb-2">
        <p className="text-sm font-bold text-slate-900">{children}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

/**
 * Info Box — Enhanced with better styling
 */
export function InfoBox({ children, variant = "info" }: { children: React.ReactNode; variant?: "info" | "warning" | "success" | "error" }) {
  const styles = {
    info: "bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200 text-blue-800",
    warning: "bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 text-amber-800",
    success: "bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200 text-emerald-800",
    error: "bg-gradient-to-br from-rose-50 to-red-50 border-rose-200 text-rose-800",
  };
  const icons = { info: Info, warning: AlertCircle, success: CheckCircle2, error: XCircle };
  const Icon = icons[variant];
  return (
    <div className={`rounded-xl border-2 p-4 flex items-start gap-3 text-sm leading-relaxed ${styles[variant]}`}>
      <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" />
      <div className="flex-1">{children}</div>
    </div>
  );
}

/**
 * Yes/No Chip — Enhanced with color states
 */
export function YNChip({ label, value, onChange, helpText }: {
  label: string; value: boolean | null; onChange: (v: boolean) => void; helpText?: string;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-slate-700">{label}</Label>
      {helpText && <p className="text-xs text-slate-500">{helpText}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`flex-1 rounded-xl px-4 py-3 text-sm font-bold border-2 transition-all min-h-[52px] active:scale-95 ${
            value === true
              ? "bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-500/25"
              : "bg-white text-slate-600 border-slate-200 hover:border-emerald-400 hover:text-emerald-700"
          }`}
        >
          {value === true && <span className="mr-1.5">✓</span>}Yes
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`flex-1 rounded-xl px-4 py-3 text-sm font-bold border-2 transition-all min-h-[52px] active:scale-95 ${
            value === false
              ? "bg-rose-600 text-white border-rose-600 shadow-lg shadow-rose-500/25"
              : "bg-white text-slate-600 border-slate-200 hover:border-rose-400 hover:text-rose-700"
          }`}
        >
          {value === false && <span className="mr-1.5">✗</span>}No
        </button>
      </div>
    </div>
  );
}

/**
 * Glass Card — Wrapper with glassmorphism effect
 */
export function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-lg ${className}`}>
      {children}
    </div>
  );
}

/**
 * Gradient Card Header — For step cards
 */
export function GradientCardHeader({
  title,
  subtitle,
  icon: Icon,
  color = "blue",
  badge,
}: {
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  color?: keyof typeof SECTION_COLORS;
  badge?: React.ReactNode;
}) {
  const c = SECTION_COLORS[color];
  return (
    <div className={`bg-gradient-to-r ${c.gradient} p-5 sm:p-6`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Icon className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-black text-white">{title}</h2>
            {subtitle && <p className="text-white/80 text-sm mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {badge}
      </div>
    </div>
  );
}

/**
 * Document Card — For file upload status
 */
export function DocumentCard({
  type,
  status,
  onUpload,
  onRemove,
}: {
  type: string;
  status: "pending" | "uploaded" | "verified" | "error";
  onUpload?: () => void;
  onRemove?: () => void;
}) {
  const statusConfig = {
    pending: { bg: "bg-slate-50", border: "border-slate-200", badge: "bg-slate-100 text-slate-500", text: "Required" },
    uploaded: { bg: "bg-blue-50", border: "border-blue-200", badge: "bg-blue-100 text-blue-700", text: "Uploaded" },
    verified: { bg: "bg-emerald-50", border: "border-emerald-200", badge: "bg-emerald-100 text-emerald-700", text: "Verified" },
    error: { bg: "bg-rose-50", border: "border-rose-200", badge: "bg-rose-100 text-rose-700", text: "Error" },
  };
  const s = statusConfig[status];

  return (
    <div className={`rounded-xl border-2 ${s.border} ${s.bg} p-4 transition-all hover:shadow-md`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {status === "verified" ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          ) : status === "uploaded" ? (
            <CheckCircle2 className="h-5 w-5 text-blue-600" />
          ) : status === "error" ? (
            <XCircle className="h-5 w-5 text-rose-600" />
          ) : (
            <div className="w-5 h-5 rounded-full border-2 border-slate-300" />
          )}
          <span className="font-semibold text-sm text-slate-800">{type}</span>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${s.badge}`}>
          {s.text}
        </span>
      </div>
    </div>
  );
}

/**
 * Checklist Card — For submission review
 */
export function ChecklistCard({
  label,
  value,
  ok,
  icon: Icon,
  tone = "blue"
}: {
  label: string;
  value: string;
  ok: boolean;
  icon: React.ElementType;
  tone?: "blue" | "green" | "amber" | "purple" | "teal" | "pink";
}) {
  const tones = {
    blue: { bg: "from-blue-50 to-indigo-50", border: "border-blue-200", icon: "#0b63e5", text: "text-blue-700" },
    green: { bg: "from-emerald-50 to-green-50", border: "border-emerald-200", icon: "#15803d", text: "text-emerald-700" },
    amber: { bg: "from-amber-50 to-orange-50", border: "border-amber-200", icon: "#ea580c", text: "text-amber-700" },
    purple: { bg: "from-purple-50 to-violet-50", border: "border-purple-200", icon: "#6d28d9", text: "text-purple-700" },
    teal: { bg: "from-teal-50 to-cyan-50", border: "border-teal-200", icon: "#0891b2", text: "text-teal-700" },
    pink: { bg: "from-pink-50 to-rose-50", border: "border-pink-200", icon: "#db2777", text: "text-pink-700" },
  };
  const t = tones[tone];

  return (
    <div className={`rounded-xl border-2 ${t.border} bg-gradient-to-br ${t.bg} p-4 transition-all`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${t.icon}15` }}
          >
            <Icon className="h-5 w-5" style={{ color: t.icon }} />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p>
            <p className={`mt-0.5 font-bold text-sm ${t.text}`}>{value}</p>
          </div>
        </div>
        {ok ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
        ) : (
          <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
        )}
      </div>
    </div>
  );
}

/**
 * Step Badge — For step navigation
 */
export function StepBadge({
  step,
  title,
  isActive,
  isComplete,
  onClick,
  color = "blue",
}: {
  step: number;
  title: string;
  isActive: boolean;
  isComplete: boolean;
  onClick: () => void;
  color?: keyof typeof SECTION_COLORS;
}) {
  const c = SECTION_COLORS[color];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all min-h-[44px] ${
        isActive
          ? `${c.border} ${c.bg} ${c.text}`
          : isComplete
            ? "border-emerald-200 bg-emerald-50 text-emerald-600"
            : "border-slate-200 bg-white text-slate-400 hover:border-slate-300"
      }`}
    >
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black ${
        isActive
          ? `bg-gradient-to-r ${c.gradient} text-white`
          : isComplete
            ? "bg-emerald-500 text-white"
            : "bg-slate-200 text-slate-500"
      }`}>
        {isComplete ? <CheckCircle2 className="h-4 w-4" /> : step}
      </div>
      <span className="font-semibold text-sm hidden sm:inline">{title}</span>
    </button>
  );
}
