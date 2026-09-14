/**
 * Cost-centre-wise review of an incentive or deduction upload batch.
 *
 * Replaces the flat spreadsheet replay for the two money types. An approver decides for a
 * branch, and the unit they reason about is the cost centre — so the batch opens as one
 * row per cost centre with a column per incentive/deduction type, and clicking a row
 * drills into the employees behind it.
 *
 * The drill-down carries the columns the approved design names: Employee name, Employee
 * code, Cost centre, Process name, Reporting manager, one column per type, then Total.
 * Each row can be discarded individually with a mandatory reason, at either approval
 * stage, without bouncing the rest of the batch.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Building2, ChevronRight, Loader2, Trash2, Users } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export interface ReviewType {
  code: string;
  name: string;
}

interface CostCentreRow {
  cost_centre_id: string | null;
  cost_centre_code: string | null;
  cost_centre_name: string;
  process_name: string | null;
  employee_count: number;
  amounts: Record<string, number>;
  total: number;
  discarded_count: number;
}

interface EmployeeRow {
  row_id: string;
  row_no: number;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  cost_centre_name: string;
  cost_centre_code: string | null;
  process_name: string | null;
  reporting_manager_name: string | null;
  amounts: Record<string, number>;
  total: number;
  discarded: boolean;
  discard_reason: string | null;
  discard_stage: string | null;
}

interface ReviewPayload {
  kind: "incentive" | "deduction";
  types: ReviewType[];
  cost_centres: CostCentreRow[];
  grand_total: number;
  employee_count: number;
  discarded_count: number;
}

/** ₹ with Indian grouping. A blank cell, not ₹0.00, where an employee has no such type. */
function money(value: number | undefined | null): string {
  if (value === undefined || value === null || value === 0) return "";
  return `₹${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function moneyStrict(value: number): string {
  return `₹${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Stable key for a cost centre, matching what the API filters on. */
const UNASSIGNED = "Unassigned";
const ccKey = (cc: CostCentreRow) => cc.cost_centre_id ?? UNASSIGNED;

export function BatchCostCentreReview({
  batchId,
  batchNo,
  canDiscard,
  stageLabel,
  onChanged,
}: {
  batchId: string;
  batchNo: string;
  /** Only the approver who owns the current stage may drop a line. */
  canDiscard: boolean;
  stageLabel: string;
  /** Called after a successful discard so the parent can refresh its own totals. */
  onChanged?: () => void;
}) {
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [openCc, setOpenCc] = useState<CostCentreRow | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [employeeTypes, setEmployeeTypes] = useState<ReviewType[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);

  const [discardRow, setDiscardRow] = useState<EmployeeRow | null>(null);
  const [discardReason, setDiscardReason] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState("");
  const [notice, setNotice] = useState("");

  const loadReview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data?: ReviewPayload; message?: string }>(
        `/api/bulk-upload/approvals/batches/${batchId}/cost-centres`,
      );
      if (res.success && res.data) setReview(res.data);
      else setError(res.message ?? "Could not load the cost-centre breakdown.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the cost-centre breakdown.");
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => { void loadReview(); }, [loadReview]);

  const loadEmployees = useCallback(
    async (cc: CostCentreRow) => {
      setEmployeesLoading(true);
      setEmployees([]);
      try {
        const res = await hrmsApi.get<{
          success: boolean; types?: ReviewType[]; data?: EmployeeRow[]; message?: string;
        }>(
          `/api/bulk-upload/approvals/batches/${batchId}/employees?costCentreId=${encodeURIComponent(ccKey(cc))}`,
        );
        if (res.success) {
          setEmployees(res.data ?? []);
          setEmployeeTypes(res.types ?? []);
        }
      } finally {
        setEmployeesLoading(false);
      }
    },
    [batchId],
  );

  const openDrawer = useCallback(
    (cc: CostCentreRow) => {
      setOpenCc(cc);
      void loadEmployees(cc);
    },
    [loadEmployees],
  );

  const submitDiscard = useCallback(async () => {
    if (!discardRow) return;
    const reason = discardReason.trim();
    if (reason.length < 10) {
      setDiscardError("Give a reason of at least 10 characters — the uploader has to act on it.");
      return;
    }
    setDiscarding(true);
    setDiscardError("");
    try {
      const res = await hrmsApi.post<{
        success: boolean; message?: string; discarded?: number; remaining?: number;
      }>(`/api/bulk-upload/approvals/batches/${batchId}/rows/discard`, {
        rowIds: [discardRow.row_id],
        reason,
      });
      if (!res.success) {
        setDiscardError(res.message ?? "The row could not be discarded.");
        return;
      }
      setNotice(res.message ?? "Row discarded.");
      setDiscardRow(null);
      setDiscardReason("");
      await loadReview();
      if (openCc) await loadEmployees(openCc);
      onChanged?.();
    } catch (err) {
      setDiscardError(err instanceof Error ? err.message : "The row could not be discarded.");
    } finally {
      setDiscarding(false);
    }
  }, [batchId, discardRow, discardReason, loadReview, loadEmployees, openCc, onChanged]);

  const typeColumns = review?.types ?? [];
  const kindLabel = review?.kind === "deduction" ? "Deduction" : "Incentive";

  const totals = useMemo(() => {
    const perType: Record<string, number> = {};
    for (const cc of review?.cost_centres ?? []) {
      for (const [code, amt] of Object.entries(cc.amounts)) {
        perType[code] = (perType[code] ?? 0) + amt;
      }
    }
    return perType;
  }, [review]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        <span className="ml-3 text-sm text-slate-500">Loading cost-centre breakdown…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (!review || review.cost_centres.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
        No staged rows in this batch.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {notice && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-medium text-emerald-800">
          {notice}
        </p>
      )}

      {/* Summary tiles — the numbers an approver checks before opening anything */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile
          icon={<Building2 className="h-4 w-4" />}
          label="Cost centres"
          value={String(review.cost_centres.length)}
          tone="blue"
        />
        <SummaryTile
          icon={<Users className="h-4 w-4" />}
          label="Employees"
          value={String(review.employee_count)}
          tone="blue"
        />
        <SummaryTile
          label={`Total ${kindLabel.toLowerCase()}`}
          value={moneyStrict(review.grand_total)}
          tone={review.kind === "deduction" ? "amber" : "green"}
        />
        <SummaryTile
          label="Discarded"
          value={String(review.discarded_count)}
          tone={review.discarded_count > 0 ? "red" : "slate"}
        />
      </div>

      {/* Cost-centre grid. Wide by nature — one column per type — so it scrolls inside
          its own container rather than pushing the page sideways. */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white/95 shadow-sm">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Cost centre</th>
              <th className="px-3 py-2.5 font-semibold">Process</th>
              <th className="px-3 py-2.5 text-right font-semibold">Emp</th>
              {typeColumns.map((t) => (
                <th key={t.code} className="px-3 py-2.5 text-right font-semibold" title={t.name}>
                  {t.code}
                </th>
              ))}
              <th className="px-3 py-2.5 text-right font-bold text-slate-700">Total</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {review.cost_centres.map((cc) => (
              <tr
                key={ccKey(cc)}
                onClick={() => openDrawer(cc)}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(cc); }
                }}
                className="cursor-pointer transition-colors duration-200 hover:bg-blue-50/60 focus:bg-blue-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
              >
                <td className="px-3 py-2.5">
                  <span className="font-semibold text-slate-800">{cc.cost_centre_name}</span>
                  {cc.cost_centre_code && (
                    <span className="ml-1.5 font-mono text-[10px] text-slate-400">{cc.cost_centre_code}</span>
                  )}
                  {cc.discarded_count > 0 && (
                    <span className="ml-2 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                      {cc.discarded_count} discarded
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-slate-600">{cc.process_name ?? "—"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{cc.employee_count}</td>
                {typeColumns.map((t) => (
                  <td key={t.code} className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                    {money(cc.amounts[t.code])}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-900">
                  {moneyStrict(cc.total)}
                </td>
                <td className="pr-3 text-slate-300">
                  <ChevronRight className="h-4 w-4" />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 bg-slate-50/80">
            <tr>
              <td className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-500" colSpan={2}>
                Batch total
              </td>
              <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-700">
                {review.employee_count}
              </td>
              {typeColumns.map((t) => (
                <td key={t.code} className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-700">
                  {money(totals[t.code])}
                </td>
              ))}
              <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-blue-700">
                {moneyStrict(review.grand_total)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">
        Click a cost centre to see every employee in it. Amounts exclude discarded rows.
      </p>

      {/* Drill-down — the mandated employee-wise table */}
      <Sheet open={Boolean(openCc)} onOpenChange={(o) => { if (!o) setOpenCc(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-5xl">
          <SheetHeader>
            <SheetTitle className="text-base">
              {openCc?.cost_centre_name}
              {openCc?.cost_centre_code && (
                <span className="ml-2 font-mono text-xs font-normal text-slate-400">
                  {openCc.cost_centre_code}
                </span>
              )}
            </SheetTitle>
            <p className="text-xs text-slate-500">
              {batchNo} · {openCc?.process_name ?? "No process mapped"} ·{" "}
              {openCc ? moneyStrict(openCc.total) : ""}
            </p>
          </SheetHeader>

          <div className="py-4">
            {employeesLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                <span className="ml-3 text-sm text-slate-500">Loading employees…</span>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[860px] text-left text-xs">
                  <thead className="bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">Employee</th>
                      <th className="px-3 py-2.5 font-semibold">Emp code</th>
                      <th className="px-3 py-2.5 font-semibold">Cost centre</th>
                      <th className="px-3 py-2.5 font-semibold">Process</th>
                      <th className="px-3 py-2.5 font-semibold">Reporting manager</th>
                      {employeeTypes.map((t) => (
                        <th key={t.code} className="px-3 py-2.5 text-right font-semibold" title={t.name}>
                          {t.code}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-right font-bold text-slate-700">Total</th>
                      {canDiscard && <th className="px-3 py-2.5 text-right font-semibold">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {employees.map((emp) => (
                      <tr
                        key={emp.row_id}
                        className={emp.discarded ? "bg-red-50/40 text-slate-400" : "hover:bg-slate-50/60"}
                      >
                        <td className="px-3 py-2.5">
                          <span className={emp.discarded ? "line-through" : "font-semibold text-slate-800"}>
                            {emp.employee_name || "—"}
                          </span>
                          {emp.discarded && (
                            <span
                              className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700"
                              title={emp.discard_reason ?? undefined}
                            >
                              discarded
                            </span>
                          )}
                          {emp.discarded && emp.discard_reason && (
                            <p className="mt-0.5 max-w-xs text-[10px] leading-snug text-red-500">
                              {emp.discard_reason}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-600">{emp.employee_code}</td>
                        <td className="px-3 py-2.5 text-slate-600">{emp.cost_centre_name}</td>
                        <td className="px-3 py-2.5 text-slate-600">{emp.process_name ?? "—"}</td>
                        <td className="px-3 py-2.5 text-slate-600">{emp.reporting_manager_name ?? "—"}</td>
                        {employeeTypes.map((t) => (
                          <td key={t.code} className="px-3 py-2.5 text-right tabular-nums">
                            {money(emp.amounts[t.code])}
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-900">
                          {emp.discarded ? "—" : moneyStrict(emp.total)}
                        </td>
                        {canDiscard && (
                          <td className="px-3 py-2.5 text-right">
                            {!emp.discarded && (
                              <button
                                type="button"
                                onClick={() => { setDiscardRow(emp); setDiscardReason(""); setDiscardError(""); }}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-red-600 transition-all duration-200 hover:bg-red-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                              >
                                <Trash2 className="h-3 w-3" />
                                Discard
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Reason capture — mandatory, and the text the uploader will receive.
        *
        * PORTALLED TO document.body ON PURPOSE. This component renders inside the
        * approvals page's own `fixed z-50` overlay, and the drill-down Sheet portals
        * itself to <body> at z-50. A modal left in the component tree is therefore
        * trapped in the page overlay's stacking context and can never rise above the
        * Sheet, however high its z-index: it mounted, took focus and disabled its own
        * confirm button while being completely invisible behind the drawer. Only the
        * browser showed this — the DOM assertions all passed. */}
      {discardRow && createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label={`Discard ${discardRow.employee_name || discardRow.employee_code}`}
          onClick={(e) => { if (e.target === e.currentTarget && !discarding) setDiscardRow(null); }}
          onKeyDown={(e) => { if (e.key === "Escape" && !discarding) setDiscardRow(null); }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">
              Discard {discardRow.employee_name || discardRow.employee_code}?
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {moneyStrict(discardRow.total)} will be removed from this batch. The rest of the batch
              stays in the queue and can still be approved. {stageLabel} is recorded as the
              discarding stage, and the uploader is emailed the reason below.
            </p>

            <label className="mt-4 block text-xs font-semibold text-slate-700">
              Reason <span className="font-normal text-slate-400">(required, min 10 characters)</span>
              <textarea
                value={discardReason}
                onChange={(e) => setDiscardReason(e.target.value)}
                rows={3}
                autoFocus
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 transition-all focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Amount does not match the approved incentive sheet for this process"
              />
            </label>

            {/* Quick reasons — the common cases, still editable afterwards */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                "Amount does not match the approved incentive sheet",
                "Employee left before the incentive month closed",
                "Duplicate of a line already approved this month",
                "Awaiting confirmation from the process manager",
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setDiscardReason(chip)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 transition-colors duration-200 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 cursor-pointer"
                >
                  {chip}
                </button>
              ))}
            </div>

            {discardError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {discardError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={discarding}
                onClick={() => setDiscardRow(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors duration-200 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={discarding || discardReason.trim().length < 10}
                onClick={() => void submitDiscard()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(220,38,38,0.3)] transition-all duration-200 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                {discarding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Discard row
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

const TONE: Record<string, string> = {
  blue: "border-blue-200 bg-blue-50/70 text-blue-700",
  green: "border-emerald-200 bg-emerald-50/70 text-emerald-700",
  amber: "border-amber-200 bg-amber-50/70 text-amber-700",
  red: "border-red-200 bg-red-50/70 text-red-700",
  slate: "border-slate-200 bg-slate-50 text-slate-600",
};

function SummaryTile({
  icon, label, value, tone,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  tone: keyof typeof TONE | string;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${TONE[tone] ?? TONE.slate}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide opacity-70">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}
