import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, Clock,
  Download, FileText, Loader, RefreshCcw, Search, ShieldCheck, Trash2, Upload,
  TrendingUp, IndianRupee, FolderCheck,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { apiBaseUrl, apiUrl } from "@/lib/apiBase";
import { currentFinancialYear, financialYearOptions } from "@/lib/financialYear";
import { formatISTDate } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Employee = {
  id: string;
  employee_code?: string;
  first_name: string;
  last_name?: string;
};

type TaxDeclaration = {
  id?: string;
  employee_id: string;
  financial_year: string;
  regime: "old" | "new";
  total_investment: number;
  declared_hra: number;
  declared_80c: number;
  declared_80d: number;
  declared_ltc: number;
  declared_home_loan_interest: number;
  declared_nps_80ccd1b: number;
  declared_80e: number;
  declared_80g: number;
  declared_other_chapter_via: number;
  other_income: number;
  employee_consent: boolean;
  submission_status: "draft" | "submitted" | "verified" | "rejected";
  tds_projected: number;
  submitted_at?: string;
  verified_by?: string | null;
  verified_at?: string | null;
  review_note?: string | null;
};

type DeclarationHistory = TaxDeclaration & {
  created_at?: string;
};

type TaxDocument = {
  id: string;
  employee_id: string;
  document_type: string;
  document_name: string;
  file_url: string;
  verified: boolean;
  uploaded_at: string;
};

type FormState = {
  regime: "old" | "new";
  declared_hra: string;
  declared_80c: string;
  declared_80d: string;
  total_investment: string;
  declared_ltc: string;
  declared_home_loan_interest: string;
  declared_nps_80ccd1b: string;
  declared_80e: string;
  declared_80g: string;
  declared_other_chapter_via: string;
  other_income: string;
  employee_consent: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v ?? 0);

// Derived, not hardcoded. The literal list this replaced —
// ["2024-2025","2025-2026","2026-2027"] — would have run out after 31-Mar-2027,
// and its companion `useState("2025-2026")` default meant that on 31-Jul-2026 the
// page opened on the PRIOR financial year, so declarations were filed against the
// wrong FY (CEO UAT 31-Jul-2026).
const FINANCIAL_YEARS = financialYearOptions(2, 0);

const EMPTY_FORM: FormState = {
  regime: "new",
  declared_hra: "",
  declared_80c: "",
  declared_80d: "",
  total_investment: "",
  declared_ltc: "",
  declared_home_loan_interest: "",
  declared_nps_80ccd1b: "",
  declared_80e: "",
  declared_80g: "",
  declared_other_chapter_via: "",
  other_income: "",
  employee_consent: false,
};

function toNum(v: string): number {
  const n = parseFloat(v.replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

// ─── Submission status badge ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: TaxDeclaration["submission_status"] }) {
  const styles: Record<TaxDeclaration["submission_status"], string> = {
    draft:     "bg-slate-100 text-slate-700 border border-slate-200",
    submitted: "bg-blue-100 text-blue-700 border border-blue-200",
    verified:  "bg-emerald-100 text-emerald-700 border border-emerald-200",
    rejected:  "bg-red-100 text-red-700 border border-red-200",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${styles[status] ?? styles.draft}`}>
      {status}
    </span>
  );
}

// ─── HR Verification Panel ────────────────────────────────────────────────────

function HrVerificationPanel({
  declaration,
  employeeId,
  financialYear,
  onVerified,
}: {
  declaration: TaxDeclaration;
  employeeId: string;
  financialYear: string;
  onVerified: () => void;
}) {
  const [reviewNote, setReviewNote] = useState("");
  const [submitting, setSubmitting] = useState<"verified" | "rejected" | null>(null);
  const [msg, setMsg] = useState("");

  const submit = async (status: "verified" | "rejected") => {
    setSubmitting(status);
    setMsg("");
    try {
      await hrmsApi.patch(`/api/payroll/tax-declaration/${employeeId}/${financialYear}/verify`, {
        status,
        review_note: reviewNote || undefined,
      });
      setMsg(`Declaration ${status} successfully.`);
      setReviewNote("");
      onVerified();
    } catch (err: unknown) {
      setMsg((err as Error).message || "Action failed.");
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm overflow-hidden">
      <div className="border-b p-5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center">
          <ShieldCheck className="h-5 w-5 text-violet-600" />
        </div>
        <div>
          <h2 className="font-black text-slate-950">HR Verification</h2>
          <p className="text-sm text-slate-500">Review and verify this tax declaration</p>
        </div>
        <div className="ml-auto">
          <StatusBadge status={declaration.submission_status} />
        </div>
      </div>
      <div className="p-6 space-y-4">
        {/* Current status detail */}
        <div className="flex flex-wrap gap-4 text-sm">
          {declaration.verified_by && (
            <div>
              <span className="text-slate-500 mr-2">Verified by:</span>
              <span className="font-semibold text-slate-700">{declaration.verified_by}</span>
            </div>
          )}
          {declaration.verified_at && (
            <div>
              <span className="text-slate-500 mr-2">On:</span>
              <span className="font-semibold text-slate-700">{formatISTDate(declaration.verified_at)}</span>
            </div>
          )}
        </div>

        {declaration.review_note && (
          <div className="rounded-2xl bg-slate-50 border px-4 py-3 text-sm text-slate-700">
            <span className="font-semibold">Review note: </span>{declaration.review_note}
          </div>
        )}

        {msg && (
          <p className={`text-sm font-semibold ${msg.includes("success") ? "text-emerald-700" : "text-red-600"}`}>{msg}</p>
        )}

        {/* Action area */}
        {declaration.submission_status !== "verified" && (
          <div className="space-y-3">
            <textarea
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Add a review note (optional)..."
              rows={2}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-violet-400 transition-colors resize-none"
            />
            <div className="flex gap-3">
              <button
                onClick={() => submit("verified")}
                disabled={!!submitting}
                className="cursor-pointer inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {submitting === "verified" ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Approve Declaration
              </button>
              <button
                onClick={() => submit("rejected")}
                disabled={!!submitting}
                className="cursor-pointer inline-flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-bold text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                {submitting === "rejected" ? <Loader className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                Reject
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function NativeTaxDeclaration() {
  // Mode: "self" uses server-derived employeeId, "admin" picks from dropdown
  const [mode, setMode] = useState<"self" | "admin">("self");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [selectedFY, setSelectedFY] = useState<string>(() => currentFinancialYear());

  const [declaration, setDeclaration] = useState<TaxDeclaration | null>(null);
  const [history, setHistory] = useState<DeclarationHistory[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [documents, setDocuments] = useState<TaxDocument[]>([]);

  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingDeclaration, setLoadingDeclaration] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "success" | "error">("info");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load employees (admin mode) ──────────────────────────────────────────────
  const loadEmployees = async () => {
    setLoadingEmployees(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Employee[] }>("/api/employees");
      setEmployees(res.data ?? []);
    } catch (err: unknown) {
      const e = err as Error;
      showMessage(e.message || "Failed to load employees.", "error");
    } finally {
      setLoadingEmployees(false);
    }
  };

  useEffect(() => {
    if (mode === "admin") void loadEmployees();
  }, [mode]);

  // ── Load declaration ─────────────────────────────────────────────────────────
  const loadDeclaration = async () => {
    const empId = mode === "self" ? "me" : selectedEmployeeId;
    if (!empId || (mode === "admin" && !selectedEmployeeId)) return;

    setLoadingDeclaration(true);
    setMessage("");
    setDeclaration(null);
    setHistory([]);

    try {
      const res = await hrmsApi.get<{
        success: boolean;
        data: TaxDeclaration;
        history?: DeclarationHistory[];
      }>(`/api/payroll/tax-declaration/${empId}/${selectedFY}`);

      const d = res.data;
      setDeclaration(d);
      setHistory(res.history ?? []);

      if (d) {
        setForm({
          regime: d.regime,
          declared_hra: d.declared_hra > 0 ? String(d.declared_hra) : "",
          declared_80c: d.declared_80c > 0 ? String(d.declared_80c) : "",
          declared_80d: d.declared_80d > 0 ? String(d.declared_80d) : "",
          total_investment: d.total_investment > 0 ? String(d.total_investment) : "",
          declared_ltc: d.declared_ltc > 0 ? String(d.declared_ltc) : "",
          declared_home_loan_interest: d.declared_home_loan_interest > 0 ? String(d.declared_home_loan_interest) : "",
          declared_nps_80ccd1b: d.declared_nps_80ccd1b > 0 ? String(d.declared_nps_80ccd1b) : "",
          declared_80e: d.declared_80e > 0 ? String(d.declared_80e) : "",
          declared_80g: d.declared_80g > 0 ? String(d.declared_80g) : "",
          declared_other_chapter_via: d.declared_other_chapter_via > 0 ? String(d.declared_other_chapter_via) : "",
          other_income: d.other_income > 0 ? String(d.other_income) : "",
          employee_consent: d.employee_consent ?? false,
        });
      } else {
        setForm(EMPTY_FORM);
      }
    } catch (err: unknown) {
      const e = err as Error;
      // 404 means no declaration yet — that's ok, keep empty form
      if (!e.message?.includes("404") && !e.message?.includes("not found")) {
        showMessage(e.message || "Failed to load declaration.", "error");
      }
      setForm(EMPTY_FORM);
    } finally {
      setLoadingDeclaration(false);
    }
  };

  // ── Load documents ───────────────────────────────────────────────────────────
  const loadDocuments = async () => {
    const empId = mode === "self" ? "me" : selectedEmployeeId;
    if (!empId || (mode === "admin" && !selectedEmployeeId)) return;

    setLoadingDocuments(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: TaxDocument[] }>(
        `/api/payroll/tax-declaration/${empId}/${selectedFY}/documents`
      );
      setDocuments(res.data ?? []);
    } catch (err: unknown) {
      const e = err as Error;
      if (!e.message?.includes("404") && !e.message?.includes("not found")) {
        console.error("Failed to load tax documents:", e);
      }
    } finally {
      setLoadingDocuments(false);
    }
  };

  useEffect(() => {
    void loadDeclaration();
    void loadDocuments();
  }, [mode === "self" ? selectedFY : `${selectedEmployeeId}-${selectedFY}`]);

  // ── Submit ───────────────────────────────────────────────────────────────────
  const submitDeclaration = async () => {
    const empId = mode === "self" ? "me" : selectedEmployeeId;
    if (!empId || (mode === "admin" && !selectedEmployeeId)) {
      showMessage("Please select an employee.", "error");
      return;
    }

    setSubmitting(true);
    setMessage("");
    try {
      await hrmsApi.post(`/api/payroll/tax-declaration/${empId}/${selectedFY}`, {
        regime: form.regime,
        total_investment: toNum(form.total_investment),
        declared_hra: toNum(form.declared_hra),
        declared_80c: toNum(form.declared_80c),
        declared_80d: toNum(form.declared_80d),
        declared_ltc: toNum(form.declared_ltc),
        declared_home_loan_interest: toNum(form.declared_home_loan_interest),
        declared_nps_80ccd1b: toNum(form.declared_nps_80ccd1b),
        declared_80e: toNum(form.declared_80e),
        declared_80g: toNum(form.declared_80g),
        declared_other_chapter_via: toNum(form.declared_other_chapter_via),
        other_income: toNum(form.other_income),
        employee_consent: form.employee_consent,
        tds_projected: declaration?.tds_projected ?? 0,
      });
      showMessage("Declaration submitted successfully.", "success");
      await loadDeclaration();
    } catch (err: unknown) {
      const e = err as Error;
      showMessage(e.message || "Submission failed.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Upload document ──────────────────────────────────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const empId = mode === "self" ? "me" : selectedEmployeeId;
    if (!empId || (mode === "admin" && !selectedEmployeeId)) {
      showMessage("Please select an employee.", "error");
      return;
    }

    setUploading(true);
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("document_type", "tax_declaration");
      formData.append("document_name", file.name);

      const token = localStorage.getItem("hrms_access_token");
      const resp = await fetch(
        apiUrl(`/api/payroll/tax-declaration/${empId}/${selectedFY}/document`),
        {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        }
      );

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({ message: `Server returned ${resp.status}` }));
        throw new Error(errorData.message || `Upload failed: ${resp.status}`);
      }

      showMessage("Document uploaded successfully.", "success");
      await loadDocuments();
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err: unknown) {
      const e = err as Error;
      showMessage(e.message || "Document upload failed.", "error");
    } finally {
      setUploading(false);
    }
  };

  // ── Delete document ──────────────────────────────────────────────────────────
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm("Are you sure you want to delete this document? This cannot be undone.")) return;

    const empId = mode === "self" ? "me" : selectedEmployeeId;
    setDeletingDocId(docId);
    try {
      await hrmsApi.delete(`/api/payroll/tax-declaration/${empId}/${selectedFY}/document/${docId}`);
      showMessage("Document deleted.", "success");
      void loadDocuments();
    } catch (err: unknown) {
      const e = err as Error;
      showMessage(e.message || "Delete failed.", "error");
    } finally {
      setDeletingDocId(null);
    }
  };

  // ── Download document ────────────────────────────────────────────────────────
  const handleDownloadDocument = async (fileUrl: string, fileName: string) => {
    if (!fileUrl) {
      showMessage("Document URL is missing.", "error");
      return;
    }

    const HRMS_API = apiBaseUrl();
    const url = fileUrl.startsWith("http") ? fileUrl
      : fileUrl.startsWith("/api/") ? `${HRMS_API}${fileUrl}`
      : `${HRMS_API}/api/files/tax-documents/${fileUrl}`;

    try {
      const token = localStorage.getItem("hrms_access_token");
      const resp = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);

      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err: unknown) {
      const e = err as Error;
      showMessage(e.message || "Download failed.", "error");
    }
  };

  function showMessage(msg: string, type: "info" | "success" | "error") {
    setMessage(msg);
    setMessageType(type);
  }

  // ── Filtered employees ───────────────────────────────────────────────────────
  const filteredEmployees = employees.filter((e) => {
    const q = employeeSearch.toLowerCase();
    const name = `${e.first_name} ${e.last_name ?? ""}`.toLowerCase();
    return !q || name.includes(q) || (e.employee_code ?? "").toLowerCase().includes(q);
  });

  const messageColors = {
    info: "border-blue-200 bg-blue-50 text-blue-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    error: "border-rose-200 bg-rose-50 text-rose-800",
  };

  const MessageIcon = messageType === "success" ? CheckCircle2 : AlertTriangle;

  // ── Derived KPI values ───────────────────────────────────────────────────────
  const tdsProjected = declaration?.tds_projected ?? 0;
  const totalInvested = declaration?.total_investment ?? toNum(form.total_investment);
  const pendingDocs = documents.filter((d) => !d.verified).length;
  const activeRegime = declaration?.regime ?? form.regime;

  return (
    <DashboardLayout>
      <div className="space-y-5">

        {/* ── Gradient Header ────────────────────────────────────────────────── */}
        <div className="rounded-2xl bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 text-white px-6 py-5 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Tax Declaration</h1>
                <p className="text-violet-200 text-sm mt-0.5">
                  IT regime selection, investment declarations and TDS projection
                </p>
              </div>
            </div>
            <button
              onClick={() => void loadDeclaration()}
              disabled={loadingDeclaration}
              className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 hover:bg-white/20 px-4 py-2 text-sm font-semibold text-white transition-colors cursor-pointer disabled:opacity-50 self-start sm:self-auto"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* ── Message Banner ─────────────────────────────────────────────────── */}
        {message && (
          <div className={`flex items-center gap-3 rounded-2xl border p-4 text-sm font-bold ${messageColors[messageType]}`}>
            <MessageIcon className="h-4 w-4 flex-shrink-0" />
            {message}
          </div>
        )}

        {/* ── KPI Tiles ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Projected TDS */}
          <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-violet-600" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-violet-500 bg-violet-50 rounded-full px-2 py-0.5">
                FY {selectedFY}
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-500 mb-0.5">Projected TDS</p>
            <p className="text-xl font-black text-violet-700 font-mono">
              {tdsProjected > 0 ? INR(tdsProjected) : "—"}
            </p>
            {tdsProjected > 0 && (
              <p className="text-xs text-slate-400 mt-0.5">{INR(Math.round(tdsProjected / 12))}/mo</p>
            )}
          </div>

          {/* Investments Declared */}
          <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
                <IndianRupee className="w-4 h-4 text-emerald-600" />
              </div>
            </div>
            <p className="text-xs font-semibold text-slate-500 mb-0.5">Investments Declared</p>
            <p className="text-xl font-black text-emerald-700 font-mono">
              {totalInvested > 0 ? INR(totalInvested) : "—"}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">Total for the year</p>
          </div>

          {/* Pending Verification */}
          <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
                <Clock className="w-4 h-4 text-amber-600" />
              </div>
            </div>
            <p className="text-xs font-semibold text-slate-500 mb-0.5">Pending Verification</p>
            <p className="text-xl font-black text-amber-700">
              {documents.length > 0 ? `${pendingDocs} / ${documents.length}` : "—"}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">Documents awaiting review</p>
          </div>

          {/* Regime */}
          <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                <FolderCheck className="w-4 h-4 text-blue-600" />
              </div>
              {declaration?.submission_status && (
                <StatusBadge status={declaration.submission_status} />
              )}
            </div>
            <p className="text-xs font-semibold text-slate-500 mb-0.5">Tax Regime</p>
            <p className="text-xl font-black text-blue-700 capitalize">
              {activeRegime} Regime
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {activeRegime === "new" ? "Default from FY 2024-25" : "With deductions"}
            </p>
          </div>
        </div>

        {/* ── Controls: Mode + FY + Employee ─────────────────────────────────── */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm p-5 space-y-4">
          <div className="flex flex-wrap gap-4 items-center">
            {/* Mode Toggle */}
            <div className="flex items-center rounded-2xl border overflow-hidden text-sm font-semibold">
              {(["self", "admin"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setSelectedEmployeeId(""); setDeclaration(null); setForm(EMPTY_FORM); }}
                  className={`px-5 py-2.5 cursor-pointer transition-colors ${
                    mode === m ? "bg-violet-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {m === "self" ? "Self Service" : "Admin View"}
                </button>
              ))}
            </div>

            {/* FY Selector */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-black text-slate-700">Financial Year</label>
              <div className="relative">
                <select
                  value={selectedFY}
                  onChange={(e) => setSelectedFY(e.target.value)}
                  className="appearance-none rounded-2xl border px-4 py-2.5 pr-9 text-sm font-semibold outline-none focus:border-violet-400 bg-slate-50"
                >
                  {FINANCIAL_YEARS.map((fy) => (
                    <option key={fy} value={fy}>{fy}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              </div>
            </div>
          </div>

          {/* Employee Picker (admin mode) */}
          {mode === "admin" && (
            <div className="pt-2 border-t">
              <label className="block text-sm font-semibold text-slate-700 mb-2">Select Employee</label>
              <div className="flex gap-3 items-center">
                <div className="relative flex-1 max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    value={employeeSearch}
                    onChange={(e) => setEmployeeSearch(e.target.value)}
                    placeholder="Search employees…"
                    className="h-11 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-violet-400 transition-colors"
                  />
                </div>
                {loadingEmployees ? (
                  <Loader className="h-5 w-5 animate-spin text-slate-400" />
                ) : (
                  <select
                    value={selectedEmployeeId}
                    onChange={(e) => setSelectedEmployeeId(e.target.value)}
                    className="rounded-2xl border px-4 py-2.5 text-sm font-semibold outline-none focus:border-violet-400 bg-slate-50 min-w-[220px]"
                  >
                    <option value="">Select employee…</option>
                    {filteredEmployees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.first_name} {e.last_name ?? ""} {e.employee_code ? `(${e.employee_code})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Declaration Form ───────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm overflow-hidden">
          <div className="border-b p-5 flex items-center justify-between">
            <div>
              <h2 className="font-black text-slate-950">Tax Investment Declaration</h2>
              <p className="text-sm text-slate-500">FY {selectedFY}</p>
            </div>
            {declaration?.submitted_at && (
              <div className="flex items-center gap-2 text-xs text-emerald-700 font-semibold bg-emerald-50 rounded-xl px-3 py-1.5">
                <CheckCircle2 className="h-4 w-4" />
                Last submitted {formatISTDate(declaration.submitted_at)}
              </div>
            )}
          </div>

          {loadingDeclaration ? (
            <div className="flex items-center justify-center py-16">
              <Loader className="h-8 w-8 animate-spin text-violet-400" />
            </div>
          ) : (
            <div className="p-6 space-y-6">

              {/* ── Regime Comparison Cards ──────────────────────────────────── */}
              <div>
                <label className="block text-sm font-black text-slate-700 mb-3">Tax Regime Selection</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div
                    className={`rounded-2xl p-4 border-2 cursor-pointer transition-all ${
                      form.regime === "old"
                        ? "border-violet-400 bg-violet-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                    onClick={() => setForm((prev) => ({ ...prev, regime: "old" }))}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className={`h-4 w-4 ${form.regime === "old" ? "text-violet-600" : "text-slate-400"}`} />
                        <span className="font-bold text-slate-800">Old Regime</span>
                      </div>
                      {form.regime === "old" && <CheckCircle2 className="w-4 h-4 text-violet-600" />}
                    </div>
                    <p className="text-xs text-slate-500">Deductions under 80C, 80D, HRA, LTA etc. allowed</p>
                    <p className="text-xs text-slate-500 mt-1">Best when total deductions {'>'} ₹3.5L</p>
                  </div>
                  <div
                    className={`rounded-2xl p-4 border-2 cursor-pointer transition-all ${
                      form.regime === "new"
                        ? "border-emerald-400 bg-emerald-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                    onClick={() => setForm((prev) => ({ ...prev, regime: "new" }))}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className={`h-4 w-4 ${form.regime === "new" ? "text-emerald-600" : "text-slate-400"}`} />
                        <span className="font-bold text-slate-800">New Regime</span>
                      </div>
                      {form.regime === "new" && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                    </div>
                    <p className="text-xs text-slate-500">Lower tax slabs, most deductions not available</p>
                    <p className="text-xs text-slate-500 mt-1">Default from FY 2024-25. Best for lower deductions.</p>
                  </div>
                </div>
              </div>

              {/* ── Declaration Fields ───────────────────────────────────────── */}
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    HRA Declared (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={form.declared_hra}
                    onChange={(e) => setForm({ ...form, declared_hra: e.target.value })}
                    placeholder="0"
                    className="w-full rounded-2xl border px-4 py-3 text-sm font-mono outline-none focus:border-violet-400 transition-colors"
                  />
                  <p className="mt-1 text-xs text-slate-400">House Rent Allowance exemption</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    80C Investments (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={form.declared_80c}
                    onChange={(e) => setForm({ ...form, declared_80c: e.target.value })}
                    placeholder="0"
                    className="w-full rounded-2xl border px-4 py-3 text-sm font-mono outline-none focus:border-violet-400 transition-colors"
                  />
                  <p className="mt-1 text-xs text-slate-400">PPF, ELSS, LIC, EPF, NSC (max ₹1,50,000)</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    80D — Health Insurance (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={form.declared_80d}
                    onChange={(e) => setForm({ ...form, declared_80d: e.target.value })}
                    placeholder="0"
                    className="w-full rounded-2xl border px-4 py-3 text-sm font-mono outline-none focus:border-violet-400 transition-colors"
                  />
                  <p className="mt-1 text-xs text-slate-400">Medical insurance premiums (max ₹25,000)</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Total Investment (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={form.total_investment}
                    onChange={(e) => setForm({ ...form, total_investment: e.target.value })}
                    placeholder="0"
                    className="w-full rounded-2xl border px-4 py-3 text-sm font-mono outline-none focus:border-violet-400 transition-colors"
                  />
                  <p className="mt-1 text-xs text-slate-400">Combined investment amount for FY</p>
                </div>
              </div>

              {/* ── Declaration Coverage Progress Bars ───────────────────────── */}
              <div className="rounded-2xl bg-slate-50 border p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Declaration Coverage</p>
                {[
                  { label: "80C", limit: 150000, declared: toNum(form.declared_80c) },
                  { label: "80D", limit: 25000,  declared: toNum(form.declared_80d) },
                  { label: "NPS (80CCD1B)", limit: 50000, declared: toNum(form.declared_nps_80ccd1b) },
                  { label: "HRA", limit: 100000, declared: toNum(form.declared_hra) },
                ].map(({ label, limit, declared }) => {
                  const pct = Math.min(100, declared > 0 ? (declared / limit) * 100 : 0);
                  return (
                    <div key={label} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium text-slate-700">{label}</span>
                        <span className="text-slate-500">
                          {declared > 0 ? INR(declared) : "—"} / {INR(limit)}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className="h-full bg-violet-400 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ── Chapter VI-A & Other Deductions ─────────────────────────── */}
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Chapter VI-A &amp; Other Deductions</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                      Home Loan Interest — 24B (₹)
                    </label>
                    <input
                      type="number" min="0"
                      value={form.declared_home_loan_interest}
                      onChange={(e) => setForm({ ...form, declared_home_loan_interest: e.target.value })}
                      placeholder="0"
                      className="w-full rounded-2xl border px-4 py-3 text-sm font-mono outline-none focus:border-violet-400 transition-colors"
                    />
                    <p className="mt-1 text-xs text-slate-400">Section 24(b) — max ₹2,00,000</p>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                      NPS 80CCD(1B) (₹)
                    </label>
                    <input
                      type="number" min="0"
                      value={form.declared_nps_80ccd1b}
                      onChange={(e) => setForm({ ...form, declared_nps_80ccd1b: e.target.value })}
                      placeholder="0"
                      className="w-full rounded-2xl border px-4 py-3 text-sm font-mono outline-none focus:border-violet-400 transition-colors"
                    />
                    <p className="mt-1 text-xs text-slate-400">NPS additional deduction — max ₹50,000</p>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                      LTC Exemption (₹)
                    </label>
                    <input
                      type="number" min="0"
                      value={form.declared_ltc}
                      onChange={(e) => setForm({ ...form, declared_ltc: e.target.value })}
                      placeholder="0"
                      className="w-full rounded-2xl border px-4 py-3 text-sm font-mono outline-none focus:border-violet-400 transition-colors"
                    />
                    <p className="mt-1 text-xs text-slate-400">Leave Travel Concession exemption</p>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                      80E — Education Loan Interest (₹)
                    </label>
                    <input
                      type="number" min="0"
                      value={form.declared_80e}
                      onChange={(e) => setForm({ ...form, declared_80e: e.target.value })}
                      placeholder="0"
                      className="w-full rounded-2xl border px-4 py-3 text-sm font-mono outline-none focus:border-violet-400 transition-colors"
                    />
                    <p className="mt-1 text-xs text-slate-400">Interest on education loan — no cap</p>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                      80G — Donations (₹)
                    </label>
                    <input
                      type="number" min="0"
                      value={form.declared_80g}
                      onChange={(e) => setForm({ ...form, declared_80g: e.target.value })}
                      placeholder="0"
                      className="w-full rounded-2xl border px-4 py-3 text-sm font-mono outline-none focus:border-violet-400 transition-colors"
                    />
                    <p className="mt-1 text-xs text-slate-400">Eligible charitable donations</p>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                      Other Chapter VI-A Deductions (₹)
                    </label>
                    <input
                      type="number" min="0"
                      value={form.declared_other_chapter_via}
                      onChange={(e) => setForm({ ...form, declared_other_chapter_via: e.target.value })}
                      placeholder="0"
                      className="w-full rounded-2xl border px-4 py-3 text-sm font-mono outline-none focus:border-violet-400 transition-colors"
                    />
                    <p className="mt-1 text-xs text-slate-400">80TTA, 80TTB, and other eligible deductions</p>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                      Other Income (₹)
                    </label>
                    <input
                      type="number" min="0"
                      value={form.other_income}
                      onChange={(e) => setForm({ ...form, other_income: e.target.value })}
                      placeholder="0"
                      className="w-full rounded-2xl border px-4 py-3 text-sm font-mono outline-none focus:border-violet-400 transition-colors"
                    />
                    <p className="mt-1 text-xs text-slate-400">FD interest, rental income, other heads</p>
                  </div>
                </div>

                {/* Employee consent checkbox */}
                <label className="mt-5 flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.employee_consent}
                    onChange={(e) => setForm({ ...form, employee_consent: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded accent-violet-600"
                  />
                  <span className="text-sm text-slate-700">
                    I declare that the above investment and income details are true and correct to the best of my knowledge,
                    and I undertake to submit documentary proof as required.
                  </span>
                </label>
              </div>

              {/* ── Submission Status Badge ──────────────────────────────────── */}
              {declaration?.submission_status && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500">Declaration status:</span>
                  <StatusBadge status={declaration.submission_status} />
                </div>
              )}

              {/* ── TDS Projection Highlight ─────────────────────────────────── */}
              {declaration?.tds_projected !== undefined && declaration.tds_projected > 0 && (
                <div className="rounded-2xl bg-gradient-to-br from-violet-600 to-purple-600 text-white p-4 text-center">
                  <p className="text-violet-200 text-xs font-semibold uppercase tracking-wide mb-1">Projected TDS</p>
                  <p className="text-3xl font-bold">{INR(declaration.tds_projected)}</p>
                  <p className="text-violet-200 text-xs mt-1">
                    Monthly deduction: {INR(Math.round(declaration.tds_projected / 12))}
                  </p>
                </div>
              )}

              {/* ── Submit / Reset ───────────────────────────────────────────── */}
              <div className="pt-2 flex gap-3">
                <button
                  onClick={submitDeclaration}
                  disabled={submitting}
                  className="flex-1 max-w-xs cursor-pointer rounded-2xl bg-violet-600 py-3 text-sm font-bold text-white hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <Loader className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Submit Declaration
                </button>
                <button
                  onClick={() => setForm(EMPTY_FORM)}
                  className="cursor-pointer rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Supporting Documents ───────────────────────────────────────────── */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm overflow-hidden">
          <div className="border-b p-5 flex items-center justify-between">
            <div>
              <h2 className="font-black text-slate-950 flex items-center gap-2">
                <FileText className="h-5 w-5 text-slate-600" />
                Supporting Documents
              </h2>
              <p className="text-sm text-slate-500">Upload proof for HRA, 80C, 80D investments</p>
            </div>
            <label className="cursor-pointer inline-flex items-center gap-2 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-700 shadow-sm hover:bg-violet-100 transition-colors">
              {uploading ? <Loader className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Uploading..." : "Upload Document"}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={handleFileUpload}
                disabled={uploading || (mode === "admin" && !selectedEmployeeId)}
                className="sr-only"
              />
            </label>
          </div>

          {loadingDocuments ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="h-8 w-8 animate-spin text-violet-400" />
            </div>
          ) : documents.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-slate-300" />
              <p className="font-semibold text-slate-400">No documents uploaded yet.</p>
              <p className="text-xs text-slate-400 mt-1">Upload rent receipts, investment proofs, insurance policies</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    {["Document Name", "Type", "Verified", "Uploaded", "Actions"].map((h) => (
                      <th key={h} className="p-4 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id} className="border-t hover:bg-slate-50/80 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-slate-400 flex-shrink-0" />
                          <span className="font-medium text-slate-950">{doc.document_name}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="rounded-full bg-blue-50 text-blue-700 px-2.5 py-1 text-xs font-semibold capitalize">
                          {doc.document_type.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="p-4">
                        {doc.verified ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-xs font-semibold">
                            <CheckCircle2 className="h-3 w-3" /> Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 px-2.5 py-1 text-xs font-semibold">
                            <Clock className="h-3 w-3" /> Pending
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-xs text-slate-500 font-mono">
                        {formatISTDate(doc.uploaded_at)}
                      </td>
                      <td className="p-4">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleDownloadDocument(doc.file_url, doc.document_name)}
                            className="cursor-pointer inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
                            title="Download"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download
                          </button>
                          <button
                            onClick={() => handleDeleteDocument(doc.id)}
                            disabled={deletingDocId === doc.id}
                            className="cursor-pointer inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                            title="Delete"
                          >
                            {deletingDocId === doc.id
                              ? <Loader className="h-3.5 w-3.5 animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5" />}
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

        {/* ── HR Verification Panel — admin mode only ────────────────────────── */}
        {mode === "admin" && declaration && (
          <HrVerificationPanel
            declaration={declaration}
            employeeId={selectedEmployeeId}
            financialYear={selectedFY}
            onVerified={() => { void loadDeclaration(); }}
          />
        )}

        {/* ── Declaration History ────────────────────────────────────────────── */}
        {history.length > 0 && (
          <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm overflow-hidden">
            <div className="border-b p-5">
              <h2 className="font-black text-slate-950">Declaration History</h2>
              <p className="text-sm text-slate-500">{history.length} past submission{history.length !== 1 ? "s" : ""}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    {["FY", "Regime", "HRA", "80C", "80D", "Total Investment", "TDS Projected", "Submitted"].map((h) => (
                      <th key={h} className="p-4 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, idx) => (
                    <tr key={idx} className="border-t hover:bg-slate-50/80 transition-colors">
                      <td className="p-4 font-bold text-slate-950">{h.financial_year}</td>
                      <td className="p-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                          h.regime === "new" ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700"
                        }`}>
                          {h.regime}
                        </span>
                      </td>
                      <td className="p-4 font-mono text-slate-700">{INR(h.declared_hra)}</td>
                      <td className="p-4 font-mono text-slate-700">{INR(h.declared_80c)}</td>
                      <td className="p-4 font-mono text-slate-700">{INR(h.declared_80d)}</td>
                      <td className="p-4 font-mono font-semibold text-slate-800">{INR(h.total_investment)}</td>
                      <td className="p-4 font-mono text-violet-700 font-semibold">{INR(h.tds_projected)}</td>
                      <td className="p-4 text-xs text-slate-400 font-mono">
                        {h.submitted_at ? formatISTDate(h.submitted_at) :
                         h.created_at ? formatISTDate(h.created_at) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
