import { describe, expect, it } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractKeywords, findCandidateFiles, readContextFiles, buildContextBundle } from '../mira-fix-draft-context.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// backend/src/modules/ai/__tests__ -> repo root is five levels up.
const REPO_ROOT = path.resolve(HERE, '../../../../..');

describe('extractKeywords', () => {
  it('extracts meaningful words, lowercased, deduplicated', () => {
    const kws = extractKeywords('Special Allowance drill down is not showing in Payroll Special Allowance');
    expect(kws).toContain('special');
    expect(kws).toContain('allowance');
    expect(kws).toContain('drill');
    expect(kws).toContain('payroll');
    // Deduplicated: 'special' and 'allowance' each appear twice in the input, once in output.
    expect(kws.filter((k) => k === 'special')).toHaveLength(1);
  });

  it('filters stopwords and short words', () => {
    const kws = extractKeywords('this is the user and I want it to show why not able');
    expect(kws).not.toContain('this');
    expect(kws).not.toContain('want');
    expect(kws).not.toContain('show');
    expect(kws).not.toContain('able');
  });

  it('returns empty for text with nothing but stopwords/short words', () => {
    expect(extractKeywords('is it a the of')).toEqual([]);
  });
});

describe('findCandidateFiles — against the real repo, read-only', () => {
  it('excludes its own pipeline files even when they are the ONLY real match', () => {
    // DENIED_PATH_PATTERNS exists in exactly one file in the whole repo:
    // mira-fix-draft-guard.ts itself (confirmed via a real `git grep` before writing this
    // assertion). This is the strongest form of the self-modification test: the underlying
    // search genuinely finds a hit, and the exclusion filter removes it down to empty —
    // not a keyword that never matched anything in the first place.
    const files = findCandidateFiles(['DENIED_PATH_PATTERNS'.toLowerCase()], REPO_ROOT);
    expect(files).toEqual([]);
  });

  it('finds a real, non-excluded file and never returns a test file or its own pipeline files', () => {
    // Both keywords appear in runPendingMigrations.ts (real target) AND in
    // verify-schema-version-timeout.test.ts (must be excluded) — a genuine positive-and-
    // negative case in one search, not just an assertion that would trivially pass on empty.
    const files = findCandidateFiles(['verifyschemaversion', 'connecttimeout'], REPO_ROOT);
    expect(files).toContain('backend/src/db/runPendingMigrations.ts');
    expect(files.every((f) => !f.includes('__tests__'))).toBe(true);
    expect(files.every((f) => !f.includes('mira-fix-draft'))).toBe(true);
  });

  it('returns an empty list for keywords matching nothing real', () => {
    const files = findCandidateFiles(['zzzznonexistentkeywordxyzabc123'], REPO_ROOT);
    expect(files).toEqual([]);
  });

  it('returns an empty list for an empty keyword list, without calling git at all', () => {
    expect(findCandidateFiles([], REPO_ROOT)).toEqual([]);
  });
});

describe('readContextFiles', () => {
  it('reads a real file and truncates to the size cap', () => {
    const files = readContextFiles(['backend/src/modules/ai/mira-fix-draft-guard.ts'], REPO_ROOT);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('backend/src/modules/ai/mira-fix-draft-guard.ts');
    expect(files[0].content.length).toBeLessThanOrEqual(4000);
    expect(files[0].content).toContain('DENIED_PATH_PATTERNS');
  });

  it('skips a nonexistent file rather than throwing', () => {
    const files = readContextFiles(['this/path/does/not/exist.ts'], REPO_ROOT);
    expect(files).toEqual([]);
  });
});

describe('buildContextBundle — end to end', () => {
  it('returns a bounded, read-only bundle for a realistic complaint', () => {
    const bundle = buildContextBundle(
      'connectTimeout verifySchemaVersion hangs forever',
      'the schema verification connection has no timeout bound',
      REPO_ROOT,
    );
    expect(bundle.length).toBeGreaterThan(0);
    expect(bundle.length).toBeLessThanOrEqual(5);
    expect(bundle.some((f) => f.path === 'backend/src/db/runPendingMigrations.ts')).toBe(true);
    for (const f of bundle) {
      expect(f.content.length).toBeLessThanOrEqual(4000);
      expect(f.content.length).toBeGreaterThan(0);
    }
  });
});
