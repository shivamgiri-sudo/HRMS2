import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, FileText, Gauge as GaugeIcon, History, Loader2, Lock, RefreshCcw, Search, ShieldCheck, Target, Wrench, X, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi, getHrmsApiErrorStatus } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { usePipeline, type PipelineRow } from "@/hooks/useAtsDashboards";
import { useAtsOverview } from "@/hooks/useAtsOverview";
import { useDrillActions } from "@/components/ats/overview/drill";
import { StatusPill, waited } from "@/components/ats/overview/journey";
import { Empty, V, fmt } from "@/components/ats/overview/viz";
import { BMIBenchmarkTab } from "@/components/ats/command-center/BMIBenchmarkTab";
import { Card, ExportButton, FilterBar, InsightList, KpiCard, Section, downloadCsv, type InsightItem } from "./cc-kit";
import { useCC } from "./cc-context";
import { checkLabel, drillsForCheck, groupChecks, healthScore, isForbidden, loadRecent, pushRecent, saveRecent, scoreTone, type HealthCheck, type RecentCandidate } from "./controls-helpers";

type View = "finder" | "health" | "bmi";
const VIEWS: { id: View; label: string; icon: ReactNode }[] = [
  { id: "finder", label: "Finder", icon: <Search className="h-4 w-4" /> },
  { id: "health", label: "System health", icon: <ShieldCheck className="h-4 w-4" /> },
  { id: "bmi", label: "Benchmarks", icon: <Target className="h-4 w-4" /> },
];
const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
const TONE_CLS = { good: "text-emerald-600 dark:text-emerald-300", warn: "text-amber-600 dark:text-amber-300", bad: "text-red-600 dark:text-red-300", none: "text-muted-foreground" };
const TONE_COLOR = { good: V.aqua, warn: V.yellow, bad: V.red, none: V.blue };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} aria-pressed={active} className={`min-h-[30px] cursor-pointer rounded-full border px-2.5 text-xs font-medium transition-colors duration-200 ${focus} ${active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{children}</button>;
}

/* ───────────── Finder ───────────── */
function Finder() {
  const cc = useCC();
  const drill = useDrillActions();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [stage, setStage] = useState("");
  const [page, setPage] = useState(1);
  const [recent, setRecent] = useState<RecentCandidate[]>(() => loadRecent());
  const search = useDebounced(q.trim(), 350);
  useEffect(() => setPage(1), [search, status, stage, cc.branch]);
  const pipe = usePipeline({ from: "", to: "", branch: cc.branch, process: "", status, stage, search, includeLeads: false, page });
  const ov = useAtsOverview("30d", "", !cc.scoped);
  const branches = useMemo(() => (ov.data?.branches ?? []).map((b) => b.name).filter((n) => n !== "Unmapped"), [ov.data]);
  const d = pipe.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.limit)) : 1;

  const open = useCallback((r: PipelineRow) => {
    setRecent((cur) => { const next = pushRecent(cur, { id: r.id, name: r.full_name, code: r.candidate_code, status: r.status }); saveRecent(next); return next; });
    drill.openCandidate(r.id);
  }, [drill]);
  const clearRecent = () => { setRecent([]); saveRecent([]); };
  const filtered = !!(search || status || stage || cc.branch);

  return (
    <div className="space-y-4">
      <FilterBar show={cc.scoped ? [] : ["branch"]} branches={branches} right={d && <ExportButton label="Export page" onClick={() => downloadCsv("ats-finder.csv", ["Code", "Name", "Mobile", "Email", "Status", "Stage", "Branch", "Process", "Recruiter"], d.rows.map((r) => [r.candidate_code, r.full_name, r.mobile, r.email, r.status, r.stage, r.branch, r.process, r.recruiter]))} />} />

      <Card title="Find a candidate" hint="Search by ID, name, mobile, email or queue token" icon={<Search className="h-4 w-4" />} i={0}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} type="search" inputMode="search" autoComplete="off" aria-label="Search candidates" placeholder="Start typing, e.g. a name, 98xxxxxxxx or token"
            className={`h-11 w-full rounded-xl border bg-background pl-10 pr-10 text-sm ${focus}`} />
          {q && <button onClick={() => setQ("")} aria-label="Clear search" className={`absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted ${focus}`}><X className="h-4 w-4" /></button>}
        </div>
        {d && (d.statuses.length > 0 || d.stages.length > 0) && (
          <div className="mt-3 space-y-2">
            {d.statuses.length > 0 && <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status"><span className="w-12 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Status</span>
              {d.statuses.slice(0, 8).map((s) => <Chip key={s.name} active={status === s.name} onClick={() => setStatus(status === s.name ? "" : s.name)}>{s.name} <span className="cc-num opacity-70">{fmt(s.n)}</span></Chip>)}</div>}
            {d.stages.length > 0 && <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by stage"><span className="w-12 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Stage</span>
              {d.stages.slice(0, 10).map((s) => <Chip key={s.name} active={stage === s.name} onClick={() => setStage(stage === s.name ? "" : s.name)}>{s.name} <span className="cc-num opacity-70">{fmt(s.n)}</span></Chip>)}</div>}
          </div>
        )}
      </Card>

      {recent.length > 0 && (
        <Card title="Recently viewed" hint="On this device" icon={<History className="h-4 w-4" />} i={1} right={<button onClick={clearRecent} className={`cursor-pointer rounded-lg px-2 py-1 text-xs text-primary hover:bg-primary/10 ${focus}`}>Clear</button>}>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {recent.map((r) => (
              <li key={r.id} className="shrink-0">
                <button onClick={() => drill.openCandidate(r.id)} className={`flex cursor-pointer flex-col items-start rounded-xl border bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted ${focus}`}>
                  <span className="max-w-[12rem] truncate text-sm font-medium">{r.name}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">{r.code}{r.status && <StatusPill status={r.status} />}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card i={2} title={filtered ? "Matches" : "Latest candidates"} hint={d ? `${fmt(d.total)} found${d.total > d.rows.length ? `, showing ${(d.page - 1) * d.limit + 1}-${(d.page - 1) * d.limit + d.rows.length}` : ""}` : undefined} icon={<GaugeIcon className="h-4 w-4" />}>
        {pipe.isLoading ? <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
          : pipe.isError ? <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm"><AlertTriangle className="h-4 w-4 shrink-0 text-red-500" aria-hidden />Could not load candidates.<button onClick={() => void pipe.refetch()} className={`ml-auto cursor-pointer rounded-lg px-2 py-1 font-medium text-primary hover:bg-primary/10 ${focus}`}>Retry</button></div>
          : !d?.rows.length ? <Empty text={filtered ? "No candidate matches. Try fewer characters or clear a filter." : "No candidates yet"} />
          : (
            <>
              <ul className={`divide-y ${pipe.isFetching ? "opacity-70" : ""}`} aria-busy={pipe.isFetching}>
                {d.rows.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => open(r)} className={`flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/60 ${focus}`}>
                      <span className="min-w-0 flex-1 basis-48"><span className="block truncate text-sm font-medium">{r.full_name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{r.candidate_code}{r.q_token ? ` · token ${r.q_token}` : ""} · {r.mobile}{r.email ? ` · ${r.email}` : ""}</span></span>
                      <span className="flex flex-wrap items-center gap-2"><StatusPill status={r.status} /><span className="text-xs text-muted-foreground">{r.stage}</span></span>
                      <span className="hidden w-40 truncate text-right text-xs text-muted-foreground md:block">{r.branch}{r.process ? ` · ${r.process}` : ""}</span>
                      <span className="hidden w-14 text-right text-[11px] text-muted-foreground sm:block" title="Last update"><Clock className="mr-1 inline h-3 w-3" aria-hidden />{waited(r.updated_at)}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              {pages > 1 && (
                <nav className="mt-3 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground" aria-label="Pagination">
                  <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={`inline-flex min-h-[34px] cursor-pointer items-center gap-1 rounded-lg border px-3 font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 ${focus}`}><ChevronLeft className="h-3.5 w-3.5" />Previous</button>
                  <span>Page {page} of {fmt(pages)}</span>
                  <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className={`inline-flex min-h-[34px] cursor-pointer items-center gap-1 rounded-lg border px-3 font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 ${focus}`}>Next<ChevronRight className="h-3.5 w-3.5" /></button>
                </nav>
              )}
            </>
          )}
        <p className="mt-3 text-[11px] text-muted-foreground">Candidate and handling quality scores are not shown: the only source is the full journey payload, which is too heavy to load for every match.</p>
      </Card>
    </div>
  );
}

/* ───────────── System health ───────────── */
interface HealthRes { ok?: boolean; checks?: HealthCheck[] }
type Job = "sla" | "repair";

function ScoreRing({ score }: { score: number | null }) {
  const tone = scoreTone(score), r = 52, c = 2 * Math.PI * r;
  return (
    <div className="relative h-36 w-36 shrink-0" role="img" aria-label={score == null ? "No health score" : `Health score ${score} percent`}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--v-track)" strokeWidth="11" />
        {score != null && <circle cx="60" cy="60" r={r} fill="none" stroke={TONE_COLOR[tone]} strokeWidth="11" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} style={{ transition: "stroke-dashoffset .8s cubic-bezier(.3,.9,.3,1)" }} />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className={`cc-num text-3xl font-semibold ${TONE_CLS[tone]}`}>{score == null ? "-" : `${score}%`}</span><span className="text-[11px] text-muted-foreground">health score</span></div>
    </div>
  );
}

function Health() {
  const qc = useQueryClient();
  const drill = useDrillActions();
  const { hasAnyRole } = useWorkforceAccess();
  const canRun = hasAnyRole("admin", "hr");
  const [confirmRepair, setConfirmRepair] = useState(false);
  const [running, setRunning] = useState<Job | "report" | null>(null);
  // The health endpoint runs ~40 database checks and takes a minute or more on production, so it starts on request, not on tab open.
  const [started, setStarted] = useState(false);

  const health = useQuery({
    queryKey: ["ats-cc-health"], enabled: started, retry: false, staleTime: 5 * 60_000, refetchOnWindowFocus: false,
    queryFn: async () => (await hrmsApi.get<{ data: HealthRes }>("/api/ats-full-parity/health")).data,
  });
  const run = useMutation({
    mutationFn: async (job: Job) => { job === "sla" ? await hrmsApi.post("/api/ats-full-parity/jobs/sla-check", {}) : await hrmsApi.post("/api/ats-full-parity/jobs/repair", { limit: 500 }); },
  });
  const doJob = async (job: Job) => {
    const label = job === "sla" ? "SLA check" : "Data repair";
    setRunning(job); setConfirmRepair(false);
    try { await run.mutateAsync(job); toast.success(`${label} completed successfully.`); await qc.invalidateQueries({ queryKey: ["ats-cc-health"] }); }
    catch (e) { toast.error((e as { message?: string })?.message || `${label} failed.`); }
    finally { setRunning(null); }
  };
  const preview = async () => {
    setRunning("report");
    try { await hrmsApi.get("/api/ats-full-parity/daily-report/snapshot?mode=preview"); toast.success("Daily report preview snapshot generated in ATS report log."); }
    catch (e) { toast.error((e as { message?: string })?.message || "Daily report preview failed."); }
    finally { setRunning(null); }
  };

  const checks = health.data?.checks ?? [];
  const groups = useMemo(() => groupChecks(checks), [checks]);
  const score = healthScore(checks), tone = scoreTone(score);
  const failed = checks.filter((c) => !c.ok);
  const jobBtn = "inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-xl border bg-card px-3 text-sm font-semibold transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 " + focus;

  if (!started) {
    return (
      <Card i={0}>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary" aria-hidden><ShieldCheck className="h-5 w-5" /></span>
          <h3 className="text-sm font-semibold">Check data and delivery health</h3>
          <p className="max-w-md text-xs text-muted-foreground">Runs about 40 checks across candidate records, SLA, email delivery and required tables. It takes a minute or two, so it only starts when you ask.</p>
          <button onClick={() => setStarted(true)} className={`${jobBtn} mt-1`}><ShieldCheck className="h-3.5 w-3.5" />Run health checks</button>
        </div>
      </Card>
    );
  }

  if (health.isError) {
    const err = health.error, forbidden = isForbidden(getHrmsApiErrorStatus(err), (err as Error)?.message);
    return (
      <Card i={0}>
        <div role={forbidden ? "status" : "alert"} className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground" aria-hidden>{forbidden ? <Lock className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5 text-red-500" />}</span>
          <h3 className="text-sm font-semibold">{forbidden ? "System health is not available for your role" : "Health checks could not run"}</h3>
          <p className="max-w-md text-xs text-muted-foreground">{forbidden ? "These checks are limited to admin, HR and CEO roles. Candidate search and benchmarks are still available." : `${(err as Error)?.message || "Unknown error"}. A failed run is not a passing system; treat the status as unknown.`}</p>
          {!forbidden && <button onClick={() => void health.refetch()} className={`${jobBtn} mt-1`}><RefreshCcw className="h-3.5 w-3.5" />Try again</button>}
        </div>
      </Card>
    );
  }

  const issues: InsightItem[] = failed.slice(0, 6).map((c) => ({ tone: "bad" as const, title: checkLabel(c.name), body: c.detail }));

  return (
    <div className="space-y-4">
      <div className="cc-card flex flex-wrap items-center gap-2 p-2.5">
        <button onClick={() => void health.refetch()} disabled={health.isFetching} className={jobBtn}><RefreshCcw className={`h-3.5 w-3.5 ${health.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} />{health.isFetching ? "Running" : "Re-run checks"}</button>
        {canRun && (
          <>
            <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
            <button onClick={() => void doJob("sla")} disabled={running !== null} className={jobBtn}>{running === "sla" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}Run SLA check</button>
            {!confirmRepair ? <button onClick={() => setConfirmRepair(true)} disabled={running !== null} className={jobBtn}>{running === "repair" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}Repair data</button> : (
              <span role="alertdialog" aria-label="Confirm data repair" className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1">
                <span className="text-xs font-medium">Repair up to 500 records?</span>
                <button autoFocus onClick={() => void doJob("repair")} className={`min-h-[32px] cursor-pointer rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground ${focus}`}>Yes, repair</button>
                <button onClick={() => setConfirmRepair(false)} className={`min-h-[32px] cursor-pointer rounded-lg px-2 text-xs font-medium hover:bg-muted ${focus}`}>Cancel</button>
              </span>
            )}
          </>
        )}
        <button onClick={() => void preview()} disabled={running !== null} className={jobBtn}>{running === "report" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}Preview daily report</button>
        {checks.length > 0 && <span className="ml-auto"><ExportButton onClick={() => downloadCsv("ats-health.csv", ["Category", "Check", "Status", "Count", "Detail"], checks.map((c) => [c.type ?? "", c.name ?? "", c.ok ? "pass" : "fail", c.count ?? "", c.detail ?? ""]))} /></span>}
      </div>

      {health.isLoading ? (
        <div className="space-y-4" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Running the checks. This usually takes a minute or two.</p>
          <Skeleton className="h-48 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-7" i={0} title="Overall health" hint="Passing checks as a share of all checks run" icon={<Activity className="h-4 w-4" />}>
              {checks.length === 0 ? <Empty text="The endpoint returned no checks. That is not the same as everything passing." /> : (
                <div className="flex flex-wrap items-center gap-6">
                  <ScoreRing score={score} />
                  <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3">
                    <KpiCard i={0} label="Checks run" value={checks.length} icon={<ShieldCheck className="h-4 w-4" />} color={V.blue} />
                    <KpiCard i={1} label="Passed" value={checks.length - failed.length} icon={<CheckCircle2 className="h-4 w-4" />} color={V.aqua} />
                    <KpiCard i={2} label="Failed" value={failed.length} icon={<AlertTriangle className="h-4 w-4" />} color={failed.length ? V.red : V.aqua} sub={failed.length ? "need attention" : "all clear"} />
                  </div>
                </div>
              )}
            </Card>
            <Card className="lg:col-span-5" i={1} title="Needs attention" hint={failed.length ? `${failed.length} failing${tone === "bad" ? "" : ""}` : undefined} icon={<AlertTriangle className="h-4 w-4" />}>
              <InsightList items={issues} empty="Every check is passing" />
              {failed.length > issues.length && <p className="mt-2 text-xs text-muted-foreground">and {failed.length - issues.length} more below</p>}
            </Card>
          </div>

          {groups.map((g, gi) => (
            <Section key={g.key} title={g.title} hint={`${g.items.length - g.failed} of ${g.items.length} passing. ${g.hint}`}>
              <Card i={gi + 2}>
                <ul className="grid gap-2 md:grid-cols-2">
                  {g.items.map((c, i) => {
                    const drills = drillsForCheck(c);
                    return (
                      <li key={`${c.name}-${i}`} className={`flex items-start gap-2.5 rounded-xl border border-l-4 bg-muted/30 p-2.5 ${c.ok ? "border-l-emerald-500" : "border-l-red-500"}`}>
                        {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-medium">{checkLabel(c.name)}</span><span className={`shrink-0 text-[11px] font-semibold ${c.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>{c.ok ? "Pass" : "Fail"}</span></div>
                          {Number(c.count ?? 0) > 0 && <div className="cc-num text-xs text-muted-foreground">{fmt(Number(c.count))} {c.ok ? "records" : "affected"}</div>}
                          {!c.ok && c.detail && <div className="mt-0.5 text-xs text-muted-foreground">{c.detail}</div>}
                          {drills.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5">{drills.map((d) => <button key={d.label} onClick={() => drill.openDrill(d.crumb, d.filters)} className={`min-h-[28px] cursor-pointer rounded-lg border px-2 text-xs font-medium text-primary hover:bg-primary/10 ${focus}`}>{d.label}{d.note ? ` (${d.note})` : ""}</button>)}</div>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </Section>
          ))}
        </>
      )}
    </div>
  );
}

/* ───────────── Benchmarks ───────────── */
function Benchmarks() {
  return (
    <Card i={0} title="Benchmarks (BMI)" hint="Monthly funnel and quality benchmarks per branch" icon={<Target className="h-4 w-4" />}>
      <p className="mb-3 rounded-xl border bg-muted/30 p-2.5 text-xs text-muted-foreground">
        <b className="text-foreground">Auto</b> cells are computed from live ATS data and cannot be edited. <b className="text-blue-700 dark:text-blue-300">Manual</b> cells (blue) hold values entered by the team and can be overridden where editing is allowed.
      </p>
      <div className="overflow-x-auto"><BMIBenchmarkTab /></div>
    </Card>
  );
}

export function ControlsTab() {
  const cc = useCC();
  const { hasAnyRole } = useWorkforceAccess();
  // The health checks API is limited to admin, HR and CEO; scoped roles would only ever see a lock screen, so the view is not offered.
  const views = VIEWS.filter((v) => v.id !== "health" || (!cc.scoped && hasAnyRole("super_admin", "admin", "hr", "ceo")));
  const [view, setView] = useState<View>("finder");
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl bg-muted p-1" role="group" aria-label="Candidates and controls view">
        {views.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)} aria-pressed={view === v.id}
            className={`inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors duration-200 ${focus} ${view === v.id ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{v.icon}{v.label}</button>
        ))}
      </div>
      {view === "finder" ? <Finder /> : view === "health" ? <Health /> : <Benchmarks />}
    </div>
  );
}
