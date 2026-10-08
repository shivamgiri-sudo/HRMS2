/**
 * Pure model of the held-offers list (GET /api/he/qualified-followup/held, backend he-best-offer.service.ts listHeldOffers).
 * A person qualified for several requisitions gets one offer at a time; the other rows wait ("held"). No I/O, no React, no regex literals.
 */
import { DASH, maskedMobile, orDash, scrubText } from "./followupPanelModel";
import type { SourceType } from "./driveCommandTypes";

export const HELD_PATH = "/api/he/qualified-followup/held";
export const HELD_OFF_SENTENCE = "Best-offer holding is off";
export const HELD_PARTIAL_SENTENCE = "Partial result: the held offers could not be read just now";

export type OfferWhy = "already_offered" | "nearer" | "higher_score" | "more_urgent" | "earlier";
export interface HeldOffer {
  id: string; name: string | null; mobileMasked: string; requisitionId: string; requisitionCode: string; sourceType: SourceType;
  status: "held_other_offer"; heldFor: { requisitionCode: string; why: OfferWhy }; qualifiedAt: string;
}
export interface HeldOffers { enabled: boolean; rows: HeldOffer[]; truncated: boolean; partial: boolean }

const WHY: Record<OfferWhy, string> = {
  already_offered: "already offered", nearer: "nearer branch", higher_score: "better match", more_urgent: "fewer seats left", earlier: "qualified earlier",
};
export function whyText(w: OfferWhy): string {
  return Object.prototype.hasOwnProperty.call(WHY, w) ? WHY[w] : "better fit";
}
/** "Held for RQ-12 (nearer branch)". */
export function heldLine(h: Pick<HeldOffer, "heldFor">): string {
  return `Held for ${orDash(h.heldFor?.requisitionCode)} (${whyText(h.heldFor?.why)})`;
}

/** "3 h ago" style age since qualification; a bad or future time gives a dash. */
export function ageText(iso: unknown, now: number = Date.now()): string {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t) || t > now) return DASH;
  const min = Math.floor((now - t) / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} days ago`;
}

export interface HeldView { id: string; name: string; mobile: string; code: string; line: string; age: string }
export type HeldState = { kind: "off" } | { kind: "partial" } | { kind: "empty" } | { kind: "list"; rows: HeldView[]; total: number; truncated: boolean };

/** What to show: null (not loaded) hides everything; off and partial are stated in words; an empty list says so. */
export function heldState(h: unknown, now: number = Date.now()): HeldState | null {
  const d = h as Partial<HeldOffers> | null | undefined;
  if (!d || typeof d !== "object") return null;
  if (d.enabled !== true) return { kind: "off" };
  const rows = Array.isArray(d.rows) ? d.rows.filter((r): r is HeldOffer => !!r && typeof r === "object") : [];
  if (rows.length === 0) return d.partial ? { kind: "partial" } : { kind: "empty" };
  return {
    kind: "list", total: rows.length, truncated: d.truncated === true,
    rows: rows.map((r, i) => ({
      id: typeof r.id === "string" && r.id ? r.id : `held-${i}`, name: orDash(r.name), mobile: maskedMobile(r.mobileMasked),
      code: orDash(r.requisitionCode), line: heldLine(r), age: ageText(r.qualifiedAt, now),
    })),
  };
}
export const heldTitle = (n: number): string => `Held: another offer is in progress (${n})`;
export const heldNote = (s: string): string => scrubText(s);
