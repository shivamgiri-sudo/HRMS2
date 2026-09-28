import { describe, expect, it } from "vitest";
import { forViewer, type WarningRecord } from "../warnings.pure";

const record: WarningRecord = {
  id: "w1",
  employeeId: "e1",
  warningDate: "2026-09-20",
  category: "conduct",
  severity: "written",
  description: "Late 3 times",
  remarks: "Discussed with HR",
  status: "active",
  issuedByName: "tl@x.com",
  withdrawnAt: null,
  withdrawnByName: null,
  withdrawnReason: null,
  createdAt: "2026-09-20 10:00",
};

describe("forViewer", () => {
  it("hides the issuer's internal remarks from the employee", () => {
    expect(forViewer([record], "self")[0].remarks).toBeNull();
    expect(forViewer([record], "self")[0].description).toBe("Late 3 times");
  });

  it("shows remarks to HR and the reporting line", () => {
    expect(forViewer([record], "hr")[0].remarks).toBe("Discussed with HR");
    expect(forViewer([record], "span")[0].remarks).toBe("Discussed with HR");
  });
});
