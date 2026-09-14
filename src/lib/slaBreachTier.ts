/**
 * SLA breach tier — the decision logic behind the "SLA Breached / Due <1h / Due Xh / On Time"
 * badges shown on a helpdesk ticket. Extracted 2026-08-24: NativeHelpdesk.tsx and
 * NativeSupportCommandCenter.tsx each had their own copy of these exact thresholds (breached,
 * <=60min, <=240min, else on-time) — same logic, two places that could silently drift apart.
 * Both files now call this one function for the decision and keep their own separate JSX for
 * how the tier renders (a rounded pill in the ticket detail view vs. compact colored text in
 * the dense queue table) — the two contexts genuinely call for different presentation, so this
 * only unifies the part that actually mattered: the thresholds themselves.
 *
 * Also closes a latent inconsistency: NativeSupportCommandCenter's copy never checked ticket
 * status at all (only ever looked at sla_due_at/sla_breached), unlike NativeHelpdesk's, which
 * correctly hides the badge once a ticket is resolved/closed/cancelled/on_hold. Not a live bug
 * today (the queue only ever loads status=open tickets), but would have become one silently if
 * that query's filter ever changed — this function's status check now applies everywhere.
 */

export type SlaBreachTier = "breached" | "due_lt_1h" | "due_lt_4h" | "on_time";

const TERMINAL_OR_PAUSED_STATUSES = ["resolved", "closed", "cancelled", "on_hold"];

export interface SlaBreachResult {
  tier: SlaBreachTier;
  /** Minutes until sla_due_at; negative once past due. Only meaningful for non-"breached" tiers
   * derived from the deadline rather than the sla_breached flag itself. */
  minutesLeft: number;
}

/**
 * Returns null when no badge should show at all: no sla_due_at set, or the ticket is in a
 * terminal/paused status (SLA no longer being tracked against a live clock).
 */
export function getSlaBreachTier(ticket: {
  sla_due_at?: string | null;
  sla_breached?: boolean | number | null;
  status: string;
}): SlaBreachResult | null {
  if (!ticket.sla_due_at || TERMINAL_OR_PAUSED_STATUSES.includes(ticket.status)) return null;

  const minutesLeft = Math.floor((new Date(ticket.sla_due_at).getTime() - Date.now()) / 60000);

  if (ticket.sla_breached || minutesLeft < 0) return { tier: "breached", minutesLeft };
  if (minutesLeft <= 60) return { tier: "due_lt_1h", minutesLeft };
  if (minutesLeft <= 240) return { tier: "due_lt_4h", minutesLeft };
  return { tier: "on_time", minutesLeft };
}
