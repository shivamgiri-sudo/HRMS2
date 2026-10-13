/** Molecular Email Dashboard — Overview (MOL-02), lifecycle (MOL-04) and TAT/ageing (MOL-05). */
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, Kpi, Loading, Notice } from "./MolecularUi";
import {
  fmtHours, fmtPct, fmtStamp, molApi, orNA, TAT_BUCKETS, type MolDailyFallback, type MolFilters, type MolOverview, type TatBucket,
} from "./molecularApi";

export function MolecularOverviewSection({ f, onDrill }: {
  f: MolFilters;
  /** Opens the ticket table with these filters (so a card reconciles to rows). */
  onDrill: (patch: Partial<MolFilters>) => void;
}) {
  const q = useQuery({ queryKey: ["mol", "overview", f], queryFn: () => molApi.overview(f), staleTime: 60_000 });
  const apr = useQuery({ queryKey: ["mol", "apr", f.from, f.to], queryFn: () => molApi.aprSummary(f), staleTime: 120_000 });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Notice tone="error">{(q.error as Error)?.message ?? "Failed to load the overview."}</Notice>;
  const d = q.data;
  const k = d.kpis;
  const util = apr.data && apr.data.agentCount > 0 ? apr.data.avgUtilization : null;

  const funnel = [
    { stage: "Received", value: k.funnel.received },
    { stage: "Closed at least once", value: k.funnel.firstClosed },
    { stage: "Reopened", value: k.funnel.reopened },
    { stage: "Final closed", value: k.funnel.finalClosed },
    { stage: "Pending now", value: k.funnel.pending },
  ];
  const buckets = TAT_BUCKETS.map((b: TatBucket) => ({ bucket: b, closed: k.closedTatBuckets[b], open: k.openAgeingBuckets[b] }));

  return (
    <div className="space-y-4">
      {!d.hasData && <FeedNotice d={d} />}
      {!d.hasData && d.dailyFallback?.hasData && <DailyFallback fb={d.dailyFallback} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Active Agents" value={apr.data ? apr.data.agentCount : apr.isLoading ? "…" : "N/A"} hint="Logged in on MOEMAIL in the period (APR)" />
        <Kpi label="Tickets Received" value={k.received} hint="Unique ticket IDs created" onClick={() => onDrill({ status: "", tatBucket: "" })} />
        <Kpi label="Tickets Closed" value={k.closed} tone="green" hint="Unique, currently closed" onClick={() => onDrill({ status: "closed", tatBucket: "" })} />
        <Kpi label="Pending / Open" value={k.pending} tone="amber" hint="Received − final closed" onClick={() => onDrill({ status: "open", tatBucket: "" })} />
        <Kpi label="Reopened" value={k.reopened} tone="red" hint={`${k.reopenEvents} reopen events`} onClick={() => onDrill({ status: "reopened", tatBucket: "" })} />
        <Kpi label="Closure %" value={fmtPct(k.closurePct)} tone="green" hint="Closed ÷ Received" />
        <Kpi label="Reopen %" value={fmtPct(k.reopenPct)} tone="red" hint="Reopened ÷ Closed (unique)" />
        <Kpi label="First-Time Closure" value={fmtPct(k.firstTimeClosureRate)} hint="Closed never reopened ÷ Closed" />
        <Kpi label="Reopen Events" value={k.reopenEvents} hint="All Closed→Open events" />
        <Kpi label="Avg TAT" value={fmtHours(k.avgTatHours)} hint={`Median ${fmtHours(k.medianTatHours)}`} />
        <Kpi label={`Within SLA (${k.slaHours}h)`} value={fmtPct(k.withinSlaPct)} tone="blue" hint="Closed tickets with valid TAT" />
        <Kpi label="Pending > 72h" value={k.pendingOver72h} tone="red" hint="Open tickets aged over 72h" onClick={() => onDrill({ status: "open", tatBucket: ">72h" })} />
        <Kpi label="Agent Utilization" value={fmtPct(util)} hint="(Talk + Wait) ÷ Net login, APR" />
        <Kpi label="Data-quality excluded" value={k.dataQualityExcluded} hint="Invalid timestamps, kept out of TAT" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Ticket lifecycle funnel" sub="Unique tickets received in the period">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={funnel} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="stage" width={130} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" name="Tickets" fill="#2563eb" radius={4} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Received vs Closed vs Reopened" sub="Received by created date · Closed by final-closed date · Reopens by reopen-event date">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={d.trend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="received" name="Received" fill="#94a3b8" />
              <Line dataKey="closed" name="Closed" stroke="#16a34a" strokeWidth={2} dot={false} />
              <Line dataKey="reopenEvents" name="Reopen events" stroke="#dc2626" strokeWidth={2} dot={false} />
              <Line dataKey="reopenedTickets" name="Reopened tickets" stroke="#f97316" strokeDasharray="4 3" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
        <Card title="TAT distribution (closed) and ageing (open)" sub="0–24h includes exactly 24h. Closed: final closed − created. Open: now (IST) − created.">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={buckets}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="closed" name="Closed tickets (TAT)" fill="#16a34a" onClick={(p: { bucket?: TatBucket }) => p.bucket && onDrill({ status: "closed", tatBucket: p.bucket })} />
              <Bar dataKey="open" name="Open tickets (age)" fill="#f59e0b" onClick={(p: { bucket?: TatBucket }) => p.bucket && onDrill({ status: "open", tatBucket: p.bucket })} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Reopen rate by category" sub={d.fieldAvailability.category ? "Closed tickets per category" : "Category is not available in the Molecular source — shown as N/A"}>
          <div className="max-h-56 overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500"><tr><th className="py-1">Category</th><th className="text-right">Closed</th><th className="text-right">Reopened</th><th className="text-right">Reopen %</th></tr></thead>
              <tbody>
                {d.categoryReopen.map((c) => (
                  <tr key={c.category} className="border-t border-slate-100">
                    <td className="py-1">{c.category}</td><td className="text-right">{c.closed}</td><td className="text-right">{c.reopened}</td><td className="text-right">{fmtPct(c.reopenPct)}</td>
                  </tr>
                ))}
                {d.categoryReopen.length === 0 && <tr><td colSpan={4} className="py-3 text-center text-slate-400">No closed tickets</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">Top reopen reasons: N/A — the source records no reopen reason.</p>
        </Card>
      </div>

      <Card title="Oldest pending tickets" sub="Open tickets received in the period, by age (now IST − created)">
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white text-left text-slate-500">
              <tr><th className="py-1">Ticket</th><th>Created</th><th>Agent</th><th>Category</th><th>Priority</th><th>Status</th><th className="text-right">Age</th><th>Bucket</th><th className="text-right">Reopens</th></tr>
            </thead>
            <tbody>
              {d.oldestPending.map((t) => (
                <tr key={t.ticketId} className="border-t border-slate-100">
                  <td className="py-1 font-mono">{t.ticketId}</td><td>{fmtStamp(t.createdAt)}</td><td>{orNA(t.agentName)}</td><td>{orNA(t.category)}</td><td>{orNA(t.priority)}</td><td>{orNA(t.status)}</td>
                  <td className="text-right">{fmtHours(t.tatHours)}</td><td>{orNA(t.tatBucket)}</td><td className="text-right">{t.reopenCount}</td>
                </tr>
              ))}
              {d.oldestPending.length === 0 && <tr><td colSpan={9} className="py-3 text-center text-slate-400">No pending tickets</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Notice>
        Closure time source: {d.closureBasis.closed_at ?? 0} tickets from the source's closed time,{" "}
        {d.closureBasis.last_agent_reply ?? 0} from the agent's last reply (the source logs no close event).{" "}
        {d.ticketsWithoutCreatedTime > 0 && `${d.ticketsWithoutCreatedTime} ticket(s) have no readable created time and appear in no period. `}
        Priority {d.fieldAvailability.priority ? "available" : "not available at source (N/A)"}. As of {fmtStamp(d.asOf)} IST
        {d.lastSyncedAt ? `, last sync ${fmtStamp(d.lastSyncedAt)}` : ""}.
      </Notice>
    </div>
  );
}

/** Why the ticket KPIs are empty: no tickets in the period, or the ticket feed has never arrived. */
function FeedNotice({ d }: { d: MolOverview }) {
  const { ticketFeedLastSyncedAt, dailyFeedLastSyncedAt, dailyLatestDate } = d.feed;
  if (ticketFeedLastSyncedAt) {
    return (
      <Notice tone="warn">
        No Molecular tickets were received in this period with these filters. Tickets sync hourly; last ticket sync {fmtStamp(ticketFeedLastSyncedAt)}.
      </Notice>
    );
  }
  return (
    <Notice tone="warn">
      <strong>Ticket-level data has not arrived yet.</strong> HRMS has not been able to reach the Molecular ticketing server
      {dailyFeedLastSyncedAt ? ` since ${fmtStamp(dailyFeedLastSyncedAt)}` : ""}, so the per-ticket feed behind these cards
      (closure, reopen, TAT, ageing, ticket table) has not run once. It fills automatically on the next hourly sync after the
      connection is restored.
      {dailyLatestDate ? ` The daily summary below is what HRMS already holds, up to ${fmtStamp(dailyLatestDate)}.` : ""}
    </Notice>
  );
}

/** Day-level counts from the older daily sync, shown while the per-ticket feed is empty. */
function DailyFallback({ fb }: { fb: MolDailyFallback }) {
  return (
    <Card title="Daily ticket summary (earlier daily feed)" sub="Counts per day as the Molecular source reported them. Not unique-ticket KPIs: closures here are agent replies, reopens are events.">
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Tickets Received" value={fb.totalTickets} />
        <Kpi label="Closures (replies)" value={fb.emailClosed} tone="green" />
        <Kpi label="Reopen events" value={fb.emailReopen} tone="red" />
        <Kpi label="Open (latest day)" value={fb.openPending} tone="amber" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={fb.daily}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="totalTickets" name="Received" fill="#94a3b8" />
            <Line dataKey="emailClosed" name="Closures (replies)" stroke="#16a34a" strokeWidth={2} dot={false} />
            <Line dataKey="emailReopen" name="Reopen events" stroke="#dc2626" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="max-h-56 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white text-left text-slate-500">
              <tr><th className="py-1">Agent</th><th className="text-right">Received</th><th className="text-right">Closed</th><th className="text-right">Reopened</th><th className="text-right">Open</th></tr>
            </thead>
            <tbody>
              {fb.byAnalyst.map((a) => (
                <tr key={a.analyst} className="border-t border-slate-100">
                  <td className="py-1">{orNA(a.analyst)}</td><td className="text-right">{a.ticketsReceived}</td><td className="text-right">{a.ticketsClosed}</td>
                  <td className="text-right">{a.ticketsReopened}</td><td className="text-right">{a.ticketsOpenPending}</td>
                </tr>
              ))}
              {fb.byAnalyst.length === 0 && <tr><td colSpan={5} className="py-3 text-center text-slate-400">No agent rows</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}
