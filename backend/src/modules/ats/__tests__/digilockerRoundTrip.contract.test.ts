/**
 * The DigiLocker round trip must have a return leg.
 *
 * Three reported symptoms — the candidate is never returned to the form, Step 3
 * never auto-fills, and reopening gives no warning that DigiLocker was already
 * done — are one defect. Nothing ever comes back from the provider.
 *
 * Production evidence: candidate_digilocker_session holds 30 rows, every one
 * still 'created'; ats_onboarding_bridge.digilocker_status is 'not_started' on
 * all 295 rows; ats_provider_transaction_log holds 24 DigiLocker rows, all
 * failed, none carrying a provider_reference_id.
 *
 * The cause is that the initiate call discards the one value the rest of the
 * flow needs. Luckpay returns `gatewayId` ("APIB1785307893997014"), and both
 * checkKycStatus and downloadKycDocument require it back as `transactionId`.
 * Our adapter returned only `state` and `authUrl`, so there was never anything
 * to poll or download.
 *
 * Their API takes only clientTransactionId, customerName and mobileNumber —
 * there is no redirect parameter — so the candidate finishing on the provider's
 * own success page is by design. The return leg has to be polling, which is why
 * capturing this id is the whole fix rather than a detail of it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const ADAPTER = read("src/modules/ats/bgv-provider.adapter.ts");
const VERIFICATION = read("src/modules/ats/bgv-verification.service.ts");
const ONBOARDING_SERVICE = read("src/modules/ats/onboarding-full.service.ts");
const STATUS_SERVICE = read("src/modules/integrations/luckpay/luckpay-status.service.ts");

describe("the initiate call keeps the provider's transaction id", () => {
  it("DigilockerSession can carry a provider reference", () => {
    // Sliced to the closing brace rather than a fixed character count: a
    // fixed window silently stops covering the declaration as soon as anyone
    // adds a comment to it, which is how this assertion first failed.
    const start = ADAPTER.indexOf("interface DigilockerSession");
    const type = ADAPTER.slice(start, ADAPTER.indexOf("\n}", start));
    expect(type).toMatch(/providerReferenceId/);
  });

  it("the Luckpay adapter reads gatewayId off the initiate response", () => {
    const at = ADAPTER.indexOf('"/verifyDigilockerWithURL"');
    expect(at, "the DigiLocker initiate call moved or was renamed").toBeGreaterThan(-1);
    const block = ADAPTER.slice(at, at + 1400);
    expect(block, "gatewayId is discarded, so nothing can be polled or downloaded").toMatch(/gatewayId/);
  });

  it("the session write records it, so the sync path can find it later", () => {
    const at = VERIFICATION.indexOf("ats_provider_transaction_log");
    expect(at, "startDigilockerByToken never writes the log that syncDigilockerStatus reads").toBeGreaterThan(-1);
  });
});

describe("nothing queries the empty duplicate table", () => {
  // candidate_digilocker_sessions (plural) holds 0 rows and has no
  // session_status column; every write goes to the singular table, which holds
  // 30. Reading the plural one is why the form can never tell a candidate they
  // have already connected.
  for (const [name, source] of [
    ["onboarding-full.service.ts", ONBOARDING_SERVICE],
    ["bgv-verification.service.ts", VERIFICATION],
  ] as const) {
    it(`${name} does not read candidate_digilocker_sessions`, () => {
      expect(source, `${name} queries the empty plural table`).not.toMatch(/candidate_digilocker_sessions\b/);
    });
  }
});

describe("the completion write targets columns that exist", () => {
  // The live table has: id, candidate_id, state_token, provider_key, auth_url,
  // session_status, requested_documents_json, returned_documents_json,
  // expires_at, created_at, updated_at.
  //
  // The completion UPDATE referenced fetched_documents_json and completed_at,
  // neither of which exists, and was wrapped in .catch(() => undefined) — so a
  // session could never be marked completed and nothing said so.
  const LIVE_COLUMNS = [
    "id", "candidate_id", "state_token", "provider_key", "auth_url", "session_status",
    "requested_documents_json", "returned_documents_json", "expires_at", "created_at", "updated_at",
  ];

  it("the session UPDATE uses only real columns", () => {
    const at = STATUS_SERVICE.indexOf("UPDATE candidate_digilocker_session");
    expect(at).toBeGreaterThan(-1);
    const statement = STATUS_SERVICE.slice(at, STATUS_SERVICE.indexOf("`", at + 10));
    const referenced = [...statement.matchAll(/\b([a-z_]+)\s*=/g)].map((m) => m[1]);
    const unknown = referenced.filter((c) => !LIVE_COLUMNS.includes(c) && c !== "SET");
    expect(unknown, `these columns do not exist on the table: ${unknown.join(", ")}`).toEqual([]);
  });
});
