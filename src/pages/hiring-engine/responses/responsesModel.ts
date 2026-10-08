/**
 * Pure view-model of the Responses tab: response shapes (mirrors of backend response-read.service.ts), labels shown as icon + word,
 * filters <-> URL hash ("#responses?channel=whatsapp&..."), API paths, per-channel counts, the review queue's ages and buttons, and who may
 * write (the Hiring Engine's write roles; a view-only role such as ceo sees no write button, and the server refuses it too). No DOM.
 */
import type { SourceType } from "../command/driveCommandTypes";

export type ResponseChannel = "email" | "whatsapp" | "voice_bot" | "call_file" | "hr" | "web";
export type ResponseMode = "button" | "text" | "call" | "manual";
export type ResponseAnswer = "confirm" | "decline" | "reschedule" | "question" | "unsubscribe" | "no_answer" | "on_my_way" | "wrong_person" | "other";
export type ResponseStatus = "applied" | "needs_review" | "ignored" | "duplicate" | "recorded";

// backend/src/modules/hiring-engine/response-read.service.ts
export interface ResponseRow {
  id: number; occurredAt: string; channel: ResponseChannel; mode: ResponseMode; answer: ResponseAnswer; status: ResponseStatus;
  suggested: ResponseAnswer | null; confidence: number | null; person: { name: string; mobileMasked: string };
  leadId: string | null; matchId: string | null; requisitionId: string | null; requisitionCode: string | null; campaignName: string | null;
  driveType: SourceType | null; driveId: string | null; driveDate: string | null; slotAt: string | null; handledBy: "system" | "hr"; handledAt: string | null;
  conflict: boolean; dedupeOf: number | null; textPreview: string;
}
export interface ResponseList { rows: ResponseRow[]; nextCursor: string | null }
export interface QueueCounts { total: number; under1h: number; h1to4: number; h4to24: number; over24h: number }
export interface ResponseQueueData { rows: ResponseRow[]; counts: QueueCounts; oldestAt: string | null }
export type RateChannel = "email" | "whatsapp" | "voice_bot";
export interface Rate { contacted: number; responded: number; rate: number | null }
export interface ResponseSummary {
  byChannel: Record<ResponseChannel, { responses: number; confirms: number; people: number }>;
  rateByChannel: Record<RateChannel, Rate>;
  rateByType: Record<SourceType, Record<RateChannel, Rate>>;
  byDrive: Array<{ driveId: string; driveDate: string | null; branch: string | null; requisitionCode: string | null; responses: number; confirms: number }>;
}

export const CHANNELS: readonly ResponseChannel[] = ["email", "web", "whatsapp", "voice_bot", "call_file", "hr"];
export const CHANNEL_LABEL: Record<ResponseChannel, string> = {
  email: "Email reply", web: "Email button", whatsapp: "WhatsApp", voice_bot: "Voice bot", call_file: "Calling file", hr: "HR (by hand)",
};
export const ANSWERS: readonly ResponseAnswer[] = ["confirm", "decline", "reschedule", "question", "unsubscribe", "no_answer", "on_my_way", "wrong_person", "other"];
export const ANSWER_LABEL: Record<ResponseAnswer, string> = {
  confirm: "Will come", decline: "Cannot come", reschedule: "Another time", question: "Question", unsubscribe: "Stop messages",
  no_answer: "No answer", on_my_way: "On the way", wrong_person: "Wrong person", other: "Other",
};
export type Tone = "good" | "bad" | "warn" | "neutral";
export const ANSWER_TONE: Record<ResponseAnswer, Tone> = {
  confirm: "good", on_my_way: "good", decline: "bad", unsubscribe: "bad", wrong_person: "bad", reschedule: "warn", question: "warn", no_answer: "neutral", other: "neutral",
};
export const STATUSES: readonly ResponseStatus[] = ["needs_review", "applied", "recorded", "ignored", "duplicate"];
export const STATUS_LABEL: Record<ResponseStatus, string> = { applied: "Applied", needs_review: "Needs review", ignored: "Ignored", duplicate: "Duplicate", recorded: "Recorded" };
export const TYPE_OPTIONS: ReadonlyArray<{ id: SourceType; label: string }> = [{ id: "meta_live", label: "Live Meta" }, { id: "meta_old", label: "Old Meta data" }, { id: "he", label: "Hiring Engine" }];
/** Tone classes (text + background); the word and the icon always carry the meaning too. */
export const TONE_CLASS: Record<Tone, string> = {
  good: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
  bad: "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-800",
  warn: "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800",
  neutral: "bg-slate-50 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600",
};

/** The Hiring Engine's write roles (backend he.routes.ts WRITE_ROLES). */
const WRITE_ROLES = ["super_admin", "admin", "hr", "hr_admin", "recruitment_hr"];
export function canWriteHe(roleKeys: readonly string[] | null | undefined): boolean {
  return (roleKeys ?? []).some((r) => WRITE_ROLES.includes(r));
}

// ---- filters ----------------------------------------------------------------------------------------------------------------------------
export interface ResponseFilters {
  from: string; to: string; campaignId: string; requisitionId: string; driveId: string; driveType: SourceType | ""; channel: ResponseChannel | "";
  answer: ResponseAnswer | ""; status: ResponseStatus | ""; q: string;
}
const DAY = 86_400_000;
export const istToday = (now: Date = new Date()): string => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const isDay = (x: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(x) && new Date(Date.parse(`${x}T00:00:00Z`)).toISOString().slice(0, 10) === x;
const isId = (x: string): boolean => /^[0-9a-f-]{36}$/i.test(x);

export function defaultResponseFilters(now: Date = new Date()): ResponseFilters {
  const to = istToday(now);
  return { from: addDays(to, -6), to, campaignId: "", requisitionId: "", driveId: "", driveType: "", channel: "", answer: "", status: "", q: "" };
}
const FILTER_KEYS: ReadonlyArray<keyof ResponseFilters> = ["from", "to", "campaignId", "requisitionId", "driveId", "driveType", "channel", "answer", "status", "q"];

/** Filters from "#responses?..." (unknown or malformed values fall back to the defaults). */
export function parseResponsesHash(hash: string, now: Date = new Date()): ResponseFilters {
  const f = defaultResponseFilters(now);
  const i = typeof hash === "string" ? hash.indexOf("?") : -1;
  if (i < 0) return f;
  const p = new URLSearchParams(hash.slice(i + 1));
  const get = (k: string) => (p.get(k) ?? "").trim();
  if (isDay(get("from"))) f.from = get("from");
  if (isDay(get("to"))) f.to = get("to");
  if (f.from > f.to) { const d = defaultResponseFilters(now); f.from = d.from; f.to = d.to; }
  for (const k of ["campaignId", "requisitionId", "driveId"] as const) if (isId(get(k))) f[k] = get(k);
  if (TYPE_OPTIONS.some((t) => t.id === get("driveType"))) f.driveType = get("driveType") as SourceType;
  if ((CHANNELS as readonly string[]).includes(get("channel"))) f.channel = get("channel") as ResponseChannel;
  if ((ANSWERS as readonly string[]).includes(get("answer"))) f.answer = get("answer") as ResponseAnswer;
  if ((STATUSES as readonly string[]).includes(get("status"))) f.status = get("status") as ResponseStatus;
  const q = get("q").replace(/\D/g, "");
  if (q.length >= 10) f.q = q.slice(-10);
  return f;
}
/** The query string of the set filters (dates always), in a fixed order. */
export function filtersQuery(f: ResponseFilters): string {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) if (f[k]) p.set(k, String(f[k]));
  return p.toString();
}
export const responsesHash = (f: ResponseFilters): string => `#responses?${filtersQuery(f)}`;
export const listPath = (f: ResponseFilters, cursor?: string | null): string => `/api/he/responses?${filtersQuery(f)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}&limit=50`;
export const summaryPath = (f: ResponseFilters): string => `/api/he/responses/summary?${filtersQuery(f)}`;
export const QUEUE_PATH = "/api/he/responses/queue";
export const activeFilterCount = (f: ResponseFilters): number => (["campaignId", "requisitionId", "driveId", "driveType", "channel", "answer", "status", "q"] as const).filter((k) => !!f[k]).length;

// ---- display ----------------------------------------------------------------------------------------------------------------------------
/** A number that arrives unmasked is masked here too. */
export const masked = (m: string | null | undefined): string => {
  const d = String(m ?? "").replace(/\D/g, "");
  return /x/i.test(String(m ?? "")) ? String(m) : d.length >= 4 ? `xxxxxx${d.slice(-4)}` : "xxxxxx";
};
/** "2026-10-08 14:05:00" -> "8 Oct, 14:05". */
export function whenText(at: string | null | undefined): string {
  if (!at || !/^\d{4}-\d{2}-\d{2}/.test(at)) return "–";
  const [y, m, d] = at.slice(0, 10).split("-").map(Number);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] ?? "";
  const hhmm = at.length >= 16 ? `, ${at.slice(11, 16)}` : "";
  return `${d} ${mon}${y && hhmm ? hhmm : ""}`;
}
/** Age of an IST wall-clock time: "40 min", "3 h", "2 days". */
export function ageText(at: string | null | undefined, nowMs: number = Date.now()): string {
  if (!at) return "–";
  const t = Date.parse(`${at.replace(" ", "T")}+05:30`);
  if (!Number.isFinite(t) || t > nowMs + 60_000) return "–";
  const min = Math.floor((nowMs - t) / 60_000);
  return min < 60 ? `${Math.max(min, 0)} min` : min < 48 * 60 ? `${Math.floor(min / 60)} h` : `${Math.floor(min / 1440)} days`;
}
export const confidenceText = (c: number | null): string => (c == null || !Number.isFinite(c) ? "" : `${Math.round(c * 100)}% sure`);

export interface ChannelCount { channel: ResponseChannel; label: string; responses: number; confirms: number; people: number }
/** Per-channel counts in a fixed order; zero channels stay (an honest zero, not a gap). */
export function channelCounts(s: ResponseSummary | null | undefined): ChannelCount[] {
  return CHANNELS.map((c) => ({ channel: c, label: CHANNEL_LABEL[c], ...(s?.byChannel?.[c] ?? { responses: 0, confirms: 0, people: 0 }) }));
}
export const pct = (r: number | null): string => (r == null || !Number.isFinite(r) ? "–" : `${Math.round(r * 100)}%`);

// ---- review queue ------------------------------------------------------------------------------------------------------------------------
export type QueueAction = { answer: ResponseAnswer; apply: boolean; label: string } | { ignore: true; label: string };
/** One-click classes for a reply in the queue (Question records it without changing the booking). */
export const QUEUE_ACTIONS: readonly QueueAction[] = [
  { answer: "confirm", apply: true, label: "Will come" }, { answer: "decline", apply: true, label: "Cannot come" },
  { answer: "reschedule", apply: true, label: "Another time" }, { answer: "question", apply: false, label: "Question (no change)" }, { ignore: true, label: "Ignore" },
];
/** A Confirm that books a slot (no booking yet for this reply) asks first. */
export function confirmPrompt(row: Pick<ResponseRow, "matchId" | "person" | "slotAt">, a: QueueAction): string | null {
  if (!("answer" in a) || a.answer !== "confirm" || !a.apply) return null;
  return row.matchId ? null : `This books a walk-in slot for ${row.person.name}${row.slotAt ? ` (asked for ${whenText(row.slotAt)})` : ""}. Continue?`;
}
export const queueBuckets = (c: QueueCounts | null | undefined): Array<{ label: string; n: number }> => [
  { label: "under 1 h", n: c?.under1h ?? 0 }, { label: "1 to 4 h", n: c?.h1to4 ?? 0 }, { label: "4 to 24 h", n: c?.h4to24 ?? 0 }, { label: "over 24 h", n: c?.over24h ?? 0 },
];
/** Removes a row optimistically; the returned function puts it back at its place (on a 409 or any failure). */
export function withoutRow<T extends { id: number }>(rows: T[], id: number): { rows: T[]; restore: (cur: T[]) => T[] } {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return { rows, restore: (cur) => cur };
  const row = rows[i];
  return { rows: rows.filter((r) => r.id !== id), restore: (cur) => (cur.some((r) => r.id === id) ? cur : [...cur.slice(0, i), row, ...cur.slice(i)]) };
}
export function actionError(e: unknown): string {
  const err = (e ?? {}) as { status?: unknown; message?: unknown };
  if (err.status === 409) return "Someone else already handled this reply; the list was refreshed.";
  if (err.status === 403) return "You can view replies but not change them.";
  return typeof err.message === "string" && err.message ? err.message : "Could not save. Please try again.";
}
