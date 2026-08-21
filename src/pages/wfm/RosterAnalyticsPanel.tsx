/**
 * Roster Analytics — one shared filter bar (branch / process / date range), four drill-downs.
 *
 * Built 2026-08-22 directly off a structural audit of the roster module: this is the page that
 * did not exist anywhere in the product. Every number here comes from an already-live, already-
 * tested backend surface — nothing new was invented except getRosterStatusSummary (publish/ack
 * counts, roster-view.service.ts), which genuinely had no answer anywhere before today (413,386
 * roster rows, 100% still "generated", zero ROSTER_ACK_PENDING items ever created).
 *
 * Deliberately a tab INSIDE Roster Insights, not a new page — "one page, all filters, all
 * drill-downs" was the explicit ask, and Roster Insights already exists as exactly that pattern
 * for the read-only half of this module.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  BarChart,
} from "recharts";
import { CalendarClock, Send, TrendingDown, Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
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

/* ── Shared types ──────────────────────────────────────────────────────────── */

interface Process { id: string; process_name: string }
interface Branch { id: string; branch_name: string }

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/* ── Filter bar ────────────────────────────────────────────────────────────── */

interface Filters {
  branchId: string;
  processId: string;
  from: string;
  to: string;
}

function FilterBar({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  const { data: procData } = useQuery({
    queryKey: ["processes-list"],
    queryFn: () => hrmsApi.get<{ data: Process[] }>("/api/processes?limit=200"),
  });
  const { data: branchData } = useQuery({
    queryKey: ["wfm-roster-import-branches"],
    queryFn: () => hrmsApi.get<{ branches: Branch[] }>("/api/wfm/roster-imports/branches"),
  });
  const processes = procData?.data ?? [];
  const branches = branchData?.branches ?? [];

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
      <div className="min-w-[180px]">
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Branch</label>
        <Select
          value={filters.branchId || "__all__"}
          onValueChange={(v) => setFilters({ ...filters, branchId: v === "__all__" ? "" : v })}
        >
          <SelectTrigger className="h-9 bg-white"><SelectValue placeholder="All branches" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All branches (company-wide)</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-[200px]">
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Process</label>
        <Select
          value={filters.processId || "__all__"}
          onValueChange={(v) => setFilters({ ...filters, processId: v === "__all__" ? "" : v })}
        >
          <SelectTrigger className="h-9 bg-white"><SelectValue placeholder="All processes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All processes</SelectItem>
            {processes.map((p) => <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">From</label>
        <Input type="date" className="h-9 w-[150px] bg-white" value={filters.from}
          onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">To</label>
        <Input type="date" className="h-9 w-[150px] bg-white" value={filters.to}
          onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
      </div>
    </div>
  );
}

/* ── Section switcher ──────────────────────────────────────────────────────── */

const SECTIONS = [
  { value: "shrinkage", label: "Shrinkage Trend" },
  { value: "publish", label: "Publish & Acknowledge" },
  { value: "attrition", label: "Attrition" },
  { value: "lateness", label: "Lateness" },
] as const;
type Section = (typeof SECTIONS)[number]["value"];

function SectionSwitcher({ active, onChange }: { active: Section; onChange: (s: Section) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
      {SECTIONS.map((s) => (
        <button
          key={s.value}
          onClick={() => onChange(s.value)}
          className={[
            "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
            active === s.value ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100",
          ].join(" ")}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/* ── Section 1: Shrinkage trend ───────────────────────────────────────────── */

interface ShrinkageSnapshot {
  snapshot_date: string;
  process_id: string | null;
  branch_id: string | null;
  rostered_hc: number;
  present_hc: number;
  absent_hc: number;
  on_leave_hc: number;
  late_count: number;
  planned_shrinkage_pct: number;
  unplanned_shrinkage_pct: number;
  total_shrinkage_pct: number;
  avg_adherence_pct: number;
}

function ShrinkageTrendSection({ filters }: { filters: Filters }) {
  const q = useQuery({
    queryKey: ["rta-shrinkage-trend", filters.from, filters.to, filters.branchId, filters.processId],
    queryFn: async () => {
      const params = new URLSearchParams({ fromDate: filters.from, toDate: filters.to });
      if (filters.branchId) params.set("branchId", filters.branchId);
      if (filters.processId) params.set("processId", filters.processId);
      const res = await hrmsApi.get<{ success: boolean; data: ShrinkageSnapshot[] }>(`/api/rta/shrinkage?${params}`);
      return res.data ?? [];
    },
  });

  // Multiple process/branch combinations can share one date (when neither filter narrows to a
  // single scope) — collapse to one point per date, weighted (never averaging percentages across
  // groups of different size, same rule analytics-kit documents for AON).
  const trend = useMemo(() => {
    const byDate = new Map<string, { rostered: number; present: number; absent: number; onLeave: number; late: number }>();
    for (const row of q.data ?? []) {
      const d = row.snapshot_date.slice(0, 10);
      const acc = byDate.get(d) ?? { rostered: 0, present: 0, absent: 0, onLeave: 0, late: 0 };
      acc.rostered += row.rostered_hc;
      acc.present += row.present_hc;
      acc.absent += row.absent_hc;
      acc.onLeave += row.on_leave_hc;
      acc.late += row.late_count;
      byDate.set(d, acc);
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, acc]) => ({
        date,
        planned: acc.rostered,
        present: acc.present,
        shrinkagePct: acc.rostered > 0 ? Math.round(((acc.rostered - acc.present) / acc.rostered) * 1000) / 10 : 0,
        unplannedPct: acc.rostered > 0 ? Math.round((acc.absent / acc.rostered) * 1000) / 10 : 0,
        plannedPct: acc.rostered > 0 ? Math.round((acc.onLeave / acc.rostered) * 1000) / 10 : 0,
        late: acc.late,
      }));
  }, [q.data]);

  const latest = trend[trend.length - 1];
  const first = trend[0];
  const shrinkDelta = latest && first ? latest.shrinkagePct - first.shrinkagePct : null;

  if (q.isLoading) return <ChartSkeleton height={320} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Rostered (latest day)"
          value={latest ? num(latest.planned) : "—"}
          denominator={latest?.date ?? "no snapshot in range"}
          icon={<Users className="h-4 w-4" />}
        />
        <StatTile
          label="Present (latest day)"
          value={latest ? num(latest.present) : "—"}
          denominator={latest ? `${pct(ratio(latest.present, latest.planned) ?? 0)} of rostered` : "—"}
          intent="good"
        />
        <StatTile
          label="Total shrinkage"
          value={latest ? pct(latest.shrinkagePct) : "—"}
          delta={shrinkDelta}
          deltaLabel="vs range start"
          intent={latest && latest.shrinkagePct > 15 ? "critical" : latest && latest.shrinkagePct > 8 ? "warning" : "good"}
          icon={<TrendingDown className="h-4 w-4" />}
        />
        <StatTile
          label="Late count (latest day)"
          value={latest ? num(latest.late) : "—"}
          denominator="from the nightly RTA reconciliation"
          intent={latest && latest.late > 0 ? "warning" : "neutral"}
        />
      </div>

      <ChartCard
        title="Planned vs Present vs Shrinkage"
        subtitle={`Rostered and present headcount (left axis) against total shrinkage % (right axis), ${filters.from} → ${filters.to}. Built from the nightly shrinkage_daily_snapshot — a date with no snapshot is a date nobody ran the reconciliation for, not zero shrinkage.`}
      >
        {trend.length === 0 ? (
          <EmptyState label="No shrinkage snapshots in this range/scope" hint="The nightly RTA job populates this — try a wider date range." height={280} />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis yAxisId="hc" tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
              <YAxis yAxisId="pct" orientation="right" tick={AXIS_TICK} tickLine={false} axisLine={false} width={40}
                tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line yAxisId="hc" type="monotone" dataKey="planned" name="Planned (rostered)" stroke={SERIES[0]} strokeWidth={2} dot={false} />
              <Line yAxisId="hc" type="monotone" dataKey="present" name="Present" stroke={SERIES[2]} strokeWidth={2} dot={false} />
              <Line yAxisId="pct" type="monotone" dataKey="shrinkagePct" name="Total shrinkage %" stroke={STATUS.critical} strokeWidth={2} strokeDasharray="4 3" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {latest && (
        <ChartCard title="Planned vs unplanned shrinkage (latest day)" subtitle="Approved leave (planned) vs. absent-with-no-leave-request (unplanned), as a share of rostered headcount.">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Planned (on leave)</p>
              <p className="text-xl font-bold tabular-nums text-slate-900">{pct(latest.plannedPct)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Unplanned (absent)</p>
              <p className="text-xl font-bold tabular-nums text-rose-600">{pct(latest.unplannedPct)}</p>
            </div>
            <p className="max-w-sm text-[11px] leading-snug text-slate-500">
              A known gap sits under both figures: attendance and leave-approval are two separately-fed
              tables that don't always agree, so some approved leave still shows as unplanned absent here.
            </p>
          </div>
        </ChartCard>
      )}
    </div>
  );
}

/* ── Section 2: Publish & Acknowledge ─────────────────────────────────────── */

interface RosterStatusSummary {
  totalAssignments: number;
  byPublishStage: Array<{ status: string; count: number }>;
  byAckStatus: Array<{ status: string; count: number }>;
  publishedCount: number;
  unpublishedCount: number;
}

const PUBLISH_LABEL: Record<string, string> = {
  generated: "Not yet published",
  pending_employee_ack: "Published, awaiting acknowledgement",
  acknowledged: "Acknowledged",
  rejected_by_employee: "Rejected by employee",
  pending_manager_action: "With manager (disputed)",
  realigned_by_manager: "Realigned by manager",
  force_approved_by_manager: "Force-approved",
  escalated_to_hr: "Escalated to HR",
  approved_final: "Approved (final)",
  published_to_rta: "Published to RTA",
  manager_rejected_employee_request: "Manager rejected request",
};

function PublishSection({ filters }: { filters: Filters }) {
  const q = useQuery({
    queryKey: ["roster-status-summary", filters.from, filters.to, filters.branchId, filters.processId],
    queryFn: async () => {
      const params = new URLSearchParams({ fromDate: filters.from, toDate: filters.to });
      if (filters.branchId) params.set("branchId", filters.branchId);
      if (filters.processId) params.set("processId", filters.processId);
      return hrmsApi.get<RosterStatusSummary>(`/api/wfm/roster-imports/status-summary?${params}`);
    },
  });

  if (q.isLoading) return <ChartSkeleton height={280} />;
  const d = q.data;
  if (!d || d.totalAssignments === 0) {
    return <EmptyState label="No roster assignments in this range/scope" hint="Try a wider date range or clear the branch/process filter." height={220} />;
  }

  const ackAcknowledged = d.byAckStatus.find((r) => r.status === "acknowledged")?.count ?? 0;
  const ackPending = d.byAckStatus.find((r) => r.status === "pending")?.count ?? 0;
  const ackRejected = d.byAckStatus.find((r) => r.status === "rejected")?.count ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total assignments" value={num(d.totalAssignments)} icon={<Send className="h-4 w-4" />} />
        <StatTile label="Published" value={num(d.publishedCount)} denominator={pct(ratio(d.publishedCount, d.totalAssignments) ?? 0) + " of total"} intent={d.publishedCount > 0 ? "good" : "critical"} />
        <StatTile label="Never published" value={num(d.unpublishedCount)} denominator="still 'generated' — no notification sent" intent={d.unpublishedCount > 0 ? "warning" : "good"} />
        <StatTile label="Acknowledged by employee" value={num(ackAcknowledged)} denominator={`${num(ackPending)} pending · ${num(ackRejected)} rejected`} intent={ackAcknowledged > 0 ? "good" : "neutral"} />
      </div>

      <ChartCard title="Publish stage breakdown" subtitle="Every roster assignment in scope, by final_roster_status.">
        <ResponsiveContainer width="100%" height={Math.max(180, d.byPublishStage.length * 34)}>
          <BarChart data={d.byPublishStage.map((r) => ({ ...r, label: PUBLISH_LABEL[r.status] ?? r.status }))} layout="vertical" margin={{ left: 8, right: 24 }}>
            <CartesianGrid {...GRID_PROPS} horizontal={false} />
            <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} width={220} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="count" fill={SERIES[0]} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

/* ── Section 3: Attrition ──────────────────────────────────────────────────── */

const AON_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;

function AttritionSection({ filters }: { filters: Filters }) {
  const base: Record<string, string> = {};
  if (filters.branchId) base.branchId = filters.branchId;
  if (filters.processId) base.processId = filters.processId;

  const hcQ = useQuery({
    queryKey: ["aon-headcount", base.branchId, base.processId],
    queryFn: async () => {
      const qs = new URLSearchParams({ ...base, limit: "5000", offset: "0" });
      const res = await hrmsApi.get<{ data: Array<Record<string, unknown>> }>(`/api/reports/suite/aon-bucket-headcount?${qs}`, 120_000);
      return res.data ?? [];
    },
    retry: false,
    staleTime: 5 * 60_000,
  });
  const exitsQ = useQuery({
    queryKey: ["aon-exits", filters.from, filters.to, base.branchId, base.processId],
    queryFn: async () => {
      const qs = new URLSearchParams({ ...base, from: filters.from, to: filters.to, limit: "5000", offset: "0" });
      const res = await hrmsApi.get<{ data: Array<Record<string, unknown>> }>(`/api/reports/suite/aon-bucket-attrition?${qs}`, 120_000);
      return res.data ?? [];
    },
    retry: false,
    staleTime: 5 * 60_000,
  });

  const buckets = useMemo(() => {
    const head: Record<string, number> = {};
    const exits: Record<string, number> = {};
    for (const r of hcQ.data ?? []) {
      const b = String(r.aon_bucket ?? "");
      head[b] = (head[b] ?? 0) + Number(r.headcount ?? 0);
    }
    for (const r of exitsQ.data ?? []) {
      const b = String(r.aon_bucket ?? "");
      exits[b] = (exits[b] ?? 0) + Number(r.exits ?? 0);
    }
    return AON_BUCKETS.map((b) => ({ bucket: b, headcount: head[b] ?? 0, exits: exits[b] ?? 0 }));
  }, [hcQ.data, exitsQ.data]);

  const totalHeadcount = buckets.reduce((a, r) => a + r.headcount, 0);
  const totalExits = buckets.reduce((a, r) => a + r.exits, 0);
  const attritionRate = ratio(totalExits, totalHeadcount);

  if (hcQ.isLoading) return <ChartSkeleton height={280} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Active headcount" value={num(totalHeadcount)} icon={<Users className="h-4 w-4" />} />
        <StatTile label={`Exits (${filters.from} → ${filters.to})`} value={exitsQ.isLoading ? "…" : num(totalExits)} intent={totalExits > 0 ? "warning" : "good"} />
        <StatTile label="Attrition rate in range" value={exitsQ.isLoading ? "…" : (attritionRate != null ? pct(attritionRate) : "—")} denominator="exits ÷ active headcount" intent={attritionRate != null && attritionRate > 10 ? "critical" : "neutral"} />
      </div>

      <ChartCard
        title="Headcount vs exits, by age-on-network"
        subtitle="AON = days since date_of_joining. Process coverage on exit records is thin (~10%) — treat process-filtered exit numbers as directional, branch and company-wide are reliable."
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={buckets} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="bucket" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="headcount" name="Active headcount" fill={SERIES[0]} radius={[4, 4, 0, 0]} />
            <Bar dataKey="exits" name={`Exits (${filters.from} → ${filters.to})`} fill={STATUS.critical} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

/* ── Section 4: Lateness ───────────────────────────────────────────────────── */

interface LateRow {
  record_date: string;
  employee_code: string;
  employee_name: string;
  branch_name: string;
  process_name: string;
  late_by_minutes: number;
  late_status: string;
}

function LatenessSection({ filters }: { filters: Filters }) {
  const q = useQuery({
    queryKey: ["late-arrival-summary", filters.from, filters.to, filters.branchId, filters.processId],
    queryFn: async () => {
      const params: Record<string, string> = { from: filters.from, to: filters.to, limit: "5000", offset: "0" };
      if (filters.branchId) params.branchId = filters.branchId;
      if (filters.processId) params.processId = filters.processId;
      const qs = new URLSearchParams(params);
      const res = await hrmsApi.get<{ data: LateRow[] }>(`/api/reports/suite/late-arrival-summary?${qs}`, 60_000);
      return res.data ?? [];
    },
    retry: false,
    staleTime: 5 * 60_000,
  });

  // Habitual = repeated, not a single number this codebase computes anywhere today — this is the
  // exact aggregation gap the audit found (per-event report exists, no group-by-employee view of
  // it). >= 3 late arrivals in the selected range is the working definition; adjustable in one
  // place if the business wants a different threshold.
  const HABITUAL_THRESHOLD = 3;
  const byEmployee = useMemo(() => {
    const map = new Map<string, { code: string; name: string; branch: string; process: string; count: number; totalMinutes: number }>();
    for (const r of q.data ?? []) {
      const key = r.employee_code;
      const acc = map.get(key) ?? { code: r.employee_code, name: r.employee_name, branch: r.branch_name, process: r.process_name, count: 0, totalMinutes: 0 };
      acc.count += 1;
      acc.totalMinutes += Number(r.late_by_minutes ?? 0);
      map.set(key, acc);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [q.data]);

  const habitual = byEmployee.filter((e) => e.count >= HABITUAL_THRESHOLD);
  const totalLateEvents = q.data?.length ?? 0;

  if (q.isLoading) return <ChartSkeleton height={280} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Late arrivals in range" value={num(totalLateEvents)} icon={<CalendarClock className="h-4 w-4" />} />
        <StatTile label="Distinct employees late ≥1×" value={num(byEmployee.length)} />
        <StatTile label={`Habitual (≥${HABITUAL_THRESHOLD} times)`} value={num(habitual.length)} intent={habitual.length > 0 ? "critical" : "good"} />
        <StatTile label="Avg late minutes / event" value={totalLateEvents > 0 ? Math.round((q.data ?? []).reduce((a, r) => a + Number(r.late_by_minutes ?? 0), 0) / totalLateEvents) : "—"} />
      </div>

      <ChartCard title={`Habitual latecomers (${HABITUAL_THRESHOLD}+ late arrivals in range)`} subtitle="Sorted by frequency. Grace-period minutes already excluded on the source data — this counts genuine late_mark=1 days.">
        {habitual.length === 0 ? (
          <EmptyState label={totalLateEvents === 0 ? "No late arrivals in this range/scope" : "No employee crossed the habitual threshold"} height={160} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3">Employee</th>
                  <th className="py-2 pr-3">Branch</th>
                  <th className="py-2 pr-3">Process</th>
                  <th className="py-2 pr-3 text-right">Late count</th>
                  <th className="py-2 pr-3 text-right">Avg minutes late</th>
                </tr>
              </thead>
              <tbody>
                {habitual.slice(0, 25).map((e) => (
                  <tr key={e.code} className="border-b border-slate-50">
                    <td className="py-1.5 pr-3 font-medium text-slate-800">{e.name} <span className="text-slate-400">({e.code})</span></td>
                    <td className="py-1.5 pr-3 text-slate-600">{e.branch}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{e.process}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold tabular-nums text-rose-600">{e.count}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">{Math.round(e.totalMinutes / e.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {habitual.length > 25 && (
              <p className="mt-2 text-[11px] text-slate-400">Showing top 25 of {habitual.length} habitual latecomers.</p>
            )}
          </div>
        )}
      </ChartCard>
    </div>
  );
}

/* ── Root panel ────────────────────────────────────────────────────────────── */

export default function RosterAnalyticsPanel() {
  const [filters, setFilters] = useState<Filters>({
    branchId: "",
    processId: "",
    from: todayISO(-13),
    to: todayISO(),
  });
  const [section, setSection] = useState<Section>("shrinkage");

  return (
    <div className="space-y-4">
      <FilterBar filters={filters} setFilters={setFilters} />
      <SectionSwitcher active={section} onChange={setSection} />
      {section === "shrinkage" && <ShrinkageTrendSection filters={filters} />}
      {section === "publish" && <PublishSection filters={filters} />}
      {section === "attrition" && <AttritionSection filters={filters} />}
      {section === "lateness" && <LatenessSection filters={filters} />}
    </div>
  );
}
