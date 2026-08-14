/**
 * Phase 2 of the Mira fix-draft pipeline: turns an already-triaged, already-approved-shape
 * diagnosis (mira-issue-triage.service.ts, category='genuine_bug', actionable=true) into an
 * actual candidate diff, recorded via createFixDraft() (mira-fix-draft.service.ts), which
 * runs it through the server-side deny-list (mira-fix-draft-guard.ts) before it is ever
 * shown as approvable.
 *
 * WHAT THIS DOES NOT DO — same discipline as the triage service before it
 *
 *   - Never applies a diff, touches git, or deploys anything. Writing to mira_fix_draft is
 *     the only side effect. There is still no route and no UI reading this table — that is
 *     the next increment, not this one.
 *   - Never runs for anything except category='genuine_bug' AND actionable=true. Every other
 *     diagnosis outcome (feature_request, not_actionable, needs_human_judgment, or no
 *     diagnosis at all) is refused before any AI call is made — see 'not_eligible' below.
 *   - The model is told, explicitly, that it may decline (NO_SAFE_DIFF) rather than guess.
 *     A refusal is a valid, expected outcome, not a failure to work around.
 *
 * WHY THIS PARSES THE DIAGNOSIS BACK OUT OF work_item_audit_log.remarks
 *
 * triageWorkItem() (mira-issue-triage.service.ts) never persisted the diagnosis as
 * structured data — only as a formatted audit-log sentence, since at the time nothing
 * downstream needed to read it back programmatically. Adding a new column/table just to
 * carry three fields through would be a schema change touching a second module for a need
 * this file alone has; parsing the one sentence that already has to exist keeps the
 * blast radius here. DIAGNOSIS_REMARK_RE is pinned by a regression test against the exact
 * string writeTriageAudit() builds — if that format ever changes, the test catches it rather
 * than this silently seeing every diagnosis as "no_diagnosis".
 */
import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { TRIAGE_AUDIT_ACTION, resolveWorkingProvider } from './mira-issue-triage.service.js';
import { buildContextBundle } from './mira-fix-draft-context.js';
import { createFixDraft, type FixDraft } from './mira-fix-draft.service.js';
import type { AiGenerateRequest } from './ai-provider.types.js';

export type FixDraftGenerationOutcome =
  | { status: 'no_diagnosis' }
  | { status: 'not_eligible'; reason: string }
  | { status: 'ai_unavailable' }
  | { status: 'model_declined'; reason: string }
  | { status: 'ai_error'; message: string }
  | { status: 'drafted'; draft: FixDraft };

interface ParsedDiagnosis {
  category: string;
  confidence: string;
  actionable: boolean;
  rootCauseHypothesis: string;
  suggestedNextStep: string;
}

// Pinned to the exact sentence writeTriageAudit() (mira-issue-triage.service.ts) builds.
// See __tests__/mira-fix-draft-generate.test.ts for the regression test against that format.
const DIAGNOSIS_REMARK_RE =
  /^AI-drafted diagnosis \(([a-z_]+), confidence (low|medium|high), actionable=(true|false)\): ([\s\S]+?) — Suggested next step: ([\s\S]+?) — This is an AI-generated hypothesis/;

export function parseDiagnosisRemark(remarks: string): ParsedDiagnosis | null {
  const m = remarks.match(DIAGNOSIS_REMARK_RE);
  if (!m) return null;
  return {
    category: m[1],
    confidence: m[2],
    actionable: m[3] === 'true',
    rootCauseHypothesis: m[4],
    suggestedNextStep: m[5],
  };
}

async function loadLatestDiagnosis(workItemId: string): Promise<ParsedDiagnosis | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT remarks FROM work_item_audit_log
      WHERE work_item_id = ? AND action = ?
      ORDER BY performed_at DESC LIMIT 1`,
    [workItemId, TRIAGE_AUDIT_ACTION],
  );
  const remarks = (rows as RowDataPacket[])[0]?.remarks;
  if (!remarks) return null;
  return parseDiagnosisRemark(String(remarks));
}

export const FIX_DRAFT_AUDIT_ACTION = 'mira_fix_draft_attempt';

async function writeFixDraftAudit(workItemId: string, remarks: string): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO work_item_audit_log (id, work_item_id, action, from_status, to_status, remarks, performed_by, performed_at)
       VALUES (?, ?, ?, 'pending', 'pending', ?, 'system-mira-fix-draft', NOW())`,
      [randomUUID(), workItemId, FIX_DRAFT_AUDIT_ACTION, remarks.slice(0, 4000)],
    );
  } catch (err) {
    console.error('[mira-fix-draft] failed to write audit log:', err instanceof Error ? err.message : String(err));
  }
}

const NO_SAFE_DIFF_RE = /^NO_SAFE_DIFF:\s*(.+)$/im;

/** Strips markdown fences if the model added them despite being told not to (same defensive
 * pattern as extractDiagnosisJson in the triage service) and detects an explicit refusal. */
function extractDiffOrRefusal(answer: string): { kind: 'diff'; diffText: string } | { kind: 'declined'; reason: string } {
  const trimmed = answer.trim();
  const declineMatch = trimmed.match(NO_SAFE_DIFF_RE);
  if (declineMatch) return { kind: 'declined', reason: declineMatch[1].trim().slice(0, 500) };

  const fenced = trimmed.match(/```(?:diff|patch)?\s*([\s\S]*?)```/);
  return { kind: 'diff', diffText: (fenced ? fenced[1] : trimmed).trim() };
}

const SYSTEM_INSTRUCTION = `You are a senior engineer proposing a MINIMAL fix for a described software bug in the MAS
Callnet HRMS codebase. You are given a bug report, a prior diagnosis, and the content of
files that appear relevant.

Output ONLY a unified diff (git diff format: "diff --git a/path b/path" headers, "---"/"+++"
markers, "@@" hunks) — no markdown fences, no commentary before or after.

You are NOT permitted to propose any change to:
- payroll or salary calculation logic
- authentication, RBAC, or access-control middleware
- encryption or secret-handling code, or any .env / credential file
- database migrations (backend/sql/**)
- CI/CD or deploy configuration (.github/workflows/**)
- this fix-draft pipeline's own code (any file with "mira-fix-draft" in its name)

If you cannot propose a safe, minimal diff — because the fix genuinely requires touching one
of the above, because the provided file context is insufficient, or because you are not
confident the change is correct — output exactly one line: NO_SAFE_DIFF: <one sentence
reason>. Do not guess, and do not fabricate a file path you were not shown.

Keep the diff as small as possible: touch only the files and lines necessary.`;

export async function generateFixDraftForWorkItem(workItemId: string): Promise<FixDraftGenerationOutcome> {
  const diagnosis = await loadLatestDiagnosis(workItemId);
  if (!diagnosis) {
    await writeFixDraftAudit(workItemId, 'Fix-draft not attempted — no triage diagnosis found for this item. Run triage first.');
    return { status: 'no_diagnosis' };
  }
  if (!diagnosis.actionable || diagnosis.category !== 'genuine_bug') {
    const reason = `category=${diagnosis.category}, actionable=${diagnosis.actionable}`;
    await writeFixDraftAudit(workItemId, `Fix-draft not attempted — diagnosis not eligible (${reason}). Only genuine_bug + actionable=true items reach the fix-draft stage.`);
    return { status: 'not_eligible', reason };
  }

  const [wiRows] = await db.execute<RowDataPacket[]>(
    `SELECT description FROM work_item WHERE id = ? LIMIT 1`,
    [workItemId],
  );
  const complaintText = String((wiRows as RowDataPacket[])[0]?.description ?? '');

  const contextFiles = buildContextBundle(
    complaintText,
    `${diagnosis.rootCauseHypothesis} ${diagnosis.suggestedNextStep}`,
  );
  const contextBlock = contextFiles.length
    ? contextFiles.map((f) => `--- FILE: ${f.path} ---\n${f.content}`).join('\n\n')
    : '(no relevant source files were found by keyword search)';

  const provider = await resolveWorkingProvider();
  if (!provider) {
    await writeFixDraftAudit(workItemId, 'Fix-draft not attempted — no usable AI provider found (checked ANTHROPIC_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY and DB default). Configure a provider key to enable fix-draft generation.');
    return { status: 'ai_unavailable' };
  }

  const userPrompt = `Bug report: ${complaintText}

Prior diagnosis: ${diagnosis.rootCauseHypothesis}
Suggested next step: ${diagnosis.suggestedNextStep}

Relevant source files:
${contextBlock}`;

  try {
    const request: AiGenerateRequest = {
      userId: 'system-mira-fix-draft',
      roleKeys: ['system'],
      providerKey: provider.key,
      requestSource: 'mira_fix_draft_generate',
      systemInstruction: SYSTEM_INSTRUCTION,
      userQuestion: userPrompt,
      sanitizedContext: {},
      maxOutputTokens: 4000,
    };
    const response = await provider.generateText(request);
    if (response.safetyBlocked) {
      throw new Error(`provider declined the request: ${response.answer}`);
    }

    const parsed = extractDiffOrRefusal(response.answer);
    if (parsed.kind === 'declined') {
      await writeFixDraftAudit(workItemId, `Fix-draft declined by model: ${parsed.reason}`);
      return { status: 'model_declined', reason: parsed.reason };
    }

    const draft = await createFixDraft({ workItemId, diffText: parsed.diffText, model: provider.key });
    return { status: 'drafted', draft };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFixDraftAudit(workItemId, `Fix-draft generation error: ${message}`);
    return { status: 'ai_error', message };
  }
}
