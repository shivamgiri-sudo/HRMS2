/**
 * findMissingMandatoryDocuments() used to waive BOTH the Aadhaar and PAN
 * mandatory-document requirements off a single ats_onboarding_bridge.
 * digilocker_status = 'documents_received' flag. That is wrong:
 * downloadKycDocument returns ONE document, chosen by what the candidate
 * consented to share in the DigiLocker portal (see digilocker-evidence.ts) --
 * an Aadhaar-only pull was silently waiving the PAN upload too.
 *
 * Reproduced against MAS63413 (candidate a7edfea8-fcfd-4744-9223-f109eefcadaf):
 * candidate_bgv_check has check_type='aadhaar' verified via digilocker, but
 * check_type='pan' still 'manual_review' -- he has no PAN document on file and
 * the old logic reported nothing missing.
 *
 * Fix: read candidate_bgv_check per check_type instead of the blanket bridge
 * flag, mirroring how autoCreateDigilockerVerifiedChecks() already records it
 * correctly (digilockerVerifiedCheckTypes()).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { findMissingMandatoryDocuments } = await import("../onboarding-full.service.js");

const CANDIDATE_ID = "a7edfea8-fcfd-4744-9223-f109eefcadaf";

// Every document except Aadhaar/PAN, so only those two categories are in play.
const OTHER_DOCS = [
  { doc_type: "Address Proof", doc_name: "Address Proof" },
  { doc_type: "Passport Photo", doc_name: "Passport Photo" },
  { doc_type: "Live Selfie", doc_name: "Live Selfie (Identity Verification)" },
  { doc_type: "10th Marksheet", doc_name: "10th Marksheet" },
  { doc_type: "12th Marksheet", doc_name: "12th Marksheet" },
];

function installMock(verifiedCheckTypes: string[]) {
  execute.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes("candidate_onboarding_document")) return [OTHER_DOCS, []];
    if (s.includes("candidate_bgv_check")) {
      return [verifiedCheckTypes.map((t) => ({ check_type: t })), []];
    }
    return [[], []];
  });
}

describe("findMissingMandatoryDocuments — DigiLocker per-document-type scoping", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("MAS63413's exact case: Aadhaar verified via digilocker, PAN not -- PAN stays missing", async () => {
    installMock(["aadhaar"]); // pan is 'manual_review', not 'verified' -- excluded

    const missing = await findMissingMandatoryDocuments(CANDIDATE_ID);

    expect(missing).not.toContain("Aadhaar Card");
    expect(missing).toContain("PAN Card");
  });

  it("both waived when both are actually verified", async () => {
    installMock(["aadhaar", "pan"]);

    const missing = await findMissingMandatoryDocuments(CANDIDATE_ID);

    expect(missing).not.toContain("Aadhaar Card");
    expect(missing).not.toContain("PAN Card");
  });

  it("neither waived when digilocker verified neither (no session, or session failed)", async () => {
    installMock([]);

    const missing = await findMissingMandatoryDocuments(CANDIDATE_ID);

    expect(missing).toContain("Aadhaar Card");
    expect(missing).toContain("PAN Card");
  });

  it("a manually uploaded PAN document still satisfies the requirement without digilocker", async () => {
    execute.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes("candidate_onboarding_document")) {
        return [[...OTHER_DOCS, { doc_type: "PAN Card", doc_name: "PAN Card" }], []];
      }
      if (s.includes("candidate_bgv_check")) return [[], []]; // no digilocker verification at all
      return [[], []];
    });

    const missing = await findMissingMandatoryDocuments(CANDIDATE_ID);

    expect(missing).not.toContain("PAN Card");
    expect(missing).toContain("Aadhaar Card"); // still missing -- no digilocker, no manual upload
  });
});
