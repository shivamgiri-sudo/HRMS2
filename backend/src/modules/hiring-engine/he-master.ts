/**
 * Recruitment master rules (pure). Ported from the Source-of-Truth sheet so HRMS numbers match it:
 * conversion type by month gap between first attempt and first walk-in, joined > selected > rejected,
 * plus the effort tier that decides how much calling effort a lead deserves.
 */
export type FinalStatus = "none" | "rejected" | "selected" | "joined";
export type OutcomeClass = "interested" | "not_interested" | "wrong_number" | "no_answer" | "other";
export type EffortTier = "skip" | "low" | "standard" | "high";

export function classifyOutcome(raw: string | null | undefined): OutcomeClass {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return "other";
  if (/wrong\s*(number|no)|invalid\s*(number|no)|not\s*in\s*service|does\s*not\s*exist/.test(v)) return "wrong_number";
  if (/not\s*(interested|intrested|looking)|no\s*interest|declined|refus/.test(v)) return "not_interested";
  if (/interested|intrested|will\s*(come|visit)|walk[\s-]?in\s*(scheduled|confirmed)|confirmed/.test(v)) return "interested";
  if (/not\s*(reachable|answer|picked|responding)|no\s*answer|switched\s*off|busy|ringing|call\s*back|callback/.test(v)) return "no_answer";
  return "other";
}

/** "YYYY-MM-DD" -> months since year 0, or null. */
function monthIndex(d: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(d ?? ""));
  return m ? Number(m[1]) * 12 + Number(m[2]) : null;
}

export function conversionType(firstAttemptDate: string | null, firstWalkinDate: string | null): string {
  if (!firstWalkinDate) return "No Walk-in Yet";
  const a = monthIndex(firstAttemptDate);
  const w = monthIndex(firstWalkinDate);
  if (a === null || w === null) return "Walk-in Matched";
  const gap = w - a;
  if (gap <= 0) return "Fresh / Same Month";
  if (gap === 1) return "Previous Month Lead Converted";
  return "Dormant Lead Reactivated";
}

export function deriveFinalStatus(walkedIn: boolean, selected: boolean, joined: boolean): FinalStatus {
  if (joined) return "joined";
  if (selected) return "selected";
  return walkedIn ? "rejected" : "none";
}

export interface EffortInput {
  status: string;
  finalStatus: FinalStatus;
  isEmployee: boolean;
  lastOutcome: OutcomeClass | null;
  attemptCount: number;
  walkinCount: number;
  hasFutureSlot: boolean;
}

/** Who deserves how much effort, and why (reason is stored for the UI). */
export function effortTier(i: EffortInput): { tier: EffortTier; reason: string } {
  if (i.status === "opted_out") return { tier: "skip", reason: "opted_out" };
  if (i.status === "joined" || i.finalStatus === "joined") return { tier: "skip", reason: "already_joined" };
  if (i.isEmployee) return { tier: "skip", reason: "current_employee" };
  if (i.status === "dead") return { tier: "skip", reason: "dead" };
  if (i.lastOutcome === "wrong_number") return { tier: "skip", reason: "wrong_number" };
  if (i.hasFutureSlot) return { tier: "high", reason: "slot_booked" };
  if (["interested", "invited", "confirmed", "rescheduled"].includes(i.status)) return { tier: "high", reason: "engaged_" + i.status };
  if (i.finalStatus === "selected") return { tier: "high", reason: "selected_not_joined" };
  if (i.lastOutcome === "interested") return { tier: "high", reason: "said_interested" };
  if (i.finalStatus === "rejected") return { tier: "low", reason: "rejected_after_walkin" };
  if (i.lastOutcome === "not_interested") return { tier: "low", reason: "not_interested" };
  if (i.attemptCount >= 5 && i.walkinCount === 0) return { tier: "low", reason: "many_attempts_no_walkin" };
  if (i.walkinCount > 0) return { tier: "high", reason: "walked_in_before" };
  return { tier: "standard", reason: "fresh_or_unworked" };
}
