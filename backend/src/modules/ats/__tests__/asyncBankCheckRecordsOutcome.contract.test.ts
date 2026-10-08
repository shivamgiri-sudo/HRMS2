import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("../onboarding-full.service.ts", import.meta.url), "utf8");

describe("submit-time bank penny drop records its outcome everywhere", () => {
  it("persists the verification and copies the account after storing the BGV check", () => {
    const store = SRC.search(/storeBgvCheckResult\(candidateId, 'bank'/);
    const record = SRC.search(/await recordBankVerificationOutcome\(candidateId/);
    expect(store).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(store);
    expect(SRC).toMatch(/persistBankVerificationOutcome\(candidateId, args, args\.result\)/);
    expect(SRC).toMatch(/copyVerifiedBankToEmployee\(candidateId\)/);
    expect(SRC).toMatch(/syncBridgePennyDropStatus\(db, candidateId, args\.result\.status/);
  });
});
