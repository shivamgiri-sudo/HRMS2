/**
 * The checklist engine — three layers merged so the worst verdict always wins.
 *
 *   floor      = evaluateFloor(scan)              // path tier        — authoritative
 *   capability = evaluateCapabilities(scan)       // capability class — authoritative
 *   db         = evaluateDbRules(rows, llm)       // additive only
 *   final[item] = worstOf(floor, capability, db)
 *
 * THE PROPERTY THAT MATTERS
 *   An administrator with full access to uat_checklist_item must not be able to make a
 *   payroll edit pass. That is not enforced by remembering to be careful; it is enforced by
 *   the shape of mergeLayers(): it only ever takes the WORST verdict per item, and the floor
 *   and capability layers are computed from the JSON control plane, which is deny-tier and
 *   changes only through a reviewed pull request. There is no code path in this file that
 *   lets a `db` verdict replace a worse one — the merge is monotone by construction, and
 *   checklist-floor.contract.test.ts feeds an all-pass rule set against a payroll scan and
 *   asserts the gate is still blocked.
 *
 * FAIL CLOSED
 *   `undetermined` is worse than `pass`. An item nobody could evaluate is not an item that
 *   passed, and gateFor() blocks on any blocking item that is not explicitly `pass` or
 *   `not_applicable`.
 */
import {
  capabilityClassFor,
  explainCapabilityDeny,
  mandatoryTests,
  requiredApproverRoles,
} from "./capability-registry.js";
import { explainDeny } from "./protected-paths.js";
import {
  CAPABILITY_CLASS_RANK,
  PATH_TIER_RANK,
  type CapabilityClass,
  type CapabilityHit,
  type PathTier,
  type ProtectedHit,
  type StaticScanResult,
} from "./uat-pipeline.types.js";

// ── Verdicts ──────────────────────────────────────────────────────────────────

export type ChecklistVerdict = "pass" | "fail" | "warn" | "not_applicable" | "undetermined";
export type ChecklistSource = "floor" | "capability" | "static" | "llm" | "human" | "db";

/**
 * Severity order. `undetermined` sits ABOVE `pass` and `not_applicable` on purpose: an item
 * that could not be evaluated must not be indistinguishable from one that was evaluated and
 * cleared. `warn` outranks `undetermined` because a warn is a positive finding.
 */
const VERDICT_RANK: Record<ChecklistVerdict, number> = {
  not_applicable: 0,
  pass: 1,
  undetermined: 2,
  warn: 3,
  fail: 4,
};

export interface ChecklistItemResult {
  itemKey: string;
  verdict: ChecklistVerdict;
  source: ChecklistSource;
  evidence: string;
  /** Set when a DB rule was consulted, so the row can record which version judged it. */
  ruleVersion?: number;
  confidence?: number;
}

/** The single worst of any number of results for one item. */
export function worstOf(...results: ChecklistItemResult[]): ChecklistItemResult {
  if (results.length === 0) {
    throw new Error("[uat] worstOf called with no results");
  }
  let worst = results[0];
  for (const r of results.slice(1)) {
    if (VERDICT_RANK[r.verdict] > VERDICT_RANK[worst.verdict]) worst = r;
  }
  return worst;
}

// ── Layer 1: the path floor ───────────────────────────────────────────────────

/**
 * Verdicts derived from protected-path hits alone. Only items a path match can actually
 * speak to are produced here; an item this layer cannot judge is simply absent, and the
 * merge treats absence as "no opinion" rather than as a pass.
 */
export function evaluateFloor(scan: StaticScanResult): ChecklistItemResult[] {
  const out: ChecklistItemResult[] = [];
  const hits: ProtectedHit[] = scan.protectedHits ?? [];
  const deny = hits.filter((h) => h.tier === "deny");
  const review = hits.filter((h) => h.tier === "review");

  out.push(
    deny.length
      ? {
          itemKey: "BR-01",
          verdict: "fail",
          source: "floor",
          evidence: explainDeny(deny) ?? `${deny.length} deny-tier path hit(s)`,
        }
      : {
          itemKey: "BR-01",
          verdict: "pass",
          source: "floor",
          evidence: "No candidate file matches a deny-tier protected pattern.",
        }
  );

  // BR-02 is a human gate: the path layer can only say whether one is REQUIRED. It reports
  // `undetermined` when approval is needed, never `fail` — the approval may simply not have
  // been sought yet. `undetermined` still blocks, so nothing slips through.
  out.push(
    review.length
      ? {
          itemKey: "BR-02",
          verdict: "undetermined",
          source: "floor",
          evidence:
            `${review.length} review-tier path hit(s) require a named approver: ` +
            review.map((h) => h.path).slice(0, 3).join(", "),
        }
      : {
          itemKey: "BR-02",
          verdict: "not_applicable",
          source: "floor",
          evidence: "No review-tier path hit; no path-based approver required.",
        }
  );

  // Category-specific floor items. A deny hit in a given category fails the matching item,
  // so the reviewer sees WHICH rule blocked rather than only that something did.
  const byCategory = (category: string) => deny.filter((h) => h.category === category);
  const controlPlane = byCategory("control-plane");
  if (controlPlane.length) {
    out.push({
      itemKey: "SR-01",
      verdict: "fail",
      source: "floor",
      evidence:
        `Touches the control plane itself (${controlPlane[0].path}). The pipeline cannot ` +
        "modify the mechanism that decides whether its own modification is acceptable.",
    });
  }

  // BR-03/BR-04 are warns, and are the only two items the scan can measure numerically.
  const fileCount = scan.impactedPaths?.length ?? 0;
  out.push({
    itemKey: "BR-03",
    verdict: fileCount > 6 || (scan.impactedModules?.length ?? 0) > 2 ? "warn" : "pass",
    source: "static",
    evidence: `${fileCount} candidate file(s) across ${scan.impactedModules?.length ?? 0} module(s).`,
  });
  out.push({
    itemKey: "BR-04",
    verdict: scan.reverseDepMax > 25 ? "warn" : "pass",
    source: "static",
    evidence: `Highest reverse-dependency fan-in among candidates: ${scan.reverseDepMax}.`,
  });

  return out;
}

// ── Layer 2: capabilities ─────────────────────────────────────────────────────

/**
 * Verdicts derived from capability matches. This is the layer that catches the change whose
 * files look harmless but whose effect is an HR policy outcome — a leave carry-forward fix
 * trips no protected path and must still reach an HR policy owner.
 */
export function evaluateCapabilities(scan: StaticScanResult): ChecklistItemResult[] {
  const out: ChecklistItemResult[] = [];
  const hits: CapabilityHit[] = scan.capabilityHits ?? [];
  const worstClass = capabilityClassFor(hits);
  const denyHits = hits.filter((h) => h.class === "DENY");

  if (denyHits.length) {
    out.push({
      itemKey: "BR-01",
      verdict: "fail",
      source: "capability",
      evidence: explainCapabilityDeny(denyHits) ?? "A DENY-class capability matched.",
    });
  }

  // BR-02b — the approver requirement carried by the capability, not by the path.
  const roles = requiredApproverRoles(hits);
  out.push(
    roles.length
      ? {
          itemKey: "BR-02b",
          verdict: "undetermined",
          source: "capability",
          evidence:
            `Requires a decided approval from each of: ${roles.join(", ")}. ` +
            `Matched capabilities: ${[...new Set(hits.filter((h) => CAPABILITY_CLASS_RANK[h.class] >= CAPABILITY_CLASS_RANK.REVIEW).map((h) => h.capabilityName))].join(", ")}.`,
        }
      : {
          itemKey: "BR-02b",
          verdict: "not_applicable",
          source: "capability",
          evidence: "No capability at REVIEW or above matched; no capability approver required.",
        }
  );

  // Statutory and compliance items map onto specific capabilities. Absent a match the item
  // is not_applicable rather than pass — this layer has no evidence either way, and saying
  // "pass" would be claiming knowledge it does not have.
  const has = (key: string) => hits.some((h) => h.capabilityKey === key);
  out.push({
    itemKey: "CS-01",
    verdict: has("payroll_calculation") ? "fail" : "not_applicable",
    source: "capability",
    evidence: has("payroll_calculation")
      ? "Matches the payroll-calculation capability: statutory arithmetic is human-engineering only."
      : "No payroll-calculation capability matched.",
  });
  out.push({
    itemKey: "SR-01",
    verdict: has("auth_rbac") ? "fail" : "not_applicable",
    source: "capability",
    evidence: has("auth_rbac")
      ? "Matches the authentication/RBAC capability."
      : "No authentication/RBAC capability matched.",
  });
  out.push({
    itemKey: "CS-04",
    verdict: has("lms_integration") ? "fail" : "not_applicable",
    source: "capability",
    evidence: has("lms_integration")
      ? "Matches the LMS capability: the deployed LMS is a protected external system."
      : "No LMS capability matched.",
  });

  void worstClass;
  return out;
}

// ── Layer 3: DB rules (additive only) ─────────────────────────────────────────

export interface DbChecklistRule {
  itemKey: string;
  failureMode: "block" | "warn";
  isFloor: boolean;
  ruleVersion: number;
  evaluator: "static" | "llm" | "human" | "hybrid";
}

/** A verdict an LLM or a human supplied for one item. */
export interface SuppliedVerdict {
  itemKey: string;
  verdict: ChecklistVerdict;
  evidence: string;
  confidence?: number;
  source: Extract<ChecklistSource, "llm" | "human">;
}

/**
 * Turns DB rules plus supplied verdicts into results.
 *
 * `isFloor` rows are SKIPPED entirely rather than trusted: a floor item's verdict comes from
 * the JSON control plane, and reading the mirror row would create exactly the second source
 * of truth the mirror exists to avoid. A DB row can therefore never state an opinion on a
 * floor item at all, which is stronger than relying on the merge to discard it.
 *
 * A blocking rule with no supplied verdict is `undetermined`, never `pass`.
 */
export function evaluateDbRules(
  rules: DbChecklistRule[],
  supplied: SuppliedVerdict[]
): ChecklistItemResult[] {
  const byKey = new Map(supplied.map((s) => [s.itemKey, s]));
  const out: ChecklistItemResult[] = [];

  for (const rule of rules) {
    if (rule.isFloor) continue; // authoritative layer owns this item
    const s = byKey.get(rule.itemKey);
    if (!s) {
      out.push({
        itemKey: rule.itemKey,
        verdict: rule.failureMode === "block" ? "undetermined" : "pass",
        source: "db",
        evidence:
          rule.failureMode === "block"
            ? `No verdict was supplied for blocking item ${rule.itemKey}.`
            : `No verdict supplied for advisory item ${rule.itemKey}; treated as clear.`,
        ruleVersion: rule.ruleVersion,
      });
      continue;
    }
    // A `warn` rule can never produce a `fail`, however emphatic the supplied verdict.
    // Downgrading here — rather than at the gate — means the stored row says what the rule
    // could actually assert, so a later audit reads the same thing the gate saw.
    const verdict: ChecklistVerdict =
      rule.failureMode === "warn" && s.verdict === "fail" ? "warn" : s.verdict;
    out.push({
      itemKey: rule.itemKey,
      verdict,
      source: s.source,
      evidence: s.evidence,
      confidence: s.confidence,
      ruleVersion: rule.ruleVersion,
    });
  }

  return out;
}

// ── Merge and gate ────────────────────────────────────────────────────────────

/**
 * Merge every layer, worst-wins, per item. Monotone by construction: adding a layer can only
 * move an item's verdict up the severity order, never down. This is the function the
 * "an admin cannot loosen the floor" property rests on.
 */
export function mergeLayers(...layers: ChecklistItemResult[][]): ChecklistItemResult[] {
  const byKey = new Map<string, ChecklistItemResult>();
  for (const layer of layers) {
    for (const r of layer) {
      const existing = byKey.get(r.itemKey);
      byKey.set(r.itemKey, existing ? worstOf(existing, r) : r);
    }
  }
  return [...byKey.values()].sort((a, b) => a.itemKey.localeCompare(b.itemKey));
}

export interface ChecklistGate {
  /** "blocked" | "needs_approval" | "passed" — advisory in Phase 2; nothing dispatches. */
  outcome: "blocked" | "needs_approval" | "passed";
  effectiveRisk: PathTier;
  capabilityClass: CapabilityClass;
  requiredApproverRoles: string[];
  mandatoryTests: string[];
  results: ChecklistItemResult[];
  blockingReasons: string[];
  warnings: string[];
}

/**
 * The gate.
 *
 * `needs_approval` is deliberately NOT `passed`. Even an all-green checklist requires a human
 * decision — green is a recommendation, never a trigger — so the only outcome that means
 * "nothing further is required" is one where no item is outstanding AND no approver role is
 * demanded.
 */
export function gateFor(
  scan: StaticScanResult,
  results: ChecklistItemResult[],
  blockingItemKeys: Set<string>
): ChecklistGate {
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  let outstanding = false;

  for (const r of results) {
    if (r.verdict === "warn") {
      warnings.push(`${r.itemKey}: ${r.evidence}`);
      continue;
    }
    if (!blockingItemKeys.has(r.itemKey)) continue;
    if (r.verdict === "fail") blockingReasons.push(`${r.itemKey}: ${r.evidence}`);
    else if (r.verdict === "undetermined") outstanding = true;
  }

  const roles = requiredApproverRoles(scan.capabilityHits ?? []);

  // The scan's own verdict is a blocking reason in its own right, not merely an input to the
  // items. A deny that somehow produced no failing item must still block.
  if (scan.effectiveRisk === "deny" && blockingReasons.length === 0) {
    blockingReasons.push(
      scan.blockedReason ?? "Static scan classified this request as deny-tier."
    );
  }

  const outcome: ChecklistGate["outcome"] = blockingReasons.length
    ? "blocked"
    : outstanding || roles.length || PATH_TIER_RANK[scan.effectiveRisk] >= PATH_TIER_RANK.review
      ? "needs_approval"
      : "passed";

  return {
    outcome,
    effectiveRisk: scan.effectiveRisk,
    capabilityClass: scan.capabilityClass,
    requiredApproverRoles: roles,
    mandatoryTests: mandatoryTests(scan.capabilityHits ?? []),
    results,
    blockingReasons,
    warnings,
  };
}
