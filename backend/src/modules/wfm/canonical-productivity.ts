//
// Requirement 18's canonical daily productivity aggregation (requirements.md), implemented as a
// pure function with no DB access, directly property-testable (design.md component 5,
// "Canonical daily aggregation"). Consumed by Phase 3's ingestion write path — this phase does
// not wire it to any table or worker.
//
// Two rules, exactly as decision A8 settles them:
//   - PRIMARY (criterion 18.4): every contribution has a usable interval -> sweep-merge
//     overlapping intervals, sum the merged lengths. Any instant covered by two or more
//     contributions counts once. This is the only rule faithful to genuinely sequential
//     cross-dialler work.
//   - SECONDARY (criterion 18.6): if ANY contribution lacks a usable interval, the WHOLE
//     employee-date falls to the maximum single magnitude instead — not just the unusable
//     contribution's own value discarded. This is mandatory, not configurable, and it is what
//     currently governs most dialler days in production: dialer_session_log and
//     apr_manual_upload both carry only a minutes figure, no logout column at all.
//
// A contribution is "usable" only when its interval is present AND endMinute > startMinute
// (criterion 18.5) — a zero-length or malformed interval is treated exactly like a missing one,
// not silently ignored.
//
// Summing net login across concurrent sessions (what the current, broken aggregation does) is
// deliberately never expressed here — the type doesn't even have a "just add them up" code path.

export interface Contribution {
  diallerSourceId: string;
  // Minutes from 00:00 on the target calendar date. null means this contribution supplies no
  // ordered interval at all (e.g. a manual upload with only login_minutes, no logout column).
  interval: { startMinute: number; endMinute: number } | null;
  // Net_Login / login_minutes — the contribution magnitude used by the secondary rule and by
  // the no-shrinkage/no-inflation bounds, regardless of which rule ultimately governs.
  magnitudeMinutes: number;
}

export type ProducingRule = 'interval_union' | 'max_contribution';

export interface CanonicalResult {
  // null means absent for this employee-date (criterion 18.10) — never a measured zero.
  minutes: number | null;
  rule: ProducingRule | null;
  excludedCount: number;
}

function isUsable(c: Contribution): boolean {
  return c.interval !== null && c.interval.endMinute > c.interval.startMinute;
}

export function deriveCanonical(contributions: Contribution[]): CanonicalResult {
  if (contributions.length === 0) {
    return { minutes: null, rule: null, excludedCount: 0 };
  }

  const usable = contributions.filter(isUsable);
  const excludedCount = contributions.length - usable.length;

  // Secondary rule (18.6): ANY unusable contribution demotes the WHOLE employee-date.
  if (usable.length < contributions.length) {
    // Sanitize magnitude before taking the max: a negative or non-finite value (a real risk
    // from a junk Excel cell in a manual upload, parsed by Phase 3's column mapping) must never
    // propagate into the result — NaN in particular would collide with the wire value
    // criterion 18.10 reserves for "absent" once serialized. Treat an invalid magnitude as 0,
    // not as an excuse to throw or drop the contribution.
    const sanitizedMagnitudes = contributions.map((c) =>
      Number.isFinite(c.magnitudeMinutes) && c.magnitudeMinutes >= 0 ? c.magnitudeMinutes : 0,
    );
    const maxMagnitude = Math.max(...sanitizedMagnitudes);
    return {
      minutes: Math.max(0, Math.min(maxMagnitude, 1440)),
      rule: 'max_contribution',
      excludedCount,
    };
  }

  // Primary rule (18.4): sweep-merge overlapping intervals, sum the merged lengths.
  const sorted = [...usable].sort((a, b) => a.interval!.startMinute - b.interval!.startMinute);
  let totalMinutes = 0;
  let mergedStart = sorted[0].interval!.startMinute;
  let mergedEnd = sorted[0].interval!.endMinute;
  for (let i = 1; i < sorted.length; i++) {
    const { startMinute, endMinute } = sorted[i].interval!;
    if (startMinute <= mergedEnd) {
      mergedEnd = Math.max(mergedEnd, endMinute);
    } else {
      totalMinutes += mergedEnd - mergedStart;
      mergedStart = startMinute;
      mergedEnd = endMinute;
    }
  }
  totalMinutes += mergedEnd - mergedStart;

  return {
    minutes: Math.max(0, Math.min(totalMinutes, 1440)),
    rule: 'interval_union',
    excludedCount: 0,
  };
}
