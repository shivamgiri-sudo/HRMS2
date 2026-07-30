import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, CheckCircle2, FileText, Loader, Mail,
  Plus, RefreshCcw, Search, Eye, Download, X, User,
  ChevronDown, Clock, Filter, Printer,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi, getAuthToken } from "@/lib/hrmsApi";
import { useDebounce } from "@/hooks/useDebounce";

// ─── Types ────────────────────────────────────────────────────────────────────

type LetterTemplate = {
  id: string;
  template_code: string;
  template_name: string;
  letter_type?: string;
  description?: string;
};

type GeneratedLetter = {
  id: string;
  letter_id?: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  template_code: string;
  template_name?: string;
  letter_type?: string;
  issued_date: string;
  acknowledged: boolean;
  acknowledged_at?: string;
  created_at: string;
};

type EmployeeHit = {
  id: string;
  employee_code: string;
  first_name: string;
  last_name?: string;
  designation_name?: string;
  branch_name?: string;
  process_name?: string;
};

type GenerateForm = {
  employee_id: string;
  template_code: string;
  issued_date: string;
  override_vars: Record<string, string>;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_HRMS_API_URL?.replace(/\/$/, "")
  ?? (import.meta.env.DEV ? "http://localhost:5055" : "");

const LETTER_TYPE_COLOURS: Record<string, string> = {
  appointment: "bg-violet-50 text-violet-700 border-violet-200",
  salary_slip: "bg-blue-50 text-blue-700 border-blue-200",
  increment:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  promotion:   "bg-amber-50 text-amber-700 border-amber-200",
  experience:  "bg-rose-50 text-rose-700 border-rose-200",
  nda:         "bg-slate-100 text-slate-600 border-slate-200",
};

const EXTRA_FIELDS: Record<string, { key: string; label: string; placeholder?: string; autoKey?: string }[]> = {
  salary_slip: [
    { key: "month_year",          label: "Month & Year",           placeholder: "May - 2026" },
    { key: "working_days",        label: "Working Days",            placeholder: "31" },
    { key: "earned_days",         label: "Earned Days",             placeholder: "31" },
    { key: "pa",                  label: "Performance Allowance",   placeholder: "0", autoKey: "pa" },
    { key: "ma",                  label: "Medical Allowance",       placeholder: "0", autoKey: "ma" },
    { key: "sa",                  label: "Special Allowance",       placeholder: "0", autoKey: "sa" },
    { key: "oa",                  label: "Other Allowance",         placeholder: "0" },
    { key: "arrear",              label: "Arrear",                  placeholder: "0" },
    { key: "incentive",           label: "Incentive",               placeholder: "0" },
    { key: "total_earnings",      label: "Total Earnings",          placeholder: "0.00", autoKey: "gross_monthly" },
    { key: "pf",                  label: "PF Deduction",            placeholder: "0", autoKey: "pf" },
    { key: "loan",                label: "Loan Deduction",          placeholder: "0" },
    { key: "advance_deduction",   label: "Advance Deduction",       placeholder: "0" },
    { key: "other_deduction",     label: "Other Deduction",         placeholder: "0" },
    { key: "total_deductions",    label: "Total Deductions",        placeholder: "0.00", autoKey: "total_deductions" },
    { key: "net_salary",          label: "Net Salary",              placeholder: "0.00", autoKey: "net_salary" },
    { key: "net_salary_words",    label: "Net Salary in Words",     placeholder: "Zero Only" },
    { key: "location",            label: "Location",                placeholder: "NOIDA-2", autoKey: "branch_name" },
    { key: "epf_no",              label: "EPF Number",              placeholder: "" },
    { key: "esi_no",              label: "ESI Number",              placeholder: "" },
  ],
  increment: [
    { key: "review_year",         label: "Review Year",             placeholder: "2026-2027" },
    { key: "eval_year",           label: "Evaluation Year",         placeholder: "2025-2026" },
    { key: "effective_date",      label: "Effective Date",          placeholder: "Apr 1, 2026" },
    { key: "revised_ctc",         label: "Revised CTC (words)",     placeholder: "e.g. 2,00,000" },
    { key: "revised_fixed_ctc",   label: "Revised Fixed CTC (₹)",   placeholder: "" },
    { key: "variable_pay",        label: "Variable Pay (₹)",        placeholder: "" },
    { key: "total_tctc",          label: "Total TCTC (₹)",          placeholder: "" },
    { key: "financial_year",      label: "Financial Year",          placeholder: "2025-26" },
    { key: "hr_name",             label: "HR Signatory Name",       placeholder: "Sheelu Verma" },
    { key: "hr_designation",      label: "HR Designation",          placeholder: "Sr. HR" },
  ],
  promotion: [
    { key: "eval_year",           label: "Evaluation Year",         placeholder: "2025-2026" },
    { key: "new_designation",     label: "New Designation",         placeholder: "Assistant Manager" },
    { key: "new_department",      label: "New Department",          placeholder: "Operations" },
    { key: "effective_date",      label: "Effective Date",          placeholder: "1st Apr 2026" },
    { key: "hr_name",             label: "HR Signatory Name",       placeholder: "Sheelu Verma" },
    { key: "hr_designation",      label: "HR Designation",          placeholder: "Sr. HR" },
  ],
  experience: [
    { key: "date_of_exit",        label: "Last Working Day (YYYY-MM-DD)", placeholder: "2026-04-30" },
    { key: "hr_name",             label: "HR Signatory Name",       placeholder: "Sheelu Verma" },
    { key: "hr_designation",      label: "HR Designation",          placeholder: "Sr. HR" },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d?: string | null) {
  if (!d) return "–";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function r2(n: number) { return Math.round(n * 100) / 100; }

function numberToWords(n: number): string {
  if (n === 0) return "Zero";
  const ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine",
    "Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  const chunk = (num: number): string => {
    if (num === 0) return "";
    if (num < 20) return ones[num] + " ";
    if (num < 100) return tens[Math.floor(num/10)] + (num%10 ? " " + ones[num%10] : "") + " ";
    return ones[Math.floor(num/100)] + " Hundred " + chunk(num%100);
  };
  let rem = Math.floor(n), parts: string[] = [];
  const units = [{ v: 10000000, s: "Crore" }, { v: 100000, s: "Lakh" }, { v: 1000, s: "Thousand" }, { v: 1, s: "" }];
  for (const u of units) {
    const q = Math.floor(rem / u.v);
    if (q) { parts.push(chunk(q).trim() + (u.s ? " " + u.s : "")); rem %= u.v; }
  }
  return parts.join(" ") + " Only";
}

const inputCls = "w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

// ─── Employee Picker ──────────────────────────────────────────────────────────

function EmployeePicker({
  value, onSelect,
}: {
  value: EmployeeHit | null;
  onSelect: (emp: EmployeeHit | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EmployeeHit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const debounced = useDebounce(query, 300);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!debounced.trim() || debounced.length < 2) { setResults([]); return; }
    setBusy(true);
    hrmsApi.get<{ data: EmployeeHit[] }>(`/api/employees?search=${encodeURIComponent(debounced)}&limit=10&status=active`)
      .then(r => setResults(r.data ?? []))
      .catch(() => setResults([]))
      .finally(() => setBusy(false));
  }, [debounced]);

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white font-bold text-sm flex-shrink-0">
          {value.first_name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900 text-sm truncate">
            {value.first_name} {value.last_name ?? ""}
          </p>
          <p className="text-xs text-slate-500 truncate">
            {value.employee_code}
            {value.designation_name ? ` · ${value.designation_name}` : ""}
            {value.branch_name ? ` · ${value.branch_name}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { onSelect(null); setQuery(""); }}
          className="flex-shrink-0 text-slate-400 hover:text-slate-700 cursor-pointer transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        {busy && <Loader className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />}
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search by name or employee code…"
          className="w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1.5 w-full rounded-2xl border bg-white shadow-xl overflow-hidden">
          {results.map(emp => (
            <button
              key={emp.id}
              type="button"
              onMouseDown={() => { onSelect(emp); setQuery(""); setOpen(false); setResults([]); }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-blue-50 transition-colors cursor-pointer border-b last:border-0"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-slate-600 font-bold text-xs flex-shrink-0">
                {emp.first_name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-slate-900 truncate">
                  {emp.first_name} {emp.last_name ?? ""}
                </p>
                <p className="text-xs text-slate-400 truncate">
                  {emp.employee_code}
                  {emp.designation_name ? ` · ${emp.designation_name}` : ""}
                  {emp.branch_name ? ` · ${emp.branch_name}` : ""}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
      {open && debounced.length >= 2 && !busy && results.length === 0 && (
        <div className="absolute z-50 mt-1.5 w-full rounded-2xl border bg-white shadow-xl px-4 py-3 text-sm text-slate-400 text-center">
          No employees found
        </div>
      )}
    </div>
  );
}

// ─── Type badge ───────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type?: string }) {
  const label = (type ?? "–").replace(/_/g, " ");
  const cls = LETTER_TYPE_COLOURS[type ?? ""] ?? "bg-slate-100 text-slate-500 border-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>
      {label}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NativeLetters() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<LetterTemplate[]>([]);
  const [letters, setLetters] = useState<GeneratedLetter[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok?: boolean } | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [ackFilter, setAckFilter] = useState<"all" | "pending" | "acknowledged">("all");

  const [showGenerate, setShowGenerate] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeHit | null>(null);
  const [genForm, setGenForm] = useState<GenerateForm>({
    employee_id: "",
    template_code: "",
    issued_date: new Date().toISOString().slice(0, 10),
    override_vars: {},
  });
  const [autoHints, setAutoHints] = useState<Record<string, string>>({});
  const [salaryLoading, setSalaryLoading] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [ackBusy, setAckBusy] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  // Drawer: employee letter history
  const [drawerEmp, setDrawerEmp] = useState<{ id: string; name: string; code: string } | null>(null);
  const [drawerLetters, setDrawerLetters] = useState<GeneratedLetter[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const selectedTemplate = templates.find(t => t.template_code === genForm.template_code);
  const extraFields = EXTRA_FIELDS[selectedTemplate?.letter_type ?? ""] ?? [];

  // ── Load ───────────────────────────────────────────────────────────────────

  const loadTemplates = async () => {
    try {
      const res = await hrmsApi.get<{ data: LetterTemplate[] }>("/api/letters/templates");
      setTemplates(res.data ?? []);
    } catch { /* non-blocking */ }
  };

  const loadLetters = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await hrmsApi.get<{ data: GeneratedLetter[] }>("/api/letters/all");
      setLetters(res.data ?? []);
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to load letters" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadTemplates(); void loadLetters(); }, []);

  // ── Auto-populate salary fields when employee + template selected ───────────

  useEffect(() => {
    if (!selectedEmployee || selectedTemplate?.letter_type !== "salary_slip") {
      setAutoHints({});
      return;
    }
    setSalaryLoading(true);
    Promise.all([
      hrmsApi.get<{ data: any }>(`/api/payroll/salary-assignments/${selectedEmployee.id}`).catch(() => ({ data: null })),
    ]).then(([salRes]) => {
      const sal = salRes.data;
      if (!sal) { setSalaryLoading(false); return; }
      const ctcMonthly = r2((sal.ctc_annual ?? 0) / 12);
      const basicPct = sal.basic_pct ?? 50;
      const hraPct  = sal.hra_pct  ?? 20;
      const basic   = r2(ctcMonthly * basicPct / 100);
      const hra     = r2(ctcMonthly * hraPct   / 100);
      const special = r2(ctcMonthly - basic - hra);
      const pf      = r2(basic * 0.12);
      const totalDed = r2(pf);
      const net     = r2(ctcMonthly - totalDed);
      const hints: Record<string, string> = {
        gross_monthly:    String(ctcMonthly),
        sa:               String(special),
        ma:               String(hra),
        pa:               String(basic),
        pf:               String(pf),
        total_deductions: String(totalDed),
        net_salary:       String(net),
        branch_name:      selectedEmployee.branch_name ?? "",
      };
      setAutoHints(hints);
      // Pre-fill override_vars only for blank fields
      setGenForm(f => {
        const merged = { ...f.override_vars };
        for (const field of (EXTRA_FIELDS.salary_slip ?? [])) {
          if (field.autoKey && hints[field.autoKey] && !merged[field.key]) {
            merged[field.key] = hints[field.autoKey];
          }
        }
        // auto net_salary_words
        if (!merged["net_salary_words"]) {
          merged["net_salary_words"] = numberToWords(net);
        }
        return { ...f, override_vars: merged };
      });
    }).finally(() => setSalaryLoading(false));
  }, [selectedEmployee?.id, selectedTemplate?.letter_type]);

  // ── Sync selectedEmployee → genForm.employee_id ────────────────────────────

  useEffect(() => {
    setGenForm(f => ({ ...f, employee_id: selectedEmployee?.id ?? "", override_vars: {} }));
    setAutoHints({});
  }, [selectedEmployee?.id]);

  // ── Generate ───────────────────────────────────────────────────────────────

  const submitGenerate = async () => {
    if (!genForm.employee_id || !genForm.template_code) {
      return setMessage({ text: "Select an employee and a template." });
    }
    setGenBusy(true);
    try {
      await hrmsApi.post("/api/letters/generate", {
        employee_id: genForm.employee_id,
        template_code: genForm.template_code,
        issued_date: genForm.issued_date,
        override_vars: genForm.override_vars,
      });
      setShowGenerate(false);
      setSelectedEmployee(null);
      setGenForm({ employee_id: "", template_code: "", issued_date: new Date().toISOString().slice(0, 10), override_vars: {} });
      setMessage({ text: "Letter generated successfully.", ok: true });
      await loadLetters();
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to generate letter." });
    } finally {
      setGenBusy(false);
    }
  };

  // ── Preview before generate ────────────────────────────────────────────────

  const previewBeforeGenerate = async () => {
    if (!genForm.employee_id || !genForm.template_code) return;
    setPreviewBusy(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/letters/preview-html`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ employee_id: genForm.employee_id, template_code: genForm.template_code, issued_date: genForm.issued_date, override_vars: genForm.override_vars }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); }
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : "Preview failed." });
    } finally {
      setPreviewBusy(false);
    }
  };

  // ── Acknowledge ────────────────────────────────────────────────────────────

  const acknowledge = async (letterId: string) => {
    setAckBusy(letterId);
    try {
      await hrmsApi.post(`/api/letters/${letterId}/acknowledge`, {});
      setMessage({ text: "Letter acknowledged.", ok: true });
      await loadLetters();
      if (drawerEmp) await openDrawer(drawerEmp.id, drawerEmp.name, drawerEmp.code);
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to acknowledge." });
    } finally {
      setAckBusy(null);
    }
  };

  // ── Download + Print ───────────────────────────────────────────────────────

  const downloadLetter = async (letterId: string, name: string) => {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/api/letters/${letterId}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return setMessage({ text: "Download failed." });
    const html = await res.text();
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `letter_${name.replace(/\s+/g, "_")}_${letterId.slice(0, 8)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printLetter = (letterId: string) => {
    const w = window.open(`/letters/${letterId}/preview`, "_blank");
    if (w) { w.addEventListener("load", () => w.print()); }
  };

  // ── Drawer ─────────────────────────────────────────────────────────────────

  const openDrawer = async (empId: string, name: string, code: string) => {
    setDrawerEmp({ id: empId, name, code });
    setDrawerLoading(true);
    try {
      const res = await hrmsApi.get<{ data: GeneratedLetter[] }>(`/api/letters/employee/${empId}`);
      setDrawerLetters(res.data ?? []);
    } catch { setDrawerLetters([]); }
    finally { setDrawerLoading(false); }
  };

  // ── Filters ────────────────────────────────────────────────────────────────

  const letterTypes = ["all", ...Array.from(new Set(letters.map(l => l.letter_type ?? "").filter(Boolean)))];

  const filtered = letters.filter(l => {
    const q = search.trim().toLowerCase();
    const text = [l.employee_name, l.employee_code, l.template_name, l.letter_type].join(" ").toLowerCase();
    const matchSearch = !q || text.includes(q);
    const matchType = typeFilter === "all" || l.letter_type === typeFilter;
    const matchAck =
      ackFilter === "all" ? true :
      ackFilter === "pending" ? !l.acknowledged :
      !!l.acknowledged;
    return matchSearch && matchType && matchAck;
  });

  const stats = {
    total:        letters.length,
    acknowledged: letters.filter(l => l.acknowledged).length,
    pending:      letters.filter(l => !l.acknowledged).length,
    templates:    templates.length,
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">HR Documents</p>
            <h1 className="mt-1 text-3xl font-black text-slate-950">Letters</h1>
            <p className="mt-1 text-sm text-slate-500">
              Generate, preview and issue official MAS Callnet letters to employees.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button onClick={() => void loadLetters()} disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50">
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button onClick={() => { setShowGenerate(true); setMessage(null); }}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer">
              <Plus className="h-4 w-4" /> Generate Letter
            </button>
          </div>
        </div>

        {/* Message banner */}
        {message && (
          <div className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold ${
            message.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}>
            <span className="flex items-center gap-2">
              {message.ok
                ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                : <AlertTriangle className="h-4 w-4 flex-shrink-0" />}
              {message.text}
            </span>
            <button onClick={() => setMessage(null)} className="cursor-pointer text-current opacity-60 hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Total Letters",    value: stats.total,        icon: FileText,    bg: "bg-slate-100",   fg: "text-slate-600",   click: () => setAckFilter("all") },
            { label: "Acknowledged",     value: stats.acknowledged, icon: CheckCircle2,bg: "bg-emerald-50",  fg: "text-emerald-600", click: () => setAckFilter("acknowledged") },
            { label: "Pending Ack.",     value: stats.pending,      icon: Clock,       bg: "bg-amber-50",    fg: "text-amber-600",   click: () => setAckFilter("pending") },
            { label: "Templates",        value: stats.templates,    icon: FileText,    bg: "bg-blue-50",     fg: "text-blue-600",    click: undefined },
          ].map(({ label, value, icon: Icon, bg, fg, click }) => (
            <button key={label} onClick={click} disabled={!click}
              className={`glass-card stat-card rounded-3xl p-5 text-left transition-all ${click ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5" : "cursor-default"}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-500">{label}</p>
                  <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
                </div>
                <div className={`rounded-2xl p-3 ${bg}`}><Icon className={`h-5 w-5 ${fg}`} /></div>
              </div>
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="rounded-3xl border bg-white p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap gap-3">
            {/* Text search */}
            <div className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search employee, code, template…"
                className="h-10 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400 transition-colors" />
            </div>
            {/* Ack filter */}
            <div className="relative">
              <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select value={ackFilter} onChange={e => setAckFilter(e.target.value as typeof ackFilter)}
                className="h-10 rounded-2xl border bg-slate-50 pl-9 pr-8 text-sm outline-none focus:border-blue-400 appearance-none cursor-pointer transition-colors">
                <option value="all">All status</option>
                <option value="pending">Pending only</option>
                <option value="acknowledged">Acknowledged only</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
          {/* Type pills */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-black uppercase tracking-wider text-slate-400">Type:</span>
            {letterTypes.map(t => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize cursor-pointer transition-colors ${
                  typeFilter === t ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}>
                {t === "all" ? "All" : t.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="font-black text-slate-950">Generated Letters</h2>
              <p className="text-sm text-slate-400">{filtered.length} of {letters.length}</p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader className="h-8 w-8 animate-spin text-slate-300" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center text-slate-400">
              <FileText className="mx-auto mb-3 h-10 w-10 opacity-20" />
              <p className="font-semibold">No letters found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    {["Employee", "Template", "Type", "Issued", "Acknowledged", "Actions"].map(h => (
                      <th key={h} className="px-5 py-3.5 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(l => {
                    const lid = l.letter_id ?? l.id;
                    return (
                      <tr key={l.id} className="hover:bg-slate-50/70 transition-colors">
                        {/* Employee */}
                        <td className="px-5 py-4">
                          <button
                            onClick={() => void openDrawer(l.employee_id, l.employee_name ?? l.employee_id, l.employee_code ?? "")}
                            className="text-left group cursor-pointer"
                          >
                            <p className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                              {l.employee_name ?? l.employee_id}
                            </p>
                            {l.employee_code && (
                              <p className="font-mono text-xs text-slate-400">{l.employee_code}</p>
                            )}
                          </button>
                        </td>
                        {/* Template */}
                        <td className="px-5 py-4 text-slate-700 font-medium">{l.template_name ?? l.template_code}</td>
                        {/* Type */}
                        <td className="px-5 py-4"><TypeBadge type={l.letter_type} /></td>
                        {/* Issued */}
                        <td className="px-5 py-4 text-slate-600 whitespace-nowrap">{fmt(l.issued_date)}</td>
                        {/* Acknowledged */}
                        <td className="px-5 py-4">
                          {l.acknowledged ? (
                            <div>
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Acknowledged
                              </span>
                              {l.acknowledged_at && (
                                <p className="mt-1 text-xs text-slate-400">{fmt(l.acknowledged_at)}</p>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                              <Clock className="h-3.5 w-3.5" /> Pending
                            </span>
                          )}
                        </td>
                        {/* Actions */}
                        <td className="px-5 py-4">
                          <div className="flex gap-1.5 flex-wrap">
                            <button onClick={() => navigate(`/letters/${lid}/preview`)}
                              className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors cursor-pointer">
                              <Eye className="h-3.5 w-3.5" /> Preview
                            </button>
                            <button onClick={() => printLetter(lid)}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer">
                              <Printer className="h-3.5 w-3.5" /> Print
                            </button>
                            <button onClick={() => void downloadLetter(lid, l.template_name ?? "letter")}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer">
                              <Download className="h-3.5 w-3.5" /> Download
                            </button>
                            {!l.acknowledged && (
                              <button onClick={() => void acknowledge(lid)} disabled={ackBusy === lid}
                                className="inline-flex items-center gap-1 cursor-pointer rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50">
                                <Mail className="h-3.5 w-3.5" />
                                {ackBusy === lid ? "…" : "Acknowledge"}
                              </button>
                            )}
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

      {/* ── Employee History Drawer ──────────────────────────────────────────── */}
      {drawerEmp && (
        <div className="fixed inset-0 z-40 flex">
          <div className="flex-1 bg-slate-950/40 backdrop-blur-sm" onClick={() => setDrawerEmp(null)} />
          <div className="w-full max-w-md bg-white shadow-2xl flex flex-col h-full">
            {/* Drawer header */}
            <div className="flex items-center justify-between border-b px-6 py-5">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-slate-400">Letter History</p>
                <h3 className="font-black text-slate-950">{drawerEmp.name}</h3>
                <p className="text-xs font-mono text-slate-400">{drawerEmp.code}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setDrawerEmp(null);
                    setSelectedEmployee(null);
                    setShowGenerate(true);
                    // Pre-select this employee in the modal via a small hack
                    setGenForm(f => ({ ...f, employee_id: drawerEmp.id }));
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer">
                  <Plus className="h-3.5 w-3.5" /> New Letter
                </button>
                <button onClick={() => setDrawerEmp(null)}
                  className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            {/* Drawer body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {drawerLoading ? (
                <div className="flex justify-center py-10">
                  <Loader className="h-7 w-7 animate-spin text-slate-300" />
                </div>
              ) : drawerLetters.length === 0 ? (
                <div className="py-10 text-center text-slate-400">
                  <FileText className="mx-auto mb-2 h-8 w-8 opacity-20" />
                  <p className="text-sm font-semibold">No letters issued yet</p>
                </div>
              ) : (
                drawerLetters.map(l => {
                  const lid = l.letter_id ?? l.id;
                  return (
                    <div key={l.id} className="rounded-2xl border bg-slate-50 p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-bold text-sm text-slate-900">{l.template_name ?? l.template_code}</p>
                          <p className="text-xs text-slate-500 mt-0.5">Issued: {fmt(l.issued_date)}</p>
                        </div>
                        <TypeBadge type={l.letter_type} />
                      </div>
                      <div className="flex items-center justify-between">
                        {l.acknowledged ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Ack {fmt(l.acknowledged_at)}
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-amber-600 flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" /> Pending acknowledgement
                          </span>
                        )}
                        <div className="flex gap-1.5">
                          <button onClick={() => navigate(`/letters/${lid}/preview`)}
                            className="rounded-lg bg-blue-50 p-1.5 text-blue-600 hover:bg-blue-100 transition-colors cursor-pointer">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => void downloadLetter(lid, l.template_name ?? "letter")}
                            className="rounded-lg bg-slate-200 p-1.5 text-slate-600 hover:bg-slate-300 transition-colors cursor-pointer">
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          {!l.acknowledged && (
                            <button onClick={() => void acknowledge(lid)} disabled={ackBusy === lid}
                              className="rounded-lg bg-emerald-600 p-1.5 text-white hover:bg-emerald-700 transition-colors cursor-pointer disabled:opacity-50">
                              <Mail className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Generate Letter Modal ────────────────────────────────────────────── */}
      {showGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b px-6 py-5">
              <div>
                <h2 className="text-lg font-black text-slate-950">Generate Letter</h2>
                <p className="text-sm text-slate-400">Search for an employee, pick a template, fill any overrides.</p>
              </div>
              <button onClick={() => { setShowGenerate(false); setSelectedEmployee(null); }}
                className="cursor-pointer rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-6 space-y-5">

              {/* Employee picker */}
              <Field label="Employee *" hint={selectedEmployee ? undefined : "Type at least 2 characters to search"}>
                <EmployeePicker value={selectedEmployee} onSelect={emp => setSelectedEmployee(emp)} />
              </Field>

              {/* Template */}
              <Field label="Letter Template *">
                <div className="relative">
                  <select value={genForm.template_code}
                    onChange={e => setGenForm({ ...genForm, template_code: e.target.value, override_vars: {} })}
                    className={`${inputCls} pr-9 appearance-none cursor-pointer`}>
                    <option value="">Select template…</option>
                    {templates.map(t => (
                      <option key={t.template_code} value={t.template_code}>
                        {t.template_name} — {(t.letter_type ?? "").replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                </div>
              </Field>

              {/* Issued date */}
              <Field label="Issued Date *">
                <input type="date" value={genForm.issued_date}
                  onChange={e => setGenForm({ ...genForm, issued_date: e.target.value })}
                  className={inputCls} />
              </Field>

              {/* Dynamic extra fields */}
              {extraFields.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-400">
                      Letter-specific fields
                    </p>
                    {salaryLoading && (
                      <span className="flex items-center gap-1.5 text-xs text-slate-400">
                        <Loader className="h-3.5 w-3.5 animate-spin" /> Auto-populating from salary…
                      </span>
                    )}
                    {!salaryLoading && Object.keys(autoHints).length > 0 && (
                      <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Auto-populated from salary record
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {extraFields.map(f => {
                      const isAuto = !!f.autoKey && !!autoHints[f.autoKey];
                      return (
                        <div key={f.key}>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">
                            {f.label}
                            {isAuto && <span className="ml-1.5 text-emerald-500 text-[10px] font-bold">AUTO</span>}
                          </label>
                          <input
                            value={genForm.override_vars[f.key] ?? ""}
                            onChange={e => setGenForm({ ...genForm, override_vars: { ...genForm.override_vars, [f.key]: e.target.value } })}
                            placeholder={isAuto ? autoHints[f.autoKey!] : (f.placeholder ?? "")}
                            className={`w-full rounded-xl border px-3 py-2 text-sm outline-none transition-all bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 ${isAuto && !genForm.override_vars[f.key] ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200"}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => { setShowGenerate(false); setSelectedEmployee(null); }}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={() => void previewBeforeGenerate()}
                disabled={previewBusy || !genForm.employee_id || !genForm.template_code}
                className="cursor-pointer rounded-2xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm font-bold text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-40">
                {previewBusy ? <Loader className="h-4 w-4 animate-spin" /> : <><Eye className="h-4 w-4 inline mr-1.5" />Preview</>}
              </button>
              <button onClick={() => void submitGenerate()} disabled={genBusy || !genForm.employee_id || !genForm.template_code}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-40">
                {genBusy ? <Loader className="h-4 w-4 animate-spin mx-auto" /> : "Generate & Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
