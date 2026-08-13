/**
 * Bounded, read-only repo context gathering for mira-fix-draft-generate.service.ts.
 *
 * A diff-generating LLM call is only as good as the files it can see. Blindly dumping the
 * whole repo is both unaffordable (token budget) and unsafe (more surface for the model to
 * "help" with something it shouldn't touch). This does the minimum useful thing instead:
 * pull keywords out of the complaint + diagnosis text, `git grep` the repo for files that
 * actually mention them, and return a small, size-capped bundle of the most relevant ones.
 *
 * Deliberately conservative: TOP_FILES caps how many files ever reach the model,
 * MAX_FILE_CHARS caps how much of each one does. Read-only throughout — no state changes,
 * nothing here writes anything.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// backend/src/modules/ai -> repo root is four levels up.
const REPO_ROOT = path.resolve(HERE, '../../../..');

const TOP_FILES = 5;
const MAX_FILE_CHARS = 4000;

// Common English words plus HRMS-generic terms that would match almost every file and add
// no signal — filtered out so keyword search stays on the specific, not the generic.
const STOPWORDS = new Set([
  'this', 'that', 'these', 'those', 'with', 'from', 'have', 'has', 'had', 'does', 'doesn',
  'not', 'the', 'and', 'for', 'are', 'was', 'were', 'been', 'being', 'able', 'unable',
  'when', 'where', 'what', 'why', 'how', 'which', 'who', 'whom', 'there', 'their', 'them',
  'show', 'showing', 'shown', 'want', 'wanted', 'wants', 'please', 'issue', 'problem', 'error',
  'system', 'application', 'employee', 'employees', 'user', 'users', 'hrms', 'mira',
]);

export interface ContextFile {
  path: string;
  content: string;
}

/**
 * Pulls candidate search terms out of free text: lowercase words of length >= 4, alphanumeric
 * plus underscore (so it also catches things like snake_case identifiers a complaint might
 * quote), stopwords and pure numbers filtered, deduplicated in order of first appearance.
 */
export function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z0-9_]{3,}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/**
 * `git grep -l` for each keyword, restricted to source files, tallying how many distinct
 * keywords each file matched (a file matching 3 of 5 keywords is a stronger candidate than
 * one matching 1). Returns paths ordered by match count, most relevant first, capped to
 * TOP_FILES. Never throws — a keyword that matches nothing (or git grep's own "no matches"
 * exit code 1) is just an empty contribution, not an error.
 */
export function findCandidateFiles(keywords: string[], repoRoot: string = REPO_ROOT): string[] {
  if (!keywords.length) return [];
  const scores = new Map<string, number>();

  for (const kw of keywords.slice(0, 12)) {
    let output: string;
    try {
      output = execFileSync(
        'git',
        ['grep', '-l', '-i', '-F', '-e', kw, '--', '*.ts', '*.tsx'],
        { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch {
      // git grep exits 1 with no output when nothing matches — not an error worth surfacing.
      continue;
    }
    for (const file of output.split('\n').filter(Boolean)) {
      // Never surface test files or the fix-draft pipeline's own code as edit targets —
      // matches mira-fix-draft-guard.ts's self-modification denial, applied earlier here so
      // a candidate that would be rejected anyway never wastes context budget.
      if (file.includes('__tests__') || file.includes('mira-fix-draft')) continue;
      scores.set(file, (scores.get(file) ?? 0) + 1);
    }
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_FILES)
    .map(([file]) => file);
}

/**
 * Reads each candidate file, truncated to MAX_FILE_CHARS. Skips (rather than throws on) a
 * file that can no longer be read — git grep and the read are not atomic, and a file rename
 * or delete between the two must not fail the whole draft attempt.
 */
export function readContextFiles(filePaths: string[], repoRoot: string = REPO_ROOT): ContextFile[] {
  const out: ContextFile[] = [];
  for (const relPath of filePaths) {
    try {
      const full = path.join(repoRoot, relPath);
      const content = readFileSync(full, 'utf8').slice(0, MAX_FILE_CHARS);
      out.push({ path: relPath, content });
    } catch {
      continue;
    }
  }
  return out;
}

/** Convenience: keywords -> read, size-capped context bundle, in one call. */
export function buildContextBundle(complaintText: string, diagnosisText: string, repoRoot: string = REPO_ROOT): ContextFile[] {
  const keywords = extractKeywords(`${complaintText} ${diagnosisText}`);
  const files = findCandidateFiles(keywords, repoRoot);
  return readContextFiles(files, repoRoot);
}
