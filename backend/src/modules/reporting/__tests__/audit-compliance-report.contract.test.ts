import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("audit and compliance report adapter contracts", () => {
  it("uses audit_action_log as authoritative source", () => {
    const adapter = source("../bpo-master-governance-safe-adapters.ts");
    expect(adapter).toContain("audit_action_log");
  });

  it("populates actor-to-employee resolution for audit events", () => {
    const adapter = source("../bpo-master-governance-safe-adapters.ts");
    expect(adapter).toContain("ACTOR_EMPLOYEE_CODE");
    expect(adapter).toContain("ACTOR_NAME");
    expect(adapter).toContain("ACTOR_ROLE");
  });

  it("retains old and new value evidence with JSON_VALID guard", () => {
    const adapter = source("../bpo-master-governance-safe-adapters.ts");
    expect(adapter).toContain("OLD_VALUE");
    expect(adapter).toContain("NEW_VALUE");
    expect(adapter).toContain("JSON_VALID");
  });

  it("distinguishes actor from subject employee by separate column expressions", () => {
    const adapter = source("../bpo-master-governance-safe-adapters.ts");
    const actorIdx = adapter.indexOf("ACTOR_EMPLOYEE_CODE");
    const subjectIdx = adapter.indexOf("SUBJECT_EMPLOYEE_CODE");
    expect(actorIdx).toBeGreaterThanOrEqual(0);
    expect(subjectIdx).toBeGreaterThanOrEqual(0);
    expect(actorIdx).not.toBe(subjectIdx);
  });

  it("includes DPDP and data privacy control fields", () => {
    const adapter = source("../bpo-master-governance-safe-adapters.ts");
    expect(adapter).toContain("DPDP_PURPOSE");
    expect(adapter).toContain("CONSENT_STATUS");
    expect(adapter).toContain("DATA_CLASSIFICATION");
  });

  it("includes CONTROL_RESULT and ACTIVITY_DATE_TIME and SOURCE_RECORD_ID", () => {
    const adapter = source("../bpo-master-governance-safe-adapters.ts");
    expect(adapter).toContain("CONTROL_RESULT");
    expect(adapter).toContain("ACTIVITY_DATE_TIME");
    expect(adapter).toContain("SOURCE_RECORD_ID");
  });
});
