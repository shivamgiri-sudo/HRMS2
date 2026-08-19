/**
 * Duplicate Signal Control for the D-1 Daily Manager Briefing Engine (spec §45/§46).
 *
 * Pure functions, no DB access, no imports outside daily-brief.types.ts. Both
 * exports are designed to run AFTER every source module (attendance, hygiene,
 * business_action_queue, work_item/actions) has independently produced its own
 * BriefSignal-shaped output, so this file never decides what counts as an issue —
 * only how to present the same issue once instead of twice, and in what order.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * INTEGRATION-PASS UPDATE — DedupableSignal is now BriefSignal itself
 * ────────────────────────────────────────────────────────────────────────────
 * This file originally declared `DedupableSignal` as a local EXTENSION of
 * BriefSignal, because the MVP `BriefSignal` (`{ key, label, value, unit? }`)
 * did not carry the employeeId/source/category/actionUrl/priority/isPositive/
 * kind fields section 46's merge rule needs. The integration pass reconciled
 * this by widening the CANONICAL `BriefSignal` in daily-brief.types.ts to
 * include those same fields (all optional) — see that file's header comment
 * for the reasoning — rather than keeping two parallel shapes that every
 * producing module would need to remember to satisfy. `DedupableSignal` is
 * kept as a type ALIAS of `BriefSignal` (not a separate interface) purely so
 * this file's internal references and the existing test file's
 * `import type { DedupableSignal }` keep working unchanged; it carries no
 * fields BriefSignal itself doesn't already have.
 */
import type { BriefSignal } from "./daily-brief.types.js";

export type DedupableSignal = BriefSignal;

// ────────────────────────────────────────────────────────────────────────────
// dedupeSignals
// ────────────────────────────────────────────────────────────────────────────

/**
 * KEYING STRATEGY (documented per the task's requirement).
 *
 * Two signals are candidates for merging only if BOTH:
 *   1. They share the same non-empty `employeeId`.
 *   2. Their normalized issue keys match exactly (see normalizeIssueKey below).
 *
 * The normalized issue key is NOT a raw `${source}:${category}` concatenation,
 * because the concrete example in spec §46 — an attendance exception and its
 * resulting Action Centre item — comes from two DIFFERENT sources (the
 * attendance module and business_action_queue/work_item) describing the SAME
 * issue. A raw source+category concatenation would never collide those two.
 * Instead, `category` is passed through a small closed alias table
 * (CATEGORY_ALIASES below) that maps known equivalent spellings from different
 * producers onto one canonical string; anything not in the table is used as-is
 * (lowercased/trimmed). This is a deterministic exact-match lookup, not
 * heuristic similarity — an unlisted category never merges with anything by
 * accident, per the "only merge on a real key match" requirement.
 *
 * EDITORIAL / INVENTED: the CATEGORY_ALIASES table itself. The only alias
 * pairing this codebase's own memory ledger corroborates is
 * attendance-module "attendance_mismatch"/"missing_punch" vs.
 * business_action_queue's `risk_type = 'ATTENDANCE_MISMATCH'`
 * (hrms2-work-inbox-producer-census memory: it is the one live producer/consumer
 * pair connecting an attendance-shaped issue to an Action Centre item today).
 * Every other entry is a defensive guess at likely producer-side spellings and
 * is flagged loudly in the module report — extend this table, don't trust it
 * as exhaustive.
 */
const CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  attendance_mismatch: "attendance_mismatch",
  missing_punch: "attendance_mismatch",
  attendance_exception: "attendance_mismatch",
  unreconciled_attendance: "attendance_mismatch",
};

function normalizeIssueKey(signal: DedupableSignal): string {
  const raw = String(signal.category ?? signal.key ?? "").trim().toLowerCase();
  return CATEGORY_ALIASES[raw] ?? raw;
}

function groupKey(signal: DedupableSignal): string | null {
  const employeeId = signal.employeeId ? String(signal.employeeId).trim() : "";
  if (!employeeId) return null; // no safe correlation key — never merged
  const issueKey = normalizeIssueKey(signal);
  if (!issueKey) return null; // no classifier to key on — never merged
  return `${employeeId}::${issueKey}`;
}

/** True when `candidate` says something `base` does not already say. */
function addsInformation(base: string, candidate: string): boolean {
  if (!candidate) return false;
  const b = base.toLowerCase();
  const c = candidate.toLowerCase();
  if (b === c) return false;
  return !b.includes(c);
}

/**
 * Merge exactly two same-issue signals per spec §46: action URL and priority
 * come from whichever signal is actionable (has actionUrl); descriptive text
 * merges in the OTHER signal's label when it adds real information the winner's
 * label doesn't already carry; numeric/text value is kept from the actionable
 * signal unless it has none, in which case the other signal's value is used.
 */
function mergeTwo(a: DedupableSignal, b: DedupableSignal): DedupableSignal {
  const winner = a.actionUrl ? a : b.actionUrl ? b : a;
  const other = winner === a ? b : a;

  const merged: DedupableSignal = { ...winner };

  if (addsInformation(winner.label, other.label)) {
    merged.label = `${winner.label} (${other.label})`;
  }
  if (merged.value === null || merged.value === undefined || merged.value === "") {
    merged.value = other.value;
  }
  merged.actionUrl = winner.actionUrl ?? other.actionUrl ?? null;
  merged.priority = winner.priority ?? other.priority;
  merged.employeeId = winner.employeeId ?? other.employeeId;
  merged.category = winner.category ?? other.category;
  merged.source = winner.actionUrl ? winner.source : (winner.source ?? other.source);
  merged.kind = winner.kind ?? other.kind;
  merged.isPositive = winner.isPositive ?? other.isPositive;

  return merged;
}

/**
 * Deduplicate/merge signals representing the same underlying issue for the same
 * employee. Never drops a signal that has no clear duplicate (i.e. no shared
 * groupKey with another signal) — order of first appearance is preserved for
 * both merged and singleton signals.
 */
export function dedupeSignals(signals: BriefSignal[]): BriefSignal[] {
  const input = signals as DedupableSignal[];
  const order: string[] = []; // groupKey or a synthetic unique id, in first-seen order
  const groups = new Map<string, DedupableSignal>();
  let syntheticCounter = 0;

  for (const signal of input) {
    const key = groupKey(signal);
    if (key === null) {
      // Not correlatable — always kept, never merged with anything.
      const syntheticKey = `__single__${syntheticCounter++}`;
      order.push(syntheticKey);
      groups.set(syntheticKey, signal);
      continue;
    }
    if (groups.has(key)) {
      groups.set(key, mergeTwo(groups.get(key) as DedupableSignal, signal));
    } else {
      order.push(key);
      groups.set(key, signal);
    }
  }

  return order.map((key) => groups.get(key) as DedupableSignal);
}

// ────────────────────────────────────────────────────────────────────────────
// rankSignals
// ────────────────────────────────────────────────────────────────────────────

/**
 * Priority order per spec §45, reproduced verbatim as the ranking table below:
 *
 *   1. critical action
 *   2. high action
 *   3. critical business/staffing/people risk
 *   4. material D-1 anomaly
 *   5. repeated hygiene/discipline
 *   6. positive major improvement
 *   7. normal metric
 *   8. informational
 *
 * `kind` classifies a signal into one of the buckets above. EDITORIAL: most
 * upstream modules in this codebase do not yet stamp signals with `kind` — it is
 * a new field this file introduces (see DedupableSignal). Where `kind` is
 * absent, inferKind() makes a best-effort guess from `priority`/`isPositive`/
 * `actionUrl` and otherwise falls back to "informational" (rank 8), never to a
 * higher bucket — an unclassified signal must never outrank a genuinely
 * classified one. This inference is flagged in the module report as an
 * invented default, not a specified business rule.
 */
function inferKind(signal: DedupableSignal): NonNullable<DedupableSignal["kind"]> {
  if (signal.kind) return signal.kind;
  if (signal.isPositive) return "positive";
  if (signal.actionUrl && (signal.priority === "critical" || signal.priority === "high")) return "action";
  return "info";
}

interface RankBucket {
  label: string;
  test: (s: DedupableSignal) => boolean;
}

const RANK_BUCKETS: readonly RankBucket[] = [
  { label: "critical action", test: (s) => inferKind(s) === "action" && s.priority === "critical" },
  { label: "high action", test: (s) => inferKind(s) === "action" && s.priority === "high" },
  { label: "critical business/staffing/people risk", test: (s) => inferKind(s) === "business_risk" && s.priority === "critical" },
  { label: "material D-1 anomaly", test: (s) => inferKind(s) === "anomaly" },
  { label: "repeated hygiene/discipline", test: (s) => inferKind(s) === "hygiene" },
  { label: "positive major improvement", test: (s) => inferKind(s) === "positive" },
  { label: "normal metric", test: (s) => inferKind(s) === "metric" },
  { label: "informational", test: () => true }, // catch-all — always matches, must stay last
];

function severityRank(signal: DedupableSignal): number {
  const idx = RANK_BUCKETS.findIndex((bucket) => bucket.test(signal));
  return idx === -1 ? RANK_BUCKETS.length - 1 : idx;
}

/**
 * Secondary tie-break within the same severity bucket: alphabetical by category
 * (falling back to key). This is a deterministic tie-break for stable output,
 * NOT a business rule — flagged as editorial, same as the bucket-inference above.
 */
function categoryRank(signal: DedupableSignal): string {
  return String(signal.category ?? signal.key ?? "").toLowerCase();
}

/**
 * Stable sort by (severity rank, category rank) per spec §45. Node's
 * Array.prototype.sort has been stable since Node 11 / ES2019, so signals that
 * tie on both keys keep their relative input order.
 */
export function rankSignals(signals: BriefSignal[]): BriefSignal[] {
  const input = signals as DedupableSignal[];
  return [...input].sort((a, b) => {
    const rankDiff = severityRank(a) - severityRank(b);
    if (rankDiff !== 0) return rankDiff;
    return categoryRank(a).localeCompare(categoryRank(b));
  });
}
