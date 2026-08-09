import { describe, it, expect } from "vitest";
import {
  createProcessSchema,
  processFiltersSchema,
  updateProcessSchema,
  updateProcessStatusSchema,
} from "../src/modules/process/process.validation.js";

describe("processFiltersSchema", () => {
  it("defaults activeStatus to 'active' when omitted", () => {
    const result = processFiltersSchema.parse({});
    expect(result.activeStatus).toBe("active");
  });

  it("accepts valid activeStatus values", () => {
    expect(processFiltersSchema.parse({ activeStatus: "active" }).activeStatus).toBe("active");
    expect(processFiltersSchema.parse({ activeStatus: "inactive" }).activeStatus).toBe("inactive");
  });

  it("rejects invalid activeStatus value", () => {
    expect(() => processFiltersSchema.parse({ activeStatus: "unknown" })).toThrow();
  });

  it("accepts optional search and departmentId", () => {
    const result = processFiltersSchema.parse({
      search: "inbound",
      departmentId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.search).toBe("inbound");
  });

  it("rejects non-UUID departmentId", () => {
    expect(() => processFiltersSchema.parse({ departmentId: "not-a-uuid" })).toThrow();
  });
});

describe("createProcessSchema", () => {
  const valid = { processCode: "IB", processName: "Inbound" };

  it("accepts minimal valid input", () => {
    const result = createProcessSchema.parse(valid);
    expect(result.processCode).toBe("IB");
    expect(result.processName).toBe("Inbound");
  });

  it("rejects processCode shorter than 2 characters", () => {
    expect(() => createProcessSchema.parse({ ...valid, processCode: "X" })).toThrow();
  });

  it("rejects empty processName", () => {
    expect(() => createProcessSchema.parse({ ...valid, processName: "" })).toThrow();
  });

  it("trims whitespace from processCode and processName", () => {
    const result = createProcessSchema.parse({ processCode: "  OB  ", processName: "  Outbound  " });
    expect(result.processCode).toBe("OB");
    expect(result.processName).toBe("Outbound");
  });

  it("rejects processCode longer than 80 characters", () => {
    expect(() =>
      createProcessSchema.parse({ ...valid, processCode: "A".repeat(81) })
    ).toThrow();
  });

  it("rejects non-UUID departmentId", () => {
    expect(() =>
      createProcessSchema.parse({ ...valid, departmentId: "bad-id" })
    ).toThrow();
  });

  it("accepts null departmentId", () => {
    const result = createProcessSchema.parse({ ...valid, departmentId: null });
    expect(result.departmentId).toBeNull();
  });
});

describe("updateProcessSchema", () => {
  it("accepts empty object (all fields optional)", () => {
    expect(() => updateProcessSchema.parse({})).not.toThrow();
  });

  it("validates processName minimum length when provided", () => {
    expect(() => updateProcessSchema.parse({ processName: "X" })).toThrow();
  });

  it("accepts boolean activeStatus", () => {
    const result = updateProcessSchema.parse({ activeStatus: false });
    expect(result.activeStatus).toBe(false);
  });
});

describe("updateProcessStatusSchema", () => {
  it("requires activeStatus field", () => {
    expect(() => updateProcessStatusSchema.parse({})).toThrow();
  });

  it("accepts true", () => {
    expect(updateProcessStatusSchema.parse({ activeStatus: true }).activeStatus).toBe(true);
  });

  it("accepts false", () => {
    expect(updateProcessStatusSchema.parse({ activeStatus: false }).activeStatus).toBe(false);
  });

  it("rejects non-boolean activeStatus", () => {
    expect(() => updateProcessStatusSchema.parse({ activeStatus: "yes" })).toThrow();
  });
});
