import { describe, it, expect } from "vitest";
import { analyzeSchema } from "../src/modules/integration-hub/schemaAnalyzer.js";

describe("analyzeSchema", () => {
  it("detects string field", () => {
    const fields = analyzeSchema([{ emp_id: "EMP001" }]);
    const f = fields.find((f) => f.name === "emp_id");
    expect(f).toBeDefined();
    expect(f?.type).toBe("string");
  });

  it("detects number field", () => {
    const fields = analyzeSchema([{ login_minutes: 480 }]);
    const f = fields.find((f) => f.name === "login_minutes");
    expect(f?.type).toBe("number");
  });

  it("detects boolean field", () => {
    const fields = analyzeSchema([{ is_active: true }]);
    const f = fields.find((f) => f.name === "is_active");
    expect(f?.type).toBe("boolean");
  });

  it("detects date-like string as date", () => {
    const fields = analyzeSchema([{ login_date: "2026-05-20" }]);
    const f = fields.find((f) => f.name === "login_date");
    expect(f?.type).toBe("date");
  });

  it("detects null field as unknown", () => {
    const fields = analyzeSchema([{ maybe: null }]);
    const f = fields.find((f) => f.name === "maybe");
    expect(f?.type).toBe("unknown");
  });

  it("merges fields across multiple rows", () => {
    const fields = analyzeSchema([
      { emp_id: "EMP001", login_minutes: 480 },
      { emp_id: "EMP002", process: "Inbound" },
    ]);
    const names = fields.map((f) => f.name).sort();
    expect(names).toEqual(["emp_id", "login_minutes", "process"].sort());
  });

  it("returns empty array for empty input", () => {
    expect(analyzeSchema([])).toEqual([]);
  });

  it("reports sample_values from first rows", () => {
    const fields = analyzeSchema([
      { emp_id: "EMP001" },
      { emp_id: "EMP002" },
      { emp_id: "EMP003" },
    ]);
    const f = fields.find((f) => f.name === "emp_id");
    expect(f?.sample_values).toContain("EMP001");
  });

  it("detects nullable when field absent in some rows", () => {
    const fields = analyzeSchema([
      { emp_id: "EMP001", branch: "Mumbai" },
      { emp_id: "EMP002" },
    ]);
    const f = fields.find((f) => f.name === "branch");
    expect(f?.nullable).toBe(true);
  });

  it("marks not nullable when field present in all rows", () => {
    const fields = analyzeSchema([
      { emp_id: "EMP001" },
      { emp_id: "EMP002" },
    ]);
    const f = fields.find((f) => f.name === "emp_id");
    expect(f?.nullable).toBe(false);
  });
});
