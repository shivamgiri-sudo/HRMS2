/**
 * "How do I…" navigation guidance for Mira.
 *
 * Root cause this fixes: no HRMS how-to/procedural knowledge source existed
 * anywhere. detectMiraIntent() (ai-account.service.ts) and detectCompanyIntent()/
 * detectIntent() only classify data-lookup intents (salary/leave-balance/
 * attendance) and company-brand topics (leadership/offices/careers) — a
 * question like "how do I apply for leave" matched neither, fell through to
 * the external LLM, whose only injectable context is a handful of
 * company-brand facts (getPublicCompanyContext), and whose system prompt
 * explicitly forbids using general knowledge beyond that context. The model
 * was architecturally forced into a canned refusal or a vague hedge — not a
 * bug in the model, a missing knowledge source.
 *
 * Kept separate from ai-account.service.ts on purpose: that file is
 * self-account *data* only (an authenticated user's own salary/leave/
 * attendance/etc figures). A how-to answer is static guidance plus a route —
 * it isn't a data lookup, and folding it into detectMiraIntent()'s pattern
 * list would risk a how-to question being swallowed by an existing
 * data-lookup intent (e.g. "leave" matching before this ever runs) or vice
 * versa.
 */
import { expandRoles, normalizeRoleInputs } from '../../platform/policy/index.js';
import { getAccessMe } from '../access/access.service.js';
import type { AiAction, AiGenerateResponse } from './ai-provider.types.js';
import { HOWTO_CATALOG, type HowToEntry } from './ai-howto-catalog.js';

export interface HowToAnswerResult {
  handled: boolean;
  intent: string;
  response?: AiGenerateResponse;
}

// Broad "how do I…" gate, tried before matching each entry's own aliases —
// keeps this from firing on every message, only ones that look like a
// how-to question at all. Real users bury the how-to phrasing mid-sentence
// far more often than they lead with it ("I don't know how to approve
// leave...", "...the path from where I can approve..."), so this is
// deliberately NOT anchored to the start of the message (previously
// `^\s*(...)`, which made both of those real phrasings fall straight
// through to the external LLM's canned refusal, even though the
// leave_approve catalog entry below already existed and its own aliases
// matched fine — the gate in front of it was the only thing wrong).
// Precision still comes from each entry's own aliases (matchesEntry), not
// from this gate, so casting it wider here is safe: a broad match with no
// catalog entry match just falls through exactly as before.
const HOWTO_TRIGGERS: RegExp[] = [
  /\bhow\s+to\b/i,
  /\bhow\s+(do|can|would|should)\s+i\b/i,
  /\bhow\s+i\s+(?:can|do|would|should)\b/i,
  /\bwhere\s+(do|can|is|are)\s+i\b/i,
  /\bwhere\s+i\s+can\b/i,
  /\bwhere\s+(is|are)\b/i,               // "where is the roster page" / "where are the reports"
  /\bwhere\s+to\b/i,                      // "where to see/find/go"
  /\b(the\s+)?path\s+(to|for|from)\b/i,
  /\bwhich\s+(page|screen|tab|menu)\b/i,
  /\btell\s+me\s+(where|how)\b/i,         // "tell me where to see"
  /\bshow\s+me\b/i,                        // "show me statutory status"
  /\bhow\s+many\b/i,                       // "how many leave days"
  /\bI\s+(want|need)\s+to\b/i,            // "I want to resign / I need to upload"
  /\b(don'?t|doesn'?t|do\s+not|does\s+not)\s+know\s+(how|where)\s+to\b/i,
  /\b(don'?t|doesn'?t|do\s+not|does\s+not)\s+know\s+the\s+(path|way)\b/i,
  /\bnot\s+sure\s+how\s+to\b/i,
  /\bno\s+idea\s+how\s+to\b/i,
];

function looksLikeHowToQuestion(question: string): boolean {
  return HOWTO_TRIGGERS.some((pattern) => pattern.test(question));
}

function matchesEntry(question: string, entry: HowToEntry): boolean {
  return entry.aliases.some((pattern) => pattern.test(question));
}

async function isAllowed(entry: HowToEntry, userId: string, roleKeys: string[]): Promise<boolean> {
  const callerRoles = normalizeRoleInputs(roleKeys);
  // requireRole.ts grants super_admin unconditional access via a separate,
  // explicit check BEFORE its expand/intersect logic (not something
  // expandRoles() itself produces) — mirror that exactly, or a super_admin
  // caller would be wrongly denied on any entry whose roles list doesn't
  // happen to spell out "super_admin" (e.g. leave_approve's
  // ['admin','hr','manager']).
  if (callerRoles.includes('super_admin')) return true;

  if (entry.auth.mode === 'static_roles') {
    if (entry.auth.roles.length === 0) return true; // open to any authenticated employee
    // Same normalize-then-expand requireRole.ts itself uses, so this
    // catalog's opinion of "can this role do this" cannot drift from the
    // actual middleware's behavior (backend/src/middleware/requireRole.ts).
    const allowedExpanded = new Set(expandRoles(normalizeRoleInputs(entry.auth.roles)));
    const callerExpanded = expandRoles(callerRoles);
    return callerExpanded.some((role) => allowedExpanded.has(role));
  }
  // page_code mode: check the caller's live, per-user grant (includes DB-level
  // overrides the static rbacPageMatrix.ts alone would miss) — the same call
  // /api/access/pages/my-catalog and ModuleLauncher.tsx already trust.
  const access = await getAccessMe(userId);
  const pageCode = entry.auth.pageCode;
  return access.pages.some((page) => page.page_code === pageCode && page.can_view);
}

function response(answer: string, actions: AiAction[], startedAt: number): AiGenerateResponse {
  return {
    answer,
    provider: 'mira-secure-local',
    model: 'hrms-howto-v1',
    latencyMs: Math.max(1, Date.now() - startedAt),
    safetyBlocked: false,
    fallbackUsed: false,
    generatedAt: new Date().toISOString(),
    sourceContexts: ['howto_catalog'],
    dataConfidence: { overall: 1 },
    actions,
  };
}

export async function answerHowToQuestion(
  question: string,
  userId: string,
  roleKeys: string[],
): Promise<HowToAnswerResult> {
  const startedAt = Date.now();
  if (!looksLikeHowToQuestion(question)) return { handled: false, intent: 'unknown' };

  const entry = HOWTO_CATALOG.find((candidate) => candidate.status === 'verified' && matchesEntry(question, candidate));
  if (!entry) return { handled: false, intent: 'unknown' };

  const allowed = await isAllowed(entry, userId, roleKeys);
  if (!allowed) {
    return {
      handled: true,
      intent: `howto:${entry.code}`,
      response: response(entry.deniedExplanation, [], startedAt),
    };
  }

  const action: AiAction = { key: entry.code, label: `Open ${entry.title}`, url: entry.route, priority: 'low' };
  return {
    handled: true,
    intent: `howto:${entry.code}`,
    response: response(`Here's how to ${entry.title.toLowerCase()}:\n\n${entry.steps.join('\n')}`, [action], startedAt),
  };
}
