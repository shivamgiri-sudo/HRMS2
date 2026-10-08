/** Pure model of a campaign's requisitions (WS3 A4): row texts, add options, where a held lead may be placed, API paths. No DOM, no regex literals. */
export interface Completeness { score: number; label: "complete" | "partial" | "incomplete"; missing: string[]; enrolmentReady: boolean }
export interface CampaignLink {
  campaignId: string; requisitionId: string; code: string; branch: string; isPrimary: boolean; sortOrder: number;
  openReason: string | null; endDate: string | null; endDatePassed: boolean; endedReason: string | null; seatsLeft: number; bmiLinkPresent: boolean; criteria: Completeness | null;
}
export interface HeldLead { id: string; name: string; maskedMobile: string; requisitionId: string | null; at: string }
export interface RoutingSummary { counts: Record<string, number>; held: HeldLead[] }
export interface AddResult { isPrimary: boolean; warnings: string[]; offerCopy: boolean; templateApplied: boolean }

export const linksPath = (campaignId: string): string => `/api/meta/campaigns/${encodeURIComponent(campaignId)}/requisitions`;
export const linkPath = (campaignId: string, requisitionId: string): string => `${linksPath(campaignId)}/${encodeURIComponent(requisitionId)}`;
export const routingPath = (campaignId: string): string => `/api/meta/campaigns/${encodeURIComponent(campaignId)}/routing`;
export const placePath = (leadId: string): string => `/api/meta/leads/${encodeURIComponent(leadId)}/requisition`;
/** CAMPAIGN_WRITE_ROLES of the server. */
export const LINK_WRITE_ROLES = ["super_admin", "admin", "hr", "recruitment_hr"] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateText = (iso: string): string => {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const words = (k: string): string => k.split("_").join(" ");

export function linkRowView(l: CampaignLink) {
  const c = l.criteria;
  const missing = c && c.missing.length ? ` (missing: ${c.missing.slice(0, 4).map(words).join(", ")})` : "";
  return {
    code: l.code || "Requisition", branch: l.branch || "No branch", main: l.isPrimary ? "Main requisition" : "",
    seats: `${l.seatsLeft} seat${l.seatsLeft === 1 ? "" : "s"} left`,
    end: l.endDate ? { text: `${l.endDatePassed ? "Ended" : "Ends"} ${dateText(l.endDate)}`, ended: l.endDatePassed } : { text: "No end date", ended: false },
    criteria: c ? `Criteria ${c.label}${missing}` : "Criteria not read",
    enrolment: c && !c.enrolmentReady ? "Enrolment blocked: criteria incomplete" : "",
    state: l.openReason ? `Closed: ${l.openReason}` : "Open",
  };
}

export function addOptions(open: Array<{ id: string; label: string; branch: string }>, links: CampaignLink[]): Array<{ id: string; label: string }> {
  const linked = new Set(links.map((l) => l.requisitionId));
  return open.filter((o) => !linked.has(o.id)).map((o) => ({ id: o.id, label: o.branch ? `${o.label} · ${o.branch}` : o.label }));
}

export function heldPlaceOptions(links: CampaignLink[]): Array<{ id: string; label: string }> {
  return links.filter((l) => !l.openReason).map((l) => ({ id: l.requisitionId, label: l.code }));
}

export function addResultText(r: AddResult, code: string): string {
  const parts = [`${code} linked${r.isPrimary ? " as the main requisition" : ""}`];
  if (r.templateApplied) parts.push("the campaign template filled its empty criteria");
  if (r.warnings.length) parts.push(`warning: ${r.warnings.join("; ")}`);
  if (r.offerCopy) parts.push("this campaign had its own screening rules: copy them into the requisition from the criteria editor");
  return `${parts.join("; ")}.`;
}
