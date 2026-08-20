/**
 * Roster Builder — page shell + cycle picker (Task 7 of the WFM Roster Builder plan).
 *
 * Finds-or-creates a weekly_roster_cycle via the EXISTING, unmodified
 * /api/roster-gov/cycles endpoints (roster.governance.routes.ts:171,183). The grid
 * (Task 8) mounts below once a cycleId is set; the bulk-upload panel (Task 9) and publish
 * button (Task 10) mount alongside it.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import RosterPivotGrid from "@/components/wfm/RosterPivotGrid";

// Same minimal shape NativeWFMRoster.tsx uses for the process picker (src/pages/NativeWFMRoster.tsx:7).
interface Process {
  id: string;
  process_name?: string;
  process_code?: string;
}

interface RosterCycle {
  id: string;
  process_id: string;
  branch_id: string | null;
  week_start_date: string;
  week_end_date: string;
  status: string;
}

/**
 * Verified against NativeWFMRoster.tsx (src/pages/NativeWFMRoster.tsx:109), the only other WFM
 * roster page that lists processes: it calls `hrmsApi.get<{ data: Process[] }>("/api/processes")`
 * — NOT `/api/wfm/processes`. `/api/wfm/processes` does exist (backend/src/app.ts:583) but is
 * mounted to `planningModeRouter`, an unrelated endpoint, not a process list.
 *
 * The brief's "Process Name (Cost Centre Name)" label format is also corrected here: process_master
 * (backend/src/modules/process/process.repository.mysql.ts, `SELECT * FROM process_master` via
 * `mapRow`) carries no cost-centre-name column, so there is no such field for `/api/processes` to
 * return. NativeWFMRoster.tsx's own label falls back through `process_name ?? process_code ?? id`
 * with no cost-centre suffix — this page matches that exactly instead of fabricating a field.
 */
function useProcessOptions() {
  return useQuery({
    queryKey: ["roster-builder", "processes"],
    queryFn: async () => (await hrmsApi.get<{ data: Process[] }>("/api/processes")).data ?? [],
  });
}

export default function RosterBuilderPage() {
  const [processId, setProcessId] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [cycleId, setCycleId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: processes } = useProcessOptions();

  const findOrCreateCycle = useMutation({
    mutationFn: async () => {
      const list = await hrmsApi.get<{ data: RosterCycle[] }>(`/api/roster-gov/cycles?process_id=${processId}`);
      const existing = (list.data ?? []).find((c) => c.week_start_date === weekStart);
      if (existing) return existing;
      const created = await hrmsApi.post<{ data: RosterCycle }>("/api/roster-gov/cycles", {
        process_id: processId,
        week_start_date: weekStart,
        week_end_date: weekEnd,
      });
      return created.data as RosterCycle;
    },
    onSuccess: (cycle) => {
      setCycleId(cycle.id);
      queryClient.invalidateQueries({ queryKey: ["roster-builder", "grid"] });
    },
  });

  /**
   * Task 10 — publish. Calls the EXISTING, unmodified
   * POST /api/wfm/roster/publish-to-employees (wfm.routes.ts:1325), which moves this cycle's
   * 'generated' assignments to 'pending_employee_ack' and raises one ROSTER_ACK_PENDING
   * work-inbox item per employee.
   *
   * Deviation from the task-10 brief: `hrmsApi` instead of raw `fetch`, for the same reason as
   * RosterPivotGrid — the route is behind requireAuth + requireRole and a bare fetch sends no
   * bearer token. hrmsApi also surfaces the route's own 409 CYCLE_ALREADY_ADVANCED message
   * (a cycle past the publish step) verbatim, which a raw fetch would flatten.
   */
  const publish = useMutation({
    mutationFn: async () =>
      hrmsApi.post<{ success: boolean; data: { cycleId: string; assignmentsPublished: number; employeesNotified: number } }>(
        "/api/wfm/roster/publish-to-employees",
        { cycleId },
      ),
    onSuccess: () => {
      // final_roster_status changes on every published row, and the grid shows it.
      queryClient.invalidateQueries({ queryKey: ["roster-builder", "grid", cycleId] });
    },
  });

  return (
    <DashboardLayout>
      <div className="flex flex-col h-screen">
        <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-4 shrink-0">
          <h1 className="text-2xl font-black">Roster Builder</h1>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs font-bold uppercase tracking-wider text-slate-600">
              Process
              <select
                aria-label="Process"
                value={processId}
                onChange={(e) => setProcessId(e.target.value)}
                className="mt-1 rounded-xl border border-slate-200 p-2"
              >
                <option value="">Select a process</option>
                {(processes ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.process_name ?? p.process_code ?? p.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs font-bold uppercase tracking-wider text-slate-600">
              Week start
              <input
                aria-label="Week start"
                type="date"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                className="mt-1 rounded-xl border border-slate-200 p-2"
              />
            </label>
            <label className="flex flex-col text-xs font-bold uppercase tracking-wider text-slate-600">
              Week end
              <input
                aria-label="Week end"
                type="date"
                value={weekEnd}
                onChange={(e) => setWeekEnd(e.target.value)}
                className="mt-1 rounded-xl border border-slate-200 p-2"
              />
            </label>
            <button
              type="button"
              disabled={!processId || !weekStart || !weekEnd || findOrCreateCycle.isPending}
              onClick={() => findOrCreateCycle.mutate()}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              Start roster
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-5">
          {!cycleId ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <h3 className="text-base font-bold text-slate-700">No roster started yet</h3>
              <p className="mt-1 text-sm text-slate-500">Select a process and week above, then click Start roster.</p>
            </div>
          ) : (
            <div data-testid="roster-builder-grid">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={publish.isPending}
                  onClick={() => publish.mutate()}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {publish.isPending ? "Publishing…" : "Publish this week's roster"}
                </button>
                {/* Task 9 (minimal, deliberate): RosterImportPage.tsx is outside this
                    subsystem's edit scope, so this is a cycle-aware deep link rather than an
                    embedded panel — the batch is still committed on that page. Embedding it as
                    a real tab (reading these query params and passing cycleId into Task 4's
                    now-cycle-aware commitImportBatch) is the flagged follow-up. */}
                <a
                  href={`/wfm/roster-import?cycleId=${cycleId}&processId=${processId}`}
                  className="text-sm font-bold text-sky-600 underline"
                >
                  Bulk upload this week&rsquo;s roster instead →
                </a>
              </div>
              {publish.isSuccess && (
                <p className="mb-3 text-sm text-emerald-700">
                  Published — {publish.data?.data?.assignmentsPublished ?? 0} assignments moved to pending
                  acknowledgement, {publish.data?.data?.employeesNotified ?? 0} employees notified.
                </p>
              )}
              {publish.isError && (
                <p className="mb-3 text-sm text-rose-600" role="alert">
                  {publish.error instanceof Error ? publish.error.message : "Publish failed"}
                </p>
              )}
              {/* processId is required by the grid: its shift-template picker calls
                  /api/roster-gov/shifts/templates, which 403s a non-admin/hr caller
                  without a process scope (roster.governance.routes.ts:64). */}
              <RosterPivotGrid cycleId={cycleId} processId={processId} />
            </div>
          )}
        </main>
      </div>
    </DashboardLayout>
  );
}
