import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle, Building2, Layers, Briefcase, Tag,
  Megaphone, DollarSign, Award, Plus, Pencil, Trash2,
  Loader, RefreshCcw, X, Check,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useIsAdminOrHR } from "@/hooks/useUserRole";

// ── Types ──────────────────────────────────────────────────────────────────

interface OrgRecord {
  id: string | number;
  name: string;
  code?: string;
  description?: string;
  status?: string;
  is_active?: boolean;
  active?: boolean;
  [key: string]: unknown;
}

type TabKey =
  | "branches"
  | "departments"
  | "lobs"
  | "designations"
  | "campaigns"
  | "cost-centres"
  | "grade-bands";

interface TabConfig {
  key: TabKey;
  label: string;
  icon: React.ReactNode;
  apiPath: string;
  fields: FieldConfig[];
}

interface FieldConfig {
  key: string;
  label: string;
  type: "text" | "textarea";
  required?: boolean;
}

// ── Tab definitions ─────────────────────────────────────────────────────────

const TABS: TabConfig[] = [
  {
    key: "branches",
    label: "Branches",
    icon: <Building2 className="h-4 w-4" />,
    apiPath: "/api/org/branches",
    fields: [
      { key: "branch_name", label: "Name", type: "text", required: true },
      { key: "branch_code", label: "Code", type: "text", required: true },
      { key: "city", label: "City", type: "text" },
      { key: "state", label: "State", type: "text" },
    ],
  },
  {
    key: "departments",
    label: "Departments",
    icon: <Layers className="h-4 w-4" />,
    apiPath: "/api/org/departments",
    fields: [
      { key: "dept_name", label: "Name", type: "text", required: true },
      { key: "dept_code", label: "Code", type: "text", required: true },
      { key: "description", label: "Description", type: "textarea" },
    ],
  },
  {
    key: "lobs",
    label: "LOBs",
    icon: <Briefcase className="h-4 w-4" />,
    apiPath: "/api/org/lobs",
    fields: [
      { key: "lob_name", label: "Name", type: "text", required: true },
      { key: "lob_code", label: "Code", type: "text", required: true },
    ],
  },
  {
    key: "designations",
    label: "Designations",
    icon: <Tag className="h-4 w-4" />,
    apiPath: "/api/org/designations",
    fields: [
      { key: "designation_name", label: "Name", type: "text", required: true },
      { key: "designation_code", label: "Code", type: "text", required: true },
      { key: "grade", label: "Grade", type: "text" },
    ],
  },
  {
    key: "campaigns",
    label: "Campaigns",
    icon: <Megaphone className="h-4 w-4" />,
    apiPath: "/api/org/campaigns",
    fields: [
      { key: "campaign_name", label: "Name", type: "text", required: true },
      { key: "campaign_code", label: "Code", type: "text", required: true },
    ],
  },
  {
    key: "cost-centres",
    label: "Cost Centres",
    icon: <DollarSign className="h-4 w-4" />,
    apiPath: "/api/org/cost-centres",
    fields: [
      { key: "cost_centre_name", label: "Name", type: "text", required: true },
      { key: "cost_centre_code", label: "Code", type: "text", required: true },
    ],
  },
  {
    key: "grade-bands",
    label: "Grade Bands",
    icon: <Award className="h-4 w-4" />,
    apiPath: "/api/org/grade-bands",
    fields: [
      { key: "grade_name", label: "Name", type: "text", required: true },
      { key: "grade_code", label: "Code", type: "text", required: true },
      { key: "band", label: "Band", type: "text" },
    ],
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function isActive(record: OrgRecord): boolean {
  if (record.active_status !== undefined) return Number(record.active_status) === 1;
  if (typeof record.is_active === "boolean") return record.is_active;
  if (typeof record.active === "boolean") return record.active;
  if (record.status) return record.status === "active" || record.status === "1";
  return true;
}

function getRecordName(record: OrgRecord, tab: TabConfig): string {
  const nameField = tab.fields.find(f => f.label === "Name");
  return nameField ? String(record[nameField.key] ?? "–") : "–";
}

function getRecordCode(record: OrgRecord, tab: TabConfig): string {
  const codeField = tab.fields.find(f => f.label === "Code");
  return codeField ? String(record[codeField.key] ?? "–") : "–";
}

// ── Sub-components ───────────────────────────────────────────────────────────

interface FormModalProps {
  title: string;
  fields: FieldConfig[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  submitting: boolean;
  submitLabel: string;
}

function FormModal({
  title, fields, values, onChange, onSubmit, onClose, submitting, submitLabel,
}: FormModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-6">
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-6">
          {fields.map((field) =>
            field.type === "textarea" ? (
              <div key={field.key}>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  {field.label}
                </label>
                <textarea
                  value={values[field.key] ?? ""}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  rows={3}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
            ) : (
              <div key={field.key}>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  {field.label}
                  {field.required && <span className="text-rose-500 ml-1">*</span>}
                </label>
                <input
                  value={values[field.key] ?? ""}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
            )
          )}
        </div>
        <div className="flex gap-3 border-t p-6">
          <button
            onClick={onClose}
            className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {submitting ? "Saving…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Per-tab entity list ──────────────────────────────────────────────────────

interface EntityTabProps {
  tab: TabConfig;
  isAdmin: boolean;
}

function EntityTab({ tab, isAdmin }: EntityTabProps) {
  const [records, setRecords] = useState<OrgRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<Record<string, string>>({});
  const [addSubmitting, setAddSubmitting] = useState(false);

  const [editRecord, setEditRecord] = useState<OrgRecord | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | number | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ data: OrgRecord[] } | OrgRecord[]>(tab.apiPath);
      const data = Array.isArray(res) ? res : (res as { data: OrgRecord[] }).data ?? [];
      setRecords(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load";
      setMessage(msg);
    } finally {
      setLoading(false);
    }
  }, [tab.apiPath]);

  useEffect(() => { void load(); }, [load]);

  const openAdd = () => {
    setAddForm({});
    setShowAdd(true);
  };

  const submitAdd = async () => {
    const required = tab.fields.filter((f) => f.required).find((f) => !addForm[f.key]?.trim());
    if (required) { setMessage(`${required.label} is required.`); return; }
    setAddSubmitting(true);
    setMessage("");
    try {
      await hrmsApi.post(tab.apiPath, addForm);
      setShowAdd(false);
      setAddForm({});
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Create failed";
      setMessage(msg);
    } finally {
      setAddSubmitting(false);
    }
  };

  const openEdit = (record: OrgRecord) => {
    const form: Record<string, string> = {};
    tab.fields.forEach((f) => { form[f.key] = String(record[f.key] ?? ""); });
    setEditForm(form);
    setEditRecord(record);
  };

  const submitEdit = async () => {
    if (!editRecord) return;
    const required = tab.fields.filter((f) => f.required).find((f) => !editForm[f.key]?.trim());
    if (required) { setMessage(`${required.label} is required.`); return; }
    setEditSubmitting(true);
    setMessage("");
    try {
      await hrmsApi.put(`${tab.apiPath}/${editRecord.id}`, editForm);
      setEditRecord(null);
      setEditForm({});
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Update failed";
      setMessage(msg);
    } finally {
      setEditSubmitting(false);
    }
  };

  const submitDelete = async (id: string | number) => {
    setDeleteSubmitting(true);
    setMessage("");
    try {
      await hrmsApi.delete(`${tab.apiPath}/${id}`);
      setDeleteConfirmId(null);
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      setMessage(msg);
      setDeleteConfirmId(null);
    } finally {
      setDeleteSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Tab toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Add {tab.label.replace(/s$/, "")}
        </button>
      </div>

      {/* Message */}
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
          <button onClick={() => setMessage("")} className="ml-auto cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : records.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <div className="mx-auto mb-3 h-10 w-10 opacity-30 flex items-center justify-center">
              {tab.icon}
            </div>
            <p className="font-semibold">No {tab.label.toLowerCase()} found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-4 font-semibold">Name</th>
                  <th className="p-4 font-semibold">Code</th>
                  <th className="p-4 font-semibold">Status</th>
                  <th className="p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec) => (
                  <tr key={rec.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-semibold text-slate-900">{getRecordName(rec, tab)}</td>
                    <td className="p-4 font-mono text-xs text-slate-500">{getRecordCode(rec, tab)}</td>
                    <td className="p-4">
                      {isActive(rec) ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          <Check className="h-3 w-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(rec)}
                          className="cursor-pointer rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {isAdmin && (
                          deleteConfirmId === rec.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => submitDelete(rec.id)}
                                disabled={deleteSubmitting}
                                className="cursor-pointer rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 transition-colors disabled:opacity-50"
                              >
                                {deleteSubmitting ? "…" : "Confirm"}
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="cursor-pointer rounded-xl border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirmId(rec.id)}
                              className="cursor-pointer rounded-xl border border-rose-200 p-2 text-rose-500 hover:bg-rose-50 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add modal */}
      {showAdd && (
        <FormModal
          title={`Add ${tab.label.replace(/s$/, "")}`}
          fields={tab.fields}
          values={addForm}
          onChange={(k, v) => setAddForm((prev) => ({ ...prev, [k]: v }))}
          onSubmit={submitAdd}
          onClose={() => setShowAdd(false)}
          submitting={addSubmitting}
          submitLabel="Create"
        />
      )}

      {/* Edit modal */}
      {editRecord && (
        <FormModal
          title={`Edit ${tab.label.replace(/s$/, "")}`}
          fields={tab.fields}
          values={editForm}
          onChange={(k, v) => setEditForm((prev) => ({ ...prev, [k]: v }))}
          onSubmit={submitEdit}
          onClose={() => setEditRecord(null)}
          submitting={editSubmitting}
          submitLabel="Save Changes"
        />
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function NativeOrgMasters() {
  const { isAdminOrHR, roles } = useIsAdminOrHR();
  const isAdmin = roles.includes("admin");

  const [activeTab, setActiveTab] = useState<TabKey>("branches");
  const currentTab = TABS.find((t) => t.key === activeTab)!;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Administration</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Org Masters</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Manage organisation master data — branches, departments, LOBs, designations, campaigns, cost centres, and grade bands.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 rounded-2xl border bg-slate-50 p-1.5">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors cursor-pointer ${
                activeTab === tab.key
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Active tab content */}
        <EntityTab key={activeTab} tab={currentTab} isAdmin={isAdmin || isAdminOrHR} />
      </div>
    </DashboardLayout>
  );
}
