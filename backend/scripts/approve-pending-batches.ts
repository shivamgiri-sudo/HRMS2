/**
 * Clear the pending bulk-upload approval queue, as the approving user.
 *
 * WHAT THIS IS NOT. It is not a way around the approval gate. It calls assertCanApprove() for
 * every stage exactly as the route does, so a user without the authority for a stage is refused
 * here for the same reason and with the same message they would get in the UI. The gate is
 * enforced, not skipped — this only removes the browser from the loop.
 *
 * WHY IT EXISTS. performDecision() is route-local, so a batch can normally only be decided by a
 * live HTTP request. That is fine until the queue is large and the operator wants it cleared in
 * one go. Everything below mirrors performDecision() step for step, using the same exported
 * primitives (resolveStage, stageOutcome, claimForDecision, apply*Batch, verifyRowsActuallyApplied,
 * markDecided, markStageDecided, auditBatchAction) so the two cannot drift in behaviour.
 *
 * TWO-STAGE TYPES. Incentive and deduction batches need Branch Head then Payroll Head. Stage 1
 * deliberately applies NOTHING — it only moves the batch to the next queue — because applying at
 * stage 1 would move the money before the Payroll Head ever saw it. The loop below re-resolves
 * the stage after each decision and runs the next one, so a batch is carried to a terminal state
 * rather than left half-approved.
 *
 * Dry-run by default: prints what each batch would do, and which stages the user may decide.
 * Set APPLY=1 to decide them.
 *
 * Run: ./node_modules/.bin/tsx scripts/approve-pending-batches.ts
 *      APPLY=1 ./node_modules/.bin/tsx scripts/approve-pending-batches.ts
 *      BATCH_NO=BATCH-123 APPLY=1 ./node_modules/.bin/tsx scripts/approve-pending-batches.ts
 */
import "dotenv/config";

const APPLY = process.env.APPLY === "1";
const ONLY_BATCH = process.env.BATCH_NO ?? null;
const ACTOR_EMAIL = process.env.ACTOR_EMAIL ?? "shivam.giri@teammas.in";
const REMARKS = process.env.REMARKS ?? "Bulk queue cleared by Payroll Head after August attendance recovery.";
/** A batch needs at most branch -> payroll; the cap stops a mis-resolving stage looping forever. */
const MAX_STAGES = 4;

async function main() {
  const { db } = await import("../src/db/mysql.js");
  const svc = await import("../src/modules/bulk-upload/bulk-approval.service.js");
  const { applyRegularizationBatch } = await import("../src/modules/bulk-upload/attendance-regularization-bulk.service.js");
  const { applyLeaveBatch } = await import("../src/modules/bulk-upload/leave-application-bulk.service.js");
  const { applyIncentiveBatch } = await import("../src/modules/bulk-upload/incentive-bulk.service.js");
  const { applyDeductionBatch } = await import("../src/modules/bulk-upload/deduction-bulk.service.js");

  const ENTITY_TYPE_BY_UPLOAD_TYPE: Record<string, string> = {
    ATTENDANCE_REGULARIZATION_BULK: "attendance_regularization",
    LEAVE_APPLICATION_BULK: "leave_request",
    INCENTIVE_BULK: "incentive_upload_line",
    DEDUCTION_BULK: "employee_deduction_entries",
  };
  const APPLIERS: Record<string, (b: any, u: string, r: string | null) => Promise<any>> = {
    ATTENDANCE_REGULARIZATION_BULK: applyRegularizationBatch,
    LEAVE_APPLICATION_BULK: applyLeaveBatch,
    INCENTIVE_BULK: applyIncentiveBatch,
    DEDUCTION_BULK: applyDeductionBatch,
  };

  const [users]: any = await db.query(`SELECT id FROM auth_user WHERE email = ? LIMIT 1`, [ACTOR_EMAIL]);
  if (!users.length) throw new Error(`No auth_user for ${ACTOR_EMAIL}`);
  const userId = String(users[0].id);
  console.log(`acting as ${ACTOR_EMAIL} (${userId})\n`);

  const [batches]: any = await db.query(
    `SELECT id, upload_batch_no FROM upload_batch
      WHERE batch_status = 'pending_approval' ${ONLY_BATCH ? "AND upload_batch_no = ?" : ""}
      ORDER BY created_at ASC`,
    ONLY_BATCH ? [ONLY_BATCH] : [],
  );
  if (!batches.length) { console.log("Nothing pending approval."); await (db as any).end?.(); return; }

  for (const row of batches) {
    const batchId = String(row.id);
    console.log(`─── ${String(row.upload_batch_no)} ───`);

    for (let i = 0; i < MAX_STAGES; i++) {
      const batch: any = await svc.getBatch(batchId);
      const stage = svc.resolveStage(batch);
      if (!stage) {
        console.log(`  done — status='${batch.batch_status}' approval='${batch.approval_status ?? "-"}'\n`);
        break;
      }
      const rule = (svc.STAGE_RULES as any)[stage];
      const { next, applies } = svc.stageOutcome(stage, batch.upload_type_code);
      console.log(`  stage '${stage}' (${rule.label}) -> ${next}; applies rows: ${applies}`);

      // The authority gate, exactly as the route runs it.
      try {
        await svc.assertCanApprove(userId, batch, stage);
      } catch (e: any) {
        console.log(`  REFUSED: ${e?.message ?? String(e)}`);
        console.log(`  (this user may not decide the '${stage}' stage — same answer the UI gives)\n`);
        break;
      }

      if (!APPLY) {
        console.log(`  DRY RUN — would approve this stage.\n`);
        break;
      }

      if (!(await svc.claimForDecision(batch.id, rule.from))) {
        console.log(`  SKIPPED: already being decided by someone else.\n`);
        break;
      }

      try {
        if (!applies) {
          // Stage 1: hand on, apply nothing. Applying here would move money before the
          // Payroll Head ever saw the batch.
          const summary =
            `Approved by ${rule.label}; awaiting ${(svc.STAGE_RULES as any).payroll.label} final approval. ` +
            `${batch.imported_rows ?? batch.total_rows ?? 0} row(s) held.`;
          const moved = await svc.markStageDecided({
            batchId: batch.id, stage, next, expectedFrom: rule.from,
            batchStatus: "pending_approval", userId, remarks: REMARKS, summary,
          });
          if (!moved) { console.log("  SKIPPED: batch moved on mid-decision.\n"); break; }
          await svc.auditBatchAction({
            userId, actionType: "BULK_UPLOAD_BRANCH_APPROVED", batch,
            reason: REMARKS, detail: { stage, next_status: next, applied: 0, via: "approve-pending-batches" },
          });
          console.log(`  handed to ${(svc.STAGE_RULES as any).payroll.label}.`);
          continue; // resolve the next stage
        }

        const applier = APPLIERS[batch.upload_type_code];
        if (!applier) { console.log(`  NO APPLY HANDLER for ${batch.upload_type_code}\n`); break; }

        console.log(`  applying ${batch.imported_rows ?? batch.total_rows} row(s) — this can take minutes …`);
        let outcome: any = await applier(batch, userId, REMARKS);

        // apply*Batch does not write upload_batch_row on success, so a crashed concurrency
        // group would otherwise be reported applied with nothing changed. Same re-check the
        // route does before telling anyone it worked.
        const entityType = ENTITY_TYPE_BY_UPLOAD_TYPE[batch.upload_type_code];
        if (entityType) {
          const verified = await svc.verifyRowsActuallyApplied(batch.id, entityType);
          if (verified.mismatched > 0) {
            outcome = {
              ...outcome,
              applied: Math.max(0, outcome.applied - verified.mismatched),
              failed: outcome.failed + verified.mismatched,
              errors: [...outcome.errors, `${verified.mismatched} row(s) never actually finished approval.`],
            };
          }
        }

        const finalStatus = outcome.failed > 0 ? "partially_applied" : "approved";
        const summary =
          `${outcome.applied} row(s) applied, ${outcome.failed} failed.` +
          (outcome.errors.length ? ` First error: ${outcome.errors[0]}` : "");

        await svc.markDecided(batch.id, finalStatus as any, userId, REMARKS, summary,
          { applied: outcome.applied, failed: outcome.failed });
        await svc.markStageDecided({
          batchId: batch.id, stage, next: finalStatus as any, expectedFrom: finalStatus as any,
          batchStatus: "imported", userId, remarks: REMARKS, summary,
        }).catch(() => { /* markDecided already wrote the authoritative status */ });
        await svc.auditBatchAction({
          userId, actionType: "BULK_UPLOAD_APPROVED", batch, reason: REMARKS,
          detail: { stage, applied: outcome.applied, failed: outcome.failed, final_status: finalStatus,
                    via: "approve-pending-batches" },
        });

        console.log(`  ${finalStatus}: applied=${outcome.applied} failed=${outcome.failed}`);
        if (outcome.errors.length) {
          console.log(`  first errors:`);
          for (const e of outcome.errors.slice(0, 3)) console.log(`    - ${e}`);
        }
      } catch (e: any) {
        // Put it back in the queue rather than leaving it stuck in 'approving' — the same
        // reason the route passes a release callback to startBatchJob.
        await svc.releaseClaim(batch.id).catch(() => {});
        console.log(`  FAILED: ${e?.message ?? String(e)} (claim released, batch back in queue)`);
        break;
      }
    }
  }

  await (db as any).end?.();
}

main().catch((e) => {
  console.error("ERR", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
