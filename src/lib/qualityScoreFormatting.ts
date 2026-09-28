/**
 * Single source of truth for "conditional formatting" (colour-coding) of quality
 * process / quality score values across every quality-related dashboard page
 * (Quality Dashboard / Onfido process view, Executive Quality Dashboard, Agent
 * Quality Dashboard, Call Master Dashboard, Client Quality Drill modal, Agent
 * Performance Dashboard, etc).
 *
 * Before this file existed, the same four-tier idea (>=80 good, >=70 warn,
 * >=60 caution, else bad) was re-implemented ad hoc in a dozen places — some
 * with 3 tiers, some with 4, some with slightly different cut points — so the
 * same 72% call could render green on one page and amber on another. Every
 * call site listed above now imports from here instead of inlining its own
 * thresholds, so a single change to the bands changes every page at once.
 *
 * Bands (score is a 0-100 quality percentage):
 *   >= 80        good      emerald
 *   70 – 79.99   warn      yellow
 *   60 – 69.99   caution   orange
 *   <  60        bad       red
 */

export type QualityTone = "good" | "warn" | "caution" | "bad";

export const QUALITY_SCORE_THRESHOLDS = {
  good: 80,
  warn: 70,
  caution: 60,
} as const;

/** Resolve a 0-100 quality score into one of the four standard tones. */
export function qualityScoreTone(score: number | null | undefined): QualityTone {
  const s = Number(score);
  if (!Number.isFinite(s)) return "bad";
  if (s >= QUALITY_SCORE_THRESHOLDS.good) return "good";
  if (s >= QUALITY_SCORE_THRESHOLDS.warn) return "warn";
  if (s >= QUALITY_SCORE_THRESHOLDS.caution) return "caution";
  return "bad";
}

/** Pill/badge classes (border + bg + text) — matches the existing ScorePill look. */
export const QUALITY_TONE_BADGE_CLASS: Record<QualityTone, string> = {
  good: "bg-emerald-100 text-emerald-700 border-emerald-200",
  warn: "bg-yellow-100 text-yellow-700 border-yellow-200",
  caution: "bg-orange-100 text-orange-700 border-orange-200",
  bad: "bg-red-100 text-red-700 border-red-200",
};

/** Plain text colour only (no background) — for inline numbers in tables. */
export const QUALITY_TONE_TEXT_CLASS: Record<QualityTone, string> = {
  good: "text-emerald-600",
  warn: "text-yellow-600",
  caution: "text-orange-600",
  bad: "text-red-600",
};

/** Text + soft background, no border — for table cells / mini-gauges. */
export const QUALITY_TONE_CELL_CLASS: Record<QualityTone, string> = {
  good: "text-emerald-600 bg-emerald-50",
  warn: "text-yellow-600 bg-yellow-50",
  caution: "text-orange-600 bg-orange-50",
  bad: "text-red-600 bg-red-50",
};

/** Solid fill colour — for progress bars / gauges / chart bars. */
export const QUALITY_TONE_BAR_CLASS: Record<QualityTone, string> = {
  good: "bg-emerald-500",
  warn: "bg-yellow-500",
  caution: "bg-orange-500",
  bad: "bg-red-500",
};

/** Hex colour — for SVG/recharts fills that can't take a Tailwind class. */
export const QUALITY_TONE_HEX: Record<QualityTone, string> = {
  good: "#10b981",
  warn: "#eab308",
  caution: "#f97316",
  bad: "#ef4444",
};

export function qualityScoreBadgeClass(score: number | null | undefined): string {
  return QUALITY_TONE_BADGE_CLASS[qualityScoreTone(score)];
}

export function qualityScoreTextClass(score: number | null | undefined): string {
  return QUALITY_TONE_TEXT_CLASS[qualityScoreTone(score)];
}

export function qualityScoreCellClass(score: number | null | undefined): string {
  return QUALITY_TONE_CELL_CLASS[qualityScoreTone(score)];
}

export function qualityScoreBarClass(score: number | null | undefined): string {
  return QUALITY_TONE_BAR_CLASS[qualityScoreTone(score)];
}

export function qualityScoreHex(score: number | null | undefined): string {
  return QUALITY_TONE_HEX[qualityScoreTone(score)];
}
