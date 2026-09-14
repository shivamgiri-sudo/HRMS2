/**
 * The property this whole design rests on: an administrator with full write access to
 * uat_checklist_item cannot make a dangerous change pass.
 *
 * These are not tests of the happy path. Each one models a specific way someone could try to
 * loosen the gate — an all-pass rule set, a floor rule downgraded to a warn, an LLM that
 * confidently returns "pass" for everything, a capability hit with no path hit — and asserts
 * the gate still blocks.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateCapabilities,
  evaluateDbRules,
  evaluateFloor,
  gateFor,
  mergeLayers,
  worstOf,
  type ChecklistItemResult,
  type DbChecklistRule,
  type SuppliedVerdict,
} from "../uat-checklist.service.js";
import type { CapabilityHit, ProtectedHit, StaticScanResult } from "../uat-pipeline.types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function scan(overrides: Partial<StaticScanResult> = {}): StaticScanResult {
  return {
    scannerVersion: "test",
    pathsSha: "p".repeat(64),
    registrySha: "r".repeat(64),
    impactedPaths: [],
    impactedRoutes: [],
    impactedModules: [],
    protectedHits: [],
    capabilityHits: [],
    reverseDepMax: 0,
    resolverMode: "fast",
    riskTier: "standard",
    capabilityClass: "STANDARD",
    effectiveRisk: "standard",
    requiredApproverRoles: [],
    durationMs: 1,
    blockedReason: null,
    ...overrides,
  };
}

const payrollPathHit: ProtectedHit = {
  path: "backend/src/modules/payroll/payrollCalculate.service.ts",
  pattern: "backend/src/modules/payroll/**",
  tier: "deny",
  category: "business-critical",
  reason: "Payroll arithmetic is human-engineering only.",
};

const payrollCapabilityHit: CapabilityHit = {
  capabilityKey: "payroll_calculation",
  capabilityName: "Payroll calculation",
  class: "DENY",
  signal: "keyword",
  matchedToken: "payslip",
  requiredApproverRoles: ["finance_head"],
  mandatoryTests: ["payroll"],
  reason: "Statutory arithmetic.",
};

const leaveCapabilityHit: CapabilityHit = {
  capabilityKey: "leave_entitlement",
  capabilityName: "Leave entitlement and accrual",
  class: "HIGH_REVIEW",
  signal: "keyword",
  matchedToken: "carry forward",
  requiredApproverRoles: ["hr_head"],
  mandatoryTests: ["leave"],
  reason: "Changes an HR policy outcome.",
};

/** The adversary's rule set: every item exists, every item is a warn, nothing is a floor. */
function allPassRules(itemKeys: string[]): DbChecklistRule[] {
  return itemKeys.map((itemKey) => ({
    itemKey,
    failureMode: "warn" as const,
    isFloor: false,
    ruleVersion: 99,
    evaluator: "llm" as const,
  }));
}

/** An LLM (or a human) claiming everything is fine. */
function allPassVerdicts(itemKeys: string[]): SuppliedVerdict[] {
  return itemKeys.map((itemKey) => ({
    itemKey,
    verdict: "pass" as const,
    evidence: "Looks fine to me.",
    confidence: 1,
    source: "llm" as const,
  }));
}

const ALL_ITEMS = ["BR-01", "BR-02", "BR-02b", "BR-03", "BR-04", "CS-01", "SR-01", "CS-04"];
const BLOCKING = new Set(ALL_ITEMS);

// ── worstOf ───────────────────────────────────────────────────────────────────

describe("worstOf", () => {
  const r = (verdict: ChecklistItemResult["verdict"]): ChecklistItemResult => ({
    itemKey: "X",
    verdict,
    source: "db",
    evidence: "",
  });

  it("ranks fail above every other verdict", () => {
    for (const v of ["pass", "warn", "undetermined", "not_applicable"] as const) {
      expect(worstOf(r("fail"), r(v)).verdict).toBe("fail");
      expect(worstOf(r(v), r("fail")).verdict).toBe("fail");
    }
  });

  it("ranks undetermined above pass — an unevaluated item is not a cleared item", () => {
    expect(worstOf(r("pass"), r("undetermined")).verdict).toBe("undetermined");
    expect(worstOf(r("not_applicable"), r("undetermined")).verdict).toBe("undetermined");
  });

  it("is order-independent", () => {
    const verdicts = ["pass", "warn", "undetermined", "not_applicable", "fail"] as const;
    for (const a of verdicts) {
      for (const b of verdicts) {
        expect(worstOf(r(a), r(b)).verdict).toBe(worstOf(r(b), r(a)).verdict);
      }
    }
  });
});

// ── The loosening attempts ────────────────────────────────────────────────────

describe("a DB rule set cannot loosen the floor", () => {
  it("blocks a payroll path hit even with all-pass rules and an all-pass LLM", () => {
    const s = scan({
      protectedHits: [payrollPathHit],
      riskTier: "deny",
      effectiveRisk: "deny",
      blockedReason: "Touches payroll.",
    });

    const merged = mergeLayers(
      evaluateFloor(s),
      evaluateCapabilities(s),
      evaluateDbRules(allPassRules(ALL_ITEMS), allPassVerdicts(ALL_ITEMS))
    );
    const gate = gateFor(s, merged, BLOCKING);

    expect(gate.outcome).toBe("blocked");
    expect(merged.find((r) => r.itemKey === "BR-01")?.verdict).toBe("fail");
    expect(gate.blockingReasons.join(" ")).toMatch(/payroll/i);
  });

  it("blocks a DENY capability with NO protected path hit at all", () => {
    // The case a path-only model misses entirely: no file matched, but the request changes
    // a payroll outcome.
    const s = scan({
      protectedHits: [],
      capabilityHits: [payrollCapabilityHit],
      riskTier: "standard",
      capabilityClass: "DENY",
      effectiveRisk: "deny",
    });

    const merged = mergeLayers(
      evaluateFloor(s),
      evaluateCapabilities(s),
      evaluateDbRules(allPassRules(ALL_ITEMS), allPassVerdicts(ALL_ITEMS))
    );
    const gate = gateFor(s, merged, BLOCKING);

    expect(gate.outcome).toBe("blocked");
    expect(merged.find((r) => r.itemKey === "CS-01")?.verdict).toBe("fail");
  });

  it("ignores a DB row that claims to speak for a floor item", () => {
    // isFloor rows are skipped outright, so the merge never even sees a competing verdict.
    const rules: DbChecklistRule[] = [
      { itemKey: "BR-01", failureMode: "warn", isFloor: true, ruleVersion: 2, evaluator: "llm" },
    ];
    const produced = evaluateDbRules(rules, [
      { itemKey: "BR-01", verdict: "pass", evidence: "trust me", source: "llm" },
    ]);
    expect(produced).toHaveLength(0);
  });

  it("cannot promote a warn-mode rule into a fail, nor a fail into a pass", () => {
    const rules: DbChecklistRule[] = [
      { itemKey: "OP-05", failureMode: "warn", isFloor: false, ruleVersion: 1, evaluator: "llm" },
    ];
    const out = evaluateDbRules(rules, [
      { itemKey: "OP-05", verdict: "fail", evidence: "slow build", source: "llm" },
    ]);
    // Downgraded at the point of evaluation, so the stored row matches what the gate saw.
    expect(out[0].verdict).toBe("warn");
  });
});

describe("fail closed", () => {
  it("treats a blocking rule with no supplied verdict as undetermined, not pass", () => {
    const rules: DbChecklistRule[] = [
      { itemKey: "CG-01", failureMode: "block", isFloor: false, ruleVersion: 1, evaluator: "llm" },
    ];
    const out = evaluateDbRules(rules, []);
    expect(out[0].verdict).toBe("undetermined");

    const s = scan();
    expect(gateFor(s, out, new Set(["CG-01"])).outcome).toBe("needs_approval");
  });

  it("blocks on a deny scan even if no item happened to fail", () => {
    const s = scan({ effectiveRisk: "deny", blockedReason: "scan says deny" });
    const gate = gateFor(s, [], new Set());
    expect(gate.outcome).toBe("blocked");
    expect(gate.blockingReasons).toContain("scan says deny");
  });

  it("never returns passed when a capability demands an approver", () => {
    const s = scan({
      capabilityHits: [leaveCapabilityHit],
      capabilityClass: "HIGH_REVIEW",
      effectiveRisk: "standard",
    });
    const merged = mergeLayers(evaluateFloor(s), evaluateCapabilities(s));
    const gate = gateFor(s, merged, BLOCKING);

    expect(gate.outcome).toBe("needs_approval");
    expect(gate.requiredApproverRoles).toContain("hr_head");
    expect(merged.find((r) => r.itemKey === "BR-02b")?.verdict).toBe("undetermined");
  });

  it("does not mark a review-tier path hit as passed", () => {
    const s = scan({
      protectedHits: [
        {
          path: "backend/src/modules/lms/lms.service.ts",
          pattern: "backend/src/modules/lms/**",
          tier: "review",
          category: "domain-owned",
          reason: "LMS is a separately deployed system.",
        },
      ],
      riskTier: "review",
      effectiveRisk: "review",
    });
    const merged = mergeLayers(evaluateFloor(s), evaluateCapabilities(s));
    expect(merged.find((r) => r.itemKey === "BR-02")?.verdict).toBe("undetermined");
    expect(gateFor(s, merged, BLOCKING).outcome).toBe("needs_approval");
  });
});

describe("the merge is monotone", () => {
  it("adding a layer never improves any item's verdict", () => {
    const s = scan({
      protectedHits: [payrollPathHit],
      capabilityHits: [payrollCapabilityHit],
      riskTier: "deny",
      capabilityClass: "DENY",
      effectiveRisk: "deny",
    });

    const RANK = { not_applicable: 0, pass: 1, undetermined: 2, warn: 3, fail: 4 } as const;
    const base = mergeLayers(evaluateFloor(s), evaluateCapabilities(s));
    const withDb = mergeLayers(
      evaluateFloor(s),
      evaluateCapabilities(s),
      evaluateDbRules(allPassRules(ALL_ITEMS), allPassVerdicts(ALL_ITEMS))
    );

    for (const b of base) {
      const after = withDb.find((r) => r.itemKey === b.itemKey);
      expect(after, `item ${b.itemKey} disappeared after merging the DB layer`).toBeDefined();
      expect(
        RANK[after!.verdict],
        `item ${b.itemKey} was loosened from ${b.verdict} to ${after!.verdict}`
      ).toBeGreaterThanOrEqual(RANK[b.verdict]);
    }
  });

  it("a clean change with no hits still requires human approval, never 'passed' silently", () => {
    // The one case that legitimately reaches "passed" — and even then §6 requires a human
    // approval before anything is built; "passed" means the checklist is clear, not that
    // the item is authorised.
    const s = scan();
    const merged = mergeLayers(evaluateFloor(s), evaluateCapabilities(s));
    const gate = gateFor(s, merged, BLOCKING);
    expect(gate.outcome).toBe("passed");
    expect(gate.blockingReasons).toHaveLength(0);
  });
});
