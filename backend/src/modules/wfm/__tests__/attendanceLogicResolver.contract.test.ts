import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  pickAprRow,
  resolveAttendanceLogicFromRows,
  type AprEligibilityRow,
} from "../attendance-logic-resolver.js";

const row = (o: Partial<AprEligibilityRow> & { id: string }): AprEligibilityRow => ({
  rule_name: o.id, designation_id: null, department_id: null, process_id: null,
  attendance_logic: "apr", active_status: 1, ...o,
});
const names = { departmentName: "operations", designationName: "executive" };
const scope = { designationId: "D1", departmentId: "OP", processId: "P1" };

describe("attendance logic resolution", () => {
  it("a company-wide APR row makes a process with no rows of its own APR", () => {
    const rows = [row({ id: "g", designation_id: "D1", department_id: "OP" })];
    expect(resolveAttendanceLogicFromRows(rows, scope, names).logic).toBe("apr");
  });

  it("a process-scoped COSEC row beats the company-wide APR row", () => {
    const rows = [
      row({ id: "g", designation_id: "D1", department_id: "OP" }),
      row({ id: "p", designation_id: "D1", department_id: "OP", process_id: "P1", attendance_logic: "cosec" }),
    ];
    const res = resolveAttendanceLogicFromRows(rows, scope, names);
    expect(res.logic).toBe("cosec");
    expect(res.row?.id).toBe("p");
    // another process is untouched
    expect(resolveAttendanceLogicFromRows(rows, { ...scope, processId: "P2" }, names).logic).toBe("apr");
  });

  it("at equal specificity a non-COSEC row wins, matching the old behaviour that excluded COSEC rows", () => {
    const rows = [
      row({ id: "a", designation_id: "D1", department_id: "OP", attendance_logic: "cosec" }),
      row({ id: "b", designation_id: "D1", department_id: "OP", attendance_logic: "apr_validated_by_cosec" }),
    ];
    expect(pickAprRow(rows, scope)?.id).toBe("b");
  });

  it("inactive rows never match; no match means COSEC", () => {
    const rows = [row({ id: "x", designation_id: "D1", department_id: "OP", active_status: 0 }), row({ id: "y", designation_id: "OTHER" })];
    const res = resolveAttendanceLogicFromRows(rows, scope, names);
    expect(res.logic).toBe("cosec");
    expect(res.via).toBe("no_matching_row");
  });

  it("with no active rows at all, the legacy name match decides", () => {
    expect(resolveAttendanceLogicFromRows([], scope, names).logic).toBe("apr");
    expect(resolveAttendanceLogicFromRows([], scope, { departmentName: "hr", designationName: "executive" }).logic).toBe("cosec");
  });

  it("the engine's SQL keeps the same ordering as this resolver", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../attendance-engine.service.ts"), "utf8");
    const i = src.indexOf("async resolveAttendanceLogic(");
    const body = src.slice(i, i + 3500);
    expect(body).toContain("(attendance_logic = 'cosec') ASC");
    expect(body).toContain("id ASC");
    expect(body).not.toContain("attendance_logic <> 'cosec'");
  });

  describe("personal override and APR+COSEC fallback (engine source pins)", () => {
    const ENGINE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../attendance-engine.service.ts"), "utf8");
    const MIGRATION = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../sql/migrations/2083_employee_attendance_logic_override.sql"), "utf8");

    it("an employee override is consulted first and beats a scoped dialler rule and the ops fallback", () => {
      expect(ENGINE).toContain("const personalOverride = await this.getEmployeeLogicOverride(employeeId)");
      expect(ENGINE).toMatch(/personalOverride\s*\? personalOverride\.logic\s*: await this\.resolveAttendanceLogic\(/);
      expect(ENGINE).toContain("const hasScopedDiallerRule = !personalOverride &&");
      expect(ENGINE).toContain("if (!personalOverride && !isAprEmployee && biometricMinutes === 0 && isOperationsDepartmentName");
    });

    it("a missing override table reads as no override, never as a changed source", () => {
      const i = ENGINE.indexOf("async getEmployeeLogicOverride(");
      const body = ENGINE.slice(i, i + 900);
      expect(body).toContain("catch");
      expect(body).toContain("return null");
    });

    it("isAprEligible honours the override when given an employee id", () => {
      expect(ENGINE).toMatch(/employeeId\?: string \| null\s*\): Promise<boolean> \{\s*const override = employeeId/);
    });

    it("APR+COSEC builds the day from COSEC when APR has no record; plain APR still does not", () => {
      expect(ENGINE).toMatch(/attendanceLogic === 'apr_validated_by_cosec'\s*&& classifyAsApr\s*&& biometricMinutes > 0/);
      // the rescue is keyed to the apr_validated_by_cosec logic only
      expect(ENGINE).not.toMatch(/attendanceLogic === 'apr'\s*&& classifyAsApr\s*&& biometricMinutes > 0/);
    });

    it("the override table is one additive CREATE TABLE IF NOT EXISTS", () => {
      expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS employee_attendance_logic_override");
      expect(MIGRATION).not.toMatch(/\b(DROP|DELETE|ALTER)\b/i);
    });
  });
});
