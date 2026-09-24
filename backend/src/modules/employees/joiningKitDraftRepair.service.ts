/**
 * Repair for joining-kit documents that have a checklist row but no generated file.
 *
 * Why this exists: draft generation at employee creation is fire-and-forget
 * (autoGenerateJoiningDocuments). If that background loop hangs or the process
 * dies part-way, later documents keep a freshly-inserted checklist row and never
 * receive a file, so assembleJoiningKit blocks the kit with `draft_missing` and
 * nothing ever retries. This module regenerates ONLY those file-less documents.
 *
 * It is additive by construction: a document that already has a generated /
 * hr_uploaded file, a signed artefact, or a terminal status is never selected,
 * so a kit that assembles today is untouched.
 *
 * Authorization is the caller's responsibility (the route uses KIT_ROLES; the
 * dispatcher is already behind them).
 */
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { generateChecklistDraft } from "./universalDigitalFormFill.service.js";
import { KIT_DOCUMENT_CODES, TERMINAL_STATUSES } from "./joiningKitAssembly.service.js";

/** One document's draft generation must never be allowed to stall a whole loop. */
export const DRAFT_GENERATION_TIMEOUT_MS = 90_000;

export class DraftGenerationTimeoutError extends Error {
  constructor(checklistId: string, timeoutMs: number) {
    super(`Draft generation timed out after ${Math.round(timeoutMs / 1000)}s (checklist ${checklistId})`);
    this.name = "DraftGenerationTimeoutError";
  }
}

/**
 * generateChecklistDraft with a ceiling on how long the caller waits.
 *
 * LIMITATION: Promise.race only stops WAITING. JavaScript cannot cancel the
 * underlying generation, so after a timeout the abandoned run may still finish
 * later and attach its own generated file. That is benign for the reader (the
 * newest generated file wins; kitEligibleDocuments takes the latest) but it can
 * leave an extra generated file row. If it is genuinely hung on a DB call it
 * simply never finishes. Callers must treat a timeout as "unknown", not "failed
 * cleanly", and never assume nothing was written.
 */
export async function generateDraftWithTimeout(
  checklistId: string,
  actorUserId: string | null,
  timeoutMs: number = DRAFT_GENERATION_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DraftGenerationTimeoutError(checklistId, timeoutMs)), timeoutMs);
  });
  const generation = Promise.resolve().then(() => generateChecklistDraft(checklistId, actorUserId));
  // If the timeout wins, the abandoned generation may reject later. Swallow that
  // here so it cannot surface as an unhandled rejection and crash the process.
  generation.catch(() => undefined);
  try {
    await Promise.race([generation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type KitDraftRepairResult = {
  attempted: number;
  generated: number;
  failed: Array<{ code: string; reason: string }>;
};

const TERMINAL_SQL = TERMINAL_STATUSES.map(() => "?").join(",");
const KIT_CODES_SQL = KIT_DOCUMENT_CODES.map(() => "?").join(",");

/** Kit documents with no file yet — the only rows this module may touch. */
async function fileLessKitChecklistRows(employeeId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.document_code
       FROM employee_joining_document_checklist c
      WHERE c.employee_id = ? AND c.action_type = 'esign'
        AND c.document_code IN (${KIT_CODES_SQL})
        AND NOT EXISTS (
          SELECT 1 FROM employee_joining_document_file f
           WHERE f.checklist_id = c.id AND f.deleted_at IS NULL
             AND f.file_role IN ('generated', 'hr_uploaded')
        )
        AND NOT EXISTS (
          SELECT 1 FROM employee_joining_document_file sf
           WHERE sf.checklist_id = c.id AND sf.deleted_at IS NULL
             AND sf.file_role IN ('signed', 'kit_signed')
        )
        AND COALESCE(c.status, '') NOT IN (${TERMINAL_SQL})
        AND COALESCE(c.fill_status, '') NOT IN (${TERMINAL_SQL})
        -- The contract prints the approved CTC. Generating it before the Payroll
        -- Head approves would bake in the snapshot gross instead, so it is only
        -- repairable once the approval exists (that path generates it itself).
        AND (c.document_code <> 'EMPLOYMENT_CONTRACT' OR EXISTS (
          SELECT 1 FROM employee_payroll_head_review r
           WHERE r.employee_id = c.employee_id AND r.status = 'approved'
        ))
      ORDER BY c.document_code`,
    [employeeId, ...KIT_DOCUMENT_CODES, ...TERMINAL_STATUSES, ...TERMINAL_STATUSES],
  );
  return rows as RowDataPacket[];
}

async function auditRepair(employeeId: string, actorUserId: string | null, result: KitDraftRepairResult) {
  await db.execute(
    `INSERT INTO employee_joining_document_audit_log
       (id, employee_id, checklist_id, document_code, action_type,
        old_value, new_value, remarks, actor_user_id, actor_type)
     VALUES (?, ?, NULL, 'JOINING_KIT', 'KIT_DRAFTS_REGENERATED', NULL, CAST(? AS JSON), ?, ?, ?)`,
    [
      randomUUID(),
      employeeId,
      JSON.stringify(result),
      "Joining kit draft repair",
      actorUserId,
      actorUserId ? "hr" : "system",
    ],
  ).catch((e: unknown) => {
    // An audit failure must not undo a repair that already produced files.
    console.warn("[joining-kit-repair] audit entry not written:", e instanceof Error ? e.message : e);
  });
}

// Two callers (HR click + a dispatch) racing on one employee would each attach a
// file to the same rows. Share the run that is already in flight instead.
const inFlight = new Map<string, Promise<KitDraftRepairResult>>();

async function runRepair(employeeId: string, actorUserId: string | null): Promise<KitDraftRepairResult> {
  const rows = await fileLessKitChecklistRows(employeeId);
  const result: KitDraftRepairResult = { attempted: rows.length, generated: 0, failed: [] };

  // Sequential on purpose: the generator is heavy and the DB pool is shared.
  for (const row of rows) {
    const code = String(row.document_code);
    try {
      await generateDraftWithTimeout(String(row.id), actorUserId);
      result.generated += 1;
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      result.failed.push({ code, reason });
      console.error("[joining-kit-repair] draft regeneration failed:", { employeeId, checklistId: row.id, code, reason });
    }
  }

  if (result.attempted > 0) await auditRepair(employeeId, actorUserId, result);
  return result;
}

/**
 * Regenerate the drafts of this employee's kit documents that have no file.
 * Idempotent: once every kit document has a file, it selects nothing and returns
 * {attempted: 0}.
 */
export function regenerateMissingKitDrafts(
  employeeId: string,
  actorUserId: string | null,
): Promise<KitDraftRepairResult> {
  const running = inFlight.get(employeeId);
  if (running) return running;
  const run = runRepair(employeeId, actorUserId).finally(() => { inFlight.delete(employeeId); });
  inFlight.set(employeeId, run);
  return run;
}
