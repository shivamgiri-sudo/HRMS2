import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The joining-document "does a usable file already exist?" check must resolve the
 * stored path, not trust it.
 *
 * WHY THIS ONE IS NOT A 404
 * The two callers use that check to decide whether to reuse an existing file. A
 * false negative does not surface as "file missing" — it makes ensureGeneratedFile()
 * REGENERATE the document, rewrite the checklist status back to
 * pending_candidate_esign / uploaded_pending_review, and record a fresh
 * DOCUMENT_GENERATED audit row. Its lookup is ordered
 * FIELD(file_role,'signed','generated'), so on the wrong row that silently replaces
 * a completed e-signature with a new unsigned draft and asks the employee to sign
 * again.
 *
 * WHY IT IS STILL WORTH GUARDING AT ZERO EXPOSURE
 * Verified live 2026-08-16: 9 of 51 rows hold a foreign absolute path, but none is
 * currently the winning row for its checklist — checked with the caller's own
 * ordering, all 30 winners resolve locally. So nothing is broken today. The guard is
 * against recurrence: pre-launch uploads from developer machines keep writing
 * foreign paths, and the failure is destructive and silent the first time one
 * becomes the newest row.
 *
 * Source-text assertions, matching how the other large service-internal helpers in
 * this repo are pinned.
 */
const SRC = readFileSync(resolve(__dirname, "../employeeJoiningDocuments.service.ts"), "utf8");

describe("joining document file resolution", () => {
  it("defines a resolver that falls back beyond the stored path", () => {
    expect(SRC).toMatch(/function resolveJoiningDocumentFile\(/);
    expect(SRC).toMatch(/STORAGE_ROOT,\s*\n?\s*employeeId,/);
  });

  it("splits on BOTH separators, because path.basename is platform-specific", () => {
    // On Linux a backslash is an ordinary filename character, so path.basename() on
    // "C:\dir\file.pdf" returns the whole string and the fallback silently no-ops.
    // Plain containment, not a regex: escaping a pattern that itself contains
    // backslashes and slashes through a regex literal is how you end up asserting
    // four backslashes instead of two and matching nothing.
    expect(SRC).toContain("raw.split(/[\\\\/]/).pop()");
  });

  it("no longer calls existsSync directly on a stored joining-document path", () => {
    // The exact shape of the bug at both call sites.
    expect(SRC).not.toMatch(/fs\.existsSync\(existing\.storage_path\)/);
    expect(SRC).not.toMatch(/fs\.existsSync\(generatedDraft\.storage_path\)/);
  });

  it("routes the reuse check through the resolver at both call sites", () => {
    const uses = SRC.match(/resolveJoiningDocumentFile\(/g) ?? [];
    // One definition plus two call sites.
    expect(uses.length).toBeGreaterThanOrEqual(3);
    expect(SRC).toMatch(/resolveJoiningDocumentFile\(existing\.storage_path/);
    expect(SRC).toMatch(/resolveJoiningDocumentFile\(generatedDraft\.storage_path/);
  });

  it("returns null rather than a guessed path when nothing is readable", () => {
    // A genuinely missing file must still be treated as missing, or the caller would
    // reuse a path that cannot be served.
    expect(SRC).toMatch(/return isReadableFile\(candidate\) \? candidate : null/);
  });

  it("documents that regeneration — not a 404 — is the failure mode", () => {
    // The reason this guard exists is easy to lose; keep it attached to the code.
    expect(SRC).toMatch(/REGENERATE|regenerat/i);
    expect(SRC).toMatch(/e-signature|esign/i);
  });
});
