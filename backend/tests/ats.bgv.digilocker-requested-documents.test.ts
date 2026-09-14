import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * What we asked the candidate to share must be what we recorded asking for.
 *
 * startDigilockerByToken applied its ["AADHAAR", "PAN"] default inline in the adapter
 * call, then stored the caller's raw argument in requested_documents_json. The
 * onboarding screen sends no list, so the provider was asked for Aadhaar and PAN while
 * the session row recorded `[]`. Measured on production: all 33 befisc_luckpay sessions
 * hold `[]`, while the six older mock_digilocker sessions — whose caller passed an
 * explicit list — hold ["AADHAAR", "DRIVING_LICENSE", "VOTER_ID", "CBSE_10"].
 *
 * Nothing was fetched wrongly; the provider always received the right list. What was lost
 * is the ability to answer "what did we ask this candidate to share", which a
 * consent-based KYC flow has to be able to show after the fact.
 *
 * This reads the source rather than driving the function. Running it end to end needs a
 * valid onboarding token and a consent row, which would make this a database-fixture
 * exercise rather than a check of the one thing that was wrong: two expressions that had
 * to agree were written out twice. What is asserted is that they are now a single
 * binding, used in both places — no provider or HTTP client is involved.
 */
const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/ats/bgv-verification.service.ts"),
  "utf8",
);

const RESOLVED_BINDING =
  /const\s+documentsToRequest\s*=\s*requestedDocuments\.length\s*\?\s*requestedDocuments\s*:\s*(\[[^\]]*\])/;

describe("DigiLocker session records the documents it actually requested", () => {
  it("resolves the requested list once", () => {
    expect(
      SOURCE,
      "the requested-document list is no longer resolved into a single binding",
    ).toMatch(RESOLVED_BINDING);
  });

  it("sends that same list to the provider and stores it on the session row", () => {
    expect(SOURCE).toMatch(/adapter\.startDigilocker\(candidateId,\s*documentsToRequest\)/);
    expect(SOURCE).toMatch(/JSON\.stringify\(documentsToRequest\)/);
  });

  it("never writes requested_documents_json from the raw parameter again", () => {
    // The defect itself: the default was applied to the provider call but not to the
    // value persisted, so the row recorded [] for every session the screen started.
    expect(SOURCE).not.toMatch(/JSON\.stringify\(requestedDocuments\)/);
  });

  it("still defaults to Aadhaar and PAN when the caller sends nothing", () => {
    const match = RESOLVED_BINDING.exec(SOURCE);
    expect(match, "default list not found").toBeTruthy();
    expect(match![1]).toContain("AADHAAR");
    expect(match![1]).toContain("PAN");
  });
});
