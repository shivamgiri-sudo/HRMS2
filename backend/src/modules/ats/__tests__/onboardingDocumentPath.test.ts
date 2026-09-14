import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";

import {
  ONBOARDING_DOCUMENT_ROOT,
  resolveOnboardingDocumentFile,
  onboardingDocumentExists,
  toStorableDocumentPath,
} from "../onboardingDocumentPath.js";

/**
 * Production holds 58 candidate_onboarding_document rows whose file_path cannot be
 * read, in two shapes taken verbatim from the live table:
 *
 *   C:\Users\ADMIN\Desktop\HRMS2-latest\backend\private-storage\onboarding-documents\<uuid>.jpg
 *   /var/www/HRMS2/backend/dist/private-storage/onboarding-documents/<uuid>.jpg
 *
 * The first was written on a developer's Windows box; the second comes from
 * process.cwd() differing between `npm run dev` and `node dist/src/server.js`.
 * Meanwhile all 210 files sit in one flat directory on the server. Document
 * previews 404 and e-sign cannot read the buffer.
 */

const FIXTURE = "11111111-2222-3333-4444-555555555555.jpg";
const WINDOWS_PATH = String.raw`C:\Users\ADMIN\Desktop\HRMS2-latest\backend\private-storage\onboarding-documents` + `\\${FIXTURE}`;
const DIST_PATH = `/var/www/HRMS2/backend/dist/private-storage/onboarding-documents/${FIXTURE}`;

let createdDir = false;
let createdFile = false;

beforeAll(() => {
  if (!fs.existsSync(ONBOARDING_DOCUMENT_ROOT)) {
    fs.mkdirSync(ONBOARDING_DOCUMENT_ROOT, { recursive: true });
    createdDir = true;
  }
  const target = path.join(ONBOARDING_DOCUMENT_ROOT, FIXTURE);
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, "fixture");
    createdFile = true;
  }
});

afterAll(() => {
  const target = path.join(ONBOARDING_DOCUMENT_ROOT, FIXTURE);
  if (createdFile && fs.existsSync(target)) fs.unlinkSync(target);
  if (createdDir && fs.existsSync(ONBOARDING_DOCUMENT_ROOT)) {
    try { fs.rmdirSync(ONBOARDING_DOCUMENT_ROOT); } catch { /* other documents present */ }
  }
});

describe("onboarding document path resolution", () => {
  it("recovers a document stored with a Windows developer path", () => {
    const resolved = resolveOnboardingDocumentFile(WINDOWS_PATH.replace("\\\\", "\\"));
    expect(resolved, "a foreign absolute path must still find the file").not.toBeNull();
    expect(fs.existsSync(String(resolved))).toBe(true);
  });

  it("recovers a document stored under the wrong working directory (dist/)", () => {
    const resolved = resolveOnboardingDocumentFile(DIST_PATH);
    expect(resolved).not.toBeNull();
    expect(path.basename(String(resolved))).toBe(FIXTURE);
  });

  it("still honours a correct path", () => {
    const direct = path.join(ONBOARDING_DOCUMENT_ROOT, FIXTURE);
    expect(resolveOnboardingDocumentFile(direct)).toBe(direct);
  });

  it("returns null for a document that genuinely is not on disk", () => {
    expect(resolveOnboardingDocumentFile("/var/www/HRMS2/backend/private-storage/onboarding-documents/nope.jpg")).toBeNull();
    expect(onboardingDocumentExists("")).toBe(false);
    expect(onboardingDocumentExists(null)).toBe(false);
  });

  it("persists only the file name so rows stay portable", () => {
    expect(toStorableDocumentPath(DIST_PATH)).toBe(FIXTURE);
  });

  it("does not mistake a directory for a document", () => {
    expect(resolveOnboardingDocumentFile(ONBOARDING_DOCUMENT_ROOT)).toBeNull();
  });
});
