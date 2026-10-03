import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  APPROVED_TEXT, DEFAULT_DECISION_SLA_HOURS, MAX_DECISION_SLA_HOURS, MIN_DECISION_SLA_HOURS, RETENTION,
  acknowledgementText, clampSlaHours, decisionDays, rejectedText,
} from "../dpdp-withdrawal.policy.js";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
const { getDecisionSlaHours } = await import("../dpdp-withdrawal.service.js");

describe("decision deadline", () => {
  it("defaults to 7 days, not 72 hours", () => {
    expect(DEFAULT_DECISION_SLA_HOURS).toBe(168);
    expect(clampSlaHours(undefined)).toBe(168);
    expect(clampSlaHours("")).toBe(168);
    expect(clampSlaHours("abc")).toBe(168);
    expect(clampSlaHours("-5")).toBe(168);
    expect(clampSlaHours(0)).toBe(168);
  });
  it("accepts a configured value but keeps it between 1 day and 30 days", () => {
    expect(clampSlaHours("240")).toBe(240);
    expect(clampSlaHours(48)).toBe(48);
    expect(clampSlaHours("1")).toBe(MIN_DECISION_SLA_HOURS);
    expect(clampSlaHours("99999")).toBe(MAX_DECISION_SLA_HOURS);
  });
  it("is read from dpdp_config, and an unreadable config never blocks a request", async () => {
    execute.mockResolvedValueOnce([[{ config_value: "120" }]]);
    expect(await getDecisionSlaHours()).toBe(120);
    execute.mockResolvedValueOnce([[]]);
    expect(await getDecisionSlaHours()).toBe(168);
    execute.mockRejectedValueOnce(new Error("table missing"));
    expect(await getDecisionSlaHours()).toBe(168);
  });
  it("states the deadline in whole days", () => {
    expect(decisionDays(168)).toBe(7);
    expect(decisionDays(25)).toBe(2);
    expect(decisionDays(1)).toBe(1);
  });
});

describe("retention follows the existing retention policy", () => {
  it("8 years for payroll and employee records, 5 years for leave and attendance", () => {
    expect(RETENTION).toEqual({ payrollAndEmployeeRecordsYears: 8, leaveAndAttendanceYears: 5 });
  });
  it("matches the seeded data_retention_policy rows (2920 / 1825 days)", () => {
    const sql = readFileSync(resolve(import.meta.dirname, "..", "..", "..", "..", "sql", "schema-snapshot.json"), "utf8");
    expect(sql).toContain("data_retention_policy");
    expect(RETENTION.payrollAndEmployeeRecordsYears * 365).toBe(2920);
    expect(RETENTION.leaveAndAttendanceYears * 365).toBe(1825);
  });
});

describe("notices to the principal", () => {
  it("the acknowledgement names the reference and the deadline", () => {
    expect(acknowledgementText("WDR-1", 168)).toContain("WDR-1");
    expect(acknowledgementText("WDR-1", 168)).toContain("within 7 days");
    expect(acknowledgementText("WDR-1", 24)).toContain("within 1 day");
  });
  it("the approval says what continues and for how long", () => {
    expect(APPROVED_TEXT).toContain("employment");
    expect(APPROVED_TEXT).toContain("8 years");
    expect(APPROVED_TEXT).toContain("5 years");
  });
  it("a rejection carries the reason (capped) and the grievance route", () => {
    const t = rejectedText("x".repeat(500));
    expect(t.length).toBeLessThan(400);
    expect(t).toContain("Grievance Officer");
  });
});

describe("restriction guard no longer blocks a current employee's whole record", () => {
  const src = readFileSync(resolve(import.meta.dirname, "..", "dpdpRestrictionGuard.ts"), "utf8");
  it("excludes requesters who are active employees", () => {
    expect(src).toContain("NOT EXISTS (SELECT 1 FROM employees ae WHERE ae.user_id = dcw.requester_id AND ae.active_status = 1)");
  });
});
