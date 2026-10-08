import { describe, expect, it } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractKeywords, findCandidateFiles, readContextFiles, buildContextBundle } from '../mira-fix-draft-context.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// backend/src/modules/ai/__tests__ -> repo root is five levels up.
const REPO_ROOT = path.resolve(HERE, '../../../../..');
// MAX_FILE_CHARS (4000) plus the two truncation markers extractRelevantWindow can add.
const MAX_WINDOWED_LENGTH = 4000 + '...[truncated]...\n'.length + '\n...[truncated]...'.length;

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
  it('reads a real file and truncates to the size cap when no keyword is given', () => {
    const files = readContextFiles(['backend/src/modules/ai/mira-fix-draft-guard.ts'], [], REPO_ROOT);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('backend/src/modules/ai/mira-fix-draft-guard.ts');
    expect(files[0].content.length).toBeLessThanOrEqual(4000);
    expect(files[0].content).toContain('DENIED_PATH_PATTERNS');
  });

  it('skips a nonexistent file rather than throwing', () => {
    const files = readContextFiles(['this/path/does/not/exist.ts'], [], REPO_ROOT);
    expect(files).toEqual([]);
  });

  // Regression test for a real live-validation finding, 2026-08-13: a generation attempt
  // against runPendingMigrations.ts (1400+ lines) got the first 4000 chars of source,
  // which — at the time — ended well before verifySchemaVersion() near the bottom of the
  // file, and the model correctly declined rather than propose a diff for code it had
  // never seen. The fix windows the read around the first keyword match instead of
  // always starting at byte 0. Uses inbox.service.ts / 'requested_by_name' here rather
  // than the original file/keyword: confirmed live that the target string sits at byte 0
  // of the first 4000 chars, which would make the 'without keyword' half of this
  // assertion depend on incidental file content rather than the windowing logic itself.
  // requested_by_name first appears at line 258 of a 790-line file, confirmed absent from
  // the first 4000 chars independent of any keyword search.
  it('windows the read around the keyword instead of always starting at byte 0, for a real large file', () => {
    const withoutKeyword = readContextFiles(['backend/src/modules/inbox/inbox.service.ts'], [], REPO_ROOT);
    expect(withoutKeyword[0].content).not.toContain('requested_by_name');

    const withKeyword = readContextFiles(['backend/src/modules/inbox/inbox.service.ts'], ['requested_by_name'], REPO_ROOT);
    expect(withKeyword[0].content).toContain('requested_by_name');
    expect(withKeyword[0].content.length).toBeLessThanOrEqual(MAX_WINDOWED_LENGTH);
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
      expect(f.content.length).toBeLessThanOrEqual(MAX_WINDOWED_LENGTH);
      expect(f.content.length).toBeGreaterThan(0);
    }
  });
});
