import { useState, useEffect, useCallback } from "react";
import { CheckCircle, AlertTriangle, Eye, X, ChevronRight, FileText } from "lucide-react";
import { hrmsApi } from "../lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MismatchCase {
  id: string;
  candidate_id: string;
  candidate_full_name: string;
  candidate_code: string;
  mobile: string;
  email?: string;
  name_on_cheque: string;
  name_in_profile: string;
  account_holder_name: string;
  bank_name: string;
  ifsc_code: string;
  account_no_masked?: string;
  account_type?: string;
  cheque_file_url?: string;
  cheque_mime_type?: string;
  match_status: string;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(s: string) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    mismatch:          { label: "Mismatch",          cls: "bg-amber-100 text-amber-800" },
    manual_validated:  { label: "Validated",         cls: "bg-green-100 text-green-700" },
    matched:           { label: "Matched",           cls: "bg-blue-100 text-blue-700" },
    rejected:          { label: "Rejected",          cls: "bg-red-100 text-red-700" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

interface DrawerProps {
  rec: MismatchCase;
  onClose: () => void;
  onSaved: () => void;
}

function DetailDrawer({ rec, onClose, onSaved }: DrawerProps) {
  const [decision, setDecision] = useState<"manual_validated" | "rejected" | "">("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [imgError, setImgError] = useState(false);

  async function submit() {
    if (!decision) { setErr("Select a decision before submitting."); return; }
    setSaving(true);
    setErr("");
    try {
      await hrmsApi.patch(`/api/payroll/cheque-validation/${rec.id}`, { decision, note: note.trim() || undefined });
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? "Failed to save decision.");
    } finally {
      setSaving(false);
    }
  }

  const namesDiffer = rec.name_in_profile?.toLowerCase().trim() !== rec.name_on_cheque?.toLowerCase().trim();

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Cheque Name Verification</h2>
            <p className="text-sm text-gray-500">{rec.candidate_full_name} · {rec.candidate_code}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Name comparison */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Name Comparison</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Name in Profile</p>
                <p className="text-sm font-medium text-gray-900 break-words">{rec.name_in_profile || "—"}</p>
              </div>
              <div className={`rounded-lg p-3 ${namesDiffer ? "bg-amber-50 border border-amber-200" : "bg-gray-50"}`}>
                <p className="text-xs text-gray-500 mb-1">Name on Cheque</p>
                <p className={`text-sm font-medium break-words ${namesDiffer ? "text-amber-800" : "text-gray-900"}`}>
                  {rec.name_on_cheque || "—"}
                </p>
              </div>
            </div>
            {namesDiffer && (
              <div className="flex items-center gap-2 mt-2 text-amber-700 text-xs">
                <AlertTriangle size={13} />
                <span>Names do not match — manual review required</span>
              </div>
            )}
          </div>

          {/* Bank details */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Bank Details</p>
            <div className="bg-gray-50 rounded-lg p-3 grid grid-cols-2 gap-y-2 text-sm">
              <div>
                <p className="text-xs text-gray-500">Bank</p>
                <p className="font-medium text-gray-800">{rec.bank_name || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">IFSC</p>
                <p className="font-medium text-gray-800">{rec.ifsc_code || "—"}</p>
              </div>
              {rec.account_no_masked && (
                <div>
                  <p className="text-xs text-gray-500">Account No.</p>
                  <p className="font-medium text-gray-800">{rec.account_no_masked}</p>
                </div>
              )}
              {rec.account_type && (
                <div>
                  <p className="text-xs text-gray-500">Type</p>
                  <p className="font-medium text-gray-800 capitalize">{rec.account_type}</p>
                </div>
              )}
            </div>
          </div>

          {/* Cheque image */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Cancelled Cheque</p>
            {rec.cheque_file_url && !imgError ? (
              <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                <img
                  src={rec.cheque_file_url}
                  alt="Cancelled cheque"
                  className="w-full object-contain max-h-48"
                  onError={() => setImgError(true)}
                />
              </div>
            ) : rec.cheque_file_url && !imgError ? null : (
              <div className="border border-dashed border-gray-300 rounded-lg p-6 flex flex-col items-center gap-2 text-gray-400">
                <FileText size={24} />
                <p className="text-xs">No cheque image uploaded</p>
              </div>
            )}
            {rec.cheque_file_url && (
              <a
                href={rec.cheque_file_url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 text-xs text-blue-600 hover:underline flex items-center gap-1"
              >
                <Eye size={11} /> View full image
              </a>
            )}
          </div>

          {/* Decision */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Decision</p>
            <div className="space-y-2">
              {[
                { value: "manual_validated", label: "Approve — Name verified manually", desc: "Employee will be marked payroll-ready" },
                { value: "rejected",         label: "Reject — Name mismatch cannot be resolved", desc: "Employee will not proceed to payroll until bank detail is corrected" },
              ].map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer transition-colors ${
                    decision === opt.value ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="cheque_decision"
                    value={opt.value}
                    checked={decision === opt.value}
                    onChange={() => setDecision(opt.value as "manual_validated" | "rejected")}
                    className="mt-0.5 accent-blue-600"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{opt.label}</p>
                    <p className="text-xs text-gray-500">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Remarks <span className="text-gray-400 font-normal normal-case">(optional)</span>
            </label>
            <textarea
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Add any notes about the verification..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {err && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} />
              <span>{err}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !decision}
            className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving ? (
              <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
            ) : "Submit Decision"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NativeChequeNameValidation() {
  const [cases, setCases] = useState<MismatchCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MismatchCase | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: MismatchCase[] }>("/api/payroll/cheque-validation/queue");
      setCases(res.data.data ?? []);
    } catch {
      setCases([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function handleSaved() {
    setSelected(null);
    showToast("Cheque name case updated successfully");
    await load();
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white text-sm px-4 py-3 rounded-lg shadow-lg flex items-center gap-2">
          <CheckCircle size={16} />
          {toast}
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <DetailDrawer rec={selected} onClose={() => setSelected(null)} onSaved={handleSaved} />
      )}

      {/* Page header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Cheque Name Validation</h1>
            <p className="text-sm text-gray-500 mt-0.5">Review and verify name mismatches before payroll onboarding</p>
          </div>
          {!loading && cases.length > 0 && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-amber-100 text-amber-800">
              {cases.length} pending
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-white rounded-xl border border-gray-200 animate-pulse" />
            ))}
          </div>
        ) : cases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CheckCircle size={48} className="text-green-500 mb-3" />
            <h3 className="text-lg font-semibold text-gray-800">All Clear</h3>
            <p className="text-sm text-gray-500 mt-1">No cheque name mismatches pending review</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-4 px-5 py-3 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <span>Candidate</span>
              <span>Name in Profile</span>
              <span>Name on Cheque</span>
              <span>Bank</span>
              <span />
            </div>

            {/* Rows */}
            <div className="divide-y divide-gray-100">
              {cases.map((c) => (
                <div
                  key={c.id}
                  className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-4 items-center px-5 py-4 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setSelected(c)}
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{c.candidate_full_name}</p>
                    <p className="text-xs text-gray-400">{c.candidate_code} · {c.mobile}</p>
                  </div>
                  <p className="text-sm text-gray-700 truncate">{c.name_in_profile || "—"}</p>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm text-amber-700 font-medium truncate">{c.name_on_cheque || "—"}</p>
                    <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-700">{c.bank_name || "—"}</p>
                    <p className="text-xs text-gray-400">{c.ifsc_code}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={c.match_status} />
                    <ChevronRight size={16} className="text-gray-400" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
