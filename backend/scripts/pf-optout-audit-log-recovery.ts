/** READ-ONLY. saveStatutory() never persisted pf_opt_out_elected — but every consent action
 * candidates submitted was logged to candidate_onboarding_submission_log.action_payload as raw
 * JSON. Recovers the real opt-out elections from there, and cross-references against the
 * resolver's disagreement population. */
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { closeBillPool } from "../src/db/billDb.js";
import { resolvePfApplicabilityForPeriod } from "../src/modules/payroll/pf-applicability.service.js";

const runMonth = "2026-07";

async function main() {
  const [logRows] = await db.execute<RowDataPacket[]>(
    `SELECT candidate_id, action_payload, created_at
       FROM candidate_onboarding_submission_log
      WHERE action_type = 'SAVE_PF_OPT_OUT_CONSENT'
      ORDER BY created_at ASC`,
  );
  console.log(`SAVE_PF_OPT_OUT_CONSENT log entries: ${(logRows as any[]).length}`);

  // Last action per candidate wins (they can change their mind before submit).
  const finalElection = new Map<string, boolean>();
  for (const row of logRows as Array<{ candidate_id: string; action_payload: string }>) {
    try {
      const payload = typeof row.action_payload === "string" ? JSON.parse(row.action_payload) : row.action_payload;
      finalElection.set(row.candidate_id, Boolean(payload?.elected));
    } catch { /* skip unparseable */ }
  }
  const optedOutCandidateIds = [...finalElection.entries()].filter(([, v]) => v).map(([id]) => id);
  console.log(`Distinct candidates with a logged action: ${finalElection.size}`);
  console.log(`Of those, elected=true (opted out) as their LAST action: ${optedOutCandidateIds.length}`);

  if (!optedOutCandidateIds.length) {
    console.log("\nNo recoverable opt-out elections in the log either.");
    return;
  }

  // Map candidate_id -> employee_code -> active employee
  const placeholders = optedOutCandidateIds.map(() => "?").join(",");
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT ac.id AS candidate_id, ac.employee_code, e.active_status
       FROM ats_candidate ac
       LEFT JOIN employees e ON e.employee_code = ac.employee_code
      WHERE ac.id IN (${placeholders})`,
    optedOutCandidateIds,
  );
  const linked = empRows as Array<{ candidate_id: string; employee_code: string | null; active_status: number | null }>;
  console.log(`\nOf the ${optedOutCandidateIds.length} opted-out candidates:`);
  console.log(`  linked to an employee_code: ${linked.filter((r) => r.employee_code).length}`);
  console.log(`  that employee is currently active: ${linked.filter((r) => r.active_status === 1).length}`);

  const activeOptedOutCodes = new Set(
    linked.filter((r) => r.active_status === 1 && r.employee_code).map((r) => r.employee_code!.trim().toUpperCase()),
  );

  const resolved = await resolvePfApplicabilityForPeriod(runMonth);
  let matches = 0, resolverSaysApplicable = 0, resolverUnresolved = 0;
  for (const code of activeOptedOutCodes) {
    const status = resolved.get(code)?.status ?? "PF_APPLICABILITY_UNRESOLVED";
    if (status === "PF_NOT_APPLICABLE") matches++;
    else if (status === "PF_APPLICABLE") resolverSaysApplicable++;
    else resolverUnresolved++;
  }
  console.log(`\nCross-check against the resolver (${runMonth}):`);
  console.log(`  resolver agrees (PF_NOT_APPLICABLE): ${matches}`);
  console.log(`  resolver says PF_APPLICABLE anyway: ${resolverSaysApplicable}`);
  console.log(`  resolver UNRESOLVED: ${resolverUnresolved}`);

  console.log(`\nSample of active, really-opted-out employee codes: ${[...activeOptedOutCodes].slice(0, 20).join(", ")}`);
}

main()
  .catch((err) => { console.error("FATAL", err); process.exitCode = 1; })
  .finally(async () => { await db.end().catch(() => {}); await closeBillPool().catch(() => {}); });
