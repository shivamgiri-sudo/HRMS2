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
import { detectLanguage, type DetectedLang } from './mira-language-detect.js';

export interface ConversationTurn {
  question: string;
  answer: string;
  /** The account intent that served it, when one did. Drives follow-ups. */
  intent?: string;
  /** True only when this turn's content already went to, or could go to, an external provider. */
  externalSafe: boolean;
  /**
   * A topic-only, redacted sentence safe to replay to an external provider even
   * when externalSafe is false — e.g. "The user previously asked about their
   * attendance; Mira answered from live HRMS data without exposing values in
   * this shared history." Built from `intent` at the recording call site
   * (see describeAccountIntentForHistory in ai-account.service.ts), never by
   * scrubbing `answer` text — that would risk a value slipping through.
   */
  redactedSummary?: string;
  at: number;
}

/**
 * A drafted-but-unconfirmed write action, held server-side only. The frontend never
 * sends this back verbatim on confirm — it sends the user's yes/no, and the confirm
 * route reads the actual payload from here. That's deliberate: a client-supplied
 * action payload on the confirm call would let a tampered request submit something
 * the user never actually saw drafted.
 */
export interface PendingLeaveAction {
  type: 'leave_request';
  payload: {
    employeeId: string;
    leaveTypeId: string;
    leaveTypeName: string;
    fromDate: string;
    toDate: string;
    totalDays: number;
    reason: string | null;
  };
  createdAt: number;
}

interface Thread {
  turns: ConversationTurn[];
  lastTouched: number;
  pendingAction?: PendingLeaveAction;
  /** The language Mira is currently answering this thread in. Unset means English. */
  preferredLanguage?: DetectedLang;
  /**
   * A different language seen while `preferredLanguage` is already set, held as a
   * candidate until it repeats. Kept separate from the active language so a
   * one-off word in another script cannot switch the session on its own.
   */
  pendingLanguage?: DetectedLang;
  /** Consecutive turns seen in `pendingLanguage`. */
  consecutiveForeignCount: number;
  /** Consecutive turns with no detectable non-Latin script, once a language is active. */
  consecutiveEnglishCount: number;
}

/**
 * Turns in a new language before Mira switches to it. Two, not one, because a
 * single message is too weak a signal — people quote a word, paste a name, or
 * type one line in their own language inside an otherwise English conversation.
 */
const LANGUAGE_SWITCH_TURNS = 2;
/**
 * Consecutive English turns before Mira drops back to English. Three, i.e.
 * slower to leave a language than to enter one: a user who has been writing in
 * Hindi and sends one short "ok thanks" has not changed language, and flipping
 * on that would be more jarring than staying put for another turn.
 */
const ENGLISH_REVERT_TURNS = 3;

const MAX_TURNS = 6;
const TTL_MS = 30 * 60_000;
const MAX_THREADS = 5_000;
/** A drafted action goes stale much faster than ordinary chat memory — the user
 * either confirms in the next couple of turns or the draft no longer reflects
 * what they'd want (dates, balance, an in-between edit to the leave form itself). */
const PENDING_ACTION_TTL_MS = 10 * 60_000;
/** Long answers are trimmed before they are replayed; the prompt is not a transcript. */
const MAX_REPLAYED_ANSWER = 400;

const threads = new Map<string, Thread>();

/**
 * One factory for both creation sites (recordTurn and setPendingAction) so the
 * language counters cannot be initialised in one path and left undefined in the
 * other.
 */
function newThread(now: number): Thread {
  return {
    turns: [],
    lastTouched: now,
    consecutiveForeignCount: 0,
    consecutiveEnglishCount: 0,
  };
}

/**
 * Folds this turn's detected script into the thread's language state.
 *
 * Asymmetric on purpose: the first detected language is adopted at once (a user
 * who opens in Telugu should be answered in Telugu immediately), a *change* of
 * language needs LANGUAGE_SWITCH_TURNS to confirm, and returning to English
 * needs ENGLISH_REVERT_TURNS. Entering is cheap, leaving is not.
 */
function applyLanguageSignal(thread: Thread, question: string): void {
  const detected = detectLanguage(question);

  if (!detected) {
    // No script signal. Any half-formed candidate dies here — a candidate only
    // counts while it is consecutive.
    thread.pendingLanguage = undefined;
    thread.consecutiveForeignCount = 0;
    if (!thread.preferredLanguage) return;
    thread.consecutiveEnglishCount += 1;
    if (thread.consecutiveEnglishCount >= ENGLISH_REVERT_TURNS) {
      thread.preferredLanguage = undefined;
      thread.consecutiveEnglishCount = 0;
    }
    return;
  }

  thread.consecutiveEnglishCount = 0;

  if (!thread.preferredLanguage || thread.preferredLanguage.code === detected.code) {
    // First detection, or more of the same language: adopt/reaffirm outright.
    thread.preferredLanguage = detected;
    thread.pendingLanguage = undefined;
    thread.consecutiveForeignCount = 0;
    return;
  }

  // A different language while one is already active.
  if (thread.pendingLanguage?.code === detected.code) {
    thread.consecutiveForeignCount += 1;
  } else {
    thread.pendingLanguage = detected;
    thread.consecutiveForeignCount = 1;
  }

  if (thread.consecutiveForeignCount >= LANGUAGE_SWITCH_TURNS) {
    thread.preferredLanguage = detected;
    thread.pendingLanguage = undefined;
    thread.consecutiveForeignCount = 0;
  }
}

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

  const thread = threads.get(userId) ?? newThread(now);
  thread.turns.push({ ...turn, at: now });
  if (thread.turns.length > MAX_TURNS) thread.turns = thread.turns.slice(-MAX_TURNS);
  // Read the language off the question, not the answer: the answer's script is
  // whatever the model chose to reply in, which is the thing being decided here.
  applyLanguageSignal(thread, turn.question);
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

/**
 * The language Mira should answer this user in, or null for English.
 *
 * Honours the same TTL as the rest of the thread: a user returning after the
 * window starts again in English rather than inheriting a language choice made
 * half an hour ago.
 */
export function getPreferredLanguage(userId: string): DetectedLang | null {
  const thread = threads.get(userId);
  if (!thread) return null;
  if (Date.now() - thread.lastTouched > TTL_MS) return null;
  return thread.preferredLanguage ?? null;
}

/** Stash a drafted action for this user, replacing any earlier undrafted one. */
export function setPendingAction(userId: string, action: PendingLeaveAction): void {
  if (!userId) return;
  const now = Date.now();
  sweep(now);
  const thread = threads.get(userId) ?? newThread(now);
  thread.pendingAction = action;
  thread.lastTouched = now;
  threads.delete(userId);
  threads.set(userId, thread);
}

/** The user's pending action, if one exists and hasn't gone stale. */
export function getPendingAction(userId: string): PendingLeaveAction | null {
  const thread = threads.get(userId);
  if (!thread?.pendingAction) return null;
  if (Date.now() - thread.pendingAction.createdAt > PENDING_ACTION_TTL_MS) {
    thread.pendingAction = undefined;
    return null;
  }
  return thread.pendingAction;
}

/** Discard the pending action after it's confirmed, cancelled, or rejected. */
export function clearPendingAction(userId: string): void {
  const thread = threads.get(userId);
  if (thread) thread.pendingAction = undefined;
}

/**
 * Does this message read as a yes/confirm or a no/cancel to a pending draft?
 * Narrow on purpose, same reasoning as isFollowUp: a message that stands on its
 * own (asks a new question, names a different topic) must not be swallowed as
 * confirmation just because it happens to start differently than expected.
 */
const CONFIRM_PATTERNS = [
  /^(?:yes|yep|yeah|confirm|confirmed|go ahead|submit|do it|ok(?:ay)?|sure|proceed)\b/i,
  /^(?:haan|theek hai|kar do|bhej do)\b/i,
];
const CANCEL_PATTERNS = [
  /^(?:no|nope|cancel|don'?t|stop|wait|hold on|never ?mind|abort)\b/i,
  /^(?:nahi|ruko|mat karo)\b/i,
];

export function detectConfirmation(question: string): 'confirm' | 'cancel' | null {
  const text = String(question ?? '').trim();
  if (!text || text.length > 40) return null;
  if (CONFIRM_PATTERNS.some((pattern) => pattern.test(text))) return 'confirm';
  if (CANCEL_PATTERNS.some((pattern) => pattern.test(text))) return 'cancel';
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

function trimAnswer(answer: string): string {
  return answer.length > MAX_REPLAYED_ANSWER
    ? `${answer.slice(0, MAX_REPLAYED_ANSWER)}…`
    : answer;
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
      answer: trimAnswer(turn.answer),
    }));
}

/**
 * Every remembered turn, chronological, reduced to something with no PII by
 * construction — unlike providerHistory(), NOT filtered by externalSafe, since
 * every entry here is already safe: an external-safe turn's real (trimmed)
 * answer, or a self-account turn's redacted topic summary. This is what makes
 * a follow-up like "and what about last month?" resolvable after a
 * self-account question, without ever putting a real value in front of an
 * external provider.
 */
export function providerHistorySummaries(userId: string): Array<{ question: string; summary: string }> {
  return getThread(userId).map((turn) => ({
    question: turn.question,
    summary: turn.externalSafe
      ? trimAnswer(turn.answer)
      : turn.redactedSummary
        ?? `The user previously asked about ${(turn.intent ?? 'their account').replace(/_/g, ' ')}; Mira answered from live HRMS data without exposing values in this shared history.`,
  }));
}

/**
 * Which history to actually hand a provider: prefer the complete, always-safe
 * summaries (covers self-account turns too) when present, else fall back to
 * the narrower externalSafe-only slice. Kept provider-type-agnostic (plain
 * arrays, not AiGenerateRequest) so both gemini.provider.ts and
 * openrouter.provider.ts can share one precedence rule instead of each
 * inventing its own and silently drifting.
 */
export function pickConversationEntries(
  conversation?: Array<{ question: string; answer: string }>,
  conversationSummaries?: Array<{ question: string; summary: string }>,
): Array<{ question: string; text: string }> {
  if (conversationSummaries?.length) {
    return conversationSummaries.map((turn) => ({ question: turn.question, text: turn.summary }));
  }
  return (conversation ?? []).map((turn) => ({ question: turn.question, text: turn.answer }));
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
