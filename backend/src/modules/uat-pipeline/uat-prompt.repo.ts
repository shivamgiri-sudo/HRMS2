/**
 * Persistence and approval for build prompts.
 *
 * The prompt is stored rather than regenerated because it is the instruction set a coding
 * agent will act on. Regenerating means "what was it told to do" is unanswerable afterwards,
 * and two renders of the same item could differ with nobody noticing. Stored with its hash,
 * its template version and the allowlist as the approver saw it.
 */
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { sha256 } from "./control-plane.js";
import { recordEvent } from "./uat-state-machine.js";
import { isValidBranchSlug } from "./uat-prompt-writer.service.js";

type UatConnection = PoolConnection | Awaited<ReturnType<typeof db.getConnection>>;

export class PromptError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 409
  ) {
    super(message);
    this.name = "PromptError";
  }
}

export interface PromptRow extends RowDataPacket {
  id: string;
  feedback_id: string;
  attempt_no: number;
  template_version: string;
  prompt_text: string;
  prompt_sha256: string;
  allowed_paths_json: string | string[];
  forbidden_paths_json: string | string[];
  mandatory_tests_json: string | string[];
  branch_slug: string;
  acceptance_criteria_json: string | string[] | null;
  rollback_plan: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  rejected_by: string | null;
  rejected_at: Date | null;
  rejection_reason: string | null;
  created_at: Date;
}

export interface SavePromptInput {
  feedbackId: string;
  attemptNo: number;
  templateVersion: string;
  promptText: string;
  allowedPaths: string[];
  forbiddenPaths: string[];
  mandatoryTests: string[];
  branchSlug: string;
  acceptanceCriteria: string[];
  rollbackPlan: string;
  llmCallId?: string | null;
}

/**
 * Store a prompt.
 *
 * Validates the branch slug AGAIN here, at the storage boundary. The writer already checked
 * it, but this is the last point before it becomes a persisted value that CI will later read
 * and hand to `git switch -c`; a check at every boundary costs a regex and removes the class
 * of bug where one caller forgot.
 *
 * REPLACE, not accumulate, on the same attempt: regenerating a prompt for attempt 1 should
 * leave one row, and a stale row carrying an old approval would be a signature attached to
 * text nobody signed.
 */
export async function savePrompt(input: SavePromptInput, conn?: UatConnection): Promise<string> {
  if (!isValidBranchSlug(input.branchSlug)) {
    throw new PromptError(
      `Refusing to store an invalid branch slug: "${input.branchSlug}".`,
      400
    );
  }
  if (!input.allowedPaths.length) {
    throw new PromptError("Refusing to store a prompt with an empty allowlist.", 400);
  }

  const runner = conn ?? db;
  await runner.query(
    `INSERT INTO uat_build_prompt
       (feedback_id, attempt_no, template_version, prompt_text, prompt_sha256,
        allowed_paths_json, forbidden_paths_json, mandatory_tests_json, branch_slug,
        acceptance_criteria_json, rollback_plan, llm_call_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       template_version = VALUES(template_version),
       prompt_text = VALUES(prompt_text),
       prompt_sha256 = VALUES(prompt_sha256),
       allowed_paths_json = VALUES(allowed_paths_json),
       forbidden_paths_json = VALUES(forbidden_paths_json),
       mandatory_tests_json = VALUES(mandatory_tests_json),
       branch_slug = VALUES(branch_slug),
       acceptance_criteria_json = VALUES(acceptance_criteria_json),
       rollback_plan = VALUES(rollback_plan),
       llm_call_id = VALUES(llm_call_id),
       -- A regenerated prompt is unapproved text. Carrying the previous approval across
       -- would attach a reviewer's signature to words they never read.
       approved_by = NULL, approved_at = NULL,
       rejected_by = NULL, rejected_at = NULL, rejection_reason = NULL`,
    [
      input.feedbackId,
      input.attemptNo,
      input.templateVersion,
      input.promptText,
      sha256(input.promptText),
      JSON.stringify(input.allowedPaths),
      JSON.stringify(input.forbiddenPaths),
      JSON.stringify(input.mandatoryTests),
      input.branchSlug,
      JSON.stringify(input.acceptanceCriteria),
      input.rollbackPlan.slice(0, 1000),
      input.llmCallId ?? null,
    ]
  );

  const [rows] = await runner.query<RowDataPacket[]>(
    `SELECT id FROM uat_build_prompt WHERE feedback_id = ? AND attempt_no = ?`,
    [input.feedbackId, input.attemptNo]
  );
  return String(rows[0]?.id ?? "");
}

export async function latestPrompt(
  feedbackId: string,
  conn?: UatConnection
): Promise<PromptRow | null> {
  const runner = conn ?? db;
  const [rows] = await runner.query<PromptRow[]>(
    `SELECT * FROM uat_build_prompt WHERE feedback_id = ?
      ORDER BY attempt_no DESC LIMIT 1`,
    [feedbackId]
  );
  return rows[0] ?? null;
}

/**
 * Approve or reject a prompt.
 *
 * The approver signs a SPECIFIC text: `expectedSha` is compared against what is stored, so
 * approving a prompt that changed between rendering and clicking fails rather than silently
 * approving the new version. This is the same reasoning as re-verifying merge_sha at merge
 * time — a signature must attach to the exact artefact.
 *
 * Segregation of duties: the submitter cannot approve their own item's prompt.
 */
export async function decidePrompt(input: {
  feedbackId: string;
  promptId: string;
  expectedSha: string;
  decision: "approved" | "rejected";
  actorUserId: string;
  reason?: string | null;
}): Promise<void> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [fb] = await conn.execute<RowDataPacket[]>(
      `SELECT submitted_by_user_id FROM uat_feedback WHERE id = ? FOR UPDATE`,
      [input.feedbackId]
    );
    if (!fb.length) throw new PromptError("UAT feedback not found", 404);
    if (fb[0].submitted_by_user_id && fb[0].submitted_by_user_id === input.actorUserId) {
      throw new PromptError(
        "You cannot approve the build prompt for feedback you submitted yourself."
      );
    }

    const [rows] = await conn.execute<PromptRow[]>(
      `SELECT * FROM uat_build_prompt WHERE id = ? AND feedback_id = ? FOR UPDATE`,
      [input.promptId, input.feedbackId]
    );
    if (!rows.length) throw new PromptError("Build prompt not found", 404);
    const row = rows[0];

    if (row.prompt_sha256 !== input.expectedSha) {
      throw new PromptError(
        "This prompt has been regenerated since you opened it. Re-read the current version " +
          "before approving — your approval attaches to an exact text, not to the item."
      );
    }

    if (row.approved_at || row.rejected_at) {
      const already = row.approved_at ? "approved" : "rejected";
      // Idempotent for the same actor and the same decision; a double-click is not tampering.
      const sameActor =
        (row.approved_by ?? row.rejected_by) === input.actorUserId &&
        already === input.decision;
      if (sameActor) {
        await conn.commit();
        return;
      }
      throw new PromptError(`This prompt was already ${already}.`);
    }

    if (input.decision === "approved") {
      await conn.execute(
        `UPDATE uat_build_prompt SET approved_by = ?, approved_at = NOW() WHERE id = ?`,
        [input.actorUserId, input.promptId]
      );
    } else {
      await conn.execute(
        `UPDATE uat_build_prompt
            SET rejected_by = ?, rejected_at = NOW(), rejection_reason = ?
          WHERE id = ?`,
        [input.actorUserId, (input.reason ?? "").slice(0, 1000) || null, input.promptId]
      );
    }

    await recordEvent(
      input.feedbackId,
      "prompt_decided",
      {
        actorUserId: input.actorUserId,
        actorKind: "user",
        message: `Build prompt ${input.decision}${input.reason ? `: ${input.reason}` : ""}`,
        detail: {
          promptId: input.promptId,
          decision: input.decision,
          promptSha256: row.prompt_sha256,
          attemptNo: row.attempt_no,
        },
      },
      conn
    );

    await conn.commit();
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

/** mysql2 returns JSON columns parsed on some driver versions and as text on others. */
export function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}
