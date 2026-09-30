/**
 * Retention Interventions — tab=interventions of the Roster Command Center.
 *
 * KPI strip (server aggregates, click = drill-down) -> alert strip (severity ordered, click-to-filter)
 * -> weekly trend + open-by-tier + open-by-owner charts -> sortable virtualised case table.
 * Every table row / KPI / chart segment opens a right slide-over (DetailDrawer) that fetches from
 * a dedicated endpoint: GET .../:id (one case) or GET .../cases (the cases behind a segment).
 *
 * Sub-components live in ./interventions/. countByTier (interventionCounts.ts) is kept as the
 * fallback tier count for the loaded list when the server summary has not answered.
 */
import { Suspense, lazy, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Percent, RefreshCw, Shield, UserCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hrmsApi } from "@/lib/hrmsApi";
import { ChartCard } from "@/components/wfm/console/ChartCard";
import { ConsoleCard } from "@/components/wfm/console/ConsoleCard";
import { DetailDrawer } from "@/components/wfm/console/DetailDrawer";
import { KpiTile } from "@/components/wfm/console/KpiTile";
import { PanelHeader } from "@/components/wfm/console/PanelHeader";
import { UpdatedStamp } from "./heavyQuery";
import { useRosterConsoleFilters } from "./RosterConsoleFilterContext";
import { scopeParams } from "./filterState";
import { countByTier } from "./interventionCounts";
import {
  OWNER_LABEL, TIER_LABEL, adaptCase, adaptSummary, fmtInt, fmtPct,
  type CaseApiRow, type Owner, type SummaryApi, type Tier,
} from "./interventions/calc";
import { RecordBody, drawerHeaderFor, useCaseDetail } from "./interventions/InterventionDrawer";
import { SegmentBody, type Segment } from "./interventions/SegmentBody";
import InterventionTable from "./interventions/InterventionTable";

const InterventionCharts = lazy(() => import("./interventions/InterventionCharts"));
const BASE = "/api/analytics/intervention-recommendations";
const ALL = "__all__";
const QUERY_OPTS = { staleTime: 60_000, placeholderData: keepPreviousData, refetchOnWindowFocus: false } as const;

type View = null | { kind: "segment"; segment: Segment } | { kind: "record"; id: string; back?: Segment };

function DrawerHost({ view, setView }: { view: View; setView: (v: View) => void }) {
  const recordId = view?.kind === "record" ? view.id : "";
  const detail = useCaseDetail(recordId);
  if (!view) return <DetailDrawer open={false} onOpenChange={() => undefined} title="">{null}</DetailDrawer>;
  const close = () => setView(null);
  if (view.kind === "segment") {
    return (
      <DetailDrawer open onOpenChange={(o) => !o && close()} title={view.segment.title} subtitle="Cases behind this figure — select one for full detail">
        <SegmentBody segment={view.segment} onOpen={(r) => setView({ kind: "record", id: r.id, back: view.segment })} />
      </DetailDrawer>
    );
  }
  const h = drawerHeaderFor(detail.data);
  return (
    <DetailDrawer open onOpenChange={(o) => !o && close()} title={h.title} badge={h.badge} subtitle={h.subtitle}>
      {view.back && (
        <Button variant="ghost" size="sm" className="-ml-2 cursor-pointer" onClick={() => setView({ kind: "segment", segment: view.back! })}>
          Back to {view.back.title}
        </Button>
      )}
      <RecordBody id={view.id} onDone={() => undefined} />
    </DetailDrawer>
  );
}

export default function InterventionsPanel() {
  const qc = useQueryClient();
  const { filters } = useRosterConsoleFilters();
  const { branchId, processId, lobId } = filters;
  const [tier, setTier] = useState<string>(ALL);
  const [owner, setOwner] = useState<string>(ALL);
  const [view, setView] = useState<View>(null);
  const scope = scopeParams({ branchId, processId, lobId }).toString();

  const summaryQ = useQuery({
    queryKey: ["interventions", "summary", branchId, processId, lobId],
    queryFn: async () => adaptSummary((await hrmsApi.get<{ data?: SummaryApi }>(`${BASE}/outcomes?${scope}`))?.data),
    ...QUERY_OPTS,
  });
  const listQ = useQuery({
    queryKey: ["interventions", "list", tier, owner, branchId, processId, lobId],
    queryFn: async () => {
      const p = new URLSearchParams(scope);
      p.set("limit", "200");
      if (tier !== ALL) p.set("tier", tier);
      if (owner !== ALL) p.set("owner", owner);
      const raw = await hrmsApi.get<{ data?: CaseApiRow[] }>(`${BASE}/pending?${p}`);
      return (raw?.data ?? []).map(adaptCase);
    },
    ...QUERY_OPTS,
  });

  const s = summaryQ.data;
  const rows = listQ.data ?? [];
  const fallbackTiers = useMemo(() => countByTier(rows), [rows]);
  const tiers = s?.byTier ?? fallbackTiers;
  const seg = (title: string, bucket: Segment["bucket"], extra: Partial<Segment> = {}) => setView({ kind: "segment", segment: { title, bucket, scope, ...extra } });

  // Alerts: most severe first. Counts come from the server summary, never the (limited) list.
  const alerts = s ? [
    s.overdue > 0 && { key: "overdue", sev: 0, text: `${fmtInt(s.overdue)} open case${s.overdue === 1 ? "" : "s"} past action deadline`, run: () => seg("Overdue cases", "overdue") },
    tiers.CRITICAL > 0 && { key: "crit", sev: 1, text: `${fmtInt(tiers.CRITICAL)} critical-risk employee${tiers.CRITICAL === 1 ? "" : "s"} awaiting action`, run: () => setTier("CRITICAL") },
    tiers.HIGH > 0 && { key: "high", sev: 2, text: `${fmtInt(tiers.HIGH)} high-risk open`, run: () => setTier("HIGH") },
  ].filter(Boolean) as Array<{ key: string; sev: number; text: string; run: () => void }> : [];

  return (
    <>
      <PanelHeader
        icon={Shield}
        title="Retention interventions"
        description="Open retention cases for at-risk employees, deadlines and outcomes"
        updatedLabel={undefined}
        actions={<>
          <UpdatedStamp updatedAt={summaryQ.dataUpdatedAt} fetching={summaryQ.isFetching || listQ.isFetching} />
          <Button variant="outline" size="sm" className="min-h-[44px] cursor-pointer sm:min-h-9" onClick={() => qc.invalidateQueries({ queryKey: ["interventions"] })}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Refresh
          </Button>
        </>}
      />

      {summaryQ.isError && (
        <div role="alert" className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-semibold">Intervention summary could not be loaded</p>
          <p className="mt-0.5">Figures below are unavailable, not zero. Use Refresh; report it if it persists.</p>
        </div>
      )}

      {alerts.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-2" aria-label="Alerts">
          {alerts.sort((a, b) => a.sev - b.sev).map((a) => (
            <li key={a.key}>
              <button type="button" onClick={a.run}
                className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 ${a.sev < 2 ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {a.text}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Open cases" value={s ? fmtInt(s.openTotal) : "—"} sub="Awaiting action" tone="violet" icon={Clock}
          spark={s?.generatedSpark} delta={s?.generatedDelta ?? undefined} deltaBad="up" onClick={() => seg("Open cases", "open")} />
        <KpiTile label="Critical" value={s || listQ.data ? fmtInt(tiers.CRITICAL) : "—"} sub="Act within 24 h" tone="red" icon={AlertTriangle}
          onClick={() => seg("Critical open cases", "open", { tier: "CRITICAL" })} />
        <KpiTile label="High" value={s || listQ.data ? fmtInt(tiers.HIGH) : "—"} sub="Act within 48 h" tone="amber" icon={Zap}
          onClick={() => seg("High-risk open cases", "open", { tier: "HIGH" })} />
        <KpiTile label="Overdue" value={s ? fmtInt(s.overdue) : "—"} sub={s ? `${fmtPct(s.overduePct)} of open` : undefined} tone="red" icon={Clock}
          progress={s?.overduePct ?? undefined} onClick={() => seg("Overdue cases", "overdue")} />
        <KpiTile label="Action rate" value={s ? fmtPct(s.actionRate) : "—"} sub={s ? `${fmtInt(s.actioned)} of ${fmtInt(s.total)} actioned` : undefined} tone="blue" icon={Percent}
          progress={s?.actionRate ?? undefined} spark={s?.actionedSpark} delta={s?.actionedDelta ?? undefined} deltaBad="down" onClick={() => seg("Actioned cases", "actioned")} />
        <KpiTile label="Retained" value={s ? fmtInt(s.retained) : "—"} tone="green" icon={UserCheck}
          sub={s ? `${fmtPct(s.retentionRate)} of resolved · ${fmtInt(s.exited)} exited` : undefined} onClick={() => seg("Retained employees", "retained")} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ChartCard title="Cases by week" subtitle="Generated vs actioned, last 12 weeks — select a bar to see its cases" className="lg:col-span-2"
          loading={summaryQ.isLoading} error={summaryQ.isError} onRetry={() => summaryQ.refetch()} empty={!!s && s.total === 0} emptyLabel="No cases generated yet" height={330}>
          {s && <Suspense fallback={<div className="h-full animate-pulse rounded-md bg-slate-100" />}>
            <InterventionCharts part="trend" summary={s} onWeek={(w) => seg(`Cases generated week of ${w.split("-").reverse().join("/")}`, "all", { weekStart: w })} onTier={() => undefined} onOwner={() => undefined} />
          </Suspense>}
        </ChartCard>
        <div className="grid gap-3">
          <ChartCard title="Open by risk tier" loading={summaryQ.isLoading} error={summaryQ.isError} onRetry={() => summaryQ.refetch()} empty={!!s && s.openTotal === 0} emptyLabel="No open cases" height={130}>
            {s && <Suspense fallback={<div className="h-full animate-pulse rounded-md bg-slate-100" />}>
              <InterventionCharts part="tier" summary={s} onWeek={() => undefined} onTier={(t: Tier) => seg(`${TIER_LABEL[t]} open cases`, "open", { tier: t })} onOwner={() => undefined} />
            </Suspense>}
          </ChartCard>
          <ChartCard title="Open by owner" subtitle="A case can involve several owners" loading={summaryQ.isLoading} error={summaryQ.isError} onRetry={() => summaryQ.refetch()} empty={!!s && s.openTotal === 0} emptyLabel="No open cases" height={130}>
            {s && <Suspense fallback={<div className="h-full animate-pulse rounded-md bg-slate-100" />}>
              <InterventionCharts part="owner" summary={s} onWeek={() => undefined} onTier={() => undefined} onOwner={(o: Owner) => seg(`Open cases involving ${OWNER_LABEL[o]}`, "open", { owner: o })} />
            </Suspense>}
          </ChartCard>
        </div>
      </div>

      <ConsoleCard>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
          <h3 className="mr-auto text-sm font-semibold text-slate-900">Open cases {listQ.data && <span className="font-normal text-slate-600">· {fmtInt(rows.length)}{s && s.openTotal > rows.length && tier === ALL && owner === ALL ? ` of ${fmtInt(s.openTotal)}` : ""}</span>}</h3>
          <Select value={tier} onValueChange={setTier}>
            <SelectTrigger className="w-36" aria-label="Filter by risk tier"><SelectValue placeholder="Risk tier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All tiers</SelectItem>
              {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as Tier[]).map((t) => <SelectItem key={t} value={t}>{TIER_LABEL[t]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger className="w-40" aria-label="Filter by owner"><SelectValue placeholder="Owner" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All owners</SelectItem>
              {(Object.keys(OWNER_LABEL) as Owner[]).map((o) => <SelectItem key={o} value={o}>{OWNER_LABEL[o]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {listQ.isLoading ? (
          <div className="space-y-2 p-3" role="status" aria-label="Loading cases">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />)}
          </div>
        ) : listQ.isError ? (
          <div role="alert" className="p-6 text-center text-sm text-red-800">
            Could not load open cases.{" "}
            <button type="button" className="cursor-pointer font-semibold underline" onClick={() => listQ.refetch()}>Retry</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 p-10 text-center text-sm text-slate-600">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden />
            <p className="font-medium text-slate-900">No open cases for these filters</p>
            <p>Cases appear once retention recommendations are generated for at-risk employees.</p>
          </div>
        ) : (
          <InterventionTable rows={rows} onOpen={(r) => setView({ kind: "record", id: r.id })} />
        )}
      </ConsoleCard>

      <DrawerHost view={view} setView={setView} />
    </>
  );
}
