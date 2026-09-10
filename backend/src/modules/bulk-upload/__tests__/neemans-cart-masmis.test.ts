import { describe, it, expect } from "vitest";
import { importNeemansCartMasmisBatch } from "../neemans-cart-masmis-bulk.service.js";

describe("exports", () => {
  it("exports importNeemansCartMasmisBatch as a function", () => {
    expect(typeof importNeemansCartMasmisBatch).toBe("function");
  });
});
