import { hrmsApi } from "@/lib/hrmsApi";

// Module-level cache for the candidate list shared by DashboardReplica, DashboardV2, and CommandCenter.
// Backend ATS validation caps candidate list requests at 200 rows, so the dashboard pages safely.
const _candidateListCache: { data: any[] | null; fetchedAt: number } = { data: null, fetchedAt: 0 };
const CANDIDATE_LIST_STALE_MS = 60_000; // 1 minute
const CANDIDATE_PAGE_LIMIT = 200;

export async function getCachedCandidateList(limit = 3000): Promise<any[]> {
  const now = Date.now();
  if (_candidateListCache.data && now - _candidateListCache.fetchedAt < CANDIDATE_LIST_STALE_MS) {
    return _candidateListCache.data;
  }

  const target = Math.max(1, Math.min(Number(limit) || CANDIDATE_PAGE_LIMIT, 3000));
  const rows: any[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (rows.length < target && rows.length < total) {
    const res = await hrmsApi.get<{ success: boolean; data: any[]; total?: number }>(
      `/api/ats/candidates?limit=${CANDIDATE_PAGE_LIMIT}&page=${page}`
    );
    const pageRows = res.data ?? [];
    rows.push(...pageRows);
    total = typeof res.total === "number" ? res.total : rows.length;
    if (pageRows.length < CANDIDATE_PAGE_LIMIT) break;
    page += 1;
  }

  _candidateListCache.data = rows.slice(0, target);
  _candidateListCache.fetchedAt = now;
  return _candidateListCache.data;
}

export function invalidateCandidateListCache(): void {
  _candidateListCache.data = null;
  _candidateListCache.fetchedAt = 0;
}

export type AtsDashQueueRow = {
  QToken: string;
  CandidateID: string;
  FullName: string;
  Branch: string;
  RoleApplied: string;
  RecruiterAssignedName: string;
  RecruiterMobile: string;
  CurrentStage: string;
  Status: string;
  WaitingMinutes: number;
  waitingLabel: string;
  SLAFlag: string;
  Email: string;
};

export type AtsDashCandidateRow = Record<string, any> & {
  CandidateID: string;
  QToken: string;
  FullName: string;
  Mobile: string;
  Email: string;
  Branch: string;
  RoleApplied: string;
  RecruiterAssignedName: string;
  RecruiterMobile: string;
  Status: string;
  FinalDecision: string;
  Process: string;
  Source: string;
  CreatedDate: string;
  CreatedTime: string;
  _dateKey: string;
  _monthKey: string;
  _weekKey: string;
  _role: string;
  _branch: string;
  _process: string;
  _recruiter: string;
  _sourcer: string;
  _slot: string;
  _status: string;
  _finalDecision: string;
  _endStage: string;
  _totalMinutes: number;
  _slaBreached: boolean;
  _selected: boolean;
  _rejected: boolean;
  _onHold: boolean;
  _waiting: boolean;
  _noShow: boolean;
  _walkout: boolean;
  _stageVoc: Record<string, string>;
  _source: string;
  _roundSuccessCount: number;
  _hardRejectReason: string;
  _candidateQualityScore: number;
  _candidateQualityLabel: string;
  _handlingQualityScore: number;
  _handlingQualityLabel: string;
  _reusableReason: string;
};

export type AtsDashDashboardRow = {
  Date: string;
  _dateKey: string;
  "Total Arrival": number;
  Selection: number;
  Rejection: number;
  "On Hold": number;
  Pending: number;
  "Un-attended": number;
  "SLA Breach": number;
  "Avg Time": number;
  "HR Screening": number;
  Assessment: number;
  "OP's Round": number;
  "Client Round": number;
};

export type AtsDashPayload = {
  ok: boolean;
  orgName: string;
  refreshTime: string;
  todayISO: string;
  options: {
    months: string[];
    branches: string[];
    roles: string[];
    processes: string[];
    recruiters: string[];
    sourcers: string[];
    slots: string[];
  };
  queueRows: AtsDashQueueRow[];
  dashboardRows: AtsDashDashboardRow[];
  candidateRows: AtsDashCandidateRow[];
  error?: string;
};

type RawCandidate = Record<string, any>;
type RawAssignment = Record<string, any>;
type RawSubmission = Record<string, any>;

const TZ = "Asia/Kolkata";
const SLA_MINUTES = 120;

function safeText(v: any): string {
  return String(v ?? "").trim();
}

function lower(v: any): string {
  return safeText(v).toLowerCase();
}

function dateKey(value: any): string {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

function monthKey(value: any): string {
  const key = dateKey(value);
  return key ? key.slice(0, 7) : "";
}

function weekKey(value: any): string {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const local = new Date(d.toLocaleString("en-US", { timeZone: TZ }));
  const day = local.getDay() || 7;
  local.setDate(local.getDate() - day + 1);
  return dateKey(local.toISOString());
}

function displayDate(value: any): string {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" });
}

function displayTime(value: any): string {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function slotLabel(timeValue: string): string {
  const h = Number(String(timeValue || "00:00").slice(0, 2));
  if (h < 11) return "Morning";
  if (h < 15) return "Afternoon";
  if (h < 19) return "Evening";
  return "Late Evening";
}

function waitingMinutes(createdAt: any): number {
  const d = createdAt ? new Date(createdAt) : null;
  if (!d || Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
}

function formatMinutes(mins: any): string {
  const n = Number(mins || 0);
  if (n < 60) return `${n} mins`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${h}h ${m}m`;
}

function contains(text: any, tokens: string[]): boolean {
  const s = lower(text);
  return tokens.some((t) => s.includes(t));
}

function qualityLabel(score: number): string {
  if (score >= 75) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

function handlingLabel(score: number): string {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Stable";
  return "Needs Attention";
}

function roundSuccessCount(row: Record<string, any>): number {
  let count = 0;
  if (contains(row.Round1_Result, ["selected"])) count += 1;
  if (contains(row.SkillTest_Result, ["selected"])) count += 1;
  if (contains(row.Round2_Result, ["selected"])) count += 1;
  if (contains(row.Round3_Result, ["selected"])) count += 1;
  return count;
}

function hardRejectReason(row: Record<string, any>): string {
  const text = [row.Round1_VOC, row.SkillTest_VOC, row.Round2_VOC, row.Round3_VOC, row.Final_Remarks, row.Notes, row.FinalDecision, row.Status, row["Walk-in EndStage"]].join(" ").toLowerCase();
  const patterns = ["not interested", "salary mismatch", "document", "documents", "communication", "behavior", "behaviour", "location issue", "location not okay", "abscond", "fake", "fraud"];
  return patterns.find((p) => text.includes(p)) || "";
}

function candidateQualityScore(row: Record<string, any>): number {
  let score = 50;
  score += Math.min(20, roundSuccessCount(row) * 5);
  if (row._selected) score += 20;
  if (row._onHold) score += 5;
  if (row._rejected) score -= 5;
  if (row._noShow) score -= 28;
  if (row._walkout) score -= 18;
  if (row._hardRejectReason) score -= 10;
  return Math.max(0, Math.min(100, score));
}

function handlingQualityScore(row: Record<string, any>): number {
  let score = 80;
  if (row._slaBreached) score -= 25;
  if (row._totalMinutes > SLA_MINUTES) score -= 15;
  if (row._waiting) score -= 10;
  if (row._selected) score += 10;
  return Math.max(0, Math.min(100, score));
}

function reusableReason(row: Record<string, any>): string {
  if (row._selected) return "";
  if (row._noShow) return "No-show recovery";
  if (row._onHold) return "Hold follow-up";
  if (row._roundSuccessCount >= 2 && !row._hardRejectReason) return "Passed multiple rounds";
  return "";
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export async function getAtsDashboardReplicaData(): Promise<AtsDashPayload> {
  try {
    const candidates = (await getCachedCandidateList(3000)) as RawCandidate[];

    // No legacy assignment/submission tables in MySQL — use stage logs as proxy
    const assignmentById = new Map<string, RawAssignment>();
    const latestSubmissionByCode = new Map<string, RawSubmission>();

    const candidateRows: AtsDashCandidateRow[] = (candidates || []).map((c: RawCandidate) => {
      const a = assignmentById.get(c.id) || {};
      const s = latestSubmissionByCode.get(c.candidate_code || "") || {};
      const createdAt = c.created_at;
      const createdTime = displayTime(createdAt);
      const finalDecision = safeText(s.final_decision || c.status || "Waiting");
      const status = safeText(c.status || (s.final_decision ? "In Progress" : "Waiting"));
      const endStage = safeText(s.walkin_end_stage || c.walkin_end_stage || "Arrival");
      const totalMinutes = s.submitted_at ? Math.max(0, Math.floor((new Date(s.submitted_at).getTime() - new Date(createdAt).getTime()) / 60000)) : waitingMinutes(createdAt);
      const row: AtsDashCandidateRow = {
        CandidateID: safeText(c.candidate_code),
        QToken: safeText(c.q_token),
        FullName: safeText(c.full_name),
        Mobile: safeText(c.mobile),
        Email: safeText(c.email),
        Address: safeText(c.address),
        Education: safeText(c.education),
        Experience: safeText(c.experience),
        Gender: safeText(c.gender),
        Branch: safeText(c.branch_name || a.branch_name),
        RoleApplied: safeText(c.role_applied),
        RecruiterSelected: safeText(c.recruiter_name),
        RecruiterAssignedName: safeText(a.recruiter_name || c.recruiter_name || s.recruiter_name),
        RecruiterMobile: safeText(a.recruiter_mobile),
        RecruiterEmail: safeText(a.recruiter_email),
        Status: status,
        FinalDecision: finalDecision,
        Process: safeText(s.interviewed_for_process || c.role_applied || "Unspecified"),
        Source: safeText(c.metadata?.source || c.source_system || "Native ATS"),
        CreatedDate: displayDate(createdAt),
        CreatedTime: createdTime,
        LastUpdated: safeText(s.submitted_at || c.updated_at || c.created_at),
        "Total Time Consumed": formatMinutes(totalMinutes),
        "Time taken": formatMinutes(totalMinutes),
        "SLA Breached ( 120 Mins)": totalMinutes > SLA_MINUTES ? "Yes" : "No",
        "Walk-in EndStage": endStage,
        Round1_Result: safeText(s.round1_result),
        Round1_VOC: safeText(s.round1_voc),
        SkillTest_Result: safeText(s.skill_result),
        SkillTest_VOC: safeText(s.skill_voc),
        Round2_Result: safeText(s.round2_result),
        Round2_VOC: safeText(s.round2_voc),
        Round3_Result: safeText(s.round3_result),
        Round3_VOC: safeText(s.round3_voc),
        OfferSalary: safeText(s.offer_salary),
        OfferDOJ: safeText(s.offer_doj),
        _dateKey: dateKey(createdAt),
        _monthKey: monthKey(createdAt),
        _weekKey: weekKey(createdAt),
        _role: safeText(c.role_applied || "Unspecified"),
        _branch: safeText(c.branch_name || a.branch_name || "Unspecified"),
        _process: safeText(s.interviewed_for_process || c.role_applied || "Unspecified"),
        _recruiter: safeText(a.recruiter_name || c.recruiter_name || s.recruiter_name || "Unassigned"),
        _sourcer: safeText(c.recruiter_name || a.recruiter_name || "Unspecified"),
        _slot: slotLabel(createdTime),
        _status: status,
        _finalDecision: finalDecision,
        _endStage: endStage,
        _totalMinutes: totalMinutes,
        _slaBreached: totalMinutes > SLA_MINUTES,
        _selected: contains(finalDecision || status, ["selected"]),
        _rejected: contains(finalDecision || status, ["rejected"]),
        _onHold: contains(finalDecision || status, ["hold"]),
        _waiting: contains(status, ["waiting"]),
        _noShow: contains(endStage || finalDecision, ["no show", "noshow"]),
        _walkout: contains(endStage || finalDecision, ["walkout", "dropout", "walk out", "drop out"]),
        _stageVoc: {
          "HR Screening": safeText(s.round1_voc),
          Assessment: safeText(s.skill_voc),
          "OP's Round": safeText(s.round2_voc),
          "Client Round": safeText(s.round3_voc),
        },
        _source: safeText(c.metadata?.source || c.source_system || c.recruiter_name || "Unspecified"),
        _roundSuccessCount: 0,
        _hardRejectReason: "",
        _candidateQualityScore: 0,
        _candidateQualityLabel: "",
        _handlingQualityScore: 0,
        _handlingQualityLabel: "",
        _reusableReason: "",
      };
      row._roundSuccessCount = roundSuccessCount(row);
      row._hardRejectReason = hardRejectReason(row);
      row._candidateQualityScore = candidateQualityScore(row);
      row._candidateQualityLabel = qualityLabel(row._candidateQualityScore);
      row._handlingQualityScore = handlingQualityScore(row);
      row._handlingQualityLabel = handlingLabel(row._handlingQualityScore);
      row._reusableReason = reusableReason(row);
      return row;
    });

    const queueRows: AtsDashQueueRow[] = candidateRows
      .filter((r) => r._waiting && !r.FinalDecision.toLowerCase().includes("selected") && !r.FinalDecision.toLowerCase().includes("rejected"))
      .map((r) => ({
        QToken: r.QToken,
        CandidateID: r.CandidateID,
        FullName: r.FullName,
        Branch: r.Branch,
        RoleApplied: r.RoleApplied,
        RecruiterAssignedName: r.RecruiterAssignedName,
        RecruiterMobile: r.RecruiterMobile,
        CurrentStage: r["Walk-in EndStage"] || "Arrival",
        Status: r.Status || "Waiting",
        WaitingMinutes: r._totalMinutes,
        waitingLabel: formatMinutes(r._totalMinutes),
        SLAFlag: r._totalMinutes > SLA_MINUTES ? "BREACH" : "OK",
        Email: r.Email,
      }));

    const daily = new Map<string, AtsDashDashboardRow>();
    candidateRows.forEach((r) => {
      const k = r._dateKey || "Unparsed";
      const item = daily.get(k) || {
        Date: k,
        _dateKey: k,
        "Total Arrival": 0,
        Selection: 0,
        Rejection: 0,
        "On Hold": 0,
        Pending: 0,
        "Un-attended": 0,
        "SLA Breach": 0,
        "Avg Time": 0,
        "HR Screening": 0,
        Assessment: 0,
        "OP's Round": 0,
        "Client Round": 0,
      };
      item["Total Arrival"] += 1;
      if (r._selected) item.Selection += 1;
      if (r._rejected || r._noShow) item.Rejection += 1;
      if (r._onHold) item["On Hold"] += 1;
      if (r._waiting) item.Pending += 1;
      if (!r.FinalDecision || r.FinalDecision === "Waiting") item["Un-attended"] += 1;
      if (r._slaBreached) item["SLA Breach"] += 1;
      if (contains(r["Walk-in EndStage"], ["hr screening"])) item["HR Screening"] += 1;
      if (contains(r["Walk-in EndStage"], ["skill", "assessment"])) item.Assessment += 1;
      if (contains(r["Walk-in EndStage"], ["op's", "ops", "round 2"])) item["OP's Round"] += 1;
      if (contains(r["Walk-in EndStage"], ["client", "round 3"])) item["Client Round"] += 1;
      daily.set(k, item);
    });

    const dashboardRows = Array.from(daily.values()).map((d) => {
      const dayRows = candidateRows.filter((r) => r._dateKey === d._dateKey);
      d["Avg Time"] = dayRows.length ? Math.round(dayRows.reduce((a, r) => a + r._totalMinutes, 0) / dayRows.length) : 0;
      return d;
    }).sort((a, b) => String(a._dateKey).localeCompare(String(b._dateKey)));

    return {
      ok: true,
      orgName: "ATS Command Center",
      refreshTime: new Date().toLocaleString("en-IN", { timeZone: TZ, dateStyle: "medium", timeStyle: "medium" }),
      todayISO: dateKey(new Date().toISOString()),
      options: {
        months: uniq(candidateRows.map((r) => r._monthKey)),
        branches: uniq(candidateRows.map((r) => r._branch).concat(queueRows.map((r) => r.Branch))),
        roles: uniq(candidateRows.map((r) => r._role).concat(queueRows.map((r) => r.RoleApplied))),
        processes: uniq(candidateRows.map((r) => r._process)),
        recruiters: uniq(candidateRows.map((r) => r._recruiter).concat(queueRows.map((r) => r.RecruiterAssignedName))),
        sourcers: uniq(candidateRows.map((r) => r._sourcer)),
        slots: uniq(candidateRows.map((r) => r._slot)),
      },
      queueRows,
      dashboardRows,
      candidateRows,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || String(err || "Unable to load ATS dashboard"),
      orgName: "ATS Command Center",
      refreshTime: "",
      todayISO: dateKey(new Date().toISOString()),
      options: { months: [], branches: [], roles: [], processes: [], recruiters: [], sourcers: [], slots: [] },
      queueRows: [],
      dashboardRows: [],
      candidateRows: [],
    };
  }
}
