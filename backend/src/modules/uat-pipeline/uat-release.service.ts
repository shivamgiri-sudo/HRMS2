/**
 * Deploy -> retest -> release -> verify -> close, plus rollback.
 *
 * NONE OF THIS DEPENDS ON THE AI PIPELINE. It applies verbatim to fixes a human engineer
 * writes by hand, which is every fix until Phase 4 is enabled. That is deliberate: a merged
 * PR is not a fixed defect, and the governance value of proving a fix works should not wait
 * for the automation that generates it.
 *
 * RETEST IS AN EVIDENCE RECORD, NOT A PASS BUTTON
 *   A retest row storing only "passed" is indistinguishable from a retest nobody performed,
 *   and six months later there is no way to tell which. Every field the schema demands —
 *   who, where, which build, what scenario, expected, actual — is what an auditor would ask
 *   for, so it is captured at the moment someone actually knows the answer.
 *
 * WHO MAY VERIFY IN PRODUCTION
 *   The reporter or the QA owner, never a generic admin. Verification by someone who never
 *   saw the original problem is a signature, not a check.
 */
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { createHash } from "node:crypto";
import { db } from "../../db/mysql.js";
import {
  loadNotifyContext,
  notifyClosed,
  notifyDeployedForRetest,
  notifyReleased,
  notifyRetestFailed,
  notifyRolledBack,
} from "./uat-notification.service.js";
import { recordEvent, transition } from "./uat-state-machine.js";

export class ReleaseError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 409
  ) {
    super(message);
    this.name = "ReleaseError";
  }
}

interface FeedbackOwnerRow extends RowDataPacket {
  submitted_by_employee_id: string;
  qa_owner_id: string | null;
  status: string;
}

/** Hash of the evidence payload, so a stored record can be shown not to have been edited. */
function evidenceHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

// ── Releases ──────────────────────────────────────────────────────────────────

export async function createRelease(input: {
  releaseCode: string;
  name?: string | null;
  environment: "uat" | "production";
  version?: string | null;
  approvedReleaseVersion?: string | null;
}): Promise<void> {
  await db.execute<ResultSetHeader>(
    `INSERT INTO uat_release (release_code, name, environment, version, approved_release_version)
     VALUES (?,?,?,?,?)`,
    [
      input.releaseCode,
      input.name ?? null,
      input.environment,
      input.version ?? null,
      input.approvedReleaseVersion ?? null,
    ]
  );
}

/**
 * Mark an item deployed to UAT. Moves merged -> deployed_to_uat -> ready_for_retest in one
 * step: there is nothing a human does between those two states, and leaving an item parked
 * in deployed_to_uat waiting for a second click is how a retest queue silently stays empty.
 */
export async function markDeployedToUat(
  feedbackId: string,
  input: { releaseId?: string | null; buildSha?: string | null },
  actorUserId: string
): Promise<void> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (input.releaseId) {
      await conn.execute(`UPDATE uat_feedback SET target_release_id = ? WHERE id = ?`, [
        input.releaseId,
        feedbackId,
      ]);
    }
    await transition(
      feedbackId,
      "deployed_to_uat",
      { actorUserId, actorKind: "user", detail: { buildSha: input.buildSha ?? null } },
      conn
    );
    await transition(feedbackId, "ready_for_retest", { actorUserId, actorKind: "system" }, conn);
    await conn.commit();
    // After commit, never inside the transaction: a mail provider timeout must not roll back
    // a deployment that actually happened.
    const nctx = await loadNotifyContext(feedbackId);
    if (nctx) await notifyDeployedForRetest({ ...nctx, environment: "uat" });
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

// ── Retest ────────────────────────────────────────────────────────────────────

export interface RetestInput {
  feedbackId: string;
  environment: string;
  buildSha?: string | null;
  appVersion?: string | null;
  scenario: string;
  stepsPerformed: string;
  expectedResult: string;
  actualResult: string;
  result: "pass" | "fail";
  failureReason?: string | null;
  releaseId?: string | null;
}

/**
 * Record a retest and move the item accordingly, atomically. The evidence and the status
 * change are one transaction: a "passed" status with no evidence row behind it is exactly
 * the claim this whole subsystem exists to make impossible.
 */
export async function recordRetest(
  input: RetestInput,
  actor: { userId: string; employeeId: string; roles: string[] }
): Promise<{ attemptNo: number }> {
  for (const [field, value] of Object.entries({
    scenario: input.scenario,
    stepsPerformed: input.stepsPerformed,
    expectedResult: input.expectedResult,
    actualResult: input.actualResult,
  })) {
    if (!value || !String(value).trim()) {
      throw new ReleaseError(
        `Retest evidence is incomplete: ${field} is required. A retest that records only a ` +
          `verdict cannot be told apart from one nobody performed.`,
        400
      );
    }
  }
  if (input.result === "fail" && !input.failureReason?.trim()) {
    throw new ReleaseError("A failed retest must say what went wrong.", 400);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [fb] = await conn.execute<FeedbackOwnerRow[]>(
      `SELECT submitted_by_employee_id, qa_owner_id, status FROM uat_feedback WHERE id = ? FOR UPDATE`,
      [input.feedbackId]
    );
    if (fb.length === 0) throw new ReleaseError("UAT feedback not found", 404);
    if (fb[0].status !== "ready_for_retest") {
      throw new ReleaseError(
        `This item is ${fb[0].status}; only an item that is ready_for_retest can be retested.`
      );
    }

    const [prior] = await conn.execute<RowDataPacket[]>(
      `SELECT COALESCE(MAX(attempt_no), 0) AS n FROM uat_retest WHERE feedback_id = ?`,
      [input.feedbackId]
    );
    const attemptNo = Number((prior[0] as { n: number }).n) + 1;

    const payload = { ...input, testedBy: actor.employeeId, attemptNo };
    await conn.execute(
      `INSERT INTO uat_retest
         (feedback_id, release_id, attempt_no, tested_by, tester_role, environment, build_sha,
          app_version, scenario, steps_performed, expected_result, actual_result, result,
          failure_reason, evidence_sha256)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.feedbackId,
        input.releaseId ?? null,
        attemptNo,
        actor.employeeId,
        actor.roles[0] ?? null,
        input.environment,
        input.buildSha ?? null,
        input.appVersion ?? null,
        input.scenario,
        input.stepsPerformed,
        input.expectedResult,
        input.actualResult,
        input.result,
        input.failureReason ?? null,
        evidenceHash(payload),
      ]
    );

    if (input.result === "pass") {
      await transition(
        input.feedbackId,
        "retest_passed",
        { actorUserId: actor.userId, actorKind: "user", detail: { attemptNo } },
        conn
      );
    } else {
      await transition(
        input.feedbackId,
        "retest_failed",
        {
          actorUserId: actor.userId,
          actorKind: "user",
          reason: input.failureReason ?? null,
          detail: { attemptNo },
        },
        conn
      );
      // A failed retest reopens rather than closing. The reporter, not only an admin, can
      // put an item back in play.
      await transition(input.feedbackId, "reopened", { actorUserId: actor.userId, actorKind: "system" }, conn);
    }

    await conn.commit();

    if (input.result === "fail") {
      const nctx = await loadNotifyContext(input.feedbackId);
      if (nctx) await notifyRetestFailed({ ...nctx, failureReason: input.failureReason ?? null });
    }
    return { attemptNo };
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

export async function listRetests(feedbackId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM uat_retest WHERE feedback_id = ? ORDER BY attempt_no`,
    [feedbackId]
  );
  return rows;
}

// ── Production release and verification ───────────────────────────────────────

export async function markProductionReleased(
  feedbackId: string,
  input: { releaseId: string; version: string; approvedReleaseVersion: string },
  actorUserId: string
): Promise<void> {
  // RS-04: the version that shipped must equal the version that was approved. Comparing two
  // recorded facts, rather than assuming they match, is the entire point of storing both.
  if (input.version !== input.approvedReleaseVersion) {
    throw new ReleaseError(
      `Refusing to record the release: version ${input.version} does not match the approved ` +
        `release version ${input.approvedReleaseVersion}.`
    );
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE uat_release SET status = 'released', version = ?, approved_release_version = ?,
              deployed_at = NOW(), deployed_by = ? WHERE id = ?`,
      [input.version, input.approvedReleaseVersion, actorUserId, input.releaseId]
    );
    await conn.execute(`UPDATE uat_feedback SET target_release_id = ? WHERE id = ?`, [
      input.releaseId,
      feedbackId,
    ]);
    await transition(
      feedbackId,
      "production_released",
      { actorUserId, actorKind: "user", detail: { version: input.version } },
      conn
    );
    await conn.commit();
    const nctx = await loadNotifyContext(feedbackId);
    if (nctx) await notifyReleased({ ...nctx, version: input.version });
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

/**
 * Verify in production, then close.
 *
 * Restricted to the reporter or the QA owner. A generic admin marking someone else's defect
 * verified is a signature rather than a check, and the whole lifecycle exists so that the
 * person who reported the problem is the one who confirms it is gone.
 */
export async function verifyInProduction(
  feedbackId: string,
  input: { checklist: Record<string, boolean>; note?: string | null },
  actor: { userId: string; employeeId: string }
): Promise<void> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [fb] = await conn.execute<FeedbackOwnerRow[]>(
      `SELECT submitted_by_employee_id, qa_owner_id, status FROM uat_feedback WHERE id = ? FOR UPDATE`,
      [feedbackId]
    );
    if (fb.length === 0) throw new ReleaseError("UAT feedback not found", 404);

    const isReporter = fb[0].submitted_by_employee_id === actor.employeeId;
    const isQaOwner = fb[0].qa_owner_id === actor.employeeId;
    if (!isReporter && !isQaOwner) {
      throw new ReleaseError(
        "Only the person who reported this, or its QA owner, can verify it in production.",
        403
      );
    }

    const unchecked = Object.entries(input.checklist ?? {})
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (Object.keys(input.checklist ?? {}).length === 0 || unchecked.length > 0) {
      throw new ReleaseError(
        `The verification checklist is incomplete: ${unchecked.join(", ") || "(empty)"}`,
        400
      );
    }

    await conn.execute(
      `UPDATE uat_release SET verified_at = NOW(), verified_by = ?, verification_checklist_json = ?
        WHERE id = (SELECT target_release_id FROM uat_feedback WHERE id = ?)`,
      [actor.userId, JSON.stringify(input.checklist), feedbackId]
    );
    await transition(
      feedbackId,
      "production_verified",
      {
        actorUserId: actor.userId,
        actorKind: "user",
        detail: { verifiedBy: isReporter ? "reporter" : "qa_owner" },
      },
      conn
    );
    await transition(
      feedbackId,
      "closed",
      { actorUserId: actor.userId, actorKind: "user", reason: input.note ?? null },
      conn
    );
    await conn.commit();
    const nctx = await loadNotifyContext(feedbackId);
    if (nctx) await notifyClosed(nctx);
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

// ── Rollback ──────────────────────────────────────────────────────────────────

/**
 * A production regression is a rollback, not an ordinary reopen. Keeping it distinct means
 * "how often do we roll back" is a query rather than an anecdote, which is what makes the
 * revert-rate figure in the Phase 6 entry criteria measurable at all.
 */
export async function requireRollback(
  feedbackId: string,
  input: { releaseId: string; reason: string },
  actorUserId: string
): Promise<void> {
  if (!input.reason?.trim()) throw new ReleaseError("A rollback must record why.", 400);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO uat_rollback (release_id, feedback_id, reason, initiated_by, status)
       VALUES (?,?,?,?, 'required')`,
      [input.releaseId, feedbackId, input.reason, actorUserId]
    );
    await transition(
      feedbackId,
      "rollback_required",
      { actorUserId, actorKind: "user", reason: input.reason },
      conn
    );
    await conn.commit();
    const nctx = await loadNotifyContext(feedbackId);
    if (nctx) await notifyRolledBack({ ...nctx, reason: input.reason });
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

export async function completeRollback(
  feedbackId: string,
  input: { rollbackId: string; restoredVersion: string; verification?: string | null },
  actorUserId: string
): Promise<void> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE uat_rollback SET status = 'completed', rolled_back_at = NOW(),
              restored_version = ?, verification = ? WHERE id = ?`,
      [input.restoredVersion, input.verification ?? null, input.rollbackId]
    );
    await transition(feedbackId, "rolled_back", { actorUserId, actorKind: "user" }, conn);
    await transition(feedbackId, "reopened", { actorUserId, actorKind: "system" }, conn);
    await recordEvent(
      feedbackId,
      "rollback",
      { actorUserId, actorKind: "user", message: `rolled back to ${input.restoredVersion}` },
      conn
    );
    await conn.commit();
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
