import fs from "fs";
import path from "path";

/**
 * Where candidate onboarding documents live on THIS machine.
 *
 * Uploads recorded an absolute file_path, so the value in the shared database
 * depends on which machine and which working directory wrote it. Production has
 * both failure modes:
 *
 *   C:\Users\ADMIN\Desktop\HRMS2-latest\backend\private-storage\onboarding-documents\...
 *   /var/www/HRMS2/backend/dist/private-storage/onboarding-documents/...
 *
 * The first is a developer's Windows path; the second comes from process.cwd()
 * differing between `npm run dev` (backend/) and `node dist/src/server.js`. The
 * files themselves are all in one flat directory here — 210 of them, 231 MB — but
 * 58 document rows point somewhere unreadable, so previews 404 and e-sign cannot
 * read the buffer.
 *
 * Names are UUID-based and unique, so recovering by file name is unambiguous.
 */
export const ONBOARDING_DOCUMENT_ROOT = path.resolve(process.cwd(), "private-storage", "onboarding-documents");

/**
 * Resolve a stored document path to a file that exists here, or null.
 *
 * Tries the stored value, then its file name inside the canonical directory.
 * The fallback makes rows written on another OS — or under a different working
 * directory — readable again without a data migration.
 */
export function resolveOnboardingDocumentFile(storedPath: unknown): string | null {
  const raw = String(storedPath ?? "").trim();
  if (!raw) return null;

  if (isReadableFile(raw)) return raw;

  // Windows paths arrive with backslashes, which are ordinary filename characters
  // on Linux — path.basename would hand back the entire string.
  const fileName = raw.split(/[\\/]/).pop();
  if (!fileName) return null;

  const candidate = path.join(ONBOARDING_DOCUMENT_ROOT, fileName);
  return isReadableFile(candidate) ? candidate : null;
}

/** True when a readable file exists for this stored path. */
export function onboardingDocumentExists(storedPath: unknown): boolean {
  return resolveOnboardingDocumentFile(storedPath) !== null;
}

/**
 * What to persist for a newly uploaded document: the file name only.
 *
 * Keeps the row portable across machines and working directories, so neither
 * failure mode above can be reintroduced by the next upload.
 */
export function toStorableDocumentPath(absolutePath: string): string {
  return path.basename(absolutePath);
}

function isReadableFile(candidate: string): boolean {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}
