/**
 * Duplicate detection for UAT feedback.
 *
 * UAT routinely produces 10-50 reports of a single defect within an hour of a deploy. Without
 * this, triage spends its first day deduplicating by hand and the affected-user count — the
 * number that actually tells you how bad something is — is never recorded anywhere.
 *
 * WHY TOKEN SCORING IN APPLICATION CODE RATHER THAN MySQL FULLTEXT
 *   A FULLTEXT index is DDL, and the pipeline's own checklist (DI-01/DI-02) forbids the
 *   automated path from introducing DDL. Holding the module to the same rule it enforces is
 *   worth more than the marginal recall a FULLTEXT index would buy at UAT volume, where the
 *   candidate set is a few hundred open items rather than millions.
 *
 * Scoring is deliberately transparent — token overlap plus a same-page bonus — so a triager
 * can see why two items were linked. A similarity score nobody can explain gets ignored.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/** Words carrying no discriminating signal in a bug report. */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "and", "or", "but",
  "if", "then", "than", "that", "this", "these", "those", "it", "its", "in", "on", "at",
  "to", "for", "of", "with", "from", "by", "as", "not", "no", "so", "we", "i", "my", "me",
  "you", "your", "our", "us", "he", "she", "they", "them", "his", "her", "their",
  "showing", "shows", "show", "shown", "getting", "gets", "get", "got", "when", "while",
  "there", "here", "some", "any", "all", "can", "cannot", "cant", "will", "would", "should",
  "issue", "problem", "error", "wrong", "incorrect", "bug", "page", "screen", "button",
]);

export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of (text ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue;
    if (STOP_WORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

/**
 * Minimum denominator. A title contributing fewer than this many meaningful tokens cannot
 * reach a high score on a single shared word.
 */
const MIN_DENOMINATOR = 3;

/**
 * Overlap as a fraction of the SMALLER token set, floored at MIN_DENOMINATOR.
 *
 * Two decisions, each with a concrete failure it prevents:
 *
 *   Smaller set, not union (Jaccard). Jaccard punishes a thorough report for being long:
 *   "leave carry forward wrong" against a detailed paragraph about the same defect scores
 *   ~0.35 on union and would be missed. Asking "is the short one contained in the long one"
 *   is what duplicate reports of one defect actually look like.
 *
 *   The floor. Without it the smaller-set denominator produces a false positive on very
 *   short titles: "Cannot apply for leave" reduces to {apply, leave}, shares only "leave"
 *   with "Leave balance shows wrong carry forward", and scores 1/2 = 0.5 — over the
 *   threshold, on one common word, for an unrelated defect. Flooring the denominator at 3
 *   drops that to 0.33 while leaving genuine duplicates (which share 3+ tokens) untouched.
 *   False matches are the expensive direction here: they teach people to ignore the panel,
 *   after which it catches nothing at all.
 */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (large.has(t)) shared++;
  return shared / Math.max(small.size, MIN_DENOMINATOR);
}

export interface SimilarItem {
  id: string;
  feedbackCode: string;
  title: string;
  status: string;
  affectedUserCount: number;
  createdAt: Date;
  score: number;
  samePage: boolean;
}

interface CandidateRow extends RowDataPacket {
  id: string;
  feedback_code: string;
  title: string;
  status: string;
  page_code: string | null;
  page_route: string | null;
  affected_user_count: number;
  created_at: Date;
}

const OPEN_ENOUGH_TO_DUPLICATE = [
  "scan_blocked", "scan_done", "triaged", "validating", "checklist_passed",
  "awaiting_governance", "awaiting_approval", "prompt_ready", "build_queued",
  "build_running", "pr_open", "reviewed", "merged", "deployed_to_uat",
  "ready_for_retest", "retest_failed", "reopened",
];

/**
 * Candidates a new report might duplicate.
 *
 * Deliberately NOT scope-filtered. Two people in different branches hitting the same defect
 * is the normal case, and hiding one from the other is how the same bug gets fixed twice.
 * Only the title and status are returned — never the body — so this leaks nothing a scoped
 * read would otherwise withhold.
 */
export async function findSimilar(
  title: string,
  pageRoute: string | null,
  pageCode: string | null,
  opts: { limit?: number; minScore?: number; excludeId?: string } = {}
): Promise<SimilarItem[]> {
  const minScore = opts.minScore ?? 0.4;
  const limit = opts.limit ?? 5;
  const target = tokenize(title);
  if (target.size === 0) return [];

  const placeholders = OPEN_ENOUGH_TO_DUPLICATE.map(() => "?").join(",");
  const [rows] = await db.execute<CandidateRow[]>(
    `SELECT id, feedback_code, title, status, page_code, page_route,
            affected_user_count, created_at
       FROM uat_feedback
      WHERE status IN (${placeholders})
        AND duplicate_of_id IS NULL
        AND created_at > DATE_SUB(NOW(), INTERVAL 90 DAY)
      ORDER BY created_at DESC
      LIMIT 400`,
    OPEN_ENOUGH_TO_DUPLICATE
  );

  const scored: SimilarItem[] = [];
  for (const r of rows) {
    if (opts.excludeId && r.id === opts.excludeId) continue;
    const samePage =
      (!!pageCode && r.page_code === pageCode) || (!!pageRoute && r.page_route === pageRoute);
    let score = similarity(target, tokenize(r.title));
    // Same page is corroborating evidence, not proof — a bounded nudge, never enough on its
    // own to surface an unrelated title.
    if (samePage) score = Math.min(1, score + 0.15);
    if (score >= minScore) {
      scored.push({
        id: r.id,
        feedbackCode: r.feedback_code,
        title: r.title,
        status: r.status,
        affectedUserCount: r.affected_user_count,
        createdAt: r.created_at,
        score: Math.round(score * 100) / 100,
        samePage,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * "Me too" — record that another person hit an existing defect without creating a new item.
 *
 * The count is what turns "somebody mentioned this" into "eleven people are blocked", which
 * is the input a prioritisation decision actually needs.
 */
export async function recordMeToo(canonicalId: string, actorUserId: string): Promise<number> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT affected_user_count FROM uat_feedback WHERE id = ? FOR UPDATE`,
      [canonicalId]
    );
    if (rows.length === 0) {
      const e = new Error("UAT feedback not found") as Error & { statusCode?: number };
      e.statusCode = 404;
      throw e;
    }
    const next = Number((rows[0] as { affected_user_count: number }).affected_user_count) + 1;
    await conn.execute(`UPDATE uat_feedback SET affected_user_count = ? WHERE id = ?`, [
      next,
      canonicalId,
    ]);
    await conn.execute(
      `INSERT INTO uat_feedback_event (feedback_id, event_type, actor_user_id, actor_kind, message, detail_json)
       VALUES (?, 'me_too', ?, 'user', 'another user reported the same issue', ?)`,
      [canonicalId, actorUserId, JSON.stringify({ affectedUserCount: next })]
    );
    await conn.commit();
    return next;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* surface the original */
    }
    throw err;
  } finally {
    conn.release();
  }
}
