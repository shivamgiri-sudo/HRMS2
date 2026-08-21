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
  // 2026-08-21: Imprest moved off the resolvedLine/singleLine single-cost-centre cascade onto
  // the same costCentreSplits architecture Vendor already used (percentage-based, multiple cost
  // centres, one Head/Sub-head). `resolvedLine!.id` / `singleLine!.quantity` do not merely have
  // a guard placed before them now — they are gone from the save path entirely, because nothing
  // in the reachable UI populates resolvedLine/singleLine any more (the old single-cost-centre
  // cascade UI was replaced; the fields survive only for the retired, unreachable splitMode
  // allocations editor). The two "checks X before dereferencing" tests this file used to run are
  // superseded by this stronger invariant: the dangerous dereference cannot exist to be missed.
  it("never dereferences resolvedLine or singleLine with a non-null assertion", () => {
    expect(SAVE_PATH).not.toMatch(/resolvedLine!/);
    expect(SAVE_PATH).not.toMatch(/singleLine!/);
  });

  it("names the reason when an included cost centre or allocation row is missing one", () => {
    // The costCentreSplits-driven path (Vendor, and Imprest's non-splitMode flow) refuses by
    // name when nothing is included; an included row with no budget line is no longer refused
    // at all — it is resolved server-side as an unbudgeted allocation for that cost centre
    // (mixed budgeted + unbudgeted rows on one GRN are supported, see
    // grn-imprest-unbudgeted.contract.test.ts / grn-unbudgeted-flow.contract.test.ts).
    expect(SAVE_PATH).toContain("Include at least one cost centre before saving.");
  });

  it("only applies the costCentreSplits guard on the path that actually uses it", () => {
    // A vendor GRN and Imprest's (non-splitMode) flow both drive costCentreSplits now — guarding
    // it unconditionally for splitMode too would refuse the retired allocations editor's own
    // rows with a message about cost centres it never asked for.
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
    // costCentreSplits[0] specifically was replaced with a search for the first INCLUDED row
    // that actually has a budget line (2026-08-21, mixed budgeted/unbudgeted rows) — literal
    // index [0] would wrongly pick an unbudgeted row sitting first and make an otherwise-
    // budgeted GRN look like it has no line at all. Still fully optional-chained throughout.
    expect(SAVE_PATH).toContain(
      "line?.id === costCentreSplits.find((row) => row.included && row.budgetLineId)?.budgetLineId"
    );
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
