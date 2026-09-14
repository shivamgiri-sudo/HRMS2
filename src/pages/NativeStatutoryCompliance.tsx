import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, Copy,
  Download, Loader, Plus, RefreshCcw, Search, Shield, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type UanRecord = {
  id: string;
  employee_id: string;
  uan: string;
  member_id: string | null;
  epf_join_date: string | null;
  eps_eligible: number;
  is_active: number;
};

type EmployeeUanRow = {
  employee_id: string;
  employee_code: string;
  first_name: string;
  last_name: string | null;
  uan: string | null;
};

type PayrollRun = {
  id: string;
  run_month: string;
  status: string;
};

type EcrLine = {
  uan: string | null;
  member_id: string | null;
  member_name: string;
  wages: number;
  epf_contribution: number;
  eps_contribution: number;
};

type EcrResponse = {
  success: boolean;
  run_id: string;
  /** The run's payroll month (YYYY-MM). Returned by the API; used to name the export. */
  month?: string;
  data: EcrLine[];
};

type EsicLine = {
  employee_code: string;
  employee_name: string;
  wages: number;
  employee_contribution: number;
  employer_contribution: number;
};

type EsicResponse = {
  success: boolean;
  run_id: string;
  period: string;
  employee_count: number;
  total_wages: number;
  employee_total: number;
  employer_total: number;
  data: EsicLine[];
};

type MinWage = {
  id: string;
  state_code: string;
  category: string;
  daily_rate: number;
  monthly_rate: number;
  effective_from: string;
};

// ─── Constants ───────────────────────────────────────────────────────────────

// State list for the Minimum Wages state selector. Previously named PT_STATES and
// shared with the (now-removed) Professional Tax Slabs tab; kept here — renamed and
// scoped to this unrelated use — since Minimum Wages still needs a state picker.
const INDIA_STATES = [
  { code: "AP", name: "Andhra Pradesh" },
  { code: "AS", name: "Assam" },
  { code: "BR", name: "Bihar" },
  { code: "CG", name: "Chhattisgarh" },
  { code: "DL", name: "Delhi" },
  { code: "GA", name: "Goa" },
  { code: "GJ", name: "Gujarat" },
  { code: "JH", name: "Jharkhand" },
  { code: "KA", name: "Karnataka" },
  { code: "KL", name: "Kerala" },
  { code: "MH", name: "Maharashtra" },
  { code: "MP", name: "Madhya Pradesh" },
  { code: "MN", name: "Manipur" },
  { code: "ML", name: "Meghalaya" },
  { code: "MZ", name: "Mizoram" },
  { code: "OR", name: "Odisha" },
  { code: "PB", name: "Punjab" },
  { code: "RJ", name: "Rajasthan" },
  { code: "SK", name: "Sikkim" },
  { code: "TN", name: "Tamil Nadu" },
  { code: "TS", name: "Telangana" },
  { code: "TR", name: "Tripura" },
  { code: "UP", name: "Uttar Pradesh" },
  { code: "WB", name: "West Bengal" },
];

const TABS = ["PF / UAN", "ECR / ESIC", "Min Wages"] as const;
type Tab = typeof TABS[number];

// ─── Shared helpers ──────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return formatISTDate(d);
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

/**
 * A CSV cell, quoted and escaped.
 *
 * The ECR and ESIC "Copy CSV" buttons joined raw values with commas, so any
 * employee whose name contains a comma — "SINGH, RAJIV", and legacy imports are
 * full of them — silently split into an extra column and shifted every figure
 * after it one place left. A wages column landing under "EPF Contribution" is
 * not a display bug on a document that gets filed.
 *
 * Same escaper the biometric punch-log export already uses, rather than a
 * second local copy with different rules.
 */
function csvCell(value: string | number | null | undefined): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/**
 * Save `rows` as a CSV file.
 *
 * These two statutory documents could only ever be COPIED to the clipboard —
 * there was no download on the screen at all, so producing the ESIC challan as
 * a file meant pasting into a spreadsheet by hand and hoping the paste landed
 * in the right columns. A challan is a filing document; it needs to exist as a
 * file.
 *
 * Blob + anchor rather than a backend endpoint: the data is already in the
 * browser from the generate call, so a second round trip would only add a way
 * for the file to disagree with the table the user is looking at.
 */
function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const csv = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
  // The BOM is what makes Excel read the file as UTF-8. Without it "₹" and any
  // non-ASCII name render as mojibake on the machines these are opened on.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ─── UAN Tab ─────────────────────────────────────────────────────────────────

function UanTab() {
  const [employees, setEmployees] = useState<EmployeeUanRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [uanRecord, setUanRecord] = useState<UanRecord | null>(null);
  const [form, setForm] = useState({ uan: "", member_id: "", epf_join_date: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: EmployeeUanRow[] }>(
        "/api/employees?limit=200&fields=id,employee_code,first_name,last_name"
      );
      setEmployees(res.data ?? []);
    } catch (err: any) {
      setMessage(err?.message || "Failed to load employees");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const openModal = async (empId: string) => {
    setSelectedEmpId(empId);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: UanRecord | null }>(
        `/api/payroll/uan/${empId}`
      );
      const rec = res.data;
      setUanRecord(rec);
      setForm({
        uan: rec?.uan ?? "",
        member_id: rec?.member_id ?? "",
        epf_join_date: rec?.epf_join_date ?? "",
      });
    } catch {
      setUanRecord(null);
      setForm({ uan: "", member_id: "", epf_join_date: "" });
    }
    setShowModal(true);
  };

  const saveUan = async () => {
    if (!form.uan.trim()) return setMessage("UAN is required");
    setSaving(true);
    setMessage("");
    try {
      await hrmsApi.post(`/api/payroll/uan/${selectedEmpId}`, {
        uan: form.uan.trim(),
        member_id: form.member_id || null,
        epf_join_date: form.epf_join_date || null,
      });
      setMessage("UAN updated successfully.");
      setShowModal(false);
      await load();
    } catch (err: any) {
      setMessage(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const filtered = employees.filter((e) => {
    const q = search.toLowerCase();
    return (
      e.employee_code?.toLowerCase().includes(q) ||
      e.first_name?.toLowerCase().includes(q) ||
      (e.last_name ?? "").toLowerCase().includes(q) ||
      (e.uan ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-700">{message}</div>
      )}

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search employees…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={load}
          className="rounded-xl border border-slate-200 p-2 hover:bg-slate-50"
        >
          <RefreshCcw className="h-4 w-4 text-slate-500" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["Code", "Name", "UAN", "Member ID", "EPF Join", "Action"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((emp) => (
                <tr key={emp.employee_id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{emp.employee_code}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {emp.first_name} {emp.last_name ?? ""}
                  </td>
                  <td className="px-4 py-3">
                    {emp.uan ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" /> {emp.uan}
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-600">
                        Not linked
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{emp.uan ? "—" : "—"}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">—</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openModal(emp.employee_id)}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      {emp.uan ? "Update" : "Link UAN"}
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">
                    No employees found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* UAN Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">
                {uanRecord ? "Update UAN" : "Link UAN"}
              </h3>
              <button onClick={() => setShowModal(false)}>
                <X className="h-5 w-5 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            {uanRecord && (
              <div className="mb-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
                <div><span className="font-semibold">Current UAN:</span> {uanRecord.uan}</div>
                <div><span className="font-semibold">EPF Join:</span> {fmtDate(uanRecord.epf_join_date)}</div>
                <div><span className="font-semibold">EPS Eligible:</span> {uanRecord.eps_eligible ? "Yes" : "No"}</div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">UAN *</label>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="12-digit UAN"
                  value={form.uan}
                  onChange={(e) => setForm((f) => ({ ...f, uan: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Member ID</label>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Employer PF member ID"
                  value={form.member_id}
                  onChange={(e) => setForm((f) => ({ ...f, member_id: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">EPF Join Date</label>
                <input
                  type="date"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.epf_join_date}
                  onChange={(e) => setForm((f) => ({ ...f, epf_join_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={saveUan}
                disabled={saving}
                className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ECR / ESIC Tab ───────────────────────────────────────────────────────────

function EcrEsicTab() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [selectedRun, setSelectedRun] = useState("");
  const [ecrData, setEcrData] = useState<EcrResponse | null>(null);
  const [esicData, setEsicData] = useState<EsicResponse | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingEcr, setLoadingEcr] = useState(false);
  const [loadingEsic, setLoadingEsic] = useState(false);
  const [message, setMessage] = useState("");
  const [view, setView] = useState<"none" | "ecr" | "esic">("none");

  useEffect(() => {
    setLoadingRuns(true);
    hrmsApi
      .get<{ success: boolean; data: PayrollRun[] }>("/api/payroll/runs?limit=50")
      .then((r) => setRuns(r.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingRuns(false));
  }, []);

  const generateEcr = async () => {
    if (!selectedRun) return setMessage("Select a run first");
    setLoadingEcr(true);
    setMessage("");
    setView("none");
    try {
      const res = await hrmsApi.get<EcrResponse>(`/api/payroll/runs/${selectedRun}/ecr`);
      setEcrData(res);
      setView("ecr");
    } catch (err: any) {
      setMessage(err?.message || "ECR generation failed");
    } finally {
      setLoadingEcr(false);
    }
  };

  const generateEsic = async () => {
    if (!selectedRun) return setMessage("Select a run first");
    setLoadingEsic(true);
    setMessage("");
    setView("none");
    try {
      const res = await hrmsApi.get<EsicResponse>(`/api/payroll/runs/${selectedRun}/esic-challan`);
      setEsicData(res);
      setView("esic");
    } catch (err: any) {
      setMessage(err?.message || "ESIC challan failed");
    } finally {
      setLoadingEsic(false);
    }
  };

  // One definition of each document's shape, used by both Copy and Download, so
  // the file and the clipboard can never disagree about columns or ordering.
  const ECR_HEADERS = ["UAN", "Member Name", "Wages", "EPF Contribution", "EPS Contribution"];
  const ecrRows = () =>
    (ecrData?.data ?? []).map((r) => [r.uan ?? "", r.member_name, r.wages, r.epf_contribution, r.eps_contribution]);

  const ESIC_HEADERS = ["Employee Code", "Employee Name", "Wages", "Employee Contribution", "Employer Contribution"];
  const esicRows = () =>
    (esicData?.data ?? []).map((r) => [
      r.employee_code, r.employee_name, r.wages, r.employee_contribution, r.employer_contribution,
    ]);

  const toCsv = (headers: string[], rows: (string | number | null | undefined)[][]) =>
    [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");

  const copyEcrCsv = () => { if (ecrData) copyText(toCsv(ECR_HEADERS, ecrRows())); };
  const copyEsicCsv = () => { if (esicData) copyText(toCsv(ESIC_HEADERS, esicRows())); };

  const downloadEcrCsv = () => {
    if (!ecrData) return;
    downloadCsv(`ECR-${ecrData.month ?? "run"}.csv`, ECR_HEADERS, ecrRows());
  };

  const downloadEsicCsv = () => {
    if (!esicData) return;
    downloadCsv(`ESIC-Challan-${esicData.period ?? "run"}.csv`, ESIC_HEADERS, esicRows());
  };

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            value={selectedRun}
            onChange={(e) => { setSelectedRun(e.target.value); setView("none"); }}
            disabled={loadingRuns}
            className="appearance-none rounded-xl border border-slate-200 pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
          >
            <option value="">Select payroll run…</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.run_month} — {r.status}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        </div>

        <button
          onClick={generateEcr}
          disabled={!selectedRun || loadingEcr}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {loadingEcr && <Loader className="h-3.5 w-3.5 animate-spin" />}
          Generate ECR
        </button>

        <button
          onClick={generateEsic}
          disabled={!selectedRun || loadingEsic}
          className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2"
        >
          {loadingEsic && <Loader className="h-3.5 w-3.5 animate-spin" />}
          ESIC Challan
        </button>
      </div>

      {/* ECR Table */}
      {view === "ecr" && ecrData && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-slate-700">ECR — {ecrData.data.length} employees</h4>
            <div className="flex items-center gap-2">
              <button
                onClick={copyEcrCsv}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                <Copy className="h-3.5 w-3.5" /> Copy CSV
              </button>
              <button
                onClick={downloadEcrCsv}
                className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Download className="h-3.5 w-3.5" /> Download CSV
              </button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {["UAN", "Member Name", "Wages", "EPF Contribution", "EPS Contribution"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ecrData.data.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.uan ?? <span className="text-amber-500">No UAN</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-800">{row.member_name}</td>
                    <td className="px-4 py-3 text-right">₹{fmt(row.wages)}</td>
                    <td className="px-4 py-3 text-right text-blue-700">₹{fmt(row.epf_contribution)}</td>
                    <td className="px-4 py-3 text-right text-violet-700">₹{fmt(row.eps_contribution)}</td>
                  </tr>
                ))}
                {ecrData.data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">
                      No data. Run must be calculated first.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ESIC Table */}
      {view === "esic" && esicData && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-slate-700">ESIC Challan — {esicData.period}</h4>
            <div className="flex items-center gap-2">
              <button
                onClick={copyEsicCsv}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                <Copy className="h-3.5 w-3.5" /> Copy CSV
              </button>
              <button
                onClick={downloadEsicCsv}
                className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
              >
                <Download className="h-3.5 w-3.5" /> Download CSV
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Employees", value: esicData.employee_count },
              { label: "Total Wages", value: `₹${fmt(esicData.total_wages)}` },
              { label: "Employee Contribution", value: `₹${fmt(esicData.employee_total)}` },
              { label: "Employer Contribution", value: `₹${fmt(esicData.employer_total)}` },
            ].map((card) => (
              <div key={card.label} className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                <p className="text-xs font-semibold text-slate-500">{card.label}</p>
                <p className="mt-1 text-lg font-black text-slate-800">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {["Code", "Employee Name", "Wages", "Emp. Contribution", "Employer Contribution"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {esicData.data.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.employee_code}</td>
                    <td className="px-4 py-3 text-slate-800">{row.employee_name}</td>
                    <td className="px-4 py-3 text-right">₹{fmt(row.wages)}</td>
                    <td className="px-4 py-3 text-right text-blue-700">₹{fmt(row.employee_contribution)}</td>
                    <td className="px-4 py-3 text-right text-violet-700">₹{fmt(row.employer_contribution)}</td>
                  </tr>
                ))}
                {esicData.data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">
                      No ESIC data for this run.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Min Wages Tab ────────────────────────────────────────────────────────────

function MinWagesTab() {
  const [wages, setWages] = useState<MinWage[]>([]);
  const [selectedState, setSelectedState] = useState("MH");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = async (state: string) => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: MinWage[] }>(
        `/api/payroll/minimum-wages?state_code=${state}`
      );
      setWages(res.data ?? []);
    } catch (err: any) {
      setMessage(err?.message || "Failed to load minimum wages");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(selectedState); }, [selectedState]);

  const CATEGORY_LABELS: Record<string, string> = {
    unskilled: "Unskilled",
    semi_skilled: "Semi-Skilled",
    skilled: "Skilled",
    highly_skilled: "Highly Skilled",
  };

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>
      )}

      <div className="flex items-center gap-3">
        <label className="text-sm font-semibold text-slate-600">State:</label>
        <div className="relative">
          <select
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value)}
            className="appearance-none rounded-xl border border-slate-200 pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {INDIA_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        </div>
      </div>

      {wages.length === 0 && !loading && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-amber-700">
            No minimum wage data for this state yet. Seed data can be added via{" "}
            <code className="font-mono text-xs">minimum_wage_master</code>.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : wages.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["Category", "Daily Rate", "Monthly Rate", "Effective From"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {wages.map((w) => (
                <tr key={w.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-semibold text-slate-700">
                    {CATEGORY_LABELS[w.category] ?? w.category}
                  </td>
                  <td className="px-4 py-3 text-slate-700">₹{fmt(w.daily_rate)}</td>
                  <td className="px-4 py-3 text-slate-700">₹{fmt(w.monthly_rate)}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(w.effective_from)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="text-xs text-slate-400">
        To check compliance, compare employee CTC / 26 against the daily rate for their skill category.
        Employees below minimum wage should be flagged in HR review.
      </p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NativeStatutoryCompliance() {
  const [activeTab, setActiveTab] = useState<Tab>("PF / UAN");

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50 p-6">
        {/* Header */}
        <div className="mb-6 flex items-start gap-4">
          <div className="rounded-2xl bg-blue-600 p-3">
            <Shield className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">
              Statutory Compliance
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              PF / UAN management, ECR generation, ESIC challans, and minimum wages.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 rounded-2xl bg-white p-1 shadow-sm border border-slate-200 w-fit">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                activeTab === tab
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="glass-card rounded-3xl bg-white border border-slate-200 p-6 shadow-sm">
          {activeTab === "PF / UAN"  && <UanTab />}
          {activeTab === "ECR / ESIC" && <EcrEsicTab />}
          {activeTab === "Min Wages" && <MinWagesTab />}
        </div>
      </div>
    </DashboardLayout>
  );
}
