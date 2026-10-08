/**
 * Face match has to actually fire, and has to say when it cannot.
 *
 * It has never produced a single result: candidate_bgv_check holds zero
 * photo_match rows. The cause was not what it looked like. The face-api models
 * are present on the server (12MB at backend/face-models, since 16 July), and
 * @vladmandic/face-api, canvas and tfjs are all installed. What stops it is
 * narrower:
 *
 *   - It fires only when the uploaded document type contains "selfie" or
 *     "live". Production holds 3 "Live Selfie" documents against 34 "Passport
 *     Photo" — so for 92% of the face images candidates actually upload, the
 *     comparison is never attempted.
 *
 *   - It depends on upload order. The Aadhaar or PAN image must already exist
 *     when the face image arrives; if the candidate uploads their photo first,
 *     `docs[0]` is empty and the function returns having done nothing, and
 *     nothing ever retries. 33 candidates have both documents today and not one
 *     was compared.
 *
 *   - Every way it can decline is silent — a missing model, a missing ID
 *     document, a caught exception. A candidate who was never checked is
 *     indistinguishable from one who passed, which is the more dangerous of the
 *     two to leave unsaid.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/ats/onboarding-full.service.ts"),
  "utf8",
);

describe("face match fires on the documents candidates really upload", () => {
  it("treats a passport photo as a face image, not only a live selfie", () => {
    const at = SOURCE.search(/const is(FaceImage|LiveSelfie)\s*=/);
    expect(at, "the face-image test moved or was renamed").toBeGreaterThan(-1);
    const test = SOURCE.slice(at, SOURCE.indexOf(";", at));
    expect(
      test,
      "only 3 of 37 face images uploaded are typed 'Live Selfie'; the rest are 'Passport Photo'",
    ).toMatch(/photo/i);
  });

  it("also compares when the ID document arrives after the face image", () => {
    // Otherwise the result depends on the order the candidate happens to
    // upload in, which is not something they know about.
    expect(
      SOURCE,
      "nothing re-attempts the comparison when the Aadhaar or PAN image is uploaded second",
    ).toMatch(/faceMatchOnIdDocumentUpload|reattemptFaceMatch|triggerFaceMatchForExistingSelfie/);
  });
});

describe("face match records why it could not run", () => {
  it("does not return silently when no ID document is available", () => {
    const at = SOURCE.indexOf("async function triggerFaceMatch");
    expect(at).toBeGreaterThan(-1);
    const body = SOURCE.slice(at, SOURCE.indexOf("\nasync function", at + 10));

    // A bare `if (!docs[0]) return;` is the shape that made an unchecked
    // candidate look identical to a checked one.
    expect(body).not.toMatch(/if\s*\(!docs\[0\]\)\s*return;/);
    expect(body, "the reason it declined must be recorded somewhere").toMatch(/recordFaceMatchSkipped|photo_match/);
  });

  it("does not return silently when the models are unavailable", () => {
    const at = SOURCE.indexOf("async function triggerFaceMatch");
    const body = SOURCE.slice(at, SOURCE.indexOf("\nasync function", at + 10));
    const modelGuard = body.slice(body.indexOf("isModelAvailable"));
    expect(modelGuard, "an absent model must not read as a clean candidate").toMatch(
      /recordFaceMatchSkipped/,
    );
  });
});
