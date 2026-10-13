/** Small presentational pieces shared by the Molecular Email Dashboard sections. */
import type { ReactNode } from "react";

export function Card({ title, sub, children, right }: { title: string; sub?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          {sub && <p className="text-xs text-slate-500">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Kpi({ label, value, hint, tone = "slate", onClick }: {
  label: string; value: string | number; hint?: string;
  tone?: "slate" | "green" | "amber" | "red" | "blue"; onClick?: () => void;
}) {
  const tones: Record<string, string> = {
    slate: "border-slate-200 bg-white",
    green: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    red: "border-rose-200 bg-rose-50",
    blue: "border-sky-200 bg-sky-50",
  };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`rounded-xl border p-3 text-left shadow-sm ${tones[tone]} ${onClick ? "cursor-pointer hover:ring-2 hover:ring-sky-300" : ""}`}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-extrabold text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </Tag>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "error" }) {
  const cls = tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800"
    : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-sky-200 bg-sky-50 text-sky-900";
  return <div className={`rounded-lg border px-3 py-2 text-xs ${cls}`}>{children}</div>;
}

export function Loading() {
  return <div className="py-10 text-center text-sm text-slate-500">Loading…</div>;
}

export function MissingBadge({ what }: { what: string }) {
  return (
    <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800" title={`No ${what} record for this agent/day — not counted as zero`}>
      no {what}
    </span>
  );
}
