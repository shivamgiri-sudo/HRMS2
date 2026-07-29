/**
 * Short-term conversation memory for Mira.
 *
 * Held in process only, never written to disk. ai_prompt_audit_log deliberately
 * stores a hash of the question rather than its text, and persisting raw turns
 * here would quietly undo that decision. It also means no migration is needed,
 * which matters because production runs with SKIP_MIGRATIONS=true.
 *
 * The important rule is `externalSafe`. Self-account answers — salary, bank,
 * attendance — are produced locally and never reach an external provider. If
 * history were replayed wholesale into the next prompt, a salary answer from
 * turn one would arrive at Gemini on turn two. Turns are therefore recorded for
 * follow-up resolution but only released to a provider when they were eligible
 * to go there in the first place.
 */

export interface ConversationTurn {
  question: string;
  answer: string;
  /** The account intent that served it, when one did. Drives follow-ups. */
  intent?: string;
  /** True only when this turn's content already went to, or could go to, an external provider. */
  externalSafe: boolean;
  at: number;
}

interface Thread {
  turns: ConversationTurn[];
  lastTouched: number;
}

const MAX_TURNS = 6;
const TTL_MS = 30 * 60_000;
const MAX_THREADS = 5_000;
/** Long answers are trimmed before they are replayed; the prompt is not a transcript. */
const MAX_REPLAYED_ANSWER = 400;

const threads = new Map<string, Thread>();

function sweep(now: number): void {
  for (const [userId, thread] of threads) {
    if (now - thread.lastTouched > TTL_MS) threads.delete(userId);
  }
  while (threads.size > MAX_THREADS) {
    const oldest = threads.keys().next().value as string | undefined;
    if (!oldest) break;
    threads.delete(oldest);
  }
}

export function recordTurn(
  userId: string,
  turn: Omit<ConversationTurn, 'at'>,
): void {
  if (!userId || !turn.question.trim()) return;
  const now = Date.now();
  sweep(now);

  const thread = threads.get(userId) ?? { turns: [], lastTouched: now };
  thread.turns.push({ ...turn, at: now });
  if (thread.turns.length > MAX_TURNS) thread.turns = thread.turns.slice(-MAX_TURNS);
  thread.lastTouched = now;

  // Re-insert so iteration order stays least-recently-used first.
  threads.delete(userId);
  threads.set(userId, thread);
}

/** Every remembered turn, freshest last. Used in-process only. */
export function getThread(userId: string): ConversationTurn[] {
  const thread = threads.get(userId);
  if (!thread) return [];
  if (Date.now() - thread.lastTouched > TTL_MS) {
    threads.delete(userId);
    return [];
  }
  return thread.turns;
}

/** The most recent turn served by a named account intent, if any is still fresh. */
export function lastIntentTurn(userId: string): ConversationTurn | null {
  const turns = getThread(userId);
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].intent && turns[i].intent !== 'unknown') return turns[i];
  }
  return null;
}

export function clearConversation(userId?: string): void {
  if (!userId) {
    threads.clear();
    return;
  }
  threads.delete(userId);
}

/** Test seam. */
export function conversationThreadCount(): number {
  return threads.size;
}

/**
 * The slice of history that may be sent to an external provider: turns that were
 * themselves external-safe, trimmed and oldest-first.
 */
export function providerHistory(userId: string): Array<{ question: string; answer: string }> {
  return getThread(userId)
    .filter((turn) => turn.externalSafe)
    .map((turn) => ({
      question: turn.question,
      answer: turn.answer.length > MAX_REPLAYED_ANSWER
        ? `${turn.answer.slice(0, MAX_REPLAYED_ANSWER)}…`
        : turn.answer,
    }));
}

/**
 * A message that only makes sense against the previous one — "and last month?",
 * "what about June", "the same for tomorrow". Deliberately narrow: a question
 * that stands on its own must not be rewritten.
 */
const FOLLOW_UP_PATTERNS = [
  /^(?:and|what about|how about|ok(?:ay)? and|then)\b/i,
  /^(?:same|the same)\b/i,
  /^(?:what|how) about\b/i,
  /^(?:aur|aur batao|uska|uske)\b/i,
];

const STANDALONE_HINTS = /\b(salary|payslip|attendance|leave|roster|shift|document|loan|reimbursement|coach|performance)\b/i;

export function isFollowUp(question: string): boolean {
  const text = String(question ?? '').trim();
  if (!text || text.length > 80) return false;
  // If it names its own subject it can be answered on its own terms.
  if (STANDALONE_HINTS.test(text)) return false;
  return FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Rewrite a bare follow-up into a question the intent router can serve, by
 * carrying the previous turn's subject across. "and last month?" after an
 * attendance question becomes "attendance last month".
 */
export function resolveFollowUp(question: string, previous: ConversationTurn | null): string | null {
  if (!previous?.intent || !isFollowUp(question)) return null;

  const trimmed = String(question).trim()
    .replace(/^(?:ok(?:ay)?\s+)?(?:and|then|what about|how about|same|the same|aur batao|aur|uska|uske)\b/i, '')
    .replace(/^\s*(?:for|about|in|of)\b/i, '')
    .replace(/[?.!]+$/, '')
    .trim();

  if (!trimmed) return null;
  return `${previous.intent.replace(/_/g, ' ')} ${trimmed}`;
}
