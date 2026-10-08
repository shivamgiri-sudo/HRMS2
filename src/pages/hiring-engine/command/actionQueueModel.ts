/**
 * Pure model of the "Act now" panel (GET /api/he/action-queue, backend he-action-queue.service.ts). The list carries masked mobiles only;
 * full numbers are fetched one person at a time when a button is tapped. No I/O, no React, no regex literals.
 */
import { orDash, scrubText } from "./followupPanelModel";
import type { ActionItem, ActionKind, ActionQueue } from "./driveCommandTypes";
import type { Filters } from "./driveCommandModel";

export const ACTION_QUEUE_PATH = "/api/he/action-queue";
export const ACTION_NOTE = "Buttons open your phone or WhatsApp; nothing is sent from here";
export const ACTION_EMPTY = "Nobody needs a call right now";
export const ACTION_TRUNCATED = "Showing the first 100; filter by requisition or branch to see the rest";

export const KIND_ORDER: readonly ActionKind[] = ["replied_not_confirmed", "confirmed_no_reminder", "no_show_recovery", "wa_failed", "high_score_not_reached"];
export const KIND_LABEL: Record<ActionKind, string> = {
  replied_not_confirmed: "Replied, not confirmed",
  confirmed_no_reminder: "Confirmed, no reminder",
  no_show_recovery: "No-show recovery",
  wa_failed: "WhatsApp failed",
  high_score_not_reached: "Strong match not reached",
};

/** The page's requisition and branch filters only; the date range does not apply to a live queue. */
export function actionQueuePath(f: Filters): string {
  const q = new URLSearchParams();
  if (f.requisitionId) q.set("requisitionId", f.requisitionId);
  if (f.branch) q.set("branch", f.branch);
  const s = q.toString();
  return s ? `${ACTION_QUEUE_PATH}?${s}` : ACTION_QUEUE_PATH;
}

export function contactPath(ref: string, kind: "tel" | "whatsapp"): string {
  return `${ACTION_QUEUE_PATH}/contact?ref=${encodeURIComponent(ref)}&kind=${kind}`;
}

export function filterItems(items: ActionItem[], kind: ActionKind | "all"): ActionItem[] {
  return kind === "all" ? items : items.filter((i) => i.kind === kind);
}

export function recruiterText(r: ActionItem["recruiter"]): string {
  if (r?.basis === "assigned" && r.name) return `Assigned: ${scrubText(r.name)}`;
  if (r?.basis === "suggested" && r.name) return `Suggested: ${scrubText(r.name)}`;
  return "No recruiter found";
}

export function contactErrorText(e: unknown): string {
  const status = (e as { status?: unknown } | null | undefined)?.status;
  if (status === 403) return "Only HR can open contact details";
  if (status === 404) return "This candidate is no longer visible to you; reload";
  return "Could not open the contact; try again";
}

const isDigits = (s: string): boolean => s.length > 0 && Array.from(s).every((c) => c >= "0" && c <= "9");
/** A link is used only when it has exactly the shape the server builds: tel:+91 or wa.me/91 plus ten digits. */
export function safeHref(kind: "tel" | "whatsapp", href: unknown): string | null {
  if (typeof href !== "string") return null;
  const prefix = kind === "tel" ? "tel:+91" : "https://wa.me/91";
  return href.startsWith(prefix) && href.length === prefix.length + 10 && isDigits(href.slice(prefix.length)) ? href : null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Wed 14 Oct" from an ISO day; a dash when missing or unreadable. */
export function driveDayText(iso: unknown): string {
  const d = new Date(`${typeof iso === "string" ? iso.slice(0, 10) : ""}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "–" : `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export interface ActionRowView {
  id: string; ref: string; leadId: string | null; name: string; mobile: string; reason: string; waiting: string; requisition: string; branch: string; drive: string; recruiter: string;
}
export function rowView(i: ActionItem): ActionRowView {
  return {
    id: i.id, ref: i.ref, leadId: i.leadId || null, name: orDash(i.name), mobile: orDash(i.mobileMasked), reason: orDash(i.reason),
    waiting: `waiting ${orDash(i.ageText)}`, requisition: orDash(i.requisitionCode), branch: orDash(i.branch), drive: driveDayText(i.driveDate), recruiter: recruiterText(i.recruiter),
  };
}

export const actionTitle = (n: number): string => `Act now (${n})`;
export const chipLabel = (n: number): string => `${n} ${n === 1 ? "person" : "people"}`;

/** The queue when it is usable: null when not loaded or switched off (the panel renders nothing). */
export function usableQueue(q: unknown): ActionQueue | null {
  const d = q as Partial<ActionQueue> | null | undefined;
  if (!d || typeof d !== "object" || d.enabled !== true) return null;
  return { ...(d as ActionQueue), items: Array.isArray(d.items) ? d.items.filter((i): i is ActionItem => !!i && typeof i === "object") : [], failedSections: Array.isArray(d.failedSections) ? d.failedSections : [] };
}
