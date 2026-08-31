import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("dispute creation — cycle status gate", () => {
  it("dispute route fetches weekly_roster_cycle status before allowing dispute", () => {
    const src = readFileSync(
      resolve("src/modules/roster/roster.governance.routes.ts"),
      "utf8"
    );
    const disputeHandlerStart = src.indexOf("assignments/:id/dispute");
    const disputeHandlerEnd = src.indexOf("}));", disputeHandlerStart) + 4;
    const handler = src.slice(disputeHandlerStart, disputeHandlerEnd);

    expect(handler).toMatch(/weekly_roster_cycle/);
    expect(handler).toMatch(/attendance_locked|payroll_input_ready|closed/);
  });

  it("DISPUTE_LOCKED_STATUSES constant covers all three locked states", () => {
    const src = readFileSync(
      resolve("src/modules/roster/roster.governance.routes.ts"),
      "utf8"
    );
    expect(src).toMatch(/DISPUTE_LOCKED_STATUSES/);
    expect(src).toMatch(/"attendance_locked"/);
    expect(src).toMatch(/"payroll_input_ready"/);
    expect(src).toMatch(/"closed"/);
  });
});
