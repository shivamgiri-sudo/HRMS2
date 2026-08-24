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
import { hrmsApi } from "@/lib/hrmsApi";

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
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
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
    <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">Bulk Upload Approvals</h1>
        <p className="text-sm text-slate-600">
          Leave, attendance regularization, incentive and deduction batches uploaded by WFM or a
          Super Admin. Nothing in a pending batch has been applied — approving is what deducts a
          leave balance, corrects an attendance record or releases a deduction to payroll.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">
            Awaiting your approval ({pending.length})
          </h2>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Nothing is waiting for your approval.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Batch</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Branch</th>
                  <th className="px-4 py-2">Uploaded by</th>
                  <th className="px-4 py-2 text-right">Rows</th>
                  <th className="px-4 py-2">Submitted</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pending.map((batch) => (
                  <tr key={batch.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-800">
                      {batch.upload_batch_no}
                      {batch.original_file_name && (
                        <span className="block text-xs font-normal text-slate-500">
                          {batch.original_file_name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-700">
                      {TYPE_LABEL[batch.upload_type_code] ?? batch.upload_type_code}
                    </td>
                    <td className="px-4 py-2 text-slate-700">{batch.branch_name ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-700">{batch.uploaded_by_name ?? "—"}</td>
                    <td className="px-4 py-2 text-right text-slate-700">
                      {batch.imported_rows}
                      {batch.error_rows > 0 && (
                        <span className="ml-1 text-xs text-amber-600">
                          (+{batch.error_rows} rejected)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {formatDateTime(batch.submitted_for_approval_at ?? batch.created_at)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => void openPreview(batch)}
                        className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
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

      {openBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-xl bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {openBatch.upload_batch_no} ·{" "}
                  {TYPE_LABEL[openBatch.upload_type_code] ?? openBatch.upload_type_code}
                </h3>
                <p className="mt-1 max-w-3xl text-xs text-slate-600">
                  {TYPE_EFFECT[openBatch.upload_type_code]}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenBatch(null)}
                className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-auto px-5 py-4">
              {previewLoading ? (
                <p className="py-8 text-center text-sm text-slate-500">Loading rows…</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-2 py-2">#</th>
                      {previewColumns.map((c) => (
                        <th key={c} className="px-2 py-2">{c}</th>
                      ))}
                      <th className="px-2 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {previewRows.map((row) => {
                      const data =
                        parseJson<Record<string, unknown>>(row.normalized_data) ??
                        parseJson<Record<string, unknown>>(row.raw_data) ?? {};
                      const errs = parseJson<string[]>(row.error_messages);
                      return (
                        <tr key={row.row_no} className={row.row_status === "error" ? "bg-rose-50" : ""}>
                          <td className="px-2 py-1.5 text-slate-500">{row.row_no}</td>
                          {previewColumns.map((c) => (
                            <td key={c} className="px-2 py-1.5 text-slate-700">
                              {String(data[c] ?? "")}
                            </td>
                          ))}
                          <td className="px-2 py-1.5">
                            {row.row_status === "error" ? (
                              <span className="text-rose-600">
                                {Array.isArray(errs) ? errs[0] : "Rejected"}
                              </span>
                            ) : (
                              <span className="text-emerald-700">staged</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="space-y-3 border-t border-slate-200 px-5 py-4">
              <label className="block text-xs font-medium text-slate-700">
                Remarks{" "}
                <span className="font-normal text-slate-500">
                  (required to reject; recorded on the batch and in the audit log either way)
                </span>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Verified against the branch attendance register for August 2026"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={deciding !== null}
                  onClick={() => void decide("reject")}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                >
                  {deciding === "reject" ? "Rejecting…" : "Reject batch"}
                </button>
                <button
                  type="button"
                  disabled={deciding !== null}
                  onClick={() => void decide("approve")}
                  className="rounded-lg border border-emerald-200 bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {deciding === "approve" ? "Applying…" : `Approve ${openBatch.imported_rows} row(s)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Recent decisions</h2>
        </div>
        {history.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">No decisions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Batch</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Outcome</th>
                  <th className="px-4 py-2">Decided</th>
                  <th className="px-4 py-2">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((batch) => (
                  <tr key={batch.id}>
                    <td className="px-4 py-2 font-medium text-slate-800">{batch.upload_batch_no}</td>
                    <td className="px-4 py-2 text-slate-700">
                      {TYPE_LABEL[batch.upload_type_code] ?? batch.upload_type_code}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          batch.approval_status === "approved"
                            ? "text-emerald-700"
                            : batch.approval_status === "rejected"
                              ? "text-rose-700"
                              : "text-amber-700"
                        }
                      >
                        {batch.approval_status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {formatDateTime(batch.approved_at)}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">{batch.error_summary ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
