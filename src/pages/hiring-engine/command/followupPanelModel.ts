/**
 * Pure model of the follow-up pipeline panel: grouping, labels, retry eligibility, error mapping, scrubbing of server text.
 * Endpoints: backend/src/modules/hiring-engine/he.routes.ts (summary, attention, retry, mark-called) and he-command.routes.ts (status).
 * No I/O, no React, no regex literals (Tailwind scans source text).
 */
import { TYPE_LABEL, SOURCE_TYPES, istTodayClient } from "./driveCommandModel";
import type { AttentionChannel, AttentionGroup, AttentionRow, FollowupMode, FollowupStatus, RequisitionSources, SourceCounts, SourceType } from "./driveCommandTypes";

export const SUMMARY_PATH = "/api/he/qualified-followup/summary";
export const ATTENTION_PATH = "/api/he/qualified-followup/attention";
export const retryPath = (id: string): string => `/api/he/qualified-followup/${encodeURIComponent(id)}/retry`;
export const markCalledPath = (id: string): string => `/api/he/qualified-followup/${encodeURIComponent(id)}/mark-called`;
export const sourcesPath = (requisitionId: string): string => `/api/he/requisition-sources?requisitionId=${encodeURIComponent(requisitionId)}`;

export const DASH = "–";
export const OFF_SENTENCE = "The follow-up pipeline is off: nothing is sent automatically";
export type SummaryRow = { sourceType: SourceType; total: number; stopped: number; open: number };

// ---- scrubbing (defence in depth: the server already scrubs) ---------------------------------------------------------------------------------
const MAX_TEXT = 120;
const isDigit = (c: string): boolean => c >= "0" && c <= "9";

function scrubEmails(s: string): string {
  return s.split(" ").map((tok) => {
    const at = tok.indexOf("@");
    return at > 0 && at < tok.length - 1 ? "[email]" : tok;
  }).join(" ");
}
/** A WhatsApp error code (13xxxx, six digits) is the cause label of an attention group, not personal data: it is kept. */
const isMetaCode = (run: string): boolean => run.length === 6 && run.startsWith("13");
function scrubDigitRuns(s: string): string {
  const keep = (run: string): string => (run.length >= 6 && !isMetaCode(run) ? "#" : run);
  let out = "";
  let run = "";
  for (const c of s) {
    if (isDigit(c)) { run += c; continue; }
    out += keep(run);
    run = "";
    out += c;
  }
  return out + keep(run);
}
/** Server text made safe for display: whitespace folded, e-mail addresses and digit runs of 6 or more hidden (except six-digit 13xxxx WhatsApp error codes), cut to 120 characters. */
export function scrubText(v: unknown): string {
  if (v == null) return "";
  const flat = String(v).split("\n").join(" ").split("\r").join(" ").split("\t").join(" ");
  const clean = scrubDigitRuns(scrubEmails(flat)).trim();
  const chars = Array.from(clean);
  return chars.length > MAX_TEXT ? `${chars.slice(0, MAX_TEXT - 1).join("")}…` : clean;
}
export const orDash = (v: unknown): string => { const t = scrubText(v); return t === "" ? DASH : t; };

/** Show only what the API returned; a bare 7+ digit number (a server that forgot to mask) is cut to its last four. */
export function maskedMobile(v: unknown): string {
  const t = typeof v === "string" ? v.trim() : "";
  if (t === "") return DASH;
  let digits = 0;
  for (const c of t) if (isDigit(c)) digits += 1;
  if (digits >= 7 && digits === t.length) return `xxxxxx${t.slice(-4)}`;
  return scrubText(t);
}

// ---- mode and report -------------------------------------------------------------------------------------------------------------------------
export function modeText(m: FollowupMode): string {
  if (m === "live") return "Live: messages are being sent";
  if (m === "dry_run") return "Dry run: rows are enrolled and logged, nothing is sent";
  return "Off: nothing is enrolled";
}
/** Off when any answer says so (the follow-up mode or the analytics flag); null modes are unknown, not off. */
export function isFollowupOff(modes: ReadonlyArray<FollowupMode | null | undefined>, qualifiedTracked?: boolean | null): boolean {
  return qualifiedTracked === false || modes.some((m) => m === "off");
}

export function reportText(s: FollowupStatus["report"] | null | undefined, today: string = istTodayClient()): string {
  if (!s) return DASH;
  if (!s.last) return s.running ? "No report since the last restart (outcome unknown since restart)" : "Not running in this process (mode off)";
  const slot = typeof s.last.slot === "string" ? s.last.slot : "";
  const day = slot.slice(0, 10);
  const time = slot.slice(11) || DASH;
  const isToday = day === today;
  const tries = Number.isFinite(s.last.tries) ? s.last.tries : 0;
  const noun = tries === 1 ? "try" : "tries";
  if (s.last.ok) return isToday ? `Today's ${time} report sent` : `The ${time} report of ${day || DASH} sent`;
  return isToday ? `Report failed after ${tries} ${noun}` : `The ${time} report of ${day || DASH} failed after ${tries} ${noun}`;
}

// ---- call files ------------------------------------------------------------------------------------------------------------------------------
const IST_FMT = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : null;
export function formatWhen(iso: unknown): string {
  if (typeof iso !== "string" || iso === "") return DASH;
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || !IST_FMT) return DASH;
  return `${IST_FMT.format(new Date(t))} IST`;
}
export function callFileRows(s: FollowupStatus | null | undefined): Array<{ id: string; when: string; rows: string; status: string; error: string }> {
  const list = Array.isArray(s?.callFiles) ? s!.callFiles.slice(0, 10) : [];
  return list.map((f, i) => ({
    id: typeof f?.id === "string" && f.id ? f.id : `file-${i}`,
    when: formatWhen(f?.createdAt),
    rows: typeof f?.rows === "number" && Number.isFinite(f.rows) ? String(f.rows) : DASH,
    status: orDash(f?.status),
    error: orDash(f?.error),
  }));
}

// ---- funnel ----------------------------------------------------------------------------------------------------------------------------------
export const SOURCE_COLUMNS: ReadonlyArray<{ key: keyof SourceCounts; label: string }> = [
  { key: "qualified", label: "Qualified" }, { key: "emailed", label: "Emailed" }, { key: "whatsapped", label: "WhatsApp" }, { key: "replied", label: "Replied" },
  { key: "confirmed", label: "Confirmed" }, { key: "called", label: "Called" }, { key: "arrived", label: "Arrived" }, { key: "selected", label: "Selected" }, { key: "joined", label: "Joined" },
];
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** One row per source type: the follow-up counts (total, open, stopped) and, when a requisition is filtered, its sources numbers summed per type. */
export function sourceFunnelRows(src: RequisitionSources | null, summary: ReadonlyArray<SummaryRow>): Array<{ sourceType: SourceType; label: string; cells: Record<string, number> }> {
  const out: Array<{ sourceType: SourceType; label: string; cells: Record<string, number> }> = [];
  for (const t of SOURCE_TYPES) {
    const s = summary.find((x) => x?.sourceType === t);
    const rows = (src?.rows ?? []).filter((r) => r.sourceType === t);
    if (!s && rows.length === 0) continue;
    const cells: Record<string, number> = { total: num(s?.total), open: num(s?.open), stopped: num(s?.stopped) };
    if (src) for (const c of SOURCE_COLUMNS) cells[c.key] = rows.reduce((a, r) => a + num(r[c.key]), 0);
    out.push({ sourceType: t, label: TYPE_LABEL[t], cells });
  }
  return out;
}

// ---- attention -------------------------------------------------------------------------------------------------------------------------------
export const CHANNEL_LABEL: Record<AttentionChannel, string> = { email: "E-mail", whatsapp: "WhatsApp", call: "Call" };
export const OUTCOME_UNKNOWN_LABEL = "Outcome unknown: a message may already have gone out";
export const ALREADY_SENT_LABEL = "Already sent: the message went out before the failure";

export function showRetry(r: Pick<AttentionRow, "retryable" | "outcomeUnknown">): boolean {
  return r.retryable === true && r.outcomeUnknown !== true;
}
export function retryHint(r: Pick<AttentionRow, "retryReason">): string | null {
  switch (r.retryReason) {
    case "outcome_unknown": return "The send may already have happened; check before acting";
    case "already_sent": return "Already sent";
    case "already_in_file": return "Already in a calling file";
    default: return null;
  }
}
/** A label in words for rows whose state is easy to misread; null for an ordinary failed row. */
export function stateLabel(r: Pick<AttentionRow, "outcomeUnknown" | "retryReason">): string | null {
  if (r.outcomeUnknown || r.retryReason === "outcome_unknown") return OUTCOME_UNKNOWN_LABEL;
  if (r.retryReason === "already_sent") return ALREADY_SENT_LABEL;
  return null;
}
export const showMarkCalled = (channel: AttentionChannel): boolean => channel === "call";

const REFUSALS: readonly string[] = ["not_retryable", "stopped", "already_sent", "outcome_unknown"];
/** 403 -> admin only; 409 -> the server's reason in words; anything else a generic line (never the raw error text). */
export function retryErrorText(e: unknown): string {
  const o = (e && typeof e === "object" ? e : {}) as { status?: unknown; message?: unknown };
  if (o.status === 403) return "Only an admin can retry";
  if (o.status === 409) {
    const m = typeof o.message === "string" ? o.message.trim() : "";
    if (REFUSALS.includes(m)) return m.split("_").join(" ");
  }
  return "Retry failed";
}
export function markCalledErrorText(e: unknown): string {
  const status = (e as { status?: unknown } | null)?.status;
  return status === 403 ? "You do not have permission to mark this as called" : "Could not mark as called";
}

export interface AttentionView {
  key: string; channel: AttentionChannel; channelLabel: string; cause: string; count: number; shown: number;
  rows: Array<{
    id: string; name: string; mobile: string; error: string; attempts: string; updated: string; source: string;
    retry: boolean; markCalled: boolean; hint: string | null; label: string | null;
  }>;
}
export function attentionView(groups: unknown): AttentionView[] {
  if (!Array.isArray(groups)) return [];
  const out: AttentionView[] = [];
  (groups as AttentionGroup[]).forEach((g, gi) => {
    if (!g || !Array.isArray(g.rows)) return;
    const channel: AttentionChannel = g.channel === "email" || g.channel === "whatsapp" || g.channel === "call" ? g.channel : "email";
    const rows = g.rows.filter((r) => r && typeof r.id === "string" && r.id !== "").map((r) => ({
      id: r.id, name: orDash(r.name), mobile: maskedMobile(r.mobileMasked), error: orDash(r.error),
      attempts: typeof r.attempts === "number" && Number.isFinite(r.attempts) ? String(r.attempts) : DASH,
      updated: formatWhen(r.updatedAt), source: TYPE_LABEL[r.sourceType] ?? DASH,
      retry: showRetry(r), markCalled: showMarkCalled(channel), hint: retryHint(r), label: stateLabel(r),
    }));
    const count = typeof g.count === "number" && Number.isFinite(g.count) ? Math.max(0, g.count) : rows.length;
    out.push({ key: `${channel}:${gi}`, channel, channelLabel: CHANNEL_LABEL[channel], cause: orDash(g.cause), count, shown: rows.length, rows });
  });
  return out;
}
export const attentionTotal = (v: readonly AttentionView[]): number => v.reduce((a, g) => a + g.count, 0);
