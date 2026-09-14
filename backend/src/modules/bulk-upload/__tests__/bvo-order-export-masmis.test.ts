import { describe, it, expect } from "vitest";
import { importBvoOrderExportMasmisBatch } from "../bvo-order-export-masmis-bulk.service.js";

describe("exports", () => {
  it("exports importBvoOrderExportMasmisBatch as a function", () => {
    expect(typeof importBvoOrderExportMasmisBatch).toBe("function");
  });
});
