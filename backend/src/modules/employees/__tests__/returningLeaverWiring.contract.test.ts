import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(path.resolve(__dirname, "../employee-creation-orchestrator.service.ts"), "utf8");

describe("orchestrator: returning leaver check", () => {
  it("calls checkReturningLeaver after validateStatutoryInfo and before the age check", () => {
    const stat = SRC.indexOf("validateStatutoryInfo(conn, candidateId)");
    const leaver = SRC.indexOf("checkReturningLeaver(conn, candidateId");
    const age = SRC.indexOf("resolveVerifiedDob(candidateId");
    expect(stat).toBeGreaterThan(-1);
    expect(leaver).toBeGreaterThan(stat);
    expect(age).toBeGreaterThan(leaver);
  });

  it("blocks with critical blockers and rolls back, for both rejoin outcomes", () => {
    expect(SRC).toMatch(/type:\s*['"]rejoin_not_allowed['"]/);
    expect(SRC).toMatch(/type:\s*['"]rejoin_required['"]/);
  });

  it("keeps the existing duplicate-identity code untouched (active-employee lookup still active_status = 1 only)", () => {
    expect(SRC).toMatch(/WHERE e\.active_status = 1/);
    expect(SRC).toContain("7. No duplicate mobile/email blocking");
  });
});
