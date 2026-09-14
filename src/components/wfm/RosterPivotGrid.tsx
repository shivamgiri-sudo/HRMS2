/**
 * RosterPivotGrid — employee-rows x date-columns roster grid (Task 8 of the WFM Roster
 * Builder plan).
 *
 * Reads GET /api/wfm/roster-builder/grid (Task 5) and writes through
 * POST /api/wfm/roster-builder/assign (Task 6). Self-contained: owns its own
 * react-query cache entries and calls `onAssigned` after a successful cell write.
 *
 * Three deliberate deviations from the task-8 brief, each verified against this repo:
 *
 * 1. `hrmsApi` instead of raw `fetch`. Both endpoints sit behind `requireAuth`
 *    (backend/src/modules/wfm/roster-builder.routes.ts:10), and a bare browser `fetch` to
 *    either path sends no Authorization header and no `credentials: "include"` — every call
 *    would 401.
 *    `hrmsApi` (src/lib/hrmsApi.ts) attaches the bearer token and handles the silent
 *    refresh-and-retry, and is what every other page in this codebase uses.
 *
 * 2. A real shift-template picker instead of the brief's `window.prompt` placeholder.
 *    The brief deferred it only because the shiftTemplateId-vs-shift_id question was
 *    open; Task 6 closed it (roster-builder.routes.ts:31-40 — writes go to
 *    wfm_shift_template.id). The options come from the EXISTING, unmodified
 *    GET /api/roster-gov/shifts/templates?process_id= endpoint
 *    (backend/src/modules/roster/roster.governance.routes.ts:64), which returns
 *    `{ data: ShiftTemplate[] }` ordered `shift_code ASC, version DESC` — hence the
 *    highest-version-per-code dedupe below. That endpoint 403s for non-admin/hr callers
 *    without a `process_id`, which is why `processId` is a required prop.
 *
 * 3. A real pivot: the brief laid cells out per employee in row order, so two employees
 *    with different date coverage would render misaligned columns. Columns here are the
 *    sorted union of all dates in the response, and each employee's cells are looked up
 *    by date.
 */

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/** Mirrors backend/src/modules/wfm/roster-builder.service.ts::GridRow exactly. */
export interface GridRow {
  employeeId: string;
  employeeName: string;
  rosterDate: string;
  assignmentId: string | null;
  shiftTemplateId: string | null;
  shiftTemplateName: string | null;
  isWeekOff: boolean;
  finalRosterStatus: string | null;
}

/** Subset of wfm_shift_template returned by /api/roster-gov/shifts/templates. */
export interface ShiftTemplateOption {
  id: string;
  shift_code: string;
  shift_name: string;
  start_time?: string | null;
  end_time?: string | null;
  active_status?: number | string | null;
  version?: number | null;
}

interface Props {
  cycleId: string;
  /** Required: the shift-template list endpoint 403s without a process scope. */
  processId: string;
  branchId?: string;
  employeeSearch?: string;
  onAssigned?: () => void;
}

/**
 * The grid endpoint stringifies whatever mysql2 hands back for a DATE column, which can
 * carry a time part. Column identity here must be the calendar date only.
 */
export function toIsoDate(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (match) return match[1];
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10);
}

/** Newest version of each shift_code, active rows only. */
export function activeTemplates(templates: ShiftTemplateOption[]): ShiftTemplateOption[] {
  const byCode = new Map<string, ShiftTemplateOption>();
  for (const t of templates) {
    if (t.active_status !== undefined && t.active_status !== null && Number(t.active_status) !== 1) continue;
    if (!byCode.has(t.shift_code)) byCode.set(t.shift_code, t); // endpoint already orders version DESC
  }
  return Array.from(byCode.values());
}

function templateLabel(t: ShiftTemplateOption): string {
  const times =
    t.start_time && t.end_time ? ` (${String(t.start_time).slice(0, 5)}-${String(t.end_time).slice(0, 5)})` : "";
  return `${t.shift_name}${times}`;
}

export default function RosterPivotGrid({ cycleId, processId, branchId, employeeSearch, onAssigned }: Props) {
  const queryClient = useQueryClient();

  const gridQuery = useQuery({
    queryKey: ["roster-builder", "grid", cycleId, branchId ?? null, employeeSearch ?? null],
    queryFn: async () => {
      const params = new URLSearchParams({ cycleId });
      if (branchId) params.set("branchId", branchId);
      if (employeeSearch) params.set("employeeSearch", employeeSearch);
      const res = await hrmsApi.get<{ rows: GridRow[] }>(`/api/wfm/roster-builder/grid?${params.toString()}`);
      return res.rows ?? [];
    },
  });

  const templatesQuery = useQuery({
    queryKey: ["roster-builder", "shift-templates", processId],
    enabled: Boolean(processId),
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: ShiftTemplateOption[] }>(
        `/api/roster-gov/shifts/templates?process_id=${encodeURIComponent(processId)}`,
      );
      return res.data ?? [];
    },
  });

  const assign = useMutation({
    mutationFn: async (input: { employeeId: string; rosterDate: string; shiftTemplateId: string }) =>
      hrmsApi.post("/api/wfm/roster-builder/assign", { ...input, cycleId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roster-builder", "grid", cycleId] });
      onAssigned?.();
    },
  });

  const rows = gridQuery.data;
  const templates = useMemo(() => activeTemplates(templatesQuery.data ?? []), [templatesQuery.data]);

  const { dates, employees } = useMemo(() => {
    const dateSet = new Set<string>();
    const byEmployee = new Map<string, { name: string; cells: Map<string, GridRow> }>();
    for (const row of rows ?? []) {
      const date = toIsoDate(row.rosterDate);
      dateSet.add(date);
      const bucket = byEmployee.get(row.employeeId) ?? { name: row.employeeName, cells: new Map<string, GridRow>() };
      bucket.cells.set(date, row);
      byEmployee.set(row.employeeId, bucket);
    }
    return {
      dates: Array.from(dateSet).sort(),
      employees: Array.from(byEmployee.entries()).map(([employeeId, v]) => ({ employeeId, ...v })),
    };
  }, [rows]);

  if (gridQuery.isLoading) {
    return <div className="py-16 text-center text-sm text-slate-500">Loading roster…</div>;
  }
  if (gridQuery.isError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Could not load the roster grid: {gridQuery.error instanceof Error ? gridQuery.error.message : "unknown error"}
      </div>
    );
  }
  if (employees.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h3 className="text-base font-bold text-slate-700">No assignments yet</h3>
        <p className="mt-1 text-sm text-slate-500">
          Bulk-upload this week&rsquo;s roster, or add employees to the cycle first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {assign.isError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700" role="alert">
          {assign.error instanceof Error ? assign.error.message : "Assignment failed"}
        </div>
      )}
      {templates.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          No active shift templates exist for this process, so cells cannot be assigned yet.
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th className="p-2 font-bold text-slate-700">Employee</th>
              {dates.map((date) => (
                <th key={date} className="p-2 font-bold text-slate-700">
                  {date}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map(({ employeeId, name, cells }) => (
              <tr key={employeeId} className="border-b border-slate-100">
                <td className="p-2 font-bold text-slate-800">{name}</td>
                {dates.map((date) => {
                  const cell = cells.get(date);
                  if (!cell) {
                    return (
                      <td key={date} className="p-2 text-slate-300">
                        ·
                      </td>
                    );
                  }
                  if (cell.isWeekOff) {
                    return (
                      <td key={date} className="p-2 text-slate-500" title={cell.finalRosterStatus ?? undefined}>
                        WO
                      </td>
                    );
                  }
                  return (
                    <td key={date} className="p-2" title={cell.finalRosterStatus ?? undefined}>
                      <select
                        aria-label={`Shift for ${name} on ${date}`}
                        value={cell.shiftTemplateId ?? ""}
                        disabled={templates.length === 0 || assign.isPending}
                        onChange={(e) => {
                          const shiftTemplateId = e.target.value;
                          if (!shiftTemplateId || shiftTemplateId === cell.shiftTemplateId) return;
                          assign.mutate({ employeeId, rosterDate: date, shiftTemplateId });
                        }}
                        className="rounded-lg border border-slate-200 p-1 text-xs"
                      >
                        <option value="">—</option>
                        {/* An assignment can point at a template that is no longer active or current;
                            keep it visible rather than silently rendering the cell as unassigned. */}
                        {cell.shiftTemplateId && !templates.some((t) => t.id === cell.shiftTemplateId) && (
                          <option value={cell.shiftTemplateId}>{cell.shiftTemplateName ?? cell.shiftTemplateId}</option>
                        )}
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {templateLabel(t)}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
