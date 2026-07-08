import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ClipboardList,
  Eye,
  Filter,
  Loader2,
  Mail,
  Phone,
  Search,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

// ─── Types ────────────────────────────────────────────────────────────────────

type Candidate = {
  id: string;
  candidate_code?: string;
  q_token?: string;
  full_name?: string;
  mobile?: string;
  email?: string;
  branch_name?: string;
  role_applied?: string;
  recruiter_name?: string;
  status?: string;
  walkin_end_stage?: string;
  created_at?: string;
  updated_at?: string;
};

type Assignment = {
  candidate_id: string;
  recruiter_name?: string;
  recruiter_mobile?: string;
  recruiter_email?: string;
  branch_name?: string;
  assignment_status?: string;
  assigned_at?: string;
};

type Submission = {
  candidate_id?: string;
  candidate_code?: string;
  submitted_at?: string;
  walkin_end_stage?: string;
  final_decision?: string;
  interviewed_for_process?: string;
  round1_result?: string;
  round2_result?: string;
  round3_result?: string;
  offer_salary?: string;
  offer_doj?: string;
  reporting_timing?: string;
};

type LogRow = {
  id: string;
  candidate_id: string;
  old_status?: string;
  new_status?: string;
  event_type?: string;
  event_note?: string;
  created_at?: string;
};

type EnrichedCandidate = Candidate & {
  assignment?: Assignment;
  submission?: Submission;
  logs?: LogRow[];
};

// Interview feedback form state
type FeedbackForm = {
  interviewedForProcess: string;
  walkinEndStage: string;
  finalDecision: string;
  round1Result: string;
  round1Voc: string;
  round1Remarks: string;
  round2Result: string;
  round2Remarks: string;
  round3Result: string;
  round3Remarks: string;
  offerSalary: string;
  offerDoj: string;
  reportingTiming: string;
  followupRequired: boolean;
  followupDate: string;
  followupReason: string;
};

const EMPTY_FEEDBACK: FeedbackForm = {
  interviewedForProcess: "",
  walkinEndStage: "",
  finalDecision: "",
  round1Result: "",
  round1Voc: "",
  round1Remarks: "",
  round2Result: "",
  round2Remarks: "",
  round3Result: "",
  round3Remarks: "",
  offerSalary: "",
  offerDoj: "",
  reportingTiming: "",
  followupRequired: false,
  followupDate: "",
  followupReason: "",
};

const VALID_PROCESSES = ["Onfido", "BBB", "Reginald", "Finnable", "GS1", "GPI", "FF", "DRA", "Bellavita", "AW", "Clovia", "Housing", "LP", "Neeman's", "Birlanu", "GNC", "Du Dugital", "Exicom", "Solveasy", "Dalmia"];
const VALID_STAGES = [
  "Arrival",
  "Round 1- HR Screening",
  "Interview - Skill Test",
  "Round 2- Op's",
  "Round 3- Client",
  "Selection Discussion",
];
const VALID_DECISIONS = ["Selected", "Rejected", "Hold", "Client Round - Pending", "No Show"];
const ROUND_RESULTS = ["Cleared", "Rejected", "On Hold"];
const STAGE_RANK: Record<string, number> = {
  "Arrival": 0,
  "Round 1- HR Screening": 1,
  "Interview - Skill Test": 2,
  "Round 2- Op's": 3,
  "Round 3- Client": 4,
  "Selection Discussion": 5,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (value?: string) => {
  if (!value) return "-";
  // MySQL returns bare "YYYY-MM-DD HH:mm:ss" (no timezone); treat as UTC so
  // toLocaleString("en-IN") converts correctly to IST for display.
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

const statusClass = (status?: string) => {
  const s = (status || "").toLowerCase();
  if (s.includes("selected")) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (s.includes("reject") || s.includes("no show")) return "bg-rose-50 text-rose-700 ring-rose-200";
  if (s.includes("hold") || s.includes("pending")) return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-blue-50 text-blue-700 ring-blue-200";
};

const StatCard = ({
  title, value, icon, tone,
}: {
  title: string; value: string | number; icon: React.ReactNode; tone: string;
}) => (
  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
      </div>
      <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
    </div>
  </div>
);

// ─── Interview Feedback Modal ─────────────────────────────────────────────────

function InterviewFeedbackModal({
  candidate,
  onClose,
  onSuccess,
}: {
  candidate: EnrichedCandidate;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<FeedbackForm>(EMPTY_FEEDBACK);
  const [saving, setSaving] = useState(false);
  const [processOptions, setProcessOptions] = useState<string[]>(VALID_PROCESSES);

  useEffect(() => {
    hrmsApi.get<{ success: boolean; data: any }>("/api/ats/form-config/bootstrap")
      .then(res => {
        const opts = res.data?.hiringProcessOptions;
        if (Array.isArray(opts) && opts.length > 0) setProcessOptions(opts);
      })
      .catch(() => {});
  }, []);

  const rank = STAGE_RANK[form.walkinEndStage] ?? -1;
  const isSelected = form.finalDecision === "Selected";

  const set = (key: keyof FeedbackForm, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.interviewedForProcess) { toast.error("Select a process."); return; }
    if (!form.walkinEndStage) { toast.error("Select the walk-in end stage."); return; }
    if (!form.finalDecision) { toast.error("Select a final decision."); return; }
    if (rank >= 1 && !form.round1Result) { toast.error("Round 1 result is required."); return; }
    if (rank >= 3 && !form.round2Result) { toast.error("Round 2 result is required."); return; }
    setSaving(true);
    try {
      await hrmsApi.post("/api/ats-full-parity/recruiter-submission", {
        candidateId: candidate.id,
        qToken: candidate.q_token,
        interviewedForProcess: form.interviewedForProcess,
        walkinEndStage: form.walkinEndStage,
        finalDecision: form.finalDecision,
        round1Result: form.round1Result || undefined,
        round1Voc: form.round1Voc || undefined,
        round1Remarks: form.round1Remarks || undefined,
        round2Result: form.round2Result || undefined,
        round2Remarks: form.round2Remarks || undefined,
        round3Result: form.round3Result || undefined,
        round3Remarks: form.round3Remarks || undefined,
        offerSalary: isSelected ? form.offerSalary || undefined : undefined,
        offerDoj: isSelected ? form.offerDoj || undefined : undefined,
        reportingTiming: isSelected ? form.reportingTiming || undefined : undefined,
        followupRequired: form.followupRequired,
        followupDate: form.followupRequired ? form.followupDate || undefined : undefined,
        followupReason: form.followupRequired ? form.followupReason || undefined : undefined,
      });
      toast.success("Interview feedback saved successfully.");
      onSuccess();
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message || "Failed to save feedback.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-blue-600">Recruiter Interview Feedback</p>
            <h2 className="mt-0.5 text-lg font-black text-slate-950">{candidate.full_name || "Candidate"}</h2>
            <p className="text-xs text-slate-500">{candidate.candidate_code} · {candidate.branch_name || "-"}</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 hover:bg-slate-100">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="space-y-5 p-6">
          {/* Core fields */}
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Process <span className="text-rose-500">*</span></span>
              <select
                value={form.interviewedForProcess}
                onChange={(e) => set("interviewedForProcess", e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
              >
                <option value="">Select</option>
                {processOptions.map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">End Stage <span className="text-rose-500">*</span></span>
              <select
                value={form.walkinEndStage}
                onChange={(e) => set("walkinEndStage", e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
              >
                <option value="">Select</option>
                {VALID_STAGES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Final Decision <span className="text-rose-500">*</span></span>
              <select
                value={form.finalDecision}
                onChange={(e) => set("finalDecision", e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
              >
                <option value="">Select</option>
                {VALID_DECISIONS.map((d) => <option key={d}>{d}</option>)}
              </select>
            </label>
          </div>

          {/* Round 1 — visible when rank >= 1 */}
          {rank >= 1 && (
            <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
              <p className="text-sm font-bold text-slate-700">Round 1 — HR Screening</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Result <span className="text-rose-500">*</span></span>
                  <select
                    value={form.round1Result}
                    onChange={(e) => set("round1Result", e.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
                  >
                    <option value="">Select</option>
                    {ROUND_RESULTS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </label>
                {form.round1Result === "Rejected" && (
                  <label className="space-y-1.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">VOC (rejection reason)</span>
                    <input
                      value={form.round1Voc}
                      onChange={(e) => set("round1Voc", e.target.value)}
                      placeholder="Reason for rejection"
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                    />
                  </label>
                )}
              </div>
              <label className="space-y-1.5 block">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Remarks</span>
                <input
                  value={form.round1Remarks}
                  onChange={(e) => set("round1Remarks", e.target.value)}
                  placeholder="Optional notes"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                />
              </label>
            </div>
          )}

          {/* Round 2 — visible when rank >= 3 */}
          {rank >= 3 && (
            <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
              <p className="text-sm font-bold text-slate-700">Round 2 — Operations</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Result <span className="text-rose-500">*</span></span>
                  <select
                    value={form.round2Result}
                    onChange={(e) => set("round2Result", e.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
                  >
                    <option value="">Select</option>
                    {ROUND_RESULTS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Remarks</span>
                  <input
                    value={form.round2Remarks}
                    onChange={(e) => set("round2Remarks", e.target.value)}
                    placeholder="Optional"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Round 3 — visible when rank >= 4 */}
          {rank >= 4 && (
            <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
              <p className="text-sm font-bold text-slate-700">Round 3 — Client</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Result</span>
                  <select
                    value={form.round3Result}
                    onChange={(e) => set("round3Result", e.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
                  >
                    <option value="">Select</option>
                    {ROUND_RESULTS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Remarks</span>
                  <input
                    value={form.round3Remarks}
                    onChange={(e) => set("round3Remarks", e.target.value)}
                    placeholder="Optional"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Selection discussion fields */}
          {isSelected && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
              <p className="text-sm font-bold text-emerald-800">Selection Discussion</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Offer Salary</span>
                  <input
                    value={form.offerSalary}
                    onChange={(e) => set("offerSalary", e.target.value)}
                    placeholder="e.g. 18000"
                    className="h-10 w-full rounded-xl border border-emerald-200 bg-white px-3 text-sm outline-none focus:border-emerald-400"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Date of Joining</span>
                  <input
                    type="date"
                    value={form.offerDoj}
                    onChange={(e) => set("offerDoj", e.target.value)}
                    className="h-10 w-full rounded-xl border border-emerald-200 bg-white px-3 text-sm outline-none focus:border-emerald-400"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Reporting Timing</span>
                  <input
                    value={form.reportingTiming}
                    onChange={(e) => set("reportingTiming", e.target.value)}
                    placeholder="e.g. 9:00 AM"
                    className="h-10 w-full rounded-xl border border-emerald-200 bg-white px-3 text-sm outline-none focus:border-emerald-400"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Follow-up */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="followupRequired"
              checked={form.followupRequired}
              onChange={(e) => set("followupRequired", e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <label htmlFor="followupRequired" className="text-sm font-medium text-slate-700">Schedule follow-up</label>
          </div>
          {form.followupRequired && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Follow-up Date</span>
                <input
                  type="date"
                  value={form.followupDate}
                  onChange={(e) => set("followupDate", e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Follow-up Reason</span>
                <input
                  value={form.followupReason}
                  onChange={(e) => set("followupReason", e.target.value)}
                  placeholder="Why follow up?"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                />
              </label>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <button
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60 hover:bg-slate-800"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Saving…" : "Save Feedback"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NativeATSCandidateMaster() {
  const { roleKeys } = useWorkforceAccess();
  const isRecruiter =
    roleKeys.includes("recruiter") &&
    !roleKeys.includes("admin") &&
    !roleKeys.includes("hr") &&
    !roleKeys.includes("super_admin");

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<EnrichedCandidate[]>([]);
  const [selected, setSelected] = useState<EnrichedCandidate | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<EnrichedCandidate | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [branch, setBranch] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [error, setError] = useState("");

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      // Recruiters see only their own assigned candidates; admins/HR see all
      const endpoint = isRecruiter
        ? "/api/ats/recruiter/my-candidates"
        : "/api/ats/candidates?limit=500&page=1";

      const res = await hrmsApi.get<{ success: boolean; data: any[]; total?: number }>(endpoint);

      const raw: any[] = res.data ?? [];

      const enriched: EnrichedCandidate[] = raw.map((c: any): EnrichedCandidate => ({
        id: c.candidateId ?? c.id,
        candidate_code: c.candidateCode ?? c.candidate_code,
        q_token: c.qToken ?? c.q_token ?? c.candidate_code,
        full_name: c.fullName ?? c.full_name,
        mobile: c.mobile,
        email: c.email ?? undefined,
        branch_name: c.branch ?? c.applied_for_branch ?? c.branch_name ?? undefined,
        role_applied: c.process ?? c.applied_for_process ?? undefined,
        recruiter_name: c.recruiter_name ?? c.recruiter_assigned_name ?? undefined,
        status: c.status ?? c.current_stage ?? "Applied",
        walkin_end_stage: c.status ?? c.current_stage ?? undefined,
        created_at: c.created_at,
        updated_at: c.updated_at,
        assignment: undefined,
        logs: [],
      }));

      setRows(enriched);
      setSelected(enriched[0] || null);
    } catch (err: any) {
      setError(err?.message || "Unable to load candidates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, [isRecruiter]);

  useEffect(() => {
    if (!selected) return;
    hrmsApi
      .get<{ success: boolean; data: any[] }>(`/api/ats/candidates/${selected.id}/stage-logs`)
      .then((r) => {
        const logs: LogRow[] = (r.data ?? []).map((l: any) => ({
          id: l.id,
          candidate_id: l.candidate_id,
          old_status: l.from_stage ?? undefined,
          new_status: l.to_stage ?? undefined,
          event_type: l.to_stage ? `Stage → ${l.to_stage}` : "Journey Event",
          event_note: l.remarks ?? undefined,
          created_at: l.stage_date ?? l.created_at,
        }));
        setSelected((prev) => (prev?.id === selected.id ? { ...prev, logs } : prev));
      })
      .catch(() => {});
  }, [selected?.id]);

  const branches = useMemo(
    () => ["All", ...Array.from(new Set(rows.map((r) => r.branch_name).filter(Boolean))) as string[]],
    [rows]
  );
  const statuses = useMemo(
    () => ["All", ...Array.from(new Set(rows.map((r) => r.status || "Waiting").filter(Boolean))) as string[]],
    [rows]
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const to = toDate ? new Date(`${toDate}T23:59:59`).getTime() : null;
    return rows.filter((r) => {
      const finalStatus = r.status || "Waiting";
      const branchName = r.branch_name || "";
      const created = new Date(r.created_at || 0).getTime();
      const matchText =
        !q ||
        [r.candidate_code, r.full_name, r.mobile, r.email, r.role_applied, branchName, r.recruiter_name]
          .join(" ")
          .toLowerCase()
          .includes(q);
      const matchStatus = status === "All" || finalStatus === status;
      const matchBranch = branch === "All" || branchName === branch;
      const matchFrom = !from || created >= from;
      const matchTo = !to || created <= to;
      return matchText && matchStatus && matchBranch && matchFrom && matchTo;
    });
  }, [rows, query, status, branch, fromDate, toDate]);

  const SELECTED_STAGES = ["selected", "bgv_pending", "bgv_verified", "payroll_validated", "offer_pending", "offer_accepted", "joined"];
  const CLOSED_STAGES = ["rejected", "rejected_by_branch_head", "no_show"];
  const selectedCount = filtered.filter((r) => SELECTED_STAGES.includes((r.status ?? "").toLowerCase())).length;
  const closedCount = filtered.filter((r) => CLOSED_STAGES.includes((r.status ?? "").toLowerCase())).length;
  const waitingCount = filtered.filter((r) => {
    const s = (r.status ?? "").toLowerCase();
    return !SELECTED_STAGES.includes(s) && !CLOSED_STAGES.includes(s);
  }).length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Native ATS</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              {isRecruiter ? "My Assigned Candidates" : "Candidate Master & Journey"}
            </h1>
            <p className="mt-2 max-w-3xl text-slate-600">
              {isRecruiter
                ? "Candidates assigned to you. Submit interview feedback directly from the journey panel."
                : "Track every walk-in from public candidate registration through selection, onboarding and employee conversion."}
            </p>
          </div>
          <button
            onClick={() => void loadData()}
            className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-slate-800"
          >
            Refresh Data
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard title="Filtered Candidates" value={filtered.length} icon={<Users className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" />
          <StatCard title="Waiting Queue" value={waitingCount} icon={<ClipboardList className="h-5 w-5" />} tone="bg-amber-50 text-amber-700" />
          <StatCard title="Selected" value={selectedCount} icon={<UserCheck className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" />
          <StatCard title="Closed / Hold" value={closedCount} icon={<Filter className="h-5 w-5" />} tone="bg-rose-50 text-rose-700" />
        </div>

        {/* Filters */}
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, mobile, candidate ID, recruiter…"
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400 focus:bg-white"
              />
            </label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-blue-400 focus:bg-white">
              {statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-blue-400 focus:bg-white">
              {branches.map((b) => <option key={b}>{b}</option>)}
            </select>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400 focus:bg-white" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400 focus:bg-white" />
          </div>
        </div>

        {/* Table + Journey panel */}
        <div className="grid gap-5 xl:grid-cols-[1.25fr_0.85fr]">
          {/* Table */}
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-bold text-slate-950">Candidates</h2>
              <p className="text-sm text-slate-500">
                {isRecruiter ? "Your assigned queue — click View to see full journey and submit feedback." : "Click View to inspect full journey."}
              </p>
            </div>
            <div className="max-h-[620px] overflow-auto">
              {loading ? (
                <div className="p-8 text-center text-slate-500">Loading candidates…</div>
              ) : !filtered.length ? (
                <div className="p-8 text-center text-slate-500">No candidates found.</div>
              ) : (
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Candidate</th>
                      <th className="px-4 py-3">Contact</th>
                      <th className="px-4 py-3">Branch / Role</th>
                      {!isRecruiter && <th className="px-4 py-3">Recruiter</th>}
                      <th className="px-4 py-3">Stage</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => {
                      const finalStatus = r.status || "Waiting";
                      return (
                        <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                          <td className="px-4 py-3">
                            <div className="font-bold text-slate-900">{r.full_name || "-"}</div>
                            <div className="text-xs text-slate-500">{r.candidate_code || "-"}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div>{r.mobile || "-"}</div>
                            <div className="text-xs">{r.email || "-"}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div>{r.branch_name || "-"}</div>
                            <div className="text-xs">{r.role_applied || "-"}</div>
                          </td>
                          {!isRecruiter && (
                            <td className="px-4 py-3 text-slate-600">{r.recruiter_name || "-"}</td>
                          )}
                          <td className="px-4 py-3 text-slate-600">{r.walkin_end_stage || "Arrival"}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${statusClass(finalStatus)}`}>
                              {finalStatus}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setSelected(r)}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                              >
                                <Eye className="h-3.5 w-3.5" /> View
                              </button>
                              <button
                                onClick={() => setFeedbackTarget(r)}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100"
                              >
                                <ClipboardList className="h-3.5 w-3.5" /> Feedback
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Journey panel */}
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            {!selected ? (
              <div className="flex min-h-[420px] items-center justify-center text-center text-slate-500">
                Select a candidate to view journey.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">Candidate Journey</p>
                    <h2 className="mt-1 text-2xl font-black text-slate-950">{selected.full_name || "-"}</h2>
                    <p className="text-sm text-slate-500">{selected.candidate_code || "-"}</p>
                  </div>
                  <button
                    onClick={() => setFeedbackTarget(selected)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100 shrink-0"
                  >
                    <ClipboardList className="h-4 w-4" />
                    Add Feedback
                  </button>
                </div>

                <div className="grid gap-3 text-sm">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="font-bold text-slate-900">Registration</div>
                    <div className="mt-2 flex items-center gap-2 text-slate-600">
                      <CalendarDays className="h-4 w-4" /> {fmt(selected.created_at)}
                    </div>
                    <div className="mt-1 text-slate-600">Branch: {selected.branch_name || "-"}</div>
                    <div className="mt-1 text-slate-600">Role: {selected.role_applied || "-"}</div>
                  </div>

                  <div className="rounded-2xl bg-blue-50 p-4">
                    <div className="font-bold text-blue-950">Recruiter</div>
                    <div className="mt-2 text-blue-800">{selected.recruiter_name || "-"}</div>
                    {selected.assignment?.recruiter_mobile && (
                      <div className="mt-1 flex items-center gap-2 text-blue-700">
                        <Phone className="h-4 w-4" /> {selected.assignment.recruiter_mobile}
                      </div>
                    )}
                    {selected.assignment?.recruiter_email && (
                      <div className="mt-1 flex items-center gap-2 text-blue-700">
                        <Mail className="h-4 w-4" /> {selected.assignment.recruiter_email}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl bg-emerald-50 p-4">
                    <div className="font-bold text-emerald-950">Latest Update</div>
                    <div className="mt-2 text-emerald-800">Decision: {selected.submission?.final_decision || selected.status || "Waiting"}</div>
                    <div className="mt-1 text-emerald-700">Stage: {selected.submission?.walkin_end_stage || selected.walkin_end_stage || "Arrival"}</div>
                    <div className="mt-1 text-emerald-700">Process: {selected.submission?.interviewed_for_process || "-"}</div>
                    <div className="mt-1 text-emerald-700">Submitted: {fmt(selected.submission?.submitted_at)}</div>
                  </div>

                  {selected.submission?.final_decision === "Selected" && (
                    <div className="rounded-2xl bg-violet-50 p-4">
                      <div className="font-bold text-violet-950">Selection Discussion</div>
                      <div className="mt-2 text-violet-800">Offer Salary: {selected.submission?.offer_salary || "-"}</div>
                      <div className="mt-1 text-violet-700">Date of Joining: {selected.submission?.offer_doj || "-"}</div>
                      <div className="mt-1 text-violet-700">Reporting Timing: {selected.submission?.reporting_timing || "-"}</div>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="font-bold text-slate-950">Audit Timeline</h3>
                  <div className="mt-3 space-y-3">
                    {!selected.logs?.length ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                        No journey log found yet.
                      </div>
                    ) : (
                      selected.logs.slice(0, 8).map((log) => (
                        <div key={log.id} className="rounded-2xl border border-slate-100 p-4">
                          <div className="text-sm font-bold text-slate-900">{log.event_type || "Journey Event"}</div>
                          <div className="mt-1 text-xs text-slate-500">{fmt(log.created_at)}</div>
                          <div className="mt-2 text-sm text-slate-600">
                            {log.event_note || `${log.old_status || "-"} → ${log.new_status || "-"}`}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Interview feedback modal */}
      {feedbackTarget && (
        <InterviewFeedbackModal
          candidate={feedbackTarget}
          onClose={() => setFeedbackTarget(null)}
          onSuccess={() => {
            setFeedbackTarget(null);
            void loadData();
          }}
        />
      )}
    </DashboardLayout>
  );
}
