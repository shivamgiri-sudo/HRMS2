import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeftRight, CalendarDays, CheckCircle2, Loader, Plus, RefreshCcw, TrendingDown, UserCheck, Users, X, Zap } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type TabKey = "swaps" | "conflicts" | "coverage" | "attrition";
type SwapStatus = "pending" | "approved" | "rejected";
type ConflictStatus = "open" | "resolved";
type ConflictSeverity = "low" | "medium" | "high" | "critical";

type SwapRequest = {
  id: string;
  requester_employee_id: string;
  requester_name?: string;
  target_employee_id: string;
  target_name?: string;
  swap_date: string;
  shift_id?: string;
  shift_name?: string;
  reason?: string;
  status: SwapStatus;
  created_at: string;
};

type RosterConflict = {
  id: string;
  conflict_type: string;
  conflict_date: string;
  employees_involved: string[];
  employee_names?: string[];
  severity: ConflictSeverity;
  status: ConflictStatus;
  resolution_remarks?: string;
  created_at: string;
};

type CoverageGap = { process?: string; branch?: string; gap_count: number; note?: string };
type CoverageData = { required_headcount: number; available_headcount: number; coverage_pct: number; gaps: CoverageGap[] };
type AttritionSummary = { total_exits: number; voluntary: number; involuntary: number; attrition_rate: number; by_reason: { reason: string; count: number; pct: number }[] };

const SWAP_TONE: Record<SwapStatus, string> = { pending: "bg-amber-50 text-amber-700", approved: "bg-emerald-50 text-emerald-700", rejected: "bg-red-50 text-red-700" };
const CONFLICT_TONE: Record<ConflictSeverity, string> = { low: "bg-slate-100 text-slate-600", medium: "bg-amber-50 text-amber-700", high: "bg-orange-50 text-orange-700", critical: "bg-red-50 text-red-700" };
const ATTRITION_REASONS = ["better_opportunity", "salary_dissatisfaction", "work_environment", "personal_reasons", "health_issues", "relocation", "higher_studies", "contract_end", "termination", "absconding", "other"];

function Badge({ label, cls }: { label: string; cls: string }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${cls}`}>{label.replace(/_/g, " ")}</span>;
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return <label className="block text-sm font-semibold text-slate-700"><span className="mb-1.5 block">{label}</span><input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400" /></label>;
}

function TextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="block text-sm font-semibold text-slate-700"><span className="mb-1.5 block">{label}</span><textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className="w-full resize-none rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400" /></label>;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <label className="block text-sm font-semibold text-slate-700"><span className="mb-1.5 block">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border bg-white px-4 py-3 text-sm outline-none focus:border-blue-400">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function Message({ text }: { text: string }) {
  if (!text) return null;
  return <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800"><AlertTriangle className="h-4 w-4 flex-shrink-0" />{text}</div>;
}

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b p-6"><h2 className="text-lg font-black text-slate-950">{title}</h2><button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button></div><div className="space-y-4 p-6">{children}</div><div className="flex gap-3 border-t p-6">{footer}</div></div></div>;
}

function Stat({ title, value, sub, icon, tone }: { title: string; value: string | number; sub?: string; icon: React.ReactNode; tone: string }) {
  return <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-slate-500">{title}</p><p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>{sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}</div><div className={`rounded-2xl p-3 ${tone}`}>{icon}</div></div></div>;
}

function RosterSwapsTab() {
  const [rows, setRows] = useState<SwapRequest[]>([]);
  const [status, setStatus] = useState<"all" | SwapStatus>("all");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [review, setReview] = useState<SwapRequest | null>(null);
  const [reviewAction, setReviewAction] = useState<SwapStatus>("approved");
  const [remarks, setRemarks] = useState("");
  const [form, setForm] = useState({ requester_employee_id: "", target_employee_id: "", swap_date: "", reason: "" });

  async function load() {
    setLoading(true); setMessage("");
    try {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      const res = await hrmsApi.get<{ data: SwapRequest[] }>(`/api/wfm-ext/roster/swaps?${params}`);
      setRows(res.data ?? []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Failed to load swap requests"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [status]);

  async function submitCreate() {
    if (!form.target_employee_id.trim() || !form.swap_date) return setMessage("Target employee and swap date are required.");
    try {
      await hrmsApi.post("/api/wfm-ext/roster/swaps", { ...form, swap_with_emp_id: form.target_employee_id });
      setShowCreate(false); setForm({ requester_employee_id: "", target_employee_id: "", swap_date: "", reason: "" }); setMessage("Swap request created."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Failed to create swap request"); }
  }

  async function submitReview() {
    if (!review) return;
    try {
      await hrmsApi.post(`/api/wfm-ext/roster/swaps/${review.id}/review`, { status: reviewAction, action: reviewAction, remarks });
      setReview(null); setRemarks(""); setMessage(`Swap request ${reviewAction}.`); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Failed to review swap request"); }
  }

  return <div className="space-y-5"><Message text={message} /><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2">{["all", "pending", "approved", "rejected"].map((item) => <button key={item} onClick={() => setStatus(item as "all" | SwapStatus)} className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${status === item ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}>{item}</button>)}</div><div className="flex gap-2"><button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border bg-white px-4 py-2.5 text-sm font-semibold"><RefreshCcw className="h-4 w-4" />Refresh</button><button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white"><Plus className="h-4 w-4" />Request Swap</button></div></div><div className="overflow-hidden rounded-3xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-black text-slate-950">Swap Requests</h2><p className="text-sm text-slate-500">{rows.length} records</p></div>{loading ? <div className="flex justify-center py-16"><Loader className="h-8 w-8 animate-spin text-slate-400" /></div> : rows.length === 0 ? <div className="py-16 text-center text-slate-400"><ArrowLeftRight className="mx-auto mb-3 h-10 w-10 opacity-30" /><p className="font-semibold">No swap requests found.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Requester", "Target", "Date", "Reason", "Status", "Action"].map((h) => <th key={h} className="p-4">{h}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t"><td className="p-4"><b>{row.requester_name ?? row.requester_employee_id}</b><div className="font-mono text-xs text-slate-400">{row.requester_employee_id?.slice(0, 8)}</div></td><td className="p-4"><b>{row.target_name ?? row.target_employee_id}</b><div className="font-mono text-xs text-slate-400">{row.target_employee_id?.slice(0, 8)}</div></td><td className="p-4 font-mono">{row.swap_date}</td><td className="p-4 max-w-[240px] truncate">{row.reason ?? "—"}</td><td className="p-4"><Badge label={row.status} cls={SWAP_TONE[row.status] ?? SWAP_TONE.pending} /></td><td className="p-4">{row.status === "pending" && <button onClick={() => { setReview(row); setReviewAction("approved"); }} className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white">Review</button>}</td></tr>)}</tbody></table></div>}</div>{showCreate && <Modal title="Request Roster Swap" onClose={() => setShowCreate(false)} footer={<><button onClick={() => setShowCreate(false)} className="flex-1 rounded-2xl border py-3 text-sm font-semibold">Cancel</button><button onClick={submitCreate} className="flex-1 rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white">Submit</button></>}><Field label="Requester Employee ID" value={form.requester_employee_id} onChange={(v) => setForm({ ...form, requester_employee_id: v })} placeholder="Leave blank for self" /><Field label="Target Employee ID" value={form.target_employee_id} onChange={(v) => setForm({ ...form, target_employee_id: v })} /><Field label="Swap Date" type="date" value={form.swap_date} onChange={(v) => setForm({ ...form, swap_date: v })} /><TextArea label="Reason" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} /></Modal>}{review && <Modal title="Review Swap" onClose={() => setReview(null)} footer={<><button onClick={() => setReview(null)} className="flex-1 rounded-2xl border py-3 text-sm font-semibold">Cancel</button><button onClick={submitReview} className="flex-1 rounded-2xl bg-emerald-600 py-3 text-sm font-bold text-white">Save</button></>}><SelectField label="Decision" value={reviewAction} onChange={(v) => setReviewAction(v as SwapStatus)} options={[{ value: "approved", label: "Approve" }, { value: "rejected", label: "Reject" }]} /><TextArea label="Remarks" value={remarks} onChange={setRemarks} /></Modal>}</div>;
}

function ConflictsTab() {
  const [rows, setRows] = useState<RosterConflict[]>([]);
  const [status, setStatus] = useState<"all" | ConflictStatus>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<RosterConflict | null>(null);
  const [resolution, setResolution] = useState("");

  async function load() {
    setLoading(true); setMessage("");
    try {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const res = await hrmsApi.get<{ data: RosterConflict[] }>(`/api/wfm-ext/roster/conflicts?${params}`);
      setRows(res.data ?? []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Failed to load conflicts"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [status, dateFrom, dateTo]);

  async function resolveConflict() {
    if (!resolveTarget || !resolution.trim()) return setMessage("Resolution action is required.");
    try { await hrmsApi.post(`/api/wfm-ext/roster/conflicts/${resolveTarget.id}/resolve`, { resolution_action: resolution, remarks: resolution }); setResolveTarget(null); setResolution(""); setMessage("Conflict resolved."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Failed to resolve conflict"); }
  }

  return <div className="space-y-5"><Message text={message} /><div className="rounded-3xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center gap-3"><div className="flex gap-2">{["all", "open", "resolved"].map((item) => <button key={item} onClick={() => setStatus(item as "all" | ConflictStatus)} className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${status === item ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}>{item}</button>)}</div><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="ml-auto rounded-xl border px-3 py-1.5 text-xs" /><input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-xl border px-3 py-1.5 text-xs" /><button onClick={load} className="rounded-xl border px-3 py-1.5 text-xs font-semibold">Refresh</button></div></div><div className="overflow-hidden rounded-3xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-black text-slate-950">Roster Conflicts</h2><p className="text-sm text-slate-500">{rows.length} records</p></div>{loading ? <div className="flex justify-center py-16"><Loader className="h-8 w-8 animate-spin text-slate-400" /></div> : rows.length === 0 ? <div className="py-16 text-center text-slate-400"><CheckCircle2 className="mx-auto mb-3 h-10 w-10 opacity-30" /><p className="font-semibold">No conflicts found.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Type", "Date", "Employee", "Severity", "Status", "Action"].map((h) => <th key={h} className="p-4">{h}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t"><td className="p-4 font-semibold capitalize">{row.conflict_type.replace(/_/g, " ")}</td><td className="p-4 font-mono">{row.conflict_date}</td><td className="p-4">{(row.employee_names ?? row.employees_involved).join(", ")}</td><td className="p-4"><Badge label={row.severity} cls={CONFLICT_TONE[row.severity] ?? CONFLICT_TONE.medium} /></td><td className="p-4"><Badge label={row.status} cls={row.status === "resolved" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"} /></td><td className="p-4">{row.status === "open" && <button onClick={() => setResolveTarget(row)} className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white">Resolve</button>}</td></tr>)}</tbody></table></div>}</div>{resolveTarget && <Modal title="Resolve Conflict" onClose={() => setResolveTarget(null)} footer={<><button onClick={() => setResolveTarget(null)} className="flex-1 rounded-2xl border py-3 text-sm font-semibold">Cancel</button><button onClick={resolveConflict} className="flex-1 rounded-2xl bg-emerald-600 py-3 text-sm font-bold text-white">Resolve</button></>}><TextArea label="Resolution Action" value={resolution} onChange={setResolution} /></Modal>}</div>;
}

function CoverageTab() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [processId, setProcessId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [coverage, setCoverage] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true); setMessage("");
    try {
      const params = new URLSearchParams({ date });
      if (processId) params.set("process_id", processId);
      if (branchId) params.set("branch_id", branchId);
      const res = await hrmsApi.get<CoverageData>(`/api/wfm-ext/coverage?${params}`);
      setCoverage({ required_headcount: Number(res.required_headcount ?? 0), available_headcount: Number(res.available_headcount ?? 0), coverage_pct: Number(res.coverage_pct ?? 0), gaps: res.gaps ?? [] });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Failed to load coverage data"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [date, processId, branchId]);

  async function snapshot() {
    try { await hrmsApi.post("/api/wfm-ext/coverage/snapshot", { date, process_id: processId || undefined, branch_id: branchId || undefined }); setMessage("Coverage snapshot archived."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Failed to archive snapshot"); }
  }

  return <div className="space-y-5"><Message text={message} /><div className="rounded-3xl border bg-white p-4 shadow-sm"><div className="grid gap-3 md:grid-cols-4"><Field label="Date" type="date" value={date} onChange={setDate} /><Field label="Process ID" value={processId} onChange={setProcessId} placeholder="All processes" /><Field label="Branch ID" value={branchId} onChange={setBranchId} placeholder="All branches" /><div className="flex items-end gap-2"><button onClick={load} disabled={loading} className="rounded-2xl border px-4 py-3 text-sm font-semibold"><RefreshCcw className="inline h-4 w-4" /></button><button onClick={snapshot} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white"><Zap className="inline h-4 w-4" /> Snapshot</button></div></div></div>{loading ? <div className="flex justify-center py-16"><Loader className="h-8 w-8 animate-spin text-slate-400" /></div> : coverage && <div className="space-y-4"><div className="grid gap-4 md:grid-cols-3"><Stat title="Required Headcount" value={coverage.required_headcount} icon={<Users className="h-5 w-5" />} tone="bg-slate-100 text-slate-700" /><Stat title="Available Headcount" value={coverage.available_headcount} icon={<UserCheck className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" /><Stat title="Coverage" value={`${coverage.coverage_pct.toFixed(1)}%`} icon={<CalendarDays className="h-5 w-5" />} tone={coverage.coverage_pct >= 90 ? "bg-emerald-50 text-emerald-700" : coverage.coverage_pct >= 70 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"} /></div><div className="overflow-hidden rounded-3xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-black text-slate-950">Coverage Gaps</h2><p className="text-sm text-slate-500">{coverage.gaps.length} gaps</p></div>{coverage.gaps.length === 0 ? <div className="py-12 text-center text-slate-400">No coverage gaps.</div> : <table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-4">Process</th><th>Branch</th><th>Gap</th><th>Note</th></tr></thead><tbody>{coverage.gaps.map((gap, idx) => <tr key={idx} className="border-t"><td className="p-4">{gap.process ?? "—"}</td><td>{gap.branch ?? "—"}</td><td className="font-black">{gap.gap_count}</td><td className="text-xs text-slate-500">{gap.note ?? "—"}</td></tr>)}</tbody></table>}</div></div>}</div>;
}

function AttritionTab() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [processId, setProcessId] = useState("");
  const [summary, setSummary] = useState<AttritionSummary | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [showRecord, setShowRecord] = useState(false);
  const [form, setForm] = useState({ employee_id: "", exit_date: "", reason_category: "better_opportunity", is_voluntary: true });

  async function load() {
    setLoading(true); setMessage("");
    try {
      const params = new URLSearchParams({ month });
      if (processId) params.set("process_id", processId);
      const res = await hrmsApi.get<AttritionSummary>(`/api/wfm-ext/attrition/summary?${params}`);
      setSummary({ total_exits: Number(res.total_exits ?? 0), voluntary: Number(res.voluntary ?? 0), involuntary: Number(res.involuntary ?? 0), attrition_rate: Number(res.attrition_rate ?? 0), by_reason: res.by_reason ?? [] });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Failed to load attrition summary"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [month, processId]);

  async function submitRecord() {
    if (!form.employee_id.trim() || !form.exit_date) return setMessage("Employee ID and exit date are required.");
    try { await hrmsApi.post("/api/wfm-ext/attrition/record", form); setShowRecord(false); setForm({ employee_id: "", exit_date: "", reason_category: "better_opportunity", is_voluntary: true }); setMessage("Attrition record saved."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Failed to record attrition"); }
  }

  return <div className="space-y-5"><Message text={message} /><div className="flex flex-wrap items-end gap-3"><Field label="Month" type="month" value={month} onChange={setMonth} /><Field label="Process ID" value={processId} onChange={setProcessId} placeholder="All processes" /><button onClick={load} disabled={loading} className="rounded-2xl border px-4 py-3 text-sm font-semibold"><RefreshCcw className="inline h-4 w-4" /> Refresh</button><button onClick={() => setShowRecord(true)} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white"><Plus className="inline h-4 w-4" /> Record Attrition</button></div>{loading ? <div className="flex justify-center py-16"><Loader className="h-8 w-8 animate-spin text-slate-400" /></div> : summary && <div className="space-y-4"><div className="grid gap-4 md:grid-cols-4"><Stat title="Total Exits" value={summary.total_exits} icon={<TrendingDown className="h-5 w-5" />} tone="bg-slate-100 text-slate-700" /><Stat title="Voluntary" value={summary.voluntary} icon={<UserCheck className="h-5 w-5" />} tone="bg-amber-50 text-amber-700" /><Stat title="Involuntary" value={summary.involuntary} icon={<X className="h-5 w-5" />} tone="bg-rose-50 text-rose-700" /><Stat title="Attrition Rate" value={`${summary.attrition_rate.toFixed(1)}%`} icon={<TrendingDown className="h-5 w-5" />} tone={summary.attrition_rate < 5 ? "bg-emerald-50 text-emerald-700" : summary.attrition_rate < 10 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"} /></div><div className="overflow-hidden rounded-3xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-black text-slate-950">Exits by Reason</h2><p className="text-sm text-slate-500">{summary.by_reason.length} reasons</p></div>{summary.by_reason.length === 0 ? <div className="py-12 text-center text-slate-400">No attrition data.</div> : <table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-4">Reason</th><th>Count</th><th>Share</th></tr></thead><tbody>{summary.by_reason.map((row) => <tr key={row.reason} className="border-t"><td className="p-4 capitalize">{row.reason.replace(/_/g, " ")}</td><td>{row.count}</td><td>{row.pct.toFixed(1)}%</td></tr>)}</tbody></table>}</div></div>}{showRecord && <Modal title="Record Attrition" onClose={() => setShowRecord(false)} footer={<><button onClick={() => setShowRecord(false)} className="flex-1 rounded-2xl border py-3 text-sm font-semibold">Cancel</button><button onClick={submitRecord} className="flex-1 rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white">Record</button></>}><Field label="Employee ID / UUID" value={form.employee_id} onChange={(v) => setForm({ ...form, employee_id: v })} /><Field label="Exit Date" type="date" value={form.exit_date} onChange={(v) => setForm({ ...form, exit_date: v })} /><SelectField label="Reason Category" value={form.reason_category} onChange={(v) => setForm({ ...form, reason_category: v })} options={ATTRITION_REASONS.map((reason) => ({ value: reason, label: reason.replace(/_/g, " ") }))} /><button type="button" onClick={() => setForm({ ...form, is_voluntary: !form.is_voluntary })} className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${form.is_voluntary ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-600"}`}>{form.is_voluntary ? "Voluntary Exit" : "Involuntary Exit"}</button></Modal>}</div>;
}

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "swaps", label: "Roster Swaps", icon: <ArrowLeftRight className="h-4 w-4" /> },
  { key: "conflicts", label: "Conflicts", icon: <AlertTriangle className="h-4 w-4" /> },
  { key: "coverage", label: "Coverage", icon: <CalendarDays className="h-4 w-4" /> },
  { key: "attrition", label: "Attrition", icon: <TrendingDown className="h-4 w-4" /> },
];

export default function NativeWFMExtensions() {
  const [activeTab, setActiveTab] = useState<TabKey>("swaps");
  return <DashboardLayout><div className="space-y-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Workforce Management</p><h1 className="mt-2 text-3xl font-black text-slate-950">WFM Extensions</h1><p className="mt-2 max-w-4xl text-slate-600">Manage roster swaps, resolve scheduling conflicts, monitor coverage, and track attrition trends.</p></div></div><div className="flex flex-wrap gap-2 border-b border-slate-200">{TABS.map((tab) => <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`-mb-px inline-flex items-center gap-2 rounded-t-xl px-5 py-3 text-sm font-bold ${activeTab === tab.key ? "border border-b-white border-slate-200 bg-white text-slate-950" : "text-slate-500 hover:text-slate-700"}`}>{tab.icon}{tab.label}</button>)}</div><div className="space-y-5">{activeTab === "swaps" && <RosterSwapsTab />}{activeTab === "conflicts" && <ConflictsTab />}{activeTab === "coverage" && <CoverageTab />}{activeTab === "attrition" && <AttritionTab />}</div></div></DashboardLayout>;
}
