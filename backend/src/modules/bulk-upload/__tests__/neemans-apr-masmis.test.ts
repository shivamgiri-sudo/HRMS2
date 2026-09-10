import { describe, it, expect } from "vitest";
import { importNeemansAprMasmisBatch } from "../neemans-apr-masmis-bulk.service.js";

describe("exports", () => {
  it("exports importNeemansAprMasmisBatch as a function", () => {
    expect(typeof importNeemansAprMasmisBatch).toBe("function");
  });
});
