import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowRight, Briefcase, Edit2,
  Loader, RefreshCcw, Search, TrendingUp, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CareerPath {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  current_role: string | null;
  target_role: string | null;
  target_timeline: string | null;
  readiness_pct: number;
  skills_gap: string | null;
  notes: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

interface CareerPathForm {
  current_role: string;
  target_role: string;
  target_timeline: string;
  readiness_pct: string;
  skills_gap: string;
  notes: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readinessBadge(pct: number): { label: string; cls: string } {
  if (pct >= 80) return { label: "Ready", cls: "bg-emerald-50 text-emerald-700" };
  if (pct >= 50) return { label: "In Progress", cls: "bg-amber-50 text-amber-700" };
  return { label: "Needs Work", cls: "bg-red-50 text-red-700" };
}

function ReadinessBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
      <div
        className={`h-2 rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

// ─── Career Path Card ─────────────────────────────────────────────────────────

function CareerCard({
  record,
  onEdit,
}: {
  record: CareerPath;
  onEdit: (r: CareerPath) => void;
}) {
  const { label, cls } = readinessBadge(Number(record.readiness_pct));
  return (
    <div className="rounded-3xl border bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Career Path</p>
          <h3 className="mt-1 text-xl font-black text-slate-950">
            {record.employee_name ?? record.employee_id}
          </h3>
          {record.employee_code && (
            <p className="font-mono text-xs text-slate-400">{record.employee_code}</p>
          )}
        </div>
        <button
          onClick={() => onEdit(record)}
          className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <Edit2 className="h-3.5 w-3.5" />
          Edit
        </button>
      </div>

      {/* Role journey */}
      <div className="mt-5 flex items-center gap-3">
        <div className="rounded-2xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
          {record.current_role ?? "—"}
        </div>
        <ArrowRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
        <div className="rounded-2xl bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700">
          {record.target_role ?? "—"}
        </div>
      </div>

      {/* Readiness */}
      <div className="mt-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-600">Readiness</span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-black text-slate-950">{Number(record.readiness_pct).toFixed(0)}%</span>
            <Badge label={label} cls={cls} />
          </div>
        </div>
        <ReadinessBar pct={Number(record.readiness_pct)} />
      </div>

      {/* Meta */}
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        {record.target_timeline && (
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="font-semibold text-slate-500">Target Date</p>
            <p className="mt-0.5 font-mono text-slate-700">{record.target_timeline.slice(0, 10)}</p>
          </div>
        )}
        {record.skills_gap && (
          <div className="rounded-xl bg-slate-50 p-3 col-span-2">
            <p className="font-semibold text-slate-500">Skills Gap</p>
            <p className="mt-0.5 text-slate-700">{record.skills_gap}</p>
          </div>
        )}
        {record.notes && (
          <div className="rounded-xl bg-slate-50 p-3 col-span-2">
            <p className="font-semibold text-slate-500">Notes</p>
            <p className="mt-0.5 text-slate-700">{record.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditCareerModal({
  employeeId,
  initial,
  onClose,
  onSaved,
}: {
  employeeId: string;
  initial: CareerPathForm;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CareerPathForm>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    const pct = Number(form.readiness_pct);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      return setError("Readiness must be 0–100.");
    }
    setSaving(true);
    try {
      await hrmsApi.post(`/api/career/career/${employeeId}`, {
        current_role: form.current_role || null,
        target_role: form.target_role || null,
        target_timeline: form.target_timeline || null,
        readiness_pct: pct,
        skills_gap: form.skills_gap || null,
        notes: form.notes || null,
      });
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const field = (
    label: string,
    key: keyof CareerPathForm,
    type: string = "text",
    placeholder: string = ""
  ) => (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        placeholder={placeholder}
        className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-6">
          <h2 className="text-lg font-black text-slate-950">Edit Career Path</h2>
          <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-6">
          {error && (
            <div className="flex items-center gap-2 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {field("Current Role", "current_role", "text", "e.g. Junior Analyst")}
            {field("Target Role", "target_role", "text", "e.g. Senior Analyst")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("Target Timeline", "target_timeline", "date")}
            {field("Readiness %", "readiness_pct", "number", "0–100")}
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Skills Gap</label>
            <textarea
              value={form.skills_gap}
              onChange={(e) => setForm({ ...form, skills_gap: e.target.value })}
              placeholder="Describe skill gaps…"
              rows={2}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Additional notes…"
              rows={2}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
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
            onClick={save}
            disabled={saving}
            className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Career Paths ────────────────────────────────────────────────────────

function CareerPathsTab() {
  const [search, setSearch] = useState("");
  const [searchId, setSearchId] = useState("");
  const [record, setRecord] = useState<CareerPath | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editTarget, setEditTarget] = useState<CareerPath | null>(null);

  const lookup = async () => {
    const id = search.trim();
    if (!id) return;
    setSearchId(id);
    setLoading(true);
    setError("");
    setRecord(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: CareerPath | null }>(
        `/api/career/career/${id}`
      );
      setRecord(res.data);
      if (!res.data) setError("No career path found for this employee.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    if (!searchId) return;
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: CareerPath | null }>(
        `/api/career/career/${searchId}`
      );
      setRecord(res.data);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (r: CareerPath) => {
    setEditTarget(r);
  };

  const blankForm = (): CareerPathForm => ({
    current_role: record?.current_role ?? "",
    target_role: record?.target_role ?? "",
    target_timeline: record?.target_timeline?.slice(0, 10) ?? "",
    readiness_pct: String(record?.readiness_pct ?? 0),
    skills_gap: record?.skills_gap ?? "",
    notes: record?.notes ?? "",
  });

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border bg-white p-4 shadow-sm">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void lookup()}
              placeholder="Enter employee UUID…"
              className="h-11 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400 transition-colors"
            />
          </div>
          <button
            onClick={() => void lookup()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            {loading ? <Loader className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Lookup
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      )}

      {!loading && record && (
        <CareerCard record={record} onEdit={handleEdit} />
      )}

      {/* Edit modal */}
      {editTarget && (
        <EditCareerModal
          employeeId={editTarget.employee_id}
          initial={blankForm()}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            void refresh();
          }}
        />
      )}

      {/* New career path for an employee with no existing record */}
      {!loading && searchId && !record && !error && (
        <div className="rounded-3xl border bg-white p-6 shadow-sm text-center text-slate-400">
          <Briefcase className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="font-semibold">No career path on record.</p>
          <button
            onClick={() =>
              setEditTarget({
                id: "",
                employee_id: searchId,
                current_role: null,
                target_role: null,
                target_timeline: null,
                readiness_pct: 0,
                skills_gap: null,
                notes: null,
                reviewed_by: null,
                created_at: "",
                updated_at: "",
              })
            }
            className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Create Career Path
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Succession Overview ─────────────────────────────────────────────────

function SuccessionTab() {
  const [records, setRecords] = useState<CareerPath[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: CareerPath[] }>(
        "/api/career/succession"
      );
      setRecords(res.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load succession data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{records.length} employees with career paths</p>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : records.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <TrendingUp className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No succession data available.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Employee", "Current Role", "Target Role", "Readiness", "Status", "Target Date"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const { label, cls } = readinessBadge(Number(r.readiness_pct));
                  return (
                    <tr key={r.id} className="border-t hover:bg-slate-50/80 transition-colors">
                      <td className="p-4">
                        <div className="font-bold text-slate-950">{r.employee_name ?? r.employee_id}</div>
                        {r.employee_code && (
                          <div className="font-mono text-xs text-slate-400">{r.employee_code}</div>
                        )}
                      </td>
                      <td className="p-4 text-slate-700">{r.current_role ?? "—"}</td>
                      <td className="p-4 text-slate-700">{r.target_role ?? "—"}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span className="w-10 text-right font-mono text-xs font-bold text-slate-700">
                            {Number(r.readiness_pct).toFixed(0)}%
                          </span>
                          <div className="h-2 w-24 rounded-full bg-slate-100">
                            <div
                              className={`h-2 rounded-full ${Number(r.readiness_pct) >= 80 ? "bg-emerald-500" : Number(r.readiness_pct) >= 50 ? "bg-amber-400" : "bg-red-400"}`}
                              style={{ width: `${Math.min(Number(r.readiness_pct), 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <Badge label={label} cls={cls} />
                      </td>
                      <td className="p-4 font-mono text-xs text-slate-500">
                        {r.target_timeline ? r.target_timeline.slice(0, 10) : "—"}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = ["Career Paths", "Succession Overview"] as const;
type Tab = (typeof TABS)[number];

export default function NativeCareerPlanning() {
  const [tab, setTab] = useState<Tab>("Career Paths");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Talent</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Career Planning</h1>
          <p className="mt-2 max-w-4xl text-slate-600">
            Track employee career paths, readiness for promotion, and succession pipeline.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
                tab === t ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "Career Paths" && <CareerPathsTab />}
        {tab === "Succession Overview" && <SuccessionTab />}
      </div>
    </DashboardLayout>
  );
}
