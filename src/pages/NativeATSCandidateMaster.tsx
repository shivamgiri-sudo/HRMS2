import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Filter,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Search,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
  // Score fields from ats_candidate + assessment engine
  skilltest_typing?: number | null;
  skilltest_ai?: number | null;
  skilltest_result?: string | null;
  assessment_percentage?: number | null;
  typing_net_wpm?: number | null;
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

// Full feedback form — matches RecruiterWorkspace Form type exactly
type FeedbackForm = {
  processName: string;
  finalDecision: string;
  stageName: string;
  round1Result: string;
  round1Voc: string;
  round1Remarks: string;
  skillTypingScore: string;
  skillAiScore: string;
  skillResult: string;
  skillVoc: string;
  skillRemarks: string;
  round2Result: string;
  round2Voc: string;
  round2Remarks: string;
  round3Result: string;
  round3Voc: string;
  round3Remarks: string;
  secondRoundInterviewerId: string;
  secondRoundInterviewerNameSnapshot: string;
  clientRoundConducted: boolean;
  clientRoundInterviewerName: string;
  clientRoundResult: string;
  clientRoundRemarks: string;
  followupRequired: boolean;
  followupDate: string;
  followupReason: string;
  offerSalary: string;
  offerDoj: string;
  reportingTiming: string;
  otDetails: string;
  performanceIncentives: string;
};

type Config = {
  processOptions: string[];
  decisionOptions: string[];
  stageOptions: string[];
  vocOptions: string[];
  skillVocOptions: string[];
};

const DEFAULT_CONFIG: Config = {
  processOptions: [],
  decisionOptions: ["Selected", "Rejected", "Hold", "Client Round - Pending", "No Show"],
  stageOptions: ["Arrival", "Round 1- HR Screening", "Interview - Skill Test", "Round 2- Op's", "Round 3- Client", "Selection Discussion"],
  vocOptions: ["Undergraduate / Qualification Issue", "Poor Communication Skill", "Poor Reading / Comprehension", "Salary Issue", "Shift / Timing Issue", "Location / Travel Issue", "Stability Concern", "Documentation Issue", "Role / Process Mismatch", "Candidate Not Interested", "No Show", "Age Barrier"],
  skillVocOptions: ["Typing Speed Issue", "Typing Accuracy Issue", "Pehchan Score Low", "Poor Sales Skill", "Vocabulary / Grammar Issue", "Computer / System Skill Gap", "Assessment Incomplete / Failed"],
};

const EMPTY_FORM: FeedbackForm = {
  processName: "", finalDecision: "", stageName: "Arrival",
  round1Result: "", round1Voc: "", round1Remarks: "",
  skillTypingScore: "", skillAiScore: "", skillResult: "", skillVoc: "", skillRemarks: "",
  round2Result: "", round2Voc: "", round2Remarks: "",
  round3Result: "", round3Voc: "", round3Remarks: "",
  secondRoundInterviewerId: "", secondRoundInterviewerNameSnapshot: "",
  clientRoundConducted: false, clientRoundInterviewerName: "", clientRoundResult: "", clientRoundRemarks: "",
  followupRequired: false, followupDate: "", followupReason: "",
  offerSalary: "", offerDoj: "", reportingTiming: "", otDetails: "", performanceIncentives: "",
};

const STAGE_RANK: Record<string, number> = {
  "Arrival": 0, "Round 1- HR Screening": 1, "Interview - Skill Test": 2,
  "Round 2- Op's": 3, "Round 3- Client": 4, "Selection Discussion": 5,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const localDateIso = (d = new Date()) => {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const todayIso = () => localDateIso();

const toUtc = (value: string): string => {
  const s = value.includes("T") ? value : value.replace(" ", "T");
  // MySQL DATETIME strings have no tz — treat as IST wall clock (+05:30), not UTC
  if (!s.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(s)) return s + "+05:30";
  return s;
};

const fmt = (value?: string) => {
  if (!value) return "—";
  const d = new Date(toUtc(value));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

function statusBadgeClass(status?: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("selected") || s === "joined") return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (s.includes("reject") || s === "no_show" || s === "no show") return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  if (s.includes("hold") || s.includes("pending")) return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  if (s === "bgv_pending" || s === "bgv_verified") return "bg-violet-50 text-violet-700 ring-1 ring-violet-200";
  return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
}

function validateFeedbackForm(form: FeedbackForm): string | null {
  if (!form.processName) return "Interviewed for Process is required.";
  if (!form.finalDecision) return "Final Decision is required.";
  if (!form.stageName) return "Walk-in End Stage is required.";
  const rank = STAGE_RANK[form.stageName] ?? -1;
  if (rank < 0) return `Invalid Walk-in End Stage: "${form.stageName}"`;
  if (rank >= 1) {
    if (!form.round1Result) return "Round 1 Result is required.";
    if (form.round1Result === "Rejected" && !form.round1Voc) return "Round 1 VOC is required when rejected.";
  }
  if (form.skillResult === "Rejected" && !form.skillVoc) return "Skill Test VOC is required when rejected.";
  const effectiveRank = form.round1Result === "Rejected" ? Math.min(rank, 1)
    : form.round2Result === "Rejected" ? Math.min(rank, 3) : rank;
  if (effectiveRank >= 3 && form.round1Result !== "Rejected") {
    if (!form.round2Result) return "Round 2 Result is required.";
    if (form.round2Result === "Rejected" && !form.round2Voc) return "Round 2 VOC is required when rejected.";
    if (!form.secondRoundInterviewerId) return "Second Round Interviewer is required.";
  }
  if (effectiveRank >= 4 && form.round1Result !== "Rejected" && form.round2Result !== "Rejected") {
    if (!form.round3Result) return "Round 3 Result is required.";
    if (form.round3Result === "Rejected" && !form.round3Voc) return "Round 3 VOC is required when rejected.";
  }
  if (form.followupRequired) {
    if (!form.followupDate) return "Follow-up Date is required.";
    if (!form.followupReason.trim()) return "Follow-up Reason is required.";
  }
  if (form.finalDecision === "Selected") {
    if (!form.offerSalary) return "Offer Salary is required.";
    if (!form.offerDoj) return "Date of Joining is required.";
    if (!form.reportingTiming) return "Reporting Timing is required.";
    if (form.offerDoj < todayIso()) return "Date of Joining cannot be in the past.";
  }
  return null;
}

function cascadeSelected(form: FeedbackForm): FeedbackForm {
  const rank = STAGE_RANK[form.stageName] ?? 0;
  const u = { ...form };
  if (form.finalDecision === "Selected") {
    if (rank >= 1) u.round1Result = "Selected";
    if (rank >= 3) u.round2Result = "Selected";
    if (rank >= 4) u.round3Result = "Selected";
  } else {
    if (u.round1Result === "Selected") u.round1Result = "";
    if (u.round2Result === "Selected") u.round2Result = "";
    if (u.round3Result === "Selected") u.round3Result = "";
    u.offerSalary = ""; u.offerDoj = ""; u.reportingTiming = "";
    u.otDetails = ""; u.performanceIncentives = "";
  }
  return u;
}

// ─── Feedback Form Component (identical flow to RecruiterWorkspace) ───────────

function CandidateFeedbackForm({
  candidate,
  config,
  onClose,
  onSuccess,
  isOwn,
}: {
  candidate: EnrichedCandidate;
  config: Config;
  onClose: () => void;
  onSuccess: () => void;
  isOwn: boolean;
}) {
  const [form, setForm] = useState<FeedbackForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [interviewers, setInterviewers] = useState<Array<{ id: string; name: string; branch_name?: string | null; designation_name?: string | null }>>([]);
  const [interviewerSearch, setInterviewerSearch] = useState("");
  const [interviewerDropOpen, setInterviewerDropOpen] = useState(false);
  const [interviewerLoading, setInterviewerLoading] = useState(false);
  const interviewerRef = useRef<HTMLDivElement>(null);

  const rank = STAGE_RANK[form.stageName] ?? 0;
  const effectiveRank = form.round1Result === "Rejected" ? Math.min(rank, 1)
    : form.round2Result === "Rejected" ? Math.min(rank, 3) : rank;

  const reachableStageOptions = form.round1Result === "Rejected"
    ? config.stageOptions.filter(s => (STAGE_RANK[s] ?? 0) <= 1)
    : form.round2Result === "Rejected"
    ? config.stageOptions.filter(s => (STAGE_RANK[s] ?? 0) <= 3)
    : config.stageOptions;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (interviewerRef.current && !interviewerRef.current.contains(e.target as Node)) {
        setInterviewerDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const searchInterviewers = async (q: string) => {
    setInterviewerLoading(true);
    try {
      const params = new URLSearchParams({ roundType: "second_round", limit: "50" });
      if (candidate.branch_name) params.set("branchName", candidate.branch_name);
      if (q.trim()) params.set("q", q.trim());
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(`/api/ats/interviewers?${params}`);
      setInterviewers(res.data ?? []);
    } catch {
      setInterviewers([]);
    } finally {
      setInterviewerLoading(false);
    }
  };

  const update = (patch: Partial<FeedbackForm>) => {
    setForm(prev => {
      let updated = { ...prev, ...patch };
      if ("round1Result" in patch && patch.round1Result === "Rejected") {
        updated.stageName = "Round 1- HR Screening";
        updated.round2Result = ""; updated.round2Voc = ""; updated.round2Remarks = "";
        updated.secondRoundInterviewerId = ""; updated.secondRoundInterviewerNameSnapshot = "";
        updated.round3Result = ""; updated.round3Voc = ""; updated.round3Remarks = "";
      }
      if ("round2Result" in patch && patch.round2Result === "Rejected") {
        if ((STAGE_RANK[updated.stageName] ?? 0) > 3) updated.stageName = "Round 2- Op's";
        updated.round3Result = ""; updated.round3Voc = ""; updated.round3Remarks = "";
      }
      if ("finalDecision" in patch || "stageName" in patch) return cascadeSelected(updated);
      return updated;
    });
  };

  const submit = async () => {
    const err = validateFeedbackForm(form);
    if (err) { setMsg(err); return; }
    setSaving(true);
    setMsg("");
    try {
      await hrmsApi.post("/api/ats-full-parity/recruiter-submission", {
        candidateId: candidate.id,
        qToken: candidate.q_token,
        interviewedForProcess: form.processName,
        walkinEndStage: form.stageName,
        finalDecision: form.finalDecision,
        round1Result: form.round1Result || null,
        round1Voc: form.round1Voc || null,
        round1Remarks: form.round1Remarks || null,
        skillTestTyping: form.skillTypingScore ? Number(form.skillTypingScore) : null,
        skillTestAi: form.skillAiScore ? Number(form.skillAiScore) : null,
        skillTestResult: form.skillResult || null,
        skillTestVoc: form.skillVoc || null,
        skillTestRemarks: form.skillRemarks || null,
        round2Result: form.round2Result || null,
        round2Voc: form.round2Voc || null,
        round2Remarks: form.round2Remarks || null,
        round3Result: form.round3Result || null,
        round3Voc: form.round3Voc || null,
        round3Remarks: form.round3Remarks || null,
        secondRoundInterviewerId: form.secondRoundInterviewerId || null,
        secondRoundInterviewerNameSnapshot: form.secondRoundInterviewerNameSnapshot || null,
        clientRoundConducted: form.clientRoundConducted,
        clientRoundInterviewerName: form.clientRoundInterviewerName || null,
        clientRoundResult: form.clientRoundResult || null,
        clientRoundRemarks: form.clientRoundRemarks || null,
        followupRequired: form.followupRequired,
        followupDate: form.followupDate || null,
        followupReason: form.followupReason || null,
        offerSalary: form.offerSalary ? Number(form.offerSalary) : null,
        offerDoj: form.offerDoj || null,
        reportingTiming: form.reportingTiming || null,
        otDetails: form.otDetails || null,
        performanceIncentives: form.performanceIncentives || null,
      });
      toast.success("Interview feedback saved successfully.");
      onSuccess();
    } catch (e: unknown) {
      const errMsg = (e as { message?: string })?.message || "Failed to save feedback.";
      setMsg(errMsg);
      toast.error(errMsg);
    } finally {
      setSaving(false);
    }
  };

  const sf = (label: string, key: keyof FeedbackForm, type: "input" | "select" | "textarea", options: string[] = [], required = false) => (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {type === "textarea" ? (
        <textarea
          value={form[key] as string}
          onChange={e => update({ [key]: e.target.value })}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400 resize-none min-h-[60px]"
        />
      ) : type === "select" ? (
        <select
          value={form[key] as string}
          onChange={e => update({ [key]: e.target.value })}
          className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus:border-slate-400"
        >
          <option value="">Select</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          value={form[key] as string}
          onChange={e => update({ [key]: e.target.value })}
          type={key === "offerDoj" ? "date" : "text"}
          className="h-9 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
        />
      )}
    </div>
  );

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-widest text-blue-600">Interview Feedback</p>
        <p className="font-bold text-slate-900 mt-0.5">{candidate.full_name || "Candidate"}</p>
        <p className="text-xs text-slate-500">{candidate.candidate_code} · {candidate.branch_name || "—"}</p>
        {!isOwn && (
          <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            <p className="text-xs text-amber-700 font-medium">
              Assigned to {candidate.recruiter_name || "another recruiter"} — submitting as substitute
            </p>
          </div>
        )}
      </div>

      {/* Walk-in Summary */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
        <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Walk-in Summary</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {sf("Process", "processName", "select", config.processOptions, true)}
          {sf("End Stage", "stageName", "select", reachableStageOptions, true)}
          {sf("Final Decision", "finalDecision", "select", config.decisionOptions, true)}
        </div>
      </div>

      {/* Round 1 */}
      {effectiveRank >= 1 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-blue-700">Round 1 — HR Screening</p>
          <div className="grid grid-cols-2 gap-2">
            {sf("Result", "round1Result", "select", config.decisionOptions, true)}
            {form.round1Result === "Rejected" && sf("VOC", "round1Voc", "select", config.vocOptions, true)}
          </div>
          {sf("Remarks", "round1Remarks", "textarea")}
        </div>
      )}

      {/* Skill Test */}
      {effectiveRank >= 2 && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 space-y-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-violet-700">Skill Test</p>
          <div className="grid grid-cols-3 gap-2">
            {sf("Typing Score", "skillTypingScore", "input")}
            {sf("AI Score", "skillAiScore", "input")}
            {sf("Result", "skillResult", "select", config.decisionOptions)}
          </div>
          {form.skillResult === "Rejected" && sf("Skill VOC", "skillVoc", "select", config.skillVocOptions, true)}
          {sf("Remarks", "skillRemarks", "textarea")}
        </div>
      )}

      {/* Round 2 */}
      {effectiveRank >= 3 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-emerald-700">Round 2 — Operations</p>
          <div className="grid grid-cols-2 gap-2">
            {sf("Result", "round2Result", "select", config.decisionOptions, true)}
            {form.round2Result === "Rejected" && sf("VOC", "round2Voc", "select", config.vocOptions, true)}
          </div>
          {sf("Remarks", "round2Remarks", "textarea")}

          {/* Second Round Interviewer */}
          <div className="pt-1" ref={interviewerRef}>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-emerald-700 mb-1">
              Second Round Interviewer <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Type name to search…"
                value={interviewerSearch}
                autoComplete="off"
                className="h-9 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                onChange={e => {
                  const q = e.target.value;
                  setInterviewerSearch(q);
                  setInterviewerDropOpen(true);
                  void searchInterviewers(q);
                  if (!q) update({ secondRoundInterviewerId: "", secondRoundInterviewerNameSnapshot: "" });
                }}
                onFocus={() => {
                  setInterviewerDropOpen(true);
                  if (!interviewers.length) void searchInterviewers(interviewerSearch);
                }}
              />
              {interviewerDropOpen && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                  {interviewerLoading && <div className="px-3 py-2 text-sm text-slate-400">Searching…</div>}
                  {!interviewerLoading && interviewers.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">No interviewers found</div>}
                  {!interviewerLoading && interviewers.map(item => (
                    <div
                      key={item.id}
                      onMouseDown={e => {
                        e.preventDefault();
                        update({ secondRoundInterviewerId: item.id, secondRoundInterviewerNameSnapshot: item.name });
                        setInterviewerSearch(item.name);
                        setInterviewerDropOpen(false);
                      }}
                      className={`cursor-pointer border-b border-slate-100 px-3 py-2 text-sm last:border-0 hover:bg-slate-50 ${form.secondRoundInterviewerId === item.id ? "bg-emerald-50 font-medium" : ""}`}
                    >
                      {item.name}
                      {item.designation_name && <span className="ml-1.5 text-xs text-slate-400">{item.designation_name}</span>}
                      {item.branch_name && <span className="ml-1 text-xs text-slate-400">· {item.branch_name}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Round 3 */}
      {effectiveRank >= 4 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 space-y-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-orange-700">Round 3 — Client</p>
          <div className="grid grid-cols-2 gap-2">
            {sf("Result", "round3Result", "select", config.decisionOptions, true)}
            {form.round3Result === "Rejected" && sf("VOC", "round3Voc", "select", config.vocOptions, true)}
          </div>
          {sf("Remarks", "round3Remarks", "textarea")}
        </div>
      )}

      {/* Client Round */}
      {rank >= 4 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 space-y-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-orange-700">Client Round</p>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.clientRoundConducted}
              onChange={e => update({ clientRoundConducted: e.target.checked })}
              className="h-4 w-4 rounded"
            />
            Client round conducted
          </label>
          <div className="grid grid-cols-2 gap-2">
            {sf("Interviewer Name", "clientRoundInterviewerName", "input")}
            {sf("Result", "clientRoundResult", "select", config.decisionOptions)}
          </div>
          {sf("Remarks", "clientRoundRemarks", "textarea")}
        </div>
      )}

      {/* Offer Details */}
      {form.finalDecision === "Selected" && (
        <div className="rounded-xl border-2 border-emerald-400 bg-emerald-50 p-3 space-y-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-emerald-800">Offer Details (Required)</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {sf("Offer Salary", "offerSalary", "input", [], true)}
            {sf("Date of Joining", "offerDoj", "input", [], true)}
            {sf("Reporting Timing", "reportingTiming", "input", [], true)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {sf("OT Details", "otDetails", "input")}
            {sf("Performance Incentives", "performanceIncentives", "input")}
          </div>
        </div>
      )}

      {/* Follow-up */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={form.followupRequired}
            onChange={e => update({ followupRequired: e.target.checked })}
            className="h-4 w-4 rounded"
          />
          Schedule follow-up
        </label>
        {form.followupRequired && (
          <div className="grid grid-cols-2 gap-2">
            {sf("Follow-up Date", "followupDate", "input", [], true)}
            {sf("Follow-up Reason", "followupReason", "input", [], true)}
          </div>
        )}
      </div>

      {/* Error message */}
      {msg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
          {msg}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
        <Button onClick={() => void submit()} disabled={saving} className="flex-1 bg-slate-950 hover:bg-slate-800 text-white">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {saving ? "Saving…" : "Save Feedback"}
        </Button>
      </div>
    </div>
  );
}

// ─── Candidate Journey Panel ───────────────────────────────────────────────

function CandidateJourneyPanel({
  candidate,
  config,
  isRecruiter,
  isPrivileged,
  onClose,
  onFeedbackSuccess,
}: {
  candidate: EnrichedCandidate;
  config: Config;
  isRecruiter: boolean;
  isPrivileged: boolean;
  onClose: () => void;
  onFeedbackSuccess: () => void;
}) {
  const [tab, setTab] = useState<"journey" | "feedback">("journey");

  // Determine if this recruiter owns this candidate or is submitting for another
  const isOwn = !isRecruiter || true; // admins/HR always considered "own"; recruiter always true here since they see all

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-blue-600">Candidate</p>
          <h2 className="text-lg font-black text-slate-950 mt-0.5">{candidate.full_name || "—"}</h2>
          <p className="text-xs text-slate-500">{candidate.candidate_code} · {candidate.branch_name || "—"}</p>
        </div>
        <button onClick={onClose} className="mt-1 rounded-lg p-1.5 hover:bg-slate-100 transition-colors">
          <X className="h-4 w-4 text-slate-500" />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mt-3 mb-4 bg-slate-100 rounded-xl p-1">
        <button
          onClick={() => setTab("journey")}
          className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all ${tab === "journey" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          Journey
        </button>
        <button
          onClick={() => setTab("feedback")}
          className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all ${tab === "feedback" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          Feedback
        </button>
      </div>

      {/* Journey tab */}
      {tab === "journey" && (
        <div className="space-y-3 overflow-y-auto flex-1 pb-4">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Registered</p>
              <p className="font-semibold text-slate-800">{fmt(candidate.created_at)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Status</p>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${statusBadgeClass(candidate.status)}`}>
                {candidate.status || "Waiting"}
              </span>
            </div>
            <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
              <p className="text-[10px] font-bold uppercase text-blue-500 mb-1">Recruiter</p>
              <p className="font-semibold text-blue-900 text-[11px]">{candidate.recruiter_name || "—"}</p>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Role Applied</p>
              <p className="font-semibold text-slate-800 text-[11px]">{candidate.role_applied || "—"}</p>
            </div>
          </div>

          {/* Contact */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1.5">
            <p className="text-[10px] font-bold uppercase text-slate-400">Contact</p>
            {candidate.mobile && (
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                {candidate.mobile}
              </div>
            )}
            {candidate.email && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                {candidate.email}
              </div>
            )}
          </div>

          {/* Latest submission */}
          {candidate.submission?.final_decision && (
            <div className={`rounded-xl border p-3 space-y-1.5 ${candidate.submission.final_decision === "Selected" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
              <p className="text-[10px] font-bold uppercase text-slate-400">Latest Decision</p>
              <p className="font-bold text-slate-900">{candidate.submission.final_decision}</p>
              <p className="text-xs text-slate-600">Stage: {candidate.submission.walkin_end_stage || "—"}</p>
              <p className="text-xs text-slate-600">Process: {candidate.submission.interviewed_for_process || "—"}</p>
              <p className="text-xs text-slate-500">Submitted: {fmt(candidate.submission.submitted_at)}</p>
              {candidate.submission.final_decision === "Selected" && (
                <div className="mt-2 pt-2 border-t border-emerald-200 space-y-1">
                  <p className="text-xs text-emerald-800 font-medium">Offer: ₹{candidate.submission.offer_salary || "—"}</p>
                  <p className="text-xs text-emerald-700">DOJ: {candidate.submission.offer_doj || "—"}</p>
                </div>
              )}
            </div>
          )}

          {/* Audit timeline */}
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-400 mb-2">Audit Timeline</p>
            {!candidate.logs?.length ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                No journey events yet
              </div>
            ) : (
              <div className="space-y-2">
                {candidate.logs.slice(0, 10).map(log => (
                  <div key={log.id} className="flex gap-3 items-start">
                    <div className="mt-0.5 h-2 w-2 rounded-full bg-blue-400 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-slate-800">{log.event_type || "Journey Event"}</p>
                      <p className="text-[10px] text-slate-400">{fmt(log.created_at)}</p>
                      {log.event_note && <p className="text-xs text-slate-600 mt-0.5">{log.event_note}</p>}
                      {!log.event_note && (log.old_status || log.new_status) && (
                        <p className="text-xs text-slate-500">{log.old_status || "—"} → {log.new_status || "—"}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Feedback tab */}
      {tab === "feedback" && (
        <div className="overflow-y-auto flex-1">
          <CandidateFeedbackForm
            candidate={candidate}
            config={config}
            isOwn={isOwn}
            onClose={() => setTab("journey")}
            onSuccess={() => {
              setTab("journey");
              onFeedbackSuccess();
            }}
          />
        </div>
      )}
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
  const isPrivileged = ["admin", "hr", "super_admin"].some(r => roleKeys.includes(r));

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<EnrichedCandidate[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [selected, setSelected] = useState<EnrichedCandidate | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [branchFilter, setBranchFilter] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [error, setError] = useState("");
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadConfig = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: any }>("/api/ats/form-config/bootstrap");
      const d = res.data ?? {};
      setConfig(prev => ({
        ...prev,
        ...(Array.isArray(d.hiringProcessOptions) && d.hiringProcessOptions.length > 0
          ? { processOptions: d.hiringProcessOptions } : {}),
      }));
    } catch { /* non-critical */ }
  };

  const mapCandidate = (c: any): EnrichedCandidate => ({
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
    walkin_end_stage: c.walkin_end_stage ?? c.current_stage ?? undefined,
    created_at: c.created_at,
    updated_at: c.updated_at,
    skilltest_typing: c.skilltest_typing ?? null,
    skilltest_ai: c.skilltest_ai ?? null,
    skilltest_result: c.skilltest_result ?? null,
    assessment_percentage: c.assessment_percentage ?? null,
    typing_net_wpm: c.typing_net_wpm ?? null,
    assignment: undefined,
    logs: [],
  });

  const loadData = async () => {
    setLoading(true);
    setError("");
    setCurrentPage(1);
    try {
      const endpoint = isRecruiter
        ? "/api/ats/recruiter/my-candidates"
        : "/api/ats/candidates?limit=500&page=1";
      const res = await hrmsApi.get<{ success: boolean; data: any[]; total?: number }>(endpoint);
      const raw: any[] = res.data ?? [];
      setRows(raw.map(mapCandidate));
      setTotalCount(res.total ?? raw.length);
    } catch (err: any) {
      setError(err?.message || "Unable to load candidates");
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || rows.length >= totalCount) return;
    setLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const res = await hrmsApi.get<{ success: boolean; data: any[]; total?: number }>(
        `/api/ats/candidates?limit=500&page=${nextPage}`
      );
      const raw: any[] = res.data ?? [];
      if (raw.length > 0) {
        setRows(prev => [...prev, ...raw.map(mapCandidate)]);
        setCurrentPage(nextPage);
      }
    } catch { /* ignore */ }
    finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => { void loadData(); void loadConfig(); }, [isRecruiter]);

  // Load stage logs when a candidate is selected
  useEffect(() => {
    if (!selected) return;
    hrmsApi
      .get<{ success: boolean; data: any[] }>(`/api/ats/candidates/${selected.id}/stage-logs`)
      .then(r => {
        const logs: LogRow[] = (r.data ?? []).map((l: any) => ({
          id: l.id,
          candidate_id: l.candidate_id,
          old_status: l.from_stage ?? undefined,
          new_status: l.to_stage ?? undefined,
          event_type: l.to_stage ? `Stage → ${l.to_stage}` : "Journey Event",
          event_note: l.remarks ?? undefined,
          created_at: l.stage_date ?? l.created_at,
        }));
        setSelected(prev => prev?.id === selected.id ? { ...prev, logs } : prev);
      })
      .catch(() => {});
  }, [selected?.id]);

  const branches = useMemo(
    () => ["All", ...Array.from(new Set(rows.map(r => r.branch_name).filter(Boolean))) as string[]],
    [rows]
  );
  const statuses = useMemo(
    () => ["All", ...Array.from(new Set(rows.map(r => r.status || "Waiting").filter(Boolean))) as string[]],
    [rows]
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const to = toDate ? new Date(`${toDate}T23:59:59`).getTime() : null;
    return rows.filter(r => {
      const s = r.status || "Waiting";
      const b = r.branch_name || "";
      const created = r.created_at ? new Date(toUtc(r.created_at)).getTime() : 0;
      const matchText = !q || [r.candidate_code, r.full_name, r.mobile, r.email, r.role_applied, b, r.recruiter_name].join(" ").toLowerCase().includes(q);
      return matchText &&
        (statusFilter === "All" || s === statusFilter) &&
        (branchFilter === "All" || b === branchFilter) &&
        (!from || created >= from) &&
        (!to || created <= to);
    });
  }, [rows, query, statusFilter, branchFilter, fromDate, toDate]);

  const SELECTED_STAGES = ["selected", "bgv_pending", "bgv_verified", "payroll_validated", "offer_pending", "offer_accepted", "joined"];
  const CLOSED_STAGES = ["rejected", "rejected_by_branch_head", "no_show"];
  const selectedCount = filtered.filter(r => SELECTED_STAGES.includes((r.status ?? "").toLowerCase())).length;
  const closedCount = filtered.filter(r => CLOSED_STAGES.includes((r.status ?? "").toLowerCase())).length;
  const waitingCount = filtered.filter(r => {
    const s = (r.status ?? "").toLowerCase();
    return !SELECTED_STAGES.includes(s) && !CLOSED_STAGES.includes(s);
  }).length;

  function openCandidate(c: EnrichedCandidate) {
    setSelected(c);
    setSheetOpen(true);
  }

  return (
    <DashboardLayout>
      <div className="space-y-4 pb-8">

        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">Native ATS</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">
              {isRecruiter ? "My Assigned Candidates" : "Candidate Master"}
            </h1>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadData()}
            disabled={loading}
            className="gap-2 self-start sm:self-auto"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {error}
          </div>
        )}

        {/* Stat chips */}
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
            <Users className="h-4 w-4 text-blue-600" />
            <span className="font-black text-blue-900">{filtered.length}</span>
            <span className="text-blue-600 font-medium">Total</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
            <ClipboardList className="h-4 w-4 text-amber-600" />
            <span className="font-black text-amber-900">{waitingCount}</span>
            <span className="text-amber-600 font-medium">Waiting</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
            <UserCheck className="h-4 w-4 text-emerald-600" />
            <span className="font-black text-emerald-900">{selectedCount}</span>
            <span className="text-emerald-600 font-medium">Selected</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm">
            <Filter className="h-4 w-4 text-rose-600" />
            <span className="font-black text-rose-900">{closedCount}</span>
            <span className="text-rose-600 font-medium">Closed</span>
          </div>
        </div>

        {/* Search + filter row */}
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Name, mobile, code, recruiter…"
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:bg-white"
              />
            </div>
            <button
              onClick={() => setFiltersOpen(v => !v)}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors ${filtersOpen ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"}`}
            >
              <Filter className="h-3.5 w-3.5" />
              Filters
              {filtersOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          </div>
          {filtersOpen && (
            <div className="grid gap-2 sm:grid-cols-4">
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-8 rounded-xl border border-slate-200 bg-slate-50 px-2 text-xs text-slate-700 outline-none focus:border-blue-400">
                {statuses.map(s => <option key={s}>{s}</option>)}
              </select>
              <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="h-8 rounded-xl border border-slate-200 bg-slate-50 px-2 text-xs text-slate-700 outline-none focus:border-blue-400">
                {branches.map(b => <option key={b}>{b}</option>)}
              </select>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-8 rounded-xl border border-slate-200 bg-slate-50 px-2 text-xs outline-none focus:border-blue-400" />
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-8 rounded-xl border border-slate-200 bg-slate-50 px-2 text-xs outline-none focus:border-blue-400" />
            </div>
          )}
        </div>

        {/* Compact table */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="max-h-[calc(100vh-320px)] overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading candidates…
              </div>
            ) : !filtered.length ? (
              <div className="py-16 text-center text-sm text-slate-400">No candidates match the current filters.</div>
            ) : (
              <table className="w-full min-w-[700px] text-sm border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-50 text-left">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Candidate</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Contact</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Branch / Role</th>
                    {!isRecruiter && <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Recruiter</th>}
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Status</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Typing</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Assessment</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Registered</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const isActive = selected?.id === r.id && sheetOpen;
                    return (
                      <tr
                        key={r.id}
                        className={`border-b border-slate-100 transition-colors ${isActive ? "bg-blue-50/60" : "hover:bg-slate-50/70"}`}
                      >
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-900 text-xs">{r.full_name || "—"}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{r.candidate_code || "—"}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-xs text-slate-700">{r.mobile || "—"}</div>
                          {r.email && <div className="text-[10px] text-slate-400 truncate max-w-[140px]">{r.email}</div>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-xs text-slate-700">{r.branch_name || "—"}</div>
                          <div className="text-[10px] text-slate-400">{r.role_applied || "—"}</div>
                        </td>
                        {!isRecruiter && (
                          <td className="px-3 py-2 text-xs text-slate-600">{r.recruiter_name || "—"}</td>
                        )}
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${statusBadgeClass(r.status)}`}>
                            {r.status || "Waiting"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-700">
                          {(() => {
                            const wpm = r.typing_net_wpm ?? r.skilltest_typing;
                            return wpm != null
                              ? <span className="font-medium">{Number(wpm).toFixed(0)} WPM</span>
                              : <span className="text-slate-300">—</span>;
                          })()}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-700">
                          {(() => {
                            const pct = r.assessment_percentage ?? r.skilltest_ai;
                            const result = r.skilltest_result;
                            if (pct == null) return <span className="text-slate-300">—</span>;
                            const isPass = result?.toLowerCase() === 'pass';
                            const isFail = result?.toLowerCase() === 'fail' || result?.toLowerCase() === 'rejected';
                            return (
                              <span className="flex items-center gap-1">
                                <span className="font-medium">{Number(pct).toFixed(1)}%</span>
                                {result && (
                                  <span className={`inline-flex px-1 py-0.5 text-[10px] font-bold rounded ${isPass ? 'bg-emerald-100 text-emerald-700' : isFail ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                                    {result}
                                  </span>
                                )}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-2 text-[10px] text-slate-400 whitespace-nowrap">
                          {r.created_at ? new Date(toUtc(r.created_at)).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => openCandidate(r)}
                            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${isActive ? "bg-blue-600 text-white" : "border border-slate-200 text-slate-700 hover:bg-slate-100"}`}
                          >
                            {isActive ? <CheckCircle2 className="h-3 w-3" /> : <CalendarDays className="h-3 w-3" />}
                            {isActive ? "Open" : "View"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {filtered.length > 0 && (
            <div className="border-t border-slate-100 px-4 py-2 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                Showing {filtered.length} of {rows.length} loaded{totalCount > rows.length ? ` (${totalCount} total in database)` : ""}
              </span>
              {!isRecruiter && rows.length < totalCount && (
                <button
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 disabled:text-slate-400"
                >
                  {loadingMore ? "Loading…" : `Load More (${totalCount - rows.length} remaining)`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right-side detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={open => { setSheetOpen(open); if (!open) setSelected(null); }}>
        <SheetContent side="right" className="w-full overflow-hidden flex flex-col sm:max-w-lg p-0">
          <SheetHeader className="px-5 pt-5 pb-0">
            <SheetTitle className="sr-only">Candidate Detail</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 pt-3 pb-5">
            {selected && (
              <CandidateJourneyPanel
                candidate={selected}
                config={config}
                isRecruiter={isRecruiter}
                isPrivileged={isPrivileged}
                onClose={() => setSheetOpen(false)}
                onFeedbackSuccess={() => void loadData()}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
