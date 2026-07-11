import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, CheckCircle2, FileText, Loader,
  Plus, RefreshCcw, Search, Eye, Printer, Download,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi, getAuthToken } from "@/lib/hrmsApi";

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
  generated_at?: string;
  created_at: string;
};

type GenerateForm = {
  employee_id: string;
  template_code: string;
  issued_date: string;
  override_vars: Record<string, string>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_HRMS_API_URL?.replace(/\/$/, "")
  ?? (import.meta.env.DEV ? "http://localhost:5055" : "");

const inputCls = "w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// ─── Letter type → extra fields map ──────────────────────────────────────────
const EXTRA_FIELDS: Record<string, { key: string; label: string; placeholder?: string }[]> = {
  salary_slip: [
    { key: "month_year",    label: "Month & Year",          placeholder: "e.g. May - 2026" },
    { key: "working_days",  label: "Working Days",           placeholder: "31" },
    { key: "earned_days",   label: "Earned Days",            placeholder: "31" },
    { key: "pa",            label: "PA (Performance Allow)", placeholder: "0" },
    { key: "ma",            label: "MA (Medical Allow)",     placeholder: "0" },
    { key: "sa",            label: "SA (Special Allow)",     placeholder: "0" },
    { key: "oa",            label: "OA (Other Allow)",       placeholder: "0" },
    { key: "arrear",        label: "Arrear",                 placeholder: "0" },
    { key: "incentive",     label: "Incentive",              placeholder: "0" },
    { key: "total_earnings",label: "Total Earnings",         placeholder: "0.00" },
    { key: "pf",            label: "PF Deduction",           placeholder: "960" },
    { key: "loan",          label: "Loan Deduction",         placeholder: "0" },
    { key: "advance_deduction", label: "Advance Deduction",  placeholder: "0" },
    { key: "other_deduction",   label: "Other Deduction",    placeholder: "0" },
    { key: "total_deductions",  label: "Total Deductions",   placeholder: "0.00" },
    { key: "net_salary",    label: "Net Salary",             placeholder: "0.00" },
    { key: "net_salary_words",  label: "Net Salary in Words", placeholder: "Zero Only" },
    { key: "location",      label: "Location",               placeholder: "NOIDA-2" },
    { key: "epf_no",        label: "EPF Number",             placeholder: "" },
    { key: "esi_no",        label: "ESI Number",             placeholder: "" },
  ],
  increment: [
    { key: "review_year",       label: "Review Year",            placeholder: "2026-2027" },
    { key: "eval_year",         label: "Evaluation Year",        placeholder: "2025-2026" },
    { key: "effective_date",    label: "Effective Date",         placeholder: "Apr 1, 2026" },
    { key: "revised_ctc",       label: "Revised CTC (words)",    placeholder: "e.g. 2,00,000" },
    { key: "revised_fixed_ctc", label: "Revised Fixed CTC (Rs)", placeholder: "" },
    { key: "variable_pay",      label: "Variable Pay (Rs)",      placeholder: "" },
    { key: "total_tctc",        label: "Total TCTC (Rs)",        placeholder: "" },
    { key: "financial_year",    label: "Financial Year",         placeholder: "2025-26" },
    { key: "hr_name",           label: "HR Signatory Name",      placeholder: "Sheelu Verma" },
    { key: "hr_designation",    label: "HR Designation",         placeholder: "Sr. HR" },
  ],
  promotion: [
    { key: "eval_year",      label: "Evaluation Year",  placeholder: "2025-2026" },
    { key: "new_designation",label: "New Designation",  placeholder: "Assistant Manager" },
    { key: "new_department", label: "New Department",   placeholder: "Operations" },
    { key: "effective_date", label: "Effective Date",   placeholder: "1st Apr 2026" },
    { key: "hr_name",        label: "HR Signatory Name",placeholder: "Sheelu Verma" },
    { key: "hr_designation", label: "HR Designation",   placeholder: "Sr. HR" },
  ],
  experience: [
    { key: "date_of_exit", label: "Last Working Day (YYYY-MM-DD)", placeholder: "2026-04-30" },
    { key: "hr_name",      label: "HR Signatory Name",             placeholder: "Sheelu Verma" },
    { key: "hr_designation", label: "HR Designation",              placeholder: "Sr. HR" },
  ],
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NativeLetters() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<LetterTemplate[]>([]);
  const [letters, setLetters] = useState<GeneratedLetter[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("");

  const [showGenerate, setShowGenerate] = useState(false);
  const [genForm, setGenForm] = useState<GenerateForm>({
    employee_id: "",
    template_code: "",
    issued_date: new Date().toISOString().slice(0, 10),
    override_vars: {},
  });
  const [genBusy, setGenBusy] = useState(false);
  const [ackBusy, setAckBusy] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);

  // Selected template's letter_type
  const selectedTemplate = templates.find(t => t.template_code === genForm.template_code);
  const extraFields = EXTRA_FIELDS[selectedTemplate?.letter_type ?? ""] ?? [];

  // ── Load ─────────────────────────────────────────────────────────────────────

  const loadTemplates = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: LetterTemplate[] }>("/api/letters/templates");
      setTemplates(res.data ?? []);
    } catch { /* non-blocking */ }
  };

  const loadLetters = async () => {
    setLoading(true);
    setMessage("");
    try {
      const path = employeeFilter.trim()
        ? `/api/letters/employee/${employeeFilter.trim()}`
        : `/api/letters/employee/all`;
      const res = await hrmsApi.get<{ success: boolean; data: GeneratedLetter[] }>(path);
      setLetters(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load letters");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadTemplates(); void loadLetters(); }, []);

  // ── Generate ─────────────────────────────────────────────────────────────────

  const submitGenerate = async () => {
    if (!genForm.employee_id.trim() || !genForm.template_code) {
      return setMessage("Employee ID and template are required.");
    }
    setGenBusy(true);
    try {
      await hrmsApi.post("/api/letters/generate", {
        employee_id: genForm.employee_id.trim(),
        template_code: genForm.template_code,
        issued_date: genForm.issued_date,
        override_vars: genForm.override_vars,
      });
      setShowGenerate(false);
      setGenForm({ employee_id: "", template_code: "", issued_date: new Date().toISOString().slice(0, 10), override_vars: {} });
      setMessage("Letter generated successfully.");
      await loadLetters();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to generate letter.");
    } finally {
      setGenBusy(false);
    }
  };

  // ── Preview before generating ─────────────────────────────────────────────────
  const previewBeforeGenerate = async () => {
    if (!genForm.employee_id.trim() || !genForm.template_code) return;
    setPreviewBusy("preview");
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/letters/preview-html`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          employee_id: genForm.employee_id.trim(),
          template_code: genForm.template_code,
          issued_date: genForm.issued_date,
          override_vars: genForm.override_vars,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); }
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Preview failed.");
    } finally {
      setPreviewBusy(null);
    }
  };

  // ── Acknowledge ──────────────────────────────────────────────────────────────
  const acknowledge = async (letterId: string) => {
    setAckBusy(letterId);
    try {
      await hrmsApi.post(`/api/letters/${letterId}/acknowledge`, {});
      setMessage("Letter acknowledged.");
      await loadLetters();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to acknowledge.");
    } finally {
      setAckBusy(null);
    }
  };

  // ── Download ─────────────────────────────────────────────────────────────────
  const downloadLetter = async (letterId: string, name: string) => {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/api/letters/${letterId}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return setMessage("Download failed.");
    const html = await res.text();
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `letter_${name.replace(/\s+/g, "_")}_${letterId.slice(0, 8)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Filter ───────────────────────────────────────────────────────────────────
  const letterTypes = ["all", ...Array.from(new Set(letters.map((l) => l.letter_type ?? l.template_code).filter(Boolean)))];

  const filtered = letters.filter((l) => {
    const q = search.trim().toLowerCase();
    const text = [l.employee_name, l.employee_code, l.template_name, l.template_code, l.letter_type].join(" ").toLowerCase();
    const matchSearch = !q || text.includes(q);
    const matchType = typeFilter === "all" || (l.letter_type ?? l.template_code) === typeFilter;
    return matchSearch && matchType;
  });

  const stats = {
    total:        letters.length,
    acknowledged: letters.filter((l) => l.acknowledged).length,
    pending:      letters.filter((l) => !l.acknowledged).length,
    templates:    templates.length,
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">HR Documents</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Letters</h1>
            <p className="mt-2 max-w-4xl text-slate-600">
              Generate, preview, print and acknowledge official MAS Callnet letters.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => void loadLetters()} disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50">
              <RefreshCcw className="h-4 w-4" /> Refresh
            </button>
            <button onClick={() => { setShowGenerate(true); setMessage(""); }}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer">
              <Plus className="h-4 w-4" /> Generate Letter
            </button>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {message}
          </div>
        )}

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          {[
            { title: "Total Letters",  value: stats.total,        tone: "bg-slate-100 text-slate-700" },
            { title: "Acknowledged",   value: stats.acknowledged, tone: "bg-emerald-50 text-emerald-700" },
            { title: "Pending Ack.",   value: stats.pending,      tone: "bg-amber-50 text-amber-700" },
            { title: "Templates",      value: stats.templates,    tone: "bg-blue-50 text-blue-700" },
          ].map(({ title, value, tone }) => (
            <div key={title} className="glass-card stat-card rounded-3xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-500">{title}</p>
                  <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
                </div>
                <div className={`rounded-2xl p-3 ${tone}`}><FileText className="h-5 w-5" /></div>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="rounded-3xl border bg-white p-4 shadow-sm space-y-3">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employee, template…"
                className="h-11 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400 transition-colors" />
            </div>
            <div className="flex items-center gap-2">
              <input value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}
                placeholder="Employee ID to filter…"
                className="h-11 rounded-2xl border bg-slate-50 px-4 text-sm outline-none focus:border-blue-400 transition-colors min-w-[200px]" />
              <button onClick={() => void loadLetters()}
                className="h-11 px-4 rounded-2xl bg-slate-950 text-white text-sm font-bold hover:bg-slate-800 transition-colors cursor-pointer">
                Filter
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="text-xs font-black uppercase text-slate-400 self-center mr-1">Type:</span>
            {letterTypes.map((t) => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize cursor-pointer transition-colors ${typeFilter === t ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {t.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">Generated Letters</h2>
            <p className="text-sm text-slate-500">{filtered.length} letters</p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <FileText className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="font-semibold">No letters found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    {["Employee", "Template", "Type", "Issued Date", "Acknowledged", "Actions"].map((h) => (
                      <th key={h} className="p-4 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => {
                    const lid = l.letter_id ?? l.id;
                    return (
                      <tr key={l.id} className="border-t hover:bg-slate-50/80 transition-colors">
                        <td className="p-4">
                          <div className="font-bold text-slate-950">{l.employee_name ?? l.employee_id}</div>
                          {l.employee_code && <div className="font-mono text-xs text-slate-400">{l.employee_code}</div>}
                        </td>
                        <td className="p-4 text-slate-700">{l.template_name ?? l.template_code}</td>
                        <td className="p-4 text-slate-500 capitalize">{(l.letter_type ?? "–").replace(/_/g, " ")}</td>
                        <td className="p-4 font-mono text-slate-600">{l.issued_date?.slice(0, 10) ?? "–"}</td>
                        <td className="p-4">
                          {l.acknowledged ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Acknowledged
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">Pending</span>
                          )}
                        </td>
                        <td className="p-4">
                          <div className="flex gap-1.5 flex-wrap">
                            {/* Preview */}
                            <button
                              onClick={() => navigate(`/letters/${lid}/preview`)}
                              title="Preview"
                              className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors cursor-pointer">
                              <Eye className="h-3.5 w-3.5" /> Preview
                            </button>
                            {/* Print */}
                            <button
                              onClick={() => navigate(`/letters/${lid}/preview`)}
                              title="Print"
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer">
                              <Printer className="h-3.5 w-3.5" /> Print
                            </button>
                            {/* Download */}
                            <button
                              onClick={() => void downloadLetter(lid, l.template_name ?? "letter")}
                              title="Download"
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer">
                              <Download className="h-3.5 w-3.5" /> Download
                            </button>
                            {/* Acknowledge */}
                            {!l.acknowledged && (
                              <button
                                onClick={() => void acknowledge(lid)}
                                disabled={ackBusy === lid}
                                className="cursor-pointer rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50">
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

      {/* ── Generate Letter Modal ────────────────────────────────────────────── */}
      {showGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Generate Letter</h2>
              <button onClick={() => setShowGenerate(false)} className="cursor-pointer text-slate-400 hover:text-slate-700 text-2xl leading-none transition-colors">×</button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <Field label="Employee ID *">
                <input value={genForm.employee_id}
                  onChange={(e) => setGenForm({ ...genForm, employee_id: e.target.value })}
                  placeholder="Employee UUID or code"
                  className={inputCls} />
              </Field>
              <Field label="Letter Template *">
                <select value={genForm.template_code}
                  onChange={(e) => setGenForm({ ...genForm, template_code: e.target.value, override_vars: {} })}
                  className={inputCls}>
                  <option value="">Select template…</option>
                  {templates.map((t) => (
                    <option key={t.template_code} value={t.template_code}>
                      {t.template_name} — {(t.letter_type ?? "").replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Issued Date *">
                <input type="date" value={genForm.issued_date}
                  onChange={(e) => setGenForm({ ...genForm, issued_date: e.target.value })}
                  className={inputCls} />
              </Field>

              {/* Dynamic extra fields for this letter type */}
              {extraFields.length > 0 && (
                <div className="border rounded-2xl p-4 space-y-3 bg-slate-50">
                  <p className="text-xs font-black uppercase text-slate-400 tracking-wider">Letter-specific fields (override auto-populated values)</p>
                  <div className="grid grid-cols-2 gap-3">
                    {extraFields.map((f) => (
                      <div key={f.key}>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">{f.label}</label>
                        <input
                          value={genForm.override_vars[f.key] ?? ""}
                          onChange={(e) => setGenForm({
                            ...genForm,
                            override_vars: { ...genForm.override_vars, [f.key]: e.target.value },
                          })}
                          placeholder={f.placeholder ?? ""}
                          className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors bg-white" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setShowGenerate(false)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={() => void previewBeforeGenerate()}
                disabled={previewBusy === "preview" || !genForm.employee_id || !genForm.template_code}
                className="cursor-pointer rounded-2xl border border-blue-300 bg-blue-50 px-5 py-3 text-sm font-bold text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50">
                {previewBusy === "preview" ? "Loading…" : "Preview"}
              </button>
              <button onClick={() => void submitGenerate()} disabled={genBusy}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
                {genBusy ? "Generating…" : "Generate & Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
