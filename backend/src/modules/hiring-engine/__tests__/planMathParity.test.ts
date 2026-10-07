// The backend planning maths against the SAME case table the frontend copy (src/pages/hiring-engine/command/planMath.ts) runs.
import { describe, expect, it } from "vitest";
import { calendarCells, planDay, streamRate, whatIf } from "../he-drive-plan.js";
import { invitesToClose } from "../he-showup.js";
import { PLAN_MATH_CASES } from "../../../../../src/pages/hiring-engine/__tests__/fixtures/planMathCases.js";

describe("planning maths: shared case table (backend)", () => {
  it("has cases for every function", () => {
    expect(new Set(PLAN_MATH_CASES.map((c) => c.fn))).toEqual(new Set(["planDay", "whatIf", "streamRate", "invitesToClose", "calendarCells"]));
  });
  it.each(PLAN_MATH_CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const got = c.fn === "planDay" ? planDay(c.input as never)
      : c.fn === "whatIf" ? whatIf(c.base as never, c.edits as never)
        : c.fn === "streamRate" ? streamRate(c.input as never)
          : c.fn === "invitesToClose" ? invitesToClose(...c.args)
            : calendarCells(c.days as never);
    expect(got).toEqual(c.expected);
    expect(JSON.stringify(got)).not.toMatch(/NaN|Infinity/);
  });
});
