import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCheck, Loader2, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";

/**
 * Bulk attendance correction across a branch.
 *
 * WHY THIS SCREEN EXISTS
 *   The per-employee flow is right for one person who forgot to punch. It is the wrong shape
 *   for a device outage: Delhi Office ran 612 August attendance rows of which 100% were
 *   missing_punch, across 51 people. Clearing that one employee at a time is 51 submissions,
 *   which is why it does not get cleared — and every uncleared day is an unpaid day.
 *
 * WHAT IT IS NOT
 *   It does not edit attendance. Selecting rows RAISES regularization requests that still go
 *   through the normal manager -> WFM -> (frozen months) Payroll approval chain. The wording on
 *   screen says so, because a bulk tool that looked like a direct edit would get used like one.
 *
 * The grid is deliberately plain. This is a clearing screen someone works through under time
 * pressure at month end; the useful signal is which rows are selected and how many remain, not
 * decoration.
 */

/** Server caps a single bulk call at 500 employee-date pairs. */
const MAX_PAIRS_PER_CALL = 500;
/** The listing endpoint caps at 200 per page. */
const PAGE_LIMIT = 200;

interface MismatchRow {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  record_date: string;
  attendance_status: string;
  branch_name: string | null;
  process_name: string | null;
  is_locked?: number;
}

interface BulkResult {
  employees: number;
  succeeded: number;
  failed: number;
  denied: number;
  data: Array<{ employeeId: string; date: string; success: boolean; message?: string }>;
}

/** `YYYY-MM-DD` from whatever shape the API returns for a date. */
function toIsoDate(value: string): string {
  return String(value).slice(0, 10);
}

export default function BulkBranchCorrection({ branches = [] }: { branches?: Array<{ id: string; name: string }> }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [branchId, setBranchId] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [queried, setQueried] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [requestedStatus, setRequestedStatus] = useState<string>("present");
  const [reason, setReason] = useState("");

  const rangeValid = Boolean(fromDate && toDate && fromDate <= toDate);

  const { data, isFetching, error } = useQuery({
    queryKey: ["bulk-branch-mismatches", branchId, fromDate, toDate],
    enabled: queried && rangeValid,
    queryFn: async () => {
      const params = new URLSearchParams({ fromDate, toDate, limit: String(PAGE_LIMIT) });
      if (branchId !== "all") params.set("branchId", branchId);
      const res = await hrmsApi.get<{ data: MismatchRow[]; total?: number }>(
        `/api/wfm/mismatches?${params.toString()}`,
      );
      return res;
    },
  });

  const rows: MismatchRow[] = (data as any)?.data ?? [];
  const total: number = Number((data as any)?.total ?? rows.length);
  // The endpoint pages at 200. Saying so beats a grid that silently shows a slice of the problem.
  const truncated = total > rows.length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.employee_code?.toLowerCase().includes(q) ||
        r.employee_name?.toLowerCase().includes(q),
    );
  }, [rows, search]);

  /** Locked days are excluded from selection — payroll has already closed over them. */
  const selectableIds = useMemo(
    () => visible.filter((r) => !r.is_locked).map((r) => r.id),
    [visible],
  );

  const allVisibleSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) selectableIds.forEach((id) => next.delete(id));
      else selectableIds.forEach((id) => next.add(id));
      return next;
    });
  }

  /** Group the selected rows into the endpoint's per-employee shape. */
  const targets = useMemo(() => {
    const byEmployee = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!selected.has(row.id)) continue;
      const dates = byEmployee.get(row.employee_id) ?? new Set<string>();
      dates.add(toIsoDate(row.record_date));
      byEmployee.set(row.employee_id, dates);
    }
    return Array.from(byEmployee.entries()).map(([employeeId, dates]) => ({
      employeeId,
      sessionDates: Array.from(dates).sort(),
    }));
  }, [rows, selected]);

  const pairCount = targets.reduce((n, t) => n + t.sessionDates.length, 0);
  const overLimit = pairCount > MAX_PAIRS_PER_CALL;
  const reasonTooShort = reason.trim().length < 10;
  const canSubmit = pairCount > 0 && !overLimit && !reasonTooShort;

  const submit = useMutation({
    mutationFn: async () => {
      const res = await hrmsApi.post<{ data?: BulkResult } & BulkResult>(
        "/api/wfm/regularizations/bulk-multi-employee",
        { targets, requestedStatus, reason: reason.trim() },
      );
      return ((res as any)?.data ?? res) as BulkResult;
    },
    onSuccess: (result) => {
      const { succeeded = 0, failed = 0, denied = 0 } = result ?? {};
      if (failed > 0) {
        const first = (result?.data ?? [])
          .filter((r) => !r.success)
          .slice(0, 3)
          .map((r) => `${r.date}: ${r.message ?? "failed"}`)
          .join("; ");
        toast({
          title: `${succeeded} raised, ${failed} skipped${denied ? ` (${denied} out of scope)` : ""}`,
          description: first,
          variant: "destructive",
        });
      } else {
        toast({
          title: `${succeeded} correction(s) raised`,
          description: "All are pending approval — they do not change attendance until approved.",
        });
      }
      setSelected(new Set());
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["bulk-branch-mismatches"] });
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not raise corrections",
        description: err instanceof Error ? err.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-4">
      {/* Says what this does before anyone selects anything. */}
      <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" aria-hidden="true" />
        <div className="text-sm text-sky-900">
          <p className="font-semibold">This raises correction requests — it does not change attendance.</p>
          <p className="mt-1 text-sky-800">
            Every row you select becomes a regularization request pending the normal approval chain.
            Locked days are excluded because payroll has already closed over them.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-[1fr_170px_170px_auto]">
        <Select value={branchId} onValueChange={(v) => { setBranchId(v); setQueried(false); }}>
          <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-sm" aria-label="Branch">
            <SelectValue placeholder="All branches" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All branches</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date" value={fromDate} aria-label="From date"
          onChange={(e) => { setFromDate(e.target.value); setQueried(false); }}
          className="h-10 rounded-xl border-slate-200 bg-white text-sm"
        />
        <Input
          type="date" value={toDate} aria-label="To date"
          onChange={(e) => { setToDate(e.target.value); setQueried(false); }}
          className="h-10 rounded-xl border-slate-200 bg-white text-sm"
        />
        <Button
          className="h-10 cursor-pointer rounded-xl px-4 text-xs font-semibold transition-colors duration-200"
          disabled={!rangeValid || isFetching}
          onClick={() => { setSelected(new Set()); setQueried(true); }}
        >
          {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
          Find exceptions
        </Button>
      </div>

      {fromDate && toDate && !rangeValid && (
        <p className="text-sm text-destructive">The From date must be on or before the To date.</p>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">Could not load attendance exceptions</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "An unexpected error occurred."}
          </p>
        </div>
      )}

      {isFetching && (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-11 rounded-lg" />)}
        </div>
      )}

      {queried && !isFetching && !error && rows.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <CheckCheck className="mx-auto h-6 w-6 text-emerald-600" aria-hidden="true" />
          <p className="mt-2 font-medium text-slate-900">No uncorrected exceptions in this range</p>
          <p className="mt-1 text-sm text-slate-500">Nothing here is blocking payroll.</p>
        </div>
      )}

      {!isFetching && rows.length > 0 && (
        <>
          {truncated && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Showing the first <strong>{rows.length}</strong> of <strong>{total}</strong> exceptions.
                Narrow the date range to work through the rest.
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline" size="sm"
              className="cursor-pointer rounded-lg text-xs transition-colors duration-200"
              onClick={toggleAllVisible}
              disabled={selectableIds.length === 0}
            >
              {allVisibleSelected ? "Clear selection" : `Select all ${selectableIds.length}`}
            </Button>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                placeholder="Filter by name or code..." value={search}
                onChange={(e) => setSearch(e.target.value)} aria-label="Filter employees"
                className="h-9 rounded-lg border-slate-200 bg-white pl-9 text-sm"
              />
            </div>
            <span className="text-sm text-slate-600">
              <strong>{pairCount}</strong> selected across <strong>{targets.length}</strong> employee(s)
            </span>
          </div>

          <div className="max-h-[420px] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2"><span className="sr-only">Select</span></th>
                  <th scope="col" className="px-3 py-2">Employee</th>
                  <th scope="col" className="px-3 py-2">Date</th>
                  <th scope="col" className="px-3 py-2">Status</th>
                  <th scope="col" className="px-3 py-2">Branch</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const locked = Boolean(row.is_locked);
                  const isSelected = selected.has(row.id);
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        "border-t border-slate-100 transition-colors duration-150",
                        locked ? "bg-slate-50 text-slate-400" : "hover:bg-slate-50",
                        isSelected && "bg-sky-50 hover:bg-sky-50",
                      )}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox" checked={isSelected} disabled={locked}
                          onChange={() => toggle(row.id)}
                          className={cn("h-4 w-4 rounded border-slate-300", !locked && "cursor-pointer")}
                          aria-label={`Select ${row.employee_code} on ${toIsoDate(row.record_date)}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium text-slate-900">{row.employee_code}</span>
                        <span className="ml-2 text-slate-500">{row.employee_name}</span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{toIsoDate(row.record_date)}</td>
                      <td className="px-3 py-2">
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                          {row.attendance_status}
                        </span>
                        {locked && <span className="ml-2 text-xs italic">locked</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{row.branch_name ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Submit */}
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
              <div>
                <label htmlFor="bbc-status" className="mb-1 block text-xs font-medium text-slate-600">Correct to</label>
                <Select value={requestedStatus} onValueChange={setRequestedStatus}>
                  <SelectTrigger id="bbc-status" className="h-10 rounded-xl border-slate-200 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="present">Present</SelectItem>
                    <SelectItem value="half_day">Half day</SelectItem>
                    <SelectItem value="leave_approved">Approved leave</SelectItem>
                    <SelectItem value="week_off">Week off</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label htmlFor="bbc-reason" className="mb-1 block text-xs font-medium text-slate-600">
                  Reason <span className="text-slate-400">— recorded against every request in this batch</span>
                </label>
                <Textarea
                  id="bbc-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Biometric device outage at Delhi Office, 1-17 Aug; verified against security register"
                  className="min-h-[40px] rounded-xl border-slate-200 text-sm"
                />
              </div>
            </div>

            {overLimit && (
              <p className="text-sm text-destructive">
                {pairCount} selected — the limit is {MAX_PAIRS_PER_CALL} per submission. Deselect some rows or
                narrow the date range.
              </p>
            )}
            {!overLimit && pairCount > 0 && reasonTooShort && (
              <p className="text-sm text-slate-500">Add a reason of at least 10 characters to submit.</p>
            )}

            <Button
              className="h-10 cursor-pointer rounded-xl px-4 text-xs font-semibold transition-colors duration-200"
              disabled={!canSubmit || submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                : <CheckCheck className="mr-2 h-4 w-4" aria-hidden="true" />}
              {submit.isPending
                ? "Raising..."
                : `Raise ${pairCount} correction${pairCount === 1 ? "" : "s"} for approval`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
