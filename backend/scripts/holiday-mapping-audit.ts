/**
 * Holiday mapping audit. READ-ONLY.
 *
 * For one holiday date (default 2026-10-02) lists every holiday_master row and, for each
 * employee in its mapped cost centres, whether attendance_engine would grade the day 'holiday'
 * and — if not — which clause of resolveOverridePriority excludes them.
 *
 *   npx tsx scripts/holiday-mapping-audit.ts [YYYY-MM-DD]
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const DATE = process.argv[2] ?? "2026-10-02";

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

(async () => {
  const hols = await q(
    `SELECT lhm.id, lhm.holiday_name, DATE_FORMAT(lhm.holiday_date,'%Y-%m-%d') d, lhm.holiday_type,
            lhm.branch_id, bm.branch_name, lhm.active_status
       FROM leave_holiday_master lhm LEFT JOIN branch_master bm ON bm.id = lhm.branch_id
      WHERE lhm.holiday_date = ?`, [DATE]);
  console.log(`\n== holiday_master rows on ${DATE} ==`);
  console.table(hols);

  for (const h of hols as any[]) {
    const cc = await q(
      `SELECT m.id map_id, m.cost_centre_id, m.branch_id map_branch, m.is_active,
              ccm.cost_centre_code, ccm.cost_centre_name, ccm.branch_id cc_branch, ccm.active_status cc_status
         FROM holiday_cost_centre_mapping m
         LEFT JOIN cost_centre_master ccm ON ccm.id = m.cost_centre_id
        WHERE m.holiday_id = ?`, [h.id]);
    const des = await q(
      `SELECT designation_id FROM holiday_designation_mapping WHERE holiday_id = ?`, [h.id]);
    console.log(`\n== ${h.holiday_name} (${h.id}) branch=${h.branch_name ?? "ALL"} active=${h.active_status} ==`);
    console.log(`cost-centre mappings: ${cc.length}, designation mappings: ${des.length}`);
    console.table(cc);

    const ccIds = (cc as any[]).map((r) => r.cost_centre_id).filter(Boolean);
    if (ccIds.length === 0) continue;
    const ph = ccIds.map(() => "?").join(",");
    const desIds = new Set((des as any[]).map((r) => r.designation_id));

    const emps = await q(
      `SELECT e.id, e.employee_code, e.employment_status status, e.active_status e_active, e.branch_id, bm.branch_name, e.cost_centre_id,
              e.designation_id, DATE_FORMAT(e.date_of_joining,'%Y-%m-%d') doj,
              adr.attendance_status att, adr.is_locked, adr.attendance_source src,
              (SELECT COUNT(*) FROM leave_request lr WHERE lr.employee_id = e.id AND lr.status='approved'
                  AND ? BETWEEN lr.from_date AND lr.to_date) leave_n
         FROM employees e
         LEFT JOIN branch_master bm ON bm.id = e.branch_id
         LEFT JOIN attendance_daily_record adr ON adr.employee_id = e.id AND adr.record_date = ?
        WHERE e.cost_centre_id IN (${ccIds.map(() => "?").join(",")})`, [DATE, DATE, ...ccIds]);

    const reasons = new Map<string, number>();
    const bad: any[] = [];
    for (const e of emps as any[]) {
      let why = "";
      if (e.leave_n > 0) why = "approved leave wins";
      else if (h.branch_id && e.branch_id !== h.branch_id) why = `branch mismatch (emp=${e.branch_name})`;
      else if (e.doj && e.doj > DATE) why = "DOJ after holiday";
      else if (desIds.size && !desIds.has(e.designation_id)) why = "designation not mapped";
      if (!why && e.att !== "holiday") why = `eligible but att=${e.att ?? "NO ROW"} (engine not re-run / locked=${e.is_locked})`;
      const key = `${e.status} | ${why || "OK holiday"}`;
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
      if (why) bad.push({ code: e.employee_code, status: e.status, why, att: e.att, locked: e.is_locked, src: e.src });
    }
    console.log(`\nemployees in mapped CCs: ${(emps as any[]).length}`);
    console.table([...reasons].map(([k, n]) => ({ outcome: k, n })));
    console.log("first 60 excluded:");
    console.table(bad.slice(0, 60));

    // Employees whose cost_centre_id is NOT mapped but who share the CC's code/name (duplicate CC rows).
    const dup = await q(
      `SELECT ccm.id, ccm.cost_centre_code, ccm.cost_centre_name, ccm.active_status,
              (SELECT COUNT(*) FROM employees e WHERE e.cost_centre_id = ccm.id) emps
         FROM cost_centre_master ccm
        WHERE ccm.id NOT IN (${ph})
          AND (ccm.cost_centre_code IN (SELECT cost_centre_code FROM cost_centre_master WHERE id IN (${ph}))
            OR ccm.cost_centre_name IN (SELECT cost_centre_name FROM cost_centre_master WHERE id IN (${ph})))`,
      [...ccIds, ...ccIds, ...ccIds]);
    console.log("\nsame code/name cost centres NOT in mapping:");
    console.table(dup);
  }
  await db.end();
})().catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end(); } catch { } process.exit(1); });
