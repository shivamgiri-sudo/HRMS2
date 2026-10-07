import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const src = fs.readFileSync(
  path.resolve(__dirname, "../employee-reactivation.routes.ts"),
  "utf8",
);

describe("reactivation F&F-paid lookup", () => {
  it("reads full_final_calculation.ff_paid_at, not the non-existent exit_requests.ff_settlement_paid_on", () => {
    expect(src).not.toContain("exit_requests");
    expect(src).not.toContain("ff_settlement_paid_on");
    expect(src).toContain(
      "SELECT IF(ff_paid_at IS NOT NULL, 1, 0) as ff_paid FROM full_final_calculation WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1",
    );
  });
});
