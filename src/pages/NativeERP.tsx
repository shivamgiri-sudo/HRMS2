import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, Clock,
  FileText, Loader, Plus, RefreshCcw, Search,
  ShoppingCart, Users, X, Receipt, ShieldCheck,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ───────────────────────────────────────────────────────────────────

type VendorType = "supplier" | "service" | "contractor" | "other";

type Vendor = {
  id: string;
  vendor_code: string;
  vendor_name: string;
  vendor_type: VendorType;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  gst_number: string | null;
  pan_number: string | null;
  payment_terms: string | null;
  is_active: number;
};

type ContractType = "sow" | "msa" | "nda" | "po" | "other";
type ContractStatus = "draft" | "active" | "expired" | "terminated";

type Contract = {
  id: string;
  contract_code: string;
  title: string;
  vendor_id: string | null;
  vendor_name: string | null;
  client_id: string | null;
  contract_type: ContractType;
  start_date: string;
  end_date: string | null;
  value: number | null;
  status: ContractStatus;
  notes: string | null;
};

type ExpenseCategory =
  | "travel" | "accommodation" | "meals" | "transport"
  | "communication" | "office" | "other";
type ExpenseStatus = "draft" | "submitted" | "approved" | "rejected" | "paid";

type ExpenseClaim = {
  id: string;
  employee_id: string;
  employee_name: string | null;
  employee_code: string | null;
  expense_date: string;
  category: ExpenseCategory;
  amount: number;
  currency: string;
  description: string | null;
  receipt_ref: string | null;
  project_code: string | null;
  status: ExpenseStatus;
  remarks: string | null;
  reviewed_at: string | null;
};

type ProcurementStatus =
  | "draft" | "submitted" | "approved" | "ordered" | "received" | "rejected";

type ProcurementRequest = {
  id: string;
  req_code: string;
  requested_by: string;
  requester_name: string | null;
  item_name: string;
  quantity: number;
  estimated_cost: number | null;
  vendor_id: string | null;
  vendor_name: string | null;
  department_id: string | null;
  department_name: string | null;
  required_by: string | null;
  justification: string | null;
  status: ProcurementStatus;
  remarks: string | null;
};

type BillingType = "per_seat" | "per_transaction" | "fixed_monthly" | "revenue_share";
type BillingPeriod = "weekly" | "monthly" | "quarterly";
type InvoiceStatus = "draft" | "sent" | "acknowledged" | "paid" | "disputed";

type BillingUnit = {
  id: string;
  process_id: string;
  process_code: string | null;
  process_name: string | null;
  contract_id: string | null;
  billing_type: BillingType;
  rate: number;
  currency: string;
  billing_period: BillingPeriod;
  effective_from: string;
  effective_to: string | null;
  is_active: number;
};

type BillingInvoice = {
  id: string;
  invoice_ref: string;
  process_id: string;
  process_code: string | null;
  process_name: string | null;
  billing_unit_id: string | null;
  period_from: string;
  period_to: string;
  billable_units: number;
  rate: number;
  gross_amount: number;
  adjustments: number;
  net_amount: number;
  gst_amount: number;
  total_amount: number;
  status: InvoiceStatus;
  notes: string | null;
  sent_at: string | null;
  paid_at: string | null;
};

type ExpensePolicy = {
  id: string;
  category: ExpenseCategory;
  max_amount: number;
  requires_receipt_above: number;
  approval_required: number;
  notes: string | null;
};

// ─── Colour maps ─────────────────────────────────────────────────────────────

const EXPENSE_STATUS_COLORS: Record<ExpenseStatus, string> = {
  draft:     "bg-slate-100 text-slate-700",
  submitted: "bg-blue-50 text-blue-700",
  approved:  "bg-emerald-50 text-emerald-700",
  rejected:  "bg-red-50 text-red-700",
  paid:      "bg-green-100 text-green-800",
};

const CONTRACT_STATUS_COLORS: Record<ContractStatus, string> = {
  draft:      "bg-slate-100 text-slate-700",
  active:     "bg-emerald-50 text-emerald-700",
  expired:    "bg-amber-50 text-amber-700",
  terminated: "bg-red-50 text-red-700",
};

const PROC_STATUS_COLORS: Record<ProcurementStatus, string> = {
  draft:     "bg-slate-100 text-slate-700",
  submitted: "bg-blue-50 text-blue-700",
  approved:  "bg-emerald-50 text-emerald-700",
  ordered:   "bg-cyan-50 text-cyan-700",
  received:  "bg-green-100 text-green-800",
  rejected:  "bg-red-50 text-red-700",
};

const VENDOR_TYPE_COLORS: Record<VendorType, string> = {
  supplier:   "bg-blue-50 text-blue-700",
  service:    "bg-violet-50 text-violet-700",
  contractor: "bg-amber-50 text-amber-700",
  other:      "bg-slate-100 text-slate-600",
};

const INVOICE_STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft:        "bg-slate-100 text-slate-700",
  sent:         "bg-blue-50 text-blue-700",
  acknowledged: "bg-cyan-50 text-cyan-700",
  paid:         "bg-emerald-50 text-emerald-700",
  disputed:     "bg-red-50 text-red-700",
};

// ─── Shared helpers ──────────────────────────────────────────────────────────

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold capitalize ${cls}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
        {children}
      </div>
    </div>
  );
}

function FormField({
  label, children,
}: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors";
const selectCls = inputCls;

// ─── Tab: Expenses ────────────────────────────────────────────────────────────

type ExpenseFormState = {
  expense_date: string;
  category: ExpenseCategory;
  amount: string;
  currency: string;
  description: string;
  receipt_ref: string;
  project_code: string;
};

const defaultExpenseForm: ExpenseFormState = {
  expense_date: "",
  category: "other",
  amount: "",
  currency: "INR",
  description: "",
  receipt_ref: "",
  project_code: "",
};

function ExpensesTab() {
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<ExpenseFormState>(defaultExpenseForm);
  const [submitting, setSubmitting] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: ExpenseClaim[] }>("/api/erp/expenses");
      setClaims(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load expenses");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const submit = async () => {
    if (!form.expense_date || !form.amount) {
      return setMessage("Date and amount are required.");
    }
    setSubmitting(true);
    try {
      await hrmsApi.post("/api/erp/expenses", { ...form, amount: parseFloat(form.amount) });
      setShowModal(false);
      setForm(defaultExpenseForm);
      setMessage("Expense claim submitted.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const review = async (id: string, action: "approved" | "rejected") => {
    setReviewing(id);
    try {
      await hrmsApi.patch(`/api/erp/expenses/${id}/review`, { action });
      setMessage(`Expense ${action}.`);
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Review failed.");
    } finally {
      setReviewing(null);
    }
  };

  const filtered = claims.filter((c) => {
    const q = search.toLowerCase();
    return !q || [c.employee_name, c.employee_code, c.category, c.status, c.project_code]
      .join(" ").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search expenses…"
            className="h-11 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400"
          />
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
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Submit Expense
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <FileText className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No expense claims found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Employee", "Date", "Category", "Amount", "Project", "Status", "Actions"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4">
                      <div className="font-bold text-slate-950">{c.employee_name ?? c.employee_id}</div>
                      <div className="text-xs text-slate-400 font-mono">{c.employee_code ?? ""}</div>
                    </td>
                    <td className="p-4 font-mono text-slate-600">{c.expense_date?.slice(0, 10)}</td>
                    <td className="p-4 capitalize text-slate-600">{c.category}</td>
                    <td className="p-4 font-semibold text-slate-950">
                      {c.currency} {Number(c.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-4 text-slate-500">{c.project_code ?? "–"}</td>
                    <td className="p-4">
                      <Badge label={c.status} cls={EXPENSE_STATUS_COLORS[c.status]} />
                    </td>
                    <td className="p-4">
                      {c.status === "submitted" && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => review(c.id, "approved")}
                            disabled={reviewing === c.id}
                            className="cursor-pointer rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => review(c.id, "rejected")}
                            disabled={reviewing === c.id}
                            className="cursor-pointer rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
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

      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div className="flex items-center justify-between border-b p-6">
            <h2 className="text-lg font-black text-slate-950">Submit Expense</h2>
            <button onClick={() => setShowModal(false)} className="cursor-pointer text-slate-400 hover:text-slate-700">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="overflow-y-auto p-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Expense Date">
                <input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} className={inputCls} />
              </FormField>
              <FormField label="Category">
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })} className={selectCls}>
                  {(["travel","accommodation","meals","transport","communication","office","other"] as ExpenseCategory[]).map((c) => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Amount">
                <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" className={inputCls} />
              </FormField>
              <FormField label="Currency">
                <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className={selectCls}>
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </FormField>
            </div>
            <FormField label="Receipt Reference">
              <input value={form.receipt_ref} onChange={(e) => setForm({ ...form, receipt_ref: e.target.value })} placeholder="Invoice / receipt number" className={inputCls} />
            </FormField>
            <FormField label="Project Code">
              <input value={form.project_code} onChange={(e) => setForm({ ...form, project_code: e.target.value })} placeholder="Optional project code" className={inputCls} />
            </FormField>
            <FormField label="Description">
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Brief description…" className={`${inputCls} resize-none`} />
            </FormField>
          </div>
          <div className="flex gap-3 border-t p-6">
            <button onClick={() => setShowModal(false)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button onClick={submit} disabled={submitting} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
              {submitting ? "Submitting…" : "Submit Claim"}
            </button>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

// ─── Tab: Vendors ────────────────────────────────────────────────────────────

type VendorFormState = {
  vendor_code: string;
  vendor_name: string;
  vendor_type: VendorType;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  address: string;
  gst_number: string;
  pan_number: string;
  payment_terms: string;
  is_active: number;
};

const defaultVendorForm: VendorFormState = {
  vendor_code: "", vendor_name: "", vendor_type: "supplier",
  contact_name: "", contact_email: "", contact_phone: "",
  address: "", gst_number: "", pan_number: "", payment_terms: "", is_active: 1,
};

function VendorsTab() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Vendor | null>(null);
  const [form, setForm] = useState<VendorFormState>(defaultVendorForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Vendor[] }>("/api/erp/vendors");
      setVendors(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load vendors");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const openAdd = () => { setEditTarget(null); setForm(defaultVendorForm); setShowModal(true); };
  const openEdit = (v: Vendor) => {
    setEditTarget(v);
    setForm({
      vendor_code: v.vendor_code, vendor_name: v.vendor_name, vendor_type: v.vendor_type,
      contact_name: v.contact_name ?? "", contact_email: v.contact_email ?? "",
      contact_phone: v.contact_phone ?? "", address: v.address ?? "",
      gst_number: v.gst_number ?? "", pan_number: v.pan_number ?? "",
      payment_terms: v.payment_terms ?? "", is_active: v.is_active,
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.vendor_code || !form.vendor_name) return setMessage("Vendor code and name are required.");
    setSaving(true);
    try {
      if (editTarget) {
        await hrmsApi.put(`/api/erp/vendors/${editTarget.id}`, form);
        setMessage("Vendor updated.");
      } else {
        await hrmsApi.post("/api/erp/vendors", form);
        setMessage("Vendor added.");
      }
      setShowModal(false);
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const filtered = vendors.filter((v) => {
    const q = search.toLowerCase();
    return !q || [v.vendor_code, v.vendor_name, v.vendor_type, v.contact_name, v.gst_number]
      .join(" ").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />{message}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendors…"
            className="h-11 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => load()} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50">
            <RefreshCcw className="h-4 w-4" />Refresh
          </button>
          <button onClick={openAdd} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer">
            <Plus className="h-4 w-4" />Add Vendor
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader className="h-8 w-8 animate-spin text-slate-400" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <Users className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No vendors found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>{["Code", "Name", "Type", "Contact", "Email", "GST", "Active", "Actions"].map((h) => (
                  <th key={h} className="p-4 font-semibold">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {filtered.map((v) => (
                  <tr key={v.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono text-slate-600">{v.vendor_code}</td>
                    <td className="p-4 font-bold text-slate-950">{v.vendor_name}</td>
                    <td className="p-4"><Badge label={v.vendor_type} cls={VENDOR_TYPE_COLORS[v.vendor_type]} /></td>
                    <td className="p-4 text-slate-600">{v.contact_name ?? "–"}</td>
                    <td className="p-4 text-slate-500">{v.contact_email ?? "–"}</td>
                    <td className="p-4 font-mono text-xs text-slate-500">{v.gst_number ?? "–"}</td>
                    <td className="p-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${v.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {v.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="p-4">
                      <button onClick={() => openEdit(v)} className="cursor-pointer rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors">
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div className="flex items-center justify-between border-b p-6">
            <h2 className="text-lg font-black text-slate-950">{editTarget ? "Edit Vendor" : "Add Vendor"}</h2>
            <button onClick={() => setShowModal(false)} className="cursor-pointer text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
          </div>
          <div className="overflow-y-auto p-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Vendor Code">
                <input value={form.vendor_code} onChange={(e) => setForm({ ...form, vendor_code: e.target.value })} placeholder="VEN-001" className={inputCls} disabled={!!editTarget} />
              </FormField>
              <FormField label="Type">
                <select value={form.vendor_type} onChange={(e) => setForm({ ...form, vendor_type: e.target.value as VendorType })} className={selectCls}>
                  {(["supplier","service","contractor","other"] as VendorType[]).map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </FormField>
            </div>
            <FormField label="Vendor Name">
              <input value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} placeholder="Company name" className={inputCls} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Contact Name">
                <input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className={inputCls} />
              </FormField>
              <FormField label="Contact Phone">
                <input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className={inputCls} />
              </FormField>
            </div>
            <FormField label="Contact Email">
              <input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} className={inputCls} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="GST Number">
                <input value={form.gst_number} onChange={(e) => setForm({ ...form, gst_number: e.target.value })} className={inputCls} />
              </FormField>
              <FormField label="PAN Number">
                <input value={form.pan_number} onChange={(e) => setForm({ ...form, pan_number: e.target.value })} className={inputCls} />
              </FormField>
            </div>
            <FormField label="Payment Terms">
              <input value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} placeholder="e.g. Net 30" className={inputCls} />
            </FormField>
            <FormField label="Address">
              <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} className={`${inputCls} resize-none`} />
            </FormField>
            <FormField label="Status">
              <select value={form.is_active} onChange={(e) => setForm({ ...form, is_active: parseInt(e.target.value) })} className={selectCls}>
                <option value={1}>Active</option>
                <option value={0}>Inactive</option>
              </select>
            </FormField>
          </div>
          <div className="flex gap-3 border-t p-6">
            <button onClick={() => setShowModal(false)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
              {saving ? "Saving…" : editTarget ? "Update" : "Add Vendor"}
            </button>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

// ─── Tab: Contracts ──────────────────────────────────────────────────────────

type ContractFormState = {
  contract_code: string;
  title: string;
  vendor_id: string;
  client_id: string;
  contract_type: ContractType;
  start_date: string;
  end_date: string;
  value: string;
  status: ContractStatus;
  notes: string;
};

const defaultContractForm: ContractFormState = {
  contract_code: "", title: "", vendor_id: "", client_id: "",
  contract_type: "sow", start_date: "", end_date: "",
  value: "", status: "draft", notes: "",
};

function ContractsTab() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<ContractFormState>(defaultContractForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [cRes, vRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: Contract[] }>(
          `/api/erp/contracts${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`
        ),
        hrmsApi.get<{ success: boolean; data: Vendor[] }>("/api/erp/vendors"),
      ]);
      setContracts(cRes.data ?? []);
      setVendors(vRes.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [statusFilter]);

  const save = async () => {
    if (!form.contract_code || !form.title || !form.start_date) {
      return setMessage("Contract code, title and start date are required.");
    }
    setSaving(true);
    try {
      await hrmsApi.post("/api/erp/contracts", {
        ...form,
        value: form.value ? parseFloat(form.value) : undefined,
        vendor_id: form.vendor_id || undefined,
        end_date: form.end_date || undefined,
      });
      setShowModal(false);
      setForm(defaultContractForm);
      setMessage("Contract created.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await hrmsApi.patch(`/api/erp/contracts/${id}`, { status });
      setMessage(`Contract status updated to ${status}.`);
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Update failed.");
    }
  };

  const filtered = contracts.filter((c) => {
    const q = search.toLowerCase();
    return !q || [c.contract_code, c.title, c.vendor_name, c.client_id, c.status]
      .join(" ").toLowerCase().includes(q);
  });

  const CONTRACT_STATUSES: ContractStatus[] = ["draft", "active", "expired", "terminated"];

  return (
    <div className="space-y-4">
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />{message}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contracts…"
              className="h-11 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400" />
          </div>
          <div className="flex flex-wrap gap-2">
            {(["all", ...CONTRACT_STATUSES] as string[]).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition-colors cursor-pointer ${statusFilter === s ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load()} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50">
            <RefreshCcw className="h-4 w-4" />Refresh
          </button>
          <button onClick={() => setShowModal(true)} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer">
            <Plus className="h-4 w-4" />Add Contract
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader className="h-8 w-8 animate-spin text-slate-400" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <FileText className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No contracts found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>{["Code", "Title", "Type", "Vendor", "Start", "End", "Value", "Status", "Actions"].map((h) => (
                  <th key={h} className="p-4 font-semibold">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono text-slate-600">{c.contract_code}</td>
                    <td className="p-4 font-bold text-slate-950 max-w-[200px] truncate">{c.title}</td>
                    <td className="p-4"><Badge label={c.contract_type} cls="bg-slate-100 text-slate-700" /></td>
                    <td className="p-4 text-slate-600">{c.vendor_name ?? c.client_id ?? "–"}</td>
                    <td className="p-4 font-mono text-slate-500">{c.start_date?.slice(0, 10)}</td>
                    <td className="p-4 font-mono text-slate-500">{c.end_date?.slice(0, 10) ?? "–"}</td>
                    <td className="p-4 font-semibold text-slate-950">
                      {c.value != null ? `₹${Number(c.value).toLocaleString("en-IN")}` : "–"}
                    </td>
                    <td className="p-4"><Badge label={c.status} cls={CONTRACT_STATUS_COLORS[c.status]} /></td>
                    <td className="p-4">
                      <div className="relative group inline-block">
                        <button className="cursor-pointer inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors">
                          Status <ChevronDown className="h-3 w-3" />
                        </button>
                        <div className="absolute right-0 top-full z-10 mt-1 hidden group-hover:block w-36 rounded-2xl border bg-white shadow-lg overflow-hidden">
                          {CONTRACT_STATUSES.filter((s) => s !== c.status).map((s) => (
                            <button key={s} onClick={() => updateStatus(c.id, s)}
                              className="block w-full cursor-pointer px-4 py-2.5 text-left text-xs font-semibold capitalize text-slate-700 hover:bg-slate-50 transition-colors">
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div className="flex items-center justify-between border-b p-6">
            <h2 className="text-lg font-black text-slate-950">Add Contract</h2>
            <button onClick={() => setShowModal(false)} className="cursor-pointer text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
          </div>
          <div className="overflow-y-auto p-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Contract Code">
                <input value={form.contract_code} onChange={(e) => setForm({ ...form, contract_code: e.target.value })} placeholder="CON-001" className={inputCls} />
              </FormField>
              <FormField label="Type">
                <select value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value as ContractType })} className={selectCls}>
                  {(["sow","msa","nda","po","other"] as ContractType[]).map((t) => (
                    <option key={t} value={t}>{t.toUpperCase()}</option>
                  ))}
                </select>
              </FormField>
            </div>
            <FormField label="Title">
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Contract title" className={inputCls} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Vendor">
                <select value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })} className={selectCls}>
                  <option value="">– Select vendor –</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.vendor_name}</option>)}
                </select>
              </FormField>
              <FormField label="Client ID">
                <input value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} placeholder="Client reference" className={inputCls} />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Start Date">
                <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className={inputCls} />
              </FormField>
              <FormField label="End Date">
                <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className={inputCls} />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Value (₹)">
                <input type="number" min="0" step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="0.00" className={inputCls} />
              </FormField>
              <FormField label="Initial Status">
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ContractStatus })} className={selectCls}>
                  {CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </FormField>
            </div>
            <FormField label="Notes">
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className={`${inputCls} resize-none`} />
            </FormField>
          </div>
          <div className="flex gap-3 border-t p-6">
            <button onClick={() => setShowModal(false)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
              {saving ? "Saving…" : "Create Contract"}
            </button>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

// ─── Tab: Procurement ────────────────────────────────────────────────────────

type ProcurementFormState = {
  item_name: string;
  quantity: string;
  estimated_cost: string;
  vendor_id: string;
  department_id: string;
  required_by: string;
  justification: string;
};

const defaultProcForm: ProcurementFormState = {
  item_name: "", quantity: "1", estimated_cost: "",
  vendor_id: "", department_id: "", required_by: "", justification: "",
};

function ProcurementTab() {
  const [requests, setRequests] = useState<ProcurementRequest[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<ProcurementFormState>(defaultProcForm);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [pRes, vRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: ProcurementRequest[] }>("/api/erp/procurement"),
        hrmsApi.get<{ success: boolean; data: Vendor[] }>("/api/erp/vendors"),
      ]);
      setRequests(pRes.data ?? []);
      setVendors(vRes.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const submit = async () => {
    if (!form.item_name) return setMessage("Item name is required.");
    setSaving(true);
    try {
      await hrmsApi.post("/api/erp/procurement", {
        ...form,
        quantity: parseInt(form.quantity) || 1,
        estimated_cost: form.estimated_cost ? parseFloat(form.estimated_cost) : undefined,
        vendor_id: form.vendor_id || undefined,
        required_by: form.required_by || undefined,
      });
      setShowModal(false);
      setForm(defaultProcForm);
      setMessage("Procurement request submitted.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSaving(false);
    }
  };

  const act = async (id: string, action: "approved" | "rejected") => {
    setActing(id);
    try {
      await hrmsApi.patch(`/api/erp/procurement/${id}/approve`, { action });
      setMessage(`Request ${action}.`);
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setActing(null);
    }
  };

  const filtered = requests.filter((r) => {
    const q = search.toLowerCase();
    return !q || [r.item_name, r.requester_name, r.req_code, r.status, r.vendor_name]
      .join(" ").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />{message}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search requests…"
            className="h-11 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => load()} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50">
            <RefreshCcw className="h-4 w-4" />Refresh
          </button>
          <button onClick={() => setShowModal(true)} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer">
            <Plus className="h-4 w-4" />Request Item
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader className="h-8 w-8 animate-spin text-slate-400" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <ShoppingCart className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No procurement requests found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>{["Req Code", "Item", "Qty", "Est. Cost", "Vendor", "Required By", "Requested By", "Status", "Actions"].map((h) => (
                  <th key={h} className="p-4 font-semibold">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono text-slate-600">{r.req_code}</td>
                    <td className="p-4 font-bold text-slate-950">{r.item_name}</td>
                    <td className="p-4 text-slate-600">{r.quantity}</td>
                    <td className="p-4 text-slate-600">
                      {r.estimated_cost != null ? `₹${Number(r.estimated_cost).toLocaleString("en-IN")}` : "–"}
                    </td>
                    <td className="p-4 text-slate-500">{r.vendor_name ?? "–"}</td>
                    <td className="p-4 font-mono text-slate-500">{r.required_by?.slice(0, 10) ?? "–"}</td>
                    <td className="p-4 text-slate-600">{r.requester_name ?? r.requested_by}</td>
                    <td className="p-4"><Badge label={r.status} cls={PROC_STATUS_COLORS[r.status]} /></td>
                    <td className="p-4">
                      {r.status === "submitted" && (
                        <div className="flex gap-1">
                          <button onClick={() => act(r.id, "approved")} disabled={acting === r.id}
                            className="cursor-pointer rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50">
                            Approve
                          </button>
                          <button onClick={() => act(r.id, "rejected")} disabled={acting === r.id}
                            className="cursor-pointer rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
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

      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div className="flex items-center justify-between border-b p-6">
            <h2 className="text-lg font-black text-slate-950">Request Item</h2>
            <button onClick={() => setShowModal(false)} className="cursor-pointer text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
          </div>
          <div className="overflow-y-auto p-6 space-y-4">
            <FormField label="Item Name">
              <input value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} placeholder="What do you need?" className={inputCls} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Quantity">
                <input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={inputCls} />
              </FormField>
              <FormField label="Estimated Cost (₹)">
                <input type="number" min="0" step="0.01" value={form.estimated_cost} onChange={(e) => setForm({ ...form, estimated_cost: e.target.value })} placeholder="0.00" className={inputCls} />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Preferred Vendor">
                <select value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })} className={selectCls}>
                  <option value="">– None –</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.vendor_name}</option>)}
                </select>
              </FormField>
              <FormField label="Required By">
                <input type="date" value={form.required_by} onChange={(e) => setForm({ ...form, required_by: e.target.value })} className={inputCls} />
              </FormField>
            </div>
            <FormField label="Justification">
              <textarea value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} rows={3} placeholder="Why is this needed?" className={`${inputCls} resize-none`} />
            </FormField>
          </div>
          <div className="flex gap-3 border-t p-6">
            <button onClick={() => setShowModal(false)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={submit} disabled={saving} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
              {saving ? "Submitting…" : "Submit Request"}
            </button>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

// ─── Tab: Billing ─────────────────────────────────────────────────────────────

type GenerateInvoiceForm = { process_id: string; period_from: string; period_to: string };
const defaultGenForm: GenerateInvoiceForm = { process_id: "", period_from: "", period_to: "" };

function BillingTab() {
  const [invoices, setInvoices]       = useState<BillingInvoice[]>([]);
  const [billingUnits, setBillingUnits] = useState<BillingUnit[]>([]);
  const [processes, setProcesses]     = useState<{ id: string; process_code: string; process_name: string }[]>([]);
  const [loading, setLoading]         = useState(false);
  const [message, setMessage]         = useState("");
  const [processFilter, setProcessFilter] = useState("");
  const [showGenModal, setShowGenModal] = useState(false);
  const [genForm, setGenForm]         = useState<GenerateInvoiceForm>(defaultGenForm);
  const [generating, setGenerating]   = useState(false);
  const [showBuForm, setShowBuForm]   = useState(false);
  const [buForm, setBuForm] = useState({
    process_id: "", billing_type: "per_seat" as BillingType,
    rate: "", billing_period: "monthly" as BillingPeriod,
    effective_from: "", contract_id: "",
  });
  const [savingBu, setSavingBu] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [invRes, buRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: BillingInvoice[] }>(
          `/api/erp/invoices${processFilter ? `?process_id=${processFilter}` : ""}`
        ),
        hrmsApi.get<{ success: boolean; data: BillingUnit[] }>(
          `/api/erp/billing-units${processFilter ? `?process_id=${processFilter}` : ""}`
        ),
      ]);
      setInvoices(invRes.data ?? []);
      setBillingUnits(buRes.data ?? []);
      // Derive unique processes from both lists for the filter selector
      const seen = new Set<string>();
      const procs: typeof processes = [];
      for (const r of [...(invRes.data ?? []), ...(buRes.data ?? [])]) {
        if (r.process_id && !seen.has(r.process_id)) {
          seen.add(r.process_id);
          procs.push({ id: r.process_id, process_code: r.process_code ?? "", process_name: r.process_name ?? r.process_id });
        }
      }
      setProcesses(procs);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load billing data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadAll(); }, [processFilter]);

  const generateInvoice = async () => {
    if (!genForm.process_id || !genForm.period_from || !genForm.period_to) {
      return setMessage("All fields are required.");
    }
    setGenerating(true);
    try {
      await hrmsApi.post("/api/erp/invoices/generate", genForm);
      setShowGenModal(false);
      setGenForm(defaultGenForm);
      setMessage("Invoice generated.");
      await loadAll();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  const updateInvoiceStatus = async (id: string, status: InvoiceStatus) => {
    try {
      const extra: Record<string, string> = {};
      if (status === "sent")  extra.sent_at = new Date().toISOString();
      if (status === "paid")  extra.paid_at = new Date().toISOString();
      await hrmsApi.patch(`/api/erp/invoices/${id}`, { status, ...extra });
      setMessage(`Invoice marked as ${status}.`);
      await loadAll();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Update failed.");
    }
  };

  const createBillingUnit = async () => {
    if (!buForm.process_id || !buForm.effective_from || !buForm.rate) {
      return setMessage("Process, rate, and effective from are required.");
    }
    setSavingBu(true);
    try {
      await hrmsApi.post("/api/erp/billing-units", {
        ...buForm,
        rate: parseFloat(buForm.rate),
        contract_id: buForm.contract_id || undefined,
      });
      setShowBuForm(false);
      setBuForm({ process_id: "", billing_type: "per_seat", rate: "", billing_period: "monthly", effective_from: "", contract_id: "" });
      setMessage("Billing unit created.");
      await loadAll();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to create billing unit.");
    } finally {
      setSavingBu(false);
    }
  };

  const INVOICE_STATUSES: InvoiceStatus[] = ["draft", "sent", "acknowledged", "paid", "disputed"];
  const fmt = (n: number) => `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />{message}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={processFilter}
            onChange={(e) => setProcessFilter(e.target.value)}
            className="h-11 rounded-2xl border bg-slate-50 px-4 text-sm outline-none focus:border-blue-400"
          >
            <option value="">All Processes</option>
            {processes.map((p) => (
              <option key={p.id} value={p.id}>{p.process_code} — {p.process_name}</option>
            ))}
          </select>
          <button
            onClick={() => loadAll()} disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />Refresh
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowBuForm(true)}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />Add Billing Unit
          </button>
          <button
            onClick={() => setShowGenModal(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Receipt className="h-4 w-4" />Generate Invoice
          </button>
        </div>
      </div>

      {/* Billing Units mini table */}
      {billingUnits.length > 0 && (
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b px-6 py-4">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">Billing Units</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>{["Process", "Type", "Rate", "Period", "Effective From", "To", "Active"].map((h) => (
                  <th key={h} className="p-4 font-semibold">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {billingUnits.map((bu) => (
                  <tr key={bu.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4">
                      <div className="font-bold text-slate-950">{bu.process_name ?? bu.process_id}</div>
                      <div className="font-mono text-xs text-slate-400">{bu.process_code}</div>
                    </td>
                    <td className="p-4"><Badge label={bu.billing_type} cls="bg-violet-50 text-violet-700" /></td>
                    <td className="p-4 font-semibold text-slate-950">{bu.currency} {Number(bu.rate).toLocaleString("en-IN")}</td>
                    <td className="p-4 capitalize text-slate-600">{bu.billing_period}</td>
                    <td className="p-4 font-mono text-slate-500">{bu.effective_from?.slice(0, 10)}</td>
                    <td className="p-4 font-mono text-slate-500">{bu.effective_to?.slice(0, 10) ?? "–"}</td>
                    <td className="p-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${bu.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {bu.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invoices table */}
      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="border-b px-6 py-4">
          <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">Invoices</h3>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader className="h-8 w-8 animate-spin text-slate-400" /></div>
        ) : invoices.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <Receipt className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No invoices found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>{["Ref", "Process", "Period", "Units", "Gross", "GST", "Total", "Status", "Actions"].map((h) => (
                  <th key={h} className="p-4 font-semibold">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono text-slate-600">{inv.invoice_ref}</td>
                    <td className="p-4">
                      <div className="font-bold text-slate-950">{inv.process_name ?? inv.process_id}</div>
                      <div className="font-mono text-xs text-slate-400">{inv.process_code}</div>
                    </td>
                    <td className="p-4 font-mono text-xs text-slate-500">
                      {inv.period_from?.slice(0, 10)} – {inv.period_to?.slice(0, 10)}
                    </td>
                    <td className="p-4 text-slate-600">{Number(inv.billable_units)}</td>
                    <td className="p-4 font-semibold text-slate-950">{fmt(inv.gross_amount)}</td>
                    <td className="p-4 text-slate-500">{fmt(inv.gst_amount)}</td>
                    <td className="p-4 font-bold text-slate-950">{fmt(inv.total_amount)}</td>
                    <td className="p-4"><Badge label={inv.status} cls={INVOICE_STATUS_COLORS[inv.status]} /></td>
                    <td className="p-4">
                      <div className="relative group inline-block">
                        <button className="cursor-pointer inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors">
                          Status <ChevronDown className="h-3 w-3" />
                        </button>
                        <div className="absolute right-0 top-full z-10 mt-1 hidden group-hover:block w-40 rounded-2xl border bg-white shadow-lg overflow-hidden">
                          {INVOICE_STATUSES.filter((s) => s !== inv.status).map((s) => (
                            <button key={s} onClick={() => updateInvoiceStatus(inv.id, s)}
                              className="block w-full cursor-pointer px-4 py-2.5 text-left text-xs font-semibold capitalize text-slate-700 hover:bg-slate-50 transition-colors">
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Generate Invoice Modal */}
      {showGenModal && (
        <ModalOverlay onClose={() => setShowGenModal(false)}>
          <div className="flex items-center justify-between border-b p-6">
            <h2 className="text-lg font-black text-slate-950">Generate Invoice</h2>
            <button onClick={() => setShowGenModal(false)} className="cursor-pointer text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
          </div>
          <div className="overflow-y-auto p-6 space-y-4">
            <FormField label="Process">
              <input
                value={genForm.process_id}
                onChange={(e) => setGenForm({ ...genForm, process_id: e.target.value })}
                placeholder="Process UUID"
                className={inputCls}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Period From">
                <input type="date" value={genForm.period_from} onChange={(e) => setGenForm({ ...genForm, period_from: e.target.value })} className={inputCls} />
              </FormField>
              <FormField label="Period To">
                <input type="date" value={genForm.period_to} onChange={(e) => setGenForm({ ...genForm, period_to: e.target.value })} className={inputCls} />
              </FormField>
            </div>
          </div>
          <div className="flex gap-3 border-t p-6">
            <button onClick={() => setShowGenModal(false)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={generateInvoice} disabled={generating} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
              {generating ? "Generating…" : "Generate"}
            </button>
          </div>
        </ModalOverlay>
      )}

      {/* Add Billing Unit Modal */}
      {showBuForm && (
        <ModalOverlay onClose={() => setShowBuForm(false)}>
          <div className="flex items-center justify-between border-b p-6">
            <h2 className="text-lg font-black text-slate-950">Add Billing Unit</h2>
            <button onClick={() => setShowBuForm(false)} className="cursor-pointer text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
          </div>
          <div className="overflow-y-auto p-6 space-y-4">
            <FormField label="Process ID">
              <input value={buForm.process_id} onChange={(e) => setBuForm({ ...buForm, process_id: e.target.value })} placeholder="Process UUID" className={inputCls} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Billing Type">
                <select value={buForm.billing_type} onChange={(e) => setBuForm({ ...buForm, billing_type: e.target.value as BillingType })} className={selectCls}>
                  {(["per_seat","per_transaction","fixed_monthly","revenue_share"] as BillingType[]).map((t) => (
                    <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Billing Period">
                <select value={buForm.billing_period} onChange={(e) => setBuForm({ ...buForm, billing_period: e.target.value as BillingPeriod })} className={selectCls}>
                  {(["weekly","monthly","quarterly"] as BillingPeriod[]).map((p) => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Rate (₹)">
                <input type="number" min="0" step="0.01" value={buForm.rate} onChange={(e) => setBuForm({ ...buForm, rate: e.target.value })} placeholder="0.00" className={inputCls} />
              </FormField>
              <FormField label="Effective From">
                <input type="date" value={buForm.effective_from} onChange={(e) => setBuForm({ ...buForm, effective_from: e.target.value })} className={inputCls} />
              </FormField>
            </div>
            <FormField label="Contract ID (optional)">
              <input value={buForm.contract_id} onChange={(e) => setBuForm({ ...buForm, contract_id: e.target.value })} placeholder="Contract UUID" className={inputCls} />
            </FormField>
          </div>
          <div className="flex gap-3 border-t p-6">
            <button onClick={() => setShowBuForm(false)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={createBillingUnit} disabled={savingBu} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
              {savingBu ? "Saving…" : "Create"}
            </button>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

// ─── Tab: Expense Policies ───────────────────────────────────────────────────

function ExpensePoliciesTab() {
  const [policies, setPolicies] = useState<ExpensePolicy[]>([]);
  const [loading, setLoading]   = useState(false);
  const [message, setMessage]   = useState("");
  // Track inline edits: keyed by category
  const [edits, setEdits] = useState<Record<string, Partial<ExpensePolicy>>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: ExpensePolicy[] }>("/api/erp/expense-policies");
      setPolicies(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load policies");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const edit = (category: string, field: keyof ExpensePolicy, value: string | number) => {
    setEdits((prev) => ({ ...prev, [category]: { ...prev[category], [field]: value } }));
  };

  const save = async (p: ExpensePolicy) => {
    const patch = edits[p.category] ?? {};
    setSaving(p.category);
    setMessage("");
    try {
      await hrmsApi.put(`/api/erp/expense-policies/${p.category}`, {
        max_amount:             patch.max_amount             ?? p.max_amount,
        requires_receipt_above: patch.requires_receipt_above ?? p.requires_receipt_above,
        approval_required:      patch.approval_required      ?? p.approval_required,
      });
      setEdits((prev) => { const next = { ...prev }; delete next[p.category]; return next; });
      setMessage(`Policy for "${p.category}" saved.`);
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(null);
    }
  };

  const isDirty = (category: string) => Object.keys(edits[category] ?? {}).length > 0;

  return (
    <div className="space-y-4">
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />{message}
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Configure per-category spend limits and receipt/approval requirements.
        </p>
        <button onClick={() => load()} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50">
          <RefreshCcw className="h-4 w-4" />Refresh
        </button>
      </div>

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader className="h-8 w-8 animate-spin text-slate-400" /></div>
        ) : policies.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <ShieldCheck className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No expense policies found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>{["Category", "Max Amount (₹)", "Receipt Required Above (₹)", "Approval Required", "Actions"].map((h) => (
                  <th key={h} className="p-4 font-semibold">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {policies.map((p) => {
                  const e = edits[p.category] ?? {};
                  const maxAmt = e.max_amount !== undefined ? e.max_amount : p.max_amount;
                  const receiptAbove = e.requires_receipt_above !== undefined ? e.requires_receipt_above : p.requires_receipt_above;
                  const approvalReq = e.approval_required !== undefined ? e.approval_required : p.approval_required;
                  return (
                    <tr key={p.id} className={`border-t transition-colors ${isDirty(p.category) ? "bg-amber-50/40" : "hover:bg-slate-50/80"}`}>
                      <td className="p-4 font-bold capitalize text-slate-950">{p.category}</td>
                      <td className="p-4">
                        <input
                          type="number" min="0" step="1"
                          value={maxAmt}
                          onChange={(e) => edit(p.category, "max_amount", parseFloat(e.target.value))}
                          className="w-28 rounded-xl border px-3 py-2 text-sm outline-none focus:border-blue-400"
                        />
                      </td>
                      <td className="p-4">
                        <input
                          type="number" min="0" step="1"
                          value={receiptAbove}
                          onChange={(e) => edit(p.category, "requires_receipt_above", parseFloat(e.target.value))}
                          className="w-28 rounded-xl border px-3 py-2 text-sm outline-none focus:border-blue-400"
                        />
                      </td>
                      <td className="p-4">
                        <button
                          onClick={() => edit(p.category, "approval_required", approvalReq ? 0 : 1)}
                          className={`relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors ${approvalReq ? "bg-emerald-500" : "bg-slate-300"}`}
                        >
                          <span className={`inline-block h-4 w-4 translate-x-1 rounded-full bg-white shadow transition-transform ${approvalReq ? "translate-x-6" : ""}`} />
                        </button>
                      </td>
                      <td className="p-4">
                        {isDirty(p.category) && (
                          <button
                            onClick={() => save(p)}
                            disabled={saving === p.category}
                            className="cursor-pointer rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                          >
                            {saving === p.category ? "Saving…" : "Save Changes"}
                          </button>
                        )}
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
  );
}

// ─── Root page ────────────────────────────────────────────────────────────────

type TabId = "expenses" | "vendors" | "contracts" | "procurement" | "billing" | "expense-policies";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "expenses",          label: "Expenses",          icon: <FileText className="h-4 w-4" /> },
  { id: "vendors",           label: "Vendors",           icon: <Users className="h-4 w-4" /> },
  { id: "contracts",         label: "Contracts",         icon: <CheckCircle2 className="h-4 w-4" /> },
  { id: "procurement",       label: "Procurement",       icon: <ShoppingCart className="h-4 w-4" /> },
  { id: "billing",           label: "Billing",           icon: <Receipt className="h-4 w-4" /> },
  { id: "expense-policies",  label: "Expense Policies",  icon: <ShieldCheck className="h-4 w-4" /> },
];

export default function NativeERP() {
  const [activeTab, setActiveTab] = useState<TabId>("expenses");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Finance &amp; Operations</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">ERP</h1>
          <p className="mt-2 max-w-4xl text-slate-600">
            Manage vendors, contracts, expense claims, procurement, billing invoices, and expense policies.
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex flex-wrap gap-1 rounded-2xl border bg-slate-50 p-1 w-fit">
          {TABS.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all cursor-pointer ${
                activeTab === id
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "expenses"         && <ExpensesTab />}
        {activeTab === "vendors"          && <VendorsTab />}
        {activeTab === "contracts"        && <ContractsTab />}
        {activeTab === "procurement"      && <ProcurementTab />}
        {activeTab === "billing"          && <BillingTab />}
        {activeTab === "expense-policies" && <ExpensePoliciesTab />}
      </div>
    </DashboardLayout>
  );
}
