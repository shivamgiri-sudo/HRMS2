import { describe, it, expect } from "vitest";
import { BB_CART_HEADERS } from "../bb-cart-masmis-bulk.service.js";

describe("headers", () => {
  it("names Cart ID, the row's identity", () => {
    expect(BB_CART_HEADERS).toContain("Cart ID");
  });
});
