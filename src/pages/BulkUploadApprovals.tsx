/**
 * Bulk Upload Approvals — the Branch Head queue.
 *
 * Everything a WFM or Super Admin uploads for leave, attendance regularization,
 * incentive or deduction lands here first. Approving is what actually deducts a leave
 * balance, corrects an attendance record or lets a deduction reach payroll, so the
 * screen is built to make the approver look at the rows before deciding rather than
 * approving a row count.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  FileCheck,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { HrmsModernShell } from "@/components/ui/hrms-modern";

interface PendingBatch {
  id: string;
  upload_batch_no: string;
  upload_type_code: string;
  original_file_name: string | null;
  total_rows: number;
  imported_rows: number;
  error_rows: number;
  batch_status: string;
  approval_status: string | null;
  branch_id: string | null;
  branch_name: string | null;
  uploaded_by_name: string | null;
  submitted_for_approval_at: string | null;
  created_at: string;
}

interface DecidedBatch {
  id: string;
  upload_batch_no: string;
  upload_type_code: string;
  total_rows: number;
  imported_rows: number;
  error_rows: number;
  approval_status: string;
  approved_at: string | null;
  approval_remarks: string | null;
  error_summary: string | null;
  branch_name: string | null;
}

interface PreviewRow {
  row_no: number;
  normalized_data: Record<string, unknown> | string | null;
  raw_data: Record<string, unknown> | string | null;
  row_status: string;
  error_messages: string[] | string | null;
  created_entity_type: string | null;
  created_entity_id: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  ATTENDANCE_REGULARIZATION_BULK: "Attendance Regularization",
  LEAVE_APPLICATION_BULK: "Leave Application",
  INCENTIVE_BULK: "Incentive",
  DEDUCTION_BULK: "Deduction",
};

const TYPE_COLOR: Record<string, string> = {
  ATTENDANCE_REGULARIZATION_BULK: "bg-teal-50 text-teal-700 border-teal-200",
  LEAVE_APPLICATION_BULK: "bg-blue-50 text-blue-700 border-blue-200",
  INCENTIVE_BULK: "bg-emerald-50 text-emerald-700 border-emerald-200",
  DEDUCTION_BULK: "bg-amber-50 text-amber-700 border-amber-200",
};

/**
 * What approving actually does, per type. Shown on the confirm step — an approver
 * deducting 400 leave balances deserves to be told that is what the button does.
 */
const TYPE_EFFECT: Record<string, string> = {
  ATTENDANCE_REGULARIZATION_BULK:
    "Approving applies each correction to the employee's attendance record.",
  LEAVE_APPLICATION_BULK:
    "Approving DEDUCTS each employee's leave balance and marks the days as leave. This is the same deduction a manual leave approval makes.",
  INCENTIVE_BULK:
    "Approving makes these incentive amounts payable — payroll picks them up for the pay month automatically.",
  DEDUCTION_BULK:
    "Approving activates these deductions so payroll will recover them in the run month.",
};

function parseJson<T>(value: T | string | null): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TypeBadge({ code }: { code: string }) {
  const label = TYPE_LABEL[code] ?? code;
  const color = TYPE_COLOR[code] ?? "bg-slate-50 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${color}`}>
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "approved")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="h-3 w-3" />
        Approved
      </span>
    );
  if (status === "rejected")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-700 border border-rose-200">
        <XCircle className="h-3 w-3" />
        Rejected
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 border border-amber-200">
      <Clock className="h-3 w-3" />
      {status}
    </span>
  );
}

export default function BulkUploadApprovals() {
  const [pending, setPending] = useState<PendingBatch[]>([]);
  const [history, setHistory] = useState<DecidedBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [openBatch, setOpenBatch] = useState<PendingBatch | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [p, h] = await Promise.all([
        hrmsApi.get<{ success: boolean; data?: PendingBatch[]; message?: string }>(
          "/api/bulk-upload/approvals/pending",
        ),
        hrmsApi.get<{ success: boolean; data?: DecidedBatch[] }>(
          "/api/bulk-upload/approvals/history",
        ),
      ]);
      if (!p.success) throw new Error(p.message || "Could not load the approval queue.");
      setPending(p.data ?? []);
      setHistory(h.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the approval queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openPreview = useCallback(async (batch: PendingBatch) => {
    setOpenBatch(batch);
    setRemarks("");
    setPreviewRows([]);
    setPreviewLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data?: PreviewRow[]; message?: string }>(
        `/api/bulk-upload/approvals/batches/${batch.id}/preview`,
      );
      if (!res.success) throw new Error(res.message || "Could not load the batch rows.");
      setPreviewRows(res.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the batch rows.");
      setOpenBatch(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const decide = useCallback(
    async (decision: "approve" | "reject") => {
      if (!openBatch) return;
      if (decision === "reject" && remarks.trim().length < 10) {
        setError("A rejection needs a remark of at least 10 characters — it is what the uploader has to act on.");
        return;
      }
      const effect = TYPE_EFFECT[openBatch.upload_type_code] ?? "";
      const confirmText =
        decision === "approve"
          ? `Approve ${openBatch.upload_batch_no} (${openBatch.imported_rows} row(s))?\n\n${effect}\n\nOnce approved these records are locked and cannot be discarded.`
          : `Reject ${openBatch.upload_batch_no}? The staged rows will be cancelled and nothing will be applied.`;
      if (!window.confirm(confirmText)) return;

      setDeciding(decision);
      setError("");
      try {
        // The decision runs every domain engine row by row, which for a large batch
        // takes far longer than the default client timeout.
        const res = await hrmsApi.post<{
          success: boolean;
          approval_status?: string;
          applied?: number;
          failed?: number;
          errors?: string[];
          message?: string;
        }>(
          `/api/bulk-upload/approvals/batches/${openBatch.id}/${decision}`,
          { remarks: remarks.trim() },
          300000,
        );
        if (res.message && res.failed) {
          setError(`${res.message} First errors: ${(res.errors ?? []).slice(0, 3).join(" | ")}`);
        }
        setNotice(res.message ?? `Batch ${decision}d.`);
        setOpenBatch(null);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : `Could not ${decision} this batch.`);
      } finally {
        setDeciding(null);
      }
    },
    [openBatch, remarks, load],
  );

  const previewColumns = useMemo(() => {
    const cols = new Set<string>();
    for (const row of previewRows.slice(0, 50)) {
      const data = parseJson<Record<string, unknown>>(row.normalized_data) ??
        parseJson<Record<string, unknown>>(row.raw_data) ?? {};
      for (const key of Object.keys(data)) cols.add(key);
    }
    return [...cols];
  }, [previewRows]);

  return (
    <DashboardLayout>
    <HrmsModernShell
      eyebrow="Workforce Operations"
      title="Bulk Upload Approvals"
      description="Leave, attendance regularization, incentive and deduction batches uploaded by WFM or a Super Admin. Nothing in a pending batch has been applied — approving is what deducts a leave balance, corrects an attendance record or releases a deduction to payroll."
      icon={<FileCheck className="h-6 w-6" />}
      actions={
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition-all duration-200 hover:bg-slate-50 hover:shadow-md cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      }
    >
      {/* Alerts */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 shadow-sm">
          {notice}
        </div>
      )}

      {/* Pending approvals section */}
      <section className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50">
              <Clock className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">Awaiting Your Approval</h2>
              <p className="text-xs text-slate-500">{pending.length} batch{pending.length !== 1 ? "es" : ""} pending</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
            <span className="ml-3 text-sm text-slate-500">Loading…</span>
          </div>
        ) : pending.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 mb-3">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
            <p className="text-sm font-medium text-slate-700">All clear</p>
            <p className="text-xs text-slate-500 mt-1">Nothing is waiting for your approval.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50/80">
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Batch</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Type</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Branch</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Uploaded By</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 text-right">Rows</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Submitted</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pending.map((batch) => (
                  <tr
                    key={batch.id}
                    className="transition-colors duration-150 hover:bg-blue-50/40 cursor-pointer"
                    onClick={() => void openPreview(batch)}
                  >
                    <td className="px-5 py-3">
                      <p className="font-semibold text-slate-800">{batch.upload_batch_no}</p>
                      {batch.original_file_name && (
                        <p className="text-xs text-slate-400 truncate max-w-[180px]">{batch.original_file_name}</p>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <TypeBadge code={batch.upload_type_code} />
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700">{batch.branch_name ?? "—"}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{batch.uploaded_by_name ?? "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <span className="font-semibold text-slate-800">{batch.imported_rows}</span>
                      {batch.error_rows > 0 && (
                        <span className="ml-1 text-xs text-amber-600 font-medium">+{batch.error_rows} err</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">
                      {formatDateTime(batch.submitted_for_approval_at ?? batch.created_at)}
                    </td>
                    <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => void openPreview(batch)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-all duration-200 hover:bg-indigo-100 hover:shadow-sm cursor-pointer"
                      >
                        Review rows
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent decisions section */}
      <section className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
            <CheckCircle2 className="h-4 w-4 text-slate-500" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800">Recent Decisions</h2>
            <p className="text-xs text-slate-500">{history.length} decision{history.length !== 1 ? "s" : ""} recorded</p>
          </div>
        </div>

        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <p className="text-sm text-slate-500">No decisions yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50/80">
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Batch</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Type</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Outcome</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Branch</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Decided</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((batch) => (
                  <tr key={batch.id} className="transition-colors duration-150 hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-semibold text-slate-800">{batch.upload_batch_no}</td>
                    <td className="px-5 py-3">
                      <TypeBadge code={batch.upload_type_code} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={batch.approval_status} />
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">{batch.branch_name ?? "—"}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{formatDateTime(batch.approved_at)}</td>
                    <td className="px-5 py-3 text-xs text-slate-600 max-w-[240px] truncate">{batch.error_summary ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Preview / decision drawer */}
      {openBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-2xl bg-white shadow-2xl border border-slate-200/80">
            {/* Drawer header with gradient accent */}
            <div className="relative overflow-hidden rounded-t-2xl">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-600 via-blue-500 to-cyan-500" />
              <div className="flex items-start justify-between px-6 py-4 pt-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
                    <FileCheck className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold text-slate-900">{openBatch.upload_batch_no}</h3>
                      <TypeBadge code={openBatch.upload_type_code} />
                    </div>
                    <p className="mt-1 max-w-3xl text-xs text-slate-500 leading-relaxed">
                      {TYPE_EFFECT[openBatch.upload_type_code]}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenBatch(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Preview table */}
            <div className="flex-1 overflow-auto border-t border-slate-100 px-6 py-4">
              {previewLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
                  <span className="ml-3 text-sm text-slate-500">Loading rows…</span>
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 rounded-lg">
                      <th className="px-3 py-2 font-bold uppercase tracking-wide text-slate-500">#</th>
                      {previewColumns.map((c) => (
                        <th key={c} className="px-3 py-2 font-bold uppercase tracking-wide text-slate-500">{c}</th>
                      ))}
                      <th className="px-3 py-2 font-bold uppercase tracking-wide text-slate-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {previewRows.map((row) => {
                      const data =
                        parseJson<Record<string, unknown>>(row.normalized_data) ??
                        parseJson<Record<string, unknown>>(row.raw_data) ?? {};
                      const errs = parseJson<string[]>(row.error_messages);
                      return (
                        <tr
                          key={row.row_no}
                          className={row.row_status === "error" ? "bg-rose-50/60" : "hover:bg-slate-50/60"}
                        >
                          <td className="px-3 py-2 font-medium text-slate-400">{row.row_no}</td>
                          {previewColumns.map((c) => (
                            <td key={c} className="px-3 py-2 text-slate-700">
                              {String(data[c] ?? "")}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            {row.row_status === "error" ? (
                              <span className="inline-flex items-center gap-1 text-rose-600 font-medium">
                                <XCircle className="h-3 w-3 shrink-0" />
                                {Array.isArray(errs) ? errs[0] : "Rejected"}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                <CheckCircle2 className="h-3 w-3" />
                                staged
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Decision footer */}
            <div className="space-y-4 border-t border-slate-100 bg-slate-50/60 px-6 py-4 rounded-b-2xl">
              <label className="block text-xs font-semibold text-slate-700">
                Remarks
                <span className="font-normal text-slate-400 ml-1">
                  (required to reject; recorded on the batch and in the audit log either way)
                </span>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={2}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
                  placeholder="Verified against the branch attendance register for August 2026"
                />
              </label>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  {openBatch.imported_rows} row{openBatch.imported_rows !== 1 ? "s" : ""} will be{" "}
                  {openBatch.error_rows > 0 && (
                    <span className="text-amber-600">(+{openBatch.error_rows} skipped errors)</span>
                  )}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={deciding !== null}
                    onClick={() => void decide("reject")}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-50 disabled:opacity-60 cursor-pointer"
                  >
                    <XCircle className="h-4 w-4" />
                    {deciding === "reject" ? "Rejecting…" : "Reject batch"}
                  </button>
                  <button
                    type="button"
                    disabled={deciding !== null}
                    onClick={() => void decide("approve")}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(16,185,129,0.3)] transition-all duration-200 hover:bg-emerald-700 hover:shadow-[0_4px_16px_rgba(16,185,129,0.4)] disabled:opacity-60 cursor-pointer"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {deciding === "approve" ? "Applying…" : `Approve ${openBatch.imported_rows} row(s)`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </HrmsModernShell>
    </DashboardLayout>
  );
}