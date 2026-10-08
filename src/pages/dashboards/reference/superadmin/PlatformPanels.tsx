import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { KpiTiles, LazySection, Panel, SeriesPanel, type RoleInsights } from "../../kit";
import { STATE_TONE, tableRows } from "./superAdminModel";

const SEV: Record<string, string> = {
  critical: "bg-rose-50 text-rose-700 ring-rose-200", high: "bg-amber-50 text-amber-800 ring-amber-200",
  medium: "bg-blue-50 text-blue-700 ring-blue-200", info: "bg-slate-100 text-slate-600 ring-slate-200",
};

function Chip({ text, tone }: { text: string; tone: string }) {
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ring-1", tone)}>{text}</span>;
}

/** Newest-first feed of security events and failed runs: what would page a platform owner. */
export function IncidentFeed({ insights, loading }: { insights?: RoleInsights; loading?: boolean }) {
  const rows = tableRows(insights, "incident_feed");
  return (
    <Panel title="Incident feed" subtitle="Security events, failed syncs, failed jobs and vendor errors" href="/security-center" hrefLabel="Security center" bodyClassName="p-0">
      {loading && !rows.length ? <p className="p-4 text-[12px] text-slate-400">Loading incidents…</p>
        : !rows.length ? <p className="p-4 text-[12px] font-semibold text-emerald-700">No incidents in the last 7 days.</p> : (
          <ul className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
            {rows.map((r, i) => (
              <li key={i}>
                <Link to={String(r.href ?? "/security-center")} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
                  <Chip text={String(r.severity)} tone={SEV[String(r.severity)] ?? SEV.info} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-slate-800">{String(r.title)}</p>
                    {r.detail ? <p className="line-clamp-1 text-[11px] text-slate-500">{String(r.detail)}</p> : null}
                  </div>
                  <span className="shrink-0 text-right text-[11px] text-slate-400"><span className="block font-semibold uppercase">{String(r.source)}</span>{String(r.at_txt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </Panel>
  );
}

/** Generic state table: first column text, `state` chip, then remaining columns. */
function StateTable({ rows, cols, empty }: { rows: ReturnType<typeof tableRows>; cols: Array<[string, string, boolean?]>; empty: string }) {
  if (!rows.length) return <p className="p-4 text-[12px] text-slate-400">{empty}</p>;
  return (
    <div className="max-h-[360px] overflow-auto">
      <table className="w-full min-w-[480px] text-left text-[12px]">
        <thead className="sticky top-0 bg-slate-50 text-slate-500"><tr>{cols.map(([k, label, right]) => <th key={k} className={cn("px-4 py-2 font-semibold", right && "text-right")}>{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50">
              {cols.map(([k, , right], ci) => (
                <td key={k} className={cn("px-4 py-2", ci === 0 && "font-medium text-slate-900", right && "kit-num text-right font-semibold")}>
                  {k === "state" ? <Chip text={String(r.state)} tone={STATE_TONE[String(r.state)] ?? STATE_TONE.idle} /> : r[k] === null || r[k] === undefined ? "—" : String(r[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IntegrationRegistry({ insights }: { insights?: RoleInsights }) {
  return (
    <Panel title="Integration registry" subtitle="Every configured feed, its latest run and why it is flagged" href="/integration-hub" hrefLabel="Integration hub" bodyClassName="p-0">
      <StateTable rows={tableRows(insights, "integrations")} empty="No integrations configured." cols={[["integration", "Integration"], ["state", "State"], ["reason", "Why"], ["last_run", "Last run"]]} />
    </Panel>
  );
}

export function JobHealth({ insights }: { insights?: RoleInsights }) {
  return (
    <Panel title="Scheduled job health" subtitle="From worker_job_run, last 7 days" href="/integration-hub" hrefLabel="Integration hub" bodyClassName="p-0">
      <StateTable rows={tableRows(insights, "jobs")} empty="No job runs recorded." cols={[["worker", "Job"], ["state", "State"], ["runs_ok", "OK runs", true], ["failed_7d", "Failed", true], ["last_success", "Last success"]]} />
    </Panel>
  );
}

/** Error-rate tiles (each links to where it is fixed) plus the delivery / job trend charts. */
export function ErrorRates({ insights, loading }: { insights?: RoleInsights; loading?: boolean }) {
  const kpis = (insights?.kpis ?? []).filter((k) => ["email_failure_rate", "bgv_error_rate", "integration_failures_24h", "job_failures_24h", "integrations_failing", "jobs_failed_7d"].includes(k.key));
  const charts = (insights?.series ?? []).filter((s) => ["email_delivery", "job_runs"].includes(s.key));
  return (
    <div className="space-y-4">
      <KpiTiles kpis={kpis} loading={loading} cols={3} />
      <div className="grid gap-4 lg:grid-cols-2">{charts.map((s) => <LazySection key={s.key}><SeriesPanel series={s} /></LazySection>)}</div>
    </div>
  );
}
