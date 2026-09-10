import { describe, it, expect } from "vitest";
import { NEEMANS_SALE_RAW_HEADERS } from "../neemans-sale-raw-masmis-bulk.service.js";

describe("headers", () => {
  it("names orderId, the row's identity, and the real un-converted-date quirk fields", () => {
    expect(NEEMANS_SALE_RAW_HEADERS).toContain("orderId");
    expect(NEEMANS_SALE_RAW_HEADERS).toContain("date");
    expect(NEEMANS_SALE_RAW_HEADERS).toContain("callDateTime");
  });
});
