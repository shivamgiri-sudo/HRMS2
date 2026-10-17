import { describe, expect, it } from "vitest";
import { pendingItems, summarisePending } from "../bgv-pending-items.js";

const base = { includeEmployment: false, includeCriminal: false, addressAttempt: null as string | null };

describe("pendingItems", () => {
  it("names what is missing and who acts", () => {
    const items = pendingItems({
      ...base,
      checks: [{ check_type: "digilocker", status: "verified" }, { check_type: "bank", status: "manual_review" }],
      report: { education: "not_run", address: "not_run" },
      addressAttempt: "submitted",
    });
    // Education is not applicable (owner decision 2026-10-17) and is never listed.
    expect(items.map((i) => i.category)).toEqual(["bank", "address"]);
    expect(items[0].owner).toBe("payroll");
    expect(items[1].owner).toBe("hr");
    expect(items[1].action).toMatch(/HR to decide/);
    expect(summarisePending(items)).toMatch(/^2 pending: Bank \(/);
  });
  it("DigiLocker covers Aadhaar and PAN; manual report columns count", () => {
    const items = pendingItems({
      ...base,
      checks: [{ check_type: "digilocker", status: "verified" }, { check_type: "bank", status: "verified" }],
      report: { education: "passed", address: "passed" },
    });
    expect(items).toEqual([]);
    expect(summarisePending(items)).toMatch(/Checks complete/);
  });
  it("includes employment and criminal only when applicable", () => {
    const checks = [{ check_type: "digilocker", status: "verified" }, { check_type: "bank", status: "verified" }];
    const report = { education: "passed", address: "passed" };
    expect(pendingItems({ ...base, checks, report })).toHaveLength(0);
    const both = pendingItems({ ...base, includeEmployment: true, includeCriminal: true, checks, report });
    expect(both.map((i) => i.category)).toEqual(["employment", "criminal"]);
  });
  it("summary never contains a comma inside an item (the drawer splits on commas)", () => {
    const items = pendingItems({ ...base, checks: [], report: null });
    for (const i of items) expect(i.action).not.toContain(",");
  });
});
