import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The frontend already blocks a candidate from saving Step 2 with the same
// Mobile Number and Emergency Contact Mobile — but that check is bypassable
// (dev tools, a direct API call), so saveEmployeeDetails must enforce it too,
// and must do so before any write to candidate_onboarding_profile.
const service = readFileSync(
  resolve(process.cwd(), "src/modules/ats/onboarding-full.service.ts"),
  "utf8"
);

describe("Onboarding — Mobile Number must differ from Emergency Contact Mobile", () => {
  it("saveEmployeeDetails guards against mobileNumber === emergencyContactMobile", () => {
    const fn = service.slice(service.indexOf("export async function saveEmployeeDetails"));
    expect(fn).toContain("mobileNorm === emergencyNorm");
    expect(fn).toContain("MOBILE_EQUALS_EMERGENCY_CONTACT");
  });

  it("the guard runs before the profile INSERT, not after", () => {
    const fn = service.slice(service.indexOf("export async function saveEmployeeDetails"));
    const guardIdx = fn.indexOf("MOBILE_EQUALS_EMERGENCY_CONTACT");
    const insertIdx = fn.indexOf("INSERT INTO candidate_onboarding_profile");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(insertIdx);
  });
});
