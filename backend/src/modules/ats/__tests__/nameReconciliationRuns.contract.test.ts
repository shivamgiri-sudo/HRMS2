/**
 * The cross-source name reconciliation has to actually run.
 *
 * runNameMatchCheck compares the names returned by Aadhaar, PAN, bank and
 * education against the candidate's own record. It is the control that catches
 * someone completing onboarding with another person's DigiLocker or another
 * person's bank account — the exact scenario this system was asked about.
 *
 * The logic is correct and has never executed. It is reachable only from
 * HR-authenticated routes (bgv-verification.routes.ts, bgv.enhanced.routes.ts),
 * so it runs only if a human thinks to press it, and nobody does:
 * candidate_bgv_check contains zero name_match rows across the entire
 * production database.
 *
 * A verification that finishes is the moment there is something new to
 * reconcile, so that is where it now runs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/ats/bgv-verification.service.ts"),
  "utf8",
);

/** The identity sources whose result changes what reconciliation would conclude. */
const IDENTITY_CHECKS = ["pan", "bank", "aadhaar"];

describe("name reconciliation runs on its own", () => {
  it("has a system-triggered entry point, not only the HR one", () => {
    expect(SOURCE).toMatch(/reconcileNamesAfterVerification/);
  });

  for (const check of IDENTITY_CHECKS) {
    it(`runs after the ${check} verification completes`, () => {
      const at = SOURCE.indexOf(`createOrUpdateCheck(candidateId, "${check}"`);
      expect(at, `the ${check} verification path moved or was renamed`).toBeGreaterThan(-1);

      // Search to the end of the enclosing function, not a fixed number of
      // characters. A fixed window reported the bank path as unwired when the
      // call was simply 58 lines further down — the same mistake that made an
      // earlier contract test in this codebase assert against the wrong text.
      const nextFunction = SOURCE.indexOf("\nexport async function", at);
      const after = SOURCE.slice(at, nextFunction === -1 ? undefined : nextFunction);
      expect(
        after,
        `${check} completes without reconciling names, so a mismatched identity is never noticed`,
      ).toMatch(/reconcileNamesAfterVerification/);
    });
  }

  it("reconciliation failure cannot fail the verification that triggered it", () => {
    // A candidate must not lose a successful PAN check because a follow-up
    // comparison threw.
    const at = SOURCE.indexOf("async function reconcileNamesAfterVerification");
    expect(at).toBeGreaterThan(-1);
    const body = SOURCE.slice(at, at + 900);
    expect(body).toMatch(/catch/);
  });
});

describe("reconciliation compares against verified names, not typed ones", () => {
  it("does not fall back to the candidate-supplied account holder name", () => {
    // account_holder_name is free text the candidate fills in. Using it as a
    // fallback would re-open the hole closed in the bank adapter: a candidate
    // who types the true owner's name would reconcile perfectly against
    // themselves.
    const at = SOURCE.indexOf('source: "bank"');
    expect(at).toBeGreaterThan(-1);
    const line = SOURCE.slice(at, at + 200);
    expect(
      line,
      "the bank name falls back to what the candidate typed, which defeats the comparison",
    ).not.toMatch(/account_holder_name/);
  });
});
