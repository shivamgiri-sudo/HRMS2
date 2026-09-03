import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Two ways a finished joining document could be lost, both found on live rows.
 *
 * 1. Regenerating a draft downgraded a signed document. attachGeneratedArtifact()
 *    wrote status='draft_generated' with no guard, so any caller that regenerated
 *    a document which had already been e-signed destroyed the completion — the
 *    only trace left being fill_status and completed_at, which then disagreed with
 *    status. MAS47814's employment contract was signed 2026-08-01 11:13 and reset
 *    at 17:21. ats.convert.service.ts documents this hazard and dodges it by not
 *    calling the generator; that protects one call site, so the guard belongs on
 *    the write itself.
 *
 * 2. A document present on disk reported as missing. The file-access path called
 *    fs.existsSync() on the stored path verbatim. Some rows hold an absolute path
 *    from a developer machine, because the same shared database is written from
 *    off-server — the bytes can be in the canonical place under STORAGE_ROOT while
 *    the recorded string names a drive the host does not have. The module already
 *    has resolveJoiningDocumentFile() for exactly this; the access path was the
 *    one place not using it.
 */
const formFill = readFileSync(
  resolve(process.cwd(), 'src/modules/employees/universalDigitalFormFill.service.ts'),
  'utf8',
);
const joiningDocs = readFileSync(
  resolve(process.cwd(), 'src/modules/employees/employeeJoiningDocuments.service.ts'),
  'utf8',
);

describe('regenerating a draft cannot downgrade a finished document', () => {
  it('preserves a terminal status in the attachGeneratedArtifact write', () => {
    const fn = formFill.slice(formFill.indexOf('async function attachGeneratedArtifact'));
    const update = fn.slice(fn.indexOf('UPDATE employee_joining_document_checklist'));
    // Only the `status = CASE`, not the `fill_status = CASE` that precedes it —
    // that one legitimately opens on the 'confirmed' arm, and "fill_status = CASE"
    // contains "status = CASE" as a substring, so slice from where it ends.
    const statusCase = update.slice(update.indexOf('ELSE fill_status END'));
    // The guard must be the FIRST branch: a later one would already have been
    // overtaken by the 'confirmed' / 'hr_fill_required' arms.
    const guardAt = statusCase.indexOf('WHEN status IN (');
    const confirmedAt = statusCase.indexOf("WHEN employee_review_status = 'confirmed'");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(confirmedAt);
    expect(statusCase).toContain('THEN status');
  });

  it('binds the same five terminal states the rest of the codebase uses', () => {
    const list = formFill.match(/TERMINAL_CHECKLIST_STATUSES = \[([\s\S]*?)\]/)?.[1] ?? '';
    for (const status of ['verified', 'completed', 'esign_completed', 'signed_verified', 'wet_signed_uploaded']) {
      expect(list, `${status} missing`).toContain(`'${status}'`);
    }
    // Bound, not interpolated — these go into the SQL as parameters.
    const fn = formFill.slice(formFill.indexOf('async function attachGeneratedArtifact'));
    expect(fn).toContain('[...TERMINAL_CHECKLIST_STATUSES, checklist.checklist_id]');
  });
});

describe('document access resolves the stored path before declaring it missing', () => {
  it('uses resolveJoiningDocumentFile rather than a bare existsSync', () => {
    const fn = joiningDocs.slice(joiningDocs.indexOf('export async function getJoiningDocumentFileForAccess'));
    const body = fn.slice(0, fn.indexOf('export async function getChecklistDocumentFileForAccess'));
    expect(body).toContain('resolveJoiningDocumentFile(');
    expect(body).not.toContain('fs.existsSync(String(file.storage_path))');
  });

  it('streams the resolved path, not the raw stored string', () => {
    const fn = joiningDocs.slice(joiningDocs.indexOf('export async function getJoiningDocumentFileForAccess'));
    const body = fn.slice(0, fn.indexOf('export async function getChecklistDocumentFileForAccess'));
    expect(body).toContain('storagePath: resolvedPath');
    expect(body).not.toContain('storagePath: String(file.storage_path)');
  });

  it('still 404s when the bytes are genuinely absent', () => {
    const fn = joiningDocs.slice(joiningDocs.indexOf('export async function getJoiningDocumentFileForAccess'));
    const body = fn.slice(0, fn.indexOf('export async function getChecklistDocumentFileForAccess'));
    expect(body).toContain('if (!resolvedPath)');
    expect(body).toContain('Secure document file is missing from storage');
  });
});
