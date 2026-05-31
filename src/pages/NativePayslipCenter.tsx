import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Download, Eye, FileText,
  Loader, RefreshCcw, Users, X, BookOpen,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type PayrollRun = {
  id: string;
  month: number;
  year: number;
  status: string;
  total_employees?: number;
  total_gross?: number;
  total_net?: number;
};

type PayrollLine = {
  employee_id: string;
  employee_name: string;
  employee_code?: string;
  gross_pay: number;
  net_pay: number;
  pf_employee: number;
  esic_employee: number;
  pt_amount: number;
  total_deductions: number;
  payslip_id?: string;
  payslip_status?: string;
};

type Payslip = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code?: string;
  designation?: string;
  department?: string;
  month: number;
  year: number;
  basic: number;
  hra: number;
  other_allowances: number;
  gross_pay: number;
  pf_employee: number;
  esic_employee: number;
  pt_amount: number;
  lwp_deduction?: number;
  advance_recovery?: number;
  tds_amount?: number;
  total_deductions: number;
  net_pay: number;
  acknowledged_at?: string | null;
  status?: string;
};

type Form16Data = {
  financial_year: string;
  period: string;
  employee: { name: string; pan: string | null; designation: string | null; period: string };
  gross_salary: number;
  standard_deduction: number;
  tds_deducted: number;
  net_taxable_income: number;
  declaration: {
    hra: number;
    "80c": number;
    "80d": number;
    regime: string;
  } | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v ?? 0);

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const PAYSLIP_STATUS_COLORS: Record<string, string> = {
  generated: "bg-blue-50 text-blue-700",
  acknowledged: "bg-emerald-50 text-emerald-700",
  sent: "bg-violet-50 text-violet-700",
};

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${cls}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

function StatCard({
  title, value, icon, tone,
}: {
  title: string; value: string | number; icon: React.ReactNode; tone: string;
}) {
  return (
    <div className="glass-card stat-card rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-slate-950">{value}</p>
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

// ─── Payslip Modal ─────────────────────────────────────────────────────────────

function Form16Modal({ data, onClose }: { data: Form16Data; onClose: () => void }) {
  const rows: [string, string][] = [
    ["Financial Year", data.financial_year],
    ["Employee", data.employee.name],
    ["PAN", data.employee.pan ?? "N/A"],
    ["Designation", data.employee.designation ?? "N/A"],
    ["Period", data.employee.period],
    ["Gross Salary (monthly)", INR(data.gross_salary)],
    ["Standard Deduction", INR(data.standard_deduction)],
    ["TDS Deducted (monthly)", INR(data.tds_deducted)],
    ["Net Taxable Income (annual)", INR(data.net_taxable_income)],
  ];
  if (data.declaration) {
    rows.push(
      ["Regime", data.declaration.regime.toUpperCase()],
      ["Declared HRA", INR(data.declaration.hra)],
      ["Declared 80C", INR(data.declaration["80c"])],
      ["Declared 80D", INR(data.declaration["80d"])],
    );
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-6">
          <div>
            <h2 className="text-lg font-black text-slate-950">Form 16 Part B Data</h2>
            <p className="text-sm text-slate-500">{data.period}</p>
          </div>
          <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6">
          <table className="w-full text-sm">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label} className="border-b last:border-0">
                  <td className="py-2.5 text-slate-500 font-semibold w-1/2">{label}</td>
                  <td className="py-2.5 font-mono font-semibold text-slate-900 text-right">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t p-6">
          <button
            onClick={onClose}
            className="w-full cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function PayslipModal({
  payslip,
  runId,
  onClose,
  onAcknowledge,
  acknowledging,
}: {
  payslip: Payslip;
  runId: string;
  onClose: () => void;
  onAcknowledge: (id: string) => void;
  acknowledging: boolean;
}) {
  const [form16Data, setForm16Data] = useState<Form16Data | null>(null);
  const [loadingForm16, setLoadingForm16] = useState(false);
  const [form16Error, setForm16Error] = useState("");

  const fetchForm16 = async () => {
    setLoadingForm16(true);
    setForm16Error("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Form16Data }>(
        `/api/payroll/form16-data/${runId}/${payslip.employee_id}`
      );
      setForm16Data(res.data);
    } catch (err: unknown) {
      const e = err as Error;
      setForm16Error(e.message || "Failed to load Form 16 data.");
    } finally {
      setLoadingForm16(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b p-6">
          <div>
            <h2 className="text-lg font-black text-slate-950">Payslip</h2>
            <p className="text-sm text-slate-500">
              {MONTH_NAMES[payslip.month]} {payslip.year}
            </p>
          </div>
          <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Employee Details */}
          <div className="rounded-2xl bg-slate-50 p-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Employee</p>
              <p className="font-bold text-slate-950 mt-1">{payslip.employee_name}</p>
            </div>
            {payslip.employee_code && (
              <div>
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Code</p>
                <p className="font-mono font-semibold text-slate-700 mt-1">{payslip.employee_code}</p>
              </div>
            )}
            {payslip.designation && (
              <div>
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Designation</p>
                <p className="font-semibold text-slate-700 mt-1">{payslip.designation}</p>
              </div>
            )}
            {payslip.department && (
              <div>
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Department</p>
                <p className="font-semibold text-slate-700 mt-1">{payslip.department}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Pay Period</p>
              <p className="font-semibold text-slate-700 mt-1">{MONTH_NAMES[payslip.month]} {payslip.year}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Status</p>
              <p className="font-semibold text-slate-700 mt-1 capitalize">
                {payslip.acknowledged_at ? "Acknowledged" : payslip.status ?? "Generated"}
              </p>
            </div>
          </div>

          {/* Earnings Table */}
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-700 mb-3">Earnings</h3>
            <table className="w-full text-sm">
              <tbody>
                {[
                  ["Basic", payslip.basic],
                  ["HRA", payslip.hra],
                  ["Other Allowances", payslip.other_allowances],
                ].map(([label, amount]) => (
                  <tr key={label as string} className="border-b last:border-0">
                    <td className="py-2.5 text-slate-600">{label}</td>
                    <td className="py-2.5 text-right font-mono font-semibold text-slate-800">
                      {INR(amount as number)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-emerald-50">
                  <td className="py-3 px-2 font-black text-emerald-800 rounded-l-xl">Gross Pay</td>
                  <td className="py-3 px-2 text-right font-black font-mono text-emerald-800 rounded-r-xl">
                    {INR(payslip.gross_pay)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Deductions Table */}
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-700 mb-3">Deductions</h3>
            <table className="w-full text-sm">
              <tbody>
                {[
                  ["PF (Employee)", payslip.pf_employee],
                  ["ESIC (Employee)", payslip.esic_employee],
                  ["Professional Tax", payslip.pt_amount],
                  ...(payslip.tds_amount ? [["TDS (Income Tax)", payslip.tds_amount]] : []),
                  ...(payslip.lwp_deduction ? [["LWP Deduction", payslip.lwp_deduction]] : []),
                  ...(payslip.advance_recovery ? [["Advance Recovery", payslip.advance_recovery]] : []),
                ].map(([label, amount]) => (
                  <tr key={label as string} className="border-b last:border-0">
                    <td className="py-2.5 text-slate-600">{label}</td>
                    <td className="py-2.5 text-right font-mono font-semibold text-rose-700">
                      – {INR(amount as number)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-rose-50">
                  <td className="py-3 px-2 font-black text-rose-800 rounded-l-xl">Total Deductions</td>
                  <td className="py-3 px-2 text-right font-black font-mono text-rose-800 rounded-r-xl">
                    – {INR(payslip.total_deductions)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Net Pay */}
          <div className="rounded-2xl bg-slate-950 p-5 flex items-center justify-between">
            <span className="text-base font-black text-white">Net Pay</span>
            <span className="text-2xl font-black font-mono text-white">{INR(payslip.net_pay)}</span>
          </div>
        </div>

        {/* Footer */}
        {form16Error && (
          <div className="mx-6 mb-2 text-xs font-semibold text-rose-600">{form16Error}</div>
        )}
        <div className="border-t p-6 flex gap-3 flex-wrap">
          <button
            onClick={onClose}
            className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => { void fetchForm16(); }}
            disabled={loadingForm16}
            className="flex-1 cursor-pointer rounded-2xl border border-violet-200 bg-violet-50 py-3 text-sm font-bold text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loadingForm16 ? (
              <Loader className="h-4 w-4 animate-spin" />
            ) : (
              <BookOpen className="h-4 w-4" />
            )}
            Form 16 Data
          </button>
          {!payslip.acknowledged_at && (
            <button
              onClick={() => onAcknowledge(payslip.id)}
              disabled={acknowledging}
              className="flex-1 cursor-pointer rounded-2xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {acknowledging ? (
                <Loader className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Acknowledge Receipt
            </button>
          )}
        </div>
      </div>

      {form16Data && (
        <Form16Modal data={form16Data} onClose={() => setForm16Data(null)} />
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function NativePayslipCenter() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [lines, setLines] = useState<PayrollLine[]>([]);
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);

  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingLines, setLoadingLines] = useState(false);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);

  const [viewPayslip, setViewPayslip] = useState<Payslip | null>(null);
  const [loadingPayslip, setLoadingPayslip] = useState<string | null>(null);

  const [message, setMessage] = useState("");

  // ── Load runs ───────────────────────────────────────────────────────────────
  const loadRuns = async () => {
    setLoadingRuns(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: PayrollRun[] }>("/api/payroll/runs");
      const list = res.data ?? [];
      setRuns(list);
      if (list.length > 0 && !selectedRunId) {
        setSelectedRunId(list[0].id);
        setSelectedRun(list[0]);
      }
    } catch (err: unknown) {
      const e = err as Error;
      setMessage(e.message || "Failed to load payroll runs.");
    } finally {
      setLoadingRuns(false);
    }
  };

  // ── Load lines for selected run ─────────────────────────────────────────────
  const loadLines = async (runId: string) => {
    if (!runId) return;
    setLoadingLines(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: PayrollLine[] }>(
        `/api/payroll/runs/${runId}/lines`
      );
      setLines(res.data ?? []);
    } catch (err: unknown) {
      const e = err as Error;
      setMessage(e.message || "Failed to load payroll lines.");
    } finally {
      setLoadingLines(false);
    }
  };

  useEffect(() => { void loadRuns(); }, []);

  useEffect(() => {
    if (selectedRunId) {
      const run = runs.find((r) => r.id === selectedRunId) ?? null;
      setSelectedRun(run);
      void loadLines(selectedRunId);
    }
  }, [selectedRunId]);

  // ── Generate payslip ────────────────────────────────────────────────────────
  const generatePayslip = async (employeeId: string) => {
    if (!selectedRunId) return;
    setGeneratingFor(employeeId);
    setMessage("");
    try {
      await hrmsApi.post(`/api/payroll/payslip/${selectedRunId}/generate`, { employeeId });
      setMessage("Payslip generated successfully.");
      await loadLines(selectedRunId);
    } catch (err: unknown) {
      const e = err as Error;
      setMessage(e.message || "Failed to generate payslip.");
    } finally {
      setGeneratingFor(null);
    }
  };

  // ── View payslip ────────────────────────────────────────────────────────────
  const viewPayslipFor = async (employeeId: string) => {
    if (!selectedRunId) return;
    setLoadingPayslip(employeeId);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Payslip }>(
        `/api/payroll/payslip/${selectedRunId}/${employeeId}`
      );
      setViewPayslip(res.data);
    } catch (err: unknown) {
      const e = err as Error;
      setMessage(e.message || "Failed to load payslip.");
    } finally {
      setLoadingPayslip(null);
    }
  };

  // ── Acknowledge ─────────────────────────────────────────────────────────────
  const acknowledgePayslip = async (payslipId: string) => {
    setAcknowledging(true);
    try {
      await hrmsApi.post(`/api/payroll/payslip/${payslipId}/acknowledge`, {});
      setMessage("Payslip acknowledged.");
      setViewPayslip((prev) => prev ? { ...prev, acknowledged_at: new Date().toISOString() } : prev);
      await loadLines(selectedRunId);
    } catch (err: unknown) {
      const e = err as Error;
      setMessage(e.message || "Acknowledgement failed.");
    } finally {
      setAcknowledging(false);
    }
  };

  // ── Summary stats ────────────────────────────────────────────────────────────
  const totalEmployees = lines.length;
  const totalGross = lines.reduce((s, l) => s + (l.gross_pay ?? 0), 0);
  const totalNet = lines.reduce((s, l) => s + (l.net_pay ?? 0), 0);
  const acknowledgedCount = lines.filter((l) => l.payslip_status === "acknowledged").length;

  const canGenerate = selectedRun
    ? ["locked", "disbursed"].includes(selectedRun.status)
    : false;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Payroll</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Payslip Center</h1>
            <p className="mt-2 max-w-4xl text-slate-600">
              Generate, view, and distribute payslips for each payroll run.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { void loadRuns(); if (selectedRunId) void loadLines(selectedRunId); }}
              disabled={loadingRuns}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {message}
          </div>
        )}

        {/* Run Selector */}
        <div className="rounded-3xl border bg-white p-5 shadow-sm flex items-center gap-4">
          <label className="text-sm font-black text-slate-700 whitespace-nowrap">Payroll Run</label>
          {loadingRuns ? (
            <Loader className="h-5 w-5 animate-spin text-slate-400" />
          ) : (
            <select
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
              className="flex-1 max-w-sm rounded-2xl border px-4 py-2.5 text-sm font-semibold outline-none focus:border-blue-400 transition-colors bg-slate-50"
            >
              {runs.length === 0 && <option value="">No runs available</option>}
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {MONTH_NAMES[r.month]} {r.year} — {r.status}
                </option>
              ))}
            </select>
          )}
          {selectedRun && (
            <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
              selectedRun.status === "disbursed" ? "bg-emerald-50 text-emerald-700" :
              selectedRun.status === "locked" ? "bg-blue-50 text-blue-700" :
              "bg-slate-100 text-slate-600"
            }`}>
              {selectedRun.status}
            </span>
          )}
        </div>

        {/* Summary Stats */}
        {lines.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Total Employees"
              value={totalEmployees}
              icon={<Users className="h-5 w-5" />}
              tone="bg-slate-100 text-slate-700"
            />
            <StatCard
              title="Total Gross"
              value={INR(totalGross)}
              icon={<FileText className="h-5 w-5" />}
              tone="bg-blue-50 text-blue-700"
            />
            <StatCard
              title="Total Net"
              value={INR(totalNet)}
              icon={<Download className="h-5 w-5" />}
              tone="bg-emerald-50 text-emerald-700"
            />
            <StatCard
              title="Acknowledged"
              value={`${acknowledgedCount} / ${totalEmployees}`}
              icon={<CheckCircle2 className="h-5 w-5" />}
              tone="bg-violet-50 text-violet-700"
            />
          </div>
        )}

        {/* Lines Table */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">Payroll Lines</h2>
            <p className="text-sm text-slate-500">{lines.length} employees</p>
          </div>

          {loadingLines ? (
            <div className="flex items-center justify-center py-16">
              <Loader className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : lines.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <FileText className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="font-semibold">
                {selectedRunId ? "No lines found for this run." : "Select a payroll run to view lines."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    {["Employee", "Gross Pay", "Net Pay", "PF", "ESIC", "PT", "Deductions", "Payslip", "Actions"].map((h) => (
                      <th key={h} className="p-4 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.employee_id} className="border-t hover:bg-slate-50/80 transition-colors">
                      <td className="p-4">
                        <div className="font-bold text-slate-950">{line.employee_name}</div>
                        {line.employee_code && (
                          <div className="text-xs text-slate-500 font-mono">{line.employee_code}</div>
                        )}
                      </td>
                      <td className="p-4 font-mono font-semibold text-slate-800">{INR(line.gross_pay)}</td>
                      <td className="p-4 font-mono font-bold text-emerald-700">{INR(line.net_pay)}</td>
                      <td className="p-4 font-mono text-slate-600">{INR(line.pf_employee)}</td>
                      <td className="p-4 font-mono text-slate-600">{INR(line.esic_employee)}</td>
                      <td className="p-4 font-mono text-slate-600">{INR(line.pt_amount)}</td>
                      <td className="p-4 font-mono text-rose-600">– {INR(line.total_deductions)}</td>
                      <td className="p-4">
                        {line.payslip_id ? (
                          <Badge
                            label={line.payslip_status ?? "generated"}
                            cls={PAYSLIP_STATUS_COLORS[line.payslip_status ?? "generated"] ?? "bg-slate-100 text-slate-600"}
                          />
                        ) : (
                          <span className="text-xs text-slate-400 font-semibold">Not Generated</span>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="flex gap-2">
                          {!line.payslip_id && canGenerate && (
                            <button
                              onClick={() => generatePayslip(line.employee_id)}
                              disabled={generatingFor === line.employee_id}
                              className="cursor-pointer rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                            >
                              {generatingFor === line.employee_id ? (
                                <Loader className="h-3 w-3 animate-spin" />
                              ) : (
                                <FileText className="h-3 w-3" />
                              )}
                              Generate
                            </button>
                          )}
                          {line.payslip_id && (
                            <button
                              onClick={() => viewPayslipFor(line.employee_id)}
                              disabled={loadingPayslip === line.employee_id}
                              className="cursor-pointer rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                            >
                              {loadingPayslip === line.employee_id ? (
                                <Loader className="h-3 w-3 animate-spin" />
                              ) : (
                                <Eye className="h-3 w-3" />
                              )}
                              View
                            </button>
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
      </div>

      {/* Payslip Modal */}
      {viewPayslip && (
        <PayslipModal
          payslip={viewPayslip}
          runId={selectedRunId}
          onClose={() => setViewPayslip(null)}
          onAcknowledge={acknowledgePayslip}
          acknowledging={acknowledging}
        />
      )}
    </DashboardLayout>
  );
}
