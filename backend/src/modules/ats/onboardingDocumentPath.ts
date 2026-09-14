import fs from "fs";
import path from "path";

/**
 * Where candidate onboarding documents live on THIS machine.
 *
 * Uploads record an absolute file_path, so the value stored in the shared database
 * depends on which machine and which working directory wrote it. Production holds
 * both failure modes:
 *
 *   C:\Users\ADMIN\Desktop\HRMS2-latest\backend\private-storage\onboarding-documents\...
 *   /var/www/HRMS2/backend/dist/private-storage/onboarding-documents/...
 *
 * The first is a developer's Windows path; the second comes from process.cwd()
 * differing between `npm run dev` (which runs in backend/) and
 * `node dist/src/server.js` (which does not).
 *
 * A NOTE ON WHAT THIS DOES NOT FIX
 * The 58 rows currently marked file_missing are NOT recoverable by resolving paths.
 * Their files are genuinely absent — a filesystem-wide search for their names
 * returns nothing, and the counts agree: 210 files on disk against 205 rows marked
 * uploaded. Those documents were lost, and file_missing is an accurate status
 * rather than a symptom of the path problem. They have to be re-collected from the
 * candidates.
 *
 * This resolver exists because the path-mismatch class is real and has already bitten
 * elsewhere — the same shape disabled joining-document e-signing for every template
 * (see joiningDocumentTemplatePath). It stops a row written on one machine from
 * becoming unreadable on another. It is a guard against recurrence, not a recovery
 * tool.
 *
 * Names are UUID-based and unique, so recovering by file name is unambiguous.
 */
export const ONBOARDING_DOCUMENT_ROOT = path.resolve(process.cwd(), "private-storage", "onboarding-documents");

/**
 * Resolve a stored document path to a file that exists here, or null.
 *
 * Tries the stored value, then its file name inside the canonical directory, so a
 * row written under a different OS or working directory still reads.
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
