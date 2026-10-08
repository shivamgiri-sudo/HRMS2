import { attributeSource } from "./he-source-attribution.js";
import type { FollowupMode, SourceType } from "./qualified-followup.types.js";

export const FOLLOWUP_GAP_MIN = 60;
const IST_MS = 5.5 * 3600_000;
const DAY_MS = 86_400_000;
const OPEN_HOUR = 9;
const CLOSE_HOUR = 20;

/** The shared source rule (he-source-attribution.ts) on what a follow-up row knows at enqueue: the drive kind or the campaign status. */
export function classifySource(i: { launchSourceKind?: "pool" | "meta" | "campaign" | "batch" | null; campaignStatus?: string | null }): SourceType {
  return attributeSource({ driveSourceKind: i.launchSourceKind ?? null, campaignStatus: i.campaignStatus ?? null });
}

export function normaliseMobile10(raw: string | null | undefined): string | null {
  const m = String(raw ?? "").replace(/\D/g, "").slice(-10);
  return /^[6-9][0-9]{9}$/.test(m) ? m : null;
}

export function followupMode(env: NodeJS.ProcessEnv = process.env): FollowupMode {
  const v = String(env.QUAL_FOLLOWUP_MODE ?? "").trim().toLowerCase();
  return v === "dry_run" || v === "live" ? v : "off";
}

export function istHour(d: Date): number {
  return new Date(d.getTime() + IST_MS).getUTCHours();
}

export function withinSendWindow(now: Date): boolean {
  const h = istHour(now);
  return h >= OPEN_HOUR && h < CLOSE_HOUR;
}

function istMidnight(d: Date): number {
  return Math.floor((d.getTime() + IST_MS) / DAY_MS) * DAY_MS - IST_MS;
}

/** Next 09:00 IST at or after now. */
export function nextWindowOpen(now: Date): Date {
  const day = istMidnight(now);
  const open = day + OPEN_HOUR * 3600_000;
  return new Date(now.getTime() < open ? open : open + DAY_MS);
}

export function holdToWindow(t: Date): Date {
  return withinSendWindow(t) ? t : nextWindowOpen(t);
}

export function dueTimes(a: { qualifiedAt: Date; hasEmail: boolean; gapMin?: number }): { emailDueAt: Date | null; waDueAt: Date } {
  const gap = a.gapMin ?? FOLLOWUP_GAP_MIN;
  const base = a.hasEmail ? new Date(a.qualifiedAt.getTime() + gap * 60_000) : a.qualifiedAt;
  return { emailDueAt: a.hasEmail ? a.qualifiedAt : null, waDueAt: holdToWindow(base) };
}
