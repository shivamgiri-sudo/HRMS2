/**
 * READ-ONLY. Compares the live payroll engine's PF-applicability decision
 * (employee_statutory_override.pf_opt_out — applicable by default, opted out only via an
 * approved declaration) against pf-applicability.service.ts's canonical resolver (db_bill
 * payroll for the period, falling back to employee_statutory_info), for every active employee.
 *
 * Writes nothing. Exists to answer one question before any code changes: how large and what
 * shape is the disagreement, so a decision about repointing the live engine can be made on
 * real numbers instead of a guess.
 *
 * Usage: ./node_modules/.bin/tsx scripts/pf-optout-vs-resolver-comparison.ts [YYYY-MM]
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { closeBillPool } from "../src/db/billDb.js";
import { resolvePfApplicabilityForPeriod } from "../src/modules/payroll/pf-applicability.service.js";

const runMonth = process.argv[2] || "2026-07";

async function main() {
  console.log(`Comparing live PF opt-out logic vs canonical resolver for ${runMonth}\n`);

  // ── Live engine's logic, batched (mirrors payrollCalculate.service.ts's per-employee query
  //    exactly, just run once for every active employee instead of in a loop) ──
  const [activeRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code FROM employees WHERE active_status = 1 AND employee_code IS NOT NULL`,
  );
  const active = activeRows as Array<{ id: string; employee_code: string }>;
  console.log(`Active employees: ${active.length}`);

  const [overrideRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, override_type FROM employee_statutory_override
      WHERE status = 'approved' AND override_type = 'pf_opt_out'
        AND (effective_from_month IS NULL OR effective_from_month <= ?)`,
    [runMonth],
  );
  const optedOutIds = new Set((overrideRows as Array<{ employee_id: string }>).map((r) => r.employee_id));
  console.log(`Approved pf_opt_out overrides effective by ${runMonth}: ${optedOutIds.size}\n`);

  // ── Canonical resolver ──
  const resolved = await resolvePfApplicabilityForPeriod(runMonth);

  // ── Compare ──
  const buckets: Record<string, Array<{ code: string; resolverStatus: string; resolverSource: string }>> = {
    agree_applicable: [],
    agree_optedout_matches_notapplicable: [],
    current_applicable_resolver_notapplicable: [],
    current_applicable_resolver_unresolved: [],
    optedout_resolver_applicable: [],
    optedout_resolver_unresolved: [],
  };

  for (const emp of active) {
    const code = emp.employee_code.trim().toUpperCase();
    const currentOptedOut = optedOutIds.has(emp.id);
    const r = resolved.get(code);
    const rStatus = r?.status ?? "PF_APPLICABILITY_UNRESOLVED";
    const rSource = r?.source ?? "none";

    if (!currentOptedOut) {
      // Live engine treats this employee as PF_APPLICABLE (the default).
      if (rStatus === "PF_APPLICABLE") buckets.agree_applicable.push({ code, resolverStatus: rStatus, resolverSource: rSource });
      else if (rStatus === "PF_NOT_APPLICABLE") buckets.current_applicable_resolver_notapplicable.push({ code, resolverStatus: rStatus, resolverSource: rSource });
      else buckets.current_applicable_resolver_unresolved.push({ code, resolverStatus: rStatus, resolverSource: rSource });
    } else {
      // Live engine treats this employee as opted out (PF_NOT_APPLICABLE equivalent).
      if (rStatus === "PF_NOT_APPLICABLE") buckets.agree_optedout_matches_notapplicable.push({ code, resolverStatus: rStatus, resolverSource: rSource });
      else if (rStatus === "PF_APPLICABLE") buckets.optedout_resolver_applicable.push({ code, resolverStatus: rStatus, resolverSource: rSource });
      else buckets.optedout_resolver_unresolved.push({ code, resolverStatus: rStatus, resolverSource: rSource });
    }
  }

  console.log("═══ RESULTS ═══\n");
  for (const [name, rows] of Object.entries(buckets)) {
    console.log(`${name}: ${rows.length}`);
  }
  console.log();

  const totalDisagree =
    buckets.current_applicable_resolver_notapplicable.length +
    buckets.current_applicable_resolver_unresolved.length +
    buckets.optedout_resolver_applicable.length +
    buckets.optedout_resolver_unresolved.length;
  console.log(`TOTAL DISAGREEMENT: ${totalDisagree} of ${active.length} active employees\n`);

  for (const [name, rows] of Object.entries(buckets)) {
    if (name.startsWith("agree")) continue;
    if (!rows.length) continue;
    console.log(`── ${name} (${rows.length}) — first 15 ──`);
    for (const r of rows.slice(0, 15)) {
      console.log(`  ${r.code}  resolver=${r.resolverStatus} (${r.resolverSource})`);
    }
    console.log();
  }
}

main()
  .catch((err) => { console.error("FATAL", err); process.exitCode = 1; })
  .finally(async () => { await db.end().catch(() => {}); await closeBillPool().catch(() => {}); });
