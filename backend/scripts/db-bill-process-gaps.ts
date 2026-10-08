/**
 * HRMS employees with no process, and what db_bill's cost centre says about them.
 *
 *   npx tsx scripts/db-bill-process-gaps.ts            # analyse only (default) - writes nothing
 *   npx tsx scripts/db-bill-process-gaps.ts --apply    # fill ONLY blank employees.process_id from an unambiguous cost centre
 *
 * Mapping: db_bill masjclrentry.CostCenter -> HRMS cost_centre_master.cost_centre_code -> cost_centre_master.process_id
 * (active process only). An employee is filled only when their process_id IS NULL and exactly one process results; existing
 * assignments are never overwritten (same rule as the integration call feed). Each fill opens a supervisory period the way
 * that feed does. Aggregates only in the log; no names.
 */
import "dotenv/config";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { db } from "../src/db/mysql.js";
import { recordSupervisoryChange } from "../src/modules/management/manager-attribution.service.js";

const APPLY = process.argv.includes("--apply");
const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

async function main() {
  console.log(APPLY ? "MODE: APPLY (fills blanks only)" : "MODE: analyse (read-only)");
  const [blank] = await db.execute(
    `SELECT e.id, UPPER(TRIM(e.employee_code)) AS code, e.cost_centre_id FROM employees e WHERE e.active_status = 1 AND e.process_id IS NULL`);
  const rows = blank as Array<{ id: string; code: string; cost_centre_id: string | null }>;
  console.log(`active HRMS employees with no process: ${rows.length}`);
  const withHrmsCc = rows.filter((r) => r.cost_centre_id).length;
  console.log(`  ...of which have an HRMS cost_centre_id: ${withHrmsCc}`);

  // db_bill cost centre per employee code
  const billCc = new Map<string, string>();
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400).map((r) => r.code).filter(Boolean);
    if (!chunk.length) continue;
    const found = await billQuery<{ EmpCode: string; CostCenter: string }>(
      `SELECT UPPER(TRIM(EmpCode)) AS EmpCode, CostCenter FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) IN (${chunk.map(() => "?").join(",")}) AND CostCenter IS NOT NULL AND TRIM(CostCenter) <> ''`, chunk);
    for (const f of found) billCc.set(norm(f.EmpCode), String(f.CostCenter).trim());
  }
  console.log(`  ...of which db_bill has a cost centre for: ${billCc.size}`);

  // cost centre code -> process (HRMS)
  const [ccm] = await db.execute(
    `SELECT UPPER(TRIM(c.cost_centre_code)) AS cc, c.process_id, pm.process_code, pm.active_status
       FROM cost_centre_master c JOIN process_master pm ON pm.id = c.process_id WHERE c.process_id IS NOT NULL`);
  const ccToProcs = new Map<string, Array<{ id: string; code: string; active: number }>>();
  for (const r of ccm as Array<{ cc: string; process_id: string; process_code: string; active_status: number }>) {
    const list = ccToProcs.get(r.cc) ?? [];
    if (!list.some((x) => x.id === r.process_id)) list.push({ id: String(r.process_id), code: r.process_code, active: Number(r.active_status) });
    ccToProcs.set(r.cc, list);
  }

  const plan: Array<{ id: string; processId: string; processCode: string }> = [];
  const tally = new Map<string, number>();
  let noBill = 0, noMap = 0, ambiguous = 0, inactiveProc = 0;
  for (const r of rows) {
    const cc = billCc.get(r.code);
    if (!cc) { noBill++; continue; }
    const procs = (ccToProcs.get(norm(cc)) ?? []).filter((p) => p.active === 1);
    if ((ccToProcs.get(norm(cc)) ?? []).length && !procs.length) { inactiveProc++; continue; }
    if (!procs.length) { noMap++; continue; }
    if (procs.length > 1) { ambiguous++; continue; }
    plan.push({ id: r.id, processId: procs[0].id, processCode: procs[0].code });
    tally.set(procs[0].code, (tally.get(procs[0].code) ?? 0) + 1);
  }
  console.log(`not in db_bill / no cost centre: ${noBill} | cost centre has no HRMS process: ${noMap} | ambiguous: ${ambiguous} | maps only to an inactive process: ${inactiveProc}`);
  console.log(`fillable (unambiguous): ${plan.length}`);
  for (const [code, n] of [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`plan | ${code} | ${n}`);

  // How many db_bill cost-centre -> process answers disagree with an EXISTING HRMS assignment (informational only, never changed).
  const [assigned] = await db.execute(`SELECT UPPER(TRIM(e.employee_code)) AS code, e.process_id FROM employees e WHERE e.active_status = 1 AND e.process_id IS NOT NULL LIMIT 20000`);
  const aRows = assigned as Array<{ code: string; process_id: string }>;
  const bill = new Map<string, string>();
  for (let i = 0; i < aRows.length; i += 400) {
    const chunk = aRows.slice(i, i + 400).map((r) => r.code);
    const found = await billQuery<{ EmpCode: string; CostCenter: string }>(
      `SELECT UPPER(TRIM(EmpCode)) AS EmpCode, CostCenter FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) IN (${chunk.map(() => "?").join(",")}) AND CostCenter IS NOT NULL AND TRIM(CostCenter) <> ''`, chunk);
    for (const f of found) bill.set(norm(f.EmpCode), String(f.CostCenter).trim());
  }
  let agree = 0, differ = 0, unknown = 0;
  for (const r of aRows) {
    const cc = bill.get(r.code);
    const procs = cc ? (ccToProcs.get(norm(cc)) ?? []) : [];
    if (!procs.length) { unknown++; continue; }
    if (procs.some((p) => p.id === String(r.process_id))) agree++; else differ++;
  }
  console.log(`assigned employees checked against db_bill cost centre: agree ${agree} | differ ${differ} | cannot compare ${unknown}`);

  if (!APPLY) return;
  let filled = 0, skipped = 0;
  for (const p of plan) {
    const [res] = await db.execute(`UPDATE employees SET process_id = ? WHERE id = ? AND process_id IS NULL`, [p.processId, p.id]);
    if (Number((res as { affectedRows?: number }).affectedRows ?? 0) > 0) {
      filled++;
      await recordSupervisoryChange({ employeeId: p.id, processId: p.processId, changedBy: null, reason: "Process filled from db_bill cost centre (blank only)" }).catch(() => undefined);
    } else skipped++;
  }
  console.log(`APPLIED: filled ${filled}, skipped (assigned meanwhile) ${skipped}`);
}

main().catch((e) => { console.error("failed:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => { await closeBillPool().catch(() => undefined); await (db as unknown as { end?: () => Promise<void> }).end?.(); process.exit(); });
