import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BarChart2,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Copy,
  FileText,
  Loader,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ──────────────────────────────────────────────────────────────────

type RequisitionStatus = "pending" | "approved" | "rejected" | "fulfilled" | "cancelled";
type OfferStatus = "draft" | "sent" | "accepted" | "rejected" | "expired" | "withdrawn";
type BgvStatus = "initiated" | "in_progress" | "completed" | "failed" | "on_hold";
type BgvResult = "clear" | "discrepancy" | "pending" | null;
type DuplicateResolution = "merge_into_primary" | "mark_secondary" | "false_positive";

interface Requisition {
  id: string;
  process_id: string;
  process_name?: string;
  branch_id: string;
  branch_name?: string;
  department_id: string;
  department_name?: string;
  designation_id: string;
  designation_name?: string;
  requested_count: number;
  priority: "low" | "medium" | "high" | "urgent";
  reason?: string;
  expected_joining?: string;
  status: RequisitionStatus;
  created_at: string;
}

interface BgvRecord {
  id: string;
  candidate_id: string;
  candidate_name?: string;
  vendor_name: string;
  initiated_date: string;
  documents_submitted: string[];
  status: BgvStatus;
  result: BgvResult;
  completed_date?: string;
  remarks?: string;
}

interface Offer {
  id: string;
  candidate_id: string;
  candidate_name?: string;
  ctc_annual: number;
  joining_date?: string;
  offer_expiry?: string;
  role_title: string;
  status: OfferStatus;
  offer_details_json?: Record<string, unknown>;
  created_at: string;
  remarks?: string;
}

interface DuplicateCandidate {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  is_primary?: boolean;
}

interface DuplicateGroup {
  id: string;
  candidates: DuplicateCandidate[];
  match_score?: number;
  created_at: string;
  resolved?: boolean;
}

interface FunnelStage {
  stage: string;
  count: number;
}

interface StageConversion {
  from_stage: string;
  to_stage: string;
  conversion_rate: number;
  count_in: number;
  count_out: number;
}

// ─── Badge helpers ───────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-amber-50 text-amber-700",
  high: "bg-orange-50 text-orange-700",
  urgent: "bg-red-50 text-red-700",
};

const REQ_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  fulfilled: "bg-blue-50 text-blue-700",
  cancelled: "bg-slate-100 text-slate-500",
};

const OFFER_STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  sent: "bg-blue-50 text-blue-700",
  accepted: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  expired: "bg-orange-50 text-orange-700",
  withdrawn: "bg-slate-200 text-slate-500",
};

const BGV_STATUS_COLORS: Record<string, string> = {
  initiated: "bg-blue-50 text-blue-700",
  in_progress: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
  on_hold: "bg-slate-100 text-slate-600",
};

function Badge({
  value,
  colorMap,
}: {
  value: string;
  colorMap: Record<string, string>;
}) {
  const cls = colorMap[value] ?? "bg-slate-100 text-slate-600";
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${cls}`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

// ─── Tab bar ────────────────────────────────────────────────────────────────

const TABS = [
  { key: "requisitions", label: "Requisitions", icon: ClipboardList },
  { key: "bgv", label: "BGV", icon: ShieldCheck },
  { key: "offers", label: "Offers", icon: FileText },
  { key: "duplicates", label: "Duplicates", icon: Copy },
  { key: "analytics", label: "Analytics", icon: BarChart2 },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// ─── Shared UI ───────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors bg-white"
    />
  );
}

function SelectInput({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 bg-white"
    >
      {children}
    </select>
  );
}

function ModalShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b p-6 shrink-0">
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          <button
            onClick={onClose}
            className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-6 space-y-4 flex-1">{children}</div>
        <div className="flex gap-3 border-t p-6 shrink-0">{footer}</div>
      </div>
    </div>
  );
}

function CancelBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
    >
      Cancel
    </button>
  );
}

function PrimaryBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function EmptyState({
  icon: Icon,
  message,
}: {
  icon: React.ElementType;
  message: string;
}) {
  return (
    <div className="py-16 text-center text-slate-400">
      <Icon className="mx-auto mb-3 h-10 w-10 opacity-30" />
      <p className="font-semibold">{message}</p>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader className="h-8 w-8 animate-spin text-slate-400" />
    </div>
  );
}

function MessageBar({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      {message}
    </div>
  );
}

// ─── Tab: Requisitions ───────────────────────────────────────────────────────

interface ReqForm {
  process_id: string;
  branch_id: string;
  department_id: string;
  designation_id: string;
  requested_count: string;
  priority: string;
  reason: string;
  expected_joining: string;
}

const EMPTY_REQ_FORM: ReqForm = {
  process_id: "",
  branch_id: "",
  department_id: "",
  designation_id: "",
  requested_count: "1",
  priority: "medium",
  reason: "",
  expected_joining: "",
};

interface ApproveState {
  id: string;
  action: "approved" | "rejected";
  remarks: string;
}

function RequisitionsTab() {
  const [reqs, setReqs] = useState<Requisition[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<ReqForm>(EMPTY_REQ_FORM);
  const [approveState, setApproveState] = useState<ApproveState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const res = await hrmsApi.get<{ success: boolean; data: Requisition[] }>(
        `/api/ats-ext/requisitions${params}`
      );
      setReqs(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load requisitions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [statusFilter]);

  const handleCreate = async () => {
    if (!form.process_id.trim() || !form.branch_id.trim() || !form.designation_id.trim()) {
      setMessage("Process ID, Branch ID, and Designation ID are required.");
      return;
    }
    setSubmitting(true);
    try {
      await hrmsApi.post("/api/ats-ext/requisitions", {
        process_id: form.process_id.trim(),
        branch_id: form.branch_id.trim(),
        department_id: form.department_id.trim() || null,
        designation_id: form.designation_id.trim(),
        requested_count: parseInt(form.requested_count, 10) || 1,
        priority: form.priority,
        reason: form.reason.trim() || null,
        expected_joining: form.expected_joining || null,
      });
      setShowCreate(false);
      setForm(EMPTY_REQ_FORM);
      setMessage("Requisition raised successfully.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to create requisition");
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async () => {
    if (!approveState) return;
    setSubmitting(true);
    try {
      await hrmsApi.post(`/api/ats-ext/requisitions/${approveState.id}/approve`, {
        action: approveState.action,
        remarks: approveState.remarks.trim() || null,
      });
      setApproveState(null);
      setMessage(`Requisition ${approveState.action}.`);
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSubmitting(false);
    }
  };

  const STATUSES = ["all", "pending", "approved", "rejected", "fulfilled", "cancelled"];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition-colors cursor-pointer ${
                statusFilter === s
                  ? "bg-slate-950 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Raise Requisition
          </button>
        </div>
      </div>

      <MessageBar message={message} />

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-black text-slate-950">Manpower Requisitions</h2>
          <p className="text-sm text-slate-500">{reqs.length} records</p>
        </div>
        {loading ? (
          <Spinner />
        ) : reqs.length === 0 ? (
          <EmptyState icon={ClipboardList} message="No requisitions found." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Process", "Branch", "Designation", "Count", "Priority", "Expected Joining", "Status", "Actions"].map((h) => (
                    <th key={h} className="p-4 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reqs.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4">
                      <div className="font-bold text-slate-950">{r.process_name ?? r.process_id}</div>
                      <div className="text-xs font-mono text-slate-400">{r.process_id.slice(0, 8)}</div>
                    </td>
                    <td className="p-4 text-slate-700">{r.branch_name ?? r.branch_id}</td>
                    <td className="p-4 text-slate-700">{r.designation_name ?? r.designation_id}</td>
                    <td className="p-4 font-bold text-slate-950">{r.requested_count}</td>
                    <td className="p-4">
                      <Badge value={r.priority} colorMap={PRIORITY_COLORS} />
                    </td>
                    <td className="p-4 font-mono text-xs text-slate-500">{r.expected_joining ?? "–"}</td>
                    <td className="p-4">
                      <Badge value={r.status} colorMap={REQ_STATUS_COLORS} />
                    </td>
                    <td className="p-4">
                      {r.status === "pending" && (
                        <div className="flex gap-2">
                          <button
                            onClick={() =>
                              setApproveState({ id: r.id, action: "approved", remarks: "" })
                            }
                            className="cursor-pointer rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() =>
                              setApproveState({ id: r.id, action: "rejected", remarks: "" })
                            }
                            className="cursor-pointer rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <ModalShell
          title="Raise Requisition"
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <CancelBtn onClick={() => setShowCreate(false)} />
              <PrimaryBtn onClick={handleCreate} disabled={submitting}>
                {submitting ? "Submitting…" : "Submit"}
              </PrimaryBtn>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Process ID *</FieldLabel>
              <TextInput
                value={form.process_id}
                onChange={(v) => setForm({ ...form, process_id: v })}
                placeholder="e.g. proc-001"
              />
            </div>
            <div>
              <FieldLabel>Branch ID *</FieldLabel>
              <TextInput
                value={form.branch_id}
                onChange={(v) => setForm({ ...form, branch_id: v })}
                placeholder="e.g. branch-001"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Department ID</FieldLabel>
              <TextInput
                value={form.department_id}
                onChange={(v) => setForm({ ...form, department_id: v })}
                placeholder="e.g. dept-001"
              />
            </div>
            <div>
              <FieldLabel>Designation ID *</FieldLabel>
              <TextInput
                value={form.designation_id}
                onChange={(v) => setForm({ ...form, designation_id: v })}
                placeholder="e.g. desig-001"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Headcount</FieldLabel>
              <TextInput
                type="number"
                value={form.requested_count}
                onChange={(v) => setForm({ ...form, requested_count: v })}
              />
            </div>
            <div>
              <FieldLabel>Priority</FieldLabel>
              <SelectInput value={form.priority} onChange={(v) => setForm({ ...form, priority: v })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </SelectInput>
            </div>
          </div>
          <div>
            <FieldLabel>Expected Joining Date</FieldLabel>
            <TextInput
              type="date"
              value={form.expected_joining}
              onChange={(v) => setForm({ ...form, expected_joining: v })}
            />
          </div>
          <div>
            <FieldLabel>Reason</FieldLabel>
            <textarea
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="Business justification…"
              rows={3}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
            />
          </div>
        </ModalShell>
      )}

      {/* Approve/Reject Modal */}
      {approveState && (
        <ModalShell
          title={approveState.action === "approved" ? "Approve Requisition" : "Reject Requisition"}
          onClose={() => setApproveState(null)}
          footer={
            <>
              <CancelBtn onClick={() => setApproveState(null)} />
              <PrimaryBtn onClick={handleApprove} disabled={submitting}>
                {submitting
                  ? "Processing…"
                  : approveState.action === "approved"
                  ? "Approve"
                  : "Reject"}
              </PrimaryBtn>
            </>
          }
        >
          <div>
            <FieldLabel>Remarks (optional)</FieldLabel>
            <textarea
              value={approveState.remarks}
              onChange={(e) =>
                setApproveState({ ...approveState, remarks: e.target.value })
              }
              placeholder="Add remarks…"
              rows={4}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
            />
          </div>
        </ModalShell>
      )}
    </div>
  );
}

// ─── Tab: BGV ────────────────────────────────────────────────────────────────

interface BgvInitForm {
  vendor_name: string;
  initiated_date: string;
  documents_submitted: string;
}

interface BgvUpdateForm {
  status: BgvStatus;
  result: string;
  completed_date: string;
  remarks: string;
}

function BgvTab() {
  const [candidateSearch, setCandidateSearch] = useState("");
  const [bgvRecord, setBgvRecord] = useState<BgvRecord | null>(null);
  const [loadingBgv, setLoadingBgv] = useState(false);
  const [message, setMessage] = useState("");
  const [showInitiate, setShowInitiate] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [initForm, setInitForm] = useState<BgvInitForm>({
    vendor_name: "",
    initiated_date: "",
    documents_submitted: "",
  });
  const [updateForm, setUpdateForm] = useState<BgvUpdateForm>({
    status: "initiated",
    result: "",
    completed_date: "",
    remarks: "",
  });

  const searchCandidate = async () => {
    const q = candidateSearch.trim();
    if (!q) return;
    setLoadingBgv(true);
    setMessage("");
    setBgvRecord(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: BgvRecord }>(
        `/api/ats-ext/candidates/${encodeURIComponent(q)}/bgv`
      );
      setBgvRecord(res.data ?? null);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Candidate not found or no BGV record");
    } finally {
      setLoadingBgv(false);
    }
  };

  const handleInitiate = async () => {
    if (!candidateSearch.trim() || !initForm.vendor_name.trim() || !initForm.initiated_date) {
      setMessage("Vendor name and initiated date are required.");
      return;
    }
    setSubmitting(true);
    try {
      const docs = initForm.documents_submitted
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);
      await hrmsApi.post(
        `/api/ats-ext/candidates/${encodeURIComponent(candidateSearch.trim())}/bgv/initiate`,
        {
          vendor_name: initForm.vendor_name.trim(),
          initiated_date: initForm.initiated_date,
          documents_submitted: docs,
        }
      );
      setShowInitiate(false);
      setInitForm({ vendor_name: "", initiated_date: "", documents_submitted: "" });
      setMessage("BGV initiated successfully.");
      await searchCandidate();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to initiate BGV");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!candidateSearch.trim()) return;
    setSubmitting(true);
    try {
      await hrmsApi.post(
        `/api/ats-ext/candidates/${encodeURIComponent(candidateSearch.trim())}/bgv`,
        {
          status: updateForm.status,
          result: updateForm.result || null,
          completed_date: updateForm.completed_date || null,
          remarks: updateForm.remarks.trim() || null,
        }
      );
      setShowUpdate(false);
      setMessage("BGV status updated.");
      await searchCandidate();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to update BGV");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <MessageBar message={message} />

      {/* Search */}
      <div className="rounded-3xl border bg-white p-5 shadow-sm">
        <h3 className="font-black text-slate-950 mb-4">Lookup Candidate BGV</h3>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={candidateSearch}
              onChange={(e) => setCandidateSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void searchCandidate()}
              placeholder="Enter candidate ID or name…"
              className="h-11 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400 transition-colors"
            />
          </div>
          <button
            onClick={() => void searchCandidate()}
            disabled={loadingBgv}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            {loadingBgv ? <Loader className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </button>
        </div>
      </div>

      {/* BGV Record Card */}
      {bgvRecord && (
        <div className="rounded-3xl border bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-black text-slate-950 text-lg">
                {bgvRecord.candidate_name ?? bgvRecord.candidate_id}
              </h3>
              <p className="text-xs font-mono text-slate-400 mt-0.5">{bgvRecord.id}</p>
            </div>
            <div className="flex gap-2">
              <Badge value={bgvRecord.status} colorMap={BGV_STATUS_COLORS} />
              {bgvRecord.result && (
                <Badge
                  value={bgvRecord.result}
                  colorMap={{
                    clear: "bg-emerald-50 text-emerald-700",
                    discrepancy: "bg-red-50 text-red-700",
                    pending: "bg-amber-50 text-amber-700",
                  }}
                />
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Vendor</p>
              <p className="mt-1 font-semibold text-slate-900">{bgvRecord.vendor_name}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Initiated</p>
              <p className="mt-1 font-mono text-sm text-slate-700">{bgvRecord.initiated_date}</p>
            </div>
            {bgvRecord.completed_date && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Completed</p>
                <p className="mt-1 font-mono text-sm text-slate-700">{bgvRecord.completed_date}</p>
              </div>
            )}
          </div>
          {bgvRecord.documents_submitted.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Documents Submitted</p>
              <div className="flex flex-wrap gap-2">
                {bgvRecord.documents_submitted.map((doc) => (
                  <span key={doc} className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    {doc}
                  </span>
                ))}
              </div>
            </div>
          )}
          {bgvRecord.remarks && (
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {bgvRecord.remarks}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setShowUpdate(true)}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Update Status
            </button>
          </div>
        </div>
      )}

      {!bgvRecord && !loadingBgv && candidateSearch && (
        <div className="rounded-3xl border bg-white p-6 shadow-sm text-center">
          <p className="text-slate-500">No BGV record found.</p>
          <button
            onClick={() => setShowInitiate(true)}
            className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Initiate BGV
          </button>
        </div>
      )}

      {/* Initiate Modal */}
      {showInitiate && (
        <ModalShell
          title="Initiate BGV"
          onClose={() => setShowInitiate(false)}
          footer={
            <>
              <CancelBtn onClick={() => setShowInitiate(false)} />
              <PrimaryBtn onClick={handleInitiate} disabled={submitting}>
                {submitting ? "Initiating…" : "Initiate"}
              </PrimaryBtn>
            </>
          }
        >
          <div>
            <FieldLabel>Vendor Name *</FieldLabel>
            <TextInput
              value={initForm.vendor_name}
              onChange={(v) => setInitForm({ ...initForm, vendor_name: v })}
              placeholder="e.g. AuthBridge"
            />
          </div>
          <div>
            <FieldLabel>Initiated Date *</FieldLabel>
            <TextInput
              type="date"
              value={initForm.initiated_date}
              onChange={(v) => setInitForm({ ...initForm, initiated_date: v })}
            />
          </div>
          <div>
            <FieldLabel>Documents Submitted (comma-separated)</FieldLabel>
            <TextInput
              value={initForm.documents_submitted}
              onChange={(v) => setInitForm({ ...initForm, documents_submitted: v })}
              placeholder="Aadhar, PAN, Degree Certificate"
            />
          </div>
        </ModalShell>
      )}

      {/* Update Status Modal */}
      {showUpdate && (
        <ModalShell
          title="Update BGV Status"
          onClose={() => setShowUpdate(false)}
          footer={
            <>
              <CancelBtn onClick={() => setShowUpdate(false)} />
              <PrimaryBtn onClick={handleUpdate} disabled={submitting}>
                {submitting ? "Saving…" : "Save"}
              </PrimaryBtn>
            </>
          }
        >
          <div>
            <FieldLabel>Status</FieldLabel>
            <SelectInput
              value={updateForm.status}
              onChange={(v) => setUpdateForm({ ...updateForm, status: v as BgvStatus })}
            >
              <option value="initiated">Initiated</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="on_hold">On Hold</option>
            </SelectInput>
          </div>
          <div>
            <FieldLabel>Result</FieldLabel>
            <SelectInput
              value={updateForm.result}
              onChange={(v) => setUpdateForm({ ...updateForm, result: v })}
            >
              <option value="">— Not set —</option>
              <option value="clear">Clear</option>
              <option value="discrepancy">Discrepancy</option>
              <option value="pending">Pending</option>
            </SelectInput>
          </div>
          <div>
            <FieldLabel>Completed Date</FieldLabel>
            <TextInput
              type="date"
              value={updateForm.completed_date}
              onChange={(v) => setUpdateForm({ ...updateForm, completed_date: v })}
            />
          </div>
          <div>
            <FieldLabel>Remarks</FieldLabel>
            <textarea
              value={updateForm.remarks}
              onChange={(e) => setUpdateForm({ ...updateForm, remarks: e.target.value })}
              rows={3}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
            />
          </div>
        </ModalShell>
      )}
    </div>
  );
}

// ─── Tab: Offers ─────────────────────────────────────────────────────────────

interface OfferForm {
  candidate_id: string;
  ctc_annual: string;
  joining_date: string;
  offer_expiry: string;
  role_title: string;
}

const EMPTY_OFFER_FORM: OfferForm = {
  candidate_id: "",
  ctc_annual: "",
  joining_date: "",
  offer_expiry: "",
  role_title: "",
};

function OffersTab() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<OfferForm>(EMPTY_OFFER_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [statusDropdown, setStatusDropdown] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const res = await hrmsApi.get<{ success: boolean; data: Offer[] }>(
        `/api/ats-ext/offers${params}`
      );
      setOffers(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load offers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [statusFilter]);

  const handleCreate = async () => {
    if (!form.candidate_id.trim() || !form.role_title.trim() || !form.ctc_annual) {
      setMessage("Candidate ID, role title, and CTC are required.");
      return;
    }
    setSubmitting(true);
    try {
      await hrmsApi.post("/api/ats-ext/offers", {
        candidate_id: form.candidate_id.trim(),
        ctc_annual: parseFloat(form.ctc_annual),
        joining_date: form.joining_date || null,
        offer_expiry: form.offer_expiry || null,
        role_title: form.role_title.trim(),
        offer_details_json: {},
      });
      setShowCreate(false);
      setForm(EMPTY_OFFER_FORM);
      setMessage("Offer created successfully.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to create offer");
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async (id: string, status: OfferStatus) => {
    setUpdatingId(id);
    setStatusDropdown(null);
    try {
      await hrmsApi.patch(`/api/ats-ext/offers/${id}/status`, { status, remarks: null });
      setMessage(`Offer status updated to ${status}.`);
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setUpdatingId(null);
    }
  };

  const OFFER_STATUSES: OfferStatus[] = ["draft", "sent", "accepted", "rejected", "expired", "withdrawn"];
  const FILTER_STATUSES = ["all", ...OFFER_STATUSES];

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTER_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition-colors cursor-pointer ${
                statusFilter === s
                  ? "bg-slate-950 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {s.replace(/_/g, " ")}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Create Offer
          </button>
        </div>
      </div>

      <MessageBar message={message} />

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-black text-slate-950">Offer Letters</h2>
          <p className="text-sm text-slate-500">{offers.length} records</p>
        </div>
        {loading ? (
          <Spinner />
        ) : offers.length === 0 ? (
          <EmptyState icon={FileText} message="No offers found." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Candidate", "Role", "CTC (Annual)", "Joining Date", "Offer Expiry", "Status", "Actions"].map((h) => (
                    <th key={h} className="p-4 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4">
                      <div className="font-bold text-slate-950">{o.candidate_name ?? o.candidate_id}</div>
                      <div className="text-xs font-mono text-slate-400">{o.candidate_id.slice(0, 8)}</div>
                    </td>
                    <td className="p-4 font-semibold text-slate-800">{o.role_title}</td>
                    <td className="p-4 font-mono text-slate-700">{fmt(o.ctc_annual)}</td>
                    <td className="p-4 font-mono text-xs text-slate-500">{o.joining_date ?? "–"}</td>
                    <td className="p-4 font-mono text-xs text-slate-500">{o.offer_expiry ?? "–"}</td>
                    <td className="p-4">
                      <Badge value={o.status} colorMap={OFFER_STATUS_COLORS} />
                    </td>
                    <td className="p-4 relative">
                      {updatingId === o.id ? (
                        <Loader className="h-4 w-4 animate-spin text-slate-400" />
                      ) : (
                        <div className="relative inline-block">
                          <button
                            onClick={() =>
                              setStatusDropdown(statusDropdown === o.id ? null : o.id)
                            }
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                          >
                            Update
                            <ChevronDown className="h-3 w-3" />
                          </button>
                          {statusDropdown === o.id && (
                            <div className="absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded-2xl border bg-white shadow-lg py-1">
                              {OFFER_STATUSES.filter((s) => s !== o.status).map((s) => (
                                <button
                                  key={s}
                                  onClick={() => void updateStatus(o.id, s)}
                                  className="w-full px-4 py-2 text-left text-sm capitalize hover:bg-slate-50 transition-colors cursor-pointer"
                                >
                                  {s.replace(/_/g, " ")}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Offer Modal */}
      {showCreate && (
        <ModalShell
          title="Create Offer Letter"
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <CancelBtn onClick={() => setShowCreate(false)} />
              <PrimaryBtn onClick={handleCreate} disabled={submitting}>
                {submitting ? "Creating…" : "Create Offer"}
              </PrimaryBtn>
            </>
          }
        >
          <div>
            <FieldLabel>Candidate ID *</FieldLabel>
            <TextInput
              value={form.candidate_id}
              onChange={(v) => setForm({ ...form, candidate_id: v })}
              placeholder="Candidate UUID"
            />
          </div>
          <div>
            <FieldLabel>Role Title *</FieldLabel>
            <TextInput
              value={form.role_title}
              onChange={(v) => setForm({ ...form, role_title: v })}
              placeholder="e.g. Software Engineer"
            />
          </div>
          <div>
            <FieldLabel>Annual CTC (INR) *</FieldLabel>
            <TextInput
              type="number"
              value={form.ctc_annual}
              onChange={(v) => setForm({ ...form, ctc_annual: v })}
              placeholder="e.g. 600000"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Joining Date</FieldLabel>
              <TextInput
                type="date"
                value={form.joining_date}
                onChange={(v) => setForm({ ...form, joining_date: v })}
              />
            </div>
            <div>
              <FieldLabel>Offer Expiry</FieldLabel>
              <TextInput
                type="date"
                value={form.offer_expiry}
                onChange={(v) => setForm({ ...form, offer_expiry: v })}
              />
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

// ─── Tab: Duplicates ──────────────────────────────────────────────────────────

interface ResolveState {
  groupId: string;
  resolution: DuplicateResolution;
  primary_candidate_id: string;
}

function DuplicatesTab() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [resolveState, setResolveState] = useState<ResolveState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DuplicateGroup[] }>(
        "/api/ats-ext/duplicates"
      );
      setGroups(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load duplicates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleResolve = async () => {
    if (!resolveState) return;
    if (
      resolveState.resolution === "merge_into_primary" &&
      !resolveState.primary_candidate_id.trim()
    ) {
      setMessage("Primary candidate ID is required for merge.");
      return;
    }
    setSubmitting(true);
    try {
      await hrmsApi.post(`/api/ats-ext/duplicates/${resolveState.groupId}/resolve`, {
        resolution: resolveState.resolution,
        primary_candidate_id: resolveState.primary_candidate_id.trim() || null,
      });
      setResolveState(null);
      setMessage("Duplicate group resolved.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to resolve");
    } finally {
      setSubmitting(false);
    }
  };

  const pending = groups.filter((g) => !g.resolved);
  const resolved = groups.filter((g) => g.resolved);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-slate-500">
            {pending.length} unresolved &bull; {resolved.length} resolved
          </span>
        </div>
        <button
          onClick={() => load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <MessageBar message={message} />

      {loading ? (
        <Spinner />
      ) : groups.length === 0 ? (
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <EmptyState icon={Copy} message="No duplicate groups found." />
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div
              key={group.id}
              className={`rounded-3xl border bg-white p-5 shadow-sm ${group.resolved ? "opacity-60" : ""}`}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <span className="text-xs font-mono text-slate-400">{group.id}</span>
                  {group.match_score !== undefined && (
                    <span className="ml-3 rounded-full bg-amber-50 px-3 py-0.5 text-xs font-semibold text-amber-700">
                      Match: {Math.round(group.match_score * 100)}%
                    </span>
                  )}
                  {group.resolved && (
                    <span className="ml-3 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                      Resolved
                    </span>
                  )}
                </div>
                {!group.resolved && (
                  <button
                    onClick={() =>
                      setResolveState({
                        groupId: group.id,
                        resolution: "merge_into_primary",
                        primary_candidate_id: group.candidates[0]?.id ?? "",
                      })
                    }
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                  >
                    Resolve
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {group.candidates.map((c) => (
                  <div
                    key={c.id}
                    className={`rounded-2xl border p-3 ${c.is_primary ? "border-blue-300 bg-blue-50" : "bg-slate-50"}`}
                  >
                    {c.is_primary && (
                      <span className="block text-xs font-bold text-blue-600 mb-1">Primary</span>
                    )}
                    <p className="font-bold text-slate-900 text-sm">{c.name}</p>
                    {c.email && <p className="text-xs text-slate-500 mt-0.5">{c.email}</p>}
                    {c.phone && <p className="text-xs font-mono text-slate-500">{c.phone}</p>}
                    <p className="text-xs font-mono text-slate-400 mt-1">{c.id.slice(0, 12)}…</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Resolve Modal */}
      {resolveState && (
        <ModalShell
          title="Resolve Duplicate Group"
          onClose={() => setResolveState(null)}
          footer={
            <>
              <CancelBtn onClick={() => setResolveState(null)} />
              <PrimaryBtn onClick={handleResolve} disabled={submitting}>
                {submitting ? "Resolving…" : "Confirm"}
              </PrimaryBtn>
            </>
          }
        >
          <div>
            <FieldLabel>Resolution Action</FieldLabel>
            <SelectInput
              value={resolveState.resolution}
              onChange={(v) =>
                setResolveState({ ...resolveState, resolution: v as DuplicateResolution })
              }
            >
              <option value="merge_into_primary">Merge into Primary</option>
              <option value="mark_secondary">Mark as Secondary</option>
              <option value="false_positive">Mark as False Positive</option>
            </SelectInput>
          </div>
          {resolveState.resolution === "merge_into_primary" && (
            <div>
              <FieldLabel>Primary Candidate ID *</FieldLabel>
              <TextInput
                value={resolveState.primary_candidate_id}
                onChange={(v) =>
                  setResolveState({ ...resolveState, primary_candidate_id: v })
                }
                placeholder="UUID of the record to keep"
              />
            </div>
          )}
        </ModalShell>
      )}
    </div>
  );
}

// ─── Tab: Analytics ──────────────────────────────────────────────────────────

function AnalyticsTab() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [processId, setProcessId] = useState("");
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [stages, setStages] = useState<StageConversion[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      if (processId.trim()) params.set("process_id", processId.trim());
      const qs = params.toString() ? `?${params.toString()}` : "";

      const [funnelRes, stagesRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: FunnelStage[] }>(
          `/api/ats-ext/analytics/funnel${qs}`
        ),
        hrmsApi.get<{ success: boolean; data: StageConversion[] }>(
          `/api/ats-ext/analytics/stages${qs}`
        ),
      ]);
      setFunnel(funnelRes.data ?? []);
      setStages(stagesRes.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const maxCount = Math.max(...funnel.map((f) => f.count), 1);

  const FUNNEL_COLORS = [
    "bg-blue-500",
    "bg-indigo-500",
    "bg-violet-500",
    "bg-purple-500",
    "bg-pink-500",
    "bg-rose-500",
  ];

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="rounded-3xl border bg-white p-5 shadow-sm">
        <h3 className="font-black text-slate-950 mb-4">Filters</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[140px]">
            <FieldLabel>Start Date</FieldLabel>
            <TextInput
              type="date"
              value={startDate}
              onChange={setStartDate}
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <FieldLabel>End Date</FieldLabel>
            <TextInput
              type="date"
              value={endDate}
              onChange={setEndDate}
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <FieldLabel>Process ID</FieldLabel>
            <TextInput
              value={processId}
              onChange={setProcessId}
              placeholder="Optional"
            />
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            {loading ? <Loader className="h-4 w-4 animate-spin" /> : <BarChart2 className="h-4 w-4" />}
            Apply
          </button>
        </div>
      </div>

      <MessageBar message={message} />

      {loading ? (
        <Spinner />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Funnel Visualization */}
          <div className="rounded-3xl border bg-white p-6 shadow-sm">
            <h3 className="font-black text-slate-950 mb-5">Recruitment Funnel</h3>
            {funnel.length === 0 ? (
              <EmptyState icon={BarChart2} message="No funnel data available." />
            ) : (
              <div className="space-y-3">
                {funnel.map((stage, idx) => {
                  const pct = Math.round((stage.count / maxCount) * 100);
                  const color = FUNNEL_COLORS[idx % FUNNEL_COLORS.length];
                  return (
                    <div key={stage.stage}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-semibold text-slate-700 capitalize">
                          {stage.stage.replace(/_/g, " ")}
                        </span>
                        <span className="text-sm font-black text-slate-950">{stage.count}</span>
                      </div>
                      <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${color} transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{pct}% of top</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Stage Conversion Table */}
          <div className="rounded-3xl border bg-white shadow-sm overflow-hidden">
            <div className="border-b p-5">
              <h3 className="font-black text-slate-950">Stage Conversion Rates</h3>
            </div>
            {stages.length === 0 ? (
              <EmptyState icon={CheckCircle2} message="No conversion data available." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="p-4 font-semibold">From</th>
                      <th className="p-4 font-semibold">To</th>
                      <th className="p-4 font-semibold">In</th>
                      <th className="p-4 font-semibold">Out</th>
                      <th className="p-4 font-semibold">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stages.map((s, idx) => {
                      const pct = Math.round(s.conversion_rate * 100);
                      const rateColor =
                        pct >= 70
                          ? "text-emerald-700"
                          : pct >= 40
                          ? "text-amber-700"
                          : "text-red-600";
                      return (
                        <tr
                          key={idx}
                          className="border-t hover:bg-slate-50/80 transition-colors"
                        >
                          <td className="p-4 capitalize text-slate-700">
                            {s.from_stage.replace(/_/g, " ")}
                          </td>
                          <td className="p-4 capitalize text-slate-700">
                            {s.to_stage.replace(/_/g, " ")}
                          </td>
                          <td className="p-4 font-mono text-slate-600">{s.count_in}</td>
                          <td className="p-4 font-mono text-slate-600">{s.count_out}</td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    pct >= 70
                                      ? "bg-emerald-500"
                                      : pct >= 40
                                      ? "bg-amber-500"
                                      : "bg-red-500"
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className={`text-xs font-black ${rateColor}`}>{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function NativeATSExtensions() {
  const [activeTab, setActiveTab] = useState<TabKey>("requisitions");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">
            ATS
          </p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">
            ATS Extensions
          </h1>
          <p className="mt-2 max-w-4xl text-slate-600">
            Manage manpower requisitions, background verification, offer letters, duplicate candidates, and hiring analytics.
          </p>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 rounded-2xl border bg-slate-50 p-1 overflow-x-auto">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === key
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "requisitions" && <RequisitionsTab />}
        {activeTab === "bgv" && <BgvTab />}
        {activeTab === "offers" && <OffersTab />}
        {activeTab === "duplicates" && <DuplicatesTab />}
        {activeTab === "analytics" && <AnalyticsTab />}
      </div>
    </DashboardLayout>
  );
}
