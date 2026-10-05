/**
 * 63388C code clash, PHASE 4 - the ATS candidate and onboarding-bridge rows (created 2026-08-22, Talabhai's own
 * onboarding) still carry code 63388C. Re-code them to 63388C-OLD. dry-run (default) prints the plan; --apply writes.
 * Refuses unless each row is dated on/before 2026-08-23 and the bridge row's employee_id is Talabhai's.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const fail = (m: string) => { throw new Error(`PRECONDITION FAILED: ${m}`); };

async function main() {
  console.log(APPLY ? "MODE: APPLY" : "MODE: DRY-RUN (no writes)");
  const [old] = await q(`SELECT id FROM employees WHERE employee_code = '63388C-OLD'`);
  if (!old) fail("no 63388C-OLD employee");
  const cand = await q(`SELECT id, created_at FROM ats_candidate WHERE employee_code = '63388C'`);
  const bridge = await q(`SELECT id, employee_id, created_at FROM ats_onboarding_bridge WHERE employee_code = '63388C'`);
  console.log(`ats_candidate rows: ${cand.length}, ats_onboarding_bridge rows: ${bridge.length}`);
  if (cand.length > 1 || bridge.length > 1) fail("more than one row each - not guessing");
  for (const r of [...cand, ...bridge]) if (String(r.created_at) > "2026-08-23" && new Date(r.created_at) > new Date("2026-08-23T23:59:59")) fail(`row ${r.id} is dated after 2026-08-23`);
  if (bridge[0] && String(bridge[0].employee_id) !== String(old.id)) fail("bridge row's employee_id is not Talabhai's");
  for (const r of cand) console.log(`PLAN ats_candidate ${r.id}: employee_code 63388C -> 63388C-OLD`);
  for (const r of bridge) console.log(`PLAN ats_onboarding_bridge ${r.id}: employee_code 63388C -> 63388C-OLD`);
  if (!APPLY) { console.log("Dry-run only. Nothing written."); return; }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of cand) {
      const [u] = await conn.execute<any>(`UPDATE ats_candidate SET employee_code = '63388C-OLD' WHERE id = ? AND employee_code = '63388C'`, [r.id]);
      if (u.affectedRows !== 1) throw new Error(`candidate update affected ${u.affectedRows}`);
    }
    for (const r of bridge) {
      const [u] = await conn.execute<any>(`UPDATE ats_onboarding_bridge SET employee_code = '63388C-OLD' WHERE id = ? AND employee_code = '63388C'`, [r.id]);
      if (u.affectedRows !== 1) throw new Error(`bridge update affected ${u.affectedRows}`);
    }
    await conn.commit();
    console.log(`RE-CODED ${cand.length} candidate + ${bridge.length} bridge row(s) to 63388C-OLD`);
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => process.exit(process.exitCode ?? 0));
