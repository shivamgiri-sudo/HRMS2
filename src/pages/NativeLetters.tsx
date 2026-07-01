import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, FileText, Loader,
  Plus, RefreshCcw, Search,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

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
};

const inputCls = "w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NativeLetters() {
  const [templates, setTemplates] = useState<LetterTemplate[]>([]);
  const [letters, setLetters] = useState<GeneratedLetter[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const [showGenerate, setShowGenerate] = useState(false);
  const [genForm, setGenForm] = useState<GenerateForm>({
    employee_id: "",
    template_code: "",
    issued_date: new Date().toISOString().slice(0, 10),
  });
  const [genBusy, setGenBusy] = useState(false);
  const [ackBusy, setAckBusy] = useState<string | null>(null);

  // ── Fetch employee id for letter listing — default: list all via admin ───────
  const [employeeFilter, setEmployeeFilter] = useState("");

  // ── Load ─────────────────────────────────────────────────────────────────────

  const loadTemplates = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: LetterTemplate[] }>("/api/letters/templates");
      setTemplates(res.data ?? []);
    } catch {
      // non-blocking
    }
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

  useEffect(() => {
    void loadTemplates();
    void loadLetters();
  }, []);

  // ── Generate Letter ──────────────────────────────────────────────────────────

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
      });
      setShowGenerate(false);
      setGenForm({ employee_id: "", template_code: "", issued_date: new Date().toISOString().slice(0, 10) });
      setMessage("Letter generated successfully.");
      await loadLetters();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to generate letter.");
    } finally {
      setGenBusy(false);
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
    total:          letters.length,
    acknowledged:   letters.filter((l) => l.acknowledged).length,
    pending:        letters.filter((l) => !l.acknowledged).length,
    templates:      templates.length,
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
              Generate, track, and acknowledge HR letters for employees.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void loadLetters()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            <button
              onClick={() => { setShowGenerate(true); setMessage(""); }}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Generate Letter
            </button>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {message}
          </div>
        )}

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          {[
            { title: "Total Letters",    value: stats.total,        tone: "bg-slate-100 text-slate-700" },
            { title: "Acknowledged",     value: stats.acknowledged, tone: "bg-emerald-50 text-emerald-700" },
            { title: "Pending Ack.",     value: stats.pending,      tone: "bg-amber-50 text-amber-700" },
            { title: "Templates",        value: stats.templates,    tone: "bg-blue-50 text-blue-700" },
          ].map(({ title, value, tone }) => (
            <div key={title} className="glass-card stat-card rounded-3xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-500">{title}</p>
                  <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
                </div>
                <div className={`rounded-2xl p-3 ${tone}`}>
                  <FileText className="h-5 w-5" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="rounded-3xl border bg-white p-4 shadow-sm space-y-3">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employee, template…"
                className="h-11 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                value={employeeFilter}
                onChange={(e) => setEmployeeFilter(e.target.value)}
                placeholder="Employee ID to filter…"
                className="h-11 rounded-2xl border bg-slate-50 px-4 text-sm outline-none focus:border-blue-400 transition-colors min-w-[200px]"
              />
              <button
                onClick={() => void loadLetters()}
                className="h-11 px-4 rounded-2xl bg-slate-950 text-white text-sm font-bold hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Filter
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="text-xs font-black uppercase text-slate-400 self-center mr-1">Type:</span>
            {letterTypes.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize cursor-pointer transition-colors ${typeFilter === t ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
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
              <table className="w-full min-w-[800px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    {["Employee", "Template", "Type", "Issued Date", "Acknowledged", "Actions"].map((h) => (
                      <th key={h} className="p-4 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
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
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Acknowledged
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="p-4">
                        {!l.acknowledged && (
                          <button
                            onClick={() => void acknowledge(l.letter_id ?? l.id)}
                            disabled={ackBusy === (l.letter_id ?? l.id)}
                            className="cursor-pointer rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                          >
                            {ackBusy === (l.letter_id ?? l.id) ? "…" : "Acknowledge"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Generate Letter Modal ─────────────────────────────────────────────── */}
      {showGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Generate Letter</h2>
              <button onClick={() => setShowGenerate(false)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              <Field label="Employee ID *">
                <input
                  value={genForm.employee_id}
                  onChange={(e) => setGenForm({ ...genForm, employee_id: e.target.value })}
                  placeholder="Employee UUID"
                  className={inputCls}
                />
              </Field>
              <Field label="Letter Template *">
                <select
                  value={genForm.template_code}
                  onChange={(e) => setGenForm({ ...genForm, template_code: e.target.value })}
                  className={inputCls}
                >
                  <option value="">Select template…</option>
                  {templates.map((t) => (
                    <option key={t.template_code} value={t.template_code}>
                      {t.template_name} ({t.template_code})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Issued Date *">
                <input
                  type="date"
                  value={genForm.issued_date}
                  onChange={(e) => setGenForm({ ...genForm, issued_date: e.target.value })}
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => setShowGenerate(false)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void submitGenerate()}
                disabled={genBusy}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {genBusy ? "Generating…" : "Generate Letter"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
