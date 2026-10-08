import { describe, it, expect } from "vitest";
import { isSchemaOrLogicDbError, describeDbError } from "../db-error-classification.js";

const err = (code: string) => Object.assign(new Error(code), { code });

describe("isSchemaOrLogicDbError", () => {
  it.each([
    "ER_BAD_FIELD_ERROR",
    "ER_NO_SUCH_TABLE",
    "ER_CANT_AGGREGATE_2COLLATIONS",
    "ER_PARSE_ERROR",
    "ER_DUP_ENTRY",
    "ER_DATA_TOO_LONG",
    "ER_WRONG_ARGUMENTS",
  ])("classifies %s as a schema/logic error worth logging", (code) => {
    expect(isSchemaOrLogicDbError(err(code))).toBe(true);
  });

  it.each(["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "ETIMEDOUT", "ER_CON_COUNT_ERROR"])(
    "does NOT classify transient %s (already retried; logging would flood)",
    (code) => {
      expect(isSchemaOrLogicDbError(err(code))).toBe(false);
    },
  );

  it("ignores a non-error value", () => {
    expect(isSchemaOrLogicDbError(undefined)).toBe(false);
    expect(isSchemaOrLogicDbError("boom")).toBe(false);
  });
});

describe("describeDbError", () => {
  it("includes code, server message and the SQL that produced it", () => {
    const e = Object.assign(new Error("x"), {
      code: "ER_BAD_FIELD_ERROR",
      sqlMessage: "Unknown column 'ibd.employee_id' in 'on clause'",
      sql: "SELECT *\n  FROM attendance_daily_record adr\n  LEFT JOIN integration_biometric_daily ibd",
    });
    const s = describeDbError(e);
    expect(s).toContain("ER_BAD_FIELD_ERROR");
    expect(s).toContain("Unknown column 'ibd.employee_id'");
    expect(s).toContain("LEFT JOIN integration_biometric_daily");
    expect(s).not.toContain("\n");
  });

  it("survives an error with no sql attached", () => {
    expect(describeDbError({ code: "ER_NO_SUCH_TABLE", sqlMessage: "gone" })).toBe(
      "ER_NO_SUCH_TABLE: gone",
    );
  });
});
