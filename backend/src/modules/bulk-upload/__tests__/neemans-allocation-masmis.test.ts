import { describe, it, expect } from "vitest";
import { importNeemansAllocationMasmisBatch } from "../neemans-allocation-masmis-bulk.service.js";

describe("exports", () => {
  it("exports importNeemansAllocationMasmisBatch as a function", () => {
    expect(typeof importNeemansAllocationMasmisBatch).toBe("function");
  });
});
