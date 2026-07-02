import { useState, useEffect, useCallback } from "react";
import {
  CheckCircle, XCircle, Eye, Clock, ChevronDown, ChevronUp,
  RefreshCw, ShieldCheck, Send, Loader2, AlertTriangle, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ── Types ────────────────────────────────────────────────────────────────────

type SnapshotType = "kpi" | "governance" | "attrition" | "staffing" | "quality";
type QueueStatus = "pending" | "approved" | "rejected";

interface QueueItem {
  id: string;
  process_id: string;
  snapshot_type: SnapshotType;
  period: string;
  prepared_data: unknown;
  prepared_by: string | null;
  status: QueueStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

interface PublishedSnapshot {
  id: string;
  process_id: string;
  snapshot_type: SnapshotType;
  period: string;
  snapshot_data: unknown;
  approved_by: string;
  approved_at: string;
  is_active: number;
  notes: string | null;
  created_at: string;
}

interface AccessLogEntry {
  id: string;
  client_user_id: string;
  client_user_name: string | null;
  email: string | null;
  page: string;
  ip_address: string | null;
  created_at: string;
}

type Tab = "queue" | "published" | "access-log";

const SNAPSHOT_TYPES: SnapshotType[] = ["kpi", "governance", "attrition", "staffing", "quality"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: QueueStatus }) {
  const styles: Record<QueueStatus, string> = {
    pending: "bg-amber-50 text-amber-700 border border-amber-200",
    approved: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    rejected: "bg-red-50 text-red-700 border border-red-200",
  };
  const icons: Record<QueueStatus, React.ReactNode> = {
    pending: <Clock className="w-3 h-3" />,
    approved: <CheckCircle className="w-3 h-3" />,
    rejected: <XCircle className="w-3 h-3" />,
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${styles[status]}`}>
      {icons[status]}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function TypeBadge({ type }: { type: SnapshotType }) {
  const colors: Record<SnapshotType, string> = {
    kpi: "bg-blue-50 text-blue-700",
    governance: "bg-purple-50 text-purple-700",
    attrition: "bg-orange-50 text-orange-700",
    staffing: "bg-teal-50 text-teal-700",
    quality: "bg-rose-50 text-rose-700",
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${colors[type]}`}>
      {type}
    </span>
  );
}

function fmt(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("default", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Preview Modal ─────────────────────────────────────────────────────────────

function PreviewModal({ data, onClose }: { data: unknown; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-black text-slate-900">Snapshot Preview</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
        <div className="overflow-auto flex-1 p-6">
          <pre className="text-xs text-slate-700 whitespace-pre-wrap break-words font-mono bg-slate-50 rounded-xl p-4 border">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── Reject Modal ──────────────────────────────────────────────────────────────

function RejectModal({
  itemId,
  onClose,
  onDone,
}: {
  itemId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) { setError("Rejection reason is required."); return; }
    setBusy(true);
    try {
      await hrmsApi.patch(`/api/portal/internal/snapshots/${itemId}/review`, {
        action: "rejected",
        rejection_reason: reason.trim(),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-black text-slate-900">Reject Snapshot</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Rejection Reason</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400"
              placeholder="Explain why this snapshot is being rejected..."
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              Reject
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Approval Queue Tab ────────────────────────────────────────────────────────

function ApprovalQueueTab() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previewItem, setPreviewItem] = useState<QueueItem | null>(null);
  const [rejectItemId, setRejectItemId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Prepare new snapshot form
  const [showPrepare, setShowPrepare] = useState(false);
  const [prepForm, setPrepForm] = useState({ process_id: "", snapshot_type: "kpi" as SnapshotType, period: new Date().toISOString().slice(0, 7) });
  const [prepBusy, setPrepBusy] = useState(false);
  const [prepError, setPrepError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ data: QueueItem[] }>("/api/portal/internal/snapshots/queue");
      setItems(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleApprove(id: string) {
    setBusyId(id);
    try {
      await hrmsApi.patch(`/api/portal/internal/snapshots/${id}/review`, { action: "approved" });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to approve.");
    } finally {
      setBusyId(null);
    }
  }

  async function handlePrepare(e: React.FormEvent) {
    e.preventDefault();
    if (!prepForm.process_id.trim()) { setPrepError("Process ID is required."); return; }
    setPrepBusy(true);
    setPrepError("");
    try {
      await hrmsApi.post("/api/portal/internal/snapshots/prepare", prepForm);
      setShowPrepare(false);
      setPrepForm({ process_id: "", snapshot_type: "kpi", period: new Date().toISOString().slice(0, 7) });
      await load();
    } catch (err) {
      setPrepError(err instanceof Error ? err.message : "Failed to prepare snapshot.");
    } finally {
      setPrepBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 font-medium">
          {items.filter(i => i.status === "pending").length} pending item(s)
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg border transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={() => setShowPrepare(v => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
          >
            <Send className="w-4 h-4" /> Prepare New Snapshot
          </button>
        </div>
      </div>

      {/* Prepare form */}
      {showPrepare && (
        <form
          onSubmit={handlePrepare}
          className="bg-blue-50 border border-blue-100 rounded-2xl p-5 space-y-4"
        >
          <h3 className="font-bold text-blue-900 text-sm">Prepare New Snapshot for Approval</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Process ID</label>
              <input
                value={prepForm.process_id}
                onChange={e => setPrepForm(f => ({ ...f, process_id: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="e.g. process-uuid"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Snapshot Type</label>
              <select
                value={prepForm.snapshot_type}
                onChange={e => setPrepForm(f => ({ ...f, snapshot_type: e.target.value as SnapshotType }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {SNAPSHOT_TYPES.map(t => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Period (YYYY-MM)</label>
              <input
                type="month"
                value={prepForm.period}
                onChange={e => setPrepForm(f => ({ ...f, period: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>
          {prepError && <p className="text-sm text-red-600">{prepError}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={prepBusy}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
            >
              {prepBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Submit for Review
            </button>
            <button
              type="button"
              onClick={() => { setShowPrepare(false); setPrepError(""); }}
              className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="font-semibold">No items in the approval queue.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["Process ID", "Type", "Period", "Prepared By", "Submitted", "Status", "Actions"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 max-w-[140px] truncate">{item.process_id}</td>
                  <td className="px-4 py-3"><TypeBadge type={item.snapshot_type} /></td>
                  <td className="px-4 py-3 font-mono text-slate-700">{item.period}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-[120px] truncate">{item.prepared_by ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmt(item.created_at)}</td>
                  <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPreviewItem(item)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 border rounded-lg transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" /> Preview
                      </button>
                      {item.status === "pending" && (
                        <>
                          <button
                            onClick={() => handleApprove(item.id)}
                            disabled={busyId === item.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 border border-emerald-200 rounded-lg disabled:opacity-50 transition-colors"
                          >
                            {busyId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                            Approve
                          </button>
                          <button
                            onClick={() => setRejectItemId(item.id)}
                            disabled={busyId === item.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 border border-red-200 rounded-lg disabled:opacity-50 transition-colors"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Reject
                          </button>
                        </>
                      )}
                      {item.status === "rejected" && item.rejection_reason && (
                        <span className="text-xs text-slate-400 italic max-w-[160px] truncate" title={item.rejection_reason}>
                          "{item.rejection_reason}"
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previewItem && (
        <PreviewModal data={previewItem.prepared_data} onClose={() => setPreviewItem(null)} />
      )}
      {rejectItemId && (
        <RejectModal
          itemId={rejectItemId}
          onClose={() => setRejectItemId(null)}
          onDone={() => { setRejectItemId(null); load(); }}
        />
      )}
    </div>
  );
}

// ── Published Snapshots Tab ───────────────────────────────────────────────────

function PublishedSnapshotsTab() {
  const [snapshots, setSnapshots] = useState<PublishedSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previewSnap, setPreviewSnap] = useState<PublishedSnapshot | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ data: PublishedSnapshot[] }>("/api/portal/internal/snapshots/published");
      setSnapshots(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load snapshots.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDeactivate(id: string) {
    if (!confirm("Deactivate this snapshot? Clients will no longer see this data.")) return;
    setBusyId(id);
    try {
      await hrmsApi.patch(`/api/portal/internal/snapshots/${id}/deactivate`, {});
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to deactivate.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 font-medium">
          {snapshots.filter(s => s.is_active).length} active snapshot(s)
        </p>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg border transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : snapshots.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="font-semibold">No published snapshots yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {snapshots.map(snap => (
            <div
              key={snap.id}
              className={`rounded-2xl border transition-colors ${snap.is_active ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"}`}
            >
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <TypeBadge type={snap.snapshot_type} />
                  <span className="font-mono text-sm text-slate-700 shrink-0">{snap.period}</span>
                  <span className="text-xs text-slate-400 truncate max-w-[140px]">{snap.process_id}</span>
                  {snap.is_active ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400 font-semibold">Inactive</span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setPreviewSnap(snap)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 border rounded-lg transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </button>
                  {snap.is_active && (
                    <button
                      onClick={() => handleDeactivate(snap.id)}
                      disabled={busyId === snap.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 border border-red-200 rounded-lg disabled:opacity-50 transition-colors"
                    >
                      {busyId === snap.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                      Deactivate
                    </button>
                  )}
                  <button
                    onClick={() => setExpandedId(v => v === snap.id ? null : snap.id)}
                    className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    {expandedId === snap.id
                      ? <ChevronUp className="w-4 h-4 text-slate-400" />
                      : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </button>
                </div>
              </div>

              {expandedId === snap.id && (
                <div className="px-5 pb-4 border-t border-slate-100 pt-3">
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <dt className="font-semibold text-slate-400 uppercase tracking-wider">Approved By</dt>
                      <dd className="text-slate-700 mt-0.5 font-mono truncate">{snap.approved_by}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-400 uppercase tracking-wider">Approved At</dt>
                      <dd className="text-slate-700 mt-0.5">{fmt(snap.approved_at)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-400 uppercase tracking-wider">Notes</dt>
                      <dd className="text-slate-700 mt-0.5">{snap.notes ?? "—"}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {previewSnap && (
        <PreviewModal data={previewSnap.snapshot_data} onClose={() => setPreviewSnap(null)} />
      )}
    </div>
  );
}

// ── Access Log Tab ────────────────────────────────────────────────────────────

function AccessLogTab() {
  const [logs, setLogs] = useState<AccessLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState({ process_id: "", from_date: "", to_date: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filter.process_id) params.set("process_id", filter.process_id);
      if (filter.from_date) params.set("from_date", filter.from_date);
      if (filter.to_date) params.set("to_date", filter.to_date);
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await hrmsApi.get<{ data: AccessLogEntry[] }>(`/api/portal/internal/access-log${query}`);
      setLogs(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load access log.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  function handleFilterChange(key: keyof typeof filter, value: string) {
    setFilter(f => ({ ...f, [key]: value }));
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Process ID</label>
            <input
              value={filter.process_id}
              onChange={e => handleFilterChange("process_id", e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Filter by process ID"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">From Date</label>
            <input
              type="date"
              value={filter.from_date}
              onChange={e => handleFilterChange("from_date", e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">To Date</label>
            <input
              type="date"
              value={filter.to_date}
              onChange={e => handleFilterChange("to_date", e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 font-medium">{logs.length} log entries</p>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg border transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Eye className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="font-semibold">No access log entries found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["Client User", "Email", "Page", "IP Address", "Timestamp"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {logs.map(entry => (
                <tr key={entry.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-semibold text-slate-700">{entry.client_user_name ?? entry.client_user_id}</td>
                  <td className="px-4 py-3 text-slate-500">{entry.email ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 max-w-[240px] truncate" title={entry.page}>{entry.page}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{entry.ip_address ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmt(entry.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: "queue", label: "Approval Queue" },
  { key: "published", label: "Published Snapshots" },
  { key: "access-log", label: "Access Log" },
];

export default function NativePortalDataManager() {
  const [activeTab, setActiveTab] = useState<Tab>("queue");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page header */}
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">
            Portal Administration
          </p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">
            Portal Data Manager
          </h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Control what clients see. Prepare, review and publish approved data snapshots.
            Monitor client access activity across all portal sessions.
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-200">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2.5 text-sm font-bold transition-colors border-b-2 -mb-px ${
                activeTab === t.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "queue" && <ApprovalQueueTab />}
        {activeTab === "published" && <PublishedSnapshotsTab />}
        {activeTab === "access-log" && <AccessLogTab />}
      </div>
    </DashboardLayout>
  );
}
