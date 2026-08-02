import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { logger } from "../../lib/logger.js";
import type { RowDataPacket } from "mysql2";
import { evaluateCoachingTrigger, type QualitySignal, type CoachingTrigger } from "./coaching-trigger.js";

/**
 * Turns a coaching decision into rows somebody will actually see.
 *
 * coaching_session and training_need have both existed for months and both hold
 * ZERO rows, while 254 agents are scored at an average of 50.1%. The tables were
 * modelled and never written to, so "quality is low" has never once become
 * "somebody is doing something about it".
 *
 * The decision itself lives in coaching-trigger.ts and is pure. This file only
 * persists it, and its one hard requirement is idempotency: the quality sync
 * runs nightly, and a coaching row per night per agent would bury the signal
 * within a week — which is exactly how the connector failures went unnoticed for
 * 36 days.
 */

export type CoachingOutcome =
  | { created: false; reason: "no_trigger" | "already_open" | "no_employee" }
  | { created: true; sessionId: string; trainingNeedId: string | null; trigger: CoachingTrigger };

/**
 * The LOGIN of the person who should hold the conversation.
 *
 * coaching_session.coach_user_id is a user id everywhere else that touches it:
 * management.createCoachingSession passes the session's user id, and both the
 * journey audit report and the BPO governance adapter read the column as the
 * acting user. But employees.reporting_manager_id holds an EMPLOYEE id — 15,965
 * of them match employees and none match auth_user — so writing it straight in
 * would have attributed every automated coaching session to an actor that does
 * not exist.
 *
 * This resolves manager employee -> their linked login, and returns null when
 * the manager has no account. A session nobody can be identified as owning is
 * worse than no session.
 */
async function resolveCoach(employeeId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT mgr.auth_user_id AS coach_user_id
       FROM employees emp
       JOIN employees mgr ON mgr.id = COALESCE(emp.reporting_manager_id, emp.manager_id)
      WHERE emp.id = ? AND mgr.auth_user_id IS NOT NULL
      LIMIT 1`,
    [employeeId],
  );
  return rows[0]?.coach_user_id ? String(rows[0].coach_user_id) : null;
}

/**
 * Is there already an open coaching session covering this period?
 *
 * Scoped to sessions still scheduled: a completed one means the conversation
 * happened and a fresh shortfall deserves a new session, while a cancelled one
 * was deliberately dropped and should not be silently resurrected.
 */
async function hasOpenSession(employeeId: string, from: string, to: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM coaching_session
      WHERE employee_id = ?
        AND status = 'scheduled'
        AND session_date BETWEEN ? AND ?
      LIMIT 1`,
    [employeeId, from, to],
  );
  return rows.length > 0;
}

export async function raiseCoachingFromQuality(input: {
  employeeId: string;
  /** Period the signal covers; the session is dated at its end. */
  periodStart: string;
  periodEnd: string;
  signal: QualitySignal;
  /** Canonical metric the shortfall relates to, for the training need. */
  metricId?: string | null;
  raisedByUserId?: string | null;
}): Promise<CoachingOutcome> {
  const trigger = evaluateCoachingTrigger(input.signal);
  if (!trigger) return { created: false, reason: "no_trigger" };

  if (await hasOpenSession(input.employeeId, input.periodStart, input.periodEnd)) {
    // The nightly sync will re-evaluate this same shortfall every night until
    // somebody acts on it. One open session is the point; thirty is noise.
    return { created: false, reason: "already_open" };
  }

  const coachId = await resolveCoach(input.employeeId);
  if (!coachId) {
    // Without a coach the row is an orphan nobody is accountable for. Say so
    // rather than creating work assigned to no one.
    logger.warn(
      { employeeId: input.employeeId },
      "[Coaching] shortfall detected but the employee has no reporting manager — not raising a session",
    );
    return { created: false, reason: "no_employee" };
  }

  const sessionId = randomUUID();
  let trainingNeedId: string | null = null;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO coaching_session
         (id, employee_id, coach_user_id, session_date, session_type, notes, action_items, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
      [
        sessionId, input.employeeId, coachId, input.periodEnd, trigger.sessionType,
        trigger.reason,
        // Structured alongside the prose so a UI can render it without parsing
        // a sentence, and so the numbers behind the decision stay auditable.
        JSON.stringify({
          priority: trigger.priority,
          qualityPercentage: input.signal.qualityPercentage,
          targetPercentage: input.signal.targetPercentage,
          assessedAudits: input.signal.sampleSize,
          consecutiveShortfalls: input.signal.consecutiveShortfalls,
          fatalTriggered: input.signal.fatalTriggered,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        }),
      ],
    );

    if (trigger.raiseTrainingNeed) {
      trainingNeedId = randomUUID();
      await conn.execute(
        `INSERT INTO training_need
           (id, employee_id, metric_id, coaching_session_id, need_type, description,
            priority, status, identified_by)
         VALUES (?, ?, ?, ?, 'quality', ?, ?, 'identified', ?)`,
        [
          trainingNeedId, input.employeeId, input.metricId ?? null, sessionId,
          trigger.reason, trigger.priority, input.raisedByUserId ?? null,
        ],
      );
    }

    await conn.commit();
  } catch (err) {
    // A session without its training need, or a need pointing at a session that
    // was never written, is worse than neither.
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  logger.info(
    { employeeId: input.employeeId, priority: trigger.priority, sessionType: trigger.sessionType },
    `[Coaching] raised a ${trigger.priority} ${trigger.sessionType} session — ${trigger.reason}`,
  );

  return { created: true, sessionId, trainingNeedId, trigger };
}
