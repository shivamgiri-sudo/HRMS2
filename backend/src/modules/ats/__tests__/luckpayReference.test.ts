/**
 * Luckpay's banking rail rejects our transaction reference.
 *
 * Penny drop fails in production with "Error processing banking request:
 * Customer Reference number is invalid". We send `clientTransactionId:
 * randomUUID()` — 36 characters with hyphens — while every reference in
 * Luckpay's own documentation is short: 4164564, 6000900, CTN_5612, TXN456789,
 * TXN-ESIGN-12345.
 *
 * Hyphens are not the problem: the eSign call uses TXN-ESIGN-4134186 and works.
 * Length is what differs, which is unsurprising — a penny drop moves real money,
 * so the reference travels onto the banking network, and those references are
 * conventionally short.
 *
 * Only the banking reference changes. DigiLocker and eSign keep the identifiers
 * they already use successfully.
 */
import { describe, it, expect } from "vitest";
import { compactProviderReference } from "../luckpay-reference.js";

describe("compactProviderReference", () => {
  it("is short enough for a banking reference", () => {
    for (let i = 0; i < 50; i++) {
      expect(compactProviderReference("PD").length).toBeLessThanOrEqual(20);
    }
  });

  it("carries no hyphens, so it cannot be mistaken for the UUID that was rejected", () => {
    expect(compactProviderReference("PD")).not.toContain("-");
  });

  it("is alphanumeric only", () => {
    expect(compactProviderReference("PD")).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("keeps the prefix so the reference is identifiable in a provider dashboard", () => {
    expect(compactProviderReference("PD").startsWith("PD")).toBe(true);
  });

  it("does not collide across rapid successive calls", () => {
    // Penny drops for a branch intake can be issued within the same millisecond.
    const seen = new Set(Array.from({ length: 2000 }, () => compactProviderReference("PD")));
    expect(seen.size).toBe(2000);
  });

  it("is not a UUID", () => {
    expect(compactProviderReference("PD")).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
