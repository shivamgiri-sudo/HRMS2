/**
 * Mira issue triage — the missing middle piece between "a user complained to Mira" (already
 * built, logs a work_item — see ai-feedback.service.ts) and "a human looks at it and decides
 * what to do" (Work Inbox, already built).
 *
 * WHAT THIS ADDS: for each pending MIRA_FEEDBACK work_item, produce a plain-English diagnosis
 * — root-cause hypothesis and a suggested next step — written to work_item_audit_log so it
 * shows up as history on the item in the existing Work Inbox UI. A human reads it and decides
 * whether to act; nothing here writes code, touches git, or changes anything outside this
 * audit trail.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO — this is the whole point, not a limitation
 *
 *   - Never generates or applies a code change. No git operations exist in this file.
 *   - Never auto-approves, auto-closes or changes work_item.status. A human decides that.
 *   - Never runs unless BOTH safety layers pass (see below). A rejected complaint gets a
 *     "flagged, not analysed" audit entry explaining exactly which layer caught it and why —
 *     visible to the reviewer, never silently dropped.
 *
 * TWO INDEPENDENT SAFETY LAYERS, IN ORDER
 *
 * 1. validateQuestion() (ai-input-guard.ts) — generic prompt-injection patterns. Already runs
 *    once before a complaint can even become a work_item (ai-insights.routes.ts), re-run here
 *    as defense in depth rather than trusting that every future write path to work_item will
 *    remember to call it first.
 * 2. checkDomainSafety() (mira-issue-triage-guard.ts) — HRMS-specific requests that are not
 *    prompt injection but are still out of bounds for an unattended diagnosis step: third-party
 *    PII requests, RBAC/approval bypass requests, destructive-operation requests, payroll
 *    arithmetic change requests, credential requests.
 *
 * A complaint must pass both before it reaches the model. See
 * __tests__/mira-issue-triage-guard.test.ts for the validated case table, including cases that
 * defeat one layer and are caught by the other.
 *
 * PROVIDER RESOLUTION AND WHY THIS USES generateText, NOT generateJson
 *
 * Three real, pre-existing issues found while wiring this up (2026-08-13), none introduced
 * here, all worth knowing if this file is touched again:
 *
 * 1. getDefault() is DB-config-driven (ai_provider_config.is_default). It currently resolves
 *    to 'gemini' regardless of whether a working key exists for it — its "prefer an
 *    env-configured provider" fallback only activates when the DB default is specifically
 *    'rule-based'. So adding an env-var key alone does NOT make getDefault() use it while the
 *    DB row points elsewhere. Fixing that DB-level default is a shared change affecting all
 *    of Mira, out of scope here — resolveWorkingProvider() below resolves its own preference
 *    instead, without touching that shared config.
 * 2. ollama.provider.ts, gemini.provider.ts AND openrouter.provider.ts all declare
 *    `supportsJson = true` with NO generateJson implementation at all — calling it throws
 *    "generateJson is not a function" regardless of whether a key is configured. Only
 *    claude.provider.ts genuinely implements it. Verified by grepping every provider file for
 *    an actual `generateJson` method, not trusting the declared flag.
 * 3. Because of #2, this uses generateText — which every provider genuinely implements,
 *    confirmed for both Claude and OpenRouter — with an explicit "respond with only JSON"
 *    instruction, and parses/validates the JSON out of the answer text itself
 *    (extractDiagnosisJson below). Less elegant than a real structured-output API, but it
 *    doesn't depend on an abstraction that's broken for 3 of 4 registered providers.
 *
 * resolveWorkingProvider() tries, in order: the provider matching whichever of
 * ANTHROPIC_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY is actually set, then falls back to
 * getDefault(). Returns null — not a throw — when nothing usable is found, which the caller
 * turns into the same graceful "AI diagnosis unavailable" audit entry as any other
 * unavailability case.
 */
import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { validateQuestion } from './ai-input-guard.js';
import { checkDomainSafety } from './mira-issue-triage-guard.js';
import { aiProviderRegistry } from './ai-provider.registry.js';
import type { AiGenerateRequest, AiProvider } from './ai-provider.types.js';

export const TRIAGE_AUDIT_ACTION = 'mira_ai_triage';

export type TriageOutcome =
  | { status: 'rejected_injection'; reasons: string[] }
  | { status: 'rejected_domain'; reasons: string[] }
  | { status: 'ai_unavailable' }
  | { status: 'diagnosed'; diagnosis: TriageDiagnosis }
  | { status: 'ai_error'; message: string };

export interface TriageDiagnosis {
  actionable: boolean;
  category: 'genuine_bug' | 'feature_request' | 'not_actionable' | 'needs_human_judgment';
  rootCauseHypothesis: string;
  suggestedNextStep: string;
  confidence: 'low' | 'medium' | 'high';
}

const VALID_CATEGORIES = ['genuine_bug', 'feature_request', 'not_actionable', 'needs_human_judgment'] as const;
const VALID_CONFIDENCE = ['low', 'medium', 'high'] as const;

const SYSTEM_INSTRUCTION = `You are a triage assistant for MAS Callnet HRMS bug reports. You read one user
complaint and produce a plain-English diagnosis for a human engineer. You are NOT permitted to:
- write, suggest or reference actual source code, file paths, SQL, or commands
- recommend bypassing any approval, permission, or RBAC check
- recommend a destructive data operation of any kind
- recommend changing payroll/salary calculation logic
- take any action — you only describe a hypothesis and a next step in plain language

If the complaint is not a genuine, actionable software bug (e.g. it's a policy question, a data
dispute, an unclear request, or something requiring business judgment), say so honestly in
"category" and keep "actionable" false. When uncertain, prefer "needs_human_judgment" and low
confidence over guessing.

Respond with ONLY a single JSON object, no markdown fences, no commentary before or after, in
exactly this shape:
{"actionable": true or false, "category": "genuine_bug" | "feature_request" | "not_actionable" | "needs_human_judgment", "rootCauseHypothesis": "plain English, one or two sentences", "suggestedNextStep": "plain English, one or two sentences", "confidence": "low" | "medium" | "high"}`;

/**
 * Extracts and validates the diagnosis JSON out of a free-text model answer. Deliberately
 * strict about shape (every field checked, enums validated against the exact allowed values)
 * since this is the only thing standing between "arbitrary model output" and "what a human
 * reads as a diagnosis" — a malformed or partial object is a parse failure, not a best-effort
 * partial diagnosis.
 */
function extractDiagnosisJson(answer: string): TriageDiagnosis {
  // Models sometimes wrap JSON in ```json fences despite being told not to; strip if present.
  const fenced = answer.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : answer;
  // Grab the first {...} block in case there's leading/trailing prose.
  const braceMatch = candidate.match(/\{[\s\S]*\}/);
  if (!braceMatch) throw new Error('model response did not contain a JSON object');

  const parsed: unknown = JSON.parse(braceMatch[0]);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('parsed JSON is not an object');
  const p = parsed as Record<string, unknown>;

  if (typeof p.actionable !== 'boolean') throw new Error('"actionable" must be a boolean');
  if (!VALID_CATEGORIES.includes(p.category as (typeof VALID_CATEGORIES)[number])) {
    throw new Error(`"category" must be one of ${VALID_CATEGORIES.join(', ')}`);
  }
  if (typeof p.rootCauseHypothesis !== 'string' || !p.rootCauseHypothesis.trim()) {
    throw new Error('"rootCauseHypothesis" must be a non-empty string');
  }
  if (typeof p.suggestedNextStep !== 'string' || !p.suggestedNextStep.trim()) {
    throw new Error('"suggestedNextStep" must be a non-empty string');
  }
  // Models occasionally return values like "medium_high" or "moderate"; normalise before rejecting.
  let confidence = (typeof p.confidence === 'string' ? p.confidence.toLowerCase().trim() : '') as TriageDiagnosis['confidence'];
  if (!VALID_CONFIDENCE.includes(confidence)) {
    // Try prefix-match: "medium_high" → "medium", "very_high" → "high"
    const normalised = VALID_CONFIDENCE.find((v) => confidence.startsWith(v));
    if (normalised) {
      confidence = normalised;
    } else {
      // Unrecognisable — default to 'low' (conservative) so the item still reaches human review.
      confidence = 'low';
    }
  }

  return {
    actionable: p.actionable,
    category: p.category as TriageDiagnosis['category'],
    rootCauseHypothesis: p.rootCauseHypothesis.trim().slice(0, 1000),
    suggestedNextStep: p.suggestedNextStep.trim().slice(0, 1000),
    confidence,
  };
}

async function writeTriageAudit(workItemId: string, remarks: string): Promise<void> {
  await db.execute(
    `INSERT INTO work_item_audit_log (id, work_item_id, action, from_status, to_status, remarks, performed_by, performed_at)
     VALUES (?, ?, ?, 'pending', 'pending', ?, 'system-mira-triage', NOW())`,
    [randomUUID(), workItemId, TRIAGE_AUDIT_ACTION, remarks.slice(0, 4000)],
  );
}

/**
 * generateText is implemented by every registered provider (unlike generateJson — see file
 * header note #2), so the only real "is this usable" question is whether a key exists.
 * key !== 'rule-based' excludes the deterministic fallback, which has no model behind it and
 * would just echo a canned string rather than analyse the complaint.
 */
function isUsable(provider: AiProvider): boolean {
  return provider.key !== 'rule-based';
}

/** See the file header "PROVIDER RESOLUTION" note for why this exists instead of a bare
 * aiProviderRegistry.getDefault() call. Exported so mira-fix-draft-generate.service.ts
 * shares the exact same resolution order rather than duplicating it. */
export async function resolveWorkingProvider(): Promise<AiProvider | null> {
  const envKeyed: Array<[string, string | undefined]> = [
    ['claude', process.env.ANTHROPIC_API_KEY],
    ['openrouter', process.env.OPENROUTER_API_KEY],
    ['gemini', process.env.GEMINI_API_KEY],
  ];
  for (const [key, envKey] of envKeyed) {
    if (!envKey) continue;
    const candidate = aiProviderRegistry.get(key);
    if (candidate && isUsable(candidate)) return candidate;
  }
  const fallback = await aiProviderRegistry.getDefault();
  return isUsable(fallback) ? fallback : null;
}

export async function triageWorkItem(workItemId: string, complaintText: string): Promise<TriageOutcome> {
  const injectionCheck = validateQuestion(complaintText);
  if (!injectionCheck.valid) {
    const outcome: TriageOutcome = { status: 'rejected_injection', reasons: [injectionCheck.reason ?? 'unknown'] };
    await writeTriageAudit(
      workItemId,
      `Not analysed — failed prompt-injection guard: ${injectionCheck.reason}. Needs manual review.`,
    );
    return outcome;
  }

  const domainCheck = checkDomainSafety(complaintText);
  if (!domainCheck.safe) {
    const outcome: TriageOutcome = { status: 'rejected_domain', reasons: domainCheck.reasons };
    await writeTriageAudit(
      workItemId,
      `Not analysed — flagged by domain safety guard (${domainCheck.reasons.join('; ')}). Needs manual review; do not action automatically.`,
    );
    return outcome;
  }

  const provider = await resolveWorkingProvider();
  if (!provider) {
    await writeTriageAudit(
      workItemId,
      `AI diagnosis unavailable — no usable AI provider found (checked ANTHROPIC_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY and the DB-configured default; none has a key configured). Needs manual triage.`,
    );
    return { status: 'ai_unavailable' };
  }

  try {
    const request: AiGenerateRequest = {
      userId: 'system-mira-triage',
      roleKeys: ['system'],
      providerKey: provider.key,
      requestSource: 'mira_issue_triage',
      systemInstruction: SYSTEM_INSTRUCTION,
      userQuestion: complaintText,
      sanitizedContext: {},
      // Verified live 2026-08-13: an auto-routed OpenRouter model can be a reasoning model
      // that spends its token budget on internal "reasoning" content before ever writing the
      // actual answer, returning content:null / finish_reason:"length" on a default 800-token
      // budget. 2000 leaves enough room for reasoning overhead plus a JSON diagnosis.
      maxOutputTokens: 2000,
    };
    const response = await provider.generateText(request);
    if (response.safetyBlocked) {
      throw new Error(`provider declined the request: ${response.answer}`);
    }
    const diagnosis = extractDiagnosisJson(response.answer);

    await writeTriageAudit(
      workItemId,
      `AI-drafted diagnosis (${diagnosis.category}, confidence ${diagnosis.confidence}, actionable=${diagnosis.actionable}): ${diagnosis.rootCauseHypothesis} — Suggested next step: ${diagnosis.suggestedNextStep} — This is an AI-generated hypothesis for human review, not an applied fix.`,
    );
    return { status: 'diagnosed', diagnosis };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeTriageAudit(workItemId, `AI diagnosis failed (${message}). Needs manual triage.`);
    return { status: 'ai_error', message };
  }
}

export async function findUntriagedMiraFeedback(): Promise<Array<{ id: string; description: string }>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT wi.id, wi.description
       FROM work_item wi
      WHERE wi.item_type = 'MIRA_FEEDBACK'
        AND NOT EXISTS (
          SELECT 1 FROM work_item_audit_log al
           WHERE al.work_item_id = wi.id AND al.action = ?
        )
      ORDER BY wi.created_at ASC`,
    [TRIAGE_AUDIT_ACTION],
  );
  return (rows as RowDataPacket[]).map((r) => ({ id: String(r.id), description: String(r.description ?? '') }));
}
