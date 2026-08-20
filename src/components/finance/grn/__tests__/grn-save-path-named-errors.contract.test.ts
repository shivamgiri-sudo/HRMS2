import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * "GRN could not be saved — Cannot read properties of undefined (reading 'id')".
 *
 * A raw TypeError from inside the save mutation is caught by onError and shown to the raiser as
 * the toast title plus the JavaScript message. It tells them nothing they can act on, and it
 * looks like a server fault when in fact nothing was ever sent: every one of these throws
 * happens on the client, before the first request.
 *
 * This file has fixed one of these before — the `budgetLines.find(...)!` that produced exactly
 * this message — by throwing a named error instead. That guard was placed on `firstLine`, but
 * `rows` is built EARLIER in the same function and still carried `resolvedLine!.id` and
 * `singleLine!.quantity`, so the guard could not be reached. resolvedLine is null until exactly
 * one budget line matches, which is the ordinary state of a half-filled form — precisely when
 * someone presses Save draft, with the readiness strip still showing "Budget resolved" as
 * outstanding.
 *
 * The rule this file guards: NO non-null assertion and NO unguarded [0] in the save path.
 * Every refusal must name what is missing.
 */

const FORM = readFileSync(new URL("../BudgetLinkedGrnForm.tsx", import.meta.url), "utf8");

/** The body of persistMutation's mutationFn — where a throw becomes the user's error toast. */
const SAVE_PATH = (() => {
  const start = FORM.indexOf("const persistMutation = useMutation({");
  expect(start, "persistMutation must still exist").toBeGreaterThan(-1);
  const end = FORM.indexOf("const analyzeMutation", start);
  return FORM.slice(start, end > -1 ? end : FORM.length);
})();

describe("the single-line path refuses by name, not by TypeError", () => {
  it("checks resolvedLine before dereferencing it", () => {
    const guardIdx = SAVE_PATH.indexOf("if (!resolvedLine)");
    const useIdx = SAVE_PATH.indexOf("budgetLineId: resolvedLine!.id");
    expect(guardIdx, "no guard for an unresolved budget line").toBeGreaterThan(-1);
    expect(useIdx).toBeGreaterThan(-1);
    // Order is the whole bug: a guard placed after the dereference never runs.
    expect(guardIdx, "the guard must come BEFORE the dereference").toBeLessThan(useIdx);
    expect(SAVE_PATH).toContain("Pick the exact budget line first");
  });

  it("checks singleLine before reading its quantity", () => {
    const guardIdx = SAVE_PATH.indexOf("if (!singleLine)");
    const useIdx = SAVE_PATH.indexOf("quantity: singleLine!.quantity");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(useIdx);
    // The two reasons singleLine is null are different problems with different fixes, so the
    // message distinguishes them rather than saying "something is wrong".
    expect(SAVE_PATH).toContain("Enter the invoice amount before saving");
    expect(SAVE_PATH).toContain("no usable rate");
  });

  it("only applies the guard on the path that actually dereferences", () => {
    // A vendor GRN never populates resolvedLine — guarding it unconditionally would refuse
    // every vendor save with a message about a budget line the form never asked for.
    expect(SAVE_PATH).toContain("if (!isVendor && !splitMode) {");
  });
});

describe("indexed reads cannot throw from inside a predicate", () => {
  it("refuses an empty cost-centre split with a named error", () => {
    expect(SAVE_PATH).toContain("Include at least one cost centre before saving.");
  });

  it("refuses an empty allocation list with a named error", () => {
    expect(SAVE_PATH).toContain("Add at least one allocation row before saving.");
  });

  it("never reads .id off a possibly-absent element inside find()", () => {
    // `budgetLines.find((line) => line.id === costCentreSplits[0].budgetLineId)` threw the
    // reported message from two different places at once — the array element and the index.
    expect(SAVE_PATH).not.toMatch(/find\(\(line\) => line\.id === costCentreSplits\[0\]\.budgetLineId\)/);
    expect(SAVE_PATH).not.toMatch(/find\(\(line\) => line\.id === rows\[0\]\.budgetLineId\)/);
    expect(SAVE_PATH).toContain("line?.id === costCentreSplits[0]?.budgetLineId");
    expect(SAVE_PATH).toContain("line?.id === rows[0]?.budgetLineId");
  });
});

describe("a create with no id is refused rather than followed", () => {
  it("checks the create response before addressing later calls with its id", () => {
    const guardIdx = SAVE_PATH.indexOf("if (!result?.id)");
    const useIdx = SAVE_PATH.indexOf("/invoice-components");
    expect(guardIdx, "an id-less create response must be refused").toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(useIdx);
    // Without this, every follow-up became ".../grns/undefined/..." — and a missing /api/*
    // route answers 401, so the raiser would see an auth error on a valid session.
    expect(SAVE_PATH).toContain("the server returned no GRN id");
  });
});

describe("the guard that was already here still stands", () => {
  it("keeps the named refusal for a stale budget line", () => {
    expect(SAVE_PATH).toContain("The selected budget line is no longer available");
  });
});
