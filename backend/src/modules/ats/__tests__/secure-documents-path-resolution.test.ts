import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ONBOARDING_DOCUMENT_ROOT } from "../onboardingDocumentPath.js";
import { resolveDocumentPath, type CandidateDocument } from "../secure-documents.service.js";

/**
 * A candidate onboarding document must stay servable when file_path names another
 * machine.
 *
 * WHY
 * Uploads record an absolute file_path, so the stored value depends on which machine
 * and working directory wrote it. Verified live 2026-08-16: 25 of 470
 * candidate_onboarding_document rows hold a foreign path — 22 Windows, 3 POSIX.
 *
 * The original resolveDocumentPath() failed on those in the least obvious way.
 * path.isAbsolute() is platform-specific: on Linux "C:\Users\ADMIN\..." is NOT
 * absolute, because a backslash is an ordinary filename character there. So the value
 * fell through to the relative branch and resolved to <cwd>/C:\Users\ADMIN\..., and
 * getDocumentFile() reported "Document file is not available on server" for a file
 * that was sitting on disk.
 *
 * resolveOnboardingDocumentFile() already solved this and was wired into
 * onboarding-full.{routes,service}.ts. This reader was never switched over.
 *
 * These tests write real files under ONBOARDING_DOCUMENT_ROOT so the Windows case is
 * exercised on a POSIX runner, which is where it actually reproduces.
 */
const STORED_NAME = "11112222-3333-4444-5555-666677778888.pdf";
const realPath = path.join(ONBOARDING_DOCUMENT_ROOT, STORED_NAME);

function doc(overrides: Partial<CandidateDocument>): CandidateDocument {
  return {
    id: "doc-1",
    source: "onboarding",
    candidate_id: "cand-1",
    document_type: "aadhaar",
    document_name: "Aadhaar",
    file_name: STORED_NAME,
    mime_type: "application/pdf",
    file_size: 10,
    verification_status: "uploaded",
    mandatory_flag: 1,
    sensitive_flag: 1,
    name_match_status: "pending",
    uploaded_at: null,
    raw_path: null,
    raw_url: null,
    ...overrides,
  } as CandidateDocument;
}

beforeAll(() => {
  fs.mkdirSync(ONBOARDING_DOCUMENT_ROOT, { recursive: true });
  fs.writeFileSync(realPath, "test bytes");
});

afterAll(() => {
  try { fs.rmSync(realPath, { force: true }); } catch { /* best effort */ }
});

describe("resolveDocumentPath — onboarding documents", () => {
  it("returns the stored path when it resolves here", () => {
    expect(resolveDocumentPath(doc({ raw_path: realPath }))).toBe(realPath);
  });

  it("recovers a foreign Windows absolute path", () => {
    // A different user directory, so the value is unreachable on Windows too and the
    // test cannot pass by accident on a dev box.
    const foreign = `C:\\Users\\SomeoneElse\\HRMS2\\backend\\private-storage\\onboarding-documents\\${STORED_NAME}`;
    expect(resolveDocumentPath(doc({ raw_path: foreign }))).toBe(realPath);
  });

  it("recovers a foreign POSIX absolute path", () => {
    // This is the second live failure mode: process.cwd() differs between
    // `npm run dev` (backend/) and `node dist/src/server.js` (which is not backend/).
    const foreign = `/var/www/HRMS2/backend/dist/private-storage/onboarding-documents/${STORED_NAME}`;
    expect(resolveDocumentPath(doc({ raw_path: foreign }))).toBe(realPath);
  });

  it("still yields a non-existent path when the file is genuinely gone", () => {
    // 58 rows are marked file_missing because the bytes are truly absent. Those must
    // keep producing the existing 404 rather than resolving to something wrong.
    const missing = resolveDocumentPath(doc({ raw_path: "/nowhere/does-not-exist.pdf" }));
    expect(fs.existsSync(missing)).toBe(false);
  });

  it("throws when there is no path at all", () => {
    expect(() => resolveDocumentPath(doc({ raw_path: null, raw_url: null }))).toThrow();
  });
});

describe("resolveDocumentPath — portal documents keep their original handling", () => {
  it("does not route a portal document through the onboarding root", () => {
    // ats_candidate_documents has no file_path; portal rows carry a URL in raw_url.
    // Resolving those against the onboarding directory would be wrong even when a
    // same-named file happened to exist there.
    const resolved = resolveDocumentPath(
      doc({ source: "portal", raw_path: null, raw_url: `uploads/portal/${STORED_NAME}` }),
    );
    expect(resolved).toBe(path.resolve(process.cwd(), `uploads/portal/${STORED_NAME}`));
    expect(resolved).not.toBe(realPath);
  });
});
