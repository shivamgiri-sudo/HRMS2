import fs from "fs";
import path from "path";

/**
 * Where joining-document templates live on THIS machine.
 *
 * Templates were stored as absolute paths, so a template uploaded from a
 * developer's Windows box wrote e.g.
 *
 *   C:\Users\ADMIN\Desktop\HRMS2-latest\backend\private-storage\document-templates\NDA_CONFIDENTIALITY-v1.docx
 *
 * into the shared database. On the Linux production server that path can never
 * exist, so every `fs.existsSync(template_storage_path)` returned false. Eight of
 * nine production templates carry such a path — including all eight that require
 * an e-signature — and assertTemplateConfiguredForEsign turns that into a 409
 * "No document template is configured". The result is that no joining-document
 * signing link has been issued since 2026-07-11, leaving 44 employees parked in
 * pending_candidate_esign and 6 in esign_initiated.
 *
 * The files themselves are present on the server under this directory with the
 * expected names — only the recorded path is wrong.
 */
export const TEMPLATE_STORAGE_ROOT = path.resolve(process.cwd(), "private-storage", "document-templates");

/**
 * Resolve a stored template path to a file that actually exists here.
 *
 * Order: use the stored path when it resolves; otherwise fall back to its file
 * name inside TEMPLATE_STORAGE_ROOT. The fallback is what makes a database full
 * of foreign absolute paths self-healing — no data migration required, and a
 * path written on one OS keeps working on the other.
 *
 * Returns null when no readable file can be found, so callers keep their existing
 * "template not configured" behaviour rather than proceeding with a bad path.
 */
export function resolveTemplateFile(storedPath: unknown): string | null {
  const raw = String(storedPath ?? "").trim();
  if (!raw) return null;

  if (safeExists(raw)) return raw;

  // Windows paths arrive with backslashes, which are ordinary filename
  // characters on Linux — path.basename would return the whole string.
  const fileName = raw.split(/[\\/]/).pop();
  if (!fileName) return null;

  const candidate = path.join(TEMPLATE_STORAGE_ROOT, fileName);
  return safeExists(candidate) ? candidate : null;
}

/** True when a usable template file exists for this stored path. */
export function templateFileExists(storedPath: unknown): boolean {
  return resolveTemplateFile(storedPath) !== null;
}

/**
 * What to persist for a newly uploaded template: the file name only.
 *
 * Storing a bare name keeps the row portable across machines and prevents this
 * class of breakage from being reintroduced by the next upload.
 */
export function toStorableTemplatePath(absolutePath: string): string {
  // Split on BOTH separators for the same reason resolveTemplateFile does (see the note
  // there): path.basename is platform-specific, and on Linux "\" is an ordinary filename
  // character, so path.basename() on a Windows-style path returns the WHOLE string. The
  // read path was hardened against that; this write path was not, so on the production
  // server an upload carrying a backslash path persisted the full
  // "C:\Users\...\NDA_CONFIDENTIALITY-v1.docx" — reintroducing on the very next upload the
  // breakage this module exists to prevent. It passes on a Windows dev box, which is why
  // it survived; the guarding test fails only on a POSIX runner.
  const fileName = String(absolutePath ?? "").trim().split(/[\\/]/).pop();
  return fileName ?? "";
}

function safeExists(candidate: string): boolean {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}
