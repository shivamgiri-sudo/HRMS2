import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Eye, FileText, Loader, RefreshCcw, Users, X, BookOpen, Search, ShieldAlert, Upload } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { RoleInsightsPanel } from "@/components/insights/RoleInsightsPanel";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { useDebounce } from "@/hooks/useAttendanceHub";
import { hrmsApi } from "@/lib/hrmsApi";
import { downloadMasCallnetPayslip } from "@/lib/masCallnetPayslipGeneratorV2";
import { numberToWords } from "@/lib/numberToWords";

type PayrollRun = { id: string; month: number; year: number; status: string; total_employees?: number; total_gross?: number; total_net?: number; };
type PayrollLine = { employee_id: string; employee_name: string; employee_code?: string; gross_pay: number; net_pay: number; pf_employee: number; esic_employee: number; pt_amount: number; total_deductions: number; payslip_id?: string; payslip_status?: string; };
type Payslip = { id: string; employee_id: string; employee_name: string; employee_code?: string; designation?: string; department?: string; month: number; year: number; basic: number; hra: number; other_allowances: number; gross_pay: number; ctc?: number; ctc_annual?: number; pf_employee: number; esic_employee: number; pt_amount: number; lwp_deduction?: number; advance_recovery?: number; tds_amount?: number; total_deductions: number; net_pay: number; working_days?: number; present_days?: number; epf_number?: string; esi_number?: string; branch_name?: string; location_name?: string; payslip_ref?: string; cheque_no?: string | null; payment_mode?: string | null; payment_date?: string | null; earnings?: PayslipComponent[]; deductions?: PayslipComponent[]; acknowledged_at?: string | null; status?: string; };
type PayslipComponent = { component_code: string; component_name: string; component_type: string; amount: number | string; };
type NeftSummary = { total: number; with_bank: number; missing_bank: number; total_net: number; };
type Form16Data = { financial_year: string; period: string; employee: { name: string; pan: string | null; designation: string | null; period: string }; gross_salary: number; standard_deduction: number; tds_deducted: number; net_taxable_income: number; declaration: { hra: number; "80c": number; "80d": number; regime: string; } | null; };

const INR = (v: number | null | undefined) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(typeof v === "number" && !isNaN(v) ? v : 0);
const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PAYSLIP_STATUS_COLORS: Record<string, string> = { generated: "bg-blue-50 text-blue-700", acknowledged: "bg-emerald-50 text-emerald-700", sent: "bg-violet-50 text-violet-700" };
function Badge({ label, cls }: { label: string; cls: string }) { return <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${cls}`}>{label.replace(/_/g, " ")}</span>; }
function StatCard({ title, value, icon, tone }: { title: string; value: string | number; icon: React.ReactNode; tone: string; }) { return <div className="glass-card stat-card rounded-3xl p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-slate-500">{title}</p><p className="mt-2 text-2xl font-black tracking-tight text-slate-950">{value}</p></div><div className={`rounded-2xl p-3 ${tone}`}>{icon}</div></div></div>; }
function expectedNet(line: PayrollLine) { return Number(line.gross_pay ?? 0) - Number(line.total_deductions ?? 0); }
function lineRisks(line: PayrollLine) { const risks: string[] = []; if (Number(line.gross_pay ?? 0) <= 0) risks.push("Zero gross"); if (Number(line.net_pay ?? 0) < 0) risks.push("Negative net"); if (Math.abs(expectedNet(line) - Number(line.net_pay ?? 0)) > 1) risks.push("Net mismatch"); if (!line.payslip_id) risks.push("Not generated"); if (line.payslip_id && line.payslip_status !== "acknowledged") risks.push("Not acknowledged"); return risks; }

async function downloadPayslipPdf(payslip: Payslip): Promise<void> {
  const earning = (code: string) => Number(payslip.earnings?.find((c) => c.component_code.toUpperCase() === code)?.amount ?? 0);
  const deduction = (code: string) => Number(payslip.deductions?.find((c) => c.component_code.toUpperCase() === code)?.amount ?? 0);
  const basic = earning("BASIC") || Number(payslip.basic ?? 0);
  const hra = earning("HRA") || Number(payslip.hra ?? 0);
  const bonus = earning("BONUS");
  const conv = earning("CONVEYANCE") || earning("CONV");
  const pa = earning("PA") || earning("PERSONAL_ALLOWANCE");
  const ma = earning("MA") || earning("MEDICAL_ALLOWANCE");
  const sa = earning("SPECIAL") || earning("SPECIAL_ALLOWANCE");
  const arrear = earning("ARREAR");
  const incentive = earning("INCENTIVE");
  const knownEarnings = basic + hra + bonus + conv + pa + ma + sa + arrear + incentive;
  const oa = Math.max(Number(payslip.gross_pay ?? 0) - knownEarnings, 0);
  const pf = deduction("PF_EMPLOYEE") || deduction("PF_EMP") || Number(payslip.pf_employee ?? 0);
  const esic = deduction("ESIC_EMPLOYEE") || deduction("ESIC_EMP") || Number(payslip.esic_employee ?? 0);
  const pt = deduction("PROFESSIONAL_TAX") || deduction("PT") || Number(payslip.pt_amount ?? 0);
  const tds = deduction("TDS") || Number(payslip.tds_amount ?? 0);
  const lwpDed = deduction("LWP_DEDUCTION") || Number(payslip.lwp_deduction ?? 0);
  const loan = deduction("LOAN") || deduction("LOAN_RECOVERY");
  const adDed = deduction("ADVANCE") || deduction("ADVANCE_RECOVERY") || Number(payslip.advance_recovery ?? 0);
  const knownDed = pf + esic + pt + tds + lwpDed + loan + adDed;
  const otherDed = Math.max(Number(payslip.total_deductions ?? 0) - knownDed, 0);
  await downloadMasCallnetPayslip({
    companyName: "Mas Callnet India Pvt Ltd",
    monthYear: `${MONTH_NAMES[payslip.month]} - ${payslip.year}`,
    empName: payslip.employee_name,
    empCode: payslip.employee_code ?? payslip.employee_id,
    designation: payslip.designation || "N/A",
    department: payslip.department || "N/A",
    epfNo: payslip.epf_number || "",
    esiNo: payslip.esi_number || "",
    location: payslip.branch_name || payslip.location_name || "N/A",
    wDays: Number(payslip.working_days ?? 0),
    earnedDays: Number(payslip.present_days ?? 0),
    lwpDays: Number(payslip.lwp_deduction ?? 0) > 0 ? Math.round((Number(payslip.working_days ?? 0) - Number(payslip.present_days ?? 0))) : 0,
    totalDaysInMonth: Number(payslip.working_days ?? 30),
    basic, hra, bonus, conv, pa, ma, sa, oa, arrear, incentive,
    pf, esic, pt, tds, lwpDeduction: lwpDed, loan, adDed, otherDed,
    grossSalary: Number(payslip.gross_pay ?? 0),
    incomeTax: tds,
    chequeNo: payslip.cheque_no || "",
    paymentMode: payslip.payment_mode || "",
    paymentDate: payslip.payment_date || "",
    netSalary: Number(payslip.net_pay ?? 0),
    netSalaryWords: numberToWords(Math.floor(Number(payslip.net_pay ?? 0))),
  }, `Payslip_${payslip.employee_code ?? payslip.employee_id}_${MONTH_NAMES[payslip.month]}_${payslip.year}.pdf`);
}

function Form16Modal({ data, onClose }: { data: Form16Data; onClose: () => void }) {
  const rows: [string, string][] = [["Financial Year", data.financial_year], ["Employee", data.employee.name], ["PAN", data.employee.pan ?? "N/A"], ["Designation", data.employee.designation ?? "N/A"], ["Period", data.employee.period], ["Gross Salary (monthly)", INR(data.gross_salary)], ["Standard Deduction", INR(data.standard_deduction)], ["TDS Deducted (monthly)", INR(data.tds_deducted)], ["Net Taxable Income (annual)", INR(data.net_taxable_income)]];
  if (data.declaration) rows.push(["Regime", data.declaration.regime.toUpperCase()], ["Declared HRA", INR(data.declaration.hra)], ["Declared 80C", INR(data.declaration["80c"])], ["Declared 80D", INR(data.declaration["80d"])]);
  return <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b p-6"><div><h2 className="text-lg font-black text-slate-950">Form 16 Part B Data</h2><p className="text-sm text-slate-500">{data.period}</p></div><button onClick={onClose} className="text-slate-400 transition-colors hover:text-slate-700"><X className="h-5 w-5" /></button></div><div className="p-6"><table className="w-full text-sm"><tbody>{rows.map(([label, value]) => <tr key={label} className="border-b last:border-0"><td className="w-1/2 py-2.5 font-semibold text-slate-500">{label}</td><td className="py-2.5 text-right font-mono font-semibold text-slate-900">{value}</td></tr>)}</tbody></table></div><div className="border-t p-6"><button onClick={onClose} className="w-full rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">Close</button></div></div></div>;
}

function PayslipModal({ payslip, runId, onClose, onAcknowledge, acknowledging }: { payslip: Payslip; runId: string; onClose: () => void; onAcknowledge: (id: string) => void; acknowledging: boolean; }) {
  const [form16Data, setForm16Data] = useState<Form16Data | null>(null);
  const [loadingForm16, setLoadingForm16] = useState(false);
  const [form16Error, setForm16Error] = useState("");
  const componentGross = (payslip.earnings ?? []).reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const componentDeductions = (payslip.deductions ?? []).reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const grossMismatch = payslip.earnings?.length ? Math.abs(componentGross - Number(payslip.gross_pay ?? 0)) > 1 : false;
  const deductionMismatch = payslip.deductions?.length ? Math.abs(componentDeductions - Number(payslip.total_deductions ?? 0)) > 1 : false;
  const fetchForm16 = async () => { setLoadingForm16(true); setForm16Error(""); try { const res = await hrmsApi.get<{ success: boolean; data: Form16Data }>(`/api/payroll/form16-data/${runId}/${payslip.employee_id}`); setForm16Data(res.data); } catch (err: unknown) { setForm16Error((err as Error).message || "Failed to load Form 16 data."); } finally { setLoadingForm16(false); } };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b p-6"><div className="flex items-center gap-4"><img src="/mcn-logo.png" alt="MAS Callnet" className="h-10 w-auto object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} /><div><h2 className="text-lg font-black text-slate-950">Payslip</h2><p className="text-sm text-slate-500">{MONTH_NAMES[payslip.month]} {payslip.year}</p></div></div><button onClick={onClose} className="text-slate-400 transition-colors hover:text-slate-700"><X className="h-5 w-5" /></button></div><div className="space-y-5 p-6">{(grossMismatch || deductionMismatch) && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">Component mismatch detected: {grossMismatch ? "earnings do not match gross. " : ""}{deductionMismatch ? "deductions do not match total deductions." : ""}</div>}<div className="grid gap-4 sm:grid-cols-2"><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Employee</p><p className="mt-1 font-black text-slate-950">{payslip.employee_name}</p><p className="font-mono text-xs text-slate-500">{payslip.employee_code ?? payslip.employee_id}</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Department / Designation</p><p className="mt-1 font-black text-slate-950">{payslip.department || "N/A"}</p><p className="text-xs text-slate-500">{payslip.designation || "N/A"}</p></div></div><div className="rounded-3xl bg-slate-950 p-5 text-white"><p className="text-sm text-slate-400">Net Salary</p><p className="mt-1 text-4xl font-black">{INR(payslip.net_pay)}</p><p className="mt-1 text-sm text-slate-300">{numberToWords(Math.floor(Number(payslip.net_pay ?? 0)))}</p></div><div className="grid gap-4 sm:grid-cols-2"><div><h3 className="mb-2 text-xs font-black uppercase text-slate-500">Earnings</h3><table className="w-full text-sm"><tbody>{(payslip.earnings ?? []).map((c) => <tr key={c.component_code} className="border-b"><td className="py-2 text-slate-600">{c.component_name}</td><td className="py-2 text-right font-mono font-bold text-emerald-700">{INR(Number(c.amount))}</td></tr>)}</tbody></table></div><div><h3 className="mb-2 text-xs font-black uppercase text-slate-500">Deductions</h3><table className="w-full text-sm"><tbody>{(payslip.deductions ?? []).map((c) => <tr key={c.component_code} className="border-b"><td className="py-2 text-slate-600">{c.component_name}</td><td className="py-2 text-right font-mono font-bold text-rose-600">– {INR(Number(c.amount))}</td></tr>)}</tbody></table></div></div><div className="grid gap-3 sm:grid-cols-3"><button onClick={() => void downloadPayslipPdf(payslip)} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"><Download className="mr-2 inline h-4 w-4" />Download PDF</button><button onClick={fetchForm16} disabled={loadingForm16} className="rounded-2xl border px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"><BookOpen className="mr-2 inline h-4 w-4" />{loadingForm16 ? "Loading..." : "Form 16"}</button>{!payslip.acknowledged_at && <button onClick={() => onAcknowledge(payslip.id)} disabled={acknowledging} className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700">Acknowledge</button>}</div>{form16Error && <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{form16Error}</div>}</div>{form16Data && <Form16Modal data={form16Data} onClose={() => setForm16Data(null)} />}</div></div>;
}

export default function NativePayslipCenter() {
  const { roleKeys } = useWorkforceAccess();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [lines, setLines] = useState<PayrollLine[]>([]);
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);
  const [search, setSearch] = useState("");
  const [riskOnly, setRiskOnly] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingLines, setLoadingLines] = useState(false);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [viewPayslip, setViewPayslip] = useState<Payslip | null>(null);
  const [loadingPayslip, setLoadingPayslip] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [neftSummary, setNeftSummary] = useState<NeftSummary | null>(null);
  const [loadingNeft, setLoadingNeft] = useState(false);
  const [downloadingNeft, setDownloadingNeft] = useState(false);
  const [showDisbursalModal, setShowDisbursalModal] = useState(false);
  const [disbursalFile, setDisbursalFile] = useState<File | null>(null);
  const [uploadingDisbursal, setUploadingDisbursal] = useState(false);
  const [disbursalResult, setDisbursalResult] = useState<{ inserted: number; updated: number; unmatched: string[] } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);
  const disbursalFileRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalLines, setTotalLines] = useState(0);
  const debouncedSearch = useDebounce(search.trim(), 300);

  const loadRuns = async () => { setLoadingRuns(true); setMessage(""); try { const res = await hrmsApi.get<{ success: boolean; data: PayrollRun[] }>("/api/payroll/runs"); const list = res.data ?? []; setRuns(list); if (list.length > 0 && !selectedRunId) { setSelectedRunId(list[0].id); setSelectedRun(list[0]); } } catch (err: unknown) { setMessage((err as Error).message || "Failed to load payroll runs."); } finally { setLoadingRuns(false); } };
  const loadLines = async (runId: string, pg = 1, ps = 50, q = "") => { if (!runId) return; setLoadingLines(true); setMessage(""); try { const params = new URLSearchParams({ page: String(pg), limit: String(ps) }); if (q) params.set("search", q); const res = await hrmsApi.get<{ success: boolean; data: { lines: PayrollLine[]; total: number; page: number; limit: number } }>(`/api/payroll/runs/${runId}/lines?${params}`); setLines(res.data?.lines ?? []); setTotalLines(res.data?.total ?? 0); setPage(pg); } catch (err: unknown) { setMessage((err as Error).message || "Failed to load payroll lines."); } finally { setLoadingLines(false); } };
  useEffect(() => { void loadRuns(); }, []);
  useEffect(() => {
    if (selectedRunId) {
      const run = runs.find((r) => r.id === selectedRunId) ?? null;
      setSelectedRun(run);
      void loadLines(selectedRunId, 1, pageSize);
      if (run && ["locked", "disbursed"].includes(run.status)) void loadNeftSummary(selectedRunId);
      else setNeftSummary(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRunId, pageSize]);
  useEffect(() => {
    if (selectedRunId) void loadLines(selectedRunId, 1, pageSize, debouncedSearch);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);
  const generatePayslip = async (employeeId: string) => { if (!selectedRunId) return; setGeneratingFor(employeeId); setMessage(""); try { await hrmsApi.post(`/api/payroll/payslip/${selectedRunId}/generate`, { employeeId }); setMessage("Payslip generated successfully."); await loadLines(selectedRunId, page, pageSize, debouncedSearch); } catch (err: unknown) { setMessage((err as Error).message || "Failed to generate payslip."); } finally { setGeneratingFor(null); } };
  const viewPayslipFor = async (employeeId: string) => { if (!selectedRunId) return; setLoadingPayslip(employeeId); setMessage(""); try { const res = await hrmsApi.get<{ success: boolean; data: Payslip }>(`/api/payroll/payslip/${selectedRunId}/${employeeId}`); setViewPayslip(res.data); } catch (err: unknown) { setMessage((err as Error).message || "Failed to load payslip."); } finally { setLoadingPayslip(null); } };
  const acknowledgePayslip = async (payslipId: string) => { setAcknowledging(true); try { await hrmsApi.post(`/api/payroll/payslip/${payslipId}/acknowledge`, {}); setMessage("Payslip acknowledged."); setViewPayslip((prev) => prev ? { ...prev, acknowledged_at: new Date().toISOString() } : prev); await loadLines(selectedRunId, page, pageSize, debouncedSearch); } catch (err: unknown) { setMessage((err as Error).message || "Acknowledgement failed."); } finally { setAcknowledging(false); } };
  const loadNeftSummary = async (runId: string) => { setLoadingNeft(true); setNeftSummary(null); try { const res = await hrmsApi.get<{ success: boolean; data: NeftSummary }>(`/api/payroll/runs/${runId}/neft-summary`); setNeftSummary(res.data ?? null); } catch { setNeftSummary(null); } finally { setLoadingNeft(false); } };
  const downloadNeftCsv = async () => { if (!selectedRunId || !selectedRun) return; setDownloadingNeft(true); try { const csvText = await hrmsApi.getRaw(`/api/payroll/runs/${selectedRunId}/neft-export`); const blob = new Blob([csvText], { type: "text/csv" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `NEFT_${selectedRun.year}-${String(selectedRun.month).padStart(2, "0")}.csv`; a.click(); URL.revokeObjectURL(url); } catch (err: unknown) { setMessage((err as Error).message || "Failed to download NEFT file."); } finally { setDownloadingNeft(false); } };

  const uploadDisbursalCsv = async () => {
    if (!disbursalFile || !selectedRunId) return;
    setUploadingDisbursal(true);
    setDisbursalResult(null);
    try {
      const text = await disbursalFile.text();
      const res = await hrmsApi.post<{ success: boolean; inserted: number; updated: number; unmatched: string[]; message: string }>(
        `/api/payroll/runs/${selectedRunId}/disbursal-upload`,
        text,
        { headers: { "Content-Type": "text/csv" } }
      );
      setDisbursalResult({ inserted: res.inserted ?? 0, updated: res.updated ?? 0, unmatched: res.unmatched ?? [] });
    } catch (err: unknown) {
      setMessage((err as Error).message || "Disbursal upload failed.");
    } finally {
      setUploadingDisbursal(false);
    }
  };

  const riskMap = useMemo(() => { const map = new Map<string, string[]>(); lines.forEach(line => map.set(line.employee_id, lineRisks(line))); return map; }, [lines]);
  const filteredLines = useMemo(() => { if (!riskOnly) return lines; return lines.filter(line => (riskMap.get(line.employee_id) ?? []).length > 0); }, [lines, riskOnly, riskMap]);
  const totalPages = Math.ceil(totalLines / pageSize);
  const lineStats = useMemo(() => ({
    totalEmployees: lines.length,
    totalGross: lines.reduce((s, l) => s + Number(l.gross_pay ?? 0), 0),
    totalNet: lines.reduce((s, l) => s + Number(l.net_pay ?? 0), 0),
    acknowledgedCount: lines.filter((l) => l.payslip_status === "acknowledged").length,
    riskCount: lines.filter((l) => lineRisks(l).length > 0).length,
    netMismatchCount: lines.filter((l) => Math.abs(expectedNet(l) - Number(l.net_pay ?? 0)) > 1).length,
  }), [lines]);
  const { totalEmployees, totalGross, totalNet, acknowledgedCount, riskCount, netMismatchCount } = lineStats;
  const canGenerate = selectedRun ? ["locked", "disbursed"].includes(selectedRun.status) : false;

  const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return <DashboardLayout><div className="space-y-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Payroll</p><h1 className="mt-2 text-3xl font-black text-slate-950">Payslip Center</h1><p className="mt-2 max-w-4xl text-slate-600">Generate, validate, view and distribute payslips with payroll risk checks.</p></div><button onClick={() => { void loadRuns(); if (selectedRunId) void loadLines(selectedRunId); }} disabled={loadingRuns} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"><RefreshCcw className="h-4 w-4" />Refresh</button></div><RoleInsightsPanel roles={roleKeys} title="Payslip control insights" />{message && <div className={`flex items-center justify-between gap-3 rounded-2xl border p-4 text-sm font-bold ${message.includes("Failed") || message.includes("Error") ? "border-red-200 bg-red-50 text-red-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}><div className="flex items-center gap-3"><AlertTriangle className="h-4 w-4 flex-shrink-0" />{message}</div></div>}
    <div className="flex flex-wrap items-center gap-4 rounded-3xl border bg-white p-5 shadow-sm"><label className="whitespace-nowrap text-sm font-black text-slate-700">Payroll Run</label>{loadingRuns ? <Loader className="h-5 w-5 animate-spin text-slate-400" /> : <select value={selectedRunId} onChange={(e) => setSelectedRunId(e.target.value)} className="max-w-sm flex-1 rounded-2xl border bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 outline-none transition-colors focus:border-blue-400">{runs.length === 0 && <option value="">No runs available</option>}{runs.map((r) => <option key={r.id} value={r.id}>{MONTH_NAMES[r.month]} {r.year} — {r.status}</option>)}</select>}{selectedRun && <Badge label={selectedRun.status} cls={selectedRun.status === "disbursed" ? "bg-emerald-50 text-emerald-700" : selectedRun.status === "locked" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"} />}<div className="ml-auto"><button onClick={() => { setShowDisbursalModal(true); setDisbursalResult(null); setDisbursalFile(null); }} disabled={!selectedRunId} className="inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-800 hover:bg-blue-100 disabled:opacity-40"><Upload className="h-4 w-4" />Upload Disbursal Data</button></div></div>
    {showDisbursalModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4" onClick={() => setShowDisbursalModal(false)}>
        <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b p-6">
            <div>
              <h2 className="text-lg font-black text-slate-950">Upload Disbursal Data</h2>
              <p className="text-sm text-slate-500 mt-1">CSV: employee_code, cheque_no, payment_mode, payment_date, bank_ref, notes</p>
            </div>
            <button onClick={() => setShowDisbursalModal(false)} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
          </div>
          <div className="p-6 space-y-4">
            <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <Upload className="mx-auto mb-2 h-8 w-8 text-slate-400" />
              <p className="text-sm font-semibold text-slate-600 mb-3">{disbursalFile ? disbursalFile.name : "Select CSV file"}</p>
              <button onClick={() => disbursalFileRef.current?.click()} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700">Choose File</button>
              <input ref={disbursalFileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => { setDisbursalFile(e.target.files?.[0] ?? null); setDisbursalResult(null); }} />
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <strong>CSV format:</strong> Header row required with columns: <code>employee_code, cheque_no, payment_mode, payment_date, bank_ref, notes</code>. Payment mode: NEFT, IMPS, Cheque, Cash, UPI, RTGS.
            </div>
            {disbursalResult && (
              <div className={`rounded-2xl border p-4 text-sm font-semibold ${disbursalResult.unmatched.length > 0 ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
                <p>✓ {disbursalResult.inserted} new records inserted, {disbursalResult.updated} updated.</p>
                {disbursalResult.unmatched.length > 0 && <p className="mt-1 text-amber-700">⚠ Unmatched codes: {disbursalResult.unmatched.join(", ")}</p>}
              </div>
            )}
          </div>
          <div className="border-t p-6 flex gap-3 justify-end">
            <button onClick={() => setShowDisbursalModal(false)} className="rounded-2xl border px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Close</button>
            <button onClick={() => void uploadDisbursalCsv()} disabled={!disbursalFile || uploadingDisbursal} className="inline-flex items-center gap-2 rounded-2xl bg-[#073f78] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#0a4d90] disabled:opacity-50">
              {uploadingDisbursal ? <Loader className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Upload & Save
            </button>
          </div>
        </div>
      </div>
    )}
    {lines.length > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><StatCard title="Total Employees" value={totalEmployees} icon={<Users className="h-5 w-5" />} tone="bg-slate-100 text-slate-700" /><StatCard title="Total Gross" value={INR(totalGross)} icon={<FileText className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" /><StatCard title="Total Net" value={INR(totalNet)} icon={<Download className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" /><StatCard title="Acknowledged" value={`${acknowledgedCount} / ${totalEmployees}`} icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-violet-50 text-violet-700" /><StatCard title="Risks" value={riskCount} icon={<ShieldAlert className="h-5 w-5" />} tone={riskCount ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"} /></div>}
    {netMismatchCount > 0 && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">{netMismatchCount} payroll line(s) have net mismatch. Review before generating/downloading payslips.</div>}
    {canGenerate && <div className="space-y-4 rounded-3xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-4"><div><h2 className="font-black text-slate-950">NEFT Disbursement</h2><p className="text-sm text-slate-500">Download the bank transfer file for this payroll run.</p></div><button onClick={() => void downloadNeftCsv()} disabled={downloadingNeft || loadingNeft || riskCount > 0} className="inline-flex items-center gap-2 whitespace-nowrap rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-slate-700 disabled:opacity-50">{downloadingNeft ? <Loader className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Download NEFT CSV</button></div>{loadingNeft && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader className="h-4 w-4 animate-spin" />Loading bank details summary…</div>}{!loadingNeft && neftSummary && <div className="grid gap-3 text-sm sm:grid-cols-3"><div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Ready</p><p className="mt-1 text-xl font-black text-emerald-800">{neftSummary.with_bank} employees</p></div><div className={`rounded-2xl p-4 ${neftSummary.missing_bank > 0 ? "bg-amber-50" : "bg-slate-50"}`}><p className={`text-xs font-semibold uppercase tracking-wide ${neftSummary.missing_bank > 0 ? "text-amber-600" : "text-slate-500"}`}>Missing Bank Details</p><p className={`mt-1 text-xl font-black ${neftSummary.missing_bank > 0 ? "text-amber-800" : "text-slate-400"}`}>{neftSummary.missing_bank} employees</p></div><div className="rounded-2xl bg-blue-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Total Net</p><p className="mt-1 text-xl font-black text-blue-800">{INR(Number(neftSummary.total_net))}</p></div></div>}{riskCount > 0 && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800"><AlertTriangle className="mr-2 inline h-4 w-4" />NEFT download is blocked until payroll line risks are resolved.</div>}</div>}
    <div className="overflow-hidden rounded-3xl border bg-white shadow-sm"><div className="border-b p-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="font-black text-slate-950">Payroll Lines</h2><p className="text-sm text-slate-500">Page {page} of {totalPages || 1} • {totalLines} employees</p></div><div className="flex flex-wrap items-center gap-2"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee…" className="h-10 rounded-xl border bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-400" /></div><button onClick={() => setRiskOnly((v) => !v)} className={`rounded-xl px-3 py-2 text-xs font-bold ${riskOnly ? "bg-red-600 text-white" : "bg-slate-100 text-slate-700"}`}>Risk only</button></div></div></div>{loadingLines ? <div className="flex items-center justify-center py-16"><Loader className="h-8 w-8 animate-spin text-slate-400" /></div> : filteredLines.length === 0 ? <div className="py-16 text-center text-slate-400"><FileText className="mx-auto mb-3 h-10 w-10 opacity-30" /><p className="font-semibold">{selectedRunId ? "No lines found for this run/filter." : "Select a payroll run to view lines."}</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Employee", "Gross Pay", "Net Pay", "PF", "ESIC", "PT", "Deductions", "Risk", "Payslip", "Actions"].map((h) => <th key={h} className="p-4 font-semibold">{h}</th>)}</tr></thead><tbody>{filteredLines.map((line) => { const risks = riskMap.get(line.employee_id) ?? []; return <tr key={line.employee_id} className="border-t transition-colors hover:bg-slate-50/80"><td className="p-4"><div className="font-bold text-slate-950">{line.employee_name || line.employee_id}</div>{line.employee_code && <div className="font-mono text-xs text-slate-500">{line.employee_code}</div>}</td><td className="p-4 font-mono font-semibold text-slate-800">{INR(line.gross_pay)}</td><td className="p-4 font-mono font-bold text-emerald-700">{INR(line.net_pay)}</td><td className="p-4 font-mono text-slate-600">{INR(line.pf_employee)}</td><td className="p-4 font-mono text-slate-600">{INR(line.esic_employee)}</td><td className="p-4 font-mono text-slate-600">{INR(line.pt_amount)}</td><td className="p-4 font-mono text-rose-600">– {INR(line.total_deductions)}</td><td className="p-4">{risks.length ? <div className="flex flex-wrap gap-1">{risks.slice(0, 2).map((r) => <span key={r} className="rounded-full bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700">{r}</span>)}</div> : <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">Clean</span>}</td><td className="p-4">{line.payslip_id ? <Badge label={line.payslip_status ?? "generated"} cls={PAYSLIP_STATUS_COLORS[line.payslip_status ?? "generated"] ?? "bg-slate-100 text-slate-600"} /> : <span className="text-xs font-semibold text-slate-400">Not Generated</span>}</td><td className="p-4"><div className="flex gap-2">{!line.payslip_id && canGenerate && <button onClick={() => generatePayslip(line.employee_id)} disabled={generatingFor === line.employee_id || risks.some((r) => r !== "Not generated" && r !== "Not acknowledged")} className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50">{generatingFor === line.employee_id ? <Loader className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}Generate</button>}{line.payslip_id && <button onClick={() => viewPayslipFor(line.employee_id)} disabled={loadingPayslip === line.employee_id} className="flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-slate-700 disabled:opacity-50">{loadingPayslip === line.employee_id ? <Loader className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}View</button>}</div></td></tr>; })}</tbody></table></div>}<div className="flex items-center justify-between border-t bg-slate-50 px-5 py-3"><div className="text-xs text-slate-600 font-semibold">Rows per page:{" "}<select value={pageSize} onChange={(e) => { const ps = parseInt(e.target.value); setPageSize(ps); if (selectedRunId) void loadLines(selectedRunId, 1, ps, debouncedSearch); }} className="ml-1 rounded border bg-white px-2 py-0.5 text-xs">{[25, 50, 100].map(s => <option key={s} value={s}>{s}</option>)}</select></div><div className="flex items-center gap-2"><button onClick={() => selectedRunId && void loadLines(selectedRunId, page - 1, pageSize, debouncedSearch)} disabled={page <= 1} className="rounded border px-3 py-1 text-xs font-semibold disabled:opacity-40 hover:bg-slate-100">← Prev</button><span className="text-xs font-semibold text-slate-600">{page} / {totalPages || 1}</span><button onClick={() => selectedRunId && void loadLines(selectedRunId, page + 1, pageSize, debouncedSearch)} disabled={page >= totalPages} className="rounded border px-3 py-1 text-xs font-semibold disabled:opacity-40 hover:bg-slate-100">Next →</button></div></div></div></div>{viewPayslip && <PayslipModal payslip={viewPayslip} runId={selectedRunId} onClose={() => setViewPayslip(null)} onAcknowledge={acknowledgePayslip} acknowledging={acknowledging} />}</DashboardLayout>;
}
