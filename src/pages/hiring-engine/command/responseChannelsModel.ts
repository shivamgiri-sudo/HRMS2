/**
 * Pure view-model of "Answers by channel" in the Drive Command Center: the funnel's Confirmed split by the channel that confirmed
 * (email incl. the email buttons, WhatsApp, voice bot incl. the calling file, HR by hand, and "before tracking" for confirmations older
 * than the stamp) and the response rate per channel and drive type (people who answered of people contacted on that channel). Rates need
 * MIN_SAMPLE contacted people; below that the counts are shown without a percentage. The table and the Confirmed cell line come from the
 * same adapter. No DOM.
 */
import type { DriveAnalytics, SourceType } from "./driveCommandTypes";
import { SOURCE_TYPES, TYPE_LABEL, countText } from "./driveCommandModel";
import { MIN_SAMPLE } from "./charts/journeyModel";

export type SplitKey = "email" | "whatsapp" | "voice" | "manual" | "unknown";
export const SPLIT_KEYS: readonly SplitKey[] = ["email", "whatsapp", "voice", "manual", "unknown"];
export const SPLIT_LABEL: Record<SplitKey, string> = { email: "Email", whatsapp: "WhatsApp", voice: "Voice bot", manual: "HR by hand", unknown: "Before tracking" };
const VIA_TO_SPLIT: Record<string, SplitKey> = { email: "email", web: "email", whatsapp: "whatsapp", voice_bot: "voice", call_file: "voice", hr: "manual", unknown: "unknown" };
export const RATE_KEYS = ["email", "whatsapp", "voice_bot"] as const;
export const RATE_LABEL: Record<(typeof RATE_KEYS)[number], string> = { email: "Email", whatsapp: "WhatsApp", voice_bot: "Voice bot" };

const fin = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export interface ConfirmedSplit { parts: Array<{ key: SplitKey; label: string; n: number }>; total: number; text: string }
/** Null when the server did not send the split (older server or a failed read): the cell shows nothing extra, never zeros. */
export function confirmedSplit(a: DriveAnalytics | null | undefined, type: SourceType): ConfirmedSplit | null {
  const by = a?.confirmedByChannel?.[type];
  if (!by) return null;
  const sums: Record<SplitKey, number> = { email: 0, whatsapp: 0, voice: 0, manual: 0, unknown: 0 };
  for (const [via, n] of Object.entries(by)) sums[VIA_TO_SPLIT[via] ?? "unknown"] += fin(n);
  const parts = SPLIT_KEYS.map((key) => ({ key, label: SPLIT_LABEL[key], n: sums[key] }));
  const total = parts.reduce((x, p) => x + p.n, 0);
  return { parts, total, text: total ? parts.filter((p) => p.n > 0).map((p) => `${p.label} ${countText(p.n)}`).join(" · ") : "No confirmations" };
}

export interface RateCell { contacted: number; responded: number; text: string; rate: number | null }
export function rateCell(contacted: number, responded: number): RateCell {
  const c = fin(contacted), r = Math.min(fin(responded), fin(contacted));
  const rate = c >= MIN_SAMPLE ? r / c : null;
  return { contacted: c, responded: r, rate, text: c === 0 ? "none contacted" : `${countText(r)} of ${countText(c)}${rate == null ? "" : ` (${Math.round(rate * 100)}%)`}` };
}

export interface ChannelTable { types: SourceType[]; caption: string; confirmed: Array<{ label: string; cells: string[] }>; rates: Array<{ label: string; cells: RateCell[] }>; small: boolean }
/** Both tables for the given types (all three on the Summary, one inside a drive section); null when the server sent neither field. */
export function channelTable(a: DriveAnalytics | null | undefined, only?: SourceType): ChannelTable | null {
  if (!a?.confirmedByChannel && !a?.responseRate) return null;
  const types = only ? [only] : [...SOURCE_TYPES];
  const splits = types.map((t) => confirmedSplit(a, t));
  const confirmed = SPLIT_KEYS.map((k) => ({ label: SPLIT_LABEL[k], cells: splits.map((s) => (s ? countText(s.parts.find((p) => p.key === k)?.n ?? 0) : "n/a")) }));
  const rates = RATE_KEYS.map((k) => ({ label: RATE_LABEL[k], cells: types.map((t) => { const x = a?.responseRate?.[t]?.[k]; return rateCell(x?.contacted ?? 0, x?.responded ?? 0); }) }));
  const small = rates.some((r) => r.cells.some((c) => c.contacted > 0 && c.rate == null));
  return { types, confirmed, rates, small, caption: `Confirmed by channel and response rate per channel${only ? ` for ${TYPE_LABEL[only]}` : " for each drive type"}` };
}
