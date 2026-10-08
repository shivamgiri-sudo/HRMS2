import { describe, expect, it } from 'vitest';
import { checkFixDraftSafety, extractTouchedFiles } from '../mira-fix-draft-guard.js';

function diffFor(path: string, body = 'context\n+added line\n-removed line\n'): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,2 @@\n${body}`;
}

describe('extractTouchedFiles', () => {
  it('extracts a single file from a well-formed diff', () => {
    expect(extractTouchedFiles(diffFor('src/pages/Foo.tsx'))).toContain('src/pages/Foo.tsx');
  });

  it('extracts multiple files from a multi-file diff', () => {
    const combined = diffFor('a.ts') + diffFor('b.ts');
    const files = extractTouchedFiles(combined);
    expect(files).toContain('a.ts');
    expect(files).toContain('b.ts');
  });

  it('returns empty for text with no diff headers at all', () => {
    expect(extractTouchedFiles('just some prose, not a diff')).toEqual([]);
  });
});

describe('checkFixDraftSafety — legitimate diffs pass', () => {
  it('allows a diff touching only an ordinary frontend page', () => {
    const result = checkFixDraftSafety(diffFor('src/pages/NativeWorkInbox.tsx'));
    expect(result.safe).toBe(true);
    expect(result.deniedFiles).toEqual([]);
  });

  it('allows a diff touching an ordinary backend route file', () => {
    const result = checkFixDraftSafety(diffFor('backend/src/modules/inbox/inbox.service.ts'));
    expect(result.safe).toBe(true);
  });
});

describe('checkFixDraftSafety — adversarial: each hard-denied category is caught', () => {
  it('rejects a diff touching payroll calculation, however the path is phrased', () => {
    expect(checkFixDraftSafety(diffFor('backend/src/modules/payroll/payrollCalculate.service.ts')).safe).toBe(false);
    expect(checkFixDraftSafety(diffFor('backend/src/modules/payroll/salary-calc-helpers.ts')).safe).toBe(false);
  });

  it('rejects a diff touching RBAC/auth middleware', () => {
    expect(checkFixDraftSafety(diffFor('backend/src/middleware/requireRole.ts')).safe).toBe(false);
    expect(checkFixDraftSafety(diffFor('backend/src/middleware/authMiddleware.ts')).safe).toBe(false);
  });

  it('rejects a diff touching encryption/secret-handling code', () => {
    expect(checkFixDraftSafety(diffFor('backend/src/lib/field-encryption.ts')).safe).toBe(false);
    expect(checkFixDraftSafety(diffFor('backend/.env')).safe).toBe(false);
  });

  it('rejects a diff touching a database migration', () => {
    expect(checkFixDraftSafety(diffFor('backend/sql/9999_sneaky_change.sql')).safe).toBe(false);
  });

  it('rejects a diff touching CI/deploy workflow config', () => {
    expect(checkFixDraftSafety(diffFor('.github/workflows/deploy.yml')).safe).toBe(false);
  });

  it('rejects a diff that tries to modify its own guard (self-modification)', () => {
    expect(checkFixDraftSafety(diffFor('backend/src/modules/ai/mira-fix-draft-guard.ts')).safe).toBe(false);
    expect(checkFixDraftSafety(diffFor('backend/src/modules/ai/mira-issue-triage-guard.ts')).safe).toBe(false);
  });

  it('rejects an unparseable diff outright rather than treating it as touching nothing', () => {
    const result = checkFixDraftSafety('not a real diff, just some AI prose about a fix');
    expect(result.safe).toBe(false);
    expect(result.deniedFiles[0].reason).toMatch(/unparseable/);
  });

  it('rejects a mixed diff — one safe file plus one denied file — as a whole', () => {
    const combined = diffFor('src/pages/Foo.tsx') + diffFor('backend/src/middleware/requireRole.ts');
    const result = checkFixDraftSafety(combined);
    expect(result.safe).toBe(false);
    expect(result.deniedFiles.some((d) => d.file === 'backend/src/middleware/requireRole.ts')).toBe(true);
  });

  it('rejects an attempt to smuggle a denied path via case variation', () => {
    expect(checkFixDraftSafety(diffFor('backend/src/modules/payroll/PayrollCalculate.service.ts')).safe).toBe(false);
    expect(checkFixDraftSafety(diffFor('BACKEND/SQL/9999_x.sql')).safe).toBe(false);
  });
});
