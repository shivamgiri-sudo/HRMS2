import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle, Building2, Layers, Briefcase, Tag,
  Megaphone, DollarSign, Award, Plus, Pencil, Trash2,
  Loader, RefreshCcw, X, Check, Network, Download, MapPin,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { BranchCoordPicker } from "@/components/BranchCoordPicker";

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
  | "grade-bands"
  | "processes";

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
  type: "text" | "textarea" | "select" | "date";
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

// ── Tab definitions ─────────────────────────────────────────────────────────

const TABS: TabConfig[] = [
  {
    key: "branches",
    label: "Branches",
    icon: <Building2 className="h-4 w-4" />,
    apiPath: "/api/org/branches",
    fields: [
      { key: "branch_name",     label: "Branch Name",                   type: "text",   required: true },
      { key: "branch_code",     label: "Branch Code",                   type: "text",   required: true, placeholder: "e.g. NOI, DEL, AHM" },
      { key: "sal_branch_code", label: "Salary / Establishment Code",   type: "text",   placeholder: "e.g. NOI-2 (from payroll system)" },
      { key: "company_name",    label: "Legal Entity",                  type: "select",
        options: [
          { value: "Mas Callnet India Pvt Ltd",  label: "Mas Callnet India Pvt Ltd" },
          { value: "IDC",                         label: "IDC (Ispark Dataconnect Pvt Ltd)" },
          { value: "Pikquick Pvt. Ltd.",          label: "Pikquick Pvt. Ltd." },
        ],
      },
      { key: "address",         label: "Full Address",                  type: "textarea" },
      { key: "city",            label: "City",                          type: "text" },
      { key: "state",           label: "State",                         type: "text" },
      { key: "pincode",         label: "Pincode",                       type: "text",   placeholder: "6-digit PIN" },
      { key: "gstin",           label: "GSTIN",                         type: "text",   placeholder: "e.g. 09AAACM5866H1ZR" },
      { key: "gst_state_code",  label: "GST State Code",                type: "text",   placeholder: "2-digit, e.g. 09" },
      { key: "hr_contact",      label: "HR Contact (Email / Phone)",    type: "text" },
      { key: "close_date",      label: "Close Date (if closed)",        type: "date" },
      { key: "latitude",        label: "Latitude (for live map)",       type: "text" },
      { key: "longitude",       label: "Longitude (for live map)",      type: "text" },
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
  // Processes tab uses a dedicated component — config here is used only for the tab button
  {
    key: "processes",
    label: "Processes / LOBs",
    icon: <Network className="h-4 w-4" />,
    apiPath: "/api/org/processes",
    fields: [],
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

/** Month an inactive record stopped being used, from close_date (branch/process/department/
 *  cost-centre masters). Returns null when no closure date was ever established — those records
 *  are deliberately left undated rather than guessed at. */
function inactiveSince(record: OrgRecord): string | null {
  const raw = (record as Record<string, unknown>).close_date;
  if (!raw) return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function getRecordName(record: OrgRecord, tab: TabConfig): string {
  const nameField = tab.fields.find(f => f.label.toLowerCase().includes("name"));
  return nameField ? String(record[nameField.key] ?? "–") : "–";
}

function getRecordCode(record: OrgRecord, tab: TabConfig): string {
  const codeField = tab.fields.find(f => f.label.toLowerCase().includes("code"));
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
  /** Optional extra content rendered immediately after a specific field (keyed by field.key) */
  renderAfterField?: Record<string, React.ReactNode>;
}

function FormModal({
  title, fields, values, onChange, onSubmit, onClose, submitting, submitLabel, renderAfterField,
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
          {fields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                {field.label}
                {field.required && <span className="text-rose-500 ml-1">*</span>}
              </label>
              {field.type === "textarea" ? (
                <textarea
                  value={values[field.key] ?? ""}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  rows={3}
                  placeholder={field.placeholder}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              ) : field.type === "select" ? (
                <select
                  value={values[field.key] ?? ""}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors bg-white"
                >
                  <option value="">— Select —</option>
                  {field.options?.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : field.type === "date" ? (
                <input
                  type="date"
                  value={values[field.key] ?? ""}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              ) : (
                <input
                  value={values[field.key] ?? ""}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              )}
              {renderAfterField?.[field.key]}
            </div>
          ))}
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

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"1" | "0" | "all">("1");

  // Branch filter — only department_master carries a branch_id among the tabs this
  // component renders (branches/lobs/designations/campaigns/grade-bands don't; see
  // TABLES_WITH_BRANCH_ID in org.service.ts). Fetching the branch list unconditionally
  // is cheap (45 rows, already cached by other tabs' own fetches) but only Departments
  // renders and applies the filter.
  const hasBranchFilter = tab.key === "departments";
  const [branchFilter, setBranchFilter] = useState("");
  const [branchOptions, setBranchOptions] = useState<{ id: string; branch_name: string }[]>([]);
  useEffect(() => {
    if (!hasBranchFilter) return;
    hrmsApi.get<{ data: { id: string; branch_name: string }[] } | { id: string; branch_name: string }[]>("/api/org/branches")
      .then((res) => setBranchOptions(Array.isArray(res) ? res : res.data ?? []))
      .catch(() => setBranchOptions([]));
  }, [hasBranchFilter]);

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<Record<string, string>>({});
  const [addSubmitting, setAddSubmitting] = useState(false);

  const [editRecord, setEditRecord] = useState<OrgRecord | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | number | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // Coordinate picker — only relevant for the branches tab
  const isBranchTab = tab.key === "branches";
  const [showAddCoordPicker, setShowAddCoordPicker] = useState(false);
  const [showEditCoordPicker, setShowEditCoordPicker] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      params.set("active_status", statusFilter);
      if (hasBranchFilter && branchFilter) params.set("branch_id", branchFilter);
      // branch_master holds live rows that share the same name but are NOT duplicates —
      // distinct locations, some with real employees linked, some blank twins. The default
      // list dedups by name and hides the rest, so editing "the branch" here could silently
      // update a row no employee is actually linked to. Ask for every row (+ employee counts)
      // so duplicate names can be told apart below.
      if (isBranchTab) params.set("include_duplicates", "1");
      const url = `${tab.apiPath}${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await hrmsApi.get<{ data: OrgRecord[] } | OrgRecord[]>(url);
      const data = Array.isArray(res) ? res : (res as { data: OrgRecord[] }).data ?? [];
      setRecords(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load";
      setMessage(msg);
    } finally {
      setLoading(false);
    }
  }, [tab.apiPath, searchQuery, statusFilter, hasBranchFilter, branchFilter, isBranchTab]);

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

  const toggleStatus = async (record: OrgRecord) => {
    const newStatus = isActive(record) ? 0 : 1;
    setMessage("");
    try {
      await hrmsApi.patch(`${tab.apiPath}/${record.id}/status`, { active_status: newStatus });
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Status update failed";
      setMessage(msg);
    }
  };

  // branch_master can hold multiple rows sharing the same name that are NOT duplicates —
  // distinct physical locations (see the include_duplicates note in load() above). Flag
  // them here so HR can tell which row to edit by Code / linked-employee count instead of
  // always landing on whichever one the old deduped list used to show.
  const duplicateNames = isBranchTab
    ? new Set(
        Object.entries(
          records.reduce<Record<string, number>>((acc, r) => {
            const name = getRecordName(r, tab).trim().toLowerCase();
            if (name) acc[name] = (acc[name] ?? 0) + 1;
            return acc;
          }, {})
        )
          .filter(([, count]) => count > 1)
          .map(([name]) => name)
      )
    : new Set<string>();

  return (
    <div className="space-y-4">
      {/* Tab toolbar */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => load()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
              {(["1", "0", "all"] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    statusFilter === status
                      ? "bg-slate-950 text-white"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {status === "1" ? "Active" : status === "0" ? "Inactive" : "All"}
                </button>
              ))}
            </div>
            {hasBranchFilter && (
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-400 transition-colors cursor-pointer"
              >
                <option value="">All Branches</option>
                {branchOptions.map((b) => (
                  <option key={b.id} value={b.id}>{b.branch_name}</option>
                ))}
              </select>
            )}
          </div>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Add {tab.label.replace(/s$/, "")}
          </button>
        </div>
        <input
          type="text"
          placeholder={`Search ${tab.label.toLowerCase()}...`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-400 transition-colors"
        />
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
                    <td className="p-4">
                      <span className="font-semibold text-slate-900">{getRecordName(rec, tab)}</span>
                      {(rec.city || rec.state) && (
                        <div className="text-xs text-slate-400 mt-0.5">
                          {[rec.city, rec.state].filter(Boolean).join(", ")}
                        </div>
                      )}
                      {rec.description && (
                        <div className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{String(rec.description)}</div>
                      )}
                      {rec.grade && (
                        <div className="text-xs text-slate-400 mt-0.5">Grade: {String(rec.grade)}</div>
                      )}
                      {rec.band && (
                        <div className="text-xs text-slate-400 mt-0.5">Band: {String(rec.band)}</div>
                      )}
                      {isBranchTab && typeof rec.employee_count === "number" && (
                        <div className="text-xs text-slate-400 mt-0.5">
                          {rec.employee_count} employee{rec.employee_count === 1 ? "" : "s"} linked
                        </div>
                      )}
                      {isBranchTab && duplicateNames.has(getRecordName(rec, tab).trim().toLowerCase()) && (
                        <div
                          className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                          title="Another branch row shares this name. Check Code and employees-linked before editing — they are separate physical locations, not one record."
                        >
                          <AlertTriangle className="h-3 w-3" /> Duplicate name — verify code
                        </div>
                      )}
                    </td>
                    <td className="p-4 font-mono text-xs text-slate-500">{getRecordCode(rec, tab)}</td>
                    <td className="p-4">
                      {isActive(rec) ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          <Check className="h-3 w-3" /> Active
                        </span>
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                            Inactive
                          </span>
                          {/* close_date records WHEN the record stopped being used — derived from
                              the last month salary was paid or an invoice was raised. Absent for
                              records whose closure date could not be established. */}
                          {inactiveSince(rec) && (
                            <span className="text-[10px] text-slate-400">since {inactiveSince(rec)}</span>
                          )}
                        </div>
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
                          <>
                            <button
                              onClick={() => toggleStatus(rec)}
                              className={`cursor-pointer rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                                isActive(rec)
                                  ? "border-amber-200 text-amber-700 hover:bg-amber-50"
                                  : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                              }`}
                              title={isActive(rec) ? "Deactivate" : "Activate"}
                            >
                              {isActive(rec) ? "Deactivate" : "Activate"}
                            </button>
                            {deleteConfirmId === rec.id ? (
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
                            )}
                          </>
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
          renderAfterField={isBranchTab ? {
            longitude: (
              <button
                type="button"
                onClick={() => setShowAddCoordPicker(true)}
                className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
              >
                <MapPin className="h-3.5 w-3.5" />
                Pick on map
              </button>
            ),
          } : undefined}
        />
      )}

      {/* Add coord picker */}
      {isBranchTab && showAddCoordPicker && (
        <BranchCoordPicker
          value={
            addForm.latitude || addForm.longitude
              ? { lat: addForm.latitude ?? "", lng: addForm.longitude ?? "" }
              : null
          }
          onChange={(v) => {
            setAddForm((prev) => ({ ...prev, latitude: v.lat, longitude: v.lng }));
          }}
          onClose={() => setShowAddCoordPicker(false)}
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
          renderAfterField={isBranchTab ? {
            longitude: (
              <button
                type="button"
                onClick={() => setShowEditCoordPicker(true)}
                className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
              >
                <MapPin className="h-3.5 w-3.5" />
                Pick on map
              </button>
            ),
          } : undefined}
        />
      )}

      {/* Edit coord picker */}
      {isBranchTab && showEditCoordPicker && (
        <BranchCoordPicker
          value={
            editForm.latitude || editForm.longitude
              ? { lat: editForm.latitude ?? "", lng: editForm.longitude ?? "" }
              : null
          }
          onChange={(v) => {
            setEditForm((prev) => ({ ...prev, latitude: v.lat, longitude: v.lng }));
          }}
          onClose={() => setShowEditCoordPicker(false)}
        />
      )}
    </div>
  );
}

// ── Process record type ──────────────────────────────────────────────────────

interface ProcessRecord {
  id: string;
  process_code: string;
  process_name: string;
  branch_id: string | null;
  branch_name: string | null;
  business_lob: string | null;
  workload_type: string | null;
  client_id: string | null;
  client_name: string | null;
  /** Comma-separated cost centre codes mapped to this process; NULL when none are. */
  cost_centre_codes: string | null;
  active_status: number;
}

interface BranchOption { id: string; branch_name: string; }
interface ClientOption { id: string; client_name: string; client_code: string; }
interface LOBOption { id: string; lob_name: string; lob_code: string; }

const WORKLOAD_TYPES = [
  { value: "", label: "— not set —" },
  { value: "inbound_voice", label: "Inbound Voice" },
  { value: "outbound_voice", label: "Outbound Voice" },
  { value: "chat", label: "Chat" },
  { value: "email", label: "Email" },
  { value: "backoffice", label: "Back Office" },
  { value: "data_verification", label: "Data Verification" },
  { value: "audit_quality", label: "Audit / Quality" },
  { value: "blended", label: "Blended" },
];

interface ProcessFormData {
  process_code: string;
  process_name: string;
  branch_id: string;
  business_lob: string;
  workload_type: string;
  client_id: string;
}

const emptyProcessForm = (): ProcessFormData => ({
  process_code: "",
  process_name: "",
  branch_id: "",
  business_lob: "",
  workload_type: "",
  client_id: "",
});

// ── Billing summary types ─────────────────────────────────────────────────────

interface BillingMonth { provision: number; billing: number; }
interface BillingSummaryEntry { bill_client_name: string | null; months: Record<string, BillingMonth>; }
type BillingSummaryMap = Record<string, BillingSummaryEntry>; // keyed by cost_centre_id

const BILLING_MONTHS = ["May-25", "Jun-25", "Jul-25"];

function fmt(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000) return `₹${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${n}`;
}

// ── Cost Centre types ─────────────────────────────────────────────────────────

interface CostCentreRecord {
  id: string;
  cost_centre_code: string;
  cost_centre_name: string;
  client_id: string | null;
  client_name: string | null;
  lob_id: string | null;
  lob_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  process_id: string | null;
  process_name: string | null;
  needs_migration: number;
  active_status: number;
  current_mandate: number | null;
  working_days_per_week: number | null;
  billing_days_per_month: number | null;
  hours_per_fte_per_day: number | null;
  billing_type: string | null;
}

interface CostCentreFormData {
  cost_centre_code: string;
  cost_centre_name: string;
  client_id: string;
  lob_id: string;
  branch_id: string;
  process_id: string;
  current_mandate: string;
  working_days_per_week: string;
  billing_days_per_month: string;
  hours_per_fte_per_day: string;
  billing_type: string;
}

const emptyCostCentreForm = (): CostCentreFormData => ({
  cost_centre_code: "",
  cost_centre_name: "",
  client_id: "",
  lob_id: "",
  branch_id: "",
  process_id: "",
  current_mandate: "0",
  working_days_per_week: "6",
  billing_days_per_month: "26",
  hours_per_fte_per_day: "8",
  billing_type: "seat",
});

function ProcessFormModal({
  title, form, branches, clients, onChange, onSubmit, onClose, submitting, submitLabel,
}: {
  title: string;
  form: ProcessFormData;
  branches: BranchOption[];
  clients: ClientOption[];
  onChange: (key: keyof ProcessFormData, value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-6">
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4 p-6">
          <div className="col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Process Name <span className="text-rose-500">*</span>
            </label>
            <input
              value={form.process_name}
              onChange={(e) => onChange("process_name", e.target.value)}
              placeholder="e.g. Onfido Verification"
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Process Code <span className="text-rose-500">*</span>
            </label>
            <input
              value={form.process_code}
              onChange={(e) => onChange("process_code", e.target.value)}
              placeholder="e.g. ONFIDO"
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors font-mono"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Client</label>
            <select
              value={form.client_id}
              onChange={(e) => onChange("client_id", e.target.value)}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors bg-white"
            >
              <option value="">— select client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.client_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Branch</label>
            <select
              value={form.branch_id}
              onChange={(e) => onChange("branch_id", e.target.value)}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors bg-white"
            >
              <option value="">— select branch —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.branch_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Workload Type</label>
            <select
              value={form.workload_type}
              onChange={(e) => onChange("workload_type", e.target.value)}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors bg-white"
            >
              {WORKLOAD_TYPES.map((w) => (
                <option key={w.value} value={w.value}>{w.label}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Business LOB</label>
            <input
              value={form.business_lob}
              onChange={(e) => onChange("business_lob", e.target.value)}
              placeholder="e.g. INBOUND CUSTOMER SERVICES"
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
            />
          </div>
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

function ProcessTab({ isAdmin }: { isAdmin: boolean }) {
  const [records, setRecords] = useState<ProcessRecord[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  // process_master carries both branch_id and client_id — see TABLES_WITH_BRANCH_ID in
  // org.service.ts and the branch_id/client_id passthrough on GET /api/org/processes.
  const [statusFilter, setStatusFilter] = useState<"1" | "0" | "all">("1");
  const [branchFilter, setBranchFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<ProcessFormData>(emptyProcessForm());
  const [addSubmitting, setAddSubmitting] = useState(false);

  const [editRecord, setEditRecord] = useState<ProcessRecord | null>(null);
  const [editForm, setEditForm] = useState<ProcessFormData>(emptyProcessForm());
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      params.set("active_status", statusFilter);
      if (branchFilter) params.set("branch_id", branchFilter);
      const [procRes, branchRes, clientRes] = await Promise.all([
        hrmsApi.get<{ data: ProcessRecord[] } | ProcessRecord[]>(`/api/org/processes?${params.toString()}`),
        hrmsApi.get<{ data: BranchOption[] } | BranchOption[]>("/api/org/branches"),
        hrmsApi.get<{ data: ClientOption[] } | ClientOption[]>("/api/clients"),
      ]);
      const procs = Array.isArray(procRes) ? procRes : (procRes as { data: ProcessRecord[] }).data ?? [];
      const brs = Array.isArray(branchRes) ? branchRes : (branchRes as { data: BranchOption[] }).data ?? [];
      const cls = Array.isArray(clientRes) ? clientRes : (clientRes as { data: ClientOption[] }).data ?? [];
      setRecords(procs);
      setBranches(brs);
      setClients(cls);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, branchFilter]);

  useEffect(() => { void load(); }, [load]);

  // client_id isn't filtered server-side (GET /api/org/processes doesn't take it — the
  // route only forwards branch_id, since process_master's own client linkage is via
  // client_id but that column isn't in TABLES_WITH_BRANCH_ID's server-side allowlist
  // path); kept as a client-side filter alongside search, same as before this change.
  const filtered = records.filter((r) => {
    if (clientFilter && r.client_id !== clientFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.process_name.toLowerCase().includes(q) ||
      r.process_code.toLowerCase().includes(q) ||
      (r.client_name ?? "").toLowerCase().includes(q) ||
      (r.branch_name ?? "").toLowerCase().includes(q) ||
      (r.business_lob ?? "").toLowerCase().includes(q)
    );
  });

  const openAdd = () => { setAddForm(emptyProcessForm()); setShowAdd(true); };

  const submitAdd = async () => {
    if (!addForm.process_name.trim()) { setMessage("Process name is required."); return; }
    if (!addForm.process_code.trim()) { setMessage("Process code is required."); return; }
    setAddSubmitting(true);
    setMessage("");
    try {
      await hrmsApi.post("/api/org/processes", addForm);
      setShowAdd(false);
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Create failed");
    } finally {
      setAddSubmitting(false);
    }
  };

  const openEdit = (rec: ProcessRecord) => {
    setEditForm({
      process_code: rec.process_code,
      process_name: rec.process_name,
      branch_id: rec.branch_id ?? "",
      business_lob: rec.business_lob ?? "",
      workload_type: rec.workload_type ?? "",
      client_id: rec.client_id ?? "",
    });
    setEditRecord(rec);
  };

  const submitEdit = async () => {
    if (!editRecord) return;
    if (!editForm.process_name.trim()) { setMessage("Process name is required."); return; }
    setEditSubmitting(true);
    setMessage("");
    try {
      await hrmsApi.put(`/api/org/processes/${editRecord.id}`, editForm);
      setEditRecord(null);
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Update failed");
    } finally {
      setEditSubmitting(false);
    }
  };

  const submitDelete = async (id: string) => {
    setDeleteSubmitting(true);
    setMessage("");
    try {
      await hrmsApi.delete(`/api/org/processes/${id}`);
      setDeleteConfirmId(null);
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Delete failed");
      setDeleteConfirmId(null);
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const workloadLabel = (wt: string | null) => WORKLOAD_TYPES.find((w) => w.value === wt)?.label ?? "—";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search process, client, branch…"
            className="w-64 rounded-2xl border px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
          />
          <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
            {(["1", "0", "all"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  statusFilter === status
                    ? "bg-slate-950 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {status === "1" ? "Active" : status === "0" ? "Inactive" : "All"}
              </button>
            ))}
          </div>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-400 transition-colors cursor-pointer"
          >
            <option value="">All Branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.branch_name}</option>
            ))}
          </select>
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-400 transition-colors cursor-pointer"
          >
            <option value="">All Clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.client_name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Add Process / LOB
        </button>
      </div>

      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
          <button onClick={() => setMessage("")} className="ml-auto cursor-pointer"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <Network className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No processes found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-4 font-semibold">Process Name</th>
                  <th className="p-4 font-semibold">Code</th>
                  <th className="p-4 font-semibold">Cost Centre</th>
                  <th className="p-4 font-semibold">Client</th>
                  <th className="p-4 font-semibold">Branch</th>
                  <th className="p-4 font-semibold">LOB</th>
                  <th className="p-4 font-semibold">Workload</th>
                  <th className="p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((rec) => (
                  <tr key={rec.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-semibold text-slate-900">{rec.process_name}</td>
                    <td className="p-4 font-mono text-xs text-slate-500">{rec.process_code}</td>
                    {/* Cost centre codes carried by this process (Req 18). Derived from
                        cost_centre_master.process_id on read; process_master.process_name is
                        never mutated. 110 of 131 processes are unmapped today, so the empty
                        state names the gap instead of showing a dash that reads as "none". */}
                    <td className="p-4">
                      {rec.cost_centre_codes ? (
                        <div className="flex flex-wrap gap-1">
                          {rec.cost_centre_codes.split(",").map((code) => (
                            <span
                              key={code}
                              className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700"
                            >
                              {code.trim()}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400" title="No cost centre in the Cost Centres tab points at this process">
                          not mapped
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-slate-700">{rec.client_name ?? <span className="text-slate-300">—</span>}</td>
                    <td className="p-4">
                      {rec.branch_name ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                          {rec.branch_name}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-xs">not set</span>
                      )}
                    </td>
                    <td className="p-4 text-xs text-slate-500">{rec.business_lob ?? "—"}</td>
                    <td className="p-4">
                      {rec.workload_type ? (
                        <span className="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-700">
                          {workloadLabel(rec.workload_type)}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
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
            <div className="border-t px-4 py-2 text-xs text-slate-400">
              Showing {filtered.length} of {records.length} processes
            </div>
          </div>
        )}
      </div>

      {showAdd && (
        <ProcessFormModal
          title="Add Process / LOB"
          form={addForm}
          branches={branches}
          clients={clients}
          onChange={(k, v) => setAddForm((prev) => ({ ...prev, [k]: v }))}
          onSubmit={submitAdd}
          onClose={() => setShowAdd(false)}
          submitting={addSubmitting}
          submitLabel="Create"
        />
      )}

      {editRecord && (
        <ProcessFormModal
          title={`Edit — ${editRecord.process_name}`}
          form={editForm}
          branches={branches}
          clients={clients}
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

// ── Cost Centre Tab ──────────────────────────────────────────────────────────

function CostCentreFormModal({
  title, form, clients, lobs, branches, processes, onChange, onSubmit, onClose, submitting, submitLabel,
}: {
  title: string;
  form: CostCentreFormData;
  clients: ClientOption[];
  lobs: LOBOption[];
  branches: BranchOption[];
  processes: ProcessRecord[];
  onChange: (key: keyof CostCentreFormData, value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  const filteredProcesses = form.branch_id
    ? processes.filter((p) => p.branch_id === form.branch_id || !p.branch_id)
    : processes;

  const suggestCode = () => {
    const client = clients.find((c) => c.id === form.client_id);
    const branch = branches.find((b) => b.id === form.branch_id);
    const process = processes.find((p) => p.id === form.process_id);
    if (client && branch && process) {
      return `${client.client_code}_${branch.branch_name?.substring(0, 3).toUpperCase() || "BR"}_${process.process_code}`;
    }
    return "";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b p-6 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6 space-y-5">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
            <strong>Required:</strong> All four relationships (Client, LOB, Branch, Process) must be selected to create a cost centre.
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Client <span className="text-rose-500">*</span>
              </label>
              <select
                value={form.client_id}
                onChange={(e) => onChange("client_id", e.target.value)}
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors bg-white"
              >
                <option value="">— select client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.client_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                LOB <span className="text-rose-500">*</span>
              </label>
              <select
                value={form.lob_id}
                onChange={(e) => onChange("lob_id", e.target.value)}
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors bg-white"
              >
                <option value="">— select LOB —</option>
                {lobs.map((l) => (
                  <option key={l.id} value={l.id}>{l.lob_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Branch <span className="text-rose-500">*</span>
              </label>
              <select
                value={form.branch_id}
                onChange={(e) => {
                  onChange("branch_id", e.target.value);
                  if (form.process_id) {
                    const proc = processes.find((p) => p.id === form.process_id);
                    if (proc && proc.branch_id && proc.branch_id !== e.target.value) {
                      onChange("process_id", "");
                    }
                  }
                }}
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors bg-white"
              >
                <option value="">— select branch —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.branch_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Process <span className="text-rose-500">*</span>
              </label>
              <select
                value={form.process_id}
                onChange={(e) => onChange("process_id", e.target.value)}
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors bg-white"
              >
                <option value="">— select process —</option>
                {filteredProcesses.map((p) => (
                  <option key={p.id} value={p.id}>{p.process_name}</option>
                ))}
              </select>
              {form.branch_id && filteredProcesses.length < processes.length && (
                <p className="text-xs text-slate-400 mt-1">Filtered by selected branch</p>
              )}
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Cost Centre Code <span className="text-rose-500">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    value={form.cost_centre_code}
                    onChange={(e) => onChange("cost_centre_code", e.target.value)}
                    placeholder="e.g. ABC_DEL_PROC1"
                    className="flex-1 rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors font-mono"
                  />
                  {form.client_id && form.branch_id && form.process_id && !form.cost_centre_code && (
                    <button
                      type="button"
                      onClick={() => onChange("cost_centre_code", suggestCode())}
                      className="px-3 py-2 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                    >
                      Suggest
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Cost Centre Name <span className="text-rose-500">*</span>
                </label>
                <input
                  value={form.cost_centre_name}
                  onChange={(e) => onChange("cost_centre_name", e.target.value)}
                  placeholder="e.g. ABC Corp Delhi Process1"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Billing Config (Optional)</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Current Mandate (Seats)</label>
                <input
                  type="number"
                  value={form.current_mandate}
                  onChange={(e) => onChange("current_mandate", e.target.value)}
                  placeholder="0"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Working Days/Week</label>
                <select
                  value={form.working_days_per_week}
                  onChange={(e) => {
                    onChange("working_days_per_week", e.target.value);
                    onChange("billing_days_per_month", e.target.value === "7" ? "25" : "26");
                  }}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors bg-white"
                >
                  <option value="6">6 days</option>
                  <option value="7">7 days</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Billing Days/Month</label>
                <input
                  type="number"
                  value={form.billing_days_per_month}
                  onChange={(e) => onChange("billing_days_per_month", e.target.value)}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Hours/FTE/Day</label>
                <input
                  type="number"
                  step="0.5"
                  value={form.hours_per_fte_per_day}
                  onChange={(e) => onChange("hours_per_fte_per_day", e.target.value)}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-3 border-t p-6 sticky bottom-0 bg-white">
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

function CostCentreTab({ isAdmin }: { isAdmin: boolean }) {
  const [records, setRecords] = useState<CostCentreRecord[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [lobs, setLobs] = useState<LOBOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [processes, setProcesses] = useState<ProcessRecord[]>([]);
  const [billingSummary, setBillingSummary] = useState<BillingSummaryMap>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"1" | "0" | "all">("1");
  const [branchFilter, setBranchFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [lobFilter, setLobFilter] = useState("");
  const [processFilter, setProcessFilter] = useState("");
  const [showBilling, setShowBilling] = useState(false);

  const [migrationStatus, setMigrationStatus] = useState<{ total: number; orphaned: number; migrationComplete: boolean; message: string } | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<CostCentreFormData>(emptyCostCentreForm());
  const [addSubmitting, setAddSubmitting] = useState(false);

  const [editRecord, setEditRecord] = useState<CostCentreRecord | null>(null);
  const [editForm, setEditForm] = useState<CostCentreFormData>(emptyCostCentreForm());
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [migrateRecord, setMigrateRecord] = useState<CostCentreRecord | null>(null);
  const [migrateForm, setMigrateForm] = useState<CostCentreFormData>(emptyCostCentreForm());
  const [migrateSubmitting, setMigrateSubmitting] = useState(false);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      params.set("active_status", statusFilter);
      if (branchFilter) params.set("branch_id", branchFilter);
      if (clientFilter) params.set("client_id", clientFilter);
      if (lobFilter) params.set("lob_id", lobFilter);
      if (processFilter) params.set("process_id", processFilter);
      const url = `/api/org/cost-centres${params.toString() ? `?${params.toString()}` : ""}`;

      const [ccRes, clientRes, lobRes, branchRes, procRes, migRes, billRes] = await Promise.all([
        hrmsApi.get<{ data: CostCentreRecord[] } | CostCentreRecord[]>(url),
        hrmsApi.get<{ data: ClientOption[] } | ClientOption[]>("/api/clients"),
        hrmsApi.get<{ data: LOBOption[] } | LOBOption[]>("/api/org/lobs"),
        hrmsApi.get<{ data: BranchOption[] } | BranchOption[]>("/api/org/branches"),
        hrmsApi.get<{ data: ProcessRecord[] } | ProcessRecord[]>("/api/org/processes"),
        hrmsApi.get<{ success: boolean; data: typeof migrationStatus }>("/api/org/cost-centres/migration-status"),
        hrmsApi.get<{ success: boolean; data: BillingSummaryMap }>("/api/org/cost-centres/billing-summary"),
      ]);

      setRecords(Array.isArray(ccRes) ? ccRes : ccRes.data ?? []);
      setClients(Array.isArray(clientRes) ? clientRes : clientRes.data ?? []);
      setLobs(Array.isArray(lobRes) ? lobRes : lobRes.data ?? []);
      setBranches(Array.isArray(branchRes) ? branchRes : branchRes.data ?? []);
      setProcesses(Array.isArray(procRes) ? procRes : procRes.data ?? []);
      setMigrationStatus(migRes.data ?? null);
      setBillingSummary((billRes as { success: boolean; data: BillingSummaryMap }).data ?? {});
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, branchFilter, clientFilter, lobFilter, processFilter]);

  useEffect(() => { void load(); }, [load]);

  const openAdd = () => {
    if (migrationStatus && !migrationStatus.migrationComplete) {
      setMessage(`Cannot create new cost centres: ${migrationStatus.orphaned} existing record(s) need migration first.`);
      return;
    }
    setAddForm(emptyCostCentreForm());
    setShowAdd(true);
  };

  const submitAdd = async () => {
    if (!addForm.client_id) { setMessage("Client is required."); return; }
    if (!addForm.lob_id) { setMessage("LOB is required."); return; }
    if (!addForm.branch_id) { setMessage("Branch is required."); return; }
    if (!addForm.process_id) { setMessage("Process is required."); return; }
    if (!addForm.cost_centre_code.trim()) { setMessage("Cost centre code is required."); return; }
    if (!addForm.cost_centre_name.trim()) { setMessage("Cost centre name is required."); return; }
    setAddSubmitting(true);
    setMessage("");
    try {
      await hrmsApi.post("/api/org/cost-centres", addForm);
      setShowAdd(false);
      setAddForm(emptyCostCentreForm());
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Create failed");
    } finally {
      setAddSubmitting(false);
    }
  };

  const openEdit = (rec: CostCentreRecord) => {
    setEditForm({
      cost_centre_code: rec.cost_centre_code,
      cost_centre_name: rec.cost_centre_name,
      client_id: rec.client_id ?? "",
      lob_id: rec.lob_id ?? "",
      branch_id: rec.branch_id ?? "",
      process_id: rec.process_id ?? "",
      current_mandate: String(rec.current_mandate ?? 0),
      working_days_per_week: String(rec.working_days_per_week ?? 6),
      billing_days_per_month: String(rec.billing_days_per_month ?? 26),
      hours_per_fte_per_day: String(rec.hours_per_fte_per_day ?? 8),
      billing_type: rec.billing_type ?? "seat",
    });
    setEditRecord(rec);
  };

  const submitEdit = async () => {
    if (!editRecord) return;
    if (!editForm.cost_centre_name.trim()) { setMessage("Cost centre name is required."); return; }
    setEditSubmitting(true);
    setMessage("");
    try {
      await hrmsApi.put(`/api/org/cost-centres/${editRecord.id}`, editForm);
      setEditRecord(null);
      setEditForm(emptyCostCentreForm());
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Update failed");
    } finally {
      setEditSubmitting(false);
    }
  };

  const openMigrate = (rec: CostCentreRecord) => {
    setMigrateForm({
      cost_centre_code: rec.cost_centre_code,
      cost_centre_name: rec.cost_centre_name,
      client_id: rec.client_id ?? "",
      lob_id: rec.lob_id ?? "",
      branch_id: rec.branch_id ?? "",
      process_id: rec.process_id ?? "",
    });
    setMigrateRecord(rec);
  };

  const submitMigrate = async () => {
    if (!migrateRecord) return;
    if (!migrateForm.client_id) { setMessage("Client is required."); return; }
    if (!migrateForm.lob_id) { setMessage("LOB is required."); return; }
    if (!migrateForm.branch_id) { setMessage("Branch is required."); return; }
    if (!migrateForm.process_id) { setMessage("Process is required."); return; }
    setMigrateSubmitting(true);
    setMessage("");
    try {
      await hrmsApi.put(`/api/org/cost-centres/${migrateRecord.id}/migrate`, migrateForm);
      setMigrateRecord(null);
      setMigrateForm(emptyCostCentreForm());
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Migration failed");
    } finally {
      setMigrateSubmitting(false);
    }
  };

  const submitDelete = async (id: string) => {
    setDeleteSubmitting(true);
    setMessage("");
    try {
      await hrmsApi.delete(`/api/org/cost-centres/${id}`);
      setDeleteConfirmId(null);
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Delete failed");
      setDeleteConfirmId(null);
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const toggleStatus = async (record: CostCentreRecord) => {
    const newStatus = isActive(record as unknown as OrgRecord) ? 0 : 1;
    setMessage("");
    try {
      await hrmsApi.patch(`/api/org/cost-centres/${record.id}/status`, { active_status: newStatus });
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Status update failed");
    }
  };

  return (
    <div className="space-y-4">
      {/* Migration Warning Banner */}
      {migrationStatus && !migrationStatus.migrationComplete && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-amber-800">Data Migration Required</p>
            <p className="text-sm text-amber-700 mt-1">
              {migrationStatus.message} Click the <strong>Migrate</strong> button on each record to assign the required Client, LOB, Branch, and Process relationships.
            </p>
          </div>
        </div>
      )}

      {/* Tab toolbar */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => load()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
              {(["1", "0", "all"] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    statusFilter === status
                      ? "bg-slate-950 text-white"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {status === "1" ? "Active" : status === "0" ? "Inactive" : "All"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-400 transition-colors cursor-pointer"
            >
              <option value="">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.branch_name}</option>
              ))}
            </select>
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-400 transition-colors cursor-pointer"
            >
              <option value="">All Clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.client_name}</option>
              ))}
            </select>
            <select
              value={lobFilter}
              onChange={(e) => setLobFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-400 transition-colors cursor-pointer"
            >
              <option value="">All LOBs</option>
              {lobs.map((l) => (
                <option key={l.id} value={l.id}>{l.lob_name}</option>
              ))}
            </select>
            <select
              value={processFilter}
              onChange={(e) => setProcessFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-400 transition-colors cursor-pointer"
            >
              <option value="">All Processes</option>
              {processes.map((p) => (
                <option key={p.id} value={p.id}>{p.process_name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBilling((v) => !v)}
              className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold transition-colors cursor-pointer ${
                showBilling
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <DollarSign className="h-4 w-4" />
              {showBilling ? "Hide Billing" : "Billing (May–Jul 25)"}
            </button>
            <button
              onClick={openAdd}
              disabled={!!(migrationStatus && !migrationStatus.migrationComplete)}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title={migrationStatus && !migrationStatus.migrationComplete ? "Complete migration first" : undefined}
            >
              <Plus className="h-4 w-4" />
              Add Cost Centre
            </button>
          </div>
        </div>
        <input
          type="text"
          placeholder="Search cost centres, clients, processes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-400 transition-colors"
        />
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
            <DollarSign className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No cost centres found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-4 font-semibold">Code</th>
                  <th className="p-4 font-semibold">Name</th>
                  <th className="p-4 font-semibold">Client</th>
                  <th className="p-4 font-semibold">LOB</th>
                  <th className="p-4 font-semibold">Branch</th>
                  <th className="p-4 font-semibold">Process</th>
                  {showBilling && (
                    <>
                      <th className="p-4 font-semibold text-right">May-25</th>
                      <th className="p-4 font-semibold text-right">Jun-25</th>
                      <th className="p-4 font-semibold text-right">Jul-25</th>
                      <th className="p-4 font-semibold text-right">Billing Status</th>
                    </>
                  )}
                  <th className="p-4 font-semibold">Status</th>
                  <th className="p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec) => {
                  const needsMigration = rec.needs_migration === 1;
                  return (
                    <tr key={rec.id} className={`border-t hover:bg-slate-50/80 transition-colors ${needsMigration ? "bg-amber-50/50" : ""}`}>
                      <td className="p-4 font-mono text-xs text-slate-600">{rec.cost_centre_code}</td>
                      <td className="p-4 font-semibold text-slate-900">{rec.cost_centre_name}</td>
                      <td className="p-4">
                        {rec.client_name ? (
                          <span className="text-slate-700">{rec.client_name}</span>
                        ) : (
                          <span className="text-rose-400 text-xs font-semibold">Not set</span>
                        )}
                      </td>
                      <td className="p-4">
                        {rec.lob_name ? (
                          <span className="text-slate-600 text-xs">{rec.lob_name}</span>
                        ) : (
                          <span className="text-rose-400 text-xs font-semibold">Not set</span>
                        )}
                      </td>
                      <td className="p-4">
                        {rec.branch_name ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                            {rec.branch_name}
                          </span>
                        ) : (
                          <span className="text-rose-400 text-xs font-semibold">Not set</span>
                        )}
                      </td>
                      <td className="p-4">
                        {rec.process_name ? (
                          <span className="text-slate-600 text-xs">{rec.process_name}</span>
                        ) : (
                          <span className="text-rose-400 text-xs font-semibold">Not set</span>
                        )}
                      </td>
                      {showBilling && (() => {
                        const bs = billingSummary[rec.id];
                        if (!bs) return (
                          <>
                            <td className="p-4 text-right text-slate-300 text-xs">—</td>
                            <td className="p-4 text-right text-slate-300 text-xs">—</td>
                            <td className="p-4 text-right text-slate-300 text-xs">—</td>
                            <td className="p-4 text-right"><span className="text-xs text-slate-300">No data</span></td>
                          </>
                        );
                        const allBilled = BILLING_MONTHS.every(m => bs.months[m]?.billing > 0);
                        const someBilled = BILLING_MONTHS.some(m => bs.months[m]?.billing > 0);
                        const hasProvision = BILLING_MONTHS.some(m => bs.months[m]?.provision > 0);
                        return (
                          <>
                            {BILLING_MONTHS.map(m => {
                              const mo = bs.months[m];
                              if (!mo) return <td key={m} className="p-4 text-right text-slate-300 text-xs">—</td>;
                              return (
                                <td key={m} className="p-4 text-right text-xs">
                                  {mo.billing > 0 ? (
                                    <span className="font-semibold text-emerald-700">{fmt(mo.billing)}</span>
                                  ) : mo.provision > 0 ? (
                                    <span className="text-amber-600">{fmt(mo.provision)}<span className="ml-1 text-slate-400">(prov)</span></span>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="p-4 text-right">
                              {allBilled ? (
                                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Billed</span>
                              ) : someBilled ? (
                                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Partial</span>
                              ) : hasProvision ? (
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Prov only</span>
                              ) : (
                                <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs text-slate-400">—</span>
                              )}
                            </td>
                          </>
                        );
                      })()}
                      <td className="p-4">
                        {isActive(rec as unknown as OrgRecord) ? (
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
                          {needsMigration && (
                            <button
                              onClick={() => openMigrate(rec)}
                              className="cursor-pointer rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600 transition-colors"
                              title="Migrate - assign required relationships"
                            >
                              Migrate
                            </button>
                          )}
                          <button
                            onClick={() => openEdit(rec)}
                            className="cursor-pointer rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => toggleStatus(rec)}
                                className={`cursor-pointer rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                                  isActive(rec as unknown as OrgRecord)
                                    ? "border-amber-200 text-amber-700 hover:bg-amber-50"
                                    : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                }`}
                                title={isActive(rec as unknown as OrgRecord) ? "Deactivate" : "Activate"}
                              >
                                {isActive(rec as unknown as OrgRecord) ? "Deactivate" : "Activate"}
                              </button>
                              {deleteConfirmId === rec.id ? (
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
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="border-t px-4 py-2 text-xs text-slate-400">
              Showing {records.length} cost centre(s)
              {migrationStatus && migrationStatus.orphaned > 0 && (
                <span className="ml-2 text-amber-600">
                  ({migrationStatus.orphaned} need migration)
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add modal */}
      {showAdd && (
        <CostCentreFormModal
          title="Add Cost Centre"
          form={addForm}
          clients={clients}
          lobs={lobs}
          branches={branches}
          processes={processes}
          onChange={(k, v) => setAddForm((prev) => ({ ...prev, [k]: v }))}
          onSubmit={submitAdd}
          onClose={() => setShowAdd(false)}
          submitting={addSubmitting}
          submitLabel="Create"
        />
      )}

      {/* Edit modal */}
      {editRecord && (
        <CostCentreFormModal
          title={`Edit — ${editRecord.cost_centre_name}`}
          form={editForm}
          clients={clients}
          lobs={lobs}
          branches={branches}
          processes={processes}
          onChange={(k, v) => setEditForm((prev) => ({ ...prev, [k]: v }))}
          onSubmit={submitEdit}
          onClose={() => setEditRecord(null)}
          submitting={editSubmitting}
          submitLabel="Save Changes"
        />
      )}

      {/* Migrate modal */}
      {migrateRecord && (
        <CostCentreFormModal
          title={`Migrate — ${migrateRecord.cost_centre_name}`}
          form={migrateForm}
          clients={clients}
          lobs={lobs}
          branches={branches}
          processes={processes}
          onChange={(k, v) => setMigrateForm((prev) => ({ ...prev, [k]: v }))}
          onSubmit={submitMigrate}
          onClose={() => setMigrateRecord(null)}
          submitting={migrateSubmitting}
          submitLabel="Complete Migration"
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
  const [downloading, setDownloading] = useState(false);

  const downloadExcel = async () => {
    setDownloading(true);
    try {
      const blob = await hrmsApi.getBlob("/api/org/export/masters");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `org-masters-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore — user can retry
    } finally {
      setDownloading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Administration</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Org Masters</h1>
            <p className="mt-2 max-w-3xl text-slate-600">
              Manage organisation master data — branches, departments, LOBs, designations, campaigns, cost centres, and grade bands.
            </p>
          </div>
          <button
            onClick={downloadExcel}
            disabled={downloading}
            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-800 hover:bg-emerald-100 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
          >
            {downloading ? <Loader className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {downloading ? "Downloading…" : "Download Excel"}
          </button>
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
        {activeTab === "processes" ? (
          <ProcessTab key="processes" isAdmin={isAdmin || isAdminOrHR} />
        ) : activeTab === "cost-centres" ? (
          <CostCentreTab key="cost-centres" isAdmin={isAdmin || isAdminOrHR} />
        ) : (
          <EntityTab key={activeTab} tab={currentTab} isAdmin={isAdmin || isAdminOrHR} />
        )}
      </div>
    </DashboardLayout>
  );
}
