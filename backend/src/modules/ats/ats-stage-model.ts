/**
 * Canonical ATS pipeline stages.
 *
 * `ats_candidate.current_stage` is free text and holds at least three rival vocabularies at
 * once. Measured against production 2026-08-11:
 *
 *   Applied 34923 | Offered 1250 | Round 1- HR Screening 685 | Round 2- Op's 359
 *   Arrival 150 | Interview - Skill Test 118 | Arrived 46 | Round 3- Client 40
 *   Selection Discussion 34 | Onboarded 28 | Screening 21 | converted 16
 *   selected 7 | New 3 | Interview 3 | payroll_validated 2 | offer_approved 1
 *
 * Three separate problems in one column:
 *   - `Arrival` and `Arrived` are the same stage counted twice;
 *   - machine states (`converted`, `selected`, `payroll_validated`, `offer_approved`) leak
 *     into what is otherwise a human-readable label;
 *   - `Screening` and `Round 1- HR Screening` overlap, as do `New` and `Applied`.
 *
 * Consumers then disagree on casing too — command-centre matches lowercase, ats-full-parity
 * TitleCase, ats.service hedges both — so even two queries that correctly exclude legacy rows
 * can still report different funnels.
 *
 * This module is the single mapping. It maps at READ time and does not rewrite stored data:
 * a historical rewrite is a separate, approval-gated decision, and mapping first is what lets
 * the two be compared before anything is destroyed.
 */

export const CANONICAL_STAGES = [
  "applied",
  "screening",
  "assessment",
  "ops_round",
  "client_round",
  "selection_discussion",
  "selected",
  "offered",
  "arrived",
  "onboarded",
] as const;

export type CanonicalStage = (typeof CANONICAL_STAGES)[number];

/** Pipeline order, earliest first. Index is the stage's depth. */
export const CANONICAL_STAGE_ORDER: readonly CanonicalStage[] = CANONICAL_STAGES;

/** Human labels for display, so callers do not re-invent them per dashboard. */
export const CANONICAL_STAGE_LABEL: Record<CanonicalStage, string> = {
  applied: "Applied",
  screening: "HR Screening",
  assessment: "Assessment / Skill Test",
  ops_round: "Operations Round",
  client_round: "Client Round",
  selection_discussion: "Selection Discussion",
  selected: "Selected",
  offered: "Offered",
  arrived: "Arrived",
  onboarded: "Onboarded",
};

/**
 * Every raw value observed in production, mapped to its canonical stage.
 *
 * Keys are compared lowercased and whitespace-collapsed, so casing drift between call sites
 * stops mattering. A value that is not listed returns null rather than being forced into a
 * bucket — an unrecognised stage must be visible as unrecognised, not silently counted as
 * "Applied", which is what the old `COALESCE(NULLIF(current_stage,''),'Applied')` did and is
 * why ~30k legacy rows landed on the top of the funnel.
 */
const RAW_TO_CANONICAL: Record<string, CanonicalStage> = {
  "applied": "applied",
  "new": "applied",
  "screening": "screening",
  "round 1- hr screening": "screening",
  "round 1 - hr screening": "screening",
  "interview": "assessment",
  "interview - skill test": "assessment",
  "assessment": "assessment",
  "round 2- op's": "ops_round",
  "round 2 - op's": "ops_round",
  "ops round": "ops_round",
  "round 3- client": "client_round",
  "round 3 - client": "client_round",
  "client round": "client_round",
  "selection discussion": "selection_discussion",
  "selected": "selected",
  "offered": "offered",
  "offer_approved": "offered",
  // "Arrival" and "Arrived" are one stage recorded two ways.
  "arrival": "arrived",
  "arrived": "arrived",
  "onboarded": "onboarded",
  "converted": "onboarded",
  "payroll_validated": "onboarded",
};

const normalise = (raw: string): string => raw.trim().toLowerCase().replace(/\s+/g, " ");

/** Canonical stage for a raw `current_stage` value, or null when unrecognised. */
export function canonicalStage(raw: string | null | undefined): CanonicalStage | null {
  if (raw == null) return null;
  const key = normalise(String(raw));
  if (!key) return null;
  return RAW_TO_CANONICAL[key] ?? null;
}

export interface StageBucket { stage: string; count: number }

export interface FunnelStep {
  stage: CanonicalStage;
  label: string;
  /** Candidates whose current stage IS this stage. */
  at_stage: number;
  /** Candidates who reached this stage or any later one — the funnel width here. */
  reached: number;
  /** reached(this) / reached(previous). Null on the first step, which has no predecessor. */
  conversion_from_previous: number | null;
}

export interface CanonicalFunnel {
  steps: FunnelStep[];
  /** Raw values that matched no canonical stage, reported rather than absorbed. */
  unmapped: StageBucket[];
}

/**
 * Turn raw `GROUP BY current_stage` buckets into an ordered funnel.
 *
 * The important correction: a GROUP BY yields DISJOINT buckets — each candidate appears in
 * exactly one — so the count at a later stage is not a subset of the count at an earlier one.
 * Dividing one bucket by the next is not a conversion rate.
 *
 * `reached` is therefore the cumulative sum from the deepest stage backwards: someone
 * currently at "Offered" necessarily passed screening. Conversion is then the ratio of
 * consecutive `reached` values, which is a real survival rate and is monotonically
 * non-increasing by construction.
 */
export function buildCanonicalFunnel(buckets: StageBucket[]): CanonicalFunnel {
  const atStage = new Map<CanonicalStage, number>();
  const unmapped: StageBucket[] = [];

  for (const b of buckets) {
    const canonical = canonicalStage(b.stage);
    const count = Number(b.count) || 0;
    if (!canonical) {
      if (count > 0) unmapped.push({ stage: b.stage, count });
      continue;
    }
    atStage.set(canonical, (atStage.get(canonical) ?? 0) + count);
  }

  // Cumulative from the deepest stage backwards.
  const reached = new Map<CanonicalStage, number>();
  let running = 0;
  for (let i = CANONICAL_STAGE_ORDER.length - 1; i >= 0; i--) {
    const stage = CANONICAL_STAGE_ORDER[i];
    running += atStage.get(stage) ?? 0;
    reached.set(stage, running);
  }

  const steps: FunnelStep[] = CANONICAL_STAGE_ORDER.map((stage, i) => {
    const here = reached.get(stage) ?? 0;
    const prev = i === 0 ? null : reached.get(CANONICAL_STAGE_ORDER[i - 1]) ?? 0;
    return {
      stage,
      label: CANONICAL_STAGE_LABEL[stage],
      at_stage: atStage.get(stage) ?? 0,
      reached: here,
      // Guard the divide: a stage nobody reached gives no information, and 0/0 must not
      // render as a confident 0% conversion.
      conversion_from_previous: prev == null ? null : prev > 0 ? here / prev : null,
    };
  });

  return { steps, unmapped };
}
