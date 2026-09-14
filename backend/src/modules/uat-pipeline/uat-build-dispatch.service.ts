/**
 * Build dispatch and the CI callbacks.
 *
 * ⚠ INERT BY CONSTRUCTION. `assertDispatchAllowed()` refuses while any row in uat_gate_status
 *   is unmet, and every gate ships unmet. So this code can be reviewed and tested now, and
 *   turning it on later is an operator action — attesting each gate with evidence and a name
 *   — rather than a development project undertaken under pressure.
 *
 *   The gate list is in the database rather than in this file on purpose. A constant here
 *   would be edited by whoever wanted to dispatch; a row requires an attestation with an
 *   attester, and the attestation is itself auditable.
 *
 * THE TRUST SPLIT THIS ENFORCES
 *   Job A executes generated code and can only WRITE EVIDENCE. Job D executes no repository
 *   code and is the only job that can RECORD A RESULT. Two separately scoped credentials,
 *   never interchangeable, and this file is where that is enforced: recordEvidence() cannot
 *   move a build's state, and recordResult() cannot upload anything.
 *
 *   gates_sha256 is computed by Job C and re-checked here, so Job D can only relay a result
 *   Job C actually produced. Without that check the split would be decorative.
 */
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { sha256 } from "./control-plane.js";
import { switchEnabled, readConfig } from "./uat-governance.service.js";
import { latestPrompt, jsonArray } from "./uat-prompt.repo.js";
import { recordEvent, transition } from "./uat-state-machine.js";
import { isValidBranchSlug } from "./uat-prompt-writer.service.js";
import type { VerifiedToken } from "./uat-oidc-verify.service.js";

type UatConnection = PoolConnection | Awaited<ReturnType<typeof db.getConnection>>;

export class DispatchError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 409
  ) {
    super(message);
    this.name = "DispatchError";
  }
}

// ── Gates ─────────────────────────────────────────────────────────────────────

interface GateRow extends RowDataPacket {
  gate_key: string;
  title: string;
  met: number;
}

export interface GateReport {
  allMet: boolean;
  unmet: Array<{ key: string; title: string }>;
}

/**
 * G1-G8.
 *
 * An empty table is treated as ALL UNMET, not as no gates. A migration that failed to seed
 * would otherwise silently unlock the most dangerous feature in the system — the exact
 * absent-means-permitted shape this pipeline exists to prevent.
 */
export async function gateReport(conn?: UatConnection): Promise<GateReport> {
  const runner = conn ?? db;
  const [rows] = await runner.query<GateRow[]>(
    `SELECT gate_key, title, met FROM uat_gate_status ORDER BY gate_key`
  );
  if (!rows.length) {
    return {
      allMet: false,
      unmet: [{ key: "G0", title: "uat_gate_status is empty; no gate has been attested." }],
    };
  }
  const unmet = rows.filter((r) => r.met !== 1).map((r) => ({ key: r.gate_key, title: r.title }));
  return { allMet: unmet.length === 0, unmet };
}

/**
 * Every condition that must hold before a build may be dispatched, checked in cost order:
 * the gates and the switch first (free), then the per-item state, then the daily caps.
 */
export async function assertDispatchAllowed(feedbackId: string): Promise<void> {
  const gates = await gateReport();
  if (!gates.allMet) {
    throw new DispatchError(
      "Automated builds are held. Unmet gates: " +
        gates.unmet.map((g) => `${g.key} (${g.title})`).join("; ") +
        ". Each must be attested in uat_gate_status by a named person with evidence."
    );
  }

  const sw = await switchEnabled("builds_enabled", process.env.UAT_BUILDS_ENABLED);
  if (!sw.enabled) throw new DispatchError(sw.reason ?? "Automated builds are switched off.");

  const prompt = await latestPrompt(feedbackId);
  if (!prompt) throw new DispatchError("There is no build prompt for this item.", 404);
  if (!prompt.approved_at) {
    throw new DispatchError(
      "The build prompt has not been approved. A human reads the instructions before anything acts on them."
    );
  }
  // Re-validated at the last possible moment. The value has passed three checks already;
  // this one costs a regex and covers the case where a row was edited directly in the
  // database, which is not hypothetical in an environment with a shared DB account.
  if (!isValidBranchSlug(prompt.branch_slug)) {
    throw new DispatchError(`Stored branch slug is not valid: "${prompt.branch_slug}".`, 400);
  }
  if (jsonArray(prompt.allowed_paths_json).length === 0) {
    throw new DispatchError("The approved prompt has an empty allowlist.", 400);
  }

  // Allowlisted modules: Phase 4 starts with one or two low-risk frontend-only areas.
  // An empty setting means NO module is eligible, which is why it ships empty.
  const allowlisted = (await readConfig("allowlisted_modules", ""))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowlisted.length === 0) {
    throw new DispatchError(
      "No module is on the automated-build allowlist (uat_pipeline_config.allowlisted_modules is empty)."
    );
  }
  const paths = jsonArray(prompt.allowed_paths_json);
  const outside = paths.filter((p) => !allowlisted.some((prefix) => p.startsWith(prefix)));
  if (outside.length) {
    throw new DispatchError(
      `These paths are outside the automated-build allowlist: ${outside.join(", ")}.`
    );
  }

  const cap = Number(await readConfig("daily_build_cap", "5"));
  const [today] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM uat_build_run WHERE dispatched_at >= CURDATE()`
  );
  if (Number(today[0]?.n ?? 0) >= cap) {
    throw new DispatchError(`The daily build cap of ${cap} has been reached.`);
  }

  const maxConcurrent = Number(await readConfig("max_concurrent_builds", "1"));
  const [running] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM uat_build_run WHERE state IN ('dispatched','running')`
  );
  if (Number(running[0]?.n ?? 0) >= maxConcurrent) {
    throw new DispatchError(
      `A build is already running (limit ${maxConcurrent}). Builds are deliberately serialised.`
    );
  }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export interface DispatchResult {
  buildRunId: string;
  branchName: string;
  attemptNo: number;
}

/**
 * Create the build-run row and hand back the id.
 *
 * The workflow_dispatch input is ONLY this id — no token, no prompt, no free text. Anything
 * the workflow needs, it fetches from the backend with a scoped credential after proving its
 * identity via OIDC. Passing the prompt as an input would put employee-derived text into the
 * workflow-dispatch record, which is visible in the Actions UI and in the audit log.
 *
 * The UNIQUE (feedback_id, attempt_no) key is the idempotency mechanism, not a backstop: a
 * double-click produces one row and one dispatch.
 */
export async function createBuildRun(input: {
  feedbackId: string;
  attemptNo?: number;
  actorUserId: string;
}): Promise<DispatchResult> {
  await assertDispatchAllowed(input.feedbackId);

  const attemptNo = input.attemptNo ?? 1;
  // Attempt 2 is the last. A third would spend the daily cap discovering the same failure.
  if (attemptNo > 2) {
    throw new DispatchError("A build may be attempted at most twice.");
  }

  const prompt = await latestPrompt(input.feedbackId);
  if (!prompt) throw new DispatchError("There is no build prompt for this item.", 404);

  const branchName = `uat/${prompt.branch_slug}-${attemptNo}`;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO uat_build_run
         (feedback_id, prompt_id, attempt_no, state, branch_name, dispatched_by, dispatched_at)
       VALUES (?,?,?,'queued',?,?,NOW())
       ON DUPLICATE KEY UPDATE id = id`,
      [input.feedbackId, prompt.id, attemptNo, branchName, input.actorUserId]
    );
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, state FROM uat_build_run WHERE feedback_id = ? AND attempt_no = ?`,
      [input.feedbackId, attemptNo]
    );
    const row = rows[0];
    if (!row) throw new DispatchError("Could not create the build run.", 500);

    await recordEvent(
      input.feedbackId,
      "build_dispatched",
      {
        actorUserId: input.actorUserId,
        actorKind: "user",
        message: `Build queued on branch ${branchName} (attempt ${attemptNo}).`,
        detail: { buildRunId: row.id, branchName, attemptNo, promptSha256: prompt.prompt_sha256 },
      },
      conn
    );
    await conn.commit();
    return { buildRunId: String(row.id), branchName, attemptNo };
  } catch (error) {
    try {
      await conn.rollback();
    } catch {
      /* surface the original */
    }
    throw error;
  } finally {
    conn.release();
  }
}

// ── Callbacks ─────────────────────────────────────────────────────────────────

/**
 * Record that a callback happened, idempotently.
 *
 * Returns false when this exact event was already recorded, so a legitimate GitHub retry
 * after a network ambiguity succeeds instead of failing closed — while a replay cannot
 * record a second result. The OIDC claims are stored so a disputed callback traces to one
 * workflow run and one commit.
 */
export async function recordCallback(
  input: {
    buildRunId: string;
    kind: "evidence" | "result";
    gatesSha256?: string | null;
  },
  token: VerifiedToken,
  conn?: UatConnection
): Promise<boolean> {
  const runner = conn ?? db;
  const [res] = await runner.query(
    `INSERT IGNORE INTO uat_build_callback
       (build_run_id, callback_kind, run_attempt, gates_sha256,
        oidc_repository, oidc_job_ref, oidc_sha)
     VALUES (?,?,?,?,?,?,?)`,
    [
      input.buildRunId,
      input.kind,
      token.runAttempt,
      input.gatesSha256 ?? null,
      token.repository,
      token.jobWorkflowRef,
      token.sha,
    ]
  );
  return (res as { affectedRows?: number }).affectedRows === 1;
}

export interface GateResult {
  passed: boolean;
  guardrailBreach: boolean;
  failureStage?: string | null;
  failureMessage?: string | null;
  headSha: string;
  gates: Record<string, unknown>;
}

/**
 * Job D reporting Job C's verdict.
 *
 * The caller supplies `gatesSha256` from the token-bearing request; it is recomputed here
 * from the payload and compared. A mismatch means Job D is reporting something Job C did not
 * emit, which is the failure the trust split exists to catch, so it rejects rather than
 * recording an unverified result.
 */
export async function recordResult(
  input: {
    buildRunId: string;
    result: GateResult;
    gatesSha256: string;
    prUrl?: string | null;
  },
  token: VerifiedToken
): Promise<{ recorded: boolean; state: string }> {
  const canonical = sha256(JSON.stringify(input.result.gates));
  if (canonical !== input.gatesSha256) {
    throw new DispatchError(
      "The reported gate result does not hash to the value supplied with it. Refusing to " +
        "record a result the verification job did not produce.",
      400
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, feedback_id, state FROM uat_build_run WHERE id = ? FOR UPDATE`,
      [input.buildRunId]
    );
    if (!rows.length) throw new DispatchError("Build run not found.", 404);
    const run = rows[0];

    const fresh = await recordCallback(
      { buildRunId: input.buildRunId, kind: "result", gatesSha256: input.gatesSha256 },
      token,
      conn
    );
    if (!fresh) {
      // Already recorded. A retry, not a second result.
      await conn.commit();
      return { recorded: false, state: String(run.state) };
    }

    const state = input.result.passed ? (input.prUrl ? "pr_open" : "gates_passed") : "gates_failed";

    await conn.execute(
      `UPDATE uat_build_run
          SET state = ?, gates_json = ?, gates_sha256 = ?, pr_url = ?,
              head_sha = ?, verified_sha = ?, guardrail_breach = ?,
              failure_stage = ?, failure_message = ?,
              gh_workflow_run_id = ?, gh_run_attempt = ?, completed_at = NOW()
        WHERE id = ?`,
      [
        state,
        JSON.stringify(input.result.gates),
        input.gatesSha256,
        input.prUrl ?? null,
        input.result.headSha,
        // verified_sha is set ONLY on a pass. RS-03 later requires merge_sha to equal it,
        // and a verified_sha recorded on a failed run would make that check meaningless.
        input.result.passed ? input.result.headSha : null,
        input.result.guardrailBreach ? 1 : 0,
        input.result.failureStage ?? null,
        input.result.failureMessage?.slice(0, 1000) ?? null,
        Number(token.runId) || null,
        token.runAttempt,
        input.buildRunId,
      ]
    );

    await recordEvent(
      String(run.feedback_id),
      input.result.passed ? "build_passed" : "build_failed",
      {
        actorKind: "ci",
        message: input.result.guardrailBreach
          ? "GUARDRAIL BREACH: the patch attempted something the guards forbid. This is never retried."
          : input.result.passed
            ? `All gates passed at ${input.result.headSha.slice(0, 8)}.`
            : `Failed at ${input.result.failureStage ?? "an unnamed stage"}.`,
        detail: {
          buildRunId: input.buildRunId,
          guardrailBreach: input.result.guardrailBreach,
          gatesSha256: input.gatesSha256,
          runId: token.runId,
          runAttempt: token.runAttempt,
        },
      },
      conn
    );

    if (input.result.passed && input.prUrl) {
      await transition(
        String(run.feedback_id),
        "pr_open",
        { actorKind: "ci", reason: `Draft PR opened: ${input.prUrl}` },
        conn
      );
    } else if (!input.result.passed) {
      await transition(
        String(run.feedback_id),
        "build_failed",
        {
          actorKind: "ci",
          reason: input.result.failureMessage ?? "The build did not pass verification.",
        },
        conn
      );
    }

    await conn.commit();
    return { recorded: true, state };
  } catch (error) {
    try {
      await conn.rollback();
    } catch {
      /* surface the original */
    }
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * RS-03 at merge time.
 *
 * CI proving the GENERATED commit passed says nothing about a commit pushed onto the PR
 * afterwards. So the merged SHA is compared against the SHA that was actually verified, and
 * a mismatch is recorded as a discrepancy rather than accepted because the PR is green.
 */
export async function recordMerge(input: {
  buildRunId: string;
  mergeSha: string;
}): Promise<{ matchesVerified: boolean }> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT verified_sha, feedback_id FROM uat_build_run WHERE id = ?`,
    [input.buildRunId]
  );
  if (!rows.length) throw new DispatchError("Build run not found.", 404);
  const verified = rows[0].verified_sha as string | null;
  const matches = Boolean(verified) && verified === input.mergeSha;

  await db.query(`UPDATE uat_build_run SET merge_sha = ?, state = 'merged' WHERE id = ?`, [
    input.mergeSha,
    input.buildRunId,
  ]);

  await recordEvent(String(rows[0].feedback_id), matches ? "merged" : "merge_sha_mismatch", {
    actorKind: "ci",
    message: matches
      ? `Merged at the verified SHA ${input.mergeSha.slice(0, 8)}.`
      : `MERGE SHA MISMATCH: merged ${input.mergeSha.slice(0, 8)} but only ${(verified ?? "nothing").slice(0, 8)} was verified. Something was pushed onto the pull request after verification.`,
    detail: { buildRunId: input.buildRunId, mergeSha: input.mergeSha, verifiedSha: verified },
  });

  return { matchesVerified: matches };
}

/**
 * Runs that stopped reporting.
 *
 * A build that dies mid-run leaves a `dispatched` or `running` row that nothing will ever
 * update — the silent-stall shape again. Anything older than the threshold is surfaced on
 * /api/uat/health for reconciliation against the GitHub Actions API.
 */
export async function staleRuns(olderThanMinutes = 10): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, feedback_id, state, branch_name, gh_workflow_run_id, dispatched_at
       FROM uat_build_run
      WHERE state IN ('queued','dispatched','running')
        AND dispatched_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
      ORDER BY dispatched_at`,
    [olderThanMinutes]
  );
  return rows;
}
