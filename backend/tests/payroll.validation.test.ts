import { describe, it, expect } from "vitest";
import {
  createStructureSchema,
  createComponentSchema,
  assignSalarySchema,
  createRunSchema,
  updateRunStatusSchema,
  updatePrepLineSchema,
  runFiltersSchema,
  advanceSchema,
} from "../src/modules/payroll/payroll.validation.js";

describe("createStructureSchema", () => {
  it("accepts valid structure", () => {
    const r = createStructureSchema.parse({ structureCode: "BPO_A", structureName: "BPO Grade A" });
    expect(r.structureCode).toBe("BPO_A");
  });
  it("rejects empty structureCode", () => {
    expect(() => createStructureSchema.parse({ structureCode: "", structureName: "X" })).toThrow();
  });
  it("trims whitespace", () => {
    const r = createStructureSchema.parse({ structureCode: "  BPO_A  ", structureName: "  BPO Grade A  " });
    expect(r.structureCode).toBe("BPO_A");
  });
});

describe("createComponentSchema", () => {
  it("accepts valid component", () => {
    const r = createComponentSchema.parse({ componentCode: "BASIC", componentName: "Basic Salary", componentType: "earning" });
    expect(r.componentType).toBe("earning");
  });
  it("rejects invalid componentType", () => {
    expect(() => createComponentSchema.parse({ componentCode: "X", componentName: "X", componentType: "bonus" })).toThrow();
  });
  it("accepts all valid types", () => {
    for (const t of ["earning", "deduction", "statutory"]) {
      expect(() => createComponentSchema.parse({ componentCode: "X", componentName: "X", componentType: t })).not.toThrow();
    }
  });
});

describe("assignSalarySchema", () => {
  const valid = {
    employeeId: "550e8400-e29b-41d4-a716-446655440000",
    structureId: "550e8400-e29b-41d4-a716-446655440001",
    ctcAnnual: 300000,
    effectiveFrom: "2026-01-01",
  };
  it("accepts valid assignment", () => {
    expect(() => assignSalarySchema.parse(valid)).not.toThrow();
  });
  it("rejects negative CTC", () => {
    expect(() => assignSalarySchema.parse({ ...valid, ctcAnnual: -1 })).toThrow();
  });
  it("rejects invalid date", () => {
    expect(() => assignSalarySchema.parse({ ...valid, effectiveFrom: "01-01-2026" })).toThrow();
  });
});

describe("createRunSchema", () => {
  it("accepts valid run_month YYYY-MM", () => {
    const r = createRunSchema.parse({ runMonth: "2026-05" });
    expect(r.runMonth).toBe("2026-05");
  });
  it("rejects invalid format", () => {
    expect(() => createRunSchema.parse({ runMonth: "May-2026" })).toThrow();
    expect(() => createRunSchema.parse({ runMonth: "2026-13" })).toThrow();
  });
});

describe("updateRunStatusSchema", () => {
  it("accepts valid statuses", () => {
    for (const s of ["processing", "reviewed", "approved", "locked", "disbursed"]) {
      expect(() => updateRunStatusSchema.parse({ status: s })).not.toThrow();
    }
  });
  it("rejects draft (can only move forward)", () => {
    expect(() => updateRunStatusSchema.parse({ status: "draft" })).toThrow();
  });
  it("rejects unknown status", () => {
    expect(() => updateRunStatusSchema.parse({ status: "cancelled" })).toThrow();
  });
});

describe("updatePrepLineSchema", () => {
  it("accepts empty object", () => {
    expect(() => updatePrepLineSchema.parse({})).not.toThrow();
  });
  it("accepts partial override fields", () => {
    const r = updatePrepLineSchema.parse({ lwpDays: 2, remarks: "Adjusted" });
    expect(r.lwpDays).toBe(2);
  });
  it("rejects negative lwpDays", () => {
    expect(() => updatePrepLineSchema.parse({ lwpDays: -1 })).toThrow();
  });
});

describe("runFiltersSchema", () => {
  it("defaults page 1 limit 50", () => {
    const r = runFiltersSchema.parse({});
    expect(r.page).toBe(1);
    expect(r.limit).toBe(50);
  });
  it("accepts runMonth filter", () => {
    const r = runFiltersSchema.parse({ runMonth: "2026-05" });
    expect(r.runMonth).toBe("2026-05");
  });
});

describe("advanceSchema", () => {
  it("requires employeeId, amount, advanceDate", () => {
    expect(() => advanceSchema.parse({})).toThrow();
  });
  it("rejects amount <= 0", () => {
    expect(() => advanceSchema.parse({
      employeeId: "550e8400-e29b-41d4-a716-446655440000",
      amount: 0,
      advanceDate: "2026-05-01",
    })).toThrow();
  });
  it("accepts valid advance", () => {
    const r = advanceSchema.parse({
      employeeId: "550e8400-e29b-41d4-a716-446655440000",
      amount: 5000,
      advanceDate: "2026-05-01",
      recoveryMonths: 3,
    });
    expect(r.recoveryMonths).toBe(3);
  });
});
