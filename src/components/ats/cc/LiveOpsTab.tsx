import { humanizeStage } from "./stage-label";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, CheckCircle2, Clock, Grid3x3, Hourglass, LifeBuoy, Lightbulb, Loader2, Siren, TimerReset, TrendingUp, UserCheck, UserX, Users, Workflow } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAtsOperations, useDrill, type AtsOperations } from "@/hooks/useAtsDashboards";
import { useStageDwell } from "@/hooks/useAtsCommandCenter";
import { useAtsOverview } from "@/hooks/useAtsOverview";
import { useDrillActions } from "@/components/ats/overview/drill";
import { BarRows, Empty, V, fmt, tooltipStyle } from "@/components/ats/overview/viz";
import { Heatmap } from "@/components/ats/overview/charts";
import { Card, ExportButton, FilterBar, HeatTable, InsightList, KpiCard, LiveBadge, Section, Waterfall, downloadCsv } from "./cc-kit";
import { useCC } from "./cc-context";
import {
  DOW_SHORT, LEVEL_LABEL, SLOTS, buildLiveFindings, capacityByBranch, escalationCounts, filterQueue, fmtWait, groupBreaches, istHour, peakCells,
  rateByKey, slotTotals, sortEscalations, waitTone, weekdayBreaches, type QueueMode, type WaitTone,
} from "./liveops-helpers";

const tick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const TONE_CLS: Record<WaitTone, string> = {
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  warn: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
  crit: "bg-red-500/15 text-red-700 dark:text-red-300",
};
const chip = (on: boolean) => `min-h-[32px] cursor-pointer rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`;
const errStatus = (e: unknown) => (e && typeof e === "object" && "status" in e ? Number((e as { status?: number }).status) : 0);
const errText = (e: unknown) => (e instanceof Error ? e.message : "Request failed");

/* ───────── Branch activity report (copied shape of backend ReportData; only the parts this panel reads) ───────── */
interface SlaStat { met: number; breached: number; measured: number; population: number; coveragePct: number; reliable: boolean; pct: number | null; avgMin: number | null; p90Min: number | null }
interface Summary { walkins: number; tokens: number; called: number; closed: number; interviewed: number; selected: number; joined: number; sla1: SlaStat; sla2: SlaStat }
interface Escalation { level: 1 | 2 | 3; escalateTo: string; branch: string; tokenNumber: string; candidateName: string; process: string; recruiter: string; stage: string; arrivalHhmm: string; runningMin: number; stageSlaMin: number; overSlaMin: number }
interface ReportData { reportDate: string; overall: { ftd: Summary }; branches: { branch: string; ftd: Summary; escalations: Escalation[] }[]; escalations: Escalation[]; onTrackOpen: number }
const STEPS: { key: keyof Summary; label: string; extra?: Record<string, unknown> }[] = [
  { key: "walkins", label: "Walk-in" }, { key: "tokens", label: "Token issued" }, { key: "called", label: "Called" }, { key: "closed", label: "Closed" },
  { key: "interviewed", label: "Interviewed" }, { key: "selected", label: "Selected", extra: { outcome: "selected" } }, { key: "joined", label: "Joined", extra: { outcome: "joined" } },
];
const slaTone = (s: SlaStat) => (!s.reliable || s.pct == null ? "bg-muted text-muted-foreground" : s.pct >= 90 ? TONE_CLS.ok : s.pct >= 70 ? TONE_CLS.warn : TONE_CLS.crit);

function BranchActivity({ go }: { go: (crumb: string, extra?: Record<string, unknown>, live?: boolean) => void }) {
  const cc = useCC();
  const max = today();
  const [date, setDate] = useState(max);
  const q = useQuery({
    queryKey: ["ats-cc-branch-activity", date], placeholderData: keepPreviousData, staleTime: 60_000, refetchOnWindowFocus: false, retry: 0,
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: ReportData }>(`/api/ats/branch-activity-report?date=${date}`)).data,
  });
  const r = q.data;
  const blk = r && cc.branch ? r.branches.find((b) => b.branch === cc.branch) : undefined;
  const s = blk ? blk.ftd : r?.overall.ftd;
  const esc = sortEscalations(blk ? blk.escalations : r?.escalations ?? []);
  const cnt = escalationCounts(esc);
  const goDay = (crumb: string, extra: Record<string, unknown> = {}) => go(crumb, { from: date, to: date, ...extra }, true);
  return (
    <Card i={14} title="Branch activity" icon={<CalendarDays className="h-4 w-4" />} hint={`Walk-in to joined and SLA scorecard${blk ? ` for ${blk.branch}` : ", all branches"}`}
      right={<div className="flex items-center gap-2">{q.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Loading report" />}
        <input type="date" value={date} max={max} onChange={(e) => e.target.value && e.target.value <= max && setDate(e.target.value)} aria-label="Report date" className="h-9 rounded-lg border bg-card px-2 text-xs" /></div>}>
      {q.isError && <div role="alert" className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">Could not refresh the report ({errText(q.error)}).{r ? " Showing the last loaded data." : ""}</div>}
      {q.isLoading ? <Skeleton className="h-72" /> : !s ? <Empty text={errStatus(q.error) === 403 ? "The branch report is not available for your role" : "No report for this date"} /> : (
        <div className="grid gap-5 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Funnel on {date}</div>
            <Waterfall steps={STEPS.map((x) => ({ key: x.key, label: x.label, n: s[x.key] as number }))} onStep={(k) => { const st = STEPS.find((x) => x.key === k)!; goDay(`${st.label} on ${date}`, st.extra); }} />
          </div>
          <div className="space-y-4 lg:col-span-7">
            <div className="grid gap-2 sm:grid-cols-2">
              {([["SLA 1 · waiting to call", "within 20 min", s.sla1], ["SLA 2 · call to closure", "within 2 h", s.sla2]] as const).map(([l, t, st]) => (
                <button key={l} onClick={() => goDay(l, { outcome: "waiting" })} className="cursor-pointer rounded-xl border p-3 text-left hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                  <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-muted-foreground">{l}</span><span className={`cc-num rounded-full px-2 py-0.5 text-xs font-semibold ${slaTone(st)}`}>{st.reliable && st.pct != null ? `${st.pct}%` : "n/a"}</span></div>
                  <div className="cc-num mt-1 text-xs text-muted-foreground">{t} · {fmt(st.met)} met · {fmt(st.breached)} breached · avg {fmtWait(st.avgMin)} · p90 {fmtWait(st.p90Min)}</div>
                  {!st.reliable && <div className="mt-0.5 text-[11px] text-muted-foreground">Only {st.coveragePct}% of events carry timestamps</div>}
                </button>
              ))}
            </div>
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-medium text-muted-foreground">Escalation ladder</span>
                {([3, 2, 1] as const).map((l) => <span key={l} className={`cc-num rounded-full px-2 py-0.5 font-semibold ${l === 3 ? TONE_CLS.crit : l === 2 ? TONE_CLS.warn : "bg-sky-500/15 text-sky-700 dark:text-sky-300"}`}>{LEVEL_LABEL[l]} · {l === 3 ? cnt.l3 : l === 2 ? cnt.l2 : cnt.l1}</span>)}
                <span className={`cc-num rounded-full px-2 py-0.5 font-semibold ${TONE_CLS.ok}`}>Inside SLA · {r?.onTrackOpen ?? 0}</span>
              </div>
              {esc.length ? (
                <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[520px] text-xs">
                  <thead className="bg-muted/50 text-left text-muted-foreground"><tr><th className="px-2 py-1.5 font-medium">Level</th><th className="px-2 py-1.5 font-medium">Branch</th><th className="px-2 py-1.5 font-medium">Token</th><th className="px-2 py-1.5 font-medium">Candidate</th><th className="px-2 py-1.5 font-medium">Stage</th><th className="px-2 py-1.5 text-right font-medium">Over SLA</th></tr></thead>
                  <tbody>{esc.slice(0, 8).map((e, i) => (
                    <tr key={`${e.tokenNumber}-${i}`} className="border-t">
                      <td className="px-2 py-1.5"><span className={`rounded-full px-2 py-0.5 font-semibold ${e.level === 3 ? TONE_CLS.crit : e.level === 2 ? TONE_CLS.warn : "bg-sky-500/15 text-sky-700 dark:text-sky-300"}`}>L{e.level}</span></td>
                      <td className="px-2 py-1.5"><button onClick={() => goDay(e.branch, { branch: e.branch })} className="cursor-pointer hover:text-primary hover:underline">{e.branch}</button></td>
                      <td className="cc-num px-2 py-1.5">{e.tokenNumber}</td><td className="max-w-[10rem] truncate px-2 py-1.5">{e.candidateName}</td><td className="px-2 py-1.5">{e.stage}</td><td className="cc-num px-2 py-1.5 text-right font-semibold">{fmtWait(e.overSlaMin)}</td>
                    </tr>))}</tbody></table>
                  {esc.length > 8 && <div className="border-t px-2 py-1.5 text-[11px] text-muted-foreground">Showing 8 of {esc.length} escalations</div>}
                </div>
              ) : <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" aria-hidden />Nothing to escalate on {date}.</div>}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ───────── Tab ───────── */
const SPLIT_TABS = [["source", "Source"], ["recruiter", "Recruiter"], ["branch", "Branch"], ["process", "Process"]] as const;
type SplitTab = (typeof SPLIT_TABS)[number][0];
const AGING = ["0-1d", "2-3d", "4-7d", "8-14d", "15d+"];

export function LiveOpsTab() {
  const cc = useCC();
  const act = useDrillActions();
  const base = cc.drill();
  // Scoped roles (branch head, process manager) never call the org-wide live queue or overview aggregates.
  const ops = useAtsOperations(cc.orgWide);
  const ov = useAtsOverview(cc.period, cc.branch, !cc.scoped);
  const dwell = useStageDwell(base);
  const all = useDrill(base);
  const ns = useDrill({ ...base, outcome: "noShow" });
  const [mode, setMode] = useState<QueueMode | "branch">("all");
  const [qBranch, setQBranch] = useState("");
  const [limit, setLimit] = useState(15);
  const [split, setSplit] = useState<SplitTab>("source");

  const go = (crumb: string, extra: Record<string, unknown> = {}, live = false) =>
    act.openDrill(crumb, live ? { branch: cc.branch || undefined, from: today(), ...extra } : { ...base, ...extra });
  const goIdle = (crumb: string, extra: Record<string, unknown>) => act.openDrill(crumb, { branch: cc.branch || undefined, ...extra });

  const d = ops.data;
  const blocked = cc.scoped || (cc.scopeKnown && !cc.orgWide) || errStatus(ops.error) === 403;
  const sla = d?.slaMinutes ?? 20;
  const branchNames = useMemo(() => (d?.branches ?? []).map((b) => b.name).filter((n) => n && n !== "Unspecified"), [d]);
  const br = d && cc.branch ? d.branches.find((b) => b.name === cc.branch) : undefined;
  const scoped: AtsOperations | undefined = useMemo(() => d && (cc.branch ? { ...d, queue: d.queue.filter((r) => r.branch === cc.branch), roster: d.roster.filter((r) => r.branch === cc.branch), today: { ...d.today, arrived: br?.arrived ?? 0, waiting: br?.waiting ?? 0, breach: br?.breach ?? 0, selected: br?.selected ?? 0 } } : d), [d, cc.branch, br]);

  const slotPeak = useMemo(() => { const t = slotTotals((all.data?.hourDow ?? []).map((c) => ({ ...c }))).sort((a, b) => b.total - a.total)[0]; return t && t.total > 0 ? t.label : undefined; }, [all.data]);
  const findings = useMemo(() => (scoped ? buildLiveFindings(scoped, { peakSlot: slotPeak }) : []), [scoped, slotPeak]);
  const groups = useMemo(() => (scoped ? groupBreaches(scoped.queue, sla) : null), [scoped, sla]);
  const weekdays = useMemo(() => (d ? weekdayBreaches(d.sla.daily) : []), [d]);

  const nsDow = useMemo(() => rateByKey((all.data?.weekday ?? []).map((w) => ({ key: w.dow, n: w.total })), (ns.data?.weekday ?? []).map((w) => ({ key: w.dow, n: w.total })), 5), [all.data, ns.data]);
  const nsSlot = useMemo(() => {
    const a = slotTotals(all.data?.hourDow ?? []), n = slotTotals(ns.data?.hourDow ?? []);
    return a.filter((s) => s.total >= 5).map((s) => ({ ...s, rate: Math.round((n[SLOTS.findIndex((x) => x.label === s.label)].total / s.total) * 1000) / 10 }));
  }, [all.data, ns.data]);
  const splitRows = useMemo(() => (all.data?.splits[split] ?? []).filter((r) => r.name && r.total >= 3).map((r) => ({ ...r, nsr: r.noShowRate ?? (r.total ? Math.round(((r.noShow ?? 0) / r.total) * 1000) / 10 : 0), jr: r.joinRate ?? 0 })), [all.data, split]);

  if (ops.isLoading && !d) return <div className="space-y-4"><Skeleton className="h-14 rounded-2xl" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div><Skeleton className="h-96 rounded-2xl" /></div>;

  const queue = scoped ? filterQueue(scoped.queue, mode === "all" ? "all" : "breached", sla, qBranch) : [];
  const nowH = istHour(new Date().toISOString());
  const yToNow = (d?.hourly ?? []).filter((h) => h.hour <= nowH).reduce((s, h) => s + h.yesterday, 0);
  const arrived = scoped?.today.arrived ?? 0;
  const pace = yToNow >= 5 ? Math.round(((arrived - yToNow) / yToNow) * 100) : null;
  const longest = scoped && scoped.queue.length ? [...scoped.queue].sort((a, b) => b.waitMin - a.waitMin)[0] : undefined;
  const recov = d ? d.recoverable.noShow30 + d.recoverable.hold30 : 0;
  const total = scoped?.today.waiting ?? 0;
  const hourly = (d?.hourly ?? []).filter((h) => h.hour >= 6 && h.hour <= 22);
  const cap = scoped ? capacityByBranch(scoped.roster).map((c) => ({ ...c, name: c.branch, waiting: d?.branches.find((b) => b.name === c.branch)?.waiting ?? 0 })) : [];
  const breachBranch = [...(d?.branches ?? [])].filter((b) => b.breach > 0).sort((a, b) => b.breach - a.breach);
  const exportQueue = () => downloadCsv("ats-live-queue.csv", ["Wait (min)", "Token", "Candidate", "Branch", "Recruiter", "Stage", "Process", "Arrival"], queue.map((r) => [r.waitMin, r.token, r.name, r.branch, r.recruiter, r.stage, r.process, r.arrival]));

  return (
    <div className="space-y-5">
      <FilterBar show={cc.scoped ? ["period"] : ["period", "branch"]} branches={branchNames.length ? branchNames : (ov.data?.branches ?? []).map((b) => b.name).filter((n) => n !== "Unspecified" && n !== "Unmapped")}
        right={<><span className="hidden text-[11px] text-muted-foreground md:inline">Period applies to the analysis sections; the live board is always today.</span><LiveBadge at={ops.dataUpdatedAt || undefined} /></>} />

      {blocked ? (
        <Card i={0} title="Live queue is limited to organisation-wide roles" icon={<Siren className="h-4 w-4" />}>
          <p className="text-sm text-muted-foreground">The live queue, SLA board and recruiter capacity cover every branch, so they are only shown to roles that see the whole organisation. Your role is limited to its own branch. The analysis sections below still work for your scope.</p>
        </Card>
      ) : ops.isError && !d ? (
        <Card i={0} title="Live queue could not load" icon={<AlertTriangle className="h-4 w-4" />} right={<button onClick={() => ops.refetch()} className="cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Retry</button>}>
          <p role="alert" className="text-sm text-muted-foreground">{errText(ops.error)}</p>
        </Card>
      ) : scoped && d && (
        <>
          {ops.isError && <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">Live refresh failed ({errText(ops.error)}). Showing the last loaded snapshot.</div>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard i={0} label="Waiting now" value={total} icon={<Hourglass className="h-4 w-4" />} color={V.blue} sub={`${scoped.today.arrived} arrived today`} onClick={() => go("Waiting today", { outcome: "waiting" }, true)} />
            <KpiCard i={1} label="SLA breaches" value={scoped.today.breach} icon={<Siren className="h-4 w-4" />} color={V.red} sub={`past ${sla} minutes`} onClick={() => { setMode("breached"); document.getElementById("live-board")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />
            <KpiCard i={2} label="Longest wait" value={longest?.waitMin ?? 0} suffix=" min" icon={<Clock className="h-4 w-4" />} color={V.orange} sub={longest ? `${longest.name} · ${longest.branch}` : "queue is clear"} onClick={longest ? () => act.openCandidate(longest.id) : undefined} />
            <KpiCard i={3} label="Arrived today" value={arrived} delta={pace} icon={<TrendingUp className="h-4 w-4" />} color={V.aqua} sub={pace == null ? "too early to compare" : `${yToNow} by this hour yesterday`} onClick={() => go("Arrived today", {}, true)} />
            <KpiCard i={4} label="Recoverable pool" value={recov} icon={<LifeBuoy className="h-4 w-4" />} color={V.violet} sub={`${d.recoverable.noShow30} no-show · ${d.recoverable.hold30} on hold (30 d)`} onClick={() => go("Recoverable (30 days)", { outcome: "noShow", from: daysAgo(30) }, true)} />
          </div>

          <div id="live-board" className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-8" i={5} title="Live SLA board" icon={<Siren className="h-4 w-4" />} hint={`Longest wait first; red is past twice the ${sla}-minute SLA`}
              right={<ExportButton onClick={exportQueue} />}>
              <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Queue filter">
                <button className={chip(mode === "all")} aria-pressed={mode === "all"} onClick={() => { setMode("all"); setQBranch(""); }}>All {scoped.queue.length}</button>
                <button className={chip(mode === "breached")} aria-pressed={mode === "breached"} onClick={() => setMode("breached")}>Breached {groups?.total ?? 0}</button>
                <button className={chip(mode === "branch")} aria-pressed={mode === "branch"} onClick={() => setMode("branch")}>By branch</button>
                {mode === "branch" && [...new Set(scoped.queue.map((r) => r.branch))].map((b) => <button key={b} className={chip(qBranch === b)} aria-pressed={qBranch === b} onClick={() => setQBranch(qBranch === b ? "" : b)}>{b}</button>)}
              </div>
              {queue.length ? (
                <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[620px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Wait</th><th className="px-2 py-2 font-medium">Token</th><th className="px-2 py-2 font-medium">Candidate</th><th className="px-2 py-2 font-medium">Branch</th><th className="px-2 py-2 font-medium">Recruiter</th><th className="px-2 py-2 font-medium">Stage</th></tr></thead>
                  <tbody>{queue.slice(0, limit).map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-1.5"><span className={`cc-num inline-block min-w-[4.5rem] rounded-full px-2 py-0.5 text-center text-xs font-semibold ${TONE_CLS[waitTone(r.waitMin, sla)]}`}>{fmtWait(r.waitMin)}</span></td>
                      <td className="cc-num px-2 py-1.5 text-xs">{r.token ?? "–"}</td>
                      <td className="max-w-[12rem] px-2 py-1.5"><button onClick={() => act.openCandidate(r.id)} className="cursor-pointer truncate text-left font-medium hover:text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{r.name}</button></td>
                      <td className="px-2 py-1.5 text-xs">{r.branch}</td><td className="px-2 py-1.5 text-xs">{r.recruiter || "Unassigned"}</td><td className="px-2 py-1.5 text-xs">{r.stage}</td>
                    </tr>))}</tbody></table></div>
              ) : <Empty text={mode === "all" ? "Nobody is waiting" : "No breaches in this view"} />}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>Showing {Math.min(limit, queue.length)} of {queue.length} listed{!cc.branch && total > scoped.queue.length ? `. The server caps the queue at ${scoped.queue.length} of ${total} waiting; open the KPI drill for everyone.` : ""}</span>
                {queue.length > limit && <button onClick={() => setLimit(limit + 20)} className="cursor-pointer rounded-lg px-2 py-1 font-medium text-primary hover:bg-primary/10">Show more</button>}
              </div>
            </Card>
            <Card className="lg:col-span-4" i={6} title="What needs attention now" hint="Click a finding to drill" icon={<Lightbulb className="h-4 w-4" />}>
              <InsightList items={findings.map((f) => ({ tone: f.tone, title: f.title, body: f.body, onClick: f.drill ? () => go(f.drill!.crumb, f.drill!.extra, f.drill!.live) : undefined }))} />
              <div className="mt-3 border-t pt-3"><div className="mb-1.5 text-xs font-medium text-muted-foreground">Wait time spread</div>
                <BarRows rows={d.waitBuckets.map((b) => ({ label: b.label, value: b.n }))} color={V.blue} /></div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-7" i={7} title="Arrivals by hour" hint="Today against yesterday; click a bar to drill into that hour (all branches)" icon={<Workflow className="h-4 w-4" />}>
              {hourly.length ? (
                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart data={hourly} margin={{ left: -8, right: 8 }}>
                    <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="hour" tick={tick} axisLine={false} tickLine={false} tickFormatter={(h) => `${h}:00`} /><YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} labelFormatter={(h) => `${h}:00`} /><Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="today" name="Today" fill={V.blue} radius={[6, 6, 0, 0]} className="cursor-pointer" onClick={(p: { hour?: number }) => p.hour != null && go(`Arrivals at ${p.hour}:00`, { hour: p.hour }, true)} />
                    <Line dataKey="yesterday" name="Yesterday" stroke={V.violet} strokeWidth={2} strokeDasharray="4 3" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : <Empty text="No arrivals yet today" />}
            </Card>
            <Card className="lg:col-span-5" i={8} title="Recruiter capacity by branch" hint="Assigned against capacity; click a branch to drill" icon={<Users className="h-4 w-4" />}
              right={<ExportButton onClick={() => downloadCsv("ats-capacity.csv", ["Branch", "Recruiters", "Available", "Capacity", "Assigned", "Utilisation %", "Waiting"], cap.map((c) => [c.name, c.recruiters, c.available, c.capacity, c.assigned, c.util, c.waiting]))} />}>
              <HeatTable rows={cap} max={14}
                cols={[{ key: "r", label: "Recruiters", get: (r) => r.recruiters }, { key: "a", label: "Free", get: (r) => r.available, hue: "green" }, { key: "c", label: "Assigned / cap", get: (r) => r.util, format: (n) => `${n}%`, invert: true, hue: "red" }, { key: "w", label: "Waiting", get: (r) => r.waiting, invert: true, hue: "red" }]}
                onRow={(r) => go(r.name, { branch: r.name, outcome: "waiting" }, true)} onCell={(r) => go(r.name, { branch: r.name, outcome: "waiting" }, true)} />
            </Card>
          </div>

          <Section title="SLA breach root cause" hint="Live breaches by arrival hour, branch and recruiter; weekday from the logged SLA events">
            <div className="grid gap-4 lg:grid-cols-12">
              <Card className="lg:col-span-4" i={9} title="By arrival hour" icon={<TimerReset className="h-4 w-4" />}>
                {groups?.byHour.length ? (
                  <ResponsiveContainer width="100%" height={190}><BarChart data={groups.byHour} margin={{ left: -20, right: 6 }}>
                    <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} /><XAxis dataKey="hour" tick={tick} axisLine={false} tickLine={false} tickFormatter={(h) => `${h}h`} /><YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} labelFormatter={(h) => `Arrived ${h}:00`} formatter={(v: number) => [v, "Breached"]} />
                    <Bar dataKey="n" fill={V.red} radius={[5, 5, 0, 0]} className="cursor-pointer" onClick={(p: { hour?: number }) => p.hour != null && go(`Waiting, arrived ${p.hour}:00`, { hour: p.hour, outcome: "waiting" }, true)} />
                  </BarChart></ResponsiveContainer>
                ) : <Empty text="No live breaches" />}
              </Card>
              <Card className="lg:col-span-3" i={10} title="By branch">
                <BarRows rows={(cc.branch ? (groups?.byBranch ?? []) : breachBranch.map((b) => ({ name: b.name, n: b.breach }))).slice(0, 6).map((b) => ({ label: b.name, value: b.n }))} color={V.red}
                  onSelect={(b) => go(b, { branch: b, outcome: "waiting" }, true)} />
              </Card>
              <Card className="lg:col-span-3" i={11} title="By recruiter">
                <BarRows rows={(groups?.byRecruiter ?? []).slice(0, 6).map((b) => ({ label: b.name, value: b.n }))} color={V.orange} onSelect={(b) => go(b, { recruiter: b, outcome: "waiting" }, true)} />
              </Card>
              <Card className="lg:col-span-2" i={12} title="By weekday" hint="Events a day">
                {weekdays.some((w) => w.events) ? <BarRows rows={weekdays.filter((w) => w.days).map((w) => ({ label: w.label, value: w.perDay }))} color={V.violet} format={(n) => String(n)} /> : <Empty text="No history" />}
              </Card>
            </div>
          </Section>
        </>
      )}

      <Section title="No-show and walk-out drivers" hint="Rates for the selected period; every row and cell drills">
        <div className="grid gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-7" i={13} title="No-show rate by driver" icon={<UserX className="h-4 w-4" />}
            right={<div className="flex gap-1" role="group" aria-label="Driver">{SPLIT_TABS.map(([k, l]) => <button key={k} className={chip(split === k)} aria-pressed={split === k} onClick={() => setSplit(k)}>{l}</button>)}</div>}>
            {all.isLoading ? <Skeleton className="h-60" /> : splitRows.length ? (
              <HeatTable rows={splitRows} max={12}
                cols={[{ key: "t", label: "Candidates", get: (r) => r.total }, { key: "n", label: "No-show %", get: (r) => r.nsr, format: (n) => `${n}%`, invert: true, hue: "red" }, { key: "s", label: "Selected %", get: (r) => r.selRate, format: (n) => `${n}%`, hue: "green" }, { key: "j", label: "Joined %", get: (r) => r.jr, format: (n) => `${n}%`, hue: "green" }]}
                onRow={(r) => go(r.name, { [split]: r.name })} onCell={(r, c) => go(r.name, { [split]: r.name, ...(c.key === "n" ? { outcome: "noShow" } : c.key === "s" ? { outcome: "selected" } : c.key === "j" ? { outcome: "joined" } : {}) })} />
            ) : <Empty text="No data in this window" />}
          </Card>
          <Card className="lg:col-span-5" i={14} title="Highest no-show rates" hint={`Ranked ${split}s with at least 10 candidates`} icon={<UserCheck className="h-4 w-4" />}>
            <BarRows rows={splitRows.filter((r) => r.total >= 10).sort((a, b) => b.nsr - a.nsr).slice(0, 7).map((r) => ({ label: r.name, value: r.nsr, sub: `of ${fmt(r.total)}` }))} format={(n) => `${n}%`} max={100} color={V.red} onSelect={(n) => go(n, { [split]: n, outcome: "noShow" })} />
            <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2">
              <div><div className="mb-1.5 text-xs font-medium text-muted-foreground">By weekday</div>
                <BarRows rows={nsDow.map((r) => ({ label: DOW_SHORT[r.key - 1], value: r.rate }))} format={(n) => `${n}%`} max={Math.max(20, ...nsDow.map((r) => r.rate))} color={V.orange} onSelect={(l) => go(l, { dow: DOW_SHORT.indexOf(l) + 1, outcome: "noShow" })} /></div>
              <div><div className="mb-1.5 text-xs font-medium text-muted-foreground">By arrival slot</div>
                <BarRows rows={nsSlot.map((r) => ({ label: r.label, value: r.rate }))} format={(n) => `${n}%`} max={Math.max(20, ...nsSlot.map((r) => r.rate))} color={V.orange} /></div>
            </div>
          </Card>
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7" i={15} title="Stage dwell and bottlenecks" hint="Hours in each stage; stuck means longer than 72 hours" icon={<Clock className="h-4 w-4" />}>
          {dwell.isLoading ? <Skeleton className="h-52" /> : dwell.data?.stages.length ? (
            <HeatTable rows={dwell.data.stages.map((s) => ({ ...s, name: s.stage === dwell.data!.bottleneck ? `${humanizeStage(s.stage)} (bottleneck)` : humanizeStage(s.stage), key: s.stage }))} max={10}
              cols={[{ key: "n", label: "Candidates", get: (r) => r.n }, { key: "m", label: "Median h", get: (r) => r.medianHours, invert: true, hue: "red" }, { key: "p", label: "P90 h", get: (r) => r.p90Hours, invert: true, hue: "red" }, { key: "s", label: "Stuck over 72 h", get: (r) => r.stuckOver72h, invert: true, hue: "red" }]}
              onRow={(r) => go(`In ${r.stage}`, { stage: r.stage })} onCell={(r) => go(`In ${r.stage}`, { stage: r.stage })} />
          ) : <Empty text="No stage history in this window" />}
        </Card>
        <Card className="lg:col-span-5" i={16} title="Pipeline aging" hint="Open candidates by days since last movement; click a bar" icon={<TimerReset className="h-4 w-4" />}>
          {cc.scoped ? <Empty text="Pipeline aging is shown to head-office roles" /> : ov.isLoading ? <Skeleton className="h-52" /> : ov.data?.aging.length ? (
            <ResponsiveContainer width="100%" height={220}><BarChart data={AGING.map((b) => ({ bucket: b, n: ov.data!.aging.find((a) => a.bucket === b)?.n ?? 0 }))} margin={{ left: -12, right: 8 }}>
              <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} /><XAxis dataKey="bucket" tick={tick} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} formatter={(v: number) => [fmt(v), "Open candidates"]} />
              <Bar dataKey="n" radius={[6, 6, 0, 0]} className="cursor-pointer" onClick={(p: { bucket?: string }) => p.bucket && goIdle(`Idle ${p.bucket}`, { idle: p.bucket })}>
                {AGING.map((b, i) => <Cell key={b} fill={[V.aqua, V.blue, V.yellow, V.orange, V.red][i]} />)}
              </Bar>
            </BarChart></ResponsiveContainer>
          ) : <Empty text="Nothing open" />}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5" i={17} title="Arrival load" hint="Day by hour for the period; click a cell" icon={<Grid3x3 className="h-4 w-4" />}>
          {all.isLoading ? <Skeleton className="h-52" /> : all.data?.hourDow?.length ? (
            <>
              <Heatmap data={all.data.hourDow.map((c) => ({ dow: c.dow, hour: c.hour, n: c.total }))} onSelect={(dow, hour) => go(`${DOW_SHORT[dow - 1]} ${hour}:00`, { dow, hour })} />
              <p className="mt-2 text-xs text-muted-foreground">Top slots: {peakCells(all.data.hourDow, 3).map((c) => `${DOW_SHORT[c.dow - 1]} ${c.hour}:00 (${c.total})`).join(", ")}</p>
            </>
          ) : <Empty text="No arrival grid for this slice" />}
        </Card>
        <Card className="lg:col-span-7" i={18} title="Recoverable candidates" hint="No-show or on hold in the last 30 days; click to open the journey" icon={<LifeBuoy className="h-4 w-4" />}
          right={d && <ExportButton onClick={() => downloadCsv("ats-recoverable.csv", ["Name", "Mobile", "Status", "Stage", "Process", "Date"], d.recoverable.list.map((r) => [r.name, r.mobile, r.status, r.stage, r.process, r.at]))} />}>
          {!d ? <Empty text={blocked ? "Limited to organisation-wide roles" : "Not loaded"} /> : d.recoverable.list.length ? (
            <>
              <div className="max-h-80 overflow-auto rounded-xl border"><table className="w-full min-w-[480px] text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Candidate</th><th className="px-2 py-2 font-medium">Status</th><th className="px-2 py-2 font-medium">Stage</th><th className="px-2 py-2 font-medium">Process</th><th className="px-2 py-2 font-medium">Date</th></tr></thead>
                <tbody>{d.recoverable.list.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-1.5"><button onClick={() => act.openCandidate(r.id)} className="cursor-pointer text-left font-medium hover:text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{r.name}</button><div className="cc-num text-[11px] text-muted-foreground">{r.mobile}</div></td>
                    <td className="px-2 py-1.5 text-xs">{r.status}</td><td className="px-2 py-1.5 text-xs">{r.stage}</td><td className="px-2 py-1.5 text-xs">{r.process ?? "–"}</td><td className="cc-num px-2 py-1.5 text-xs">{String(r.at).slice(0, 10)}</td>
                  </tr>))}</tbody></table></div>
              <p className="mt-2 text-xs text-muted-foreground">Showing {d.recoverable.list.length} of {fmt(recov)} in the pool.</p>
            </>
          ) : <Empty text="Nobody to recover" />}
        </Card>
      </div>

      <BranchActivity go={go} />
    </div>
  );
}
