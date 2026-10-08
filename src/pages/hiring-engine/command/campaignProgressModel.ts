/**
 * Pure view-model of the per-campaign progress table (DriveAnalytics.campaigns): one row per Meta campaign x requisition of the activity
 * x Live / Old, the largest drop-off of each row, a "stalled" flag when qualified people got no contact (with the server's blocker text),
 * rates only from denominators of at least MIN_SAMPLE, and a stable sort. No DOM, no regex literals.
 */
import type { CampaignProgress, DriveAnalytics, SourceType } from "./driveCommandTypes";
import { TYPE_LABEL, countText, pctText } from "./driveCommandModel";
import { MIN_SAMPLE } from "./charts/journeyModel";

type StageKey = "leads" | "qualified" | "contacted" | "invited" | "confirmed" | "arrived" | "selected" | "joined";
const STAGE_KEYS: readonly StageKey[] = ["leads", "qualified", "contacted", "invited", "confirmed", "arrived", "selected", "joined"];
const STAGE_TEXT: Record<StageKey, string> = { leads: "Leads", qualified: "Qualified", contacted: "Contacted", invited: "Invited", confirmed: "Confirmed", arrived: "Arrived", selected: "Selected", joined: "Joined" };
export type CampaignColumnKind = "text" | "count" | "rate";
export const CAMPAIGN_COLUMNS: ReadonlyArray<{ key: string; label: string; kind: CampaignColumnKind }> = [
  { key: "campaign", label: "Campaign", kind: "text" }, { key: "requisition", label: "Requisition", kind: "text" }, { key: "branch", label: "Branch", kind: "text" },
  { key: "type", label: "Live / Old", kind: "text" },
  ...STAGE_KEYS.map((k) => ({ key: k, label: STAGE_TEXT[k], kind: "count" as const })),
  { key: "leadToConfirmed", label: "Lead to confirmed", kind: "rate" }, { key: "confirmedToArrived", label: "Confirmed to arrived", kind: "rate" },
];
export const NOT_AVAILABLE = "The reason is not available from this server.";
export const NO_BLOCKER = "No blocker was found on the campaign or its requisition.";
export const STALLED_NOTE = "Stalled: people passed screening but nobody contacted them in this range.";

export interface CampaignRowView {
  id: string; name: string; requisition: string; branch: string; typeLabel: string; sourceType: "meta_live" | "meta_old";
  cells: Record<string, number | string | null>; texts: Record<string, string>;
  biggestDrop: { from: StageKey; to: StageKey; lost: number; text: string } | null;
  stalled: boolean; stalledWhy: string[]; qualified: number;
}
export interface CampaignProgressView { rows: CampaignRowView[]; empty: boolean; stalledCount: number; stalledPeople: number }

const n0 = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const rate = (n: number, d: number): number | null => (d >= MIN_SAMPLE && n <= d ? n / d : null);

function rowOf(c: CampaignProgress, i: number): CampaignRowView {
  const s = c.stages ?? ({} as CampaignProgress["stages"]);
  const own = c.campaignRequisitionCode && c.campaignRequisitionCode !== c.requisitionCode ? ` (campaign: ${c.campaignRequisitionCode})` : "";
  const cells: Record<string, number | string | null> = {
    campaign: c.campaignName || "No campaign", requisition: `${c.requisitionCode || "No requisition"}${own}`, branch: c.branch || "No branch", type: TYPE_LABEL[c.sourceType],
  };
  for (const k of STAGE_KEYS) cells[k] = n0(s[k]);
  cells.leadToConfirmed = rate(n0(s.confirmed), n0(s.leads));
  cells.confirmedToArrived = rate(n0(s.arrived), n0(s.confirmed));
  const texts: Record<string, string> = {};
  for (const col of CAMPAIGN_COLUMNS) {
    const v = cells[col.key];
    texts[col.key] = col.kind === "text" ? String(v) : col.kind === "rate" ? pctText(v as number | null) : countText(v as number);
  }
  // Qualified belongs in the chain only when the row has screened fills in range (older fills were screened before it); an older server
  // without the field keeps it when anyone qualified.
  const screenedKnown = typeof s.screened === "number" || typeof s.fills === "number";
  const keepQualified = screenedKnown ? n0(s.screened) + n0(s.fills) > 0 : n0(s.qualified) > 0;
  const chain = STAGE_KEYS.filter((k) => k !== "qualified" || keepQualified);
  let biggestDrop: CampaignRowView["biggestDrop"] = null;
  for (let k = 1; k < chain.length; k++) {
    const prev = n0(s[chain[k - 1]]), cur = n0(s[chain[k]]);
    if (cur > prev) continue; // not the same people: no loss to read
    const lost = prev - cur;
    if (lost > 0 && (!biggestDrop || lost > biggestDrop.lost)) biggestDrop = { from: chain[k - 1], to: chain[k], lost, text: `${STAGE_TEXT[chain[k - 1]]} to ${STAGE_TEXT[chain[k]].toLowerCase()}: ${countText(lost)} lost` };
  }
  const stalled = n0(s.qualified) > 0 && n0(s.contacted) === 0;
  const blockers = Array.isArray(c.blockers) ? c.blockers.filter((b) => b && typeof b.text === "string" && b.text !== "") : null;
  const stalledWhy = !stalled ? [] : blockers === null ? [NOT_AVAILABLE] : blockers.length ? blockers.map((b) => b.text) : [NO_BLOCKER];
  return {
    id: `${c.campaignId ?? "none"}|${c.requisitionId}|${c.sourceType}|${i}`, name: String(cells.campaign), requisition: String(cells.requisition), branch: String(cells.branch),
    typeLabel: TYPE_LABEL[c.sourceType], sourceType: c.sourceType, cells, texts, biggestDrop, stalled, stalledWhy, qualified: n0(s.qualified),
  };
}

/** Stalled rows first, then by leads; `only` limits to one drive type (Hiring Engine has no campaign rows). */
export function campaignProgressView(a: Pick<DriveAnalytics, "campaigns"> | null | undefined, only?: SourceType): CampaignProgressView {
  const list = (Array.isArray(a?.campaigns) ? a.campaigns : []).filter((c) => c && (!only || c.sourceType === only));
  const rows = list.map(rowOf).sort((x, y) => Number(y.stalled) - Number(x.stalled) || (y.cells.leads as number) - (x.cells.leads as number) || x.name.localeCompare(y.name));
  const stalled = rows.filter((r) => r.stalled);
  return { rows, empty: rows.length === 0, stalledCount: stalled.length, stalledPeople: stalled.reduce((t, r) => t + r.qualified, 0) };
}

/** Stable sort on one column: numbers with nulls last in both directions, text by locale. A copy is returned. */
export function sortCampaignRows(rows: CampaignRowView[], key: string, dir: "asc" | "desc"): CampaignRowView[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((x, y) => {
    const p = x.cells[key], q = y.cells[key];
    if (typeof p === "string" || typeof q === "string") return String(p ?? "").localeCompare(String(q ?? "")) * sign;
    const pn = typeof p !== "number" || !Number.isFinite(p), qn = typeof q !== "number" || !Number.isFinite(q);
    if (pn || qn) return pn === qn ? 0 : pn ? 1 : -1;
    return (p - q) * sign;
  });
}
