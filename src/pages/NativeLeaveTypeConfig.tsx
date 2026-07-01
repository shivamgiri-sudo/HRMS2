import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Loader, Pencil, Plus, RefreshCcw,
  Trash2, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeaveType {
  id: string;
  leave_code: string;
  leave_name: string;
  max_days_per_year: number;
  carry_forward: number;
  requires_approval: number;
  paid_leave: number;
  active_status: number;
}

interface LeaveTypeForm {
  leave_code: string;
  leave_name: string;
  max_days_per_year: string;
  carry_forward: boolean;
  requires_approval: boolean;
  paid_leave: boolean;
}

const EMPTY_FORM: LeaveTypeForm = {
  leave_code: "",
  leave_name: "",
  max_days_per_year: "0",
  carry_forward: false,
  requires_approval: true,
  paid_leave: true,
};

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors w-full ${
        checked
          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-500"
      }`}
    >
      <span
        className={`inline-flex h-5 w-10 flex-shrink-0 rounded-full transition-colors ${checked ? "bg-emerald-500" : "bg-slate-300"}`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
        />
      </span>
      {label}
    </button>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function YesNoBadge({ value, trueLabel = "Yes", falseLabel = "No", trueClass = "bg-emerald-50 text-emerald-700", falseClass = "bg-slate-100 text-slate-500" }: {
  value: number | boolean;
  trueLabel?: string;
  falseLabel?: string;
  trueClass?: string;
  falseClass?: string;
}) {
  const active = Boolean(value);
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${active ? trueClass : falseClass}`}>
      {active ? trueLabel : falseLabel}
    </span>
  );
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────

function DeleteConfirmModal({
  target,
  onConfirm,
  onCancel,
  deleting,
}: {
  target: LeaveType;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-6">
          <h2 className="text-lg font-black text-slate-950">Delete Leave Type</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3 rounded-2xl bg-red-50 border border-red-200 p-4">
            <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">
              Deactivate <strong>{target.leave_name}</strong> ({target.leave_code})?
              This is a soft-delete — leave balances and history will be preserved.
            </p>
          </div>
        </div>
        <div className="flex gap-3 border-t p-6">
          <button
            onClick={onCancel}
            className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 rounded-2xl bg-red-600 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {deleting ? "Deleting…" : "Deactivate"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add / Edit Modal ─────────────────────────────────────────────────────────

function LeaveTypeModal({
  mode,
  initial,
  onSave,
  onClose,
  saving,
  error,
}: {
  mode: "add" | "edit";
  initial: LeaveTypeForm;
  onSave: (form: LeaveTypeForm) => void;
  onClose: () => void;
  saving: boolean;
  error: string;
}) {
  const [form, setForm] = useState<LeaveTypeForm>(initial);

  const set = <K extends keyof LeaveTypeForm>(k: K, v: LeaveTypeForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-6">
          <h2 className="text-lg font-black text-slate-950">
            {mode === "add" ? "Add Leave Type" : "Edit Leave Type"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          {error && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Leave Code *</label>
              <input
                value={form.leave_code}
                onChange={(e) => set("leave_code", e.target.value.toUpperCase())}
                placeholder="e.g. CL, SL, EL"
                disabled={mode === "edit"}
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Max Days / Year *</label>
              <input
                type="number"
                min={0}
                value={form.max_days_per_year}
                onChange={(e) => set("max_days_per_year", e.target.value)}
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Leave Name *</label>
            <input
              value={form.leave_name}
              onChange={(e) => set("leave_name", e.target.value)}
              placeholder="e.g. Casual Leave"
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Toggle
              checked={form.carry_forward}
              onChange={(v) => set("carry_forward", v)}
              label="Carry Forward"
            />
            <Toggle
              checked={form.requires_approval}
              onChange={(v) => set("requires_approval", v)}
              label="Needs Approval"
            />
            <Toggle
              checked={form.paid_leave}
              onChange={(v) => set("paid_leave", v)}
              label="Paid Leave"
            />
          </div>
        </div>

        <div className="flex gap-3 border-t p-6">
          <button
            onClick={onClose}
            className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={saving}
            className="flex-1 rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : mode === "add" ? "Add Leave Type" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NativeLeaveTypeConfig() {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // Modal state
  const [modalMode, setModalMode] = useState<"add" | "edit" | null>(null);
  const [editTarget, setEditTarget] = useState<LeaveType | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<LeaveType | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: LeaveType[] }>("/api/leave/types");
      setTypes(res.data ?? []);
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to load leave types", ok: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const openAdd = () => {
    setEditTarget(null);
    setModalError("");
    setModalMode("add");
  };

  const openEdit = (t: LeaveType) => {
    setEditTarget(t);
    setModalError("");
    setModalMode("edit");
  };

  const handleSave = async (form: LeaveTypeForm) => {
    if (!form.leave_code.trim() || !form.leave_name.trim()) {
      setModalError("Leave code and name are required.");
      return;
    }
    setSaving(true);
    setModalError("");
    try {
      if (modalMode === "add") {
        await hrmsApi.post("/api/leave/types", {
          leaveCode:       form.leave_code.trim(),
          leaveName:       form.leave_name.trim(),
          maxDaysPerYear:  Number(form.max_days_per_year),
          carryForward:    form.carry_forward,
          requiresApproval: form.requires_approval,
          paidLeave:       form.paid_leave,
        });
        setMessage({ text: `Leave type "${form.leave_name}" added.`, ok: true });
      } else if (editTarget) {
        await hrmsApi.put(`/api/leave/types/${editTarget.id}`, {
          leave_name:       form.leave_name.trim(),
          max_days_per_year: Number(form.max_days_per_year),
          carry_forward:    form.carry_forward,
          requires_approval: form.requires_approval,
          paid_leave:       form.paid_leave,
        });
        setMessage({ text: `Leave type "${form.leave_name}" updated.`, ok: true });
      }
      setModalMode(null);
      await load();
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await hrmsApi.delete(`/api/leave/types/${deleteTarget.id}`);
      setMessage({ text: `"${deleteTarget.leave_name}" deactivated.`, ok: true });
      setDeleteTarget(null);
      await load();
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : "Delete failed", ok: false });
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const editFormFromTarget = (t: LeaveType): LeaveTypeForm => ({
    leave_code:        t.leave_code,
    leave_name:        t.leave_name,
    max_days_per_year: String(t.max_days_per_year),
    carry_forward:     Boolean(t.carry_forward),
    requires_approval: Boolean(t.requires_approval),
    paid_leave:        Boolean(t.paid_leave),
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-600">HR Masters</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Leave Type Config</h1>
            <p className="mt-2 text-slate-600">
              Manage leave types — codes, day limits, carry-forward rules, and paid/unpaid classification.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add Leave Type
            </button>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className={`flex items-center gap-3 rounded-2xl border p-4 text-sm font-bold ${
            message.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}>
            {message.ok
              ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              : <AlertTriangle className="h-4 w-4 flex-shrink-0" />}
            {message.text}
          </div>
        )}

        {/* Table */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5 flex items-center justify-between">
            <div>
              <h2 className="font-black text-slate-950">Leave Types</h2>
              <p className="text-sm text-slate-500">{types.length} active type{types.length !== 1 ? "s" : ""}</p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : types.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <Plus className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="font-semibold">No leave types configured. Add one above.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    {["Code", "Name", "Max Days / Year", "Carry Forward", "Requires Approval", "Paid", "Actions"].map((h) => (
                      <th key={h} className="p-4 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {types.map((t) => (
                    <tr key={t.id} className="border-t hover:bg-slate-50/80 transition-colors">
                      <td className="p-4 font-mono text-xs font-bold text-slate-700">{t.leave_code}</td>
                      <td className="p-4 font-semibold text-slate-900">{t.leave_name}</td>
                      <td className="p-4 text-slate-700">{t.max_days_per_year}</td>
                      <td className="p-4">
                        <YesNoBadge value={t.carry_forward} trueLabel="Yes" falseLabel="No" />
                      </td>
                      <td className="p-4">
                        <YesNoBadge
                          value={t.requires_approval}
                          trueLabel="Required"
                          falseLabel="Auto"
                          trueClass="bg-blue-50 text-blue-700"
                        />
                      </td>
                      <td className="p-4">
                        <YesNoBadge
                          value={t.paid_leave}
                          trueLabel="Paid"
                          falseLabel="Unpaid"
                          trueClass="bg-violet-50 text-violet-700"
                        />
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEdit(t)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteTarget(t)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit Modal */}
      {modalMode && (
        <LeaveTypeModal
          mode={modalMode}
          initial={editTarget ? editFormFromTarget(editTarget) : EMPTY_FORM}
          onSave={handleSave}
          onClose={() => setModalMode(null)}
          saving={saving}
          error={modalError}
        />
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <DeleteConfirmModal
          target={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}
    </DashboardLayout>
  );
}
