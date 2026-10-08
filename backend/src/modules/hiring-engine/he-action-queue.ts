/**
 * Recruiter action queue (pure). Turns facts read by the service into one ranked, de-duplicated list: one item per person (the most
 * urgent kind), masked mobiles only. Nothing here sends or assigns; the full number leaves the server only through the contact route.
 */
import { maskMobile } from "./qualified-followup.rules.js";

export type ActionKind = "replied_not_confirmed" | "confirmed_no_reminder" | "no_show_recovery" | "wa_failed" | "high_score_not_reached";

export const ACTION_KINDS: readonly ActionKind[] = ["replied_not_confirmed", "confirmed_no_reminder", "no_show_recovery", "wa_failed", "high_score_not_reached"];
export const ACTION_PRIORITY: Record<ActionKind, number> = { replied_not_confirmed: 1, confirmed_no_reminder: 2, no_show_recovery: 3, wa_failed: 4, high_score_not_reached: 5 };
export const ACTION_LIMITS = { lookAheadDays: 3, replyWindowHours: 72, highScore: 75, cap: 100 } as const;

export interface ActionFact {
  kind: ActionKind;
  ref: { type: "match" | "followup"; id: string };
  leadId: string | null;
  mobile10: string;
  name: string | null;
  requisitionId: string;
  requisitionCode: string;
  branch: string;
  driveDate: string | null;
  /** IST wall clock, "YYYY-MM-DD HH:MM:SS". */
  eventAt: string;
  score: number | null;
  assignedRecruiter: string | null;
}

export interface ActionItem {
  id: string;
  kind: ActionKind;
  reason: string;
  ageMinutes: number;
  ageText: string;
  suggested: "call" | "whatsapp";
  ref: string;
  leadId: string | null;
  name: string;
  mobileMasked: string;
  requisitionId: string;
  requisitionCode: string;
  branch: string;
  driveDate: string | null;
  recruiter: { name: string | null; basis: "assigned" | "suggested" | "none" };
}

export interface RecruiterCandidate { name: string; presentToday: boolean; activeQueue: number }

/** The ATS rule (present today first, then the lightest active queue, then name), read-only. */
export function pickRecruiter(pool: RecruiterCandidate[]): string | null {
  if (!pool.length) return null;
  return [...pool].sort((a, b) => Number(b.presentToday) - Number(a.presentToday) || a.activeQueue - b.activeQueue || a.name.localeCompare(b.name))[0].name;
}

export function ageText(minutes: number): string {
  const m = Math.max(0, Math.floor(Number.isFinite(minutes) ? minutes : 0));
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h`;
  const d = Math.floor(m / 1440);
  return d === 1 ? "1 day" : `${d} days`;
}

export function contactHref(kind: "tel" | "whatsapp", mobile10: string): string | null {
  if (!/^[6-9]\d{9}$/.test(mobile10)) return null;
  return kind === "tel" ? `tel:+91${mobile10}` : `https://wa.me/91${mobile10}`;
}

const REF_ID = /^[0-9a-f-]{36}$/i;
export function parseRef(ref: unknown): { type: "match" | "followup"; id: string } | null {
  if (typeof ref !== "string") return null;
  const i = ref.indexOf(":");
  if (i < 0) return null;
  const type = ref.slice(0, i), id = ref.slice(i + 1);
  return (type === "match" || type === "followup") && REF_ID.test(id) ? { type, id } : null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Wed 14 Oct" from an ISO day. */
function dayLabel(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function reasonOf(f: ActionFact): string {
  const day = dayLabel(f.driveDate);
  switch (f.kind) {
    case "replied_not_confirmed": return "Replied but has not confirmed the slot";
    case "confirmed_no_reminder": return day ? `Confirmed for ${day} but no reminder went out` : "Confirmed but no reminder went out";
    case "no_show_recovery": return day ? `Did not come on ${day}: call to offer a new slot` : "Did not come: call to offer a new slot";
    case "wa_failed": return "WhatsApp failed: call instead";
    case "high_score_not_reached": return `Strong match (score ${f.score ?? 0}) not reached yet`;
  }
}

const wall = (s: string): number => Date.parse(`${s.slice(0, 19).replace(" ", "T")}Z`);

export function rankActions(
  facts: ActionFact[], nowIst: string, suggestedFor: (branch: string) => string | null, cap: number = ACTION_LIMITS.cap,
): { items: ActionItem[]; truncated: boolean } {
  const best = new Map<string, ActionFact>();
  for (const f of facts) {
    const cur = best.get(f.mobile10);
    if (!cur || ACTION_PRIORITY[f.kind] < ACTION_PRIORITY[cur.kind] || (f.kind === cur.kind && f.eventAt < cur.eventAt)) best.set(f.mobile10, f);
  }
  const now = wall(nowIst);
  const items: ActionItem[] = [...best.values()].map((f) => {
    const t = wall(f.eventAt);
    const ageMinutes = Number.isFinite(t) && Number.isFinite(now) ? Math.max(0, Math.floor((now - t) / 60_000)) : 0;
    const suggestedName = f.assignedRecruiter ? null : suggestedFor(f.branch);
    return {
      id: `${f.kind}:${f.ref.type}:${f.ref.id}`,
      kind: f.kind,
      reason: reasonOf(f),
      ageMinutes,
      ageText: ageText(ageMinutes),
      suggested: f.kind === "replied_not_confirmed" ? "whatsapp" : "call",
      ref: `${f.ref.type}:${f.ref.id}`,
      leadId: f.leadId,
      name: f.name?.trim() || "Candidate",
      mobileMasked: maskMobile(f.mobile10),
      requisitionId: f.requisitionId,
      requisitionCode: f.requisitionCode,
      branch: f.branch,
      driveDate: f.driveDate,
      recruiter: f.assignedRecruiter ? { name: f.assignedRecruiter, basis: "assigned" } : suggestedName ? { name: suggestedName, basis: "suggested" } : { name: null, basis: "none" },
    };
  });
  items.sort((a, b) =>
    ACTION_PRIORITY[a.kind] - ACTION_PRIORITY[b.kind]
    || (a.driveDate === b.driveDate ? 0 : a.driveDate === null ? 1 : b.driveDate === null ? -1 : a.driveDate < b.driveDate ? -1 : 1)
    || b.ageMinutes - a.ageMinutes
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { items: items.slice(0, cap), truncated: items.length > cap };
}
