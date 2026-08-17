import type { ReactNode } from "react";

export { ScorePill, Spinner, ErrBanner, PanelShell };

function ScorePill({ score }: { score: number }) {
  const cls =
    score >= 80 ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
    score >= 70 ? "bg-yellow-100 text-yellow-700 border-yellow-200" :
    score >= 60 ? "bg-orange-100 text-orange-700 border-orange-200" :
                  "bg-red-100 text-red-700 border-red-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold tabular-nums ${cls}`}>
      {score}%
    </span>
  );
}

function Spinner({ size = "md" }: { size?: "sm" | "md" }) {
  const sz = size === "sm" ? "h-5 w-5 border-2" : "h-8 w-8 border-4";
  return (
    <div className="flex items-center justify-center py-8">
      <div className={`animate-spin rounded-full border-slate-200 border-t-blue-600 ${sz}`} />
    </div>
  );
}

function ErrBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
      <span className="shrink-0">⚠</span> {msg}
    </div>
  );
}

function PanelShell({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold leading-tight text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}
