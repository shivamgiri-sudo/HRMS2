/**
 * Reconcile attendance rows whose stored values disagree with what the engine computes.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/attendance-lwp-reconcile.ts --from=2026-06-25 --to=2026-06-25
 *   npx tsx scripts/attendance-lwp-reconcile.ts --from=2026-06-25 --to=2026-06-25 --apply
 *   ... [--employees=MAS50154,MAS61850] [--limit=500]
 *
 * WHY IT EXISTS
 *   A batch on 2026-06-30 18:15–18:20 re-derived attendance_status for 2026-06-23/24/25 but
 *   recomputed lwp_value on only the first two. On 2026-06-25 the LWP kept its pre-update
 *   value of 1.0, so 65 employees marked `present` carry a full day of LWP and 5 `half_day`
 *   rows carry 1.00 where 0.50 is correct — 66 over-charged LWP days, roughly ₹790–1,305 each.
 *   attendance_status and lwp_value come from one derivation and must be written together;
 *   that is the invariant this restores.
 *
 * IT DOES NOT COMPUTE LWP
 *   attendanceEngineService.processEmployee() does. This script compares the engine's result
 *   with what is stored and persists the engine's answer. Encoding LWP rules here would
 *   create a second, rival payroll arithmetic — the thing most worth avoiding in this
 *   codebase.
 *
 * SAFETY
 *   - dry run unless --apply
 *   - refuses any month whose payroll run has moved past PROCESSING/DRAFT, because rewriting
 *     attendance under a FINALIZED / LOCKED / DISBURSED / APPROVED run changes what was paid
 *   - never touches a row with is_locked = 1
 *   - idempotent: a second run finds nothing, because it only reports rows that still differ
 *   - prints before/after for every row it would change
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
};

const APPLY = argv.includes("--apply");
const FROM = arg("from");
const TO = arg("to");
const EMPLOYEES = (arg("employees") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const LIMIT = Number(arg("limit") ?? 2000);

/** Runs past these are closed: rewriting attendance under them changes what was already paid. */
const OPEN_RUN_STATUSES = new Set(["PROCESSING", "DRAFT"]);
const CLOSED_RUN_STATUSES = ["FINALIZED", "DISBURSED", "LOCKED", "APPROVED", "COMPLETED"];

async function monthIsOpen(month: string): Promise<{ open: boolean; status: string }> {
  // Most authoritative run for the month, mirroring run-status.ts's ranking. UPPER() because
  // production stores 'FINALIZED' alongside lowercase 'approved'/'processing'/'draft', and a
  // case-sensitive check would treat FINALIZED as unrecognised and let the write through.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT status FROM salary_prep_run
      WHERE run_month = ?
      ORDER BY CASE UPPER(status)
                 WHEN 'FINALIZED' THEN 1 WHEN 'DISBURSED' THEN 2 WHEN 'LOCKED' THEN 3
                 WHEN 'APPROVED'  THEN 4 WHEN 'COMPLETED' THEN 5 WHEN 'PROCESSING' THEN 6
                 WHEN 'DRAFT'     THEN 7 ELSE 8 END,
               created_at DESC
      LIMIT 1`,
    [month],
  );
  const status = String((rows as Array<{ status?: string }>)[0]?.status ?? "").toUpperCase();
  if (!status) return { open: true, status: "(no run)" };
  return { open: OPEN_RUN_STATUSES.has(status), status };
}

async function main(): Promise<void> {
  if (!FROM || !TO) {
    console.error("--from=YYYY-MM-DD and --to=YYYY-MM-DD are required (a bounded range, deliberately).");
    process.exitCode = 1;
    return;
  }

  console.log(`[reconcile] range ${FROM} .. ${TO}  mode=${APPLY ? "APPLY (writes)" : "DRY RUN"}`);
  if (EMPLOYEES.length) console.log(`[reconcile] employee whitelist: ${EMPLOYEES.join(", ")}`);

  const params: unknown[] = [FROM, TO];
  let empClause = "";
  if (EMPLOYEES.length) {
    empClause = ` AND e.employee_code IN (${EMPLOYEES.map(() => "?").join(", ")})`;
    params.push(...EMPLOYEES);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT adr.employee_id, adr.record_date, adr.attendance_status, adr.lwp_value,
            e.employee_code
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
      WHERE adr.record_date BETWEEN ? AND ?
        AND adr.is_locked = 0${empClause}
      ORDER BY adr.record_date, e.employee_code
      LIMIT ${Number.isFinite(LIMIT) ? LIMIT : 2000}`,
    params,
  );

  const candidates = rows as Array<{
    employee_id: string; record_date: string; attendance_status: string;
    lwp_value: string | number; employee_code: string;
  }>;
  console.log(`[reconcile] ${candidates.length} unlocked row(s) in range\n`);

  // Month gate, resolved once per month rather than per row.
  const monthCache = new Map<string, { open: boolean; status: string }>();
  const { attendanceEngineService } = await import("../src/modules/wfm/attendance-engine.service.js");

  let changed = 0, applied = 0, skippedClosed = 0, failed = 0;
  let lwpBeforeTotal = 0, lwpAfterTotal = 0;

  for (const row of candidates) {
    const date = String(row.record_date).slice(0, 10);
    const month = date.slice(0, 7);
    if (!monthCache.has(month)) monthCache.set(month, await monthIsOpen(month));
    const gate = monthCache.get(month)!;

    let engine;
    try {
      engine = await attendanceEngineService.processEmployee(row.employee_id, date);
    } catch (err) {
      failed++;
      console.error(`  ! ${row.employee_code} ${date}: engine failed — ${err instanceof Error ? err.message : err}`);
      continue;
    }

    const beforeStatus = String(row.attendance_status ?? "");
    const beforeLwp = Number(row.lwp_value ?? 0);
    const afterStatus = String(engine.status ?? "");
    const afterLwp = Number(engine.lwpValue ?? 0);

    if (beforeStatus === afterStatus && Math.abs(beforeLwp - afterLwp) < 0.001) continue;

    changed++;
    lwpBeforeTotal += beforeLwp;
    lwpAfterTotal += afterLwp;
    console.log(
      `  ${row.employee_code.padEnd(12)} ${date}  ` +
      `before[status=${beforeStatus} lwp=${beforeLwp.toFixed(2)}]  ` +
      `after[status=${afterStatus} lwp=${afterLwp.toFixed(2)}]` +
      (gate.open ? "" : `   SKIPPED — run ${gate.status}`),
    );

    if (!gate.open) { skippedClosed++; continue; }

    if (APPLY) {
      await attendanceEngineService.upsertDailyRecord(engine, "attendance-lwp-reconcile");
      applied++;
    }
  }

  console.log(`\n[reconcile] rows differing from the engine : ${changed}`);
  console.log(`[reconcile] LWP total before / after       : ${lwpBeforeTotal.toFixed(2)} / ${lwpAfterTotal.toFixed(2)}`);
  console.log(`[reconcile] blocked by a closed payroll run: ${skippedClosed}`);
  console.log(`[reconcile] engine failures                : ${failed}`);
  console.log(`[reconcile] rows written                   : ${applied}${APPLY ? "" : "  (dry run — pass --apply to write)"}`);
  for (const [m, g] of monthCache) console.log(`[reconcile] run status ${m}: ${g.status}${g.open ? "" : "  (CLOSED — writes refused)"}`);
}

main()
  .catch((err) => {
    const e = err as { name?: string; code?: string; message?: string };
    const parts = [e?.name, e?.code, e?.message].filter((p) => p && String(p).trim());
    console.error(`[reconcile] FATAL ${parts.join(" | ") || String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => { void (db as unknown as { end?: () => Promise<void> }).end?.(); });
