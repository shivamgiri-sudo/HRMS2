/**
 * Server-side deny-list for AI-drafted fix diffs (mira_fix_draft), the second half of the
 * Mira issue-triage pipeline. mira-issue-triage-guard.ts gates what a complaint is allowed
 * to ask for; this gates what a generated CODE CHANGE is allowed to touch, once triage has
 * decided a complaint is a genuine_bug worth attempting a fix for.
 *
 * WHY A SEPARATE, FILE-PATH-BASED GUARD
 *
 * The triage guard reads free text and blocks unsafe REQUESTS. This guard reads a unified
 * diff and blocks unsafe TARGETS, regardless of how innocent the request sounded — a
 * complaint like "the special allowance drill-down doesn't show" is completely legitimate,
 * but if a drafted fix touches payrollCalculate.service.ts to get there, that must never be
 * approvable no matter how correct the diff looks. This is this codebase's own hardest rule
 * (see CLAUDE.md "Payroll and Statutory Safety Rules" and hrms2-never-change-salary-calculation)
 * plus the equivalent for RBAC, encryption/secrets and migrations — none of those may ever be
 * changed by an unattended AI proposal, only by a human directly.
 *
 * MUST be re-run server-side at deploy time (never trust a client-supplied "already checked"
 * flag) — see the deploy route this is written for, not yet built (Phase 2).
 *
 * WHAT THIS DOES NOT DO
 *
 * Does not evaluate whether a diff is correct, safe to apply, or passes tests — that is the
 * isolated-worktree typecheck/test gate at deploy time. This only answers "is any touched
 * file categorically off-limits for AI-authored changes."
 */

export interface FixDraftGuardResult {
  safe: boolean;
  deniedFiles: Array<{ file: string; reason: string }>;
}

// Each entry: [pattern matched against a repo-relative path, human-readable reason].
// Patterns are deliberately broad — widen rather than narrow if a real path is missed,
// same philosophy as mira-issue-triage-guard.ts's UNSAFE_PATTERNS.
const DENIED_PATH_PATTERNS: Array<[RegExp, string]> = [
  // Payroll arithmetic — never touched by an unattended AI proposal, however plausible.
  [/payrollCalculate|payroll-calculate|salary.*calc|calc.*salary/i,
    "touches payroll/salary calculation logic — this codebase's hardest rule, human-only"],

  // RBAC / access control.
  [/requireRole|requireAuth|authMiddleware|rbac/i,
    "touches an access-control or authorization file"],

  // Field-level encryption and any credential/secret material.
  [/field-encryption|encryption\.service|secret|credential/i,
    "touches encryption or secret-handling code"],
  [/(^|\/)\.env(\.|$)/i, "touches an environment/secrets file"],
  [/\.(pem|key|crt|p12|pfx)$/i, "touches a certificate or key file"],

  // Schema changes — migrations must be authored and reviewed by a human, not generated
  // and applied by this pipeline; a schema change is unrecoverable in a way a code diff
  // usually is not.
  [/^backend\/sql\//i, "touches a database migration"],

  // Deploy/CI configuration — a diff must never be able to alter how it itself gets deployed
  // or reviewed.
  [/^\.github\/workflows\//i, "touches CI/deploy workflow configuration"],

  // This guard and its own draft pipeline — a diff must never be able to widen or disable
  // the very check gating it.
  [/mira-fix-draft/i, "touches the fix-draft pipeline's own code — self-modification is never approvable"],
  [/mira-issue-triage-guard|ai-input-guard/i, "touches an existing AI safety guard"],
];

/**
 * Extracts repo-relative file paths touched by a unified diff, from `diff --git a/X b/X`
 * and `+++ b/X` / `--- a/X` header lines. Deliberately conservative: an unparseable diff
 * (no recognizable file headers at all) is treated as touching zero files, which callers
 * must treat as invalid/unsafe on its own — this function only extracts, it does not
 * validate the diff is well-formed.
 */
export function extractTouchedFiles(diffText: string): string[] {
  const files = new Set<string>();
  const gitHeaderRe = /^diff --git a\/(\S+) b\/(\S+)/gm;
  let m: RegExpExecArray | null;
  while ((m = gitHeaderRe.exec(diffText)) !== null) {
    files.add(m[1]);
    files.add(m[2]);
  }
  const plusMinusRe = /^(?:\+\+\+|---) [ab]\/(\S+)/gm;
  while ((m = plusMinusRe.exec(diffText)) !== null) {
    files.add(m[1]);
  }
  return Array.from(files);
}

export function checkFixDraftSafety(diffText: string): FixDraftGuardResult {
  const files = extractTouchedFiles(diffText);
  const deniedFiles: Array<{ file: string; reason: string }> = [];

  if (files.length === 0) {
    return { safe: false, deniedFiles: [{ file: "(unparseable diff)", reason: "no recognizable file headers — refusing to approve an unparseable diff" }] };
  }

  for (const file of files) {
    for (const [pattern, reason] of DENIED_PATH_PATTERNS) {
      if (pattern.test(file)) {
        deniedFiles.push({ file, reason });
        break; // one reason per file is enough
      }
    }
  }

  return { safe: deniedFiles.length === 0, deniedFiles };
}
