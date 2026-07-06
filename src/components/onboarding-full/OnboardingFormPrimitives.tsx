import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function F({
  label, value, onChange, type = "text", opts, mode, onBlur,
  placeholder, required, prefilled, helpText, error: fieldError,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; opts?: string[]; mode?: string; onBlur?: () => void;
  placeholder?: string; required?: boolean; prefilled?: boolean;
  helpText?: string; error?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
        {label}
        {required && <span className="text-red-500">*</span>}
        {prefilled && (
          <span className="text-[9px] font-black uppercase tracking-wide text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
            Pre-filled
          </span>
        )}
      </Label>
      {opts ? (
        <select
          className={`flex min-h-[48px] w-full rounded-lg border bg-white px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/20 focus-visible:border-blue-600 transition-colors ${fieldError ? "border-red-400" : prefilled ? "border-emerald-200 bg-emerald-50" : "border-slate-300 hover:border-slate-400"}`}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <Input
          type={type}
          inputMode={mode as React.HTMLInputTypeAttribute}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          className={`min-h-[48px] text-base rounded-lg border transition-colors focus-visible:ring-2 focus-visible:ring-blue-600/20 ${fieldError ? "border-red-400 focus-visible:border-red-400" : prefilled ? "bg-emerald-50 border-emerald-200 focus-visible:border-emerald-400" : "border-slate-300 hover:border-slate-400 focus-visible:border-blue-600"}`}
        />
      )}
      {fieldError && (
        <p className="text-xs text-red-600 font-semibold flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> {fieldError}
        </p>
      )}
      {helpText && !fieldError && (
        <p className="text-xs text-slate-500">{helpText}</p>
      )}
    </div>
  );
}

export function T({ label, value, onChange, required, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  required?: boolean; placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-sm font-semibold text-slate-700">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      <Textarea
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="text-base rounded-lg border border-slate-300 hover:border-slate-400 focus-visible:ring-2 focus-visible:ring-blue-600/20 focus-visible:border-blue-600 min-h-[88px] transition-colors"
      />
    </div>
  );
}

export function RO({ label, value, highlight }: { label: string; value?: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "bg-blue-50 border-blue-200" : "bg-slate-50 border-slate-200"}`}>
      <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-900 text-sm break-words">{value ?? "—"}</p>
    </div>
  );
}

export function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-bold border transition-all min-h-[44px] select-none active:scale-95 ${
        active
          ? "bg-blue-600 text-white border-blue-600 shadow-md"
          : "bg-white text-slate-700 border-slate-300 hover:border-blue-400 hover:text-blue-700"
      }`}
    >
      {active && <span className="mr-1">✓</span>}{label}
    </button>
  );
}

export function SectionHead({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mt-7 mb-4 pb-2 border-b border-slate-200">
      <p className="text-[11px] font-black uppercase tracking-[0.15em] text-slate-500">{children}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export function InfoBox({ children, variant = "info" }: { children: React.ReactNode; variant?: "info" | "warning" | "success" }) {
  const styles = {
    info: "bg-blue-50 border-blue-200 text-blue-800",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
    success: "bg-emerald-50 border-emerald-200 text-emerald-800",
  };
  const icons = { info: Info, warning: AlertCircle, success: CheckCircle2 };
  const Icon = icons[variant];
  return (
    <div className={`rounded-lg border p-4 flex items-start gap-3 text-sm leading-relaxed ${styles[variant]}`}>
      <Icon className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

export function YNChip({ label, value, onChange, helpText }: {
  label: string; value: boolean | null; onChange: (v: boolean) => void; helpText?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-semibold text-slate-700">{label}</Label>
      <div className="flex gap-2">
        {[{ l: "Yes", v: true }, { l: "No", v: false }].map(({ l, v }) => (
          <button
            key={l}
            type="button"
            onClick={() => onChange(v)}
            className={`flex-1 rounded-lg px-4 py-3 text-sm font-bold border transition-all min-h-[48px] active:scale-95 ${
              value === v
                ? v ? "bg-emerald-600 text-white border-emerald-600 shadow-md" : "bg-slate-700 text-white border-slate-700 shadow-md"
                : "bg-white text-slate-700 border-slate-300 hover:border-slate-500"
            }`}
          >
            {value === v && <span className="mr-1">{v ? "✓" : "✗"}</span>}{l}
          </button>
        ))}
      </div>
      {helpText && <p className="text-xs text-slate-500">{helpText}</p>}
    </div>
  );
}
