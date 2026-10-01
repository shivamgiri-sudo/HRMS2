/**
 * Process-wise shift adherence (Live Monitoring tab).
 *
 * Data: /api/roster-intelligence/shift-adherence (process -> shift slot -> manager roll-ups) and
 * /shift-adherence/employees (the people behind any count). Scoped server-side by the shared
 * branch/process/LOB filters, exactly like the rest of this tab.
 *
 * Adherence = on time / due. Punctuality = on time / present. Logout adherence is measured only on
 * shifts that have already ended. Planned excludes week-off, leave, holiday and shifts not yet due.
 */
import { Fragment, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight, Clock, Download, LogOut, Target, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";
import { ConsoleCard } from "@/components/wfm/console/ConsoleCard";
import { KpiTile } from "@/components/wfm/console/KpiTile";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { DetailDrawer, DrawerSection } from "@/components/wfm/console/DetailDrawer";
import { useRosterConsoleFilters } from "../RosterConsoleFilterContext";
import { scopeParams } from "../filterState";

interface Node {
  planned: number; present: number; onTime: number; late: number; absent: number;
  yetToStart: number; onLeave: number; weekOffWorked: number; noShiftTime: number;
  lateMaxMin: number; leftEarly: number; missedLogout: number; shiftsEnded: number;
  buckets: Record<string, number>;
  adherencePct: number | null; punctualityPct: number | null; attendancePct: number | null;
  avgLateMin: number | null; logoutAdherencePct: number | null;
}
interface Slot extends Node { shift: string }
interface Mgr extends Node { managerId: string | null; manager: string }
interface Proc extends Node { processId: string | null; process: string; slots: Slot[]; managers: Mgr[] }
interface Report {
  date: string; graceMinutes: number; generatedAt: string; totals: Node; processes: Proc[];
  lateBuckets: { key: string; label: string }[];
}
type DrillStatus = "late" | "absent" | "on_time" | "left_early" | "missed_logout" | "all";
interface Emp {
  employeeId: string; employeeCode: string; employeeName: string; process: string; manager: string; shift: string;
  clockIn: string | null; clockOut: string | null; status: string; lateMin: number;
  leftEarly: boolean; earlyOutMin: number; missedLogout: boolean;
}
interface Drill { processId: string; title: string; status: DrillStatus; shift?: string; manager?: string }

const GRACES = [0, 5, 10, 15];
const BUCKET_COLOR: Record<string, string> = {
  b1_5: "bg-amber-200", b6_15: "bg-amber-400", b16_30: "bg-orange-500", b31_60: "bg-red-500", b60p: "bg-red-800",
};
// Adherence target is 95% (owner-set). Amber is a 10-point warning band below it; red is anything lower.
const ADHERENCE_TARGET = 95;
const ADHERENCE_WARN = ADHERENCE_TARGET - 10;
const adhTone = (p: number | null): "green" | "amber" | "red" | "neutral" => (p === null ? "neutral" : p >= ADHERENCE_TARGET ? "green" : p >= ADHERENCE_WARN ? "amber" : "red");
const pctText = (p: number | null) => (p === null ? "—" : `${p}%`);
const STATUS_TONE: Record<string, "green" | "amber" | "red" | "neutral"> = { on_time: "green", late: "amber", absent: "red" };
const STATUS_LABEL: Record<string, string> = { on_time: "On time", late: "Late", absent: "No show" };

function BucketBar({ n, lateBuckets }: { n: Node; lateBuckets: Report["lateBuckets"] }) {
  if (n.late === 0) return <span className="text-xs text-slate-500">—</span>;
  return (
    <div className="flex h-2.5 w-28 overflow-hidden rounded-full bg-slate-100" role="img"
      aria-label={lateBuckets.map((b) => `${b.label}: ${n.buckets[b.key] ?? 0}`).join(", ")}
      title={lateBuckets.map((b) => `${b.label}: ${n.buckets[b.key] ?? 0}`).join(" · ")}>
      {lateBuckets.map((b) => (n.buckets[b.key] ? <div key={b.key} className={BUCKET_COLOR[b.key]} style={{ width: `${(n.buckets[b.key] / n.late) * 100}%` }} /> : null))}
    </div>
  );
}

function CountButton({ n, onClick, label, tone }: { n: number; onClick: () => void; label: string; tone?: string }) {
  if (n === 0) return <span className="tabular-nums text-slate-500">0</span>;
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className={`cursor-pointer rounded px-1 tabular-nums font-semibold underline decoration-dotted underline-offset-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tone ?? ""}`}>
      {n}
    </button>
  );
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(r: Report) {
  const head = ["Level", "Process", "Shift / Manager", "Planned", "Present", "On time", "Late", "Avg late (min)", "Max late (min)", "Absent", "Yet to start", "Adherence %", "Punctuality %", "Attendance %", "Left early", "Missed logout", "Logout adherence %"];
  const line = (level: string, proc: string, name: string, n: Node) => [level, proc, name, n.planned, n.present, n.onTime, n.late, n.avgLateMin ?? "", n.lateMaxMin, n.absent, n.yetToStart, n.adherencePct ?? "", n.punctualityPct ?? "", n.attendancePct ?? "", n.leftEarly, n.missedLogout, n.logoutAdherencePct ?? ""];
  const rows: unknown[][] = [line("Total", "All processes", "", r.totals)];
  for (const p of r.processes) {
    rows.push(line("Process", p.process, "", p));
    for (const s of p.slots) rows.push(line("Shift", p.process, s.shift, s));
    for (const m of p.managers) rows.push(line("Manager", p.process, m.manager, m));
  }
  const csv = [head, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `shift-adherence-${r.date}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export function ShiftAdherenceSection() {
  const { filters } = useRosterConsoleFilters();
  const { branchId, processId, lobId } = filters;
  const [grace, setGrace] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [drill, setDrill] = useState<Drill | null>(null);

  const q = useQuery({
    queryKey: ["command-center", "shift-adherence", branchId, processId, lobId, grace],
    queryFn: () => hrmsApi.get<Report>(`/api/roster-intelligence/shift-adherence?${scopeParams({ branchId, processId, lobId }, { grace: String(grace) })}`),
    refetchInterval: 120_000, staleTime: 60_000, placeholderData: keepPreviousData,
  });
  const r = q.data;
  const t = r?.totals;
  const toggle = (key: string) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const logoutIssues = (t?.leftEarly ?? 0) + (t?.missedLogout ?? 0);

  const empQ = useQuery({
    queryKey: ["command-center", "shift-adherence-employees", drill, branchId, lobId, grace],
    enabled: !!drill,
    queryFn: () => {
      const p = scopeParams({ branchId, processId: drill!.processId, lobId }, { grace: String(grace), status: drill!.status });
      if (drill!.shift) p.set("shift", drill!.shift);
      if (drill!.manager) p.set("manager", drill!.manager);
      return hrmsApi.get<{ total: number; employees: Emp[] }>(`/api/roster-intelligence/shift-adherence/employees?${p}`);
    },
    staleTime: 30_000,
  });

  const open_ = (proc: Proc, status: DrillStatus, extra: Partial<Drill> = {}) =>
    proc.processId && setDrill({ processId: proc.processId, status, title: `${proc.process}${extra.shift ? ` · ${extra.shift}` : ""}${extra.manager ? ` · ${extra.manager}` : ""}`, ...extra });

  const headers = useMemo(() => ["Process", "Planned", "Present", "On time", "Late", "Avg late", "No show", "Not yet due", "Adherence", "Punctuality", "Late spread", "Logout issues"], []);

  return (
    <ConsoleCard className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Process-wise shift adherence</h2>
          <p className="max-w-3xl text-xs text-slate-600">
            Adherence = on time ÷ due shifts. Punctuality = on time ÷ present. A punch after the rostered start (plus grace) is late. Week-off,
            leave, holiday and shifts not yet due are left out. Logout is checked only on shifts that have ended (leaving 5+ min early, or no punch-out).
            Click a count to see the people; expand a row for shift slots and managers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs font-medium text-slate-700">
            Grace
            <select value={grace} onChange={(e) => setGrace(Number(e.target.value))} aria-label="Grace minutes"
              className="min-h-[36px] rounded-md border border-border bg-card px-2 text-xs">
              {GRACES.map((g) => <option key={g} value={g}>{g} min</option>)}
            </select>
          </label>
          <Button variant="outline" size="sm" className="cursor-pointer gap-1" disabled={!r} onClick={() => r && downloadCsv(r)}>
            <Download className="h-4 w-4" aria-hidden /> CSV
          </Button>
        </div>
      </div>

      {q.isError && !r && (
        <div role="alert" className="m-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4" aria-hidden /> Shift adherence could not be loaded, so this is not an all-clear.
          <button type="button" className="cursor-pointer font-medium underline" onClick={() => q.refetch()}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
        <KpiTile label="Adherence" value={q.isLoading ? "…" : pctText(t?.adherencePct ?? null)} sub={`${t?.onTime ?? 0} on time of ${t?.planned ?? 0} due`} tone={adhTone(t?.adherencePct ?? null) === "neutral" ? "neutral" : adhTone(t?.adherencePct ?? null)} icon={Target} progress={t?.adherencePct ?? 0} />
        <KpiTile label="Punctuality" value={q.isLoading ? "…" : pctText(t?.punctualityPct ?? null)} sub={`of ${t?.present ?? 0} who punched in`} tone={adhTone(t?.punctualityPct ?? null) === "neutral" ? "neutral" : adhTone(t?.punctualityPct ?? null)} icon={Clock} progress={t?.punctualityPct ?? 0} />
        <KpiTile label="Late" value={t?.late ?? 0} sub={t?.avgLateMin != null ? `avg ${t.avgLateMin} min · max ${t.lateMaxMin} min` : "none late"} tone={(t?.late ?? 0) > 0 ? "amber" : "green"} icon={Clock} />
        <KpiTile label="No show" value={t?.absent ?? 0} sub={`${t?.yetToStart ?? 0} not yet due`} tone={(t?.absent ?? 0) > 0 ? "red" : "green"} icon={UserX} />
        <KpiTile label="Logout issues" value={logoutIssues} sub={t?.shiftsEnded ? `${t.leftEarly} left early · ${t.missedLogout} no punch-out` : "no shifts ended yet"} tone={logoutIssues > 0 ? "amber" : "green"} icon={LogOut} />
      </div>

      <div className="max-h-[560px] overflow-auto">
        {q.isLoading ? (
          <div className="space-y-2 p-4" role="status" aria-label="Loading adherence">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />)}</div>
        ) : !r || r.processes.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-600">No rostered shifts for the selected filters.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-xs">
              <tr>{headers.map((h, i) => <th key={h} scope="col" className={`p-2 font-semibold ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {r.processes.map((p) => {
                const key = p.processId ?? p.process;
                const isOpen = open.has(key);
                return (
                  <Fragment key={key}>
                    <tr className="border-t border-border hover:bg-muted/50">
                      <td className="p-2">
                        <button type="button" onClick={() => toggle(key)} aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${p.process}`}
                          className="flex cursor-pointer items-center gap-1 text-left font-medium text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                          {p.process}
                        </button>
                      </td>
                      <td className="p-2 text-right tabular-nums">{p.planned}</td>
                      <td className="p-2 text-right tabular-nums">{p.present}</td>
                      <td className="p-2 text-right"><CountButton n={p.onTime} label={`${p.onTime} on time in ${p.process}`} onClick={() => open_(p, "on_time")} /></td>
                      <td className="p-2 text-right"><CountButton n={p.late} label={`${p.late} late in ${p.process}`} tone="text-amber-800" onClick={() => open_(p, "late")} /></td>
                      <td className="p-2 text-right tabular-nums">{p.avgLateMin != null ? `${p.avgLateMin}m` : "—"}</td>
                      <td className="p-2 text-right"><CountButton n={p.absent} label={`${p.absent} no show in ${p.process}`} tone="text-red-800" onClick={() => open_(p, "absent")} /></td>
                      <td className="p-2 text-right tabular-nums text-slate-600">{p.yetToStart}</td>
                      <td className="p-2 text-right"><StatusPill tone={adhTone(p.adherencePct)} dot={false}>{pctText(p.adherencePct)}</StatusPill></td>
                      <td className="p-2 text-right tabular-nums">{pctText(p.punctualityPct)}</td>
                      <td className="p-2"><div className="flex justify-end"><BucketBar n={p} lateBuckets={r.lateBuckets} /></div></td>
                      <td className="p-2 text-right tabular-nums">
                        {p.leftEarly + p.missedLogout === 0 ? <span className="text-slate-500">0</span>
                          : <span title={`${p.leftEarly} left early, ${p.missedLogout} no punch-out`}>{p.leftEarly + p.missedLogout}</span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-border bg-slate-50">
                        <td colSpan={headers.length} className="p-3">
                          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                            <SubTable title="By shift slot" labelHead="Shift" rows={p.slots.map((s) => ({ name: s.shift, n: s, drill: (st: DrillStatus) => open_(p, st, { shift: s.shift }) }))} lateBuckets={r.lateBuckets} />
                            <SubTable title="By reporting manager" labelHead="Manager" rows={p.managers.map((m) => ({ name: m.manager, n: m, drill: (st: DrillStatus) => open_(p, st, { manager: m.manager }) }))} lateBuckets={r.lateBuckets} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-slate-600">
        <span className="font-semibold">Late spread:</span>
        {r?.lateBuckets.map((b) => (<span key={b.key} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${BUCKET_COLOR[b.key]}`} aria-hidden />{b.label}</span>))}
        <span className="ml-auto">Target {ADHERENCE_TARGET}% · green at or above target · amber {ADHERENCE_WARN}–{ADHERENCE_TARGET - 1}% · red below {ADHERENCE_WARN}%</span>
      </div>

      <DetailDrawer open={!!drill} onOpenChange={(o) => !o && setDrill(null)} title={drill?.title ?? "Shift adherence"}
        subtitle={drill ? `${drill.status === "all" ? "All due shifts" : drill.status.replace("_", " ")} · ${r?.date ?? ""}` : undefined}>
        <DrawerSection label={`People${empQ.data ? ` (${empQ.data.total})` : ""}`}>
          {empQ.isLoading ? <div className="h-24 animate-pulse rounded bg-slate-100" role="status" aria-label="Loading people" />
            : empQ.isError ? <p className="text-sm text-red-800" role="alert">Could not load the list. <button type="button" className="cursor-pointer underline" onClick={() => empQ.refetch()}>Retry</button></p>
            : !empQ.data?.employees.length ? <p className="text-sm text-slate-600">Nobody matches.</p>
            : (
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-600"><tr><th className="py-1 text-left font-semibold">Employee</th><th className="text-left font-semibold">Shift</th><th className="text-right font-semibold">In</th><th className="text-right font-semibold">Out</th><th className="text-right font-semibold">Status</th></tr></thead>
                <tbody>
                  {empQ.data.employees.map((e) => (
                    <tr key={e.employeeId} className="border-t border-border">
                      <td className="py-1.5"><div className="font-medium text-slate-900">{e.employeeName}</div><div className="text-xs text-slate-600">{e.employeeCode} · {e.manager}</div></td>
                      <td className="tabular-nums text-slate-700">{e.shift}</td>
                      <td className="text-right tabular-nums">{e.clockIn ?? "—"}</td>
                      <td className="text-right tabular-nums">{e.clockOut ?? "—"}</td>
                      <td className="text-right">
                        <StatusPill tone={STATUS_TONE[e.status] ?? "neutral"}>{e.status === "late" ? `Late ${e.lateMin}m` : STATUS_LABEL[e.status] ?? e.status}</StatusPill>
                        {e.leftEarly && <div className="text-[11px] text-amber-800">left {e.earlyOutMin}m early</div>}
                        {e.missedLogout && <div className="text-[11px] text-amber-800">no punch-out</div>}
                      </td>
                    </tr>))}
                </tbody>
              </table>
            )}
          {empQ.data && empQ.data.total > empQ.data.employees.length && <p className="text-xs text-slate-600">Showing the first {empQ.data.employees.length} of {empQ.data.total}.</p>}
        </DrawerSection>
      </DetailDrawer>
    </ConsoleCard>
  );
}

function SubTable({ title, labelHead, rows, lateBuckets }: {
  title: string; labelHead: string; lateBuckets: Report["lateBuckets"];
  rows: Array<{ name: string; n: Node; drill: (s: DrillStatus) => void }>;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-card">
      <h4 className="border-b border-border p-2 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h4>
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted"><tr>
            <th className="p-1.5 text-left font-semibold">{labelHead}</th><th className="p-1.5 text-right font-semibold">Due</th><th className="p-1.5 text-right font-semibold">On time</th>
            <th className="p-1.5 text-right font-semibold">Late</th><th className="p-1.5 text-right font-semibold">No show</th><th className="p-1.5 text-right font-semibold">Adh.</th><th className="p-1.5 text-right font-semibold">Spread</th>
          </tr></thead>
          <tbody>
            {rows.map(({ name, n, drill }) => (
              <tr key={name} className="border-t border-border">
                <td className="max-w-[180px] truncate p-1.5 font-medium text-slate-900" title={name}>{name}</td>
                <td className="p-1.5 text-right tabular-nums">{n.planned}</td>
                <td className="p-1.5 text-right tabular-nums">{n.onTime}</td>
                <td className="p-1.5 text-right"><CountButton n={n.late} label={`${n.late} late for ${name}`} tone="text-amber-800" onClick={() => drill("late")} /></td>
                <td className="p-1.5 text-right"><CountButton n={n.absent} label={`${n.absent} no show for ${name}`} tone="text-red-800" onClick={() => drill("absent")} /></td>
                <td className="p-1.5 text-right"><StatusPill tone={adhTone(n.adherencePct)} dot={false}>{pctText(n.adherencePct)}</StatusPill></td>
                <td className="p-1.5"><div className="flex justify-end"><BucketBar n={n} lateBuckets={lateBuckets} /></div></td>
              </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
