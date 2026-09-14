import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * employees.shift_rotation_type = 'frozen' is documented as "always gets the same
 * shift, never auto-reassigned" — but processEmployee's frozen branch computed
 * shiftTemplateId identically to the non-frozen branch (defaultShift?.id), so the
 * flag changed only decisionType/ruleApplied for the audit trail, never the actual
 * outcome. Live at audit time: 1,327 of 1,327 active employees were flagged frozen,
 * and 100% of shift-carrying assignment rows resolved to the single shift code "GEN"
 * — this wasn't an edge case, it was the only path the engine exercised.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { loadFrozenShiftAssignments } from "../roster-generation.service.js";

const source = readFileSync(resolve(__dirname, "../roster-generation.service.ts"), "utf-8");

describe("loadFrozenShiftAssignments", () => {
  beforeEach(() => execute.mockReset());

  it("maps each employee to the shift_template_id of their most recent prior assignment", async () => {
    execute.mockResolvedValue([
      [
        { employee_id: "emp-1", shift_template_id: "shift-ngt-001" },
        { employee_id: "emp-2", shift_template_id: "shift-eve-001" },
      ],
      [],
    ]);

    const shifts = await loadFrozenShiftAssignments(["emp-1", "emp-2"], "2026-08-17");

    expect(shifts.get("emp-1")).toBe("shift-ngt-001");
    expect(shifts.get("emp-2")).toBe("shift-eve-001");
  });

  it("only looks at assignments strictly before the cycle being generated", async () => {
    execute.mockResolvedValue([[], []]);
    await loadFrozenShiftAssignments(["emp-1"], "2026-08-17");
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/roster_date < \?/);
    expect(params).toContain("2026-08-17");
  });

  it("degrades to an empty map (falling back to defaultShift, today's exact behavior) when the lookup fails", () => {
    const fnStart = source.indexOf("async function loadFrozenShiftAssignments");
    const fnBody = source.slice(fnStart, fnStart + 1700);
    expect(fnBody).toMatch(/try \{[\s\S]*\} catch \(error\) \{/);
    expect(fnBody).toMatch(/console\.error\(/);
  });

  it("returns empty immediately for an empty employee list, without querying", async () => {
    const shifts = await loadFrozenShiftAssignments([], "2026-08-17");
    expect(shifts.size).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("processEmployee's frozen branch preserves the employee's prior shift", () => {
  function frozenBranch(): string {
    const idx = source.indexOf('emp.shift_rotation_type === "frozen"');
    expect(idx, "frozen branch not found").toBeGreaterThan(-1);
    return source.slice(idx, idx + 900);
  }

  it("reads from frozenShiftAssignments before falling back to defaultShift", () => {
    const branch = frozenBranch();
    expect(branch).toMatch(/frozenShiftAssignments\.get\(emp\.id\) \?\? defaultShift\?\.id \?\? null/);
  });

  it("no longer computes the identical defaultShift-only value the non-frozen branch does", () => {
    const branch = frozenBranch();
    // The old bug: this exact expression, unconditionally.
    expect(branch).not.toMatch(/shiftTemplateId = defaultShift\?\.id \?\? null;\s*\n\s*ruleApplied = "frozen_rotation";/);
  });

  it("generateForCycle loads and threads frozenShiftAssignments into processEmployee", () => {
    expect(source).toMatch(/const frozenShiftAssignments = await loadFrozenShiftAssignments\(/);
    expect(source).toMatch(/frozenShiftAssignments,\s*\n\s*shiftTemplates,/);
  });
});
