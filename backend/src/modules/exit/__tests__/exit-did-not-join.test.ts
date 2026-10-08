import { describe, it, expect } from "vitest";
import { employmentStatusForExit, TERMINAL_EXIT_STATUSES, NON_REACTIVATABLE_STATUSES } from "../exitEmploymentStatus.js";
import { createExitRequestSchema } from "../exit.validation.js";

describe("did_not_join exit sub-type", () => {
  it("maps to the not_joined terminal employment status", () => {
    expect(employmentStatusForExit("involuntary", "did_not_join")).toBe("not_joined");
  });

  it("is included in the terminal/non-reactivatable guard lists", () => {
    expect(TERMINAL_EXIT_STATUSES).toContain("not_joined");
    expect(NON_REACTIVATABLE_STATUSES).toContain("not_joined");
  });

  it("createExitRequestSchema accepts did_not_join and does not require abscondingSince", () => {
    const parsed = createExitRequestSchema.parse({
      employeeId: "11111111-1111-1111-1111-111111111111",
      exitDate: "2026-09-22",
      exitType: "involuntary",
      exitSubType: "did_not_join",
    });
    expect(parsed.exitSubType).toBe("did_not_join");
  });
});
