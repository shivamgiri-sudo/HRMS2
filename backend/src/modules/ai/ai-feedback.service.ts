/**
 * Mira feedback/complaint logging — lets an employee tell Mira about a
 * problem, suggestion or complaint concerning the HRMS system/Mira itself,
 * and have it land in front of the admin team without building a new
 * table or a new UI surface.
 *
 * Deliberately reuses work_item (backend/sql/290_dashboard_analytics_engine.sql),
 * the same table pendingActions() (ai-account.service.ts) already reads from
 * and the real "Work Inbox" page already renders — a row here with
 * assigned_to_role='super_admin' shows up there automatically, for both a
 * human browsing the page and a super_admin asking Mira "what's pending for
 * me". No migration, no new admin page needed for this to actually reach
 * someone.
 */
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import type { AiAction, AiGenerateResponse } from './ai-provider.types.js';
import { triageWorkItem } from './mira-issue-triage.service.js';

export type FeedbackCategory = 'bug' | 'suggestion' | 'feedback' | 'complaint';

export interface FeedbackDetectionResult {
  isFeedback: boolean;
  category: FeedbackCategory;
}

// Requires the message to name the system itself (HRMS/Mira/the app/the
// portal/this platform) — NOT bare "bug"/"complaint" alone. Self-account's
// own support intent (ai-account.service.ts's /\bcomplaints?\b/i, /\bgrievances?\b/i)
// already owns bare complaint/grievance wording for an employee's own
// existing HR tickets, and that behavior is correct and must not change.
// This only fires for feedback ABOUT the HRMS software/Mira itself, kept
// deliberately narrow so it never intercepts a genuine HR grievance
// question or a self-account data lookup.
const SYSTEM_NAME = /\b(hrms|mira|meera|mera|the app|the portal|this (?:app|portal|platform|system)|peopleos)\b/i;
const BUG_WORDS = /\b(bugs?|glitche?s?|broken|isn'?t working|not working|error|crash(?:es|ed|ing)?)\b/i;
const SUGGESTION_WORDS = /\b(suggest(?:ion)?s?|feature request|improve(?:ment)?s?|enhance(?:ment)?s?)\b/i;
const FEEDBACK_WORDS = /\bfeedback\b/i;
const COMPLAINT_WORDS = /\bcomplain(?:t|ing)?s?\b/i;

// "I want to give feedback", "can I file a complaint", "let me share a
// suggestion" — an explicit ask to submit something, regardless of whether
// the system is named in the same breath.
const EXPLICIT_SUBMIT_PHRASE = /\b(?:give|share|submit|log|file|leave|send|raise)\s+(?:a\s+|some\s+|my\s+)?(feedback|suggestion|complaint)s?\b/i;

export function detectFeedbackIntent(question: string): FeedbackDetectionResult {
  const text = String(question ?? '');
  const explicit = EXPLICIT_SUBMIT_PHRASE.exec(text);
  if (explicit) {
    const word = explicit[1].toLowerCase();
    return { isFeedback: true, category: word === 'complaint' ? 'complaint' : word === 'suggestion' ? 'suggestion' : 'feedback' };
  }
  if (SYSTEM_NAME.test(text)) {
    if (BUG_WORDS.test(text)) return { isFeedback: true, category: 'bug' };
    if (SUGGESTION_WORDS.test(text)) return { isFeedback: true, category: 'suggestion' };
    if (COMPLAINT_WORDS.test(text)) return { isFeedback: true, category: 'complaint' };
    if (FEEDBACK_WORDS.test(text)) return { isFeedback: true, category: 'feedback' };
  }
  return { isFeedback: false, category: 'feedback' };
}

function categoryLabel(category: FeedbackCategory): string {
  switch (category) {
    case 'bug': return 'Bug report';
    case 'suggestion': return 'Suggestion';
    case 'complaint': return 'Complaint';
    default: return 'Feedback';
  }
}

function categoryPriority(category: FeedbackCategory): 'high' | 'medium' {
  return category === 'bug' || category === 'complaint' ? 'high' : 'medium';
}

/**
 * Topic-only, redacted sentence for the shared conversation history —
 * mirrors describeAccountIntentForHistory (ai-account.service.ts). A raw
 * complaint can plausibly name a coworker or manager ("my manager X is
 * unfair") — that must never be replayed to an external provider on a
 * follow-up turn, same rationale as self-account answers.
 */
export function describeFeedbackForHistory(category: FeedbackCategory): string {
  return `The user previously submitted ${categoryLabel(category).toLowerCase()} about Mira/HRMS, logged for the admin team; the details were not shared with any external provider.`;
}

export async function logFeedback(userId: string, question: string, category: FeedbackCategory): Promise<AiGenerateResponse> {
  const startedAt = Date.now();
  const label = categoryLabel(category);
  const trimmed = question.trim();
  const title = `Mira ${label.toLowerCase()}: ${trimmed.slice(0, 90)}${trimmed.length > 90 ? '…' : ''}`;

  // entity_id self-references this row's own id (same pattern getTimeline() already uses for
  // 'incentive'/'incentive_batch' — see inbox.service.ts). Generated client-side rather than
  // via inline UUID() specifically so it can be reused as entity_id: previously entity_id was
  // never set at all, so the Work Inbox timeline panel — which looks up
  // /api/inbox/timeline/:entity_type/:entity_id — had no id to query with and a Mira
  // complaint's AI-drafted diagnosis (mira-issue-triage.service.ts, written to
  // work_item_audit_log) was unreachable from the UI no matter how it was written. Found
  // 2026-08-13 from a live report: a real complaint was submitted, triaged, and the diagnosis
  // existed in the database, but there was no click-path in Work Inbox to ever see it.
  const workItemId = randomUUID();
  try {
    await db.execute(
      `INSERT INTO work_item (id, item_type, title, description, module_code, entity_type, entity_id, assigned_to_role, priority, status, created_by, created_at)
       VALUES (?, 'MIRA_FEEDBACK', ?, ?, 'mira', 'mira_feedback', ?, 'super_admin', ?, 'pending', ?, NOW())`,
      [workItemId, title, trimmed.slice(0, 4000), workItemId, categoryPriority(category), userId],
    );
  } catch (error) {
    console.error('[Mira Feedback] Failed to log feedback', error instanceof Error ? error.message : error);
    return {
      answer: `I couldn't save that ${label.toLowerCase()} right now due to a temporary issue on my side — please try again in a moment, or reach HR/IT support directly.`,
      provider: 'mira-secure-local',
      model: 'hrms-feedback-v1',
      latencyMs: Math.max(1, Date.now() - startedAt),
      safetyBlocked: false,
      fallbackUsed: false,
      generatedAt: new Date().toISOString(),
      sourceContexts: ['mira_feedback:write_failed'],
      dataConfidence: { overall: 0.3 },
    };
  }

  // Fire triage immediately so the diagnosis is available in seconds, not after the 15-min
  // scheduler cycle. Non-blocking: a triage failure never breaks the user's submit flow.
  setImmediate(() => {
    triageWorkItem(workItemId, trimmed.slice(0, 4000)).catch((err) =>
      console.error('[Mira Feedback] immediate triage failed:', err instanceof Error ? err.message : String(err)),
    );
  });

  const actions: AiAction[] = [{ key: 'mira-feedback-logged', label: 'Open work inbox', url: '/work-inbox', priority: 'low' }];
  return {
    answer: `Thanks — I've logged this as ${label.toLowerCase()} and shared it with the HRMS admin team for review. They'll see it in their work inbox.`,
    provider: 'mira-secure-local',
    model: 'hrms-feedback-v1',
    latencyMs: Math.max(1, Date.now() - startedAt),
    safetyBlocked: false,
    fallbackUsed: false,
    generatedAt: new Date().toISOString(),
    sourceContexts: ['mira_feedback:logged'],
    dataConfidence: { overall: 1 },
    actions,
  };
}
