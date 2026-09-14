import { describe, it, expect } from "vitest";
import {
  ALL_STATUSES,
  LEGAL_TRANSITIONS,
  NO_FIX_SHIPPED_STATES,
  assertTransition,
  canTransition,
  isTerminal,
} from "../uat-state-machine.js";
import type { UatStatus } from "../uat-pipeline.types.js";

/** Every simple path from `from` to `to`, so we can assert what they must pass through. */
function allSimplePaths(from: UatStatus, to: UatStatus): UatStatus[][] {
  const out: UatStatus[][] = [];
  const walk = (node: UatStatus, path: UatStatus[]) => {
    if (node === to) {
      out.push(path);
      return;
    }
    for (const next of LEGAL_TRANSITIONS[node]) {
      if (path.includes(next)) continue; // no cycles
      walk(next, [...path, next]);
    }
  };
  walk(from, [from]);
  return out;
}

describe("uat state machine — graph integrity", () => {
  it("every target status is itself a declared status", () => {
    for (const [from, targets] of Object.entries(LEGAL_TRANSITIONS)) {
      for (const t of targets) {
        expect(ALL_STATUSES, `${from} -> ${t} targets an undeclared status`).toContain(t);
      }
    }
  });

  it("declares exactly one terminal state: closed", () => {
    expect(ALL_STATUSES.filter(isTerminal)).toEqual(["closed"]);
  });

  it("every status except submitted is reachable from submitted", () => {
    const seen = new Set<UatStatus>(["submitted"]);
    const queue: UatStatus[] = ["submitted"];
    while (queue.length) {
      for (const next of LEGAL_TRANSITIONS[queue.shift()!]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    const unreachable = ALL_STATUSES.filter((s) => !seen.has(s));
    expect(unreachable, `unreachable states: ${unreachable.join(", ")}`).toEqual([]);
  });

  it("rejects an illegal transition rather than silently allowing it", () => {
    expect(canTransition("submitted", "merged")).toBe(false);
    expect(() => assertTransition("submitted", "merged")).toThrow(/Illegal UAT status transition/);
    expect(() => assertTransition("closed", "triaged")).toThrow();
  });
});

describe("uat state machine — invariant 1: approval gates every pipeline PR", () => {
  it("no path from submitted to pr_open avoids awaiting_approval", () => {
    const paths = allSimplePaths("submitted", "pr_open");
    expect(paths.length, "expected at least one path to pr_open").toBeGreaterThan(0);
    const offending = paths.filter((p) => !p.includes("awaiting_approval"));
    expect(
      offending,
      `these paths reach a pipeline PR with nobody approving one:\n` +
        offending.map((p) => "  " + p.join(" -> ")).join("\n")
    ).toEqual([]);
  });

  it("reopened cannot re-enter the build loop directly", () => {
    // The short-cut reopened -> build_queued would create exactly the path invariant 1 bans:
    // a hand-engineered fix that fails retest could then produce a pipeline PR unapproved.
    expect(canTransition("reopened", "build_queued")).toBe(false);
    expect(LEGAL_TRANSITIONS.reopened).toContain("triaged");
  });
});

describe("uat state machine — invariant 2: a shipped fix closes only after retest", () => {
  it("no path reaches production_verified without retest_passed", () => {
    // This, not "closed", is where the invariant bites. Reaching `closed` by other routes is
    // legitimate — a reopened or rolled-back item is closed as NOT delivered, and forbidding
    // that would strand every withdrawn or won't-fix item permanently open. What must never
    // happen is an item being marked verified in production having never passed a retest.
    const paths = allSimplePaths("submitted", "production_verified");
    expect(paths.length, "expected at least one path to production_verified").toBeGreaterThan(0);
    const offending = paths.filter((p) => !p.includes("retest_passed"));
    expect(
      offending,
      `these paths verify a fix in production that never passed a retest:\n` +
        offending.map((p) => "  " + p.join(" -> ")).join("\n")
    ).toEqual([]);
  });

  it("a merged fix is always retested one way or the other before it can close", () => {
    const paths = allSimplePaths("submitted", "closed").filter((p) => p.includes("merged"));
    expect(paths.length).toBeGreaterThan(0);
    const unretested = paths.filter(
      (p) => !p.includes("retest_passed") && !p.includes("retest_failed")
    );
    expect(
      unretested,
      `a fix shipped and closed without any retest outcome:\n` +
        unretested.map((p) => "  " + p.join(" -> ")).join("\n")
    ).toEqual([]);
  });

  it("closed is reachable directly only from no-fix-shipped states or production_verified", () => {
    const predecessors = ALL_STATUSES.filter((s) => LEGAL_TRANSITIONS[s].includes("closed"));
    const allowed = new Set<UatStatus>([...NO_FIX_SHIPPED_STATES, "production_verified"]);
    const unexpected = predecessors.filter((s) => !allowed.has(s));
    expect(unexpected, `unexpected direct predecessors of closed: ${unexpected.join(", ")}`).toEqual([]);
  });

  it("production_verified is the only way a released fix reaches closed", () => {
    expect(LEGAL_TRANSITIONS.production_released).toContain("production_verified");
    expect(LEGAL_TRANSITIONS.production_released).not.toContain("closed");
    expect(LEGAL_TRANSITIONS.merged).toEqual(["deployed_to_uat"]);
  });
});

describe("uat state machine — lifecycle completeness", () => {
  it("supports the Phase 1 manual path end to end, with no LLM or build states", () => {
    const manual: UatStatus[] = [
      "submitted", "scanning", "scan_done", "triaged", "merged",
      "deployed_to_uat", "ready_for_retest", "retest_passed",
      "production_released", "production_verified", "closed",
    ];
    for (let i = 0; i < manual.length - 1; i++) {
      expect(
        canTransition(manual[i], manual[i + 1]),
        `Phase 1 manual path breaks at ${manual[i]} -> ${manual[i + 1]}`
      ).toBe(true);
    }
  });

  it("a failed retest reopens rather than closing", () => {
    expect(canTransition("ready_for_retest", "retest_failed")).toBe(true);
    expect(canTransition("retest_failed", "reopened")).toBe(true);
    expect(canTransition("retest_failed", "closed")).toBe(false);
  });

  it("a production regression routes to rollback, not to an ordinary reopen", () => {
    expect(canTransition("production_released", "rollback_required")).toBe(true);
    expect(canTransition("rollback_required", "rolled_back")).toBe(true);
    expect(canTransition("rolled_back", "reopened")).toBe(true);
    expect(canTransition("production_released", "reopened")).toBe(false);
  });

  it("a deny-tier scan can never re-enter the automated path", () => {
    expect(LEGAL_TRANSITIONS.scan_blocked).toEqual(["triaged", "closed"]);
    for (const forbidden of ["validating", "prompt_writing", "build_queued"] as UatStatus[]) {
      expect(canTransition("scan_blocked", forbidden)).toBe(false);
    }
  });
});
