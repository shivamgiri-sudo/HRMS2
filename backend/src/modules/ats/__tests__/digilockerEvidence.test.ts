/**
 * Only mark verified what DigiLocker actually returned.
 *
 * autoCreateDigilockerVerifiedChecks marked BOTH `aadhaar` and `pan` verified on
 * any completion. That was safe while it was unreachable; it stopped being safe
 * the moment the sync path started calling it, because the assumption behind it
 * is not true:
 *
 *   - HRMS2 asks for ["AADHAAR", "PAN"], but that list never reaches the
 *     provider. Luckpay's verifyDigilockerWithURL takes only
 *     clientTransactionId, customerName and mobileNumber — there is no document
 *     parameter — so the request is decorative.
 *   - downloadKycDocument returns ONE document (fileName, contentType, url),
 *     not a set. What the candidate consents to share in the DigiLocker portal
 *     decides what comes back.
 *
 * So a completion may well carry Aadhaar and no PAN. Marking PAN verified then
 * is worse than paying for the PAN check: it records a verification that never
 * happened AND skips the check that would have caught it.
 *
 * Aadhaar is different. A DigiLocker session is authenticated with Aadhaar, so
 * completing one does evidence the holder's Aadhaar. PAN has to be shown in the
 * returned documents.
 */
import { describe, it, expect } from "vitest";
import { digilockerVerifiedCheckTypes } from "../digilocker-evidence.js";

describe("digilockerVerifiedCheckTypes", () => {
  it("credits Aadhaar on completion, because the session is Aadhaar-authenticated", () => {
    expect(digilockerVerifiedCheckTypes({})).toContain("aadhaar");
  });

  it("does NOT credit PAN when nothing indicates a PAN was returned", () => {
    // The expensive-but-correct outcome: the paid PAN check still runs.
    expect(digilockerVerifiedCheckTypes({})).not.toContain("pan");
  });

  it("credits PAN when the returned document is a PAN", () => {
    for (const fileName of ["PAN_ABCDE1234F.pdf", "pancard.xml", "Digilocker-PAN-Verification.pdf"]) {
      expect(digilockerVerifiedCheckTypes({ fileName }), fileName).toContain("pan");
    }
  });

  it("credits PAN when the document list names it", () => {
    expect(digilockerVerifiedCheckTypes({ documentTypes: ["AADHAAR", "PAN"] })).toContain("pan");
  });

  it("is not fooled by the word appearing inside another word", () => {
    // "company", "panel", "japan" must not read as a PAN document.
    for (const fileName of ["company-letter.pdf", "panel-report.pdf", "japan-visa.pdf"]) {
      expect(digilockerVerifiedCheckTypes({ fileName }), fileName).not.toContain("pan");
    }
  });

  it("credits Aadhaar from an Aadhaar document name too", () => {
    expect(digilockerVerifiedCheckTypes({ fileName: "AADHAAR_XXXX1234.xml" })).toContain("aadhaar");
  });

  it("never returns anything other than the two check types it can evidence", () => {
    const types = digilockerVerifiedCheckTypes({ documentTypes: ["AADHAAR", "PAN", "DRIVING_LICENCE"] });
    expect(types.sort()).toEqual(["aadhaar", "pan"]);
  });

  it("survives a download failure without crediting anything it cannot see", () => {
    // documentMeta carries only downloadError in that case.
    const types = digilockerVerifiedCheckTypes({ downloadError: "provider timed out" });
    expect(types).toContain("aadhaar");
    expect(types).not.toContain("pan");
  });
});
