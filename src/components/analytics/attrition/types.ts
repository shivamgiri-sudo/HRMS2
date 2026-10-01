/**
 * Contract for /api/analytics/attrition-hub/* (backend: modules/analytics/attrition-hub.*).
 * Every endpoint answers { success: true, data: <type below> }.
 * Percent fields named *Pct are 0-100; `probability30` is 0-1.
 */

export type Tier = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export const TIERS: Tier[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

/** The six signal groups the risk score is built from. Order is display order. */
export type FactorGroup = "lifecycle" | "attendance" | "performance" | "compensation" | "conduct" | "team";
export const FACTOR_GROUPS: { key: FactorGroup; label: string; max: number }[] = [
  { key: "lifecycle", label: "Tenure & lifecycle", max: 24 },
  { key: "attendance", label: "Attendance behaviour", max: 16 },
  { key: "performance", label: "Performance", max: 20 },
  { key: "compensation", label: "Pay & growth", max: 14 },
  { key: "conduct", label: "Conduct & hygiene", max: 10 },
  { key: "team", label: "Manager & team", max: 30 },
];
export type FactorPoints = Record<FactorGroup, number>;

export interface AonBucketCounts { "0-30": number; "31-60": number; "61-90": number; "90+": number }

/** GET /overview */
export interface HubOverview {
  asOf: string;                       // YYYY-MM-DD
  headcount: number;                  // active, in scope
  exits30: number;
  exitsPrev30: number;
  exits90: number;
  annualisedRatePct: number | null;   // exits90 * 4 / average headcount
  earlyExitSharePct: number | null;   // share of last-90d exits that left within 90 days of joining
  expectedExits30: number;            // sum of calibrated 30-day probabilities of everyone in scope
  atRisk: { CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number };
  inNotice: number;                   // already resigned / serving notice (excluded from prediction)
  trend: { month: string; exits: number; headcount: number; ratePct: number | null; byBucket: AonBucketCounts }[]; // 12 months, oldest first, month = YYYY-MM; ratePct = that MONTH's exits / headcount at month start (monthly %, not annualised); the last entry is the month so far and its ratePct is null (incomplete)
  degraded: string[];                 // signal sources that failed to load; the score used what was left
}

export interface Hotspot {
  id: string | null; label: string;
  headcount: number; exits90: number;
  ratePct: number | null;             // exits90 * 4 / headcount, annualised
  vsCompany: number | null;           // ratePct / company ratePct (1 = same)
  highRisk: number;                   // HIGH + CRITICAL people currently there
  expected90: number | null;          // exits expected in 90 days given the group's tenure mix, at the company's own rates
  excess90: number | null;            // exits90 - expected90 (positive = losing more people than their mix explains)
}
export type HotspotDimension = "branch" | "process" | "manager" | "designation";

/** GET /insights */
export interface HubInsights {
  hotspots: Record<HotspotDimension, Hotspot[]>;           // each sorted worst first, max 12
  tenureAtExit: { bucket: string; exits: number }[];       // 0-30, 31-60, 61-90, 91-180, 181-365, 1-2y, 2y+  (last 12 months)
  reasons: { reason: string; exits: number }[];            // includes "Not recorded"
  reasonCoveragePct: number | null;                        // share of exits with a recorded reason (exit record or legacy HRMS leaving reason)
  reasonSources: { exitRecord: number; legacy: number; none: number };   // where those reasons came from, last 12 months
  exitType: { voluntary: number; involuntary: number; unknown: number };
  monthlyBySource: { source: string; exits: number; joiners: number; earlyExitRatePct: number | null }[]; // source of hire, last 12 months
  reasonByBranch: { id: string | null; label: string; exits: number; recorded: number; pct: number | null }[]; // exits in last 12 months with a recorded reason, worst capture first
}

export type AlertSeverity = "critical" | "warning" | "info";
export interface AlertLink { tier?: Tier; branchId?: string; processId?: string; managerId?: string; absentOnly?: boolean; newJoinerOnly?: boolean }
export interface HubAlert {
  id: string; severity: AlertSeverity;
  category: "risk" | "early-attrition" | "hotspot" | "manager" | "absence" | "data";
  title: string; detail: string;
  metric?: { label: string; value: string };
  employeeCount?: number;
  link?: AlertLink;                  // opens the Prediction tab filtered to these people
}
/** GET /alerts */
export interface HubAlerts { alerts: HubAlert[]; counts: Record<AlertSeverity, number> }

export interface RiskReason { label: string; group: FactorGroup; points: number; detail: string }
export interface RiskRow {
  lastFollowup?: { kind: FollowupKind; outcome: FollowupOutcome; at: string } | null;
  employeeId: string; code: string; name: string;
  designation: string | null; process: string | null; branch: string | null; manager: string | null;
  managerId: string | null; branchId: string | null; processId: string | null;
  aonDays: number;
  score: number; tier: Tier;
  probability30: number | null;      // calibrated against past outcomes; null when the tier has too few past cases
  factors: FactorPoints;
  reasons: RiskReason[];             // top 4, biggest first
  actions: string[];                 // suggested next steps for the manager / HR
}
export interface RiskGroup { id: string | null; label: string; headcount: number; avgScore: number; highRisk: number; expectedExits30: number }
/** GET /risk?tier=&group=&branchId=&processId=&managerId=&q=&absentOnly=&newJoinerOnly=&sort=score|aon|name&limit=&offset=  (group = FactorGroup: only people with points in it) */
export interface HubRisk {
  total: number;                     // rows matching the filters (before paging)
  rows: RiskRow[];
  tierCounts: Record<Tier, number>;  // for the filters except `tier`
  groups: { manager: RiskGroup[]; process: RiskGroup[]; branch: RiskGroup[] };   // worst first, max 10, for the filters except `tier`
  drivers: { group: FactorGroup; avgPoints: number; sharePct: number }[];        // what drives risk among HIGH + CRITICAL people
}

export interface Signal { label: string; value: string; flag: boolean }
/** GET /employee/:id */
export interface HubEmployeeRisk { row: RiskRow; signals: Signal[] }

/** GET /model */
export interface HubModel {
  computedAt: string;
  cohortDates: string[];             // the past dates the model was tested from
  population: number;                // person-periods tested
  leavers: number;                   // of whom left within 30 days
  baseRatePct: number;
  auc: number | null;                // 0.5 = coin flip, 1 = perfect
  gain: { popPct: number; leaverPct: number }[];                                   // cumulative gain curve, popPct 0..100 ascending
  calibration: { tier: Tier; n: number; leavers: number; observedRatePct: number | null }[];
  drivers: { group: FactorGroup; label: string; avgPointsLeavers: number; avgPointsStayers: number }[];
  limits: string[];                  // plain-language caveats shown under the charts
  history: { date: string; auc: number | null; baseRatePct: number; criticalRatePct: number | null; highRatePct: number | null; population: number; leavers: number }[]; // daily snapshots, oldest first
}

/* ═══════════════ Round 2: drill-down everywhere, follow-ups, batches, scorecard, outlook, pulse ═══════════════ */

/**
 * Anything on the page that shows a number can open the people behind it. A DrillQuery describes
 * that slice; GET /drill?<query as flat query-string> answers it. Unset fields do not filter.
 *   population "active"   - people employed today (risk scored). title/limit/offset/sort are UI-side or paging.
 *   population "exits"    - people who left; windowDays (default 365) limits to leavers in the last N days.
 *   population "joiners"  - everyone who joined in the window (active AND left), for batches / hiring quality;
 *                           joinWeek (YYYY-MM-DD, the Monday) narrows to one batch, windowDays (default 365) is by joining date.
 */
export type DrillPopulation = "active" | "exits" | "joiners";
export interface DrillQuery {
  population: DrillPopulation;
  title?: string;                      // UI only, never sent
  tier?: Tier;
  group?: FactorGroup;                 // active: people with points in this signal group (e.g. "compensation" = pay gaps)
  branchId?: string; processId?: string; managerId?: string; designationId?: string;
  source?: string;                     // source of hire, exact text as returned in insights/scorecard
  absentOnly?: boolean;                // active: absent streak of 2+ days
  minAbsentStreak?: number;            // active: absent streak of at least this many days in a row (3 = the absconding alert / pulse count)
  newJoinerOnly?: boolean;             // active: joined in the last 90 days
  notice?: boolean;                    // active: serving notice
  followup?: "none" | "any";           // active: has / has not had a logged follow-up
  aonBucket?: "0-30" | "31-60" | "61-90" | "90+";   // active: current AON; exits: tenure at exit
  tenureBin?: string;                  // exits: one of HubInsights.tenureAtExit[].bucket
  month?: string;                      // exits: YYYY-MM of the exit date
  reason?: string;                     // exits: reason text as in insights.reasons ("Not recorded" = none)
  noReason?: boolean;                  // exits: no reason recorded
  exitType?: "voluntary" | "involuntary" | "unknown";
  joinWeek?: string;
  windowDays?: number;
  q?: string; sort?: "score" | "aon" | "name" | "date"; limit?: number; offset?: number;
}
export interface DrillRow {
  employeeId: string; code: string; name: string;
  designation: string | null; process: string | null; branch: string | null; manager: string | null;
  branchId: string | null; processId: string | null; managerId: string | null;
  joinDate: string; aonDays: number;               // aonDays = days since joining today (active) or at exit (left)
  status: "active" | "notice" | "left";
  // active people
  score?: number; tier?: Tier; probability30?: number | null; topReason?: string | null; absentStreak?: number;
  lastFollowup?: { kind: FollowupKind; outcome: FollowupOutcome; at: string } | null;
  // people who left
  exitDate?: string | null; tenureDays?: number | null; reason?: string | null; exitType?: string | null;
  reasonSource?: "exit_record" | "legacy" | null;      // where the reason came from
}
/** GET /drill */
export interface HubDrill {
  population: DrillPopulation; total: number; rows: DrillRow[];
  summary: { label: string; value: string }[];     // 3-4 headline facts about the slice (count, share, avg score / avg tenure ...)
  mix: { label: string; value: number }[];         // small breakdown for a mini chart in the drawer: tier mix (active) or tenure-at-exit mix (exits/joiners)
}

export type FollowupKind = "absent_outreach" | "stay_conversation" | "pay_review" | "buddy_assigned" | "shift_change" | "other";
export type FollowupOutcome = "pending" | "reached_returning" | "reached_resigning" | "not_reachable" | "improved" | "no_change";
export const FOLLOWUP_KINDS: { key: FollowupKind; label: string }[] = [
  { key: "absent_outreach", label: "Called about absence" }, { key: "stay_conversation", label: "Stay conversation" },
  { key: "pay_review", label: "Pay review raised" }, { key: "buddy_assigned", label: "Buddy / mentor assigned" },
  { key: "shift_change", label: "Shift or roster change" }, { key: "other", label: "Other" },
];
export const FOLLOWUP_OUTCOMES: { key: FollowupOutcome; label: string }[] = [
  { key: "pending", label: "Pending" }, { key: "reached_returning", label: "Reached - returning" },
  { key: "reached_resigning", label: "Reached - resigning" }, { key: "not_reachable", label: "Not reachable" },
  { key: "improved", label: "Improved" }, { key: "no_change", label: "No change" },
];
export interface Followup { id: string; employeeId: string; kind: FollowupKind; outcome: FollowupOutcome; note: string | null; createdAt: string; createdByName: string | null }
/** GET /followups?employeeId=<id>  ->  Followup[] (newest first, max 50) */
/** POST /followups {employeeId, kind, outcome, note?}  ->  Followup. 403 if the employee is outside the caller's scope. */
/** GET /followups/effectiveness */
export interface HubFollowupEffect {
  windowDays: number;                // people actioned 30+ days ago are measured
  actioned: number; stillActive: number; stillActivePct: number | null;
  baselinePct: number | null;        // still-active rate of comparable people (same risk tier today) who were NOT actioned
  byKind: { kind: FollowupKind; n: number; stillActivePct: number | null }[];
  logged30: number;                  // follow-ups logged in the last 30 days (activity, shown even when nothing is measurable yet)
}

export interface BatchSurvival { d1: number | null; d3: number | null; d7: number | null; d15: number | null; d30: number | null; d60: number | null; d90: number | null }
/** One joining week. survival = % of the batch still employed N days after joining (null = batch not that old yet).
 *  showUp = % of the batch with at least one present / half-day record within N days of joining (null = not old enough or no attendance data). */
export interface HubBatch {
  weekStart: string;                 // Monday, YYYY-MM-DD
  joined: number; activeNow: number; absentNow: number;     // absentNow = absent streak 3+ among those still active
  survival: BatchSurvival;
  showUp: { d1: number | null; d3: number | null; d7: number | null };
  sources: { source: string; joined: number; activeNow: number }[];   // top 4
}
/** GET /batches -> { batches } , newest first, last 16 weeks */
export interface HubBatches { batches: HubBatch[] }

/** GET /scorecard?by=source|branch|process|designation  (hiring quality; joiners of the last 12 months) */
export interface ScorecardRow {
  id: string | null; label: string; joined: number;
  s30: number | null; s60: number | null; s90: number | null;       // % still employed after N days, among those old enough
  n30: number; n60: number; n90: number;                             // how many were old enough (denominators)
}
export interface HubScorecard { by: "source" | "branch" | "process" | "designation"; rows: ScorecardRow[]; company: { s30: number | null; s60: number | null; s90: number | null } }

/** GET /outlook - the next 30 days */
export interface OutlookRow { id: string | null; label: string; headcount: number; expectedExits: number; noticeExits: number; plannedJoiners: number; projected: number; gapPct: number | null }
export interface HubOutlook {
  horizonDays: 30;
  headcount: number; expectedExits: number; noticeExits: number; plannedJoiners: number; projected: number;
  byBranch: OutlookRow[]; byProcess: OutlookRow[];                   // worst gap first, max 12
  notes: string[];
}

/** GET /pulse - the crisp card for role dashboards */
export interface HubPulse {
  asOf: string;
  scope: "org" | "branch" | "team";
  headcount: number; critical: number; high: number; expectedExits30: number;
  absentStreak: number; newJoinerRisk: number;
  exits30: number; exitsPrev30: number; earlyExitSharePct: number | null;
  monthlyExits: { month: string; exits: number }[];                  // last 6 months, oldest first, for a sparkline
  topAlerts: HubAlert[];                                              // max 3, most severe first
  degraded: string[];
}
