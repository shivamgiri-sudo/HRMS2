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
  { key: "lifecycle", label: "Tenure & lifecycle", max: 30 },
  { key: "attendance", label: "Attendance behaviour", max: 28 },
  { key: "performance", label: "Performance", max: 20 },
  { key: "compensation", label: "Pay & growth", max: 12 },
  { key: "conduct", label: "Conduct & hygiene", max: 10 },
  { key: "team", label: "Manager & team", max: 10 },
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
}
export type HotspotDimension = "branch" | "process" | "manager" | "designation";

/** GET /insights */
export interface HubInsights {
  hotspots: Record<HotspotDimension, Hotspot[]>;           // each sorted worst first, max 12
  tenureAtExit: { bucket: string; exits: number }[];       // 0-30, 31-60, 61-90, 91-180, 181-365, 1-2y, 2y+  (last 12 months)
  reasons: { reason: string; exits: number }[];            // includes "Not recorded"
  reasonCoveragePct: number | null;                        // share of exits with a recorded reason
  exitType: { voluntary: number; involuntary: number; unknown: number };
  monthlyBySource: { source: string; exits: number; joiners: number; earlyExitRatePct: number | null }[]; // source of hire, last 12 months
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
/** GET /risk?tier=&branchId=&processId=&managerId=&q=&absentOnly=&newJoinerOnly=&sort=score|aon|name&limit=&offset= */
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
}
