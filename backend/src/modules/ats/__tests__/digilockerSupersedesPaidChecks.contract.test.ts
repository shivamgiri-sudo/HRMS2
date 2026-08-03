/**
 * DigiLocker is authoritative, so nothing paid should re-check what it returned.
 *
 * DigiLocker fetches Aadhaar and PAN from the issuing authority. Running the
 * separate Befisc/Luckpay checks afterwards buys a second opinion on a
 * government record and is billed per call, three provider calls where one
 * would do.
 *
 * The mechanism for avoiding that already existed and was never reachable.
 * autoCreateDigilockerVerifiedChecks() writes verified `aadhaar` and `pan` rows
 * when DigiLocker completes — its own comment says "to avoid redundant separate
 * API calls" — but it is called only from providerCallback(). The live
 * completion path is syncDigilockerStatus(), which never reaches it, so no
 * candidate has ever had those rows created.
 *
 * The guard also has to be server-side. The form already refuses the buttons
 * (useOnboardingFull.ts:536, :612), but that is a message in a React hook: a
 * stale tab, a retry or a direct API call still spends money. Cost control
 * belongs where the spend happens.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SYNC = read("src/modules/integrations/luckpay/luckpay-status.service.ts");
const VERIFICATION = read("src/modules/ats/bgv-verification.service.ts");

describe("a completed DigiLocker marks Aadhaar and PAN verified", () => {
  it("the writer is exported so the sync path can reach it", () => {
    expect(VERIFICATION).toMatch(/export async function autoCreateDigilockerVerifiedChecks/);
  });

  it("the live completion path calls it", () => {
    expect(
      SYNC,
      "syncDigilockerStatus completes without marking Aadhaar/PAN verified, so both get billed again",
    ).toMatch(/autoCreateDigilockerVerifiedChecks/);
  });

  it("calling it cannot fail the sync that triggered it", () => {
    // The documents are already fetched and stored by this point. Losing that
    // because a follow-up write threw would be a far worse outcome than a
    // missing convenience row.
    // Anchored on the invocation, not the first textual mention — the
    // explanatory comment above it names the function too, and a window around
    // that would be measuring the wrong thing.
    const at = SYNC.indexOf("await autoCreateDigilockerVerifiedChecks(");
    expect(at, "the call itself was not found, only a mention of it").toBeGreaterThan(-1);
    const around = SYNC.slice(Math.max(0, at - 200), at + 400);
    expect(around).toMatch(/catch/);
  });
});

/**
 * This guard already existed and works — these assertions pin it rather than
 * introduce it. Worth pinning precisely because it is the half of the design
 * that saves money, and because it is invisible: nothing about a skipped call
 * shows up unless you look for the absence of a provider request.
 */
describe("paid checks refuse to re-verify what DigiLocker already did", () => {
  const bodyOf = (fn: string) => {
    const at = VERIFICATION.indexOf(`export async function ${fn}`);
    expect(at, `${fn} moved or was renamed`).toBeGreaterThan(-1);
    // Sliced to the end of the function rather than a fixed width — a fixed
    // window has twice produced a false result in this codebase.
    const next = VERIFICATION.indexOf("\nexport async function", at + 10);
    return VERIFICATION.slice(at, next === -1 ? undefined : next);
  };

  for (const [fn, event] of [
    ["verifyPanForCandidate", "PAN_VERIFICATION_SKIPPED_DIGILOCKER"],
    ["verifyAadhaarOfflineForCandidate", "AADHAAR_VERIFICATION_SKIPPED_DIGILOCKER"],
  ] as const) {
    it(`${fn} short-circuits on a DigiLocker-verified check`, () => {
      const body = bodyOf(fn);
      expect(body).toMatch(/getVerifiedCheck\(candidateId/);
      expect(
        body,
        `${fn} would call the provider even when DigiLocker already verified it — a billed duplicate`,
      ).toMatch(/provider_key\) === "digilocker"/);
      expect(body, "a skipped paid call must leave a trace").toContain(event);
    });

    it(`${fn} decides before the provider is called, not after`, () => {
      const body = bodyOf(fn);
      const guardAt = body.indexOf('provider_key) === "digilocker"');
      const providerAt = body.search(/withProviderFailureLogged|adapter\./);
      expect(guardAt).toBeGreaterThan(-1);
      expect(providerAt).toBeGreaterThan(-1);
      expect(guardAt, "the check happens after the money is spent").toBeLessThan(providerAt);
    });
  }
});
