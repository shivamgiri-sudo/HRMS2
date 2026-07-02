import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Loader, RefreshCcw, ShieldCheck, UserMinus } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { RoleInsightsPanel } from "@/components/insights/RoleInsightsPanel";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";

type ExitRequest = {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  exit_type: string;
  exit_sub_type?: string;
  last_working_day_confirmed?: string;
  last_working_day_proposed?: string;
  status: string;
  created_at: string;
  clearance_total?: number;
  clearance_cleared?: number;
  risk_label?: string | null;
  regrettable_exit?: number | boolean | null;
};

type FFCalculation = {
  id: string;
  exit_request_id: string;
  calculation_date: string;
  notice_period_days: number;
  notice_shortfall_days: number;
  notice_recovery: number;
  earned_leave_encashment: number;
  gratuity_amount: number;
  salary_hold: number;
  advances_recovery: number;
  net_payable: number;
  status: "draft" | "verified" | "approved" | "paid";
  is_ff_provisional?: number;
  approved_at?: string;
  created_at?: string;
};

type FFFormState = {
  calculation_date: string;
  notice_period_days: string;
  notice_shortfall_days: string;
  notice_recovery: string;
  earned_leave_encashment: string;
  gratuity_amount: string;
  salary_hold: string;
  advances_recovery: string;
  net_payable: string;
};

const INR = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v ?? 0);
const toNum = (v: string): number => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

const EMPTY_FORM: FFFormState = {
  calculation_date: new Date().toISOString().slice(0, 10),
  notice_period_days: "30",
  notice_shortfall_days: "0",
  notice_recovery: "0",
  earned_leave_encashment: "0",
  gratuity_amount: "0",
  salary_hold: "0",
  advances_recovery: "0",
  net_payable: "0",
};

const FF_STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  verified: "bg-blue-50 text-blue-700",
  approved: "bg-emerald-50 text-emerald-700",
  paid: "bg-violet-50 text-violet-700",
};

const EXIT_STATUS_COLORS: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-700",
  notice_period: "bg-cyan-50 text-cyan-700",
  notice_serving: "bg-cyan-50 text-cyan-700",
  exit_confirmed: "bg-green-100 text-green-800",
  exited: "bg-green-100 text-green-800",
  accepted: "bg-blue-50 text-blue-700",
};

function normalizeExitStatus(status: string) { return status === "exit_confirmed" ? "exited" : status; }
function human(v?: string | null) { return v ? v.replace(/_/g, " ") : "—"; }
function Badge({ label, cls }: { label: string; cls: string }) { return <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${cls}`}>{human(label)}</span>; }
function clearancePct(req: ExitRequest | null) { const total = Number(req?.clearance_total ?? 0); const cleared = Number(req?.clearance_cleared ?? 0); return total ? Math.round((cleared / total) * 100) : 0; }
function hasOpenClearance(req: ExitRequest | null) { return Number(req?.clearance_total ?? 0) > Number(req?.clearance_cleared ?? 0); }
function netFromForm(form: FFFormState) { return toNum(form.earned_leave_encashment) + toNum(form.gratuity_amount) - toNum(form.notice_recovery) - toNum(form.salary_hold) - toNum(form.advances_recovery); }
function netFromFF(ff: FFCalculation) { return ff.earned_leave_encashment + ff.gratuity_amount - ff.notice_recovery - ff.salary_hold - ff.advances_recovery; }

function PrepareFFForm({ form, onChange, onSubmit, submitting }: { form: FFFormState; onChange: (f: FFFormState) => void; onSubmit: () => void; submitting: boolean }) {
  const set = (key: keyof FFFormState) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...form, [key]: e.target.value });
  const calculatedNet = netFromForm(form);
  const netMismatch = Math.abs(calculatedNet - toNum(form.net_payable)) > 1;
  const fields: { key: keyof FFFormState; label: string; desc?: string; type?: string; deduction?: boolean }[] = [
    { key: "calculation_date", label: "Calculation Date", type: "date" },
    { key: "notice_period_days", label: "Notice Period Days", desc: "Total required notice" },
    { key: "notice_shortfall_days", label: "Notice Shortfall Days", desc: "Days short of full notice" },
    { key: "notice_recovery", label: "Notice Recovery", desc: "Recovery for notice shortfall", deduction: true },
    { key: "earned_leave_encashment", label: "Earned Leave Encashment", desc: "EL balance payout" },
    { key: "gratuity_amount", label: "Gratuity Amount", desc: "As per Gratuity Act" },
    { key: "salary_hold", label: "Salary Hold", desc: "Held salary amount", deduction: true },
    { key: "advances_recovery", label: "Advance / Loan Recovery", desc: "Recoverable advance/loan", deduction: true },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
        <b>Settlement formula:</b> Leave encashment + gratuity − notice recovery − salary hold − advances. Net payable is auto-derived for governance.
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(({ key, label, desc, type, deduction }) => (
          <div key={key}>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">{label}{deduction && <span className="ml-1 text-xs text-rose-500">(deduction)</span>}</label>
            <input type={type === "date" ? "date" : "number"} min={type !== "date" ? "0" : undefined} value={form[key]} onChange={set(key)} className={`w-full rounded-2xl border px-4 py-3 text-sm font-mono outline-none transition-colors focus:border-blue-400 ${deduction ? "border-rose-100" : ""}`} />
            {desc && <p className="mt-1 text-xs text-slate-400">{desc}</p>}
          </div>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-500">Calculated Net Payable</p><p className="mt-2 text-2xl font-black text-slate-950">{INR(calculatedNet)}</p></div>
        <div><label className="mb-1.5 block text-sm font-black text-slate-700">Net Payable Override</label><input type="number" value={form.net_payable} onChange={set("net_payable")} className="w-full rounded-2xl border-2 border-slate-950 px-4 py-3 text-lg font-black font-mono outline-none transition-colors focus:border-blue-400" />{netMismatch && <p className="mt-1 text-xs font-bold text-amber-700">Warning: manual net payable differs from calculated value.</p>}</div>
      </div>
      <button type="button" onClick={() => onChange({ ...form, net_payable: String(calculatedNet) })} className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100">Use Calculated Net</button>
      <button onClick={onSubmit} disabled={submitting || netMismatch} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 py-3.5 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:opacity-50">
        {submitting ? <Loader className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />} Create F&F Settlement
      </button>
      {netMismatch && <p className="text-center text-xs font-bold text-amber-700">Resolve net payable mismatch before creating settlement.</p>}
    </div>
  );
}

function FFBreakdown({ ff }: { ff: FFCalculation }) {
  const deductions = ff.notice_recovery + ff.salary_hold + ff.advances_recovery;
  const credits = ff.earned_leave_encashment + ff.gratuity_amount;
  const calculated = netFromFF(ff);
  const mismatch = Math.abs(calculated - ff.net_payable) > 1;
  return (
    <div className="space-y-4">
      {mismatch && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">Net payable mismatch: calculated {INR(calculated)} but saved {INR(ff.net_payable)}.</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <div><h4 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Credits</h4><table className="w-full text-sm"><tbody>{[["Earned Leave Encashment", ff.earned_leave_encashment], ["Gratuity Amount", ff.gratuity_amount]].map(([label, amount]) => <tr key={label as string} className="border-b last:border-0"><td className="py-2.5 text-slate-600">{label}</td><td className="py-2.5 text-right font-mono font-semibold text-emerald-700">{INR(amount as number)}</td></tr>)}</tbody><tfoot><tr className="bg-emerald-50"><td className="rounded-l-xl px-2 py-2.5 font-black text-emerald-800">Total Credits</td><td className="rounded-r-xl px-2 py-2.5 text-right font-mono font-black text-emerald-800">{INR(credits)}</td></tr></tfoot></table></div>
        <div><h4 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Deductions</h4><table className="w-full text-sm"><tbody>{[["Notice Recovery", ff.notice_recovery], ["Salary Hold", ff.salary_hold], ["Advance Recovery", ff.advances_recovery]].map(([label, amount]) => <tr key={label as string} className="border-b last:border-0"><td className="py-2.5 text-slate-600">{label}</td><td className="py-2.5 text-right font-mono font-semibold text-rose-600">– {INR(amount as number)}</td></tr>)}</tbody><tfoot><tr className="bg-rose-50"><td className="rounded-l-xl px-2 py-2.5 font-black text-rose-800">Total Deductions</td><td className="rounded-r-xl px-2 py-2.5 text-right font-mono font-black text-rose-800">– {INR(deductions)}</td></tr></tfoot></table></div>
      </div>
      <div className="grid gap-3 text-sm md:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">Notice Period</p><p className="mt-1 font-bold text-slate-950">{ff.notice_period_days} days</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">Shortfall</p><p className="mt-1 font-bold text-slate-950">{ff.notice_shortfall_days} days</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">Calc. Date</p><p className="mt-1 font-mono font-bold text-slate-950">{ff.calculation_date?.slice(0, 10)}</p></div></div>
    </div>
  );
}

export default function NativeFullFinal() {
  const { roleKeys } = useWorkforceAccess();
  const [exitRequests, setExitRequests] = useState<ExitRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<ExitRequest | null>(null);
  const [ffCalc, setFfCalc] = useState<FFCalculation | null>(null);
  const [form, setForm] = useState<FFFormState>(EMPTY_FORM);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [loadingFF, setLoadingFF] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "success" | "error">("info");

  const loadRequests = async () => {
    setLoadingRequests(true); setMessage("");
    try {
      const all: ExitRequest[] = [];
      let page = 1;
      let total = Infinity;
      while (all.length < total && page <= 20) {
        const res = await hrmsApi.get<{ success: boolean; data: ExitRequest[]; total?: number }>(`/api/exit?limit=100&page=${page}`);
        const rows = res.data ?? [];
        all.push(...rows);
        total = typeof res.total === "number" ? res.total : all.length;
        if (rows.length < 100) break;
        page += 1;
      }
      const relevant = all.filter((r) => ["approved", "notice_period", "notice_serving", "exit_confirmed", "exited", "accepted"].includes(normalizeExitStatus(r.status)) || ["accepted", "notice_serving"].includes(r.status));
      setExitRequests(relevant);
    } catch (err: unknown) { showMessage((err as Error).message || "Failed to load exit requests.", "error"); }
    finally { setLoadingRequests(false); }
  };

  const loadFF = async (exitId: string) => {
    setLoadingFF(true); setFfCalc(null); setForm(EMPTY_FORM);
    try { const res = await hrmsApi.get<{ success: boolean; data: FFCalculation }>(`/api/exit/ff/${exitId}`); if (res.data) setFfCalc(res.data); }
    catch (err: unknown) { const e = err as Error; if (!e.message?.includes("404") && !e.message?.toLowerCase().includes("not found")) showMessage(e.message || "Failed to load F&F calculation.", "error"); }
    finally { setLoadingFF(false); }
  };

  useEffect(() => { void loadRequests(); }, []);
  const selectRequest = (req: ExitRequest) => { setSelectedRequest(req); setFfCalc(null); setForm(EMPTY_FORM); void loadFF(req.id); };

  const createFF = async () => {
    if (!selectedRequest) return;
    const calculatedNet = netFromForm(form);
    if (Math.abs(calculatedNet - toNum(form.net_payable)) > 1) return showMessage("Net payable mismatch. Use calculated net or correct the override.", "error");
    setSubmitting(true); setMessage("");
    try {
      await hrmsApi.post(`/api/exit/ff/${selectedRequest.id}`, { calculation_date: form.calculation_date, notice_period_days: toNum(form.notice_period_days), notice_shortfall_days: toNum(form.notice_shortfall_days), notice_recovery: toNum(form.notice_recovery), earned_leave_encashment: toNum(form.earned_leave_encashment), gratuity_amount: toNum(form.gratuity_amount), salary_hold: toNum(form.salary_hold), advances_recovery: toNum(form.advances_recovery), net_payable: toNum(form.net_payable) });
      showMessage("F&F settlement created successfully. Verify statutory/provisional status before approval.", "success"); await loadFF(selectedRequest.id);
    } catch (err: unknown) { showMessage((err as Error).message || "Failed to create F&F.", "error"); }
    finally { setSubmitting(false); }
  };

  const approveFF = async () => {
    if (!ffCalc) return;
    if (hasOpenClearance(selectedRequest)) return showMessage("Cannot approve: clearance is incomplete.", "error");
    if (Number(ffCalc.is_ff_provisional ?? 0) === 1) return showMessage("Cannot approve: F&F is still provisional.", "error");
    setApproving(true); setMessage("");
    try { await hrmsApi.post(`/api/exit/ff/${ffCalc.id}/approve`, {}); showMessage("F&F settlement approved.", "success"); setFfCalc({ ...ffCalc, status: "approved", approved_at: new Date().toISOString() }); }
    catch (err: unknown) { showMessage((err as Error).message || "Approval failed.", "error"); }
    finally { setApproving(false); }
  };

  function showMessage(msg: string, type: "info" | "success" | "error") { setMessage(msg); setMessageType(type); }

  const messageColors = { info: "border-blue-200 bg-blue-50 text-blue-800", success: "border-emerald-200 bg-emerald-50 text-emerald-800", error: "border-rose-200 bg-rose-50 text-rose-800" };
  const MessageIcon = messageType === "success" ? CheckCircle2 : AlertTriangle;
  const selectedClearancePct = clearancePct(selectedRequest);
  const approvalBlockedReasons = useMemo(() => {
    const reasons: string[] = [];
    if (hasOpenClearance(selectedRequest)) reasons.push("Clearance incomplete");
    if (ffCalc && Number(ffCalc.is_ff_provisional ?? 0) === 1) reasons.push("F&F provisional");
    if (ffCalc && ffCalc.status === "paid") reasons.push("Already paid");
    if (ffCalc && Math.abs(netFromFF(ffCalc) - ffCalc.net_payable) > 1) reasons.push("Net mismatch");
    return reasons;
  }, [selectedRequest, ffCalc]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Payroll Governance</p><h1 className="mt-2 text-3xl font-black text-slate-950">Full & Final Settlement</h1><p className="mt-2 max-w-4xl text-slate-600">Prepare, validate and approve F&F settlements with clearance and provisional controls.</p></div><button onClick={() => void loadRequests()} disabled={loadingRequests} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"><RefreshCcw className="h-4 w-4" />Refresh</button></div>
        <RoleInsightsPanel roles={roleKeys} title="F&F control insights" />
        {message && <div className={`flex items-center gap-3 rounded-2xl border p-4 text-sm font-bold ${messageColors[messageType]}`}><MessageIcon className="h-4 w-4 flex-shrink-0" />{message}</div>}
        <div className="grid gap-4 md:grid-cols-4"><div className="rounded-2xl border bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">Eligible Exits</p><p className="mt-2 text-2xl font-black">{exitRequests.length}</p></div><div className="rounded-2xl border bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">Selected Clearance</p><p className="mt-2 text-2xl font-black">{selectedRequest ? `${selectedClearancePct}%` : "—"}</p></div><div className="rounded-2xl border bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">Approval Blockers</p><p className="mt-2 text-2xl font-black text-rose-700">{approvalBlockedReasons.length}</p></div><div className="rounded-2xl border bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">Settlement Status</p><p className="mt-2 text-2xl font-black capitalize">{ffCalc?.status ?? "—"}</p></div></div>
        <div className="flex items-start gap-6"><div className="w-80 flex-shrink-0 overflow-hidden rounded-3xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-black text-slate-950">Exit Requests</h2><p className="text-sm text-slate-500">{exitRequests.length} eligible for F&F</p></div>{loadingRequests ? <div className="flex items-center justify-center py-12"><Loader className="h-7 w-7 animate-spin text-slate-400" /></div> : exitRequests.length === 0 ? <div className="px-4 py-12 text-center text-slate-400"><UserMinus className="mx-auto mb-3 h-9 w-9 opacity-30" /><p className="text-sm font-semibold">No eligible exit requests found.</p></div> : <div className="max-h-[620px] divide-y overflow-y-auto">{exitRequests.map((req) => { const status = normalizeExitStatus(req.status); return <button key={req.id} onClick={() => selectRequest(req)} className={`w-full p-4 text-left transition-colors ${selectedRequest?.id === req.id ? "bg-slate-950 text-white" : "hover:bg-slate-50"}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className={`truncate text-sm font-bold ${selectedRequest?.id === req.id ? "text-white" : "text-slate-950"}`}>{req.employee_name ?? req.employee_id}</p>{req.employee_code && <p className={`mt-0.5 font-mono text-xs ${selectedRequest?.id === req.id ? "text-slate-300" : "text-slate-500"}`}>{req.employee_code}</p>}<p className={`mt-1 text-xs capitalize ${selectedRequest?.id === req.id ? "text-slate-300" : "text-slate-500"}`}>{req.exit_type} — {human(req.exit_sub_type)}</p><p className={`mt-1 font-mono text-xs ${selectedRequest?.id === req.id ? "text-slate-400" : "text-slate-400"}`}>LWD: {req.last_working_day_confirmed ?? req.last_working_day_proposed ?? "TBD"}</p><div className="mt-2 h-1.5 rounded-full bg-slate-200"><div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${clearancePct(req)}%` }} /></div></div><div className="flex flex-col items-end gap-1.5"><Badge label={status} cls={selectedRequest?.id === req.id ? "bg-white/20 text-white" : (EXIT_STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600")} />{selectedRequest?.id === req.id && <ArrowRight className="h-3.5 w-3.5 text-white/60" />}</div></div></button>; })}</div>}</div>
          <div className="min-w-0 flex-1">{!selectedRequest ? <div className="rounded-3xl border bg-white py-20 text-center text-slate-400 shadow-sm"><ClipboardList className="mx-auto mb-3 h-12 w-12 opacity-20" /><p className="font-semibold">Select an exit request to prepare F&F settlement.</p></div> : loadingFF ? <div className="flex items-center justify-center rounded-3xl border bg-white py-20 shadow-sm"><Loader className="h-8 w-8 animate-spin text-slate-400" /></div> : <div className="space-y-5"><div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-black text-slate-950">{selectedRequest.employee_name ?? selectedRequest.employee_id}</h3>{selectedRequest.employee_code && <p className="mt-0.5 font-mono text-sm text-slate-500">{selectedRequest.employee_code}</p>}<div className="mt-2 flex flex-wrap items-center gap-3"><Badge label={normalizeExitStatus(selectedRequest.status)} cls={EXIT_STATUS_COLORS[normalizeExitStatus(selectedRequest.status)] ?? "bg-slate-100 text-slate-600"} /><span className="text-xs capitalize text-slate-500">{selectedRequest.exit_type} · {human(selectedRequest.exit_sub_type)}</span><span className="font-mono text-xs text-slate-500">LWD: {selectedRequest.last_working_day_confirmed ?? selectedRequest.last_working_day_proposed ?? "TBD"}</span></div></div>{ffCalc && <Badge label={`F&F: ${ffCalc.status}`} cls={FF_STATUS_COLORS[ffCalc.status] ?? "bg-slate-100 text-slate-600"} />}</div><div className="mt-4 rounded-2xl border bg-slate-50 p-4"><div className="flex items-center justify-between text-sm font-bold text-slate-700"><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Clearance readiness</span><span>{Number(selectedRequest.clearance_cleared ?? 0)}/{Number(selectedRequest.clearance_total ?? 0)} ({selectedClearancePct}%)</span></div><div className="mt-2 h-2 rounded-full bg-white"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${selectedClearancePct}%` }} /></div></div></div>
            {!ffCalc ? <div className="overflow-hidden rounded-3xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-black text-slate-950">Prepare F&F Settlement</h2><p className="text-sm text-slate-500">Enter settlement components below.</p></div><div className="p-6"><PrepareFFForm form={form} onChange={setForm} onSubmit={createFF} submitting={submitting} /></div></div> : <><div className="overflow-hidden rounded-3xl border bg-white shadow-sm"><div className="flex items-center justify-between border-b p-5"><div><h2 className="font-black text-slate-950">F&F Breakdown</h2><p className="text-sm text-slate-500">Prepared on {ffCalc.calculation_date?.slice(0, 10)}</p></div><Badge label={ffCalc.status} cls={FF_STATUS_COLORS[ffCalc.status] ?? "bg-slate-100 text-slate-600"} /></div><div className="p-6"><FFBreakdown ff={ffCalc} /></div></div><div className="rounded-3xl bg-slate-950 p-6"><div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><p className="text-sm font-semibold text-slate-400">Final Net Payable</p><p className="mt-1 text-4xl font-black text-white">{INR(ffCalc.net_payable)}</p></div><div className="text-right text-sm text-slate-300">{approvalBlockedReasons.length > 0 ? <div className="rounded-2xl bg-rose-500/20 p-3 text-left font-bold text-rose-100">Blocked: {approvalBlockedReasons.join(", ")}</div> : <div className="rounded-2xl bg-emerald-500/20 p-3 font-bold text-emerald-100">Ready for approval</div>}</div></div></div>{ffCalc.status === "draft" && <button onClick={approveFF} disabled={approving || approvalBlockedReasons.length > 0} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">{approving ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve F&F Settlement</button>}</>}
          </div>}</div></div>
      </div>
    </DashboardLayout>
  );
}
