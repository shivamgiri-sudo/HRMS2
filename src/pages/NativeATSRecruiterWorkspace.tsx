import React, { useEffect, useMemo, useState, useRef } from "react";
import { hrmsApi } from "@/lib/hrmsApi";

type CandidateRow = {
  candidateId: string;
  qToken?: string;
  fullName?: string;
  mobile?: string;
  email?: string;
  branch?: string;
  roleApplied?: string;
  stage?: string;
  status?: string;
  pendingMinutes?: number;
  createdAt?: string | null;
  recruiterName?: string;
};

type HistoryRow = {
  id: string;
  candidate_id: string;
  candidate_code?: string;
  q_token?: string;
  recruiter_code?: string;
  submitted_at?: string;
  walkin_end_stage?: string;
  final_decision?: string;
  interviewed_for_process?: string;
  round1_result?: string;
  skilltest_result?: string;
  skilltest_typing?: number | string;
  skilltest_ai?: number | string;
  round2_result?: string;
  round3_result?: string;
  second_round_interviewer_id?: string;
  second_round_interviewer_name_snapshot?: string;
  second_round_interviewer_branch_snapshot?: string;
  second_round_interviewer_designation_snapshot?: string;
  client_round_conducted?: number | string;
  client_round_interviewer_name?: string;
  client_round_result?: string;
  client_round_remarks?: string;
  followup_required?: number | string;
  followup_date?: string;
  followup_reason?: string;
  hiring_source_snapshot?: string;
  referee_employee_code_snapshot?: string;
  referee_name_snapshot?: string;
  calling_activity_id?: string;
  candidate_called_at?: string;
  interview_started_at?: string;
  calling_source_snapshot?: string;
  calling_last_remarks?: string;
  calling_lineup_date?: string;
  calling_turnup_status?: string;
  offer_salary?: string | number;
  offer_doj?: string;
  previous_submitted_time?: string;
  full_name?: string;
  mobile?: string;
  email?: string;
  onboarding_status?: string;
  onboarding_token_expires_at?: string;
  onboarding_joining_date?: string;
  email_dispatch_status?: string;
  email_sent_at?: string;
};

type RecruiterProfile = {
  id: string;
  name: string;
  recruiterCode: string;
  branch: string;
  email: string | null;
  employeeId: string | null;
};

type Config = {
  processOptions: string[];
  decisionOptions: string[];
  stageOptions: string[];
  vocOptions: string[];
  skillVocOptions: string[];
};

type Form = {
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
  hiringSourceSnapshot: string;
  refereeEmployeeCodeSnapshot: string;
  refereeNameSnapshot: string;
  callingActivityId: string;
  candidateCalledAt: string;
  interviewStartedAt: string;
  callingSourceSnapshot: string;
  callingLastRemarks: string;
  callingLineupDate: string;
  callingTurnupStatus: string;
  offerSalary: string;
  offerDoj: string;
  reportingTiming: string;
  otDetails: string;
  performanceIncentives: string;
};

type DailyStats = {
  total_today: number;
  selected_today: number;
  rejected_today: number;
  noshow_today: number;
  hold_today: number;
  conversion_rate: number;
};

const DEFAULT_CONFIG: Config = {
  processOptions: ["Onfido", "Reginald", "BBB", "GS1", "GPI", "FF", "DRA"],
  decisionOptions: ["Selected", "Rejected", "Hold", "Client Round - Pending", "No Show"],
  stageOptions: ["Arrival", "Round 1- HR Screening", "Interview - Skill Test", "Round 2- Op's", "Round 3- Client", "Selection Discussion"],
  vocOptions: ["Undergraduate / Qualification Issue", "Poor Communication Skill", "Poor Reading / Comprehension", "Salary Issue", "Shift / Timing Issue", "Location / Travel Issue", "Stability Concern", "Documentation Issue", "Role / Process Mismatch", "Candidate Not Interested", "No Show", "Age Barrier"],
  skillVocOptions: ["Typing Speed Issue", "Typing Accuracy Issue", "Pehchan Score Low", "Poor Sales Skill", "Vocabulary / Grammar Issue", "Computer / System Skill Gap", "Assessment Incomplete / Failed"],
};

const EMPTY_FORM: Form = {
  processName: "",
  finalDecision: "",
  stageName: "Arrival",
  round1Result: "",
  round1Voc: "",
  round1Remarks: "",
  skillTypingScore: "",
  skillAiScore: "",
  skillResult: "",
  skillVoc: "",
  skillRemarks: "",
  round2Result: "",
  round2Voc: "",
  round2Remarks: "",
  round3Result: "",
  round3Voc: "",
  round3Remarks: "",
  secondRoundInterviewerId: "",
  secondRoundInterviewerNameSnapshot: "",
  clientRoundConducted: false,
  clientRoundInterviewerName: "",
  clientRoundResult: "",
  clientRoundRemarks: "",
  followupRequired: false,
  followupDate: "",
  followupReason: "",
  hiringSourceSnapshot: "",
  refereeEmployeeCodeSnapshot: "",
  refereeNameSnapshot: "",
  callingActivityId: "",
  candidateCalledAt: "",
  interviewStartedAt: "",
  callingSourceSnapshot: "",
  callingLastRemarks: "",
  callingLineupDate: "",
  callingTurnupStatus: "",
  offerSalary: "",
  offerDoj: "",
  reportingTiming: "",
  otDetails: "",
  performanceIncentives: "",
};

const STAGE_RANK: Record<string, number> = {
  Arrival: 0,
  "Round 1- HR Screening": 1,
  "Interview - Skill Test": 2,
  "Round 2- Op's": 3,
  "Round 3- Client": 4,
  "Selection Discussion": 5,
};

const fmt = (value?: string) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

const fmtTime = (value?: string | null) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
};

const fmtDate = (value?: string | null) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const localDateIso = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayIso = () => localDateIso();
const monthStartIso = () => { const d = new Date(); return localDateIso(new Date(d.getFullYear(), d.getMonth(), 1)); };

function Opts({ values }: { values: string[] }) {
  return <>{values.map((v) => <option key={v} value={v}>{v}</option>)}</>;
}

function DecisionBadge({ value }: { value?: string }) {
  const text = value || "—";
  const v = text.toLowerCase();
  let cls = "badge-slate";
  if (v === "selected") cls = "badge-green";
  else if (v === "rejected") cls = "badge-red";
  else if (v === "hold") cls = "badge-amber";
  else if (v.includes("no show") || v.includes("no-show")) cls = "badge-gray";
  else if (v.includes("pending")) cls = "badge-blue";
  return <span className={`rw-badge ${cls}`}>{text}</span>;
}

function WaitBadge({ mins }: { mins: number }) {
  const cls = mins < 30 ? "badge-green" : mins < 60 ? "badge-amber" : "badge-red";
  const label = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return <span className={`rw-badge ${cls}`}>{label}</span>;
}

function OnboardingBadge({ row }: { row: HistoryRow }) {
  if (row.final_decision !== "Selected") return <span className="rw-muted">—</span>;
  const s = row.onboarding_status;
  const expired = row.onboarding_token_expires_at ? new Date(row.onboarding_token_expires_at) < new Date() : false;
  if (s === "onboarding_complete" || s === "completed") return <span className="rw-badge badge-green">Joined ✓</span>;
  if (s === "onboarding_sent" && !expired) return <span className="rw-badge badge-blue">Link Sent</span>;
  if (s === "onboarding_sent" && expired) return <span className="rw-badge badge-red">Expired</span>;
  if (s === "submitted") return <span className="rw-badge badge-amber">Form Submitted</span>;
  if (s === "approved") return <span className="rw-badge badge-green">Approved</span>;
  return <span className="rw-badge badge-gray">Pending</span>;
}

function EmailBadge({ status }: { status?: string }) {
  if (status === "sent") return <span className="rw-badge badge-green" title="Onboarding email delivered">Emailed ✓</span>;
  if (status === "skipped") return <span className="rw-badge badge-amber" title="No email on file — link only via SMS">No Email</span>;
  if (status === "failed") return <span className="rw-badge badge-red" title="Email delivery failed">Failed</span>;
  return <span className="rw-muted">—</span>;
}

function validateForm(form: Form): string | null {
  if (!form.processName) return "Interviewed for Process is required.";
  if (!form.finalDecision) return "Final Decision is required.";
  if (!form.stageName) return "Walk-in End Stage is required.";
  const rank = STAGE_RANK[form.stageName] ?? -1;
  if (rank < 0) return `Invalid Walk-in End Stage: "${form.stageName}"`;
  if (rank >= 1) {
    if (!form.round1Result) return "Round1 Result is required from Round 1 stage onwards.";
    if (form.round1Result === "Rejected" && !form.round1Voc) return "Round1 VOC is required when Round1 Result is Rejected.";
  }
  if (form.skillResult === "Rejected" && !form.skillVoc) return "SkillTest VOC is required when SkillTest Result is Rejected.";
  if (rank >= 3 && form.round1Result !== "Rejected") {
    if (!form.round2Result) return "Round2 Result is required from Round 2 stage onwards.";
    if (form.round2Result === "Rejected" && !form.round2Voc) return "Round2 VOC is required when Round2 Result is Rejected.";
    if (!form.secondRoundInterviewerId) return "Second Round Interviewer is required from Round 2 stage onwards.";
  }
  if (rank >= 4 && form.round1Result !== "Rejected" && form.round2Result !== "Rejected") {
    if (!form.round3Result) return "Round3 Result is required from Round 3 stage onwards.";
    if (form.round3Result === "Rejected" && !form.round3Voc) return "Round3 VOC is required when Round3 Result is Rejected.";
  }
  if ((form.clientRoundConducted || form.clientRoundInterviewerName || form.clientRoundResult || form.clientRoundRemarks) && !form.clientRoundInterviewerName) {
    return "Client Round Interviewer Name is required when client round details are captured.";
  }
  if (form.followupRequired) {
    if (!form.followupDate) return "Follow-up Date is required when follow-up is required.";
    if (!form.followupReason.trim()) return "Follow-up Reason is required when follow-up is required.";
  }
  if (form.finalDecision === "Selected") {
    if (!form.offerSalary) return "Offer Salary is required when Final Decision is Selected.";
    if (!form.offerDoj) return "Date of Joining is required when Final Decision is Selected.";
    if (!form.reportingTiming) return "Reporting Timing is required when Final Decision is Selected.";
    if (form.offerDoj < todayIso()) return "Date of Joining cannot be in the past.";
  }
  return null;
}

function cascadeSelected(form: Form): Form {
  const rank = STAGE_RANK[form.stageName] ?? 0;
  const updated = { ...form };
  if (form.finalDecision === "Selected") {
    if (rank >= 1) updated.round1Result = "Selected";
    if (rank >= 3) updated.round2Result = "Selected";
    if (rank >= 4) updated.round3Result = "Selected";
  } else {
    if (updated.round1Result === "Selected") updated.round1Result = "";
    if (updated.round2Result === "Selected") updated.round2Result = "";
    if (updated.round3Result === "Selected") updated.round3Result = "";
    updated.offerSalary = "";
    updated.offerDoj = "";
    updated.reportingTiming = "";
    updated.otDetails = "";
    updated.performanceIncentives = "";
  }
  return updated;
}

export default function NativeATSRecruiterWorkspace() {
  const [screen, setScreen] = useState<"workspace" | "form">("workspace");
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [recruiterProfile, setRecruiterProfile] = useState<RecruiterProfile | null>(null);
  const [pending, setPending] = useState<CandidateRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [config] = useState<Config>(DEFAULT_CONFIG);
  const [selected, setSelected] = useState<CandidateRow | null>(null);
  const [interviewers, setInterviewers] = useState<Array<{ id: string; name: string; branch_name?: string | null; designation_name?: string | null }>>([]);
  const [interviewerSearch, setInterviewerSearch] = useState("");
  const [interviewerDropOpen, setInterviewerDropOpen] = useState(false);
  const [interviewerSearchLoading, setInterviewerSearchLoading] = useState(false);
  const interviewerSearchRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [query, setQuery] = useState("");
  const [decision, setDecision] = useState("All");
  const [fromDate, setFromDate] = useState(monthStartIso());
  const [toDate, setToDate] = useState(todayIso());
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendMsg, setResendMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const rank = STAGE_RANK[form.stageName] ?? 0;
  // Effective rank caps at the stage where rejection occurred — downstream rounds don't happen
  const effectiveRank = form.round1Result === "Rejected" ? Math.min(rank, 1)
    : form.round2Result === "Rejected" ? Math.min(rank, 3)
    : rank;
  // Stage dropdown options filtered to only reachable stages given upstream rejections
  const reachableStageOptions: string[] = form.round1Result === "Rejected"
    ? (config.stageOptions as string[]).filter((s: string) => (STAGE_RANK[s] ?? 0) <= 1)
    : form.round2Result === "Rejected"
    ? (config.stageOptions as string[]).filter((s: string) => (STAGE_RANK[s] ?? 0) <= 3)
    : (config.stageOptions as string[]);

  const loadPending = async () => {
    const res = await hrmsApi.get<{ success: boolean; data: any[]; recruiter?: RecruiterProfile | null }>(
      "/api/ats/recruiter/my-candidates"
    );
    setRecruiterProfile(res.recruiter ?? null);

    // Sort by createdAt ascending (oldest first at top)
    const sortedData = (res.data ?? []).sort((a: any, b: any) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateA - dateB; // Ascending = oldest first
    });

    setPending(sortedData.map((c: any) => ({
      candidateId: c.candidateId,
      qToken: c.qToken ?? null,
      fullName: c.fullName,
      mobile: c.mobile,
      branch: c.branch,
      roleApplied: c.process,
      status: c.status,
      stage: c.status,
      recruiterName: c.recruiterName ?? res.recruiter?.name,
      pendingMinutes: c.pendingMinutes ?? 0,
      createdAt: c.createdAt ?? null,
    })));
  };

  const loadHistory = async () => {
    const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
      "/api/ats/recruiter/submission-history"
    );
    setHistory(res.data ?? []);
  };

  const loadDailyStats = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DailyStats }>(
        "/api/ats/recruiter/daily-stats"
      );
      setDailyStats(res.data ?? null);
    } catch {
      // Non-critical — KPI bar will show pending count only
    }
  };

  const loadInterviewersForBranch = async (branch?: string | null) => {
    if (!branch) {
      setInterviewers([]);
      return;
    }
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Array<{ id: string; name: string; branch_name?: string | null; designation_name?: string | null }> }>(
        `/api/ats/interviewers?branchName=${encodeURIComponent(branch)}&roundType=second_round&limit=50`
      );
      setInterviewers(res.data ?? []);
    } catch {
      setInterviewers([]);
    }
  };

  const searchInterviewers = async (q: string) => {
    setInterviewerSearchLoading(true);
    try {
      const params = new URLSearchParams({ roundType: "second_round", limit: "50" });
      const branch = recruiterProfile?.branch_name;
      if (branch) params.set("branchName", branch);
      if (q.trim()) params.set("q", q.trim());
      const res = await hrmsApi.get<{ success: boolean; data: Array<{ id: string; name: string; branch_name?: string | null; designation_name?: string | null }> }>(
        `/api/ats/interviewers?${params.toString()}`
      );
      setInterviewers(res.data ?? []);
    } catch {
      setInterviewers([]);
    } finally {
      setInterviewerSearchLoading(false);
    }
  };

  // Close interviewer dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (interviewerSearchRef.current && !interviewerSearchRef.current.contains(e.target as Node)) {
        setInterviewerDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const loadWorkspace = async () => {
    setLoading(true);
    setMsg("Loading workspace…");
    try {
      await Promise.all([loadPending(), loadHistory(), loadDailyStats()]);
      setMsg("");
    } catch (err: any) {
      setMsg(err?.response?.data?.message || err.message || "Unable to load recruiter workspace");
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    setMsg("");
    try {
      await Promise.all([loadPending(), loadHistory(), loadDailyStats()]);
    } catch (err: any) {
      setMsg(err.message || "Unable to refresh");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, []);

  // Auto-refresh pending queue every 90s while on pending tab
  useEffect(() => {
    if (screen === "workspace" && tab === "pending") {
      refreshTimerRef.current = setInterval(() => {
        loadPending().catch(() => {});
      }, 90_000);
    }
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [screen, tab]);

  const openForm = (c: CandidateRow, resubmit = false, h?: HistoryRow) => {
    setSelected(c);
    const asBool = (value: unknown) => value === 1 || value === "1" || value === true || value === "true" || value === "yes";
    setForm({
      ...EMPTY_FORM,
      processName: h?.interviewed_for_process || "",
      stageName: h?.walkin_end_stage || c.stage || "Arrival",
      finalDecision: resubmit ? "" : h?.final_decision || "",
      round1Result: h?.round1_result || "",
      skillResult: h?.skilltest_result || "",
      round2Result: h?.round2_result || "",
      round3Result: h?.round3_result || "",
      secondRoundInterviewerId: h?.second_round_interviewer_id || "",
      secondRoundInterviewerNameSnapshot: h?.second_round_interviewer_name_snapshot || "",
      clientRoundConducted: asBool(h?.client_round_conducted),
      clientRoundInterviewerName: h?.client_round_interviewer_name || "",
      clientRoundResult: h?.client_round_result || "",
      clientRoundRemarks: h?.client_round_remarks || "",
      followupRequired: asBool(h?.followup_required),
      followupDate: h?.followup_date || "",
      followupReason: h?.followup_reason || "",
      hiringSourceSnapshot: h?.hiring_source_snapshot || "",
      refereeEmployeeCodeSnapshot: h?.referee_employee_code_snapshot || "",
      refereeNameSnapshot: h?.referee_name_snapshot || "",
      callingActivityId: h?.calling_activity_id || "",
      candidateCalledAt: h?.candidate_called_at || "",
      interviewStartedAt: h?.interview_started_at || "",
      callingSourceSnapshot: h?.calling_source_snapshot || "",
      callingLastRemarks: h?.calling_last_remarks || "",
      callingLineupDate: h?.calling_lineup_date || "",
      callingTurnupStatus: h?.calling_turnup_status || "",
      offerSalary: h?.offer_salary ? String(h.offer_salary) : "",
      offerDoj: h?.offer_doj || "",
    });
    void loadInterviewersForBranch(c.branch ?? null);
    setInterviewerSearch(h?.second_round_interviewer_name_snapshot || "");
    setInterviewerDropOpen(false);
    setMsg("");
    setScreen("form");
  };

  const updateForm = (patch: Partial<Form>) => {
    setForm((prev) => {
      let updated = { ...prev, ...patch };

      // If round1 was rejected, cap stage and clear downstream rounds
      if ("round1Result" in patch && patch.round1Result === "Rejected") {
        updated.stageName = "Round 1- HR Screening";
        updated.round2Result = "";
        updated.round2Voc = "";
        updated.round2Remarks = "";
        updated.secondRoundInterviewerId = "";
        updated.secondRoundInterviewerNameSnapshot = "";
        updated.round3Result = "";
        updated.round3Voc = "";
        updated.round3Remarks = "";
      }

      // If round2 was rejected, cap stage and clear round3
      if ("round2Result" in patch && patch.round2Result === "Rejected") {
        if ((STAGE_RANK[updated.stageName] ?? 0) > 3) updated.stageName = "Round 2- Op's";
        updated.round3Result = "";
        updated.round3Voc = "";
        updated.round3Remarks = "";
      }

      if ("finalDecision" in patch || "stageName" in patch) {
        return cascadeSelected(updated);
      }
      return updated;
    });
  };

  const submit = async () => {
    if (!selected || !recruiterProfile) return;
    const validationError = validateForm(form);
    if (validationError) { setMsg(validationError); return; }
    setLoading(true);
    setMsg("Submitting update…");
    try {
      await hrmsApi.post("/api/ats-full-parity/recruiter-submission", {
        recruiterCode: recruiterProfile.recruiterCode,
        candidateId: selected.candidateId,
        qToken: selected.qToken,
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
        hiringSourceSnapshot: form.hiringSourceSnapshot || null,
        refereeEmployeeCodeSnapshot: form.refereeEmployeeCodeSnapshot || null,
        refereeNameSnapshot: form.refereeNameSnapshot || null,
        callingActivityId: form.callingActivityId || null,
        candidateCalledAt: form.candidateCalledAt || null,
        interviewStartedAt: form.interviewStartedAt || null,
        callingSourceSnapshot: form.callingSourceSnapshot || null,
        callingLastRemarks: form.callingLastRemarks || null,
        callingLineupDate: form.callingLineupDate || null,
        callingTurnupStatus: form.callingTurnupStatus || null,
        offerSalary: form.offerSalary ? Number(form.offerSalary) : null,
        offerDoj: form.offerDoj || null,
        reportingTiming: form.reportingTiming || null,
        otDetails: form.otDetails || null,
        performanceIncentives: form.performanceIncentives || null,
      });
      setMsg("Update submitted successfully.");
      setScreen("workspace");
      await refresh();
    } catch (err: any) {
      setMsg(err?.response?.data?.message || err.message || "Unable to submit update");
    } finally {
      setLoading(false);
    }
  };

  const handleResendLink = async (row: HistoryRow) => {
    setResendingId(row.candidate_id);
    setResendMsg(null);
    try {
      await hrmsApi.post("/api/ats/onboarding/resend-token", { candidateId: row.candidate_id });
      setResendMsg({ id: row.candidate_id, text: "Onboarding link resent successfully.", ok: true });
      await loadHistory();
    } catch (err: any) {
      setResendMsg({ id: row.candidate_id, text: err?.response?.data?.message || err.message || "Failed to resend link", ok: false });
    } finally {
      setResendingId(null);
    }
  };

  const filteredHistory = useMemo(() => {
    const q = query.trim().toLowerCase();
    const decisionFilter = decision.replace(/^[^\w]+/, "").trim();
    return history.filter((h) => {
      const text = [h.candidate_id, h.full_name, h.mobile, h.final_decision, h.walkin_end_stage, h.interviewed_for_process].join(" ").toLowerCase();
      const dateStr = h.submitted_at ? h.submitted_at.slice(0, 10) : "";
      const inRange = (!fromDate || dateStr >= fromDate) && (!toDate || dateStr <= toDate);
      const decisionMatch = decisionFilter === "All" || h.final_decision === decisionFilter;
      return (!q || text.includes(q)) && decisionMatch && inRange;
    });
  }, [history, query, decision, fromDate, toDate]);

  const field = (label: string, key: keyof Form, type: "input" | "select" | "textarea", options: string[] = []) => (
    <div>
      <label>{label}</label>
      {type === "textarea"
        ? <textarea value={form[key]} onChange={(e) => updateForm({ [key]: e.target.value })} />
        : type === "select"
        ? <select value={form[key]} onChange={(e) => updateForm({ [key]: e.target.value })}><option value="">Select</option><Opts values={options} /></select>
        : <input value={form[key]} onChange={(e) => updateForm({ [key]: e.target.value })} type={key === "offerDoj" ? "date" : key === "reportingTiming" ? "time" : "text"} />}
    </div>
  );

  // KPI values
  const queueCount = pending.length;
  const seenToday = dailyStats?.total_today ?? 0;
  const selectedToday = dailyStats?.selected_today ?? 0;
  const rejectedToday = dailyStats?.rejected_today ?? 0;
  const noshowToday = dailyStats?.noshow_today ?? 0;
  const convRate = dailyStats?.conversion_rate ?? 0;

  return (
    <div className="rw-page">
      <style>{`
        .rw-page{min-height:100dvh;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a}
        .rw-header{background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 60%,#4c1d95 100%);color:#fff;padding:24px 20px 28px;position:relative}
        .rw-header h1{margin:0;font-size:22px;font-weight:800;letter-spacing:-0.3px}
        .rw-header p{margin:6px 0 0;font-size:13px;color:#bfdbfe;opacity:.85}
        .rw-wrap{max-width:1200px;margin:16px auto 32px;padding:0 16px}
        .rw-card{background:#fff;border:1px solid #e2e8f0;border-radius:20px;box-shadow:0 4px 24px rgba(15,23,42,.08);padding:20px;margin-bottom:14px}
        .rw-kpi-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:14px}
        @media(max-width:900px){.rw-kpi-grid{grid-template-columns:repeat(3,1fr)}}
        @media(max-width:520px){.rw-kpi-grid{grid-template-columns:repeat(2,1fr)}}
        .rw-kpi{border-radius:16px;padding:14px 16px;border:1px solid #e2e8f0}
        .rw-kpi-num{font-size:28px;font-weight:800;line-height:1.1;margin:4px 0 2px}
        .rw-kpi-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;opacity:.7}
        .kpi-blue{background:#eff6ff;border-color:#bfdbfe;color:#1e40af}
        .kpi-gray{background:#f8fafc;border-color:#e2e8f0;color:#475569}
        .kpi-green{background:#f0fdf4;border-color:#bbf7d0;color:#15803d}
        .kpi-red{background:#fff1f2;border-color:#fecdd3;color:#be123c}
        .kpi-yellow{background:#fffbeb;border-color:#fde68a;color:#b45309}
        .kpi-purple{background:#faf5ff;border-color:#e9d5ff;color:#7e22ce}
        .rw-tabs{display:flex;gap:8px;border-bottom:2px solid #e2e8f0;padding-bottom:0;margin-bottom:16px}
        .rw-tab{padding:10px 18px;border-radius:12px 12px 0 0;border:1px solid transparent;background:none;cursor:pointer;font-size:13px;font-weight:700;color:#64748b;transition:all .15s}
        .rw-tab:hover{background:#f8fafc}
        .rw-tab.on{background:#fff;border-color:#e2e8f0;border-bottom-color:#fff;color:#0f172a;margin-bottom:-2px}
        .rw-grid{display:grid;gap:12px}
        .rw-2{grid-template-columns:1fr 1fr}
        .rw-3{grid-template-columns:repeat(3,1fr)}
        @media(max-width:640px){.rw-2,.rw-3{grid-template-columns:1fr}}
        label{display:block;font-size:12px;font-weight:700;margin:0 0 5px;color:#374151}
        input,select,textarea,button{font-family:inherit;font-size:14px;border-radius:12px}
        input,select,textarea{width:100%;border:1.5px solid #e2e8f0;padding:10px 12px;background:#fff;color:#0f172a;box-sizing:border-box}
        input:focus,select:focus,textarea:focus{outline:none;border-color:#6366f1}
        textarea{min-height:76px;resize:vertical}
        button{border:0;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;font-weight:800;padding:10px 16px;cursor:pointer;transition:opacity .15s}
        button:disabled{opacity:.5;cursor:not-allowed}
        button:hover:not(:disabled){opacity:.88}
        .btn-ghost{background:#f1f5f9;color:#0f172a;box-shadow:none}
        .btn-sm{padding:6px 12px;font-size:12px;border-radius:10px}
        .btn-amber{background:linear-gradient(135deg,#f59e0b,#d97706)}
        .btn-resend{background:linear-gradient(135deg,#0ea5e9,#0284c7)}
        .rw-muted{font-size:12px;color:#64748b}
        .rw-badge{display:inline-block;border-radius:999px;padding:3px 9px;font-size:11px;font-weight:700;white-space:nowrap}
        .badge-green{background:#ecfdf5;color:#047857}
        .badge-red{background:#fff1f2;color:#be123c}
        .badge-amber{background:#fffbeb;color:#b45309}
        .badge-blue{background:#eff6ff;color:#1d4ed8}
        .badge-gray{background:#f8fafc;color:#475569}
        .badge-slate{background:#f1f5f9;color:#334155}
        .rw-table{width:100%;border-collapse:collapse}
        .rw-table th{background:#f8fafc;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.5px;padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0;white-space:nowrap}
        .rw-table td{padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;vertical-align:middle}
        .rw-table tr:hover td{background:#f8fafc}
        .rw-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
        .rw-pending-row{border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;margin-bottom:10px;background:#fff;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
        .rw-pending-row:hover{border-color:#c7d2fe;background:#fafbff}
        .rw-seq{width:28px;height:28px;border-radius:50%;background:#e0e7ff;color:#3730a3;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .rw-msg{font-weight:700;color:#1d4ed8;font-size:13px;padding:8px 12px;background:#eff6ff;border-radius:10px;margin:0}
        .rw-err{color:#be123c;background:#fff1f2}
        .rw-success{color:#047857;background:#ecfdf5}
        .form-section{border-radius:14px;padding:16px;margin-bottom:14px}
        .sec-blue{background:#eff6ff;border:1px solid #bfdbfe}
        .sec-purple{background:#faf5ff;border:1px solid #e9d5ff}
        .sec-green{background:#f0fdf4;border:1px solid #bbf7d0}
        .sec-orange{background:#fff7ed;border:1px solid #fed7aa}
        .sec-selected{background:#ecfdf5;border:2px solid #6ee7b7}
        .sec-gray{background:#f8fafc;border:1px solid #e2e8f0}
        .sec-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px}
        .filters-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px}
        .filters-bar>div{flex:1;min-width:160px}
        .chip-bar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
        .chip{padding:5px 12px;border-radius:999px;font-size:12px;font-weight:700;border:1.5px solid #e2e8f0;cursor:pointer;background:#fff;color:#64748b}
        .chip.active{background:#0f172a;color:#fff;border-color:#0f172a}
      `}</style>

      {/* ── Header ── */}
      <div className="rw-header">
        <h1>Recruiter Workspace</h1>
        <p>
          {recruiterProfile
            ? `${recruiterProfile.name} · ${recruiterProfile.branch}${recruiterProfile.recruiterCode ? ` · ${recruiterProfile.recruiterCode}` : ""}`
            : "Authorised candidate queue"}
        </p>
      </div>

      <div className="rw-wrap">
        {screen === "workspace" && <>

          {/* ── KPI Bar ── */}
          <div className="rw-kpi-grid">
            <div className="rw-kpi kpi-blue">
              <div className="rw-kpi-label">Queue Now</div>
              <div className="rw-kpi-num">{queueCount}</div>
            </div>
            <div className="rw-kpi kpi-gray">
              <div className="rw-kpi-label">Seen Today</div>
              <div className="rw-kpi-num">{seenToday}</div>
            </div>
            <div className="rw-kpi kpi-green">
              <div className="rw-kpi-label">Selected</div>
              <div className="rw-kpi-num">{selectedToday}</div>
            </div>
            <div className="rw-kpi kpi-red">
              <div className="rw-kpi-label">Rejected</div>
              <div className="rw-kpi-num">{rejectedToday}</div>
            </div>
            <div className="rw-kpi kpi-yellow">
              <div className="rw-kpi-label">No Shows</div>
              <div className="rw-kpi-num">{noshowToday}</div>
            </div>
            <div className="rw-kpi kpi-purple">
              <div className="rw-kpi-label">Conversion</div>
              <div className="rw-kpi-num">{convRate}%</div>
            </div>
          </div>

          {/* ── Tab bar + header actions ── */}
          <div className="rw-card" style={{ paddingBottom: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 0 }}>
              <div className="rw-tabs">
                <button className={`rw-tab ${tab === "pending" ? "on" : ""}`} onClick={() => setTab("pending")}>
                  Pending Queue {pending.length > 0 && <span style={{ marginLeft: 4 }}>({pending.length})</span>}
                </button>
                <button className={`rw-tab ${tab === "history" ? "on" : ""}`} onClick={() => setTab("history")}>
                  Submission History {history.length > 0 && <span style={{ marginLeft: 4 }}>({history.length})</span>}
                </button>
              </div>
              <button className="btn-ghost" onClick={refresh} disabled={loading} style={{ padding: "7px 14px", fontSize: 12, borderRadius: 10, marginBottom: 2 }}>
                {loading ? "…" : "↻ Refresh"}
              </button>
            </div>
          </div>

          {msg && <p className={`rw-msg ${msg.toLowerCase().includes("error") || msg.toLowerCase().includes("unable") ? "rw-err" : ""}`}>{msg}</p>}

          {/* ── PENDING QUEUE TAB ── */}
          {tab === "pending" && (
            <div className="rw-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15 }}>Waiting Candidates</h3>
                  <p className="rw-muted" style={{ margin: "3px 0 0" }}>Oldest registration at top · auto-refreshes every 90s</p>
                </div>
              </div>

              {pending.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 0", color: "#64748b" }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>✓</div>
                  <p style={{ margin: 0, fontWeight: 700 }}>Queue is clear</p>
                  <p className="rw-muted" style={{ margin: "4px 0 0" }}>No waiting candidates right now.</p>
                </div>
              ) : (
                pending.map((c, idx) => {
                  const mins = c.pendingMinutes ?? 0;
                  return (
                    <div className="rw-pending-row" key={c.candidateId}>
                      <div className="rw-seq">{idx + 1}</div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{c.fullName || "—"}</div>
                        <div className="rw-muted">{c.mobile || "—"}</div>
                      </div>
                      <div style={{ minWidth: 100 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Process</div>
                        <div style={{ fontSize: 13 }}>{c.roleApplied || "—"}</div>
                      </div>
                      <div style={{ minWidth: 100 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Branch</div>
                        <div style={{ fontSize: 13 }}>{c.branch || "—"}</div>
                      </div>
                      <div style={{ minWidth: 70 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Arrived</div>
                        <div style={{ fontSize: 13 }}>{fmtTime(c.createdAt)}</div>
                      </div>
                      <div style={{ minWidth: 60 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Wait</div>
                        <WaitBadge mins={mins} />
                      </div>
                      <button
                        style={{ width: "auto", padding: "8px 16px", fontSize: 13, flexShrink: 0 }}
                        disabled={!recruiterProfile}
                        onClick={() => openForm(c)}
                      >
                        {recruiterProfile ? "Interview →" : "View Only"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ── SUBMISSION HISTORY TAB ── */}
          {tab === "history" && (
            <div className="rw-card">
              <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Submission History</h3>

              {/* Filters */}
              <div className="filters-bar">
                <div style={{ flex: 2 }}>
                  <label>Search</label>
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, mobile, candidate ID…" />
                </div>
                <div>
                  <label>Decision</label>
                  <select value={decision} onChange={(e) => setDecision(e.target.value)}>
                    <option value="All">All Decisions</option>
                    <option value="Selected">Selected</option>
                    <option value="Rejected">Rejected</option>
                    <option value="Hold">Hold</option>
                    <option value="Client Round - Pending">Client Round - Pending</option>
                    <option value="No Show">No Show</option>
                  </select>
                </div>
                <div>
                  <label>From</label>
                  <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                </div>
                <div>
                  <label>To</label>
                  <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </div>
              </div>

              {/* Quick-filter chips */}
              <div className="chip-bar">
                {["All", "Selected", "Rejected", "Hold", "No Show", "Client Round - Pending"].map((d) => (
                  <button key={d} className={`chip ${decision === d ? "active" : ""}`} onClick={() => setDecision(d)}>{d}</button>
                ))}
              </div>

              {/* Sub-stats */}
              <div className="rw-grid rw-3" style={{ marginBottom: 14 }}>
                <div className="rw-kpi kpi-gray">
                  <div className="rw-kpi-label">Showing</div>
                  <div className="rw-kpi-num" style={{ fontSize: 20 }}>{filteredHistory.length}</div>
                </div>
                <div className="rw-kpi kpi-green">
                  <div className="rw-kpi-label">Selected</div>
                  <div className="rw-kpi-num" style={{ fontSize: 20 }}>{filteredHistory.filter(h => h.final_decision === "Selected").length}</div>
                </div>
                <div className="rw-kpi kpi-blue">
                  <div className="rw-kpi-label">Onboarding Pending</div>
                  <div className="rw-kpi-num" style={{ fontSize: 20 }}>
                    {filteredHistory.filter(h => h.final_decision === "Selected" && h.onboarding_status !== "onboarding_complete" && h.onboarding_status !== "completed").length}
                  </div>
                </div>
              </div>

              {resendMsg && (
                <p className={`rw-msg ${resendMsg.ok ? "rw-success" : "rw-err"}`} style={{ marginBottom: 10 }}>
                  {resendMsg.text}
                </p>
              )}

              {filteredHistory.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 0", color: "#64748b" }}>
                  <p style={{ margin: 0 }}>No submissions match the current filters.</p>
                </div>
              ) : (
                <div className="rw-scroll">
                  <table className="rw-table" style={{ minWidth: 1000 }}>
                    <thead>
                      <tr>
                        <th>Candidate</th>
                        <th>Mobile</th>
                        <th>Process</th>
                        <th>Decision</th>
                        <th>Stage</th>
                        <th>Skill</th>
                        <th>Offer</th>
                        <th>DOJ</th>
                        <th>Submitted</th>
                        <th>Onboarding</th>
                        <th>Email</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHistory.map((h) => {
                        const isSelected = h.final_decision === "Selected";
                        const canResubmit = h.final_decision === "Client Round - Pending" && !!recruiterProfile;
                        const canRectify = !!recruiterProfile;
                        const canResend = isSelected && (h.email_dispatch_status === "skipped" || h.email_dispatch_status === "failed");
                        const isSending = resendingId === h.candidate_id;
                        const skillInfo = [
                          h.skilltest_typing != null ? `T:${h.skilltest_typing}` : null,
                          h.skilltest_ai != null ? `AI:${h.skilltest_ai}` : null,
                          h.skilltest_result ? h.skilltest_result : null,
                        ].filter(Boolean).join(" · ");

                        return (
                          <tr key={h.id} style={isSelected ? { background: "#f0fdf4" } : {}}>
                            <td>
                              <div style={{ fontWeight: 700 }}>{h.full_name || "—"}</div>
                              <div className="rw-muted">{h.candidate_code || h.candidate_id}</div>
                            </td>
                            <td>
                              <div>{h.mobile || "—"}</div>
                              {h.email && <div className="rw-muted" style={{ fontSize: 11 }}>{h.email}</div>}
                            </td>
                            <td style={{ fontSize: 12 }}>{h.interviewed_for_process || "—"}</td>
                            <td><DecisionBadge value={h.final_decision} /></td>
                            <td style={{ fontSize: 12, maxWidth: 130 }}>{h.walkin_end_stage || "—"}</td>
                            <td style={{ fontSize: 12 }}>{skillInfo || "—"}</td>
                            <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                              {h.offer_salary ? `₹${Number(h.offer_salary).toLocaleString("en-IN")}/mo` : "—"}
                            </td>
                            <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(h.offer_doj)}</td>
                            <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmt(h.submitted_at)}</td>
                            <td>
                              <OnboardingBadge row={h} />
                              {isSelected && h.onboarding_joining_date && (
                                <div className="rw-muted" style={{ fontSize: 11, marginTop: 2 }}>DOJ: {fmtDate(h.onboarding_joining_date)}</div>
                              )}
                            </td>
                            <td><EmailBadge status={h.email_dispatch_status} /></td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {canResend && (
                                <button
                                  className="btn-sm btn-resend"
                                  style={{ display: "block", marginBottom: 4, width: "auto" }}
                                  disabled={isSending}
                                  onClick={() => handleResendLink(h)}
                                  title="Resend onboarding link"
                                >
                                  {isSending ? "…" : "Resend Link"}
                                </button>
                              )}
                              {canResubmit && (
                                <button
                                  className="btn-sm"
                                  style={{ display: "block", marginBottom: 4, width: "auto" }}
                                  onClick={() => openForm({ candidateId: h.candidate_id, qToken: h.q_token ?? undefined, fullName: h.full_name ?? undefined, mobile: h.mobile ?? undefined }, true, h)}
                                >
                                  Resubmit
                                </button>
                              )}
                              {canRectify && (
                                <button
                                  className="btn-sm btn-amber"
                                  style={{ display: "block", width: "auto" }}
                                  onClick={() => openForm({ candidateId: h.candidate_id, qToken: h.q_token ?? undefined, fullName: h.full_name ?? undefined, mobile: h.mobile ?? undefined }, false, h)}
                                >
                                  Rectify
                                </button>
                              )}
                              {!canResend && !canResubmit && !canRectify && <span className="rw-muted">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>}

        {/* ── INTERVIEW FORM ── */}
        {screen === "form" && selected && (
          <div className="rw-card">
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <button className="btn-ghost" onClick={() => setScreen("workspace")} style={{ width: "auto", padding: "8px 16px" }}>← Back</button>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Update Candidate</h2>
                <p className="rw-muted" style={{ margin: "2px 0 0" }}><b>{selected.fullName}</b> · {selected.mobile}</p>
              </div>
            </div>

            {/* Walk-in Summary */}
            <div className="form-section sec-gray">
              <div className="sec-title" style={{ color: "#475569" }}>Walk-in Summary</div>
              <div className="rw-grid rw-3">
                {field("Interviewed for Process *", "processName", "select", config.processOptions)}
                {field("Walk-in End Stage *", "stageName", "select", reachableStageOptions)}
                {field("Final Decision *", "finalDecision", "select", config.decisionOptions)}
              </div>
            </div>

            {/* Round 1 */}
            {effectiveRank >= 1 && (
              <div className="form-section sec-blue">
                <div className="sec-title" style={{ color: "#1d4ed8" }}>Round 1 — HR Screening</div>
                <div className="rw-grid rw-2">
                  {field("Round 1 Result *", "round1Result", "select", config.decisionOptions)}
                  {form.round1Result === "Rejected" && field("Round 1 VOC *", "round1Voc", "select", config.vocOptions)}
                </div>
                <div style={{ marginTop: 10 }}>{field("Round 1 Remarks", "round1Remarks", "textarea")}</div>
              </div>
            )}

            {/* Skill Test */}
            {effectiveRank >= 2 && (
              <div className="form-section sec-purple">
                <div className="sec-title" style={{ color: "#7c3aed" }}>Skill Test</div>
                <div className="rw-grid rw-3">
                  {field("Typing Score", "skillTypingScore", "input")}
                  {field("AI Score", "skillAiScore", "input")}
                  {field("Skill Test Result", "skillResult", "select", config.decisionOptions)}
                </div>
                {form.skillResult === "Rejected" && (
                  <div style={{ marginTop: 10 }} className="rw-grid rw-2">
                    {field("Skill Test VOC *", "skillVoc", "select", config.skillVocOptions)}
                  </div>
                )}
                <div style={{ marginTop: 10 }}>{field("Skill Test Remarks", "skillRemarks", "textarea")}</div>
              </div>
            )}

            {/* Round 2 */}
            {effectiveRank >= 3 && (
              <div className="form-section sec-green">
                <div className="sec-title" style={{ color: "#047857" }}>Round 2 — Operations</div>
                <div className="rw-grid rw-2">
                  {field("Round 2 Result *", "round2Result", "select", config.decisionOptions)}
                  {form.round2Result === "Rejected" && field("Round 2 VOC *", "round2Voc", "select", config.vocOptions)}
                </div>
                <div style={{ marginTop: 10 }}>{field("Round 2 Remarks", "round2Remarks", "textarea")}</div>
              </div>
            )}

            {/* Round 3 */}
            {effectiveRank >= 4 && (
              <div className="form-section sec-orange">
                <div className="sec-title" style={{ color: "#c2410c" }}>Round 3 — Client</div>
                <div className="rw-grid rw-2">
                  {field("Round 3 Result *", "round3Result", "select", config.decisionOptions)}
                  {form.round3Result === "Rejected" && field("Round 3 VOC *", "round3Voc", "select", config.vocOptions)}
                </div>
                <div style={{ marginTop: 10 }}>{field("Round 3 Remarks", "round3Remarks", "textarea")}</div>
              </div>
            )}

            {effectiveRank >= 3 && (
              <div className="form-section sec-green">
                <div className="sec-title" style={{ color: "#047857" }}>Second Round Interviewer</div>
                <div className="rw-grid rw-2">
                  <div ref={interviewerSearchRef} style={{ position: "relative" }}>
                    <label>Second Round Interviewer *</label>
                    <input
                      type="text"
                      placeholder="Type name to search…"
                      value={interviewerSearch}
                      autoComplete="off"
                      onChange={(e) => {
                        const q = e.target.value;
                        setInterviewerSearch(q);
                        setInterviewerDropOpen(true);
                        searchInterviewers(q);
                        if (!q) updateForm({ secondRoundInterviewerId: "", secondRoundInterviewerNameSnapshot: "" });
                      }}
                      onFocus={() => {
                        setInterviewerDropOpen(true);
                        if (!interviewers.length) searchInterviewers(interviewerSearch);
                      }}
                    />
                    {interviewerDropOpen && (
                      <div style={{
                        position: "absolute", top: "100%", left: 0, right: 0, zIndex: 9999,
                        background: "#fff", border: "1px solid #d1d5db", borderRadius: 8,
                        boxShadow: "0 4px 16px rgba(0,0,0,0.12)", maxHeight: 220, overflowY: "auto",
                      }}>
                        {interviewerSearchLoading && (
                          <div style={{ padding: "8px 12px", color: "#6b7280", fontSize: 13 }}>Searching…</div>
                        )}
                        {!interviewerSearchLoading && interviewers.length === 0 && (
                          <div style={{ padding: "8px 12px", color: "#6b7280", fontSize: 13 }}>No interviewers found</div>
                        )}
                        {!interviewerSearchLoading && interviewers.map((item) => (
                          <div
                            key={item.id}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              updateForm({ secondRoundInterviewerId: item.id, secondRoundInterviewerNameSnapshot: item.name });
                              setInterviewerSearch(item.name);
                              setInterviewerDropOpen(false);
                            }}
                            style={{
                              padding: "8px 12px", cursor: "pointer", fontSize: 14,
                              background: form.secondRoundInterviewerId === item.id ? "#dcfce7" : undefined,
                              borderBottom: "1px solid #f3f4f6",
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#f0fdf4"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = form.secondRoundInterviewerId === item.id ? "#dcfce7" : ""; }}
                          >
                            <span style={{ fontWeight: 500 }}>{item.name}</span>
                            {item.designation_name && <span style={{ color: "#6b7280", marginLeft: 6, fontSize: 12 }}>· {item.designation_name}</span>}
                            {item.branch_name && <span style={{ color: "#9ca3af", marginLeft: 4, fontSize: 12 }}>· {item.branch_name}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label>Interviewer Snapshot</label>
                    <input value={form.secondRoundInterviewerNameSnapshot} readOnly placeholder="Auto-filled from selection" />
                  </div>
                </div>
              </div>
            )}

            {rank >= 4 && (
              <div className="form-section sec-orange">
                <div className="sec-title" style={{ color: "#c2410c" }}>Client Round</div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <input
                    type="checkbox"
                    checked={form.clientRoundConducted}
                    onChange={(e) => updateForm({ clientRoundConducted: e.target.checked })}
                  />
                  Client round conducted
                </label>
                <div className="rw-grid rw-2">
                  <div>
                    <label>Client Round Interviewer Name</label>
                    <input
                      value={form.clientRoundInterviewerName}
                      onChange={(e) => updateForm({ clientRoundInterviewerName: e.target.value })}
                      placeholder="Manually enter client interviewer"
                    />
                  </div>
                  <div>
                    <label>Client Round Result</label>
                    <select
                      value={form.clientRoundResult}
                      onChange={(e) => updateForm({ clientRoundResult: e.target.value })}
                    >
                      <option value="">Select result</option>
                      {config.decisionOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>{field("Client Round Remarks", "clientRoundRemarks", "textarea")}</div>
              </div>
            )}


            {/* Offer Details */}
            {form.finalDecision === "Selected" && (
              <div className="form-section sec-selected">
                <div className="sec-title" style={{ color: "#047857" }}>Offer Details (Required for Selected)</div>
                <div className="rw-grid rw-3">
                  {field("Offer Salary *", "offerSalary", "input")}
                  {field("Date of Joining *", "offerDoj", "input")}
                  {field("Reporting Timing *", "reportingTiming", "input")}
                </div>
                <div className="rw-grid rw-2" style={{ marginTop: 10 }}>
                  {field("OT Details", "otDetails", "input")}
                  {field("Performance Incentives", "performanceIncentives", "input")}
                </div>
              </div>
            )}

            {msg && <p className={`rw-msg ${msg.toLowerCase().includes("error") || msg.toLowerCase().includes("unable") || msg.toLowerCase().includes("required") ? "rw-err" : ""}`} style={{ marginBottom: 12 }}>{msg}</p>}
            <button disabled={loading} onClick={submit} style={{ width: "100%", padding: "14px", fontSize: 15, borderRadius: 14 }}>
              {loading ? "Submitting…" : "Submit Update"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
