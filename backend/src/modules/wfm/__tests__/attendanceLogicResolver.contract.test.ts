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
});
