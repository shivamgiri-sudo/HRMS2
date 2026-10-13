/**
 * Per-item roll-up helpers shared by the GS1 Email and Data Card importers.
 *
 * Both uploads are raw per-ticket / per-task logs collapsed to one row per analyst per day.
 * These helpers keep the per-item fields the dashboard needs (status, SLA bucket, category,
 * duration) as small per-day count maps instead of dropping them.
 */

export type CountMap = Record<string, number>;

/** Trimmed, whitespace-collapsed label; blank becomes "(blank)" so it is counted, not hidden. */
export function normalizeLabel(raw: unknown, maxLen = 60): string {
  const v = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!v) return "(blank)";
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

export function bumpCount(map: CountMap, raw: unknown): void {
  const key = normalizeLabel(raw);
  map[key] = (map[key] ?? 0) + 1;
}

/** Keep the JSON small: the top `limit` labels, everything else folded into "(other)". */
export function capCountMap(map: CountMap, limit = 40): CountMap {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (entries.length <= limit) return Object.fromEntries(entries);
  const out: CountMap = Object.fromEntries(entries.slice(0, limit));
  out["(other)"] = (out["(other)"] ?? 0) + entries.slice(limit).reduce((s, e) => s + e[1], 0);
  return out;
}

/**
 * Handling time in minutes from an export "Duration" cell, or null when it cannot be read.
 *   "h:mm:ss" / "hh:mm:ss"  -> hours, minutes, seconds
 *   "h:mm"                  -> hours and minutes (spreadsheet time rendering)
 *   number below 1          -> fraction of a day (raw spreadsheet time value)
 *   number 1 or more        -> minutes
 * Negative or implausible values (over 30 days) are treated as unreadable.
 */
export function parseDurationMinutes(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  let minutes: number | null = null;
  const hms = /^(\d{1,4}):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/.exec(v);
  const hm = /^(\d{1,4}):(\d{1,2})$/.exec(v);
  if (hms) minutes = Number(hms[1]) * 60 + Number(hms[2]) + Number(hms[3]) / 60;
  else if (hm) minutes = Number(hm[1]) * 60 + Number(hm[2]);
  else if (/^\d+(\.\d+)?$/.test(v)) {
    const x = Number(v);
    minutes = x < 1 ? x * 1440 : x;
  }
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0 || minutes > 30 * 1440) return null;
  return minutes;
}

/** Non-blank completion marker ("Date of completion" / "Complete time"). */
export function hasValue(raw: unknown): boolean {
  return String(raw ?? "").trim() !== "";
}

/** Mean duration for a group: [avgMinutes|null, knownCount]. 0 known = captured but unreadable. */
export function durationStats(sum: number, known: number): [number | null, number] {
  if (known <= 0) return [null, 0];
  return [Math.round((sum / known) * 100) / 100, known];
}
