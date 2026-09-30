import { DetailDrawer, DrawerSection } from "@/components/wfm/console/DetailDrawer";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { sortRows } from "./insights";
import { THRESH, fmtDate, fmtNum, fmtPct, toneFor, type BreakResponse, type Recommendation, type ShiftListResponse } from "./types";

export type MetricKey = "shifts" | "adherence" | "quality" | "breaks" | "overBreak" | "recs";

const TITLES: Record<MetricKey, string> = {
  shifts: "Shifts analysed", adherence: "Adherence by shift", quality: "Quality by shift",
  breaks: "Break compliance by shift and process", overBreak: "Employees over break allowance", recs: "Shift change recommendations",
};

interface Props {
  metric: MetricKey | null;
  onClose: () => void;
  shifts: ShiftListResponse | undefined;
  breaks: BreakResponse | undefined;
  recs: Recommendation[];
  onOpenShift: (id: string) => void;
  onOpenEmployee: (id: string) => void;
}

const rowBtn = "flex min-h-[44px] w-full cursor-pointer items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0";

/** KPI drill-down: what the tile is made of, each row opening the underlying shift / employee drawer. */
export function MetricDrawer({ metric, onClose, shifts, breaks, recs, onOpenShift, onOpenEmployee }: Props) {
  const list = shifts?.shifts ?? [];
  const w = shifts?.window.cur;
  const shiftRows = (get: (s: (typeof list)[number]) => number | null, fmt: (s: (typeof list)[number]) => string) =>
    sortRows(list, get, "asc").map((s) => (
      <li key={s.shiftId}>
        <button type="button" className={rowBtn} onClick={() => onOpenShift(s.shiftId)}>
          <span><span className="font-medium text-slate-900">{s.shiftName}</span> <span className="text-xs text-slate-600">{s.shiftTime} · {fmtNum(s.totalEmployees)} employees</span></span>
          <span className="tabular-nums">{fmt(s)}</span>
        </button>
      </li>
    ));
  let body: React.ReactNode = undefined;
  if (metric === "shifts" && list.length) body = <ul className="space-y-1.5">{shiftRows((s) => s.scheduledDays, (s) => `${fmtNum(s.scheduledDays)} days`)}</ul>;
  if (metric === "adherence" && list.length)
    body = <ul className="space-y-1.5">{shiftRows((s) => s.metrics.adherencePct, (s) => fmtPct(s.metrics.adherencePct))}</ul>;
  if (metric === "quality" && list.length)
    body = <ul className="space-y-1.5">{shiftRows((s) => s.metrics.qualityAvg, (s) => (s.metrics.qualityAvg == null ? "No scored calls" : fmtPct(s.metrics.qualityAvg)))}</ul>;
  if (metric === "breaks" && breaks) {
    body = (
      <div className="space-y-4">
        <DrawerSection label="By shift">
          {breaks.byShift.length ? (
            <ul className="space-y-1.5">
              {sortRows(breaks.byShift, (s) => s.compliancePct, "asc").map((s) => (
                <li key={s.shiftId}><button type="button" className={rowBtn} onClick={() => onOpenShift(s.shiftId)}>
                  <span className="font-medium text-slate-900">{s.shiftName} <span className="text-xs font-normal text-slate-600">{fmtNum(s.days)} tracked days</span></span>
                  <StatusPill tone={toneFor(s.compliancePct, THRESH.breaks)}>{fmtPct(s.compliancePct)}</StatusPill>
                </button></li>
              ))}
            </ul>
          ) : undefined}
        </DrawerSection>
        <DrawerSection label="By process">
          {breaks.byProcess.length ? (
            <ul className="space-y-1.5">
              {sortRows(breaks.byProcess, (p) => p.compliancePct, "asc").map((p) => (
                <li key={p.processId || p.processName} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                  <span>{p.processName} <span className="text-xs text-slate-600">{fmtNum(p.days)} days, avg excess {p.avgExcessMinutes}m</span></span>
                  <StatusPill tone={toneFor(p.compliancePct, THRESH.breaks)}>{fmtPct(p.compliancePct)}</StatusPill>
                </li>
              ))}
            </ul>
          ) : undefined}
        </DrawerSection>
      </div>
    );
  }
  if (metric === "overBreak" && breaks?.topViolators.length)
    body = (
      <ul className="space-y-1.5">
        {breaks.topViolators.map((v) => (
          <li key={v.employeeId}><button type="button" className={rowBtn} onClick={() => onOpenEmployee(v.employeeId)}>
            <span><span className="font-medium text-slate-900">{v.employeeName}</span> <span className="text-xs text-slate-600">{v.employeeCode} · last {fmtDate(v.lastViolation)}</span></span>
            <span className="tabular-nums text-red-800">+{v.avgExcessMinutes}m on {v.occurrences}/{v.daysObserved} days</span>
          </button></li>
        ))}
      </ul>
    );
  if (metric === "recs" && recs.length)
    body = (
      <ul className="space-y-1.5">
        {recs.map((r) => (
          <li key={r.employeeId}><button type="button" className={rowBtn} onClick={() => onOpenEmployee(r.employeeId)}>
            <span><span className="font-medium text-slate-900">{r.employeeName}</span> <span className="text-xs text-slate-600">{r.currentShift} to {r.recommendedShift}</span></span>
            <span className="tabular-nums">+{r.expectedImprovement} pts</span>
          </button></li>
        ))}
      </ul>
    );
  return (
    <DetailDrawer open={!!metric} onOpenChange={(o) => !o && onClose()} title={metric ? TITLES[metric] : ""} subtitle={w ? `${fmtDate(w.from)} to ${fmtDate(w.to)} (last 30 completed days)` : undefined}>
      <DrawerSection label="Contributing records">{body}</DrawerSection>
    </DetailDrawer>
  );
}
