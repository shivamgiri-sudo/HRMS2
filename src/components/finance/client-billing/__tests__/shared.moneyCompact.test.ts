/**
 * `moneyCompact` drives the Client Billing KPI tiles. It is display-only and never feeds a
 * calculation, but it is still the number a finance lead reads first, so the lakh/crore
 * boundaries and the rounding have to be exactly right — an off-by-one-place error here
 * turns ₹394 crore into ₹39.4 crore and nobody would necessarily catch it by eye.
 *
 * The live all-time figure that motivated this (₹3,94,19,35,105.07 in a ~180px card) is
 * pinned below as a regression case.
 */
import { describe, expect, it } from "vitest";
import { money, moneyCompact } from "../shared";

describe("moneyCompact", () => {
  it("renders the live all-time approved figure compactly", () => {
    // 3941935105.07 — what the APPROVED (ALL-TIME) tile actually holds in production.
    expect(moneyCompact(3941935105.07)).toBe("₹394.19 Cr");
  });

  it("uses crore at and above 1,00,00,000", () => {
    expect(moneyCompact(10000000)).toBe("₹1 Cr");
    expect(moneyCompact(14769398)).toBe("₹1.48 Cr");
    expect(moneyCompact(33920149)).toBe("₹3.39 Cr");
  });

  it("uses lakh between 1,00,000 and just under a crore", () => {
    expect(moneyCompact(100000)).toBe("₹1 L");
    expect(moneyCompact(2496803)).toBe("₹24.97 L");
    expect(moneyCompact(9999999)).toBe("₹100 L");
  });

  it("falls back to full currency formatting below a lakh", () => {
    // Small values stay exact — compacting "₹44,545" to "₹0.45 L" would be worse, not better.
    expect(moneyCompact(44545)).toBe(money(44545));
    expect(moneyCompact(0)).toBe(money(0));
  });

  it("drops a trailing .00 rather than padding it", () => {
    expect(moneyCompact(50000000)).toBe("₹5 Cr");
    expect(moneyCompact(500000)).toBe("₹5 L");
  });

  it("keeps the sign on negatives", () => {
    // A credit-note-heavy month can legitimately net negative.
    expect(moneyCompact(-14769398)).toBe("-₹1.48 Cr");
    expect(moneyCompact(-250000)).toBe("-₹2.5 L");
  });

  it("treats null and undefined as zero instead of rendering NaN", () => {
    expect(moneyCompact(null)).toBe(money(0));
    expect(moneyCompact(undefined)).toBe(money(0));
  });

  it("accepts the string amounts the API actually returns", () => {
    // MySQL DECIMAL columns arrive as strings through mysql2.
    expect(moneyCompact("3941935105.07")).toBe("₹394.19 Cr");
  });
});
