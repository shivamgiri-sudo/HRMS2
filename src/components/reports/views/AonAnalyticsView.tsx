/**
 * AON (Age on Network) & Attrition Analytics
 *
 * AON is days since date_of_joining, bucketed 0-30 / 31-60 / 61-90 / 90+. Nothing is
 * stored — the backend derives every bucket at read time, so a new joiner appears in
 * 0-30 the moment their joining date exists.
 *
 * Three tabs, because they answer three different questions:
 *   Overview   — where the people are now, and where the losses and shrinkage sit
 *   Cohort     — does each intake decay the same way (it does, and badly)
 *   Deep dive  — what kind of joiner leaves early
 *
 * Every number on this screen states its denominator, and each of the four known data
 * gaps is drawn rather than hidden. That is deliberate: the cost-centre feed stopped on
 * 2026-07-20, process is 9.7% populated on exits, some new joiners have no attendance
 * row at all, and exit reason is captured for well under 1% of leavers. A blank cell
 * would read as a rendering fault; a stated zero reads as the finding it is.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Users, LogOut, Activity, TrendingDown } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  AXIS_TICK,
  ChartCard,
  ChartSkeleton,
  EmptyState,
  GRID_PROPS,
  SERIES,
  STATUS,
  StatTile,
  TOOLTIP_STYLE,
  num,
  pct,
  ratio,
} from "@/components/analytics/analytics-kit";
import { DrillDownProvider, useDrillDown } from "@/components/analytics/drilldown/DrillDownProvider";
import { EmployeeListPanel } from "@/components/analytics/drilldown/EmployeeListPanel";
import { EmployeeDetailDrawer } from "@/components/analytics/drilldown/EmployeeDetailDrawer";

/* ── Shared vocabulary ─────────────────────────────────────────────────────── */

/**
 * Bucket order is fixed here rather than sorted from the data. A string sort puts "90+"
 * ahead of "0-30" and the axis reads backwards; the backend orders correctly but the
 * client re-groups, so the order has to be restated.
 */
const BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;
type Bucket = (typeof BUCKETS)[number];

const BUCKET_COLOR: Record<Bucket, string> = {
  "0-30": SERIES[7],  // red — the bucket that loses 43% of all leavers
  "31-60": SERIES[1], // orange
  "61-90": SERIES[3], // yellow
  "90+": SERIES[2],   // aqua
};

const DIMENSIONS = [
  { value: "source", label: "Source of Hire" },
  { value: "designation", label: "Designation" },
  { value: "department", label: "Department" },
  { value: "reporting_manager", label: "Reporting Manager" },
  { value: "branch", label: "Branch" },
  { value: "cost_centre", label: "Cost Centre" },
  { value: "age_band", label: "Age Band" },
  { value: "gender", label: "Gender" },
  { value: "ctc_band", label: "CTC Band" },
  { value: "exit_type_proxy", label: "Exit Type (proxy)" },
  { value: "process", label: "Process (9.7% coverage)" },
] as const;

const GROUP_BY = [
  { value: "branch_name", label: "Branch" },
  { value: "cost_centre_name", label: "Cost Centre" },
  { value: "process_name", label: "Process" },
] as const;
type GroupBy = (typeof GROUP_BY)[number]["value"];

/** The raw FK id column matching each display-name `groupBy` dimension -- aon-bucket-headcount /
 *  -attrition / -shrinkage all now select both (Task 8 review fix: the display name is not a
 *  valid filter value downstream, only the id is). */
const GROUP_BY_ID_FIELD: Record<GroupBy, string> = {
  branch_name: "branch_id",
  cost_centre_name: "cost_centre_id",
  process_name: "process_id",
};

type Row = Record<string, unknown>;
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const s = (v: unknown) => (v == null ? "" : String(v));

/* ── Data access ───────────────────────────────────────────────────────────── */

interface ApiResponse { data?: Row[]; totalCount?: number; meta?: { totalCount?: number } }

/**
 * The grid pages at 100; these charts aggregate, so they ask for the whole result. The
 * largest of the five (aon-bucket-attrition over twelve months) returned 573 rows live,
 * so 5,000 leaves headroom without inviting an unbounded transfer.
 */
const CHART_LIMIT = 5000;

export function useReport(code: string, params: Record<string, string>, enabled = true) {
  const qs = new URLSearchParams({ ...params, limit: String(CHART_LIMIT), offset: "0" });
  return useQuery({
    queryKey: [code, qs.toString()],
    enabled,
    /*
     * One attempt, not four.
     *
     * These are heavy aggregates: measured live, headcount returns in ~2s and attrition in
     * 8-18s, but aon-bucket-shrinkage scans twelve months of attendance and reliably
     * exceeds the gateway's 120s limit, coming back 504 with an HTML error body. With
     * react-query's default retry of 3, that one dead query became four consecutive
     * two-minute requests — eight minutes of load on a database this codebase already
     * knows to be contended, with the view stuck loading the whole time. A query that
     * times out at the gateway will time out again; retrying it only hurts.
     */
    retry: false,
    /* Re-running a 2-minute aggregate on every remount is not worth the freshness. */
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await hrmsApi.get<ApiResponse>(`/api/reports/suite/${code}?${qs.toString()}`, 120_000);
      return res.data ?? [];
    },
  });
}

/* ── Small presentational helpers ──────────────────────────────────────────── */

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "h-9 rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-800 " +
  "focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300";

/**
 * The data-gap banner.
 *
 * Rendered from measured coverage rather than hardcoded prose wherever the number is
 * available, so it stops being true the moment the underlying feed is fixed.
 */
function GapBanner({ items }: { items: Array<{ label: string; detail: string }> }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-800">
            Known data gaps in this view
          </p>
          <ul className="space-y-0.5">
            {items.map(it => (
              <li key={it.label} className="text-[11.5px] leading-snug text-amber-900">
                <span className="font-semibold">{it.label}:</span> {it.detail}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ── Overview ──────────────────────────────────────────────────────────────── */

/**
 * One heatmap cell, made clickable.
 *
 * `pushChip` here bypasses Panel 1 (SliceDetailPanel) and opens Panel 2 (Employee List)
 * directly: a heatmap cell already IS one specific group+bucket combination — both
 * dimensions of this tab's drill path at once — so there's no intermediate narrowing step
 * needed before showing people. SliceDetailPanel stays reserved for Cohort Survival / Deep
 * Dive wiring in a future plan, where narrowing happens one dimension at a time.
 */
function DrillCell({
  value, max, metric, groupBy, groupKey, groupId, bucket,
}: { value: number; max: number; metric: "headcount" | "exits" | "shrinkage"; groupBy: GroupBy; groupKey: string; groupId: string; bucket: Bucket }) {
  const { pushChip, openEmployeeList } = useDrillDown();
  const dimension = groupBy === "cost_centre_name" ? "costCentre" : groupBy === "process_name" ? "process" : "branch";

  return (
    <button
      type="button"
      onClick={() => {
        // The chip's VALUE must be the real FK id (aon-drilldown-employees filters
        // e.branch_id / e.cost_centre_id / e.process_id, actual UUID comparisons) --
        // groupKey is only the human-readable display name, used for the chip's LABEL.
        pushChip({ dimension, value: groupId, label: groupKey });
        pushChip({ dimension: "aonBucket", value: bucket, label: `${bucket}d` });
        openEmployeeList();
      }}
      className="inline-block cursor-pointer rounded px-1.5 py-0.5 transition-opacity hover:opacity-80"
      style={{
        backgroundColor: `rgba(227, 73, 72, ${Math.min(0.75, (value / max) * 0.6)})`,
        color: value / max > 0.55 ? "#fff" : "#0f172a",
      }}
    >
      {metric === "shrinkage" ? pct(value) : num(value)}
    </button>
  );
}

/**
 * Resets the drill-down state (chips + open panels) whenever `groupBy` or `metric` changes.
 *
 * Must be mounted as a child of `DrillDownProvider` -- `useDrillDown` throws otherwise -- so it
 * cannot live directly in `Overview`'s own body: `Overview` renders `<DrillDownProvider>` itself,
 * meaning `Overview`'s hooks run one level above the provider, not inside it. Without this,
 * `pushChip` (which replaces only by dimension) let a stale chip from a since-abandoned
 * `groupBy`/`metric` selection persist into a later slice, silently narrowing it with an
 * intersection filter the user never asked for and, before this task's chip bar was added to
 * `EmployeeListPanel`, could not even see.
 */
function DrillResetOnChange({ groupBy, metric }: { groupBy: GroupBy; metric: "headcount" | "exits" | "shrinkage" }) {
  const { clear } = useDrillDown();
  useEffect(() => {
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, metric]);
  return null;
}

function Overview({ from, to, branchId, headlineRate }: { from: string; to: string; branchId: string; headlineRate: ReturnType<typeof useReport> }) {
  const [groupBy, setGroupBy] = useState<GroupBy>("cost_centre_name");
  const [metric, setMetric] = useState<"headcount" | "exits" | "shrinkage">("headcount");

  const base = branchId ? { branchId } : {};
  const hc = useReport("aon-bucket-headcount", base);
  const at = useReport("aon-bucket-attrition", { ...base, from, to });
  /*
   * Shrinkage is fetched ONLY when its metric is selected.
   *
   * It scans attendance_daily_record, and although that table is small (131,906 rows in
   * total, of which twelve months is essentially all of it) the aggregate takes 65s for a
   * three-month window on this database and exceeds the 120s gateway limit over twelve.
   * The cost is contention, not volume — Threads_running was 27 while measuring — so
   * narrowing the window does not rescue it.
   *
   * Every page load previously paid that cost whether or not anyone looked at shrinkage,
   * which is what made the default Overview feel broken. Now Headcount and Attrition load
   * in seconds and the expensive query runs only on an explicit request, where a wait is
   * at least attributable to something the user just asked for.
   */
  const sh = useReport("aon-bucket-shrinkage", { ...base, from, to }, metric === "shrinkage");

  /*
   * Gate on the query the SELECTED metric needs, never on all three.
   *
   * This was `hc.isLoading || at.isLoading || sh.isLoading`, so the slowest query decided
   * whether anything at all appeared. aon-bucket-shrinkage times out at the gateway after
   * ~120s, which meant Headcount — back in under two seconds with 121 rows — sat behind
   * grey skeletons for two minutes and then rendered only because the failure finally
   * resolved the flag. On screen that is indistinguishable from a broken page, and it is
   * exactly what it was reported as.
   *
   * A metric nobody is looking at must never blank the one they are.
   */
  const metricQuery = metric === "shrinkage" ? sh : metric === "exits" ? at : hc;
  const loading = metricQuery.isLoading;
  const error = metricQuery.error;

  /* Supporting figures come from the other two queries, which may still be in flight or
     may have failed. Their absence must read as "not available", never as a confident 0 —
     "0 exits in range" is a claim, and an unloaded query has not earned it. */
  const exitsReady = !at.isLoading && !at.error;
  const headReady = !hc.isLoading && !hc.error;

  /* Headline per bucket. Shrinkage is weighted by employee-days, never a mean of
     percentages — averaging percentages across groups of wildly different size is the
     classic way to make a small group dominate a company-wide figure. */
  const tiles = useMemo(() => {
    const head: Record<string, number> = {};
    const exits: Record<string, number> = {};
    const days: Record<string, number> = {};
    const worked: Record<string, number> = {};
    for (const r of hc.data ?? []) head[s(r.aon_bucket)] = (head[s(r.aon_bucket)] ?? 0) + n(r.headcount);
    for (const r of at.data ?? []) exits[s(r.aon_bucket)] = (exits[s(r.aon_bucket)] ?? 0) + n(r.exits);
    for (const r of sh.data ?? []) {
      const b = s(r.aon_bucket);
      days[b] = (days[b] ?? 0) + n(r.emp_days);
      worked[b] = (worked[b] ?? 0) + n(r.present_days) + n(r.half_days) + n(r.week_off_worked_days);
    }
    const totalHead = Object.values(head).reduce((a, b) => a + b, 0);
    const totalExits = Object.values(exits).reduce((a, b) => a + b, 0);
    return BUCKETS.map(b => ({
      bucket: b,
      headcount: head[b] ?? 0,
      headShare: ratio(head[b] ?? 0, totalHead),
      exits: exits[b] ?? 0,
      exitShare: ratio(exits[b] ?? 0, totalExits),
      empDays: days[b] ?? 0,
      shrinkage: days[b] ? ((days[b] - (worked[b] ?? 0)) / days[b]) * 100 : null,
    }));
  }, [hc.data, at.data, sh.data]);

  /* The heatmap: one row per group, one column per bucket, for the chosen metric. */
  const grid = useMemo(() => {
    const src = metric === "headcount" ? hc.data : metric === "exits" ? at.data : sh.data;
    const idField = GROUP_BY_ID_FIELD[groupBy];
    const map = new Map<string, Record<string, { value: number; days: number; worked: number }>>();
    const ids = new Map<string, string>();
    for (const r of src ?? []) {
      const key = s(r[groupBy]) || "UNASSIGNED";
      const b = s(r.aon_bucket);
      if (!map.has(key)) map.set(key, {});
      if (!ids.has(key)) ids.set(key, s(r[idField]));
      const cell = map.get(key)!;
      const prev = cell[b] ?? { value: 0, days: 0, worked: 0 };
      cell[b] = {
        value: prev.value + (metric === "headcount" ? n(r.headcount) : metric === "exits" ? n(r.exits) : 0),
        days: prev.days + n(r.emp_days),
        worked: prev.worked + n(r.present_days) + n(r.half_days) + n(r.week_off_worked_days),
      };
    }
    const rows = [...map.entries()].map(([key, cells]) => {
      const vals = BUCKETS.map(b => {
        const c = cells[b];
        if (!c) return null;
        if (metric === "shrinkage") return c.days ? ((c.days - c.worked) / c.days) * 100 : null;
        return c.value;
      });
      const total = metric === "shrinkage"
        ? (() => {
            const d = BUCKETS.reduce((a, b) => a + (cells[b]?.days ?? 0), 0);
            const w = BUCKETS.reduce((a, b) => a + (cells[b]?.worked ?? 0), 0);
            return d ? ((d - w) / d) * 100 : null;
          })()
        : vals.reduce<number>((a, v) => a + (v ?? 0), 0);
      // The real FK id backing this row's display name -- UNASSIGNED (and any group whose
      // master-table join was NULL) carries an empty id, which is an inherent, pre-existing
      // limit (there is no single id to filter by), not a new bug.
      return { key, id: ids.get(key) ?? "", vals, total };
    });
    // Rank by magnitude so the worst offenders are at the top rather than alphabetical.
    return rows.sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).slice(0, 25);
  }, [metric, groupBy, hc.data, at.data, sh.data]);

  /* Bucket trend over the months in range — the direct answer to "which bucket's trend
     is worst". Shrinkage is re-weighted per month for the same reason as the tiles. */
  const trend = useMemo(() => {
    const src = metric === "shrinkage" ? sh.data : at.data;
    if (metric === "headcount") return [];
    const months = new Map<string, Record<string, { v: number; d: number; w: number }>>();
    for (const r of src ?? []) {
      const m = s(r.month);
      const b = s(r.aon_bucket);
      if (!months.has(m)) months.set(m, {});
      const row = months.get(m)!;
      const prev = row[b] ?? { v: 0, d: 0, w: 0 };
      row[b] = {
        v: prev.v + n(r.exits),
        d: prev.d + n(r.emp_days),
        w: prev.w + n(r.present_days) + n(r.half_days) + n(r.week_off_worked_days),
      };
    }
    return [...months.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, row]) => {
        const out: Record<string, string | number | null> = { month };
        for (const b of BUCKETS) {
          const c = row[b];
          out[b] = !c ? null : metric === "shrinkage" ? (c.d ? ((c.d - c.w) / c.d) * 100 : null) : c.v;
        }
        return out;
      });
  }, [metric, at.data, sh.data]);

  const zeroAttendanceGroups = useMemo(
    () => (sh.data ?? []).filter(r => n(r.present_days) + n(r.half_days) + n(r.week_off_worked_days) === 0).length,
    [sh.data],
  );
  const unassignedCc = useMemo(
    () => (hc.data ?? []).filter(r => s(r.cost_centre_code) === "UNASSIGNED").reduce((a, r) => a + n(r.headcount), 0),
    [hc.data],
  );

  /*
   * The failure is shown INSIDE the view, not instead of it.
   *
   * This used to `return` a red box in place of everything, which took the metric selector,
   * the group-by, the date range and the tabs down with it. Since the one query that fails
   * in practice is Shrinkage, selecting it stranded the user on an error screen with no
   * control left to switch back to Headcount — the failure removed the means of escaping
   * itself. Keeping the chrome mounted means a slow or dead metric costs you that metric
   * and nothing else.
   */
  const failure = error
    ? (error as Error).message?.toLowerCase().includes("timeout") ||
      (error as Error).message?.includes("504")
      ? "This metric is taking longer than the 120-second limit and was stopped. Narrow the date range, or pick a single branch, and try again."
      : (error as Error).message || "Failed to load this metric."
    : null;

  const MetricFailure = () => (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      {failure}
    </div>
  );

  return (
    <DrillDownProvider>
    <DrillResetOnChange groupBy={groupBy} metric={metric} />
    <div className="space-y-4">
      <GapBanner
        items={[
          ...(unassignedCc > 0
            ? [{
                label: "Cost centre unassigned",
                detail: `${num(unassignedCc)} active employees carry no cost centre. Onboarding does capture one — it is a required field on the employment offer — but no employee-creation path writes it to the employee record, so it only ever arrives via a manual edit. Recent joiners are therefore almost all UNASSIGNED. Branch is unaffected: group by Branch for a complete picture.`,
              }]
            : []),
          ...(zeroAttendanceGroups > 0
            ? [{
                label: "Attendance coverage",
                detail: `${zeroAttendanceGroups} group/bucket combinations recorded zero worked days in this window and read as 100% shrinkage. New joiners are also often not yet enrolled on biometric, so a 0-30 shrinkage figure rests on fewer people than the bucket contains — read Employee Days alongside it.`,
              }]
            : []),
          {
            label: "Exit reason",
            detail: "Not captured in this system — under 1% of leavers have one recorded. This view shows what kind of joiner leaves and when, never why.",
          },
        ]}
      />

      {failure && <MetricFailure />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {!loading && !headlineRate.isLoading && headlineRate.data?.[headlineRate.data.length - 1] && (
          <StatTile
            label="Overall Attrition Rate"
            value={pct(Number(headlineRate.data[headlineRate.data.length - 1].attrition_rate_pct ?? NaN))}
            denominator={`${num(Number(headlineRate.data[headlineRate.data.length - 1].exits ?? 0))} exits over avg ${num(Number(headlineRate.data[headlineRate.data.length - 1].avg_total_headcount ?? 0))} headcount`}
            intent="neutral"
            icon={<TrendingDown className="h-4 w-4" />}
          />
        )}
        {loading
          ? BUCKETS.map(b => <ChartSkeleton key={b} height={104} />)
          : failure
          ? null
          : tiles.map(t => (
              <StatTile
                key={t.bucket}
                label={`AON ${t.bucket} days`}
                value={metric === "exits" ? num(t.exits) : metric === "shrinkage" ? pct(t.shrinkage ?? NaN) : num(t.headcount)}
                denominator={
                  metric === "exits"
                    ? `${pct(t.exitShare ?? NaN)} of exits in range · ${headReady ? `avg over ${num(t.headcount)} active now` : "headcount unavailable"}`
                    : metric === "shrinkage"
                      ? `over ${num(t.empDays)} employee-days`
                      : `${pct(t.headShare ?? NaN)} of active headcount · ${exitsReady ? `${num(t.exits)} exits in range` : "exits unavailable"}`
                }
                intent={t.bucket === "0-30" ? "critical" : t.bucket === "31-60" ? "warning" : "neutral"}
                icon={metric === "exits" ? <LogOut className="h-4 w-4" /> : metric === "shrinkage" ? <Activity className="h-4 w-4" /> : <Users className="h-4 w-4" />}
              />
            ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Metric">
          <select className={inputCls} value={metric} onChange={e => setMetric(e.target.value as typeof metric)}>
            <option value="headcount">Headcount (now)</option>
            <option value="exits">Attrition (exits)</option>
            <option value="shrinkage">Shrinkage %</option>
          </select>
        </Field>
        <Field label="Group rows by">
          <select className={inputCls} value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)}>
            {GROUP_BY.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </Field>
      </div>

      <ChartCard
        title={`${metric === "headcount" ? "Headcount" : metric === "exits" ? "Exits" : "Shrinkage"} by AON bucket`}
        subtitle={`Top 25 of ${grid.length >= 25 ? "many" : grid.length} groups, ranked by total. Shrinkage is weighted by employee-days, not averaged across groups.`}
      >
        {loading ? (
          <ChartSkeleton height={320} />
        ) : failure ? (
          <MetricFailure />
        ) : grid.length === 0 ? (
          <EmptyState label="No rows for this filter" hint="Widen the date range or clear the branch filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {GROUP_BY.find(g => g.value === groupBy)?.label}
                  </th>
                  {BUCKETS.map(b => (
                    <th key={b} className="px-2 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      {b}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">Total</th>
                </tr>
              </thead>
              <tbody>
                {grid.map(row => {
                  const max = Math.max(...row.vals.map(v => v ?? 0), 1);
                  return (
                    <tr key={row.key} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="max-w-[240px] truncate px-2 py-1.5 font-medium text-slate-800" title={row.key}>
                        {row.key}
                      </td>
                      {row.vals.map((v, i) => (
                        <td key={BUCKETS[i]} className="px-2 py-1.5 text-right tabular-nums">
                          {v == null ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            <DrillCell
                              value={v}
                              max={max}
                              metric={metric}
                              groupBy={groupBy}
                              groupKey={row.key}
                              groupId={row.id}
                              bucket={BUCKETS[i]}
                            />
                          )}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-slate-900">
                        {row.total == null ? "—" : metric === "shrinkage" ? pct(row.total) : num(row.total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      {metric !== "headcount" && (
        <ChartCard
          title={`${metric === "exits" ? "Exits" : "Shrinkage"} trend by AON bucket`}
          subtitle="Which bucket is getting worse over time. A bucket with no data in a month is a gap in the line, not a zero."
        >
          {loading ? (
            <ChartSkeleton height={280} />
          ) : trend.length === 0 ? (
            <EmptyState label="No monthly data in range" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trend} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number | string) => (metric === "shrinkage" ? pct(Number(v)) : num(Number(v)))}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {BUCKETS.map(b => (
                  <Line
                    key={b}
                    type="monotone"
                    dataKey={b}
                    name={`${b} days`}
                    stroke={BUCKET_COLOR[b]}
                    strokeWidth={b === "0-30" ? 2.5 : 1.75}
                    dot={{ r: 2 }}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      )}

      <EmployeeListPanel open metric={metric === "headcount" ? "headcount" : metric === "exits" ? "exits" : "shrinkage"} from={from} to={to} />
      <EmployeeDetailDrawer />
    </div>
    </DrillDownProvider>
  );
}

/* ── Cohort survival ───────────────────────────────────────────────────────── */

function CohortSurvival({ from, to, branchId }: { from: string; to: string; branchId: string }) {
  const q = useReport("aon-cohort-survival", { from, to, ...(branchId ? { branchId } : {}) });

  /**
   * Cohorts are rolled up across branch and cost centre here. Survival must be
   * recomputed from joined/left counts — averaging the per-row percentages would weight
   * a one-person cost centre the same as a 200-person one.
   *
   * A horizon is only shown once every contributing cohort row has reached it; the
   * backend nulls immature horizons, and a cohort mixing mature and immature rows would
   * otherwise report survival against a partial denominator.
   */
  const cohorts = useMemo(() => {
    const map = new Map<string, { joined: number; l30: number; l60: number; l90: number; m30: number; m60: number; m90: number; rows: number }>();
    for (const r of q.data ?? []) {
      const k = s(r.cohort_month);
      const cur = map.get(k) ?? { joined: 0, l30: 0, l60: 0, l90: 0, m30: 0, m60: 0, m90: 0, rows: 0 };
      cur.joined += n(r.joined);
      cur.l30 += n(r.left_by_30);
      cur.l60 += n(r.left_by_60);
      cur.l90 += n(r.left_by_90);
      cur.m30 += n(r.is_mature_30);
      cur.m60 += n(r.is_mature_60);
      cur.m90 += n(r.is_mature_90);
      cur.rows += 1;
      map.set(k, cur);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cohort, c]) => ({
        cohort,
        joined: c.joined,
        left30: c.l30,
        left90: c.l90,
        "Survived 30d": c.m30 === c.rows ? 100 - (c.l30 / c.joined) * 100 : null,
        "Survived 60d": c.m60 === c.rows ? 100 - (c.l60 / c.joined) * 100 : null,
        "Survived 90d": c.m90 === c.rows ? 100 - (c.l90 / c.joined) * 100 : null,
      }));
  }, [q.data]);

  const totals = useMemo(() => {
    const joined = cohorts.reduce((a, c) => a + c.joined, 0);
    const l30 = cohorts.reduce((a, c) => a + c.left30, 0);
    const l90 = cohorts.reduce((a, c) => a + c.left90, 0);
    return { joined, l30, l90 };
  }, [cohorts]);

  if (q.error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        {(q.error as Error).message || "Failed to load cohort survival."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GapBanner
        items={[{
          label: "Population",
          detail: "A cohort counts every joiner that month, including those who have since left — filtering to currently-active staff would make survival 100% by construction. Employees who are inactive with no exit date are excluded because their fate is unknowable.",
        }]}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Joined in range" value={num(totals.joined)} denominator={`${cohorts.length} monthly cohorts`} icon={<Users className="h-4 w-4" />} />
        <StatTile
          label="Gone within 30 days"
          value={num(totals.l30)}
          denominator={`${pct(ratio(totals.l30, totals.joined) ?? NaN)} of everyone who joined in range`}
          intent="critical"
          icon={<TrendingDown className="h-4 w-4" />}
        />
        <StatTile
          label="Gone within 90 days"
          value={num(totals.l90)}
          denominator={`${pct(ratio(totals.l90, totals.joined) ?? NaN)} of everyone who joined in range`}
          intent="critical"
          icon={<TrendingDown className="h-4 w-4" />}
        />
      </div>

      <ChartCard
        title="Survival curve by joining cohort"
        subtitle="Percentage of each intake still employed at 30, 60 and 90 days. A horizon is left blank until the cohort is old enough to have reached it."
      >
        {q.isLoading ? (
          <ChartSkeleton height={300} />
        ) : cohorts.length === 0 ? (
          <EmptyState label="No cohorts in range" hint="Widen the joining-date range." />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={cohorts} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="cohort" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} domain={[0, 100]} unit="%" />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number | string) => pct(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Survived 30d" stroke={SERIES[7]} strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls={false} />
              <Line type="monotone" dataKey="Survived 60d" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
              <Line type="monotone" dataKey="Survived 90d" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Cohort detail" subtitle="Blank survival cells mean the cohort has not yet reached that horizon.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                {["Cohort", "Joined", "Left by 30d", "Survived 30d", "Survived 60d", "Survived 90d"].map((h, i) => (
                  <th key={h} className={`px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 ${i === 0 ? "text-left" : "text-right"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map(c => (
                <tr key={c.cohort} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-2 py-1.5 font-medium text-slate-800">{c.cohort}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{num(c.joined)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-rose-700">{num(c.left30)}</td>
                  {(["Survived 30d", "Survived 60d", "Survived 90d"] as const).map(k => (
                    <td key={k} className="px-2 py-1.5 text-right tabular-nums">
                      {c[k] == null ? <span className="text-slate-300">—</span> : pct(c[k] as number)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}

/* ── Attrition deep dive ───────────────────────────────────────────────────── */

function DeepDive({ from, to, branchId }: { from: string; to: string; branchId: string }) {
  const [dimension, setDimension] = useState<string>("source");
  const q = useReport("attrition-deep-dive", { from, to, dimension, ...(branchId ? { branchId } : {}) });

  /* early_quit_rate is constant across a value's four bucket rows by construction, so it
     is read from the first row rather than recomputed. */
  const values = useMemo(() => {
    const map = new Map<string, { total: number; early: number; buckets: Record<string, number> }>();
    for (const r of q.data ?? []) {
      const k = s(r.dimension_value) || "UNASSIGNED";
      const cur = map.get(k) ?? { total: 0, early: n(r.early_quit_rate), buckets: {} };
      cur.total += n(r.exits);
      cur.buckets[s(r.aon_bucket)] = n(r.exits);
      map.set(k, cur);
    }
    return [...map.entries()]
      .map(([value, v]) => ({ value, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);
  }, [q.data]);

  const reasonCaptured = useMemo(() => {
    const rows = q.data ?? [];
    if (rows.length === 0) return null;
    const totalExits = rows.reduce((a, r) => a + n(r.exits), 0);
    const withReason = rows.reduce((a, r) => a + (n(r.exits) * n(r.reason_captured_pct)) / 100, 0);
    return { totalExits, withReason: Math.round(withReason), pct: ratio(withReason, totalExits) };
  }, [q.data]);

  const chartData = useMemo(
    () => values.map(v => ({ name: v.value.length > 28 ? `${v.value.slice(0, 27)}…` : v.value, full: v.value, rate: v.early, exits: v.total })),
    [values],
  );

  if (q.error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        {(q.error as Error).message || "Failed to load attrition deep dive."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GapBanner
        items={[
          {
            label: "Exit reason",
            detail: reasonCaptured
              ? `${num(reasonCaptured.withReason)} of ${num(reasonCaptured.totalExits)} exits in this window have a reason recorded (${pct(reasonCaptured.pct ?? 0)}). Exit reason is not captured by any live workflow, so this view answers what kind of joiner leaves and when — not why.`
              : "Exit reason is not captured by any live workflow.",
          },
          ...(dimension === "process"
            ? [{ label: "Process coverage", detail: "process_id is populated on roughly 10% of exits, so most rows in this slice will read UNASSIGNED. Branch and cost centre are near-complete by comparison." }]
            : []),
          ...(dimension === "exit_type_proxy"
            ? [{ label: "This is a proxy", detail: "Derived from the absence of a resignation date, not from a recorded exit type. Where a resignation date exists it mirrors the exit date exactly, so it cannot measure notice served." }]
            : []),
        ]}
      />

      <Field label="Slice by">
        <select className={`${inputCls} max-w-xs`} value={dimension} onChange={e => setDimension(e.target.value)}>
          {DIMENSIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </Field>

      <ChartCard
        title="Early-quit rate by slice"
        subtitle="Share of each value's leavers who went within 30 days. Bars are ranked by total exits, so a high rate on a handful of people sits below a high rate on hundreds."
      >
        {q.isLoading ? (
          <ChartSkeleton height={Math.max(280, chartData.length * 26)} />
        ) : chartData.length === 0 ? (
          <EmptyState label="No exits in range for this slice" />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(280, chartData.length * 26)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 8 }}>
              <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
              <XAxis type="number" domain={[0, 100]} unit="%" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={180} tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v: number | string, key: string) => (key === "rate" ? pct(Number(v)) : num(Number(v)))}
                labelFormatter={(_l, p) => String(p?.[0]?.payload?.full ?? "")}
              />
              <Bar dataKey="rate" name="Early quit rate" radius={[0, 3, 3, 0]}>
                {chartData.map(d => (
                  <Cell key={d.full} fill={d.rate >= 45 ? STATUS.critical : d.rate >= 30 ? STATUS.serious : SERIES[0]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Exits by AON bucket" subtitle="Top 20 values by total exits.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Value</th>
                {BUCKETS.map(b => (
                  <th key={b} className="px-2 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">{b}</th>
                ))}
                <th className="px-2 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">Total</th>
                <th className="px-2 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">Early Quit</th>
              </tr>
            </thead>
            <tbody>
              {values.map(v => (
                <tr key={v.value} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="max-w-[260px] truncate px-2 py-1.5 font-medium text-slate-800" title={v.value}>{v.value}</td>
                  {BUCKETS.map(b => (
                    <td key={b} className="px-2 py-1.5 text-right tabular-nums">
                      {v.buckets[b] == null ? <span className="text-slate-300">—</span> : num(v.buckets[b])}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{num(v.total)}</td>
                  <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${v.early >= 45 ? "text-rose-700" : v.early >= 30 ? "text-amber-700" : "text-slate-700"}`}>
                    {pct(v.early)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}

/* ── Shell ─────────────────────────────────────────────────────────────────── */

/** Default window: the trailing twelve months, computed locally rather than from a UTC
 *  ISO substring — in IST that yields the previous day for the first 5.5 hours. */
function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AonAnalyticsView() {
  const today = new Date();
  const [tab, setTab] = useState<"overview" | "cohort" | "deep">("overview");
  const [from, setFrom] = useState(isoLocal(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())));
  const [to, setTo] = useState(isoLocal(today));
  const [branchId, setBranchId] = useState("");

  const branches = useQuery({
    queryKey: ["org-branches-aon"],
    queryFn: () => hrmsApi.get<{ data: { id: string; branch_name: string }[] }>("/api/org/branches"),
  });

  const headline = useReport("aon-overall-attrition-rate", branchId ? { branchId, from, to } : { from, to });

  return (
    <div className="space-y-4 p-6">
      <header className="space-y-1">
        <h2 className="text-lg font-bold text-slate-900">AON &amp; Attrition Analytics</h2>
        <p className="text-[12px] leading-snug text-slate-500">
          AON (Age on Network) is days since joining, bucketed 0-30 / 31-60 / 61-90 / 90+. It is derived
          from the joining date on every read, so a new joiner appears in the 0-30 bucket the same day —
          nothing is stored and nothing needs to be recalculated.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <Field label={tab === "cohort" ? "Joined from" : "From"}>
          <input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} />
        </Field>
        <Field label={tab === "cohort" ? "Joined to" : "To"}>
          <input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} />
        </Field>
        <Field label="Branch">
          <select className={inputCls} value={branchId} onChange={e => setBranchId(e.target.value)}>
            <option value="">All branches</option>
            {(branches.data?.data ?? []).map(b => (
              <option key={b.id} value={b.id}>{b.branch_name}</option>
            ))}
          </select>
        </Field>
        <div className="ml-auto flex gap-1 rounded-lg bg-slate-50 p-1">
          <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>Overview</TabButton>
          <TabButton active={tab === "cohort"} onClick={() => setTab("cohort")}>Cohort Survival</TabButton>
          <TabButton active={tab === "deep"} onClick={() => setTab("deep")}>Attrition Deep Dive</TabButton>
        </div>
      </div>

      {tab === "overview" && <Overview from={from} to={to} branchId={branchId} headlineRate={headline} />}
      {tab === "cohort" && <CohortSurvival from={from} to={to} branchId={branchId} />}
      {tab === "deep" && <DeepDive from={from} to={to} branchId={branchId} />}
    </div>
  );
}
