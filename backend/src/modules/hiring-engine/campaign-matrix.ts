/**
 * Campaign x requisition x drive matrix (WS3 C1 with the 2026-10-09 amendments). Pure.
 * A cell is one drive kind (Live Meta / Old Meta data / Hiring Engine) of one campaign x requisition row:
 *  - not_applicable: a Meta kind on a requisition-only row (no campaign);
 *  - not_mapped: no stream of that kind and nobody contacted in 48 h; carries the Open-a-stream prefill ("Map it");
 *  - running: people were contacted in the last 48 h and no blocking reason applies (a warning reason may still be shown);
 *  - idle: otherwise, with the first failing reason in REASON_ORDER.
 * Blocking reasons stop outreach (closed / full requisition, an enforced end date, a campaign not active, no lead form, a stream in draft,
 * paused or closed); the rest explain why nothing moves (criteria incomplete, awaiting approval, enrolment off, no drive planned, ...).
 */
import type { Completeness } from "../selection/selection-types.js";

export type DriveKind = "meta_live" | "meta_old" | "he";
export const DRIVE_KINDS: readonly DriveKind[] = ["meta_live", "meta_old", "he"];
export type CellState = "running" | "idle" | "not_mapped" | "not_applicable";
export type IdleReason = "requisition_closed" | "requisition_ended" | "requisition_full" | "campaign_not_active" | "no_form" | "no_bmi_link"
  | "stream_draft" | "stream_paused" | "stream_closed" | "criteria_incomplete" | "awaiting_approval" | "enrolment_off"
  | "no_drive_planned" | "no_eligible_people" | "no_contact_48h" | "no_responses_3d";
export const REASON_ORDER: readonly IdleReason[] = ["requisition_closed", "requisition_ended", "requisition_full", "campaign_not_active", "no_form", "no_bmi_link",
  "stream_draft", "stream_paused", "stream_closed", "criteria_incomplete", "awaiting_approval", "enrolment_off", "no_drive_planned", "no_eligible_people",
  "no_contact_48h", "no_responses_3d"];

export interface MatrixStream { id: string; status: "draft" | "open" | "paused" | "closed"; originId: string }
export interface MatrixFacts {
  campaign: { id: string; name: string; status: string; hasForm: boolean } | null;
  requisition: { id: string; code: string; branch: string; closedReason: string | null; endDate: string | null; endDatePassed: boolean; seatsLeft: number;
    bmiLinkPresent: boolean; completeness: Completeness | null };
  streams: Partial<Record<DriveKind, MatrixStream>>;
  /** Distinct people sent an outbound message (or a legacy notification) for this requisition in 48 h, by the shared attribution rule. */
  /** null: the activity read failed or timed out (unknown, listed in partial). */
  activity48h: Record<DriveKind, number> | null;
  /** WS2 present: distinct people with a response in 3 days; null when unknown. */
  responses3d: Record<DriveKind, number> | null;
  drivesNext3d: number;
  /** Picked + review people of the latest shortlist run for this requisition and source; absent when none ran. */
  eligible: Partial<Record<DriveKind, number>>;
  /** The latest run has people waiting for HR approval for more than 24 h. */
  pendingApproval: Partial<Record<DriveKind, boolean>>;
  enrolmentOn: Record<DriveKind, boolean>;
  enforcedEndDate: boolean;
}
export interface MatrixCell {
  kind: DriveKind; state: CellState; reason: IdleReason | null; reasonText: string; activity48h: number; activityUnknown?: boolean; streamId: string | null; streamStatus: MatrixStream["status"] | null;
  mapIt: { requisitionId: string; sourceType: DriveKind; originId: string | null } | null;
  /** Live Meta cell of a campaign on a closed or full requisition: HR can relink the campaign to an open one (preview first). */
  relink: boolean;
}
export interface MatrixRow {
  key: string; campaign: MatrixFacts["campaign"]; requisition: MatrixFacts["requisition"]; cells: Record<DriveKind, MatrixCell>;
}

const KIND_LABEL: Record<DriveKind, string> = { meta_live: "Live Meta", meta_old: "Old Meta data", he: "Hiring Engine" };

function reasonText(r: IdleReason, f: MatrixFacts, kind: DriveKind): string {
  const q = f.requisition;
  switch (r) {
    case "requisition_closed": return `Requisition ${q.code} is closed (${q.closedReason}); outreach refuses its people`;
    case "requisition_ended": return f.enforcedEndDate ? `End date ${q.endDate} has passed; no new first contacts` : `End date ${q.endDate} has passed (warning: not enforced)`;
    case "requisition_full": return `All seats of ${q.code} are filled`;
    case "campaign_not_active": return `The campaign is ${f.campaign?.status ?? "not active"}`;
    case "no_form": return "No Meta lead form is linked, so new form fills are not imported";
    case "no_bmi_link": return `${q.code} has no BookMyInterview link, so invites cannot carry a booking link`;
    case "stream_draft": return `The ${KIND_LABEL[kind]} stream is a draft; open it to start`;
    case "stream_paused": return `The ${KIND_LABEL[kind]} stream is paused`;
    case "stream_closed": return `The ${KIND_LABEL[kind]} stream is closed`;
    case "criteria_incomplete": return `Criteria incomplete: shortlist enrolment is blocked${q.completeness?.missing.length ? ` (missing: ${q.completeness.missing.slice(0, 4).join(", ").replace(/_/g, " ")})` : ""}`;
    case "awaiting_approval": return "Shortlisted people are waiting for HR approval";
    case "enrolment_off": return "Enrolment is off for this source";
    case "no_drive_planned": return "No drive is planned in the next 3 days";
    case "no_eligible_people": return "The last shortlist found nobody eligible";
    case "no_contact_48h": return "Nobody was contacted in the last 48 hours";
    case "no_responses_3d": return "Nobody answered in the last 3 days";
  }
}

const BLOCKING: ReadonlySet<IdleReason> = new Set(["requisition_closed", "requisition_full", "campaign_not_active", "no_form", "stream_draft", "stream_paused", "stream_closed"]);

function failing(f: MatrixFacts, kind: DriveKind, s: MatrixStream | undefined, activity: number): IdleReason[] {
  const q = f.requisition, meta = kind !== "he";
  const out: IdleReason[] = [];
  const full = q.closedReason === "all seats in this batch are filled";
  if (q.closedReason && !full) out.push("requisition_closed");
  if (q.endDatePassed) out.push("requisition_ended");
  if (full || q.seatsLeft <= 0) out.push("requisition_full");
  if (meta && f.campaign && f.campaign.status !== "active") out.push("campaign_not_active");
  if (kind === "meta_live" && f.campaign && !f.campaign.hasForm) out.push("no_form");
  if (meta && !q.bmiLinkPresent) out.push("no_bmi_link");
  if (s?.status === "draft") out.push("stream_draft");
  if (s?.status === "paused") out.push("stream_paused");
  if (s?.status === "closed") out.push("stream_closed");
  if (q.completeness && !q.completeness.enrolmentReady) out.push("criteria_incomplete");
  if (f.pendingApproval[kind]) out.push("awaiting_approval");
  if (!f.enrolmentOn[kind]) out.push("enrolment_off");
  if (kind !== "meta_live" && f.drivesNext3d <= 0) out.push("no_drive_planned");
  if (f.eligible[kind] === 0) out.push("no_eligible_people");
  if (activity <= 0 && f.activity48h) out.push("no_contact_48h");
  if (activity > 0 && f.responses3d && f.responses3d[kind] === 0) out.push("no_responses_3d");
  return REASON_ORDER.filter((r) => out.includes(r));
}

const isBlocking = (r: IdleReason, f: MatrixFacts): boolean => BLOCKING.has(r) || (r === "requisition_ended" && f.enforcedEndDate);

export function matrixCell(f: MatrixFacts, kind: DriveKind): MatrixCell {
  const unknown = f.activity48h === null;
  const base = { kind, activity48h: f.activity48h?.[kind] ?? 0, ...(unknown ? { activityUnknown: true } : {}), streamId: null as string | null, streamStatus: null as MatrixStream["status"] | null, mapIt: null as MatrixCell["mapIt"], relink: false };
  if (kind !== "he" && !f.campaign) return { ...base, state: "not_applicable", reason: null, reasonText: "No campaign on this row", activity48h: 0 };
  const s = f.streams[kind];
  const activity = base.activity48h;
  const q = f.requisition;
  const dead = q.closedReason || q.seatsLeft <= 0 || (f.enforcedEndDate && q.endDatePassed);
  // A campaign on a closed or full requisition is a mapping that cannot move (K7BK): never "not mapped", and Live Meta offers the relink.
  const relink = kind === "meta_live" && !!f.campaign && !!(q.closedReason || q.seatsLeft <= 0);
  if (!s && activity <= 0 && !dead && !unknown) {
    const originId = kind === "meta_live" ? f.campaign!.id : kind === "he" ? "pool" : null;
    return { ...base, state: "not_mapped", reason: null, reasonText: `No ${KIND_LABEL[kind]} stream works on this requisition`, mapIt: { requisitionId: f.requisition.id, sourceType: kind, originId } };
  }
  const reasons = failing(f, kind, s, activity);
  const blocking = reasons.find((r) => isBlocking(r, f)) ?? null;
  const cell = { ...base, streamId: s?.id ?? null, streamStatus: s?.status ?? null, relink };
  if (activity > 0 && !blocking) {
    const warn = reasons[0] ?? null;
    const note = s ? "" : " (no stream: legacy outreach)";
    return { ...cell, state: "running", reason: warn, reasonText: warn ? `${activity} contacted in 48 h; ${reasonText(warn, f, kind)}${note}` : `${activity} contacted in 48 h${note}` };
  }
  if (unknown && !reasons.length) return { ...cell, state: "idle", reason: null, reasonText: "Contacts in the last 48 h are unknown (the activity read timed out)" };
  const first = reasons[0] ?? "no_contact_48h";
  const extra = activity > 0 ? ` (${activity} contacted in 48 h)` : "";
  return { ...cell, state: "idle", reason: first, reasonText: `${reasonText(first, f, kind)}${extra}` };
}

export function matrixRows(fs: MatrixFacts[]): MatrixRow[] {
  return fs.map((f) => ({
    key: `${f.campaign?.id ?? "~"}|${f.requisition.id}`, campaign: f.campaign, requisition: f.requisition,
    cells: { meta_live: matrixCell(f, "meta_live"), meta_old: matrixCell(f, "meta_old"), he: matrixCell(f, "he") },
  }));
}
