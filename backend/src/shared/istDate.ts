/**
 * IST business-date helpers for the D-1 Daily Manager Intelligence Briefing Engine.
 *
 * `shared/timezone.ts` already has `nowIST()` (current instant, IST-tagged ISO string)
 * and `toISTDate()` (extracts the date part of an already-tagged value) — neither
 * computes "yesterday in IST" from an arbitrary instant, which the briefing job needs
 * as its D-1 boundary. That single small pure function lives here rather than being
 * added to timezone.ts, so it stays independently testable without pulling in the rest
 * of that module's MySQL-value-parsing surface.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Format a Date (already shifted to the IST wall clock) as YYYY-MM-DD. */
function formatISTWallClock(shifted: Date): string {
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The IST calendar date (YYYY-MM-DD) for an instant, defaulting to now.
 * Exported mainly for the unit tests below; getBusinessDateIST is what callers want.
 */
export function getCurrentDateIST(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return formatISTWallClock(shifted);
}

/**
 * The D-1 business date: yesterday's calendar date in Asia/Kolkata, as YYYY-MM-DD.
 *
 * This is the reporting-date boundary for the daily brief — "yesterday" is computed
 * against the IST wall clock, not the host's local time or UTC, so a run kicked off
 * anywhere near IST midnight still resolves to the correct day.
 */
export function getBusinessDateIST(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  shifted.setUTCDate(shifted.getUTCDate() - 1);
  return formatISTWallClock(shifted);
}

/**
 * Display-only "generated at" timestamp in IST, e.g. "19 Aug 2026, 9:05 AM IST".
 * Not used for any date-boundary logic — purely for the email header/footer.
 */
export function getGeneratedAtIST(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const datePart = formatISTWallClock(shifted);
  const [year, month, day] = datePart.split("-");
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  let hours = shifted.getUTCHours();
  const minutes = String(shifted.getUTCMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${Number(day)} ${monthNames[Number(month) - 1]} ${year}, ${hours}:${minutes} ${ampm} IST`;
}
