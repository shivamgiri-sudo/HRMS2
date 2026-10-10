/**
 * Pure view-model of the Live Meta / Old Meta data sections. The sections reuse the Summary components on analytics scoped to one source
 * type, so the numbers are the Summary's. Holds: the scoping, the honest zero notes, the "historic" rule for Old Meta data with the
 * one-tap widen, and the campaign mapping rows. No I/O, no regex literals.
 */
import { STAGES, type DriveAnalytics, type SourceType, type Stage, type StageCounts, type TypeAnalytics } from "./driveCommandTypes";
import { SOURCE_TYPES, STAGE_LABEL, TYPE_LABEL, countText, defaultFilters, type Filters } from "./driveCommandModel";
import { applyDateChange, dateBounds } from "./commandData";
import { boundaryDayText } from "./charts/summaryView";

export const HISTORIC_NOTE = "Old Meta leads are historic. Widen the date range to see them.";
export const SHOW_ALL_TIME = "Show all time";
/** The report never reads more than 92 days; "all time" therefore means the longest range it allows. */
export const ALL_TIME_HINT = "Shows the 92 days ending on the To date, the longest range the report allows.";
export const STREAMS_HEADING = "Streams";
/** Shown in the Hiring Engine section: its numbers never include Meta-origin people (the three sections do not overlap). */
export const HE_META_NOTE = "Meta campaign leads are shown under Live Meta and Old Meta data.";

const zeroStages = (): StageCounts => ({ leads: 0, qualified: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 });
const blankType = (t?: TypeAnalytics): TypeAnalytics => ({ stages: zeroStages(), previous: zeroStages(), noShow: 0, declined: 0, conversions: (t?.conversions ?? []).map((c) => ({ ...c, rate: null })), sparkline: [] });
const stagesOf = (a: DriveAnalytics, t: SourceType): StageCounts => ({ ...zeroStages(), ...(a?.types?.[t]?.stages ?? {}) });

/** The same analytics with every other source type emptied, so the shared chart models and components show one type. */
export function scopeToType(a: DriveAnalytics, type: SourceType): DriveAnalytics {
  const types = {} as Record<SourceType, TypeAnalytics>;
  const waterfall = {} as Record<SourceType, DriveAnalytics["waterfall"][SourceType]>;
  for (const t of SOURCE_TYPES) { types[t] = t === type && a?.types?.[t] ? a.types[t] : blankType(a?.types?.[t]); waterfall[t] = t === type ? a?.waterfall?.[t] ?? [] : []; }
  return {
    ...a,
    types,
    waterfall,
    typesPresent: (a?.typesPresent ?? []).filter((t) => t === type),
    daily: (a?.daily ?? []).map((d) => ({ ...d, byType: { meta_live: zero(d, "meta_live", type), meta_old: zero(d, "meta_old", type), he: zero(d, "he", type) } })),
    scatter: (a?.scatter ?? []).filter((p) => p.sourceType === type),
    groups: (a?.groups ?? []).filter((g) => g.sourceType === type || g.types?.includes(type)),
    cost: { available: false, note: "" },
  };
}
function zero(d: DriveAnalytics["daily"][number], t: SourceType, keepType: SourceType) {
  return t === keepType && d.byType?.[t] ? d.byType[t] : { invited: 0, confirmed: 0, arrived: 0 };
}

/** True when the window is the page default (the last 14 days ending today IST). */
export function isDefaultWindow(f: Filters, now: Date = new Date()): boolean {
  const d = defaultFilters(now);
  return f.from === d.from && f.to === d.to;
}

/** Old Meta data with no leads in the default window: the data is historic, offer the wider range. */
export function showHistoricNote(a: DriveAnalytics, type: SourceType, f: Filters, now: Date = new Date()): boolean {
  return type === "meta_old" && stagesOf(a, type).leads === 0 && isDefaultWindow(f, now);
}

/** The longest range the API allows ending on the current To date (same clamp the From input applies). */
export function showAllTimeFilters(f: Filters, now: Date = new Date()): Filters {
  return applyDateChange(f, "from", dateBounds(f, now).from.min, now);
}

/** Whether the window is already as wide as the report allows. */
export function atWidestRange(f: Filters, now: Date = new Date()): boolean {
  return showAllTimeFilters(f, now).from === f.from;
}

export interface ZeroNote { id: string; text: string }
/** Why numbers are zero, in plain words: a Live Meta range before the (rolling) cutoff, nothing in range, no drive credit yet, a stage that is not
 *  measured, or leads that are on no drive yet. */
export function zeroNotes(a: DriveAnalytics, type: SourceType, f: Filters, now: Date = new Date()): ZeroNote[] {
  const s = stagesOf(a, type);
  const label = TYPE_LABEL[type];
  const out: ZeroNote[] = [];
  const cutoff = a?.liveFrom ?? null;
  // Nothing before the cutoff is ever Live (the person rule), so the note only explains an all-zero Live section; never next to numbers.
  const day = boundaryDayText(cutoff);
  if (type === "meta_live" && cutoff && day && (a?.window?.to ?? f.to) < cutoff && STAGES.every((st) => s[st] === 0)) {
    const n = a?.liveMode !== "fixed" && typeof a?.liveDays === "number" ? a.liveDays : null;
    out.push({ id: "before-cutoff", text: n === null
      ? `Live Meta starts with form fills on ${day}. This range ends before that, so its Meta leads are under Old Meta data.`
      : `Live Meta is the last ${n} day${n === 1 ? "" : "s"}: form fills on or after ${day}. This range ends before that, so its Meta leads are under Old Meta data (first fill older than ${n} day${n === 1 ? "" : "s"}).` });
  }
  if (s.leads === 0) {
    if (showHistoricNote(a, type, f, now)) out.push({ id: "historic", text: HISTORIC_NOTE });
    else out.push({ id: "no-leads", text: `No ${label} leads in this date range${atWidestRange(f, now) ? ", and the range is already as wide as the report allows" : ". Widen the date range to look further back"}.` });
    return out;
  }
  const tracked = a?.qualifiedTracked !== false;
  const zeros = STAGES.filter((st) => st !== "leads" && s[st] === 0 && (tracked || st !== "qualified"));
  if (!tracked) out.push({ id: "untracked", text: "Qualified is not tracked yet: the follow-up pipeline is off, so it shows a dash instead of a zero." });
  // Selected and joined are credited to a drive only after a recorded arrival there, so their zero says that, not "no activity".
  const credited = zeros.filter((z) => z === "selected" || z === "joined");
  const plain = zeros.filter((z) => z !== "selected" && z !== "joined");
  const names = (xs: readonly Stage[]): string => xs.map((z) => STAGE_LABEL[z]).join(", ");
  if (plain.length) out.push({ id: "no-activity", text: `${names(plain)}: no activity in this range yet.` });
  if (credited.length) {
    out.push({ id: "no-credit", text: s.arrived === 0
      ? `${names(credited)}: no arrival was recorded at a drive in this range, and only people who arrived at a drive are counted.`
      : `${names(credited)}: nobody who arrived at a drive in this range has reached ${credited.length > 1 ? "them" : "it"} yet.` });
  }
  const hasRows = (a?.groups ?? []).some((g) => g.sourceType === type || g.types?.includes(type));
  if (!hasRows) out.push({ id: "no-streams", text: `These ${label} leads are not on a drive yet, so there are no drive rows. Open a stream to start inviting them.` });
  return out;
}

// ---- campaign mapping (GET /api/he/meta-recruitment) ------------------------------------------------------------------------------------
// No Joined column: the endpoint's joined comes from the requisition's onboarding records with no drive or arrival rule, so it would
// contradict the drive-credited Selected / Joined tiles above.
export const MAPPING_COLUMNS = ["Campaign", "Requisition", "Branch", "Status", "Leads", "Qualified"] as const;
export const MAPPING_NOTE = "Leads and Qualified are all-time form fills of each campaign; they are not credited to a drive.";
export interface CampaignRecruitmentRow { campaignId: string; campaignName: string; status: string; requisitionCode: string | null; branchName: string | null; leads: number; qualified: number; joined?: number }
export interface CampaignMappingRow { id: string; name: string; requisition: string; branch: string; status: string; leads: string; qualified: string }
export interface CampaignMappingView { rows: CampaignMappingRow[]; unmapped: number; total: number; empty: boolean }
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Campaigns with leads, biggest first, each with the requisition it feeds ("Not linked" when none). All-time counts. */
export function campaignMappingView(data: { campaigns?: CampaignRecruitmentRow[] } | null | undefined): CampaignMappingView {
  const list = (Array.isArray(data?.campaigns) ? data.campaigns : []).filter((c) => num(c?.leads) > 0);
  const sorted = [...list].sort((p, q) => num(q.leads) - num(p.leads) || String(p.campaignName).localeCompare(String(q.campaignName)));
  const rows = sorted.map((c) => ({
    id: String(c.campaignId), name: String(c.campaignName ?? ""), requisition: c.requisitionCode || "Not linked", branch: c.branchName || "No branch", status: String(c.status ?? ""),
    leads: countText(num(c.leads)), qualified: countText(num(c.qualified)),
  }));
  return { rows, unmapped: sorted.filter((c) => !c.requisitionCode).length, total: rows.length, empty: rows.length === 0 };
}
