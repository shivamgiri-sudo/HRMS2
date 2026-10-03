/** Response contract of GET /api/process-performance/sbi-card-dashboard (SBI Card Collections, process SBI_CARD). */
export interface SbiFunnel {
  accounts: number; dials: number; answers: number; connects: number; ptp: number; pad: number; otp: number;
}
export interface SbiSummary extends SbiFunnel {
  contactRatePct: number | null; connectRatePct: number | null; ptpRatePct: number | null;
  amountCollected: number; agentsActive: number;
  scheduled: number; penetration: number; completionPct: number | null; penetrationTarget: number | null;
}
export interface SbiDailyRow extends SbiFunnel { date: string; campaign: string; contacts?: number; contactRatePct: number | null; ptpRatePct: number | null }
export interface SbiCampaignRow extends SbiFunnel { campaign: string; contactRatePct: number | null; ptpRatePct: number | null }
export interface SbiAgentRow {
  employeeId: string | null; dialerId: string | null; name: string | null; team: string | null; teamLeader: string | null;
  calls: number; contacts: number; ptp: number; pad: number; amountCollected: number;
  firstLogin: string | null; lastLogout: string | null; leakage: number | string | null; days: number;
}
export interface SbiTeamRow { team: string | null; teamLeader: string | null; agents: number; calls: number; contacts: number; ptp: number; pad: number; amountCollected: number }
export interface SbiDowntimeRow {
  date: string; startTime: string | null; upTime: string | null; downtimeMinutes: number | null;
  impactedUsers: number | null; reason: string | null; status: string | null;
}
export interface SbiAccounts {
  total: number; totalDue: number; curBal: number;
  byDelq: Array<{ delq: string; count: number; totalDue: number }>;
  byBillingCycle: Array<{ cycle: string; count: number }>;
}
export type SbiDimKey = "cd" | "program" | "flow" | "tier" | "nrr" | "recencyBand" | "balanceBand" | "delq" | "region" | "productClass" | "accountClass" | "cibilBand" | "vintageBand" | "callTable" | "billingCycle" | "customerType";
export interface SbiDimRow {
  key: string; accounts: number; exposure: number; worked: number; untouched: number; coveragePct: number; attemptsPerAccount: number;
  ptpAccounts: number; ptpPct: number; overduePtp: number; exhausted: number; dnc: number;
}
export interface SbiWorkItem { accountNo: string; delq: string | null; region: string | null; totalDue: number; attempts: number; lastActionCode: string | null; due: string | null }
export interface SbiBucket { accounts: number; exposure: number }
export type SbiPositionStage = "promised" | "lapsed" | "exhausted" | "untouched" | "inProgress";
export interface SbiCollections {
  snapshotDate: string | null;
  headline: {
    accounts: number; exposure: number; worked: number; untouched: number; untouchedExposure: number; coveragePct: number;
    attemptsTotal: number; attemptsPerAccount: number; attemptsPerWorked: number; ptpAccounts: number; ptpPct: number; ptpExposure: number;
    overduePtp: number; overduePtpExposure: number; ptpDueSoon: number; callbacksOverdue: number; callbacksUpcoming: number;
    exhausted: number; exhaustedExposure: number; dnc: number; dncExposure: number;
    dncDialled: number; dncDialledAttempts: number; stalePayers: number; stalePayersExposure: number; dpiAccrued: number;
  };
  position: Array<{ stage: SbiPositionStage; accounts: number; exposure: number }>;
  contactability: {
    attempts: number; noConversation: number; noConversationPct: number;
    stuck: { accounts: number; exposure: number }; voicemailRepeat: { accounts: number; exposure: number }; wrongNumber: { accounts: number; exposure: number };
    byDate: Array<{ date: string; attempts: number; noConversationPct: number }>;
    clientContact: { attempts: number; pct: number; notCounted: { attempts: number; pct: number; codes: Array<{ code: string; label: string; attempts: number }> } };
    evidence: { hourDeadP: number | null; hourPtpP: number | null; agentPtpP: number | null };
    agentSpread: { agents: number; p25: number; median: number; p75: number; best: { agentId: string; ptpPct: number } | null; worst: { agentId: string; ptpPct: number } | null } | null;
  };
  dispositions: Array<{ code: string; label: string; listed: boolean; attempts: number; sharePct: number }>;
  compliance: {
    windowLabel: string;
    window: { attempts: number; outside: number; outsidePct: number; before: number; after: number };
    redialedAfterExclusion: { accounts: number; attempts: number; byCode: Array<{ code: string; label: string; accounts: number }> };
    welfare: { suicideThreat: SbiBucket; deceased: SbiBucket; dispute: SbiBucket; refusal: SbiBucket };
    intent: { settlement: SbiBucket; hardship: SbiBucket; languageBarrier: SbiBucket; paidAlready: SbiBucket };
    unlisted: { attempts: number; pct: number; codes: Array<{ code: string; attempts: number }> };
  };
  lastAction: Array<{ code: string; accounts: number; exposure: number }>;
  attemptDepth: Array<{ attempts: string; accounts: number; exposure: number; ptpAccounts: number; ptpPct: number }>;
  byHour: Array<{ hour: number; attempts: number; ptp: number; ptpPct: number; noConversationPct: number }>;
  agents: Array<{ agentId: string; name: string | null; attempts: number; accountsTouched: number; ptp: number; ptpPct: number }>;
  dimensions: Record<SbiDimKey, SbiDimRow[]>;
  dimensionSignal: Record<SbiDimKey, { ptpP: number | null; coverageP: number | null }>;
  worklists: { untouched: SbiWorkItem[]; overduePtp: SbiWorkItem[]; overdueCallbacks: SbiWorkItem[] };
}
export interface SbiAgentTimeAgent {
  employeeId: string; name: string | null; days: number; calls: number; loginHours: number; talkHours: number; dispoHours: number;
  waitHours: number; pauseHours: number; utilisationPct: number | null; occupancyPct: number | null; pausePct: number | null; waitPct: number | null;
  achtSec: number | null; callsPerLoginHour: number | null; firstLogin: string | null; lastLogout: string | null; flags: string[];
}
export interface SbiAgentTime {
  agents: SbiAgentTimeAgent[];
  summary: {
    agents: number; days: number; calls: number; loginHours: number; utilisationPct: number | null; occupancyPct: number | null;
    pausePct: number | null; waitPct: number | null; achtSec: number | null; callsPerLoginHour: number | null; flagged: number;
  };
  pauseCodes: Array<{ code: string; hours: number; sharePct: number | null }>;
  daily: Array<{ date: string; agents: number; calls: number; utilisationPct: number | null; occupancyPct: number | null; pausePct: number | null; achtSec: number | null }>;
}
export interface SbiCapacity {
  target: number; targetFromClient: boolean;
  rows: Array<{ table: string; accounts: number; attempts: number; penetration: number; requiredDials: number; shortfallDials: number; status: "on-target" | "behind" }>;
  total: { accounts: number; attempts: number; penetration: number; requiredDials: number; shortfallDials: number; behindTables: number };
  capacity: { dph: number; loginHours: number; extraHoursToCloseGap: number; requiredHoursAtTarget: number } | null;
  downtime: { events: number; agentHoursLost: number; dialsLost: number | null };
}
export type SbiSourceKey = "accountNew" | "accountManual" | "apr" | "dialerMis" | "agentMis" | "penEstimation" | "outcome" | "downtime";
export interface SbiReadiness {
  range: { from: string; to: string };
  days: Array<{ date: string; cells: Partial<Record<SbiSourceKey, number>>; dailyMissing: SbiSourceKey[]; complete: boolean; tables: { found: string[]; missing: string[]; other: string[] } | null }>;
  freshness: Array<{ key: SbiSourceKey; label: string; daily: boolean; lastDate: string | null; ageDays: number | null; status: "ok" | "stale" | "never"; rows: number }>;
  latest: SbiReadiness["days"][number] | null;
  tablesDay: SbiReadiness["days"][number] | null;
  alerts: Array<{ level: "critical" | "warning" | "info"; text: string }>;
  expectedTables: Array<{ key: string; label: string }>;
}
export interface SbiTeamGroup {
  key: string; teams: string[]; agents: number; activeAgents: number; attempts: number; accountsTouched: number; ptp: number; ptpPct: number; deadPct: number;
  aprMatched: number; loginHours: number | null; utilisationPct: number | null; pausePct: number | null; callsPerLoginHour: number | null;
}
export interface SbiTeam {
  hasRoster: boolean; rosterSize: number; byTeam: SbiTeamGroup[]; byLeader: SbiTeamGroup[];
  alignment: {
    high: { attempts: number; byHighbal: number; byLowbal: number; byOther: number; lowbalPct: number };
    low: { attempts: number; byLowbal: number; byHighbal: number; byOther: number; highbalPct: number };
  };
  unmapped: { agents: number; attempts: number; pct: number }; apr: { agents: number; matched: number }; evidence: { leaderPtpP: number | null };
}
export interface SbiCardData {
  range: { from: string; to: string }; campaigns: string[]; summary: SbiSummary;
  daily: SbiDailyRow[]; byCampaign: SbiCampaignRow[]; agents: SbiAgentRow[]; teams: SbiTeamRow[];
  downtime: SbiDowntimeRow[]; accounts: SbiAccounts; collections: SbiCollections; agentTime: SbiAgentTime; capacity: SbiCapacity; team: SbiTeam;
}

/** GET /api/process-performance/sbi-card-payout (manager and above). */
export interface SbiPayoutResult {
  inputs: { resolutionPct: number; normalisationPct: number; rollbackPct: number };
  totalPct: number; nrbPct: number; cells: { row: number; col: number; norm: number; res: number };
  matrixPct: number; normKickerPct: number; resKickerPct: number; ratePct: number; revenue: { ftd: number; mtd: number };
}
export interface SbiPayoutData {
  range: { from: string; to: string }; segment: string;
  targets: { resolutionPct: number; nrbPct: number; totalPct: number; pcAmount: number; normKickerStartPct: number };
  collected: { ftd: { date: string | null; amount: number }; mtd: { amount: number; days: number }; daily: Array<{ date: string; amount: number }>; pcProgressPct: number | null };
  slab: { rows: string[]; cols: string[]; matrix: number[][]; norm: { labels: string[]; pays: number[] }; res: { labels: string[]; pays: number[] } };
  inputsAreTargets: boolean; inputsSource: "entered" | "outcome" | "targets";
  outcome: null | {
    asOf: string; segment: string; segments: string[]; basis: "stated" | "accounts" | "amount" | null; available: Array<"stated" | "accounts" | "amount">; complete: boolean;
    openingAccounts: number | null; openingAmount: number | null; resolutionPct: number | null; normalisationPct: number | null; rollbackPct: number | null;
  };
  scenario: SbiPayoutResult; atTarget: SbiPayoutResult;
  levers: Array<{ lever: string; label: string; addPoints: number; newRatePct: number; deltaPct: number; deltaAmount: number }>;
  nextSteps: Array<{ lever: string; label: string; addPoints: number; newRatePct: number; deltaPct: number; accountsNeeded: number | null; deltaAmount: number; unlocks: string }>;
  reading: string[];
}

export type SbiMoveKey = "left" | "rolledBack" | "rolledForward" | "stayedPaidDown" | "stayed";
export interface SbiMovement {
  range: { from: string; to: string }; dates: string[];
  movement: null | {
    dateA: string; dateB: string; opening: { accounts: number; exposure: number }; closing: { accounts: number; exposure: number };
    outcomes: Array<{ key: SbiMoveKey; label: string; hint: string; accounts: number; exposure: number; pct: number; exposurePct: number }>;
    newInB: { accounts: number; exposure: number }; paidDownAmount: number;
    matrix: Array<{ from: string; total: number; to: Record<string, number> }>;
    byStage: Array<{ from: string; accounts: number; exposure: number; pct: Record<SbiMoveKey, number> }>;
  };
}
