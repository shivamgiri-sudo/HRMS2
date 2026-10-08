import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { KpiTiles, LazySection, Panel, SeriesPanel, TablePanel, type RoleInsights } from "../../kit";
import { tableRows, type PayrollGap } from "./superAdminModel";

const SEV_DOT: Record<string, string> = { critical: "bg-rose-500", high: "bg-amber-500", normal: "bg-blue-500", info: "bg-emerald-500" };

/** Authentication health, role risk, and the audit trail highlights. */
export function SecurityAccess({ insights, loading }: { insights?: RoleInsights; loading?: boolean }) {
  const keys = ["failed_logins_24h", "locked_accounts", "token_reuse_7d", "privileged_grants_30d", "privileged_accounts", "dormant_privileged", "audit_events_today"];
  const kpis = (insights?.kpis ?? []).filter((k) => keys.includes(k.key));
  const series = (insights?.series ?? []).filter((s) => ["logins_14d", "security_events_7d", "audit_modules"].includes(s.key));
  const tables = (insights?.tables ?? []).filter((t) => ["dormant_admins", "recent_grants", "audit_actors"].includes(t.key));
  return (
    <div className="space-y-4">
      <KpiTiles kpis={kpis} loading={loading} cols={4} />
      <div className="grid gap-4 lg:grid-cols-3">{series.map((s) => <LazySection key={s.key}><SeriesPanel series={s} /></LazySection>)}</div>
      <div className="grid gap-4 lg:grid-cols-3">{tables.map((t) => <LazySection key={t.key}><TablePanel table={t} /></LazySection>)}</div>
    </div>
  );
}

/** Provider completeness checks plus payroll data gaps from the summary bundle. */
export function DataQuality({ insights, payrollGaps, loading }: { insights?: RoleInsights; payrollGaps: PayrollGap[]; loading?: boolean }) {
  const rows = tableRows(insights, "data_quality");
  const completeness = insights?.kpis.find((k) => k.key === "profile_completeness");
  return (
    <Panel title="Data quality" subtitle={completeness?.helper ?? (loading ? "Checking records…" : undefined)} bodyClassName="p-0"
      action={completeness?.value !== null && completeness?.value !== undefined ? <span className="kit-num rounded-lg bg-emerald-50 px-2 py-1 text-[13px] font-extrabold text-emerald-700 ring-1 ring-emerald-200">{completeness.value}% complete</span> : null}>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={String(r.key)}>
            <Link to={String(r.href ?? "/employees")} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", SEV_DOT[String(r.severity)] ?? "bg-slate-400")} aria-hidden />
              <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-slate-800">{String(r.check)}</p>{r.hint ? <p className="truncate text-[11px] text-slate-500">{String(r.hint)}</p> : null}</div>
              <span className="kit-num text-[14px] font-extrabold text-slate-900">{r.count === null ? "—" : Number(r.count).toLocaleString("en-IN")}</span>
            </Link>
          </li>
        ))}
        {payrollGaps.map((g) => (
          <li key={g.label}>
            <Link to={g.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", (g.count ?? 0) > 0 ? "bg-amber-500" : "bg-emerald-500")} aria-hidden />
              <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-slate-800">{g.label}</p><p className="truncate text-[11px] text-slate-500">{g.hint}</p></div>
              <span className="kit-num text-[14px] font-extrabold text-slate-900">{g.count === null ? "—" : g.count.toLocaleString("en-IN")}</span>
            </Link>
          </li>
        ))}
        {!rows.length && loading ? <li className="p-4 text-[12px] text-slate-400">Loading checks…</li> : null}
      </ul>
    </Panel>
  );
}
