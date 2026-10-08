import { inSendWindow, nextSendWindowOpen } from "./followup-guards.js";
import type { FollowupMode, SourceType } from "./qualified-followup.types.js";

export const FOLLOWUP_GAP_MIN = 60;
const IST_MS = 5.5 * 3600_000;

/** The follow-up pipeline's own type at enqueue (decides templates): unchanged on purpose. The Command Center displays people by the
 *  person rule of he-source-attribution.ts instead (which, unlike this, never calls a non-Meta upload batch Meta). */
export function classifySource(i: { launchSourceKind?: "pool" | "meta" | "campaign" | "batch" | null; campaignStatus?: string | null }): SourceType {
  if (i.launchSourceKind === "pool") return "he";
  if (i.launchSourceKind) return "meta_old";
  if (i.campaignStatus === "active" || i.campaignStatus === "draft") return "meta_live";
  return "he";
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

/** Mon-Sat 09:00 to under 20:00 IST (D3; one rule with the guard chain). */
export function withinSendWindow(now: Date): boolean {
  return inSendWindow(now);
}

/** Next Mon-Sat 09:00 IST at or after now. */
export function nextWindowOpen(now: Date): Date {
  return nextSendWindowOpen(now);
}

export function holdToWindow(t: Date): Date {
  return withinSendWindow(t) ? t : nextWindowOpen(t);
}

/** D3/D4: the email is held to the window; WhatsApp one gap after it (or at enrolment without email), held too. */
export function dueTimes(a: { enrolledAt: Date; hasEmail: boolean; gapMin?: number }): { emailDueAt: Date | null; waDueAt: Date } {
  const gap = a.gapMin ?? FOLLOWUP_GAP_MIN;
  const emailDueAt = a.hasEmail ? holdToWindow(a.enrolledAt) : null;
  return { emailDueAt, waDueAt: holdToWindow(emailDueAt ? new Date(emailDueAt.getTime() + gap * 60_000) : a.enrolledAt) };
}
