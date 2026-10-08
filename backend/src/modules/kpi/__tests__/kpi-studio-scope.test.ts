import { describe, expect, it } from "vitest";
import {
  classifyScope,
  scopeMatchesEmployee,
  pickWinningDefinitions,
  validateDefinition,
  type EmployeeOrgContext,
} from "../kpi-studio.service.js";

/**
 * Scope precedence decides which target and which formula a real person is measured against, so it
 * is the part of the Studio where a subtle bug does the most damage and shows up latest: a wrong
 * winner produces a plausible number against the wrong target, which nobody notices until an
 * appraisal.
 *
 * These are pure functions on purpose, so the rule can be exercised exhaustively here rather than
 * inferred from integration behaviour.
 */

const BRANCH = "branch-noida";
const OTHER_BRANCH = "branch-mumbai";
const PROCESS = "process-onfido";
const OTHER_PROCESS = "process-housing";
const DESIGNATION = "desig-executive";
const OTHER_DESIGNATION = "desig-team-leader";

const agent: EmployeeOrgContext = {
  id: "emp-1",
  branch_id: BRANCH,
  process_id: PROCESS,
  designation_id: DESIGNATION,
};

describe("classifyScope", () => {
  it("ranks an employee-scoped row above everything else", () => {
    expect(classifyScope({ employee_id: "emp-1" })).toEqual({ tier: 0, label: "employee" });
  });

  it("treats an employee row as tier 0 even when it also names org units", () => {
    // A row naming both a person and their process is not more specific than one naming the person:
    // it is the same single human, plus a redundant condition that would make the row stop applying
    // the day they transfer. Ranking it differently would make a transfer silently change someone's
    // target.
    expect(classifyScope({ employee_id: "emp-1", process_id: PROCESS })).toEqual({
      tier: 0,
      label: "employee",
    });
  });

  it("ranks org-unit combinations from most to least specific", () => {
    expect(classifyScope({ branch_id: BRANCH, process_id: PROCESS, designation_id: DESIGNATION }))
      .toEqual({ tier: 1, label: "branch+process+designation" });
    expect(classifyScope({ process_id: PROCESS, designation_id: DESIGNATION }))
      .toEqual({ tier: 2, label: "process+designation" });
    expect(classifyScope({ branch_id: BRANCH, process_id: PROCESS }))
      .toEqual({ tier: 3, label: "branch+process" });
    expect(classifyScope({ process_id: PROCESS })).toEqual({ tier: 4, label: "process" });
    expect(classifyScope({ branch_id: BRANCH, designation_id: DESIGNATION }))
      .toEqual({ tier: 5, label: "branch+designation" });
    expect(classifyScope({ designation_id: DESIGNATION })).toEqual({ tier: 6, label: "designation" });
    expect(classifyScope({ branch_id: BRANCH })).toEqual({ tier: 7, label: "branch" });
  });

  it("ranks process above designation", () => {
    // The same job title on two processes shares almost no metrics — a TEAM LEADER on a voice
    // process and on a back-office process are measured on different things — whereas one process
    // across designations at least shares a metric set. So process must win.
    const byProcess = classifyScope({ process_id: PROCESS })!;
    const byDesignation = classifyScope({ designation_id: DESIGNATION })!;
    expect(byProcess.tier).toBeLessThan(byDesignation.tier);
  });

  it("returns null when nothing is scoped", () => {
    expect(classifyScope({})).toBeNull();
    expect(classifyScope({ branch_id: null, process_id: null, designation_id: null, employee_id: null })).toBeNull();
  });
});

describe("scopeMatchesEmployee", () => {
  it("matches when every named dimension agrees", () => {
    expect(scopeMatchesEmployee({ process_id: PROCESS }, agent)).toBe(true);
    expect(scopeMatchesEmployee({ branch_id: BRANCH, process_id: PROCESS }, agent)).toBe(true);
    expect(
      scopeMatchesEmployee({ branch_id: BRANCH, process_id: PROCESS, designation_id: DESIGNATION }, agent),
    ).toBe(true);
  });

  it("treats an absent dimension as 'any', not as 'none'", () => {
    // The opposite reading would make a process-wide target apply to nobody, since no definition
    // names every dimension.
    expect(scopeMatchesEmployee({ process_id: PROCESS }, { ...agent, branch_id: OTHER_BRANCH })).toBe(true);
  });

  it("rejects when any named dimension disagrees", () => {
    expect(scopeMatchesEmployee({ process_id: OTHER_PROCESS }, agent)).toBe(false);
    expect(scopeMatchesEmployee({ branch_id: OTHER_BRANCH, process_id: PROCESS }, agent)).toBe(false);
    expect(scopeMatchesEmployee({ designation_id: OTHER_DESIGNATION }, agent)).toBe(false);
  });

  it("matches an employee-scoped row only for that employee, ignoring org units", () => {
    expect(scopeMatchesEmployee({ employee_id: "emp-1" }, agent)).toBe(true);
    expect(scopeMatchesEmployee({ employee_id: "emp-2" }, agent)).toBe(false);
    // Still theirs after a transfer — which is the point of scoping to a person.
    expect(
      scopeMatchesEmployee({ employee_id: "emp-1" }, { ...agent, process_id: OTHER_PROCESS, branch_id: OTHER_BRANCH }),
    ).toBe(true);
  });

  it("refuses a completely unscoped row even if one reached the database", () => {
    expect(scopeMatchesEmployee({}, agent)).toBe(false);
  });

  it("does not match an employee whose org unit is null against a scoped definition", () => {
    const unassigned: EmployeeOrgContext = { id: "emp-9", branch_id: null, process_id: null, designation_id: null };
    expect(scopeMatchesEmployee({ process_id: PROCESS }, unassigned)).toBe(false);
  });
});

describe("pickWinningDefinitions", () => {
  const metric = "metric-aht";

  it("picks the most specific matching definition for a metric", () => {
    const winners = pickWinningDefinitions(
      [
        { metric_id: metric, process_id: PROCESS, target: "process" },
        { metric_id: metric, process_id: PROCESS, designation_id: DESIGNATION, target: "process+designation" },
        { metric_id: metric, branch_id: BRANCH, target: "branch" },
      ],
      agent,
    );
    expect(winners).toHaveLength(1);
    expect((winners[0].definition as any).target).toBe("process+designation");
    expect(winners[0].label).toBe("process+designation");
  });

  it("lets a per-employee definition beat a process-wide one", () => {
    // The case that matters in practice: a target agreed with one person during a PIP must not be
    // silently overwritten when somebody edits the process default.
    const winners = pickWinningDefinitions(
      [
        { metric_id: metric, process_id: PROCESS, target: "process" },
        { metric_id: metric, employee_id: "emp-1", target: "employee" },
      ],
      agent,
    );
    expect((winners[0].definition as any).target).toBe("employee");
    expect(winners[0].tier).toBe(0);
  });

  it("ignores definitions that do not match the employee at all", () => {
    const winners = pickWinningDefinitions(
      [
        { metric_id: metric, process_id: OTHER_PROCESS, target: "other process" },
        { metric_id: metric, employee_id: "emp-2", target: "other person" },
      ],
      agent,
    );
    expect(winners).toHaveLength(0);
  });

  it("resolves each metric independently", () => {
    const winners = pickWinningDefinitions(
      [
        { metric_id: "metric-aht", process_id: PROCESS, target: "aht" },
        { metric_id: "metric-quality", designation_id: DESIGNATION, target: "quality" },
      ],
      agent,
    );
    expect(winners).toHaveLength(2);
    expect(winners.map((w) => (w.definition as any).target).sort()).toEqual(["aht", "quality"]);
  });

  it("breaks a tie on the same tier by the later start date", () => {
    // Two rows at the same specificity can only differ by when they start, and the later decision
    // is the current one.
    const winners = pickWinningDefinitions(
      [
        { metric_id: metric, process_id: PROCESS, effective_from: "2026-01-01", target: "old" },
        { metric_id: metric, process_id: PROCESS, effective_from: "2026-07-01", target: "new" },
      ],
      agent,
    );
    expect((winners[0].definition as any).target).toBe("new");
  });

  it("is not sensitive to the order rows arrive in", () => {
    const rows = [
      { metric_id: metric, branch_id: BRANCH, target: "branch" },
      { metric_id: metric, employee_id: "emp-1", target: "employee" },
      { metric_id: metric, process_id: PROCESS, designation_id: DESIGNATION, target: "process+designation" },
      { metric_id: metric, process_id: PROCESS, target: "process" },
    ];
    const forward = pickWinningDefinitions(rows, agent);
    const backward = pickWinningDefinitions([...rows].reverse(), agent);
    expect((forward[0].definition as any).target).toBe("employee");
    expect((backward[0].definition as any).target).toBe("employee");
  });
});

describe("validateDefinition", () => {
  const metricId = "metric-aht";
  const lowerBetter = { unit: "seconds", direction: "lower_is_better" };
  const higherBetter = { unit: "percent", direction: "higher_is_better" };

  it("accepts a target-only definition with no formula", () => {
    // The backwards-compatible shape: score the actuals an existing sync already writes. All 372
    // of today's configured targets are this shape, so rejecting it would break every one.
    const result = validateDefinition(
      { metric_id: metricId, process_id: PROCESS, target_value: 240 },
      { metric: lowerBetter },
    );
    expect(result.ok).toBe(true);
  });

  it("requires a KPI", () => {
    expect(validateDefinition({ metric_id: "", process_id: PROCESS }).ok).toBe(false);
  });

  it("refuses a definition with no scope", () => {
    // An unscoped row applies to every employee in the company, outranking nothing and outranked
    // by nothing.
    const result = validateDefinition({ metric_id: metricId, target_value: 240 });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("at least a branch, process, designation or employee");
  });

  it("refuses a formula with no data source", () => {
    // It would validate, save, then produce null for every employee for ever — indistinguishable
    // from a source outage.
    const result = validateDefinition(
      { metric_id: metricId, process_id: PROCESS, formula_expression: "talk_seconds / calls" },
      { availableFields: ["talk_seconds", "calls"], metric: lowerBetter },
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("needs a data source");
  });

  it("refuses a formula referencing a field the source does not provide", () => {
    const result = validateDefinition(
      {
        metric_id: metricId,
        process_id: PROCESS,
        data_source_id: "src-1",
        formula_expression: "talk_seconds / mystery",
      },
      { availableFields: ["talk_seconds", "calls"], metric: lowerBetter },
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("mystery");
  });

  it("accepts a valid formula and reports the fields it reads", () => {
    const result = validateDefinition(
      {
        metric_id: metricId,
        process_id: PROCESS,
        data_source_id: "src-1",
        formula_expression: "SAFE_DIV(talk_seconds + dispo_seconds, calls)",
        target_value: 240,
      },
      { availableFields: ["talk_seconds", "dispo_seconds", "calls"], metric: lowerBetter },
    );
    expect(result.ok).toBe(true);
    expect(result.variables).toEqual(["talk_seconds", "dispo_seconds", "calls"]);
  });

  it("rejects a percentage target above 100", () => {
    const result = validateDefinition(
      { metric_id: metricId, process_id: PROCESS, target_value: 150 },
      { metric: higherBetter },
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("above 100");
  });

  it("rejects a negative target", () => {
    expect(
      validateDefinition({ metric_id: metricId, process_id: PROCESS, target_value: -5 }, { metric: lowerBetter }).ok,
    ).toBe(false);
  });

  it("requires the threshold on the worse side of the target when lower is better", () => {
    // AHT: a 360s ceiling under a 240s goal is right; 180 would gate on the wrong side and zero
    // everyone performing well.
    expect(
      validateDefinition(
        { metric_id: metricId, process_id: PROCESS, target_value: 240, min_threshold: 360 },
        { metric: lowerBetter },
      ).ok,
    ).toBe(true);

    const wrongSide = validateDefinition(
      { metric_id: metricId, process_id: PROCESS, target_value: 240, min_threshold: 180 },
      { metric: lowerBetter },
    );
    expect(wrongSide.ok).toBe(false);
    expect(wrongSide.message).toContain("must be above the target");
  });

  it("requires the threshold below the target when higher is better", () => {
    expect(
      validateDefinition(
        { metric_id: metricId, process_id: PROCESS, target_value: 95, min_threshold: 85 },
        { metric: higherBetter },
      ).ok,
    ).toBe(true);

    const wrongSide = validateDefinition(
      { metric_id: metricId, process_id: PROCESS, target_value: 85, min_threshold: 95 },
      { metric: higherBetter },
    );
    expect(wrongSide.ok).toBe(false);
    expect(wrongSide.message).toContain("must be below the target");
  });

  it("rejects a weight outside 0-100", () => {
    expect(
      validateDefinition({ metric_id: metricId, process_id: PROCESS, weightage: 150 }, { metric: lowerBetter }).ok,
    ).toBe(false);
    expect(
      validateDefinition({ metric_id: metricId, process_id: PROCESS, weightage: -1 }, { metric: lowerBetter }).ok,
    ).toBe(false);
  });

  it("rejects an unknown roll-up method", () => {
    const result = validateDefinition(
      { metric_id: metricId, process_id: PROCESS, aggregation_method: "median" },
      { metric: lowerBetter },
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Roll-up must be one of");
  });

  it("rejects a malformed start date", () => {
    expect(
      validateDefinition({ metric_id: metricId, process_id: PROCESS, effective_from: "01/07/2026" }).ok,
    ).toBe(false);
  });

  it("allows a definition with no target at all", () => {
    // A KPI can be tracked before anyone agrees what good looks like. Forcing a placeholder would
    // create a fake target that then scores people.
    expect(validateDefinition({ metric_id: metricId, process_id: PROCESS }, { metric: lowerBetter }).ok).toBe(true);
  });
});
