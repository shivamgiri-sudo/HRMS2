import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowRight, CheckCircle2, ClipboardList,
  Loader, RefreshCcw, UserMinus,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v ?? 0);

const toNum = (v: string): number => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

const EMPTY_FORM: FFFormState = {
  calculation_date: new Date().toISOString().slice(0, 10),
  notice_period_days: "",
  notice_shortfall_days: "0",
  notice_recovery: "0",
  earned_leave_encashment: "0",
  gratuity_amount: "0",
  salary_hold: "0",
  advances_recovery: "0",
  net_payable: "0",
};

const FF_STATUS_COLORS: Record<string, string> = {
  draft:    "bg-slate-100 text-slate-700",
  verified: "bg-blue-50 text-blue-700",
  approved: "bg-emerald-50 text-emerald-700",
  paid:     "bg-violet-50 text-violet-700",
};

const EXIT_STATUS_COLORS: Record<string, string> = {
  approved:      "bg-emerald-50 text-emerald-700",
  notice_period: "bg-cyan-50 text-cyan-700",
  notice_serving:"bg-cyan-50 text-cyan-700",
  exit_confirmed:"bg-green-100 text-green-800",
  accepted:      "bg-blue-50 text-blue-700",
};

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${cls}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

// ─── Prepare F&F Form ──────────────────────────────────────────────────────────

function PrepareFFForm({
  form,
  onChange,
  onSubmit,
  submitting,
}: {
  form: FFFormState;
  onChange: (f: FFFormState) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const set = (key: keyof FFFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...form, [key]: e.target.value });

  // Auto-calculate net payable
  const calcNet = () => {
    const leEncash = toNum(form.earned_leave_encashment);
    const gratuity = toNum(form.gratuity_amount);
    const noticeRec = toNum(form.notice_recovery);
    const hold = toNum(form.salary_hold);
    const advances = toNum(form.advances_recovery);
    const net = leEncash + gratuity - noticeRec - hold - advances;
    onChange({ ...form, net_payable: String(net) });
  };

  const fields: { key: keyof FFFormState; label: string; desc?: string; type?: string; deduction?: boolean }[] = [
    { key: "calculation_date", label: "Calculation Date", type: "date" },
    { key: "notice_period_days", label: "Notice Period Days", desc: "Total days of notice required" },
    { key: "notice_shortfall_days", label: "Notice Shortfall Days", desc: "Days short of full notice" },
    { key: "notice_recovery", label: "Notice Recovery (₹)", desc: "Amount recovered for shortfall", deduction: true },
    { key: "earned_leave_encashment", label: "Earned Leave Encashment (₹)", desc: "EL balance payout" },
    { key: "gratuity_amount", label: "Gratuity Amount (₹)", desc: "As per Gratuity Act" },
    { key: "salary_hold", label: "Salary Hold (₹)", desc: "Held back salary amount", deduction: true },
    { key: "advances_recovery", label: "Advance Recovery (₹)", desc: "Loans/advances to recover", deduction: true },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(({ key, label, desc, type, deduction }) => (
          <div key={key}>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              {label}
              {deduction && <span className="ml-1 text-xs text-rose-500">(deduction)</span>}
            </label>
            <input
              type={type === "date" ? "date" : "number"}
              min={type !== "date" ? "0" : undefined}
              value={form[key]}
              onChange={set(key)}
              className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors ${
                deduction ? "font-mono border-rose-100" : "font-mono"
              }`}
            />
            {desc && <p className="mt-1 text-xs text-slate-400">{desc}</p>}
          </div>
        ))}
      </div>

      {/* Auto-calc button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={calcNet}
          className="cursor-pointer rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
        >
          Auto-Calculate Net Payable
        </button>
      </div>

      {/* Net Payable */}
      <div>
        <label className="block text-sm font-black text-slate-700 mb-1.5">Net Payable (₹)</label>
        <input
          type="number"
          value={form.net_payable}
          onChange={set("net_payable")}
          className="w-full rounded-2xl border-2 border-slate-950 px-4 py-3 text-lg font-black font-mono outline-none focus:border-blue-400 transition-colors"
        />
      </div>

      <button
        onClick={onSubmit}
        disabled={submitting}
        className="w-full cursor-pointer rounded-2xl bg-slate-950 py-3.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {submitting ? <Loader className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
        Create F&F Settlement
      </button>
    </div>
  );
}

// ─── F&F Breakdown ─────────────────────────────────────────────────────────────

function FFBreakdown({ ff }: { ff: FFCalculation }) {
  const deductions = ff.notice_recovery + ff.salary_hold + ff.advances_recovery;
  const credits = ff.earned_leave_encashment + ff.gratuity_amount;

  return (
    <div className="space-y-4">
      {/* Credits */}
      <div>
        <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 mb-2">Credits / Entitlements</h4>
        <table className="w-full text-sm">
          <tbody>
            {[
              ["Earned Leave Encashment", ff.earned_leave_encashment],
              ["Gratuity Amount", ff.gratuity_amount],
            ].map(([label, amount]) => (
              <tr key={label as string} className="border-b last:border-0">
                <td className="py-2.5 text-slate-600">{label}</td>
                <td className="py-2.5 text-right font-mono font-semibold text-emerald-700">
                  {INR(amount as number)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-emerald-50">
              <td className="py-2.5 px-2 font-black text-emerald-800 rounded-l-xl">Total Credits</td>
              <td className="py-2.5 px-2 text-right font-black font-mono text-emerald-800 rounded-r-xl">
                {INR(credits)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Deductions */}
      <div>
        <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 mb-2">Deductions / Recoveries</h4>
        <table className="w-full text-sm">
          <tbody>
            {[
              ["Notice Recovery", ff.notice_recovery],
              ["Salary Hold", ff.salary_hold],
              ["Advance Recovery", ff.advances_recovery],
            ].map(([label, amount]) => (
              <tr key={label as string} className="border-b last:border-0">
                <td className="py-2.5 text-slate-600">{label}</td>
                <td className="py-2.5 text-right font-mono font-semibold text-rose-600">
                  – {INR(amount as number)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-rose-50">
              <td className="py-2.5 px-2 font-black text-rose-800 rounded-l-xl">Total Deductions</td>
              <td className="py-2.5 px-2 text-right font-black font-mono text-rose-800 rounded-r-xl">
                – {INR(deductions)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Notice Info */}
      <div className="flex gap-4 text-sm">
        <div className="rounded-xl bg-slate-50 p-3 flex-1">
          <p className="text-xs text-slate-500 font-semibold">Notice Period</p>
          <p className="font-bold text-slate-950 mt-1">{ff.notice_period_days} days</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 flex-1">
          <p className="text-xs text-slate-500 font-semibold">Shortfall</p>
          <p className="font-bold text-slate-950 mt-1">{ff.notice_shortfall_days} days</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 flex-1">
          <p className="text-xs text-slate-500 font-semibold">Calc. Date</p>
          <p className="font-mono font-bold text-slate-950 mt-1">{ff.calculation_date?.slice(0, 10)}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function NativeFullFinal() {
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

  // ── Load exit requests ───────────────────────────────────────────────────────
  const loadRequests = async () => {
    setLoadingRequests(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: ExitRequest[] }>(
        "/api/exit?limit=100&page=1"
      );
      const all = res.data ?? [];
      // Filter to statuses relevant for F&F
      const relevant = all.filter((r) =>
        ["approved", "notice_period", "notice_serving", "exit_confirmed", "accepted"].includes(r.status)
      );
      setExitRequests(relevant);
    } catch (err: unknown) {
      const e = err as Error;
      showMessage(e.message || "Failed to load exit requests.", "error");
    } finally {
      setLoadingRequests(false);
    }
  };

  // ── Load F&F for selected exit request ──────────────────────────────────────
  const loadFF = async (exitId: string) => {
    setLoadingFF(true);
    setFfCalc(null);
    setForm(EMPTY_FORM);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: FFCalculation }>(
        `/api/exit/ff/${exitId}`
      );
      if (res.data) {
        setFfCalc(res.data);
      }
    } catch (err: unknown) {
      const e = err as Error;
      // 404 means no F&F yet — that's normal
      if (!e.message?.includes("404") && !e.message?.includes("not found")) {
        showMessage(e.message || "Failed to load F&F calculation.", "error");
      }
    } finally {
      setLoadingFF(false);
    }
  };

  useEffect(() => { void loadRequests(); }, []);

  const selectRequest = (req: ExitRequest) => {
    setSelectedRequest(req);
    setFfCalc(null);
    setForm(EMPTY_FORM);
    void loadFF(req.id);
  };

  // ── Create F&F ───────────────────────────────────────────────────────────────
  const createFF = async () => {
    if (!selectedRequest) return;
    setSubmitting(true);
    setMessage("");
    try {
      await hrmsApi.post(`/api/exit/ff/${selectedRequest.id}`, {
        calculation_date: form.calculation_date,
        notice_period_days: toNum(form.notice_period_days),
        notice_shortfall_days: toNum(form.notice_shortfall_days),
        notice_recovery: toNum(form.notice_recovery),
        earned_leave_encashment: toNum(form.earned_leave_encashment),
        gratuity_amount: toNum(form.gratuity_amount),
        salary_hold: toNum(form.salary_hold),
        advances_recovery: toNum(form.advances_recovery),
        net_payable: toNum(form.net_payable),
      });
      showMessage("F&F settlement created successfully.", "success");
      await loadFF(selectedRequest.id);
    } catch (err: unknown) {
      const e = err as Error;
      showMessage(e.message || "Failed to create F&F.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Approve F&F ──────────────────────────────────────────────────────────────
  const approveFF = async () => {
    if (!ffCalc) return;
    setApproving(true);
    setMessage("");
    try {
      await hrmsApi.post(`/api/exit/ff/${ffCalc.id}/approve`, {});
      showMessage("F&F settlement approved.", "success");
      setFfCalc({ ...ffCalc, status: "approved", approved_at: new Date().toISOString() });
    } catch (err: unknown) {
      const e = err as Error;
      showMessage(e.message || "Approval failed.", "error");
    } finally {
      setApproving(false);
    }
  };

  function showMessage(msg: string, type: "info" | "success" | "error") {
    setMessage(msg);
    setMessageType(type);
  }

  const messageColors = {
    info:    "border-blue-200 bg-blue-50 text-blue-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    error:   "border-rose-200 bg-rose-50 text-rose-800",
  };

  const MessageIcon = messageType === "success" ? CheckCircle2 : AlertTriangle;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">HR Operations</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Full & Final Settlement</h1>
            <p className="mt-2 max-w-4xl text-slate-600">
              Prepare and approve F&F settlements for employees completing exit process.
            </p>
          </div>
          <button
            onClick={() => void loadRequests()}
            disabled={loadingRequests}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {message && (
          <div className={`flex items-center gap-3 rounded-2xl border p-4 text-sm font-bold ${messageColors[messageType]}`}>
            <MessageIcon className="h-4 w-4 flex-shrink-0" />
            {message}
          </div>
        )}

        {/* Split Panel */}
        <div className="flex gap-6 items-start">
          {/* Left: Exit Requests List */}
          <div className="w-80 flex-shrink-0 rounded-3xl border bg-white shadow-sm overflow-hidden">
            <div className="border-b p-5">
              <h2 className="font-black text-slate-950">Exit Requests</h2>
              <p className="text-sm text-slate-500">{exitRequests.length} eligible for F&F</p>
            </div>

            {loadingRequests ? (
              <div className="flex items-center justify-center py-12">
                <Loader className="h-7 w-7 animate-spin text-slate-400" />
              </div>
            ) : exitRequests.length === 0 ? (
              <div className="py-12 text-center text-slate-400 px-4">
                <UserMinus className="mx-auto mb-3 h-9 w-9 opacity-30" />
                <p className="font-semibold text-sm">No eligible exit requests found.</p>
              </div>
            ) : (
              <div className="divide-y max-h-[600px] overflow-y-auto">
                {exitRequests.map((req) => (
                  <button
                    key={req.id}
                    onClick={() => selectRequest(req)}
                    className={`w-full text-left p-4 transition-colors cursor-pointer ${
                      selectedRequest?.id === req.id
                        ? "bg-slate-950 text-white"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={`font-bold truncate text-sm ${selectedRequest?.id === req.id ? "text-white" : "text-slate-950"}`}>
                          {req.employee_name ?? req.employee_id}
                        </p>
                        {req.employee_code && (
                          <p className={`text-xs font-mono mt-0.5 ${selectedRequest?.id === req.id ? "text-slate-300" : "text-slate-500"}`}>
                            {req.employee_code}
                          </p>
                        )}
                        <p className={`text-xs mt-1 capitalize ${selectedRequest?.id === req.id ? "text-slate-300" : "text-slate-500"}`}>
                          {req.exit_type} — {req.exit_sub_type?.replace(/_/g, " ")}
                        </p>
                        <p className={`text-xs mt-1 font-mono ${selectedRequest?.id === req.id ? "text-slate-400" : "text-slate-400"}`}>
                          LWD: {req.last_working_day_confirmed ?? req.last_working_day_proposed ?? "TBD"}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <Badge
                          label={req.status}
                          cls={selectedRequest?.id === req.id
                            ? "bg-white/20 text-white"
                            : (EXIT_STATUS_COLORS[req.status] ?? "bg-slate-100 text-slate-600")}
                        />
                        {selectedRequest?.id === req.id && (
                          <ArrowRight className="h-3.5 w-3.5 text-white/60" />
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: F&F Detail / Form */}
          <div className="flex-1 min-w-0">
            {!selectedRequest ? (
              <div className="rounded-3xl border bg-white shadow-sm py-20 text-center text-slate-400">
                <ClipboardList className="mx-auto mb-3 h-12 w-12 opacity-20" />
                <p className="font-semibold">Select an exit request to prepare F&F settlement.</p>
              </div>
            ) : loadingFF ? (
              <div className="rounded-3xl border bg-white shadow-sm flex items-center justify-center py-20">
                <Loader className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="space-y-5">
                {/* Employee Summary Card */}
                <div className="rounded-3xl border bg-white shadow-sm p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-black text-slate-950">
                        {selectedRequest.employee_name ?? selectedRequest.employee_id}
                      </h3>
                      {selectedRequest.employee_code && (
                        <p className="text-sm font-mono text-slate-500 mt-0.5">{selectedRequest.employee_code}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <Badge
                          label={selectedRequest.status}
                          cls={EXIT_STATUS_COLORS[selectedRequest.status] ?? "bg-slate-100 text-slate-600"}
                        />
                        <span className="text-xs text-slate-500 capitalize">
                          {selectedRequest.exit_type} · {selectedRequest.exit_sub_type?.replace(/_/g, " ")}
                        </span>
                        {(selectedRequest.last_working_day_confirmed ?? selectedRequest.last_working_day_proposed) && (
                          <span className="text-xs font-mono text-slate-500">
                            LWD: {selectedRequest.last_working_day_confirmed ?? selectedRequest.last_working_day_proposed}
                          </span>
                        )}
                      </div>
                    </div>
                    {ffCalc && (
                      <Badge
                        label={`F&F: ${ffCalc.status}`}
                        cls={FF_STATUS_COLORS[ffCalc.status] ?? "bg-slate-100 text-slate-600"}
                      />
                    )}
                  </div>
                </div>

                {/* F&F Content */}
                {!ffCalc ? (
                  /* No F&F yet — show form */
                  <div className="rounded-3xl border bg-white shadow-sm overflow-hidden">
                    <div className="border-b p-5">
                      <h2 className="font-black text-slate-950">Prepare F&F Settlement</h2>
                      <p className="text-sm text-slate-500">Enter settlement components below.</p>
                    </div>
                    <div className="p-6">
                      <PrepareFFForm
                        form={form}
                        onChange={setForm}
                        onSubmit={createFF}
                        submitting={submitting}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    {/* F&F Breakdown */}
                    <div className="rounded-3xl border bg-white shadow-sm overflow-hidden">
                      <div className="border-b p-5 flex items-center justify-between">
                        <div>
                          <h2 className="font-black text-slate-950">F&F Breakdown</h2>
                          <p className="text-sm text-slate-500">
                            Prepared on {ffCalc.calculation_date?.slice(0, 10)}
                          </p>
                        </div>
                        <Badge
                          label={ffCalc.status}
                          cls={FF_STATUS_COLORS[ffCalc.status] ?? "bg-slate-100 text-slate-600"}
                        />
                      </div>
                      <div className="p-6">
                        <FFBreakdown ff={ffCalc} />
                      </div>
                    </div>

                    {/* Net Payable Summary Card */}
                    <div className="rounded-3xl bg-slate-950 p-6 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-400">Final Net Payable</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          After all credits and recoveries
                        </p>
                      </div>
                      <p className={`text-3xl font-black font-mono ${
                        ffCalc.net_payable >= 0 ? "text-white" : "text-rose-400"
                      }`}>
                        {INR(ffCalc.net_payable)}
                      </p>
                    </div>

                    {/* Approve Button */}
                    {ffCalc.status === "draft" || ffCalc.status === "verified" ? (
                      <button
                        onClick={approveFF}
                        disabled={approving}
                        className="w-full cursor-pointer rounded-2xl bg-emerald-600 py-4 text-sm font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {approving ? (
                          <Loader className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        Approve F&F Settlement
                      </button>
                    ) : ffCalc.status === "approved" ? (
                      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
                        <div>
                          <p className="font-bold text-emerald-900 text-sm">Settlement Approved</p>
                          {ffCalc.approved_at && (
                            <p className="text-xs text-emerald-700 mt-0.5">
                              Approved on {new Date(ffCalc.approved_at).toLocaleDateString("en-IN")}
                            </p>
                          )}
                        </div>
                      </div>
                    ) : ffCalc.status === "paid" ? (
                      <div className="flex items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4">
                        <CheckCircle2 className="h-5 w-5 text-violet-600 flex-shrink-0" />
                        <p className="font-bold text-violet-900 text-sm">Settlement Paid</p>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
