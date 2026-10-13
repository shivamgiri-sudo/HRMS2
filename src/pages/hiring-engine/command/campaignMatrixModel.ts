/**
 * Pure view-model of the campaign x requisition x drive map (GET /api/he/campaign-matrix, WS3 C4): one row per campaign x requisition
 * (or requisition only), three cells (Live Meta / Old Meta data / Hiring Engine) shown as icon + word + reason, the action each cell offers
 * (Map it, Open stream, Relink), filters, and the funnel drill-down read from the drive analytics (campaigns + byRequisition).
 * No DOM, no regex literals.
 */
import type { SourceType } from "./driveCommandTypes";

export type CellState = "running" | "idle" | "not_mapped" | "not_applicable";
export interface Completeness { score: number; label: "complete" | "partial" | "incomplete"; missing: string[]; enrolmentReady: boolean }
export interface MatrixCellData {
  kind: SourceType; state: CellState; reason: string | null; reasonText: string; activity48h: number; activityUnknown?: boolean; streamId: string | null;
  streamStatus: "draft" | "open" | "paused" | "closed" | null; mapIt: { requisitionId: string; sourceType: SourceType; originId: string | null } | null; relink: boolean;
}
export interface MatrixRowData {
  key: string; campaign: { id: string; name: string; status: string; hasForm: boolean } | null;
  requisition: { id: string; code: string; branch: string; closedReason: string | null; endDate: string | null; endDatePassed: boolean; seatsLeft: number; bmiLinkPresent: boolean; completeness: Completeness | null };
  cells: Record<SourceType, MatrixCellData>;
}
export interface CampaignMatrixData {
  rows: MatrixRowData[]; generatedAt: string; partial: string[]; enforcedEndDate: boolean;
  /** The Live Meta cutoff the Live / Old cells used (rolling: today IST minus liveDays). Absent on older servers. */
  liveFrom?: string; liveDays?: number; liveMode?: "rolling" | "fixed";
}

export type CellAction = { kind: "map_it"; label: string; prefill: NonNullable<MatrixCellData["mapIt"]> } | { kind: "open_stream"; label: string; streamId: string } | { kind: "relink"; label: string };
export interface CellView { word: string; icon: "running" | "idle" | "not_mapped" | "na"; people: string; text: string; action: CellAction | null }

const WORD: Record<CellState, string> = { running: "Running", idle: "Idle", not_mapped: "Not mapped", not_applicable: "Not used" };
const ICON: Record<CellState, CellView["icon"]> = { running: "running", idle: "idle", not_mapped: "not_mapped", not_applicable: "na" };
const STUCK_STREAMS = ["draft", "paused", "closed"];

export function cellView(c: MatrixCellData, o: { canWrite: boolean }): CellView {
  const people = c.state === "not_applicable" ? "" : c.activityUnknown ? "Contacts in 48 h unknown" : c.activity48h > 0 ? `${c.activity48h} contacted in 48 h` : "Nobody contacted in 48 h";
  let action: CellAction | null = null;
  if (o.canWrite) {
    if (c.state === "not_mapped" && c.mapIt) action = { kind: "map_it", label: "Map it", prefill: c.mapIt };
    else if (c.relink) action = { kind: "relink", label: "Relink to an open requisition" };
    else if (c.state === "idle" && c.streamId && c.streamStatus && STUCK_STREAMS.includes(c.streamStatus)) action = { kind: "open_stream", label: "Open stream", streamId: c.streamId };
  }
  return { word: WORD[c.state], icon: ICON[c.state], people, text: c.state === "not_applicable" ? "" : c.reasonText, action };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateText = (iso: string): string => {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const words = (k: string): string => k.split("_").join(" ");

export function rowHeader(r: MatrixRowData): { title: string; code: string; branch: string; endDate: { text: string; ended: boolean }; seats: string; criteria: string; closed: string | null } {
  const q = r.requisition;
  const c = q.completeness;
  const missing = c && c.missing.length ? ` (missing: ${c.missing.slice(0, 4).map(words).join(", ")})` : "";
  return {
    title: r.campaign ? r.campaign.name || "Campaign" : "No campaign: Hiring Engine only",
    code: q.code || "Requisition", branch: q.branch || "No branch",
    endDate: q.endDate ? { text: `${q.endDatePassed ? "Ended" : "Ends"} ${dateText(q.endDate)}`, ended: q.endDatePassed } : { text: "No end date", ended: false },
    seats: `${q.seatsLeft} seat${q.seatsLeft === 1 ? "" : "s"} left`,
    criteria: c ? `Criteria ${c.label}${missing}` : "Criteria not read",
    closed: q.closedReason,
  };
}

export interface MatrixFilters { branch: string; state: "all" | CellState; onlyProblems: boolean }
const KINDS: readonly SourceType[] = ["meta_live", "meta_old", "he"];
const problem = (c: MatrixCellData): boolean => c.state === "idle" || c.state === "not_mapped";

export function filterRows(rows: MatrixRowData[], f: MatrixFilters): MatrixRowData[] {
  return rows.filter((r) => (!f.branch || r.requisition.branch === f.branch)
    && (f.state === "all" || KINDS.some((k) => r.cells[k].state === f.state))
    && (!f.onlyProblems || KINDS.some((k) => problem(r.cells[k]))));
}

export function matrixSummary(rows: MatrixRowData[]): { running: number; idle: number; notMapped: number; rows: number } {
  const all = rows.flatMap((r) => KINDS.map((k) => r.cells[k].state));
  return { running: all.filter((s) => s === "running").length, idle: all.filter((s) => s === "idle").length, notMapped: all.filter((s) => s === "not_mapped").length, rows: rows.length };
}

type StageKey = "leads" | "fills" | "screened" | "qualified" | "contacted" | "invited" | "replied" | "confirmed" | "arrived" | "selected" | "joined";
const STAGES: ReadonlyArray<[StageKey, string]> = [["leads", "Leads"], ["fills", "Form fills"], ["screened", "Screened"], ["qualified", "Qualified"], ["contacted", "Contacted"],
  ["invited", "Invited"], ["replied", "Replied"], ["confirmed", "Confirmed"], ["arrived", "Arrived"], ["selected", "Selected"], ["joined", "Joined"]];
const META_ONLY: readonly StageKey[] = ["fills", "screened", "qualified"];
type Stages = Partial<Record<StageKey, number>>;
export interface FunnelSource {
  campaigns?: Array<{ campaignId: string | null; requisitionId: string; sourceType: "meta_live" | "meta_old"; stages: Stages }>;
  byRequisition?: Array<{ requisitionId: string; sourceType: SourceType; stages: Stages }>;
}

/** Stages of one cell in the analytics window; [] when the window has nobody there; null when the analytics are not loaded. */
export function funnelFor(r: MatrixRowData, kind: SourceType, a: FunnelSource | null | undefined): Array<{ key: StageKey; label: string; n: number }> | null {
  if (!a) return null;
  let s: Stages | undefined;
  if (kind === "he") s = (a.byRequisition ?? []).find((x) => x.requisitionId === r.requisition.id && x.sourceType === "he")?.stages;
  else if (r.campaign) s = (a.campaigns ?? []).find((x) => x.campaignId === r.campaign!.id && x.requisitionId === r.requisition.id && x.sourceType === kind)?.stages;
  if (!s) return [];
  return STAGES.filter(([k]) => kind !== "he" || !META_ONLY.includes(k)).map(([key, label]) => ({ key, label, n: Number(s![key] ?? 0) || 0 }));
}

export function matrixPath(q: { branch: string | null; requisitionId: string | null }): string {
  const p: string[] = [];
  if (q.branch) p.push(`branch=${encodeURIComponent(q.branch)}`);
  if (q.requisitionId) p.push(`requisitionId=${encodeURIComponent(q.requisitionId)}`);
  return `/api/he/campaign-matrix${p.length ? `?${p.join("&")}` : ""}`;
}
