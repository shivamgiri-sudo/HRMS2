/**
 * Frontend mirrors of the Drive Command Center response shapes. The frontend cannot import from backend/ (tsconfig.app.json
 * includes only src/), so each type below is a copy; the comment above it names the backend source of truth.
 */

// backend/src/modules/hiring-engine/qualified-followup.types.ts
export type SourceType = "meta_live" | "meta_old" | "he";
export type FollowupMode = "off" | "dry_run" | "live";

// backend/src/modules/hiring-engine/he-drive-analytics.ts
export const STAGES = ["leads", "qualified", "invited", "confirmed", "arrived", "selected", "joined"] as const;
export type Stage = (typeof STAGES)[number];
export type StageCounts = Record<Stage, number>;
export interface Conversion { from: Stage; to: Stage; rate: number | null }
export type Grid = number[][];
export interface DailyPoint { date: string; target: number; byType: Record<SourceType, { invited: number; confirmed: number; arrived: number }> }
export interface ScatterPoint { requisitionId: string; code: string; branch: string; sourceType: SourceType; leads: number; showRate: number; leadToJoinRate: number }
export type LossReason = "not_qualified" | "opted_out" | "requisition_closed" | "no_contact_details" | "not_invited" | "declined" | "no_reply"
  | "no_show" | "slot_released" | "not_selected" | "not_joined_yet" | "other";
export interface WaterfallStep { from: Stage; to: Stage; lost: number; reasons: Array<{ reason: LossReason; n: number }> }

// backend/src/modules/hiring-engine/requisition-stream.service.ts
export type StreamStatus = "draft" | "open" | "paused" | "closed";
export type StreamAction = "create" | "open" | "pause" | "close" | "reopen" | "extend" | "extend_to" | "add_day" | "skip_day" | "shorten" | "auto_close";
export interface StreamRow {
  id: string; requisitionId: string; branchName: string; sourceType: SourceType; originId: string; originLabel: string;
  openFrom: string; openDays: number; dailyInvites: number | null; status: StreamStatus; closedReason: string | null;
  createdBy: string | null; createdAt: string; add: string[]; skip: string[]; version: number;
}
export interface StreamEvent {
  id: string; action: StreamAction; changedBy: string | null; changedAt: string; oldOpenFrom: string | null; oldOpenDays: number | null;
  newOpenDays: number | null; oldStatus: string | null; newStatus: string | null; day: string | null; reason: string | null;
}

// backend/src/modules/hiring-engine/requisition-readiness.ts
export type ReadinessCode = "requisition_not_open" | "no_headcount" | "no_branch_address" | "address_multiline" | "no_bmi_link" | "no_slot_window" | "no_invite_template" | "no_template";
export interface ReadinessProblem { code: ReadinessCode; severity: "blocking" | "warning"; message: string }

// backend/src/modules/hiring-engine/requisition-stream.service.ts (StreamView) and requisition-stream.window.ts (windowStatus)
export interface StreamView extends StreamRow {
  window: { from: string; to: string; dayIndex: number; days: number; state: "upcoming" | "running" | "ended" };
  label: string; warnings: ReadinessProblem[];
}

// backend/src/modules/hiring-engine/he-drive-trend.service.ts
export interface DriveTotals { wanted: number; lined: number; invited: number; confirmed: number; arrived: number; noShow: number; declined: number; showRate: number }
export interface WindowInfo { from: string; to: string; dayIndex: number; days: number }
export interface TrendPoint extends DriveTotals {
  date: string; driveId: string | null; status: string;
  streams: Array<{ streamId: string; lined: number; invited: number; confirmed: number; arrived: number }>;
}
export interface DriveTrend {
  requisitionId: string; branch: string; sourceType: SourceType | null; window: WindowInfo; points: TrendPoint[];
  partial: boolean; failedSections: string[];
}
// backend/src/modules/hiring-engine/he-campaign-dashboard.service.ts
export interface DriveDayRow { driveId: string; date: string; branch: string; requisition: string; role: string; status: string; wanted: number; lined: number; invited: number; confirmed: number; arrived: number; noShow: number; declined: number }
// backend/src/modules/hiring-engine/he-drive-trend.service.ts
export interface DriveGroup {
  requisitionId: string; branch: string; requisition: string; role: string; sourceType: SourceType; types: SourceType[]; streamIds: string[];
  window: WindowInfo; totals: DriveTotals; days: DriveDayRow[];
}

// backend/src/modules/hiring-engine/he-requisition-sources.service.ts
export interface SourceCounts { leads: number; qualified: number; emailed: number; whatsapped: number; replied: number; confirmed: number; called: number; arrived: number; selected: number; joined: number }
export interface SourceRow extends SourceCounts {
  sourceType: SourceType; originId: string; originLabel: string; streamId: string | null; streamStatus: StreamStatus | null;
  shareOfLeads: number; shareOfJoined: number; leadToJoinRate: number;
}
export interface RequisitionSources {
  requisitionId: string; code: string; branch: string; role: string; generatedAt: string; followupMode: FollowupMode;
  rows: SourceRow[]; totals: SourceCounts & { leadToJoinRate: number };
  partial: boolean; failedSections: string[];
}

// backend/src/modules/hiring-engine/he-drive-insights.ts
export type InsightRule = "under_target" | "weak_stage" | "contact_timing" | "reminder_gap" | "distance" | "channel_gap" | "language" | "overbooking" | "stream_dry" | "best_source" | "weekday";
export type InsightSeverity = "critical" | "warn" | "info";
export type EffectUnit = "arrivals_per_day" | "replies_per_day" | "joins_per_day" | "people" | "seats";
export type InsightAction =
  | { type: "open_plan"; requisitionId: string; date: string }
  | { type: "plan_now"; requisitionId: string; date: string }
  | { type: "extend_stream"; streamId: string; requisitionId: string }
  | { type: "create_stream"; requisitionId: string; sourceType: SourceType }
  | { type: "open_section"; section: "live" | "old" | "he" }
  | { type: "open_followup" }
  | { type: "none" };
export interface DriveInsight {
  id: string; rule: InsightRule; severity: InsightSeverity; sourceType: SourceType | null; requisitionId: string | null;
  title: string; evidence: Array<{ label: string; value: string }>; suggestion: string;
  effect: { value: number; unit: EffectUnit; text: string } | null; action: InsightAction;
}

// backend/src/modules/hiring-engine/he-drive-analytics.service.ts
// backend/src/modules/hiring-engine/he-cost.ts
export interface CostRates { "cost.whatsapp_per_conversation": number; "cost.call_per_minute": number; "cost.call_per_call": number; "cost.email": number }
export interface CostUsage { adSpend: number; waConversations: number; calls: number; callMinutes: number; emails: number }
export interface TypeCost {
  total: number; adSpend: number; messaging: number;
  perLead: number | null; perQualified: number | null; perArrival: number | null; perJoin: number | null;
  usage: CostUsage;
}
export interface CostBlock { available: boolean; note: string; estimated: boolean; ratesConfigured: boolean; rates: CostRates; byType: Record<SourceType, TypeCost> | null }

export interface TypeAnalytics { stages: StageCounts; previous: StageCounts; noShow: number; declined: number; conversions: Conversion[]; sparkline: number[] }
export interface DriveAnalytics {
  generatedAt: string;
  window: { from: string; to: string; days: number };
  previousWindow: { from: string; to: string };
  filter: { requisitionId: string | null; branch: string | null };
  followupMode: FollowupMode;
  qualifiedTracked: boolean;
  types: Record<SourceType, TypeAnalytics>;
  typesPresent: SourceType[];
  daily: DailyPoint[];
  timing: { replies: Record<SourceType, Grid>; arrivals: Record<SourceType, Grid>; arrivalsWithoutTime: number };
  scatter: ScatterPoint[];
  waterfall: Record<SourceType, WaterfallStep[]>;
  groups: DriveGroup[];
  cost: CostBlock | { available: false; note: string };
  insights: DriveInsight[];
  requisitionCount: number;
  truncated: boolean;
  partial: boolean;
  failedSections: string[];
}

// backend/src/modules/hiring-engine/he-drive-plan.ts
export interface StreamRate { streamId: string; sourceType: SourceType; invited: number; arrived: number; rate: number; basis: "actual_weekday" | "actual" | "plan_default"; weekday?: number }
export interface PlanStreamLine { streamId: string; sourceType: SourceType; label: string; cap: number; lined: number; expected: number; rate: number; basis: StreamRate["basis"]; recommended: number; reasoning: string; covers: boolean }
export interface PlanDay { date: string; driveId: string | null; target: number; capacity: number; seatsUsed: number; expected: number; gap: number; streams: PlanStreamLine[] }
export interface CalendarCell { date: string; streamId: string; planned: number; cap: number; capacity: number; fill: number }

// backend/src/modules/hiring-engine/he-stream-plan.service.ts
export interface StreamLine { streamId: string; sourceType: SourceType; originLabel: string; cap: number; alreadyLined: number; lined: number; wouldLine?: number; skipped?: string }
export interface StreamDayPlan {
  requisitionId: string; code: string; branch: string; date: string; driveId: string | null;
  drive: "created" | "exists" | "would_create" | "skipped"; reason?: string; streams: StreamLine[];
  /** Set only with HE_SHOWRATE_CALIBRATION on. */
  rates?: Array<{ streamId: string; rate: number; basis: StreamRate["basis"] }>;
}

// backend/src/modules/hiring-engine/he-drive-plan.service.ts
export interface ChecklistItem { kind: "will_plan" | "already_planned" | "fill_soon" | "stream_ends_tomorrow" | "pool_below_quota" | "readiness"; text: string; streamId?: string }
export interface DrivePlan {
  requisitionId: string; code: string; branch: string; generatedAt: string; from: string;
  days: PlanDay[]; calendar: CalendarCell[]; rates: StreamRate[];
  /** Present only when the server calibrated the show rates (HE_SHOWRATE_CALIBRATION on). */
  showRateMode?: "calibrated";
  /** With showRateMode: the trailing window (days) the rates were measured over. */
  showRateWindowDays?: number;
  checklist: { date: string; preview: StreamDayPlan | null; items: ChecklistItem[] };
  partial: boolean; failedSections: string[];
}

// backend/src/modules/hiring-engine/qualified-followup.attention.ts
export type AttentionChannel = "email" | "whatsapp" | "call";
export interface AttentionRow {
  id: string; name: string | null; mobileMasked: string; requisitionId: string; sourceType: SourceType;
  error: string | null; attempts: number; updatedAt: string;
  outcomeUnknown: boolean; retryable: boolean;
  retryReason: "outcome_unknown" | "already_sent" | "already_in_file" | null;
}
export interface AttentionGroup { channel: AttentionChannel; cause: string; count: number; rows: AttentionRow[] }

// backend/src/modules/hiring-engine/he-command.routes.ts
export interface FollowupStatus {
  mode: FollowupMode;
  callFiles: Array<{ id: string; createdAt: string; rows: number; status: string; error: string | null }>;
  report: { running: boolean; last: { slot: string; ok: boolean; tries: number } | null };
}

// backend/src/modules/hiring-engine/he-action-queue.ts and he-action-queue.service.ts
export type ActionKind = "replied_not_confirmed" | "confirmed_no_reminder" | "no_show_recovery" | "wa_failed" | "high_score_not_reached";
export interface ActionItem {
  id: string; kind: ActionKind; reason: string; ageMinutes: number; ageText: string; suggested: "call" | "whatsapp"; ref: string; leadId: string | null;
  name: string; mobileMasked: string; requisitionId: string; requisitionCode: string; branch: string; driveDate: string | null;
  recruiter: { name: string | null; basis: "assigned" | "suggested" | "none" };
}
export interface ActionQueue {
  enabled: boolean; generatedAt: string; items: ActionItem[]; counts: Record<ActionKind, number>; truncated: boolean; partial: boolean; failedSections: string[]; partialReason?: string;
}
