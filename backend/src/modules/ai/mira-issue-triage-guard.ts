/**
 * Domain-specific safety gate for Mira issue-triage, layered on top of (never instead of)
 * ai-input-guard.ts's generic prompt-injection patterns.
 *
 * WHY A SEPARATE LAYER
 *
 * validateQuestion() in ai-input-guard.ts already runs on every message before it can become
 * a work_item (see ai-insights.routes.ts:347 running before detectFeedbackIntent at :419) —
 * so anything already sitting in work_item as item_type='MIRA_FEEDBACK' has passed that gate
 * once. This module is the SECOND, independent layer for issue-triage specifically: a
 * "complaint" can be perfectly free of jailbreak phrasing and still describe something that
 * must never become an unattended AI action on this system — asking to see a named
 * coworker's salary, asking to skip an approval step, asking for a destructive data
 * operation, or asking to change payroll arithmetic. None of those are prompt injection; all
 * of them are out of bounds for what a triage diagnosis is allowed to recommend.
 *
 * WHAT THIS DOES AND DOES NOT DO
 *
 * Blocks a complaint from ever reaching the LLM diagnosis step if it matches. Deliberately
 * does NOT try to be clever about intent — a plain pattern match, same philosophy as
 * ai-input-guard.ts's own "block known patterns" approach. Rather have false positives fall
 * through to a human than false negatives reach the model.
 */

export interface DomainGuardResult {
  safe: boolean;
  reasons: string[];
}

// Each entry: [pattern, human-readable reason]. Patterns are deliberately broad and additive;
// widen rather than narrow if a real case is missed, per the same reasoning as
// ai-input-guard.ts's INJECTION_PATTERNS.
const UNSAFE_PATTERNS: Array<[RegExp, string]> = [
  // Requests to view another named person's sensitive data via "fix this bug" framing.
  [/\b(show|give|send|tell)\s+me\s+.{0,40}(salary|bank\s*(account|detail)|pan\s*(number|card)|aadhaar|password|passwor)\b/i,
    "requests another person's sensitive data"],
  [/\b(his|her|their)\s+(salary|bank\s*(account|detail)|pan|aadhaar|password)\b/i,
    "references a third party's sensitive data"],

  // Requests to bypass controls that exist deliberately — approval gates, RBAC, row scope.
  [/\bskip\s+(the\s+)?approval\b/i, "asks to skip an approval step"],
  [/\bbypass\s+(rbac|role|permission|approval|access\s*control)/i, "asks to bypass access control"],
  [/\b(give|grant)\s+me\s+(admin|super\s*admin|full)\s+(access|rights|permission)/i,
    "asks to be granted elevated access"],
  [/\bdisable\s+(the\s+)?(check|guard|validation|rbac|scope)/i, "asks to disable a safety check"],

  // Destructive data operations, however phrased.
  [/\b(delete|wipe|truncate|drop|clear)\s+(all|every|the)\s+.{0,40}(record|table|data|employee|payroll|attendance)/i,
    "asks for a destructive bulk data operation"],
  [/\bdrop\s+table\b/i, "contains a DROP TABLE reference"],

  // Payroll arithmetic — this codebase's own hardest rule: payroll calculation is never
  // touched based on a user request, no matter how it's phrased.
  [/\b(change|fix|increase|decrease|adjust)\s+.{0,30}(salary|payroll)\s+(calculation|formula|amount)\b/i,
    "asks to change payroll calculation logic"],
  [/\bmy\s+salary\s+(is|should be|needs to be)\s+(wrong|higher|more|increased)/i,
    "is a salary-amount dispute, not a software bug — needs HR/Payroll, not a code fix"],

  // Credential/secret exposure.
  [/\b(what\s+is|show\s+me|give\s+me)\s+.{0,20}(api\s*key|secret|credential|token)\b/i,
    "asks for a credential or secret value"],
];

export function checkDomainSafety(text: string): DomainGuardResult {
  const reasons: string[] = [];
  for (const [pattern, reason] of UNSAFE_PATTERNS) {
    if (pattern.test(text)) reasons.push(reason);
  }
  return { safe: reasons.length === 0, reasons };
}
