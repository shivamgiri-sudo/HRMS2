import { describe, it, expect } from "vitest";
import { similarity, tokenize } from "../uat-dedup.service.js";

/**
 * Duplicate detection is shown to a reporter mid-typing, so both failure directions are
 * expensive: missing a duplicate wastes their effort writing a report that already exists,
 * and a false match trains people to ignore the panel entirely. These fix the boundary.
 */

describe("tokenize", () => {
  it("drops stop words and short tokens", () => {
    const t = tokenize("The leave balance is wrong on my page");
    expect(t.has("leave")).toBe(true);
    expect(t.has("balance")).toBe(true);
    // "the", "is", "on", "my" are stop words; "wrong" and "page" are report-noise stop words
    expect(t.has("the")).toBe(false);
    expect(t.has("wrong")).toBe(false);
    expect(t.has("page")).toBe(false);
  });

  it("is case- and punctuation-insensitive", () => {
    expect([...tokenize("Leave-Balance, WRONG!")]).toEqual([...tokenize("leave balance wrong")]);
  });

  it("returns an empty set for text with no signal", () => {
    expect(tokenize("the is a of and").size).toBe(0);
    expect(tokenize("").size).toBe(0);
  });
});

describe("similarity", () => {
  it("scores a short report contained in a longer one highly", () => {
    // The whole reason for scoring against the smaller set rather than the union: a terse
    // report and a thorough one describing the SAME defect must match.
    const short = tokenize("Leave carry forward wrong");
    const long = tokenize(
      "Leave balance carry forward from last year is incorrect for employees who joined mid year"
    );
    expect(similarity(short, long)).toBeGreaterThanOrEqual(0.6);
  });

  it("would have scored that pair poorly under Jaccard — the reason for the design", () => {
    const short = tokenize("Leave carry forward wrong");
    const long = tokenize(
      "Leave balance carry forward from last year is incorrect for employees who joined mid year"
    );
    let shared = 0;
    for (const t of short) if (long.has(t)) shared++;
    const union = new Set([...short, ...long]).size;
    expect(shared / union).toBeLessThan(0.45); // Jaccard
    expect(similarity(short, long)).toBeGreaterThan(shared / union); // ours is higher
  });

  it("does not match unrelated reports", () => {
    expect(
      similarity(tokenize("Leave balance carry forward wrong"), tokenize("Roster publish button does nothing"))
    ).toBe(0);
  });

  it("is symmetric", () => {
    const a = tokenize("payslip pf deduction incorrect");
    const b = tokenize("pf deduction on payslip is incorrect for march");
    expect(similarity(a, b)).toBe(similarity(b, a));
  });

  it("scores identical titles at 1", () => {
    const a = tokenize("Roster publish fails silently");
    expect(similarity(a, tokenize("Roster publish fails silently"))).toBe(1);
  });

  it("returns 0 when either side has no usable tokens", () => {
    expect(similarity(tokenize("the is a"), tokenize("roster publish"))).toBe(0);
    expect(similarity(new Set<string>(), tokenize("roster"))).toBe(0);
  });

  it("clears the 0.4 threshold for real duplicate phrasings, and not for near-misses", () => {
    const canonical = tokenize("Leave balance shows wrong carry forward");
    const duplicates = [
      "Carry forward leave balance is wrong",
      "Wrong carry forward showing in leave balance",
      "leave carry forward incorrect",
    ];
    for (const d of duplicates) {
      expect(similarity(canonical, tokenize(d)), d).toBeGreaterThanOrEqual(0.4);
    }
    // Same module, different defect — must NOT be offered as a duplicate.
    for (const other of ["Leave application approval email not received", "Cannot apply for leave"]) {
      expect(similarity(canonical, tokenize(other)), other).toBeLessThan(0.4);
    }
  });
});
