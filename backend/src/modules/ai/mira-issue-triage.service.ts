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
 * GRACEFUL DEGRADATION WHEN NO AI PROVIDER IS CONFIGURED
 *
 * Verified live 2026-08-13: no ANTHROPIC_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY is set
 * in production, so aiProviderRegistry.getDefault() resolves to ruleBasedProvider, which does
 * not implement generateJson. Rather than throw, that case is detected up front
 * (provider.supportsJson) and produces an explicit "AI diagnosis unavailable — configure a
 * provider" audit entry, so a human triaging the item sees why there is no AI analysis instead
 * of the worker silently failing or crash-looping.
 */
import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { validateQuestion } from './ai-input-guard.js';
import { checkDomainSafety } from './mira-issue-triage-guard.js';
import { aiProviderRegistry } from './ai-provider.registry.js';
import type { AiGenerateRequest } from './ai-provider.types.js';

// jsonSchema is not a declared field on AiGenerateRequest — providers that implement
// generateJson (claude.provider.ts, gemini.provider.ts) read it via an inline cast on their
// end, same pattern used here rather than widening the shared type for one optional field.
type JsonGenerateRequest = AiGenerateRequest & { jsonSchema: Record<string, unknown> };

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

const DIAGNOSIS_SCHEMA = {
  type: 'object',
  properties: {
    actionable: { type: 'boolean' },
    category: {
      type: 'string',
      enum: ['genuine_bug', 'feature_request', 'not_actionable', 'needs_human_judgment'],
    },
    rootCauseHypothesis: { type: 'string' },
    suggestedNextStep: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['actionable', 'category', 'rootCauseHypothesis', 'suggestedNextStep', 'confidence'],
};

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
confidence over guessing.`;

async function writeTriageAudit(workItemId: string, remarks: string): Promise<void> {
  await db.execute(
    `INSERT INTO work_item_audit_log (id, work_item_id, action, from_status, to_status, remarks, performed_by, performed_at)
     VALUES (?, ?, ?, 'pending', 'pending', ?, 'system-mira-triage', NOW())`,
    [randomUUID(), workItemId, TRIAGE_AUDIT_ACTION, remarks.slice(0, 4000)],
  );
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

  const provider = await aiProviderRegistry.getDefault();
  // Checking supportsJson alone is not enough — verified live 2026-08-13 that
  // ollama.provider.ts declares supportsJson = true with no generateJson implementation at
  // all, so a DB config defaulting to 'ollama' resolves a provider whose own capability flag
  // says yes and then throws "generateJson is not a function" when actually called. Checking
  // the method exists is the only way this degrades gracefully instead of surfacing as an
  // ai_error on every single run.
  if (!provider.supportsJson || typeof provider.generateJson !== 'function') {
    await writeTriageAudit(
      workItemId,
      `AI diagnosis unavailable — the configured provider ('${provider.key}') does not actually support structured generation. Needs manual triage. Configure ANTHROPIC_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY (or fix the default-provider config) to enable automatic diagnosis.`,
    );
    return { status: 'ai_unavailable' };
  }

  try {
    const request: JsonGenerateRequest = {
      userId: 'system-mira-triage',
      roleKeys: ['system'],
      providerKey: provider.key,
      requestSource: 'mira_issue_triage',
      systemInstruction: SYSTEM_INSTRUCTION,
      userQuestion: complaintText,
      sanitizedContext: {},
      jsonSchema: DIAGNOSIS_SCHEMA,
    };
    const diagnosis = await provider.generateJson!<TriageDiagnosis>(request);

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
