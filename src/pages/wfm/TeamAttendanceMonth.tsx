import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, CheckCheck, Download, Flag, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { MonthGrid } from "@/components/attendance/month-grid/MonthGrid";
import { GridLegend } from "@/components/attendance/month-grid/GridLegend";
import {
  currentIstMonth, useTeamAttendanceMonth,
  type TeamMonthDay, type TeamMonthEmployee,
} from "@/hooks/useTeamAttendanceMonth";
import { cn } from "@/lib/utils";

/**
 * Team Attendance — the closure screen.
 *
 * Built to answer one question fast: what stops this month being closed? Everything
 * that blocks payroll renders as "needs attention", so a grid with no orange in it is
 * a month payroll can calculate. The filters are client-side over data already
 * fetched — a manager clearing a month should not wait on a round trip per click.
 */

type Lens = "all" | "attention" | "absent";

export default function TeamAttendanceMonth() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [month, setMonth] = useState(currentIstMonth);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [lens, setLens] = useState<Lens>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isError, error, refetch } = useTeamAttendanceMonth(month, { search });

  const employees = data?.employees ?? [];

  const visible = useMemo(() => {
    if (lens === "all") return employees;
    if (lens === "attention") return employees.filter((e) => e.counts.needsAttention > 0);
    return employees.filter((e) => e.counts.absent > 0);
  }, [employees, lens]);

  /** Every pending regularization on screen — what "approve all" would act on. */
  const pendingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const emp of visible) {
      for (const d of emp.days) if (d.pendingRegularizationId) ids.add(d.pendingRegularizationId);
    }
    return [...ids];
  }, [visible]);

  const toggleCell = (emp: TeamMonthEmployee, day: TeamMonthDay) => {
    if (!day.applicable) return;
    const key = `${emp.employeeId}:${day.d}`;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  async function bulkApprove() {
    if (pendingIds.length === 0) return;
    setBusy(true);
    try {
      const res = await hrmsApi.patch<any>("/api/wfm/regularizations/bulk-review", {
        ids: pendingIds,
        status: "approved",
      });
      // The endpoint answers 207 with a per-id verdict. Reporting a blanket success
      // here would tell a manager the month is clear when half of it was refused.
      const results: any[] = res?.data ?? [];
      const ok = results.filter((r) => r.success).length;
      const failed = results.length - ok;
      toast({
        title: failed ? `${ok} approved, ${failed} could not be` : `${ok || pendingIds.length} approved`,
        description: failed
          ? results.filter((r) => !r.success).slice(0, 3).map((r) => r.message).join(" · ")
          : "Attendance updated for the approved days.",
        variant: failed ? "destructive" : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["team-attendance-month"] });
    } catch (e) {
      toast({
        title: "Could not approve",
        description: e instanceof Error ? e.message : "The bulk approval failed.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function raiseForSelected() {
    if (selected.size === 0) return;
    const reason = window.prompt(
      `Raise a correction request for ${selected.size} selected day(s). Reason:`,
    );
    if (!reason?.trim()) return;

    setBusy(true);
    try {
      const byEmployee = new Map<string, string[]>();
      for (const key of selected) {
        const [empId, date] = key.split(":");
        if (!byEmployee.has(empId)) byEmployee.set(empId, []);
        byEmployee.get(empId)!.push(date);
      }
      let created = 0;
      const failures: string[] = [];
      for (const [employeeId, dates] of byEmployee) {
        try {
          await hrmsApi.post("/api/wfm/regularizations/batch", {
            employeeId,
            dates,
            reason: reason.trim(),
            requestedStatus: "present",
          });
          created += dates.length;
        } catch (e) {
          failures.push(e instanceof Error ? e.message : String(e));
        }
      }
      toast({
        title: failures.length ? `${created} raised, ${failures.length} employee(s) failed` : `${created} request(s) raised`,
        description: failures.length ? failures.slice(0, 2).join(" · ") : "They now await approval in the normal flow.",
        variant: failures.length ? "destructive" : undefined,
      });
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: ["team-attendance-month"] });
    } finally {
      setBusy(false);
    }
  }

  async function flagSelected() {
    if (selected.size === 0) return;
    const note = window.prompt(
      `Flag ${selected.size} day(s) to the employee. What should they look at?`,
    );
    if (!note?.trim()) return;

    setBusy(true);
    try {
      const items = [...selected].map((key) => {
        const [employeeId, date] = key.split(":");
        return { employeeId, date };
      });
      const res = await hrmsApi.post<any>("/api/wfm/attendance/team-month/flag", {
        items,
        note: note.trim(),
      });
      // An employee with no login cannot receive an inbox item. Saying so beats a
      // clean success message for a notice that never arrived.
      const extra = [
        res?.skipped_no_account ? `${res.skipped_no_account} have no login account` : "",
        res?.skipped_out_of_scope ? `${res.skipped_out_of_scope} outside your team` : "",
      ].filter(Boolean).join(" · ");
      toast({
        title: `${res?.flagged ?? 0} day(s) flagged`,
        description: extra || "The employee has been notified in their inbox.",
        variant: res?.skipped_no_account || res?.skipped_out_of_scope ? "destructive" : undefined,
      });
      setSelected(new Set());
    } catch (e) {
      toast({
        title: "Could not flag",
        description: e instanceof Error ? e.message : "The request failed.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    if (!data) return;
    const header = ["Employee", "Code", "Department", "Process", "Salary Days", "Needs Attention", "Absent",
      ...Array.from({ length: data.days }, (_, i) => String(i + 1))];
    const lines = [header.join(",")];
    for (const emp of visible) {
      const cells = emp.days.map((d) => {
        if (!d.applicable) return "";
        if (!d.hasRecord) return "NO RECORD";
        return d.regularized ? "R" : String(d.status ?? "");
      });
      lines.push([
        `"${emp.employeeName}"`, emp.employeeCode, `"${emp.department ?? ""}"`, `"${emp.process ?? ""}"`,
        emp.salaryDays ?? "", emp.counts.needsAttention, emp.counts.absent, ...cells,
      ].join(","));
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `team-attendance-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const s = data?.summary;

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Team Attendance</h1>
          <p className="text-xs text-slate-500">
            Your direct reports, the whole month. Orange cells are what stops payroll closing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setSearch(searchInput)}
              onBlur={() => setSearch(searchInput)}
              placeholder="Name or code"
              className="h-8 w-44 pl-7 text-xs"
            />
          </div>
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-8 w-36 text-xs"
          />
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={exportCsv} disabled={!data}>
            <Download className="mr-1 h-3.5 w-3.5" /> Export
          </Button>
        </div>
      </header>

      {/* Summary + the one-click lenses. Counts are of DAYS, not employees. */}
      <div className="flex flex-wrap items-center gap-2">
        <LensChip active={lens === "all"} onClick={() => setLens("all")}
          icon={<CalendarDays className="h-3.5 w-3.5" />}
          label="All" value={s?.employees ?? 0} suffix="people" />
        <LensChip active={lens === "attention"} onClick={() => setLens("attention")}
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label="Needs attention" value={s?.needs_attention ?? 0} suffix="days" tone="orange" />
        <LensChip active={lens === "absent"} onClick={() => setLens("absent")}
          label="Absent" value={s?.absent ?? 0} suffix="days" tone="red" />
        <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600">
          Regularized <strong className="text-indigo-700">{s?.regularized ?? 0}</strong>
        </span>
        <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600">
          No record <strong className="text-orange-700">{s?.missing ?? 0}</strong>
        </span>

        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={flagSelected} disabled={busy}>
                <Flag className="mr-1 h-3.5 w-3.5" /> Flag {selected.size}
              </Button>
              <Button size="sm" className="h-8 text-xs" onClick={raiseForSelected} disabled={busy}>
                {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Raise correction for {selected.size}
              </Button>
            </>
          )}
          <Button
            size="sm" variant="outline" className="h-8 text-xs"
            onClick={bulkApprove}
            disabled={busy || pendingIds.length === 0}
            title={pendingIds.length === 0 ? "No pending regularizations on screen" : undefined}
          >
            <CheckCheck className="mr-1 h-3.5 w-3.5" />
            Approve {pendingIds.length} pending
          </Button>
        </div>
      </div>

      {data?.salaryDaysUnavailable && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Salary days could not be loaded, so that column is blank. The attendance grid below is unaffected.
        </p>
      )}

      {isLoading ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
          <p className="text-sm font-semibold text-rose-800">Could not load team attendance.</p>
          <p className="mt-1 text-xs text-rose-700">{(error as Error)?.message}</p>
          <Button size="sm" variant="outline" className="mt-3 h-8 text-xs" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <MonthGrid
            month={data!.month}
            days={data!.days}
            employees={visible}
            selectedKeys={selected}
            onCellClick={toggleCell}
          />
          <GridLegend />
        </>
      )}
    </div>
  );
}

function LensChip({
  active, onClick, label, value, suffix, icon, tone,
}: {
  active: boolean; onClick: () => void; label: string; value: number;
  suffix: string; icon?: React.ReactNode; tone?: "orange" | "red";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors duration-150",
        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
      )}
    >
      {icon}
      {label}
      <strong className={cn(
        active ? "text-white" : tone === "orange" ? "text-orange-700" : tone === "red" ? "text-red-700" : "text-slate-900",
      )}>
        {value}
      </strong>
      <span className={active ? "text-slate-300" : "text-slate-400"}>{suffix}</span>
    </button>
  );
}
