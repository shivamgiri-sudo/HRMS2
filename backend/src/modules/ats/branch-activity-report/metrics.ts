/**
 * Branch Recruitment Activity Report — calculation layer (pure, no DB, no I/O).
 *
 * One row per walk-in token ("TokenFact"). Everything in the email — FTD/WTD/MTD, funnel,
 * SLA scorecard, recruiter table, escalations — is an aggregation of these rows, so every
 * number in the report can be traced to the same list.
 *
 * ── Definitions ─────────────────────────────────────────────────────────────────────────
 *  Walk-in           distinct candidates issued a queue token in the period (queue row OR ats_candidate.q_token)
 *  Token generated   queue tokens issued in the period (a candidate visiting twice in a day = 2 tokens, 1 walk-in)
 *  Interview called  token where a call timestamp exists (called_at / candidate_called_at /
 *                    interview_started_at)
 *  Token closed      recruiter submitted the interview form (an ats_interview_submission row) or the
 *                    candidate has a final decision / left the waiting state. A queue token marked
 *                    "completed" while the candidate is still Arrived / Waiting is NOT closed.
 *  Interviewed       closed, and outcome is neither no-show nor walk-out
 *  Open              token NOT closed — the recruiter still owes a closure; its clock keeps running
 *
 *  SLA-1  Waiting → Interview call     arrival → call      target  {waitToCallMin} min
 *  SLA-2  Interview call → Closure     call → closure      target  {callToClosureMin} min
 *  SLA % = met ÷ (met + breached). A token still inside its SLA is undecided and excluded;
 *  an open token already past its SLA counts as a breach (its clock is still running).
 *
 *  Selection %  Selected ÷ Interviewed        Yield %  Selected ÷ Walk-ins
 *
 *  Token-cohort metrics (walk-ins … open) group by the day the token was issued.
 *  "Forms submitted" is activity-based: interview forms submitted in the period, whichever day the
 *  token was issued — recruiters who close yesterday's tokens today get credit today.
 */

export const SLA = {
  /** Same 20-minute wait alert the walk-in queue already uses (ats.queue.service WAIT_ALERT_MINUTES). */
  waitToCallMin: 20,
  /** Same 2-hour threshold the interview-delay-alert worker uses for called / in_interview tokens. */
  callToClosureMin: 120,
  /** Same 4-hour same-day submission SLA the existing ATS daily report uses. */
  sameDayEscalateMin: 240,
  /** Open tokens older than this are data-hygiene, not live escalations. */
  staleAfterMin: 7 * 24 * 60,
  /** Below this share of tokens carrying the timestamps an SLA needs, the % is shown as n/a, not as a verdict. */
  minCoveragePct: 50,
} as const;

export type Outcome =
  | "selected"
  | "rejected"
  | "no_show"
  | "walkout"
  | "hold"
  | "client_round"
  | "other_closed"
  | "open";

/** Row shape produced by query.ts — durations are computed in SQL so JS never parses a DATETIME. */
export interface RawTokenRow {
  token_id: string;
  candidate_id: string;
  token_number: string | null;
  full_name: string | null;
  process: string | null;
  branch_raw: string | null;
  recruiter_raw: string | null;
  arrival_date: string; // YYYY-MM-DD
  arrival_hhmm: string | null;
  queue_status: string | null; // waiting | called | in_interview | completed | no_show | null
  has_queue_row: number; // 1 = ats_queue_token row, 0 = q_token-only registration
  sub_id: string | null; // ats_interview_submission.id
  form_date: string | null; // YYYY-MM-DD the interview form was submitted
  decision_text: string | null;
  /** ats_candidate.status as stored — where post-selection states such as profile_submitted live. */
  cand_status?: string | null; // submission.final_decision ▸ candidate.final_decision ▸ status ▸ stage
  current_stage: string | null;
  wait_min: number | null; // arrival → call
  handle_min: number | null; // call → closure
  has_call: number;
  since_arrival_min: number | null; // arrival → NOW()
  since_call_min: number | null; // call → NOW()
}

export interface TokenFact {
  tokenId: string;
  candidateId: string;
  tokenNumber: string;
  candidateName: string;
  process: string;
  branch: string;
  recruiter: string;
  recruiterKey: string;
  arrivalDate: string;
  formDate: string | null;
  arrivalHhmm: string;
  tokenGenerated: boolean;
  called: boolean;
  closed: boolean;
  outcome: Outcome;
  joined: boolean;
  inInterview: boolean;
  /** Queue says completed, but no interview form / outcome exists — the candidate is still waiting. */
  queueCompletedNoOutcome: boolean;
  /** Selected candidate who has already submitted the online onboarding profile. */
  profileSubmitted: boolean;
  waitMin: number | null;
  handleMin: number | null;
  negativeDuration: boolean;
  sinceArrivalMin: number;
  sinceCallMin: number | null;
}

export interface Summary {
  walkins: number;
  tokens: number;
  called: number;
  closed: number;
  interviewed: number;
  selected: number;
  rejected: number;
  noShow: number;
  walkout: number;
  hold: number;
  clientRound: number;
  open: number;
  /** Closed with a form filed but a status that is none of the named outcomes. */
  otherClosed: number;
  /** Selected candidates whose onboarding profile is already submitted (part of `selected`). */
  profileSubmitted: number;
  /** The open tokens split by where they are stuck (sums to `open`). */
  openWaiting: number;
  openCalled: number;
  openInInterview: number;
  openQueueCompleted: number;
  joined: number;
  /** Interview forms submitted in the period (any token day). */
  formsSubmitted: number;
  /** …of which for tokens issued before the period began. */
  formsFromEarlier: number;
  callPct: number;
  closurePct: number;
  selectionPct: number;
  yieldPct: number;
  sla1: SlaStat;
  sla2: SlaStat;
}

export interface SlaStat {
  met: number;
  breached: number;
  /** Tokens with the timestamps this SLA needs / tokens that could have had them. */
  measured: number;
  population: number;
  coveragePct: number;
  /** False when coverage is below SLA.minCoveragePct — the pct is not a trustworthy verdict. */
  reliable: boolean;
  pct: number | null;
  avgMin: number | null;
  p90Min: number | null;
}

export type EscalationLevel = 1 | 2 | 3;

export interface Escalation {
  level: EscalationLevel;
  escalateTo: string;
  branch: string;
  tokenNumber: string;
  candidateName: string;
  process: string;
  recruiter: string;
  stage:
    | "Waiting for call"
    | "Called — interview pending"
    | "In interview"
    | "Queue-completed — no interview outcome";
  arrivalHhmm: string;
  arrivalDate: string;
  runningMin: number;
  stageSlaMin: number;
  overSlaMin: number;
  totalAgeMin: number;
}

export interface RecruiterRow {
  recruiter: string;
  ftd: Summary;
  wtd: Summary;
  mtd: Summary;
  openNow: number;
  worstOpenMin: number;
}

export interface ProcessRow {
  process: string;
  ftd: Summary;
  wtd: Summary;
  mtd: Summary;
}

export interface BranchBlock {
  branch: string;
  ftd: Summary;
  wtd: Summary;
  mtd: Summary;
  recruiters: RecruiterRow[];
  processes: ProcessRow[];
  escalations: Escalation[];
}

export interface DataQuality {
  closedWithoutCallTime: number;
  negativeDurations: number;
  staleOpenTokens: number;
  /** MTD tokens marked completed in the queue with no interview form and the candidate still waiting. */
  completedWithoutOutcome: number;
  /** MTD tokens whose closure was stamped within 1 minute of the call — usually bulk/auto closure, not a real interview. */
  instantClosures: number;
  measuredHandle: number;
}

export interface ReportData {
  reportDate: string;
  weekStart: string;
  monthStart: string;
  overall: { ftd: Summary; wtd: Summary; mtd: Summary };
  branches: BranchBlock[];
  escalations: Escalation[];
  onTrackOpen: number;
  dataQuality: DataQuality;
}

// ── date helpers (pure string/UTC arithmetic — no host-timezone dependence) ─────────────

const dayMs = 86_400_000;
const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function weekStartOf(iso: string): string {
  const dow = new Date(toUtc(iso)).getUTCDay(); // 0 = Sun
  return fromUtc(toUtc(iso) - (dow === 0 ? 6 : dow - 1) * dayMs); // Monday
}
export const monthStartOf = (iso: string) => `${iso.slice(0, 7)}-01`;
export const addDays = (iso: string, n: number) =>
  fromUtc(toUtc(iso) + n * dayMs);

// ── formatting helpers ───────────────────────────────────────────────────────────────────

export function fmtMin(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m) || m < 0) return "—";
  const r = Math.round(m);
  if (r < 60) return `${r}m`;
  const h = Math.floor(r / 60);
  if (h < 48) return `${h}h ${String(r % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const ratio = (n: number, d: number) =>
  d > 0 ? Math.round((n / d) * 1000) / 10 : 0;

function p90(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
}
const avg = (values: number[]) =>
  values.length
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : null;

// ── row → fact ───────────────────────────────────────────────────────────────────────────

const includesAny = (text: string, needles: string[]) =>
  needles.some((n) => text.includes(n));

/**
 * Outcome comes from the same status vocabulary the ATS Command Centre reads
 * (Selected / Rejected / No Show / Client Round - Pending / Hold / Waiting), matched by
 * substring because the value is written several ways across the candidate form, the
 * recruiter app and the legacy import.
 */
export function classifyOutcome(
  row: Pick<RawTokenRow, "decision_text" | "queue_status" | "sub_id">,
): Outcome {
  const text = String(row.decision_text ?? "").toLowerCase();
  const qs = String(row.queue_status ?? "").toLowerCase();
  if (includesAny(text, ["no show", "noshow", "no_show"]) || qs === "no_show")
    return "no_show";
  if (
    includesAny(text, [
      "walkout",
      "walk out",
      "walk-out",
      "dropout",
      "drop out",
    ]) ||
    qs === "walked_out"
  )
    return "walkout";
  if (
    text.includes("reject") ||
    text.includes("not_selected") ||
    text.includes("not selected")
  )
    return "rejected";
  if (text.includes("selection discussion"))
    return row.sub_id ? "other_closed" : "open"; // a stage name, not a decision
  if (
    includesAny(text, [
      "select",
      "offer",
      "joined",
      "onboard",
      "converted",
      "payroll_validated",
      "bgv",
      // Post-selection pipeline statuses: hr_approved / offer_approved, and profile_submitted —
      // the selected candidate has filled the online onboarding profile (personal, bank, documents).
      "hr_approved",
      "offer_approved",
      "profile_submitted",
    ])
  )
    return "selected";
  if (text.includes("client round")) return "client_round";
  if (
    text.includes("hold") ||
    text.includes("callback") ||
    text.includes("follow")
  )
    return "hold";
  if (row.sub_id) return "other_closed";
  // A queue token flipped to "completed" is NOT a closure by itself: the Call → Start → Complete
  // buttons can be clicked through in seconds to clear the screen (live 2026-09-25 NOIDA: 12 tokens
  // completed 1-5 s after being called, no interview form, candidate still "Arrived / Waiting").
  // It counts as closed only when the candidate record has moved past the waiting state.
  if (qs === "completed" && !includesAny(text, ["waiting", "arrived"]))
    return "other_closed";
  return "open";
}

export function toFact(
  row: RawTokenRow,
  canonicalBranch: (v: unknown) => string,
  recruiterKey: (id: unknown, name: unknown) => string,
): TokenFact {
  const outcome = classifyOutcome(row);
  const recruiter =
    String(row.recruiter_raw ?? "")
      .replace(/\s*[·|]\s*[A-Z]{2,4}\d{3,}\s*$/i, "")
      .trim() || "Unassigned";
  const qs = String(row.queue_status ?? "").toLowerCase();
  const stage = String(row.current_stage ?? "").toLowerCase();
  const closed = outcome !== "open";
  return {
    tokenId: row.token_id,
    candidateId: row.candidate_id,
    tokenNumber: row.token_number || "—",
    candidateName: String(row.full_name ?? "").trim() || "—",
    process: String(row.process ?? "").trim() || "Unspecified",
    branch: canonicalBranch(row.branch_raw),
    recruiter,
    recruiterKey: recruiterKey(null, recruiter),
    arrivalDate: row.arrival_date,
    formDate: row.form_date ?? null,
    arrivalHhmm: row.arrival_hhmm ?? "",
    tokenGenerated: row.has_queue_row === 1 || !!row.token_number,
    called:
      Number(row.has_call) === 1 || qs === "called" || qs === "in_interview",
    closed,
    outcome,
    joined: stage === "joined" || stage === "onboarded",
    inInterview: qs === "in_interview",
    queueCompletedNoOutcome: qs === "completed" && !closed,
    profileSubmitted:
      outcome === "selected" &&
      `${row.cand_status ?? ""} ${row.decision_text ?? ""}`
        .toLowerCase()
        .includes("profile_submitted"),
    waitMin:
      row.wait_min != null && row.wait_min >= 0 ? Number(row.wait_min) : null,
    handleMin:
      row.handle_min != null && row.handle_min >= 0
        ? Number(row.handle_min)
        : null,
    negativeDuration:
      (row.wait_min != null && row.wait_min < 0) ||
      (row.handle_min != null && row.handle_min < 0),
    sinceArrivalMin: Math.max(0, Number(row.since_arrival_min ?? 0)),
    sinceCallMin:
      row.since_call_min != null
        ? Math.max(0, Number(row.since_call_min))
        : null,
  };
}

// ── aggregation ──────────────────────────────────────────────────────────────────────────

function slaStat(
  pairs: Array<{ value: number | null; openOver: boolean }>,
  target: number,
  population: number,
): SlaStat {
  const measured = pairs
    .filter((p) => p.value != null)
    .map((p) => p.value as number);
  const met = measured.filter((v) => v <= target).length;
  const breached =
    measured.length -
    met +
    pairs.filter((p) => p.value == null && p.openOver).length;
  const coveragePct = ratio(measured.length, population);
  return {
    met,
    breached,
    measured: measured.length,
    population,
    coveragePct,
    reliable: population === 0 || coveragePct >= SLA.minCoveragePct,
    pct: met + breached > 0 ? ratio(met, met + breached) : null,
    avgMin: avg(measured),
    p90Min: p90(measured),
  };
}

export function summarize(facts: TokenFact[]): Summary {
  const c = (o: Outcome) => facts.filter((f) => f.outcome === o).length;
  const tokens = facts.filter((f) => f.tokenGenerated).length;
  const called = facts.filter((f) => f.called).length;
  const closed = facts.filter((f) => f.closed).length;
  const selected = c("selected");
  const open = facts.filter((f) => f.outcome === "open");
  const noShow = c("no_show");
  const walkout = c("walkout");
  const interviewed = closed - noShow - walkout;
  const walkins = new Set(facts.map((f) => f.candidateId)).size;

  const sla1 = slaStat(
    facts.map((f) => ({
      value: f.waitMin,
      openOver: !f.called && !f.closed && f.sinceArrivalMin > SLA.waitToCallMin,
    })),
    SLA.waitToCallMin,
    // A no-show/walk-out could not have been called — unless it actually was, in which case it is measured and must be counted here too.
    facts.filter(
      (f) =>
        f.tokenGenerated &&
        (f.called || (f.outcome !== "no_show" && f.outcome !== "walkout")),
    ).length,
  );
  const sla2 = slaStat(
    facts.map((f) => ({
      // A no-show can be closed by the queue's auto no-show sweep, not by the recruiter — not a recruiter SLA.
      value: f.outcome === "no_show" ? null : f.handleMin,
      openOver:
        f.called && !f.closed && (f.sinceCallMin ?? 0) > SLA.callToClosureMin,
    })),
    SLA.callToClosureMin,
    facts.filter(
      (f) => f.closed && f.outcome !== "no_show" && f.outcome !== "walkout",
    ).length,
  );

  return {
    walkins,
    tokens,
    called,
    closed,
    interviewed,
    selected,
    rejected: c("rejected"),
    noShow,
    walkout,
    hold: c("hold"),
    clientRound: c("client_round"),
    open: c("open"),
    otherClosed: c("other_closed"),
    profileSubmitted: facts.filter((f) => f.profileSubmitted).length,
    openWaiting: open.filter((f) => !f.called && !f.queueCompletedNoOutcome).length,
    openCalled: open.filter(
      (f) => f.called && !f.inInterview && !f.queueCompletedNoOutcome,
    ).length,
    openInInterview: open.filter((f) => f.inInterview).length,
    openQueueCompleted: open.filter((f) => f.queueCompletedNoOutcome).length,
    joined: facts.filter((f) => f.joined).length,
    formsSubmitted: 0,
    formsFromEarlier: 0,
    callPct: ratio(called, tokens),
    closurePct: ratio(closed, tokens),
    selectionPct: ratio(selected, interviewed),
    yieldPct: ratio(selected, walkins),
    sla1,
    sla2,
  };
}

export function escalationFor(
  f: TokenFact,
  reportDate: string,
): Escalation | null {
  if (f.closed) return null;
  const stage: Escalation["stage"] = f.inInterview
    ? "In interview"
    : f.queueCompletedNoOutcome
      ? "Queue-completed — no interview outcome"
      : f.called
      ? "Called — interview pending"
      : "Waiting for call";
  const running = f.called
    ? (f.sinceCallMin ?? f.sinceArrivalMin)
    : f.sinceArrivalMin;
  const stageSla = f.called ? SLA.callToClosureMin : SLA.waitToCallMin;
  if (running <= stageSla) return null; // still inside SLA — counted as "on track", not escalated

  // L3: still open after the day it was issued  → HR Head
  // L2: open ≥ 4h since arrival                 → Branch Head
  // L1: stage SLA breached                      → Recruiter + Reporting Manager
  const level: EscalationLevel =
    f.arrivalDate < reportDate
      ? 3
      : f.sinceArrivalMin >= SLA.sameDayEscalateMin
        ? 2
        : 1;
  const escalateTo =
    level === 3
      ? "HR Head"
      : level === 2
        ? "Branch Head"
        : "Recruiter + Reporting Manager";
  return {
    level,
    escalateTo,
    branch: f.branch,
    tokenNumber: f.tokenNumber,
    candidateName: f.candidateName,
    process: f.process,
    recruiter: f.recruiter,
    stage,
    arrivalHhmm: f.arrivalHhmm,
    arrivalDate: f.arrivalDate,
    runningMin: running,
    stageSlaMin: stageSla,
    overSlaMin: running - stageSla,
    totalAgeMin: f.sinceArrivalMin,
  };
}

const byWorst = (a: Escalation, b: Escalation) =>
  b.level - a.level || b.runningMin - a.runningMin;

interface Periods {
  ftd: TokenFact[];
  wtd: TokenFact[];
  mtd: TokenFact[];
}

function splitPeriods(
  facts: TokenFact[],
  reportDate: string,
  weekStart: string,
  monthStart: string,
): Periods {
  const inRange = (f: TokenFact, from: string) =>
    f.arrivalDate >= from && f.arrivalDate <= reportDate;
  return {
    ftd: facts.filter((f) => f.arrivalDate === reportDate),
    wtd: facts.filter((f) => inRange(f, weekStart)),
    mtd: facts.filter((f) => inRange(f, monthStart)),
  };
}

export interface BuildInput {
  facts: TokenFact[];
  reportDate: string;
}

export function buildReport({ facts, reportDate }: BuildInput): ReportData {
  const weekStart = weekStartOf(reportDate);
  const monthStart = monthStartOf(reportDate);
  const live = facts.filter((f) => f.arrivalDate <= reportDate);

  /** Cohort metrics from tokens issued in the period + activity-based form counts from ALL fetched tokens. */
  const withForms = (
    s: Summary,
    rows: TokenFact[],
    from: string,
    to: string,
  ): Summary => {
    const forms = rows.filter(
      (f) => f.formDate && f.formDate >= from && f.formDate <= to,
    );
    return {
      ...s,
      formsSubmitted: forms.length,
      formsFromEarlier: forms.filter((f) => f.arrivalDate < from).length,
    };
  };

  const periodSummaries = (rows: TokenFact[]) => {
    const p = splitPeriods(rows, reportDate, weekStart, monthStart);
    return {
      ftd: withForms(summarize(p.ftd), rows, reportDate, reportDate),
      wtd: withForms(summarize(p.wtd), rows, weekStart, reportDate),
      mtd: withForms(summarize(p.mtd), rows, monthStart, reportDate),
    };
  };

  const isStale = (f: TokenFact) => f.sinceArrivalMin > SLA.staleAfterMin;
  const allEsc = live
    .filter((f) => !isStale(f))
    .map((f) => escalationFor(f, reportDate))
    .filter((e): e is Escalation => !!e);
  const openLive = live.filter((f) => !f.closed && !isStale(f));

  const branchNames = [...new Set(live.map((f) => f.branch))].sort();
  const branches: BranchBlock[] = branchNames
    .map((branch) => {
      const rows = live.filter((f) => f.branch === branch);
      const recNames = [...new Set(rows.map((f) => f.recruiterKey))];
      const recruiters: RecruiterRow[] = recNames
        .map((key) => {
          const rr = rows.filter((f) => f.recruiterKey === key);
          const open = rr.filter((f) => !f.closed && !isStale(f));
          return {
            recruiter: rr[0].recruiter,
            ...periodSummaries(rr),
            openNow: open.length,
            worstOpenMin: Math.max(
              0,
              ...open.map((f) =>
                f.called ? (f.sinceCallMin ?? 0) : f.sinceArrivalMin,
              ),
            ),
          };
        })
        .sort(
          (a, b) => b.ftd.tokens - a.ftd.tokens || b.mtd.tokens - a.mtd.tokens,
        );

      const processNames = [...new Set(rows.map((f) => f.process))].sort();
      const processes: ProcessRow[] = processNames
        .map((proc) => {
          const pr = rows.filter((f) => f.process === proc);
          return { process: proc, ...periodSummaries(pr) };
        })
        .sort(
          (a, b) =>
            b.ftd.walkins - a.ftd.walkins || b.mtd.walkins - a.mtd.walkins,
        );

      return {
        branch,
        ...periodSummaries(rows),
        recruiters,
        processes,
        escalations: allEsc.filter((e) => e.branch === branch).sort(byWorst),
      };
    })
    .sort(
      (a, b) => b.ftd.walkins - a.ftd.walkins || b.mtd.walkins - a.mtd.walkins,
    );

  const mtdFacts = splitPeriods(live, reportDate, weekStart, monthStart).mtd;

  return {
    reportDate,
    weekStart,
    monthStart,
    overall: periodSummaries(live),
    branches,
    escalations: allEsc.sort(byWorst),
    onTrackOpen: openLive.length - allEsc.length,
    dataQuality: {
      closedWithoutCallTime: mtdFacts.filter(
        (f) =>
          f.closed &&
          !f.called &&
          f.outcome !== "no_show" &&
          f.outcome !== "walkout",
      ).length,
      negativeDurations: mtdFacts.filter((f) => f.negativeDuration).length,
      instantClosures: mtdFacts.filter(
        (f) =>
          f.handleMin != null && f.handleMin <= 1 && f.outcome !== "no_show",
      ).length,
      measuredHandle: mtdFacts.filter(
        (f) => f.handleMin != null && f.outcome !== "no_show",
      ).length,
      staleOpenTokens: live.filter((f) => !f.closed && isStale(f)).length,
      completedWithoutOutcome: mtdFacts.filter((f) => f.queueCompletedNoOutcome)
        .length,
    },
  };
}
