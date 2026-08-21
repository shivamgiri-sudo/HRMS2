/**
 * Domain-specific safety gate for Mira's write-capable actions (e.g. filing a leave
 * request on the user's behalf), layered on top of (never instead of) the generic
 * prompt-injection guard in ai-input-guard.ts.
 *
 * WHY A SEPARATE LAYER
 *
 * Modelled directly on mira-issue-triage-guard.ts's checkDomainSafety() — same
 * philosophy, different domain. Anything that reaches an action-drafting route has
 * already passed the generic injection check; this is the second, independent layer
 * for action-taking specifically: a request can be free of jailbreak phrasing and
 * still describe something Mira must never do unattended — act for another named
 * employee, bypass an approval step, or submit in bulk on someone's behalf.
 *
 * WHAT THIS DOES AND DOES NOT DO
 *
 * Blocks a request from ever being drafted into a pendingAction if it matches.
 * Deliberately not clever about intent — a plain pattern match. Rather have false
 * positives fall through to "please use the leave page directly" than a false
 * negative reach a live write path.
 */

export interface ActionGuardResult {
  safe: boolean;
  reasons: string[];
}

// Each entry: [pattern, human-readable reason]. Deliberately broad and additive;
// widen rather than narrow if a real case is missed.
const UNSAFE_ACTION_PATTERNS: Array<[RegExp, string]> = [
  // Acting for someone else — self-scope is already enforced server-side on the
  // real leave endpoint, but a request phrased this way should never even reach
  // the draft stage pretending it might work.
  [/\b(his|her|their|someone else'?s?)\s+leave\b/i, "asks Mira to act on another person's behalf"],
  [/\bfor\s+(?!me\b|myself\b)[a-z][a-z .'-]{1,40}\b(?:'s)?\s+leave\b/i,
    "names someone other than the caller as the leave subject"],
  [/\bon behalf of\b/i, "explicitly asks to act on someone else's behalf"],

  // Approval / workflow bypass — Mira drafts and files, it never approves.
  [/\bskip\s+(the\s+)?approval\b/i, "asks to skip an approval step"],
  [/\bauto[- ]?approve\b/i, "asks Mira to approve rather than submit"],
  [/\bapprove\s+(my|this|the)\s+leave\b/i, "asks Mira to approve a leave request"],
  [/\bbypass\s+(rbac|role|permission|approval|access\s*control)/i, "asks to bypass access control"],

  // Bulk/mass action requests — every action Mira takes is one explicit,
  // individually-confirmed request; nothing here is a batch operation.
  [/\b(all|every)\s+(employees?|staff|team)\b.{0,30}\bleave\b/i, "asks for a bulk action across multiple employees"],
  [/\bfor (?:all|every) (?:my )?(?:team|reports?)\b/i, "asks for a bulk action across multiple employees"],
];

export function checkActionSafety(text: string): ActionGuardResult {
  const reasons: string[] = [];
  for (const [pattern, reason] of UNSAFE_ACTION_PATTERNS) {
    if (pattern.test(text)) reasons.push(reason);
  }
  return { safe: reasons.length === 0, reasons };
}
