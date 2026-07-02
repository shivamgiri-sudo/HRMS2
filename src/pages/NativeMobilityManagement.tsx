import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Loader,
  Plus, RefreshCcw, TrendingUp, X, XCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ── Types ─────────────────────────────────────────────────────────────────────

type TransferType = "branch" | "department" | "process" | "location" | "reporting";
type MobilityStatus = "pending" | "approved" | "rejected" | "completed";

type TransferRecord = {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  transfer_type: TransferType;
  from_value: string;
  to_value: string;
  effective_date: string;
  reason?: string;
  approved_by?: string;
  status: MobilityStatus;
  initiated_by: string;
  created_at: string;
};

type PromotionRecord = {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  from_designation?: string;
  to_designation: string;
  from_grade?: string;
  to_grade?: string;
  effective_date: string;
  salary_revision?: number;
  reason?: string;
  approved_by?: string;
  status: MobilityStatus;
  initiated_by: string;
  created_at: string;
};

type TransferForm = {
  employee_id: string;
  transfer_type: TransferType;
  from_value: string;
  to_value: string;
  effective_date: string;
  reason: string;
};

type PromotionForm = {
  employee_id: string;
  from_designation: string;
  to_designation: string;
  from_grade: string;
  to_grade: string;
  effective_date: string;
  salary_revision: string;
  reason: string;
};

type ActionDialog = {
  id: string;
  type: "transfer" | "promotion";
  action: "approved" | "rejected";
  remarks: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<MobilityStatus, string> = {
  pending:   "bg-amber-50 text-amber-700",
  approved:  "bg-emerald-50 text-emerald-700",
  rejected:  "bg-red-50 text-red-700",
  completed: "bg-slate-100 text-slate-600",
};

const TRANSFER_TYPE_OPTIONS: TransferType[] = [
  "branch", "department", "process", "location", "reporting",
];

const DEFAULT_TRANSFER_FORM: TransferForm = {
  employee_id: "",
  transfer_type: "department",
  from_value: "",
  to_value: "",
  effective_date: "",
  reason: "",
};

const DEFAULT_PROMOTION_FORM: PromotionForm = {
  employee_id: "",
  from_designation: "",
  to_designation: "",
  from_grade: "",
  to_grade: "",
  effective_date: "",
  salary_revision: "",
  reason: "",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: MobilityStatus }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${STATUS_COLORS[status]}`}>
      {status}
    </span>
  );
}

function TypeBadge({ value }: { value: string }) {
  return (
    <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold capitalize text-blue-700">
      {value}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function NativeMobilityManagement() {
  const [activeTab, setActiveTab] = useState<"transfers" | "promotions">("transfers");
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [promotions, setPromotions] = useState<PromotionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Modals
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showPromotionModal, setShowPromotionModal] = useState(false);
  const [actionDialog, setActionDialog] = useState<ActionDialog | null>(null);

  // Forms
  const [transferForm, setTransferForm] = useState<TransferForm>(DEFAULT_TRANSFER_FORM);
  const [promotionForm, setPromotionForm] = useState<PromotionForm>(DEFAULT_PROMOTION_FORM);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      if (activeTab === "transfers") {
        const res = await hrmsApi.get<{ success: boolean; data: TransferRecord[] }>("/api/mobility/transfers");
        setTransfers(res.data ?? []);
      } else {
        const res = await hrmsApi.get<{ success: boolean; data: PromotionRecord[] }>("/api/mobility/promotions");
        setPromotions(res.data ?? []);
      }
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [activeTab]);

  // ── Transfer submit ────────────────────────────────────────────────────────

  const submitTransfer = async () => {
    const { employee_id, transfer_type, from_value, to_value, effective_date } = transferForm;
    if (!employee_id.trim() || !from_value.trim() || !to_value.trim() || !effective_date) {
      setMessage("Employee ID, from, to, and effective date are required.");
      return;
    }
    setSubmitting(true);
    try {
      await hrmsApi.post("/api/mobility/transfers", {
        employee_id: employee_id.trim(),
        transfer_type,
        from_value: from_value.trim(),
        to_value: to_value.trim(),
        effective_date,
        reason: transferForm.reason || undefined,
      });
      setShowTransferModal(false);
      setTransferForm(DEFAULT_TRANSFER_FORM);
      setMessage("Transfer initiated successfully.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Promotion submit ───────────────────────────────────────────────────────

  const submitPromotion = async () => {
    const { employee_id, to_designation, effective_date } = promotionForm;
    if (!employee_id.trim() || !to_designation.trim() || !effective_date) {
      setMessage("Employee ID, new designation, and effective date are required.");
      return;
    }
    setSubmitting(true);
    try {
      await hrmsApi.post("/api/mobility/promotions", {
        employee_id: employee_id.trim(),
        from_designation: promotionForm.from_designation || undefined,
        to_designation: to_designation.trim(),
        from_grade: promotionForm.from_grade || undefined,
        to_grade: promotionForm.to_grade || undefined,
        effective_date,
        salary_revision: promotionForm.salary_revision ? parseFloat(promotionForm.salary_revision) : undefined,
        reason: promotionForm.reason || undefined,
      });
      setShowPromotionModal(false);
      setPromotionForm(DEFAULT_PROMOTION_FORM);
      setMessage("Promotion initiated successfully.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Approve / Reject ───────────────────────────────────────────────────────

  const submitAction = async () => {
    if (!actionDialog) return;
    setSubmitting(true);
    try {
      const endpoint = actionDialog.type === "transfer"
        ? `/api/mobility/transfers/${actionDialog.id}`
        : `/api/mobility/promotions/${actionDialog.id}`;
      await hrmsApi.patch(endpoint, {
        action: actionDialog.action,
        remarks: actionDialog.remarks || undefined,
      });
      setActionDialog(null);
      setMessage(`Record ${actionDialog.action} successfully.`);
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const openAction = (id: string, type: "transfer" | "promotion", action: "approved" | "rejected") => {
    setActionDialog({ id, type, action, remarks: "" });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">HR Operations</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Mobility Management</h1>
            <p className="mt-2 text-slate-600">Manage employee transfers and promotions.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            {activeTab === "transfers" ? (
              <button
                onClick={() => setShowTransferModal(true)}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Initiate Transfer
              </button>
            ) : (
              <button
                onClick={() => setShowPromotionModal(true)}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Initiate Promotion
              </button>
            )}
          </div>
        </div>

        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {message}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 rounded-2xl border bg-white p-1.5 shadow-sm w-fit">
          {(["transfers", "promotions"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-xl px-5 py-2 text-sm font-bold capitalize transition-colors cursor-pointer ${
                activeTab === tab ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : activeTab === "transfers" ? (
          <TransfersTable
            records={transfers}
            onApprove={(id) => openAction(id, "transfer", "approved")}
            onReject={(id) => openAction(id, "transfer", "rejected")}
          />
        ) : (
          <PromotionsTable
            records={promotions}
            onApprove={(id) => openAction(id, "promotion", "approved")}
            onReject={(id) => openAction(id, "promotion", "rejected")}
          />
        )}
      </div>

      {/* Transfer Modal */}
      {showTransferModal && (
        <Modal title="Initiate Transfer" onClose={() => setShowTransferModal(false)}>
          <div className="space-y-4 p-6">
            <Field label="Employee ID / UUID">
              <input
                value={transferForm.employee_id}
                onChange={(e) => setTransferForm({ ...transferForm, employee_id: e.target.value })}
                placeholder="Enter employee UUID"
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </Field>
            <Field label="Transfer Type">
              <select
                value={transferForm.transfer_type}
                onChange={(e) => setTransferForm({ ...transferForm, transfer_type: e.target.value as TransferType })}
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
              >
                {TRANSFER_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">
                <input
                  value={transferForm.from_value}
                  onChange={(e) => setTransferForm({ ...transferForm, from_value: e.target.value })}
                  placeholder="Current value"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </Field>
              <Field label="To">
                <input
                  value={transferForm.to_value}
                  onChange={(e) => setTransferForm({ ...transferForm, to_value: e.target.value })}
                  placeholder="New value"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </Field>
            </div>
            <Field label="Effective Date">
              <input
                type="date"
                value={transferForm.effective_date}
                onChange={(e) => setTransferForm({ ...transferForm, effective_date: e.target.value })}
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </Field>
            <Field label="Reason (optional)">
              <textarea
                value={transferForm.reason}
                onChange={(e) => setTransferForm({ ...transferForm, reason: e.target.value })}
                rows={2}
                placeholder="Reason for transfer…"
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors resize-none"
              />
            </Field>
          </div>
          <ModalFooter
            onCancel={() => setShowTransferModal(false)}
            onSubmit={() => void submitTransfer()}
            submitting={submitting}
            label="Initiate Transfer"
          />
        </Modal>
      )}

      {/* Promotion Modal */}
      {showPromotionModal && (
        <Modal title="Initiate Promotion" onClose={() => setShowPromotionModal(false)}>
          <div className="space-y-4 p-6">
            <Field label="Employee ID / UUID">
              <input
                value={promotionForm.employee_id}
                onChange={(e) => setPromotionForm({ ...promotionForm, employee_id: e.target.value })}
                placeholder="Enter employee UUID"
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From Designation">
                <input
                  value={promotionForm.from_designation}
                  onChange={(e) => setPromotionForm({ ...promotionForm, from_designation: e.target.value })}
                  placeholder="Current designation"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </Field>
              <Field label="To Designation">
                <input
                  value={promotionForm.to_designation}
                  onChange={(e) => setPromotionForm({ ...promotionForm, to_designation: e.target.value })}
                  placeholder="New designation"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From Grade">
                <input
                  value={promotionForm.from_grade}
                  onChange={(e) => setPromotionForm({ ...promotionForm, from_grade: e.target.value })}
                  placeholder="e.g. L3"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </Field>
              <Field label="To Grade">
                <input
                  value={promotionForm.to_grade}
                  onChange={(e) => setPromotionForm({ ...promotionForm, to_grade: e.target.value })}
                  placeholder="e.g. L4"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </Field>
            </div>
            <Field label="Effective Date">
              <input
                type="date"
                value={promotionForm.effective_date}
                onChange={(e) => setPromotionForm({ ...promotionForm, effective_date: e.target.value })}
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </Field>
            <Field label="Salary Revision (₹)">
              <input
                type="number"
                value={promotionForm.salary_revision}
                onChange={(e) => setPromotionForm({ ...promotionForm, salary_revision: e.target.value })}
                placeholder="New CTC / revised amount"
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </Field>
            <Field label="Reason (optional)">
              <textarea
                value={promotionForm.reason}
                onChange={(e) => setPromotionForm({ ...promotionForm, reason: e.target.value })}
                rows={2}
                placeholder="Reason for promotion…"
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors resize-none"
              />
            </Field>
          </div>
          <ModalFooter
            onCancel={() => setShowPromotionModal(false)}
            onSubmit={() => void submitPromotion()}
            submitting={submitting}
            label="Initiate Promotion"
          />
        </Modal>
      )}

      {/* Approve / Reject Dialog */}
      {actionDialog && (
        <Modal
          title={actionDialog.action === "approved" ? "Approve Record" : "Reject Record"}
          onClose={() => setActionDialog(null)}
        >
          <div className="space-y-4 p-6">
            <p className="text-sm text-slate-600">
              {actionDialog.action === "approved"
                ? "Confirm approval of this record."
                : "Confirm rejection. Please provide remarks."}
            </p>
            <Field label="Remarks (optional)">
              <textarea
                value={actionDialog.remarks}
                onChange={(e) => setActionDialog({ ...actionDialog, remarks: e.target.value })}
                rows={3}
                placeholder="Add remarks…"
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors resize-none"
              />
            </Field>
          </div>
          <div className="flex gap-3 border-t p-6">
            <button
              onClick={() => setActionDialog(null)}
              className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void submitAction()}
              disabled={submitting}
              className={`flex-1 cursor-pointer rounded-2xl py-3 text-sm font-bold text-white transition-colors disabled:opacity-50 ${
                actionDialog.action === "approved"
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {submitting ? "Processing…" : actionDialog.action === "approved" ? "Approve" : "Reject"}
            </button>
          </div>
        </Modal>
      )}
    </DashboardLayout>
  );
}

// ── Table Components ──────────────────────────────────────────────────────────

function TransfersTable({
  records,
  onApprove,
  onReject,
}: {
  records: TransferRecord[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl border bg-white py-20 text-slate-400 shadow-sm">
        <ArrowRight className="mb-3 h-10 w-10 opacity-30" />
        <p className="font-semibold">No transfer records found.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
      <div className="border-b p-5">
        <h2 className="font-black text-slate-950">Transfers</h2>
        <p className="text-sm text-slate-500">{records.length} records</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {["Employee", "Type", "From → To", "Effective Date", "Status", "Actions"].map((h) => (
                <th key={h} className="p-4 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className="border-t hover:bg-slate-50/80 transition-colors">
                <td className="p-4">
                  <div className="font-bold text-slate-950">{r.employee_name ?? r.employee_id}</div>
                  {r.employee_code && (
                    <div className="text-xs text-slate-500 font-mono">{r.employee_code}</div>
                  )}
                </td>
                <td className="p-4"><TypeBadge value={r.transfer_type} /></td>
                <td className="p-4">
                  <div className="flex items-center gap-1.5 text-slate-700">
                    <span className="font-medium">{r.from_value}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                    <span className="font-bold text-slate-950">{r.to_value}</span>
                  </div>
                </td>
                <td className="p-4 font-mono text-slate-600">{r.effective_date?.slice(0, 10)}</td>
                <td className="p-4"><StatusBadge status={r.status} /></td>
                <td className="p-4">
                  {r.status === "pending" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => onApprove(r.id)}
                        className="inline-flex items-center gap-1 cursor-pointer rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Approve
                      </button>
                      <button
                        onClick={() => onReject(r.id)}
                        className="inline-flex items-center gap-1 cursor-pointer rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <XCircle className="h-3.5 w-3.5" />
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
    </div>
  );
}

function PromotionsTable({
  records,
  onApprove,
  onReject,
}: {
  records: PromotionRecord[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl border bg-white py-20 text-slate-400 shadow-sm">
        <TrendingUp className="mb-3 h-10 w-10 opacity-30" />
        <p className="font-semibold">No promotion records found.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
      <div className="border-b p-5">
        <h2 className="font-black text-slate-950">Promotions</h2>
        <p className="text-sm text-slate-500">{records.length} records</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {["Employee", "Designation Change", "Grade Change", "Salary Revision (₹)", "Effective Date", "Status", "Actions"].map((h) => (
                <th key={h} className="p-4 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className="border-t hover:bg-slate-50/80 transition-colors">
                <td className="p-4">
                  <div className="font-bold text-slate-950">{r.employee_name ?? r.employee_id}</div>
                  {r.employee_code && (
                    <div className="text-xs text-slate-500 font-mono">{r.employee_code}</div>
                  )}
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-1.5 text-slate-700">
                    <span className="text-slate-500">{r.from_designation ?? "—"}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                    <span className="font-bold text-slate-950">{r.to_designation}</span>
                  </div>
                </td>
                <td className="p-4">
                  {(r.from_grade || r.to_grade) ? (
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <span>{r.from_grade ?? "—"}</span>
                      <ChevronDown className="h-3 w-3 rotate-[-90deg] text-slate-400" />
                      <span className="font-semibold">{r.to_grade ?? "—"}</span>
                    </div>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="p-4 font-mono text-slate-700">
                  {r.salary_revision != null
                    ? `₹${Number(r.salary_revision).toLocaleString("en-IN")}`
                    : "—"}
                </td>
                <td className="p-4 font-mono text-slate-600">{r.effective_date?.slice(0, 10)}</td>
                <td className="p-4"><StatusBadge status={r.status} /></td>
                <td className="p-4">
                  {r.status === "pending" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => onApprove(r.id)}
                        className="inline-flex items-center gap-1 cursor-pointer rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Approve
                      </button>
                      <button
                        onClick={() => onReject(r.id)}
                        className="inline-flex items-center gap-1 cursor-pointer rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <XCircle className="h-3.5 w-3.5" />
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
    </div>
  );
}

// ── Utility Components ────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b p-6 flex-shrink-0">
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function ModalFooter({
  onCancel,
  onSubmit,
  submitting,
  label,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  label: string;
}) {
  return (
    <div className="flex gap-3 border-t p-6 flex-shrink-0">
      <button
        onClick={onCancel}
        className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={onSubmit}
        disabled={submitting}
        className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
      >
        {submitting ? "Submitting…" : label}
      </button>
    </div>
  );
}
