import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Two queries that share a cache key share ONE cache entry — whichever fetch lands last decides
 * its shape. The apply form stores raw balance rows and useLeaveBalances stores mapped ones, and
 * they once shared ["leave-balances", employeeId, year]: submitting a request made the balance
 * cards read raw rows and crash the page. Keep their keys distinct.
 */
const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");

describe("leave balance query keys", () => {
  it("the apply form does not reuse useLeaveBalances' cache key", () => {
    const form = read("components/profile/LeaveRequestForm.tsx");
    const hook = read("hooks/useLeaveBalances.ts");
    expect(hook).toMatch(/queryKey:\s*\["leave-balances", employeeId, currentYear\]/);
    expect(form).not.toMatch(/queryKey:\s*\["leave-balances", employeeId, currentYear\]/);
    expect(form).toMatch(/queryKey:\s*\["leave-balances", employeeId, currentYear, "ledger"\]/);
  });
});
