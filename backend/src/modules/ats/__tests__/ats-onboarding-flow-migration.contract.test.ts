import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../../../../sql/054_ats_onboarding_flow.sql"), "utf8");

describe("ATS onboarding flow migration", () => {
  it("uses MySQL-compatible guarded index creation for onboarding tokens", () => {
    expect(migration).toMatch(/INFORMATION_SCHEMA\.STATISTICS/i);
    expect(migration).toMatch(/ALTER TABLE ats_onboarding_bridge ADD UNIQUE INDEX uq_onb_token/i);
    expect(migration).not.toMatch(/CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_onb_token/i);
  });
});
