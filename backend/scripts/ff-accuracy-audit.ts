/**
 * F&F accuracy audit. STRICTLY READ-ONLY (SELECT / WITH ... SELECT only).
 *
 * Picks one legitimate voluntary exit (resignation) and one involuntary exit (termination) that
 * already have a settlement row, runs the live compute engine (computeFfPreview) on each, and prints
 * every INPUT the engine and an independent hand calculation need, side by side with the stored
 * settlement, so each component can be checked against its source.
 *
 * Output is employee_code and figures only (no names / PII). Takes no write flags.
 *
 *   npx tsx scripts/ff-accuracy-audit.ts            # auto-pick one voluntary + one involuntary
 *   FF_AUDIT_EXIT_IDS=<id>,<id> npx tsx scripts/ff-accuracy-audit.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { computeFfPreview } from "../src/modules/exit/ff-compute.service.js";

type Row = Record<string, unknown>;
function readOnly(sql: string): string {
  const s = sql.trim().toLowerCase();
  if (!(s.startsWith("select") || s.startsWith("with"))) throw new Error(`read-only; refused: ${s.slice(0, 40)}`);
  return sql;
}
const q = async (sql: string, p: unknown[] = []): Promise<Row[]> => {
  const [rows] = await db.execute<RowDataPacket[]>(readOnly(sql), p as never[]);
  return rows as Row[];
};
const j = (o: unknown) => JSON.stringify(o, null, 2);

async function pick(kind: "voluntary" | "involuntary"): Promise<string[]> {
  // exit_type is voluntary / involuntary; the sub-type says resignation / termination / absconding.
  // Prefer the plain cases: a resignation for voluntary, a termination for involuntary.
  const sub = kind === "voluntary" ? "resignation" : "termination";
  const rows = await q(
    `SELECT er.id
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
       JOIN full_final_calculation ff ON ff.exit_request_id = er.id
      WHERE LOWER(er.exit_type) = ?
        AND LOWER(COALESCE(er.exit_sub_type, '')) = ?
        AND e.date_of_joining IS NOT NULL
        AND COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) IS NOT NULL
        AND EXISTS (SELECT 1 FROM employee_salary_assignment esa WHERE esa.employee_id = er.employee_id)
      GROUP BY er.id
      ORDER BY (DATEDIFF(COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed), MIN(e.date_of_joining)) >= 365) DESC,
               MAX(ABS(ff.net_payable)) DESC, MAX(ff.created_at) DESC
      LIMIT 3`,
    [kind, sub],
  );
  return rows.map((r) => String(r.id));
}

async function audit(exitId: string): Promise<void> {
  const [er] = await q(
    `SELECT er.id, er.employee_id, e.employee_code, er.exit_type, er.exit_sub_type, er.status,
            er.submitted_at, er.notice_start_date, er.notice_end_date, er.notice_period_days,
            er.last_working_day_proposed, er.last_working_day_confirmed, er.absconding_since,
            e.date_of_joining, e.employment_status
       FROM exit_request er JOIN employees e ON e.id = er.employee_id WHERE er.id = ?`,
    [exitId],
  );
  if (!er) { console.log(`exit ${exitId}: not found`); return; }
  console.log(`\n================ ${er.employee_code} | ${er.exit_type}/${er.exit_sub_type} | ${er.status} ================`);
  console.log("EXIT", j(er));

  const sal = await q(
    `SELECT esa.ctc_annual, esa.effective_from, esa.active_status, ss.basic_pct, ss.structure_name
       FROM employee_salary_assignment esa LEFT JOIN salary_structure_master ss ON ss.id = esa.structure_id
      WHERE esa.employee_id = ? ORDER BY esa.effective_from DESC LIMIT 4`,
    [er.employee_id],
  );
  console.log("SALARY ASSIGNMENTS", j(sal));

  const stored = await q(
    `SELECT status, is_ff_provisional, notice_period_days, notice_shortfall_days, notice_recovery,
            earned_leave_encashment, gratuity_amount, salary_hold, advances_recovery, net_payable,
            calculation_date
       FROM full_final_calculation WHERE exit_request_id = ? ORDER BY created_at DESC LIMIT 2`,
    [exitId],
  );
  console.log("STORED F&F", j(stored));

  const lines = await q(
    `SELECT spr.run_month, spr.status AS run_status, spl.status, spl.gross_salary, spl.net_salary,
            spl.working_days, spl.present_days, spl.lwp_days, spl.final_payable_days, spl.tds_amount
       FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id = spl.run_id
      WHERE spl.employee_id = ? ORDER BY spr.run_month DESC LIMIT 4`,
    [er.employee_id],
  );
  console.log("LAST PAYROLL LINES", j(lines));

  try {
    const preview = await computeFfPreview(exitId);
    console.log("ENGINE PREVIEW", j(preview));
  } catch (err) {
    console.log("ENGINE PREVIEW FAILED", (err as Error).message);
  }

  // Independent hand calculation from the raw inputs above.
  const ctc = Number(sal[0]?.ctc_annual ?? 0);
  const basicPct = Number(sal[0]?.basic_pct ?? 40);
  const lwd = String(er.last_working_day_confirmed ?? er.last_working_day_proposed ?? "").slice(0, 10);
  const doj = String(er.date_of_joining ?? "").slice(0, 10);
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
  const years = doj && lwd ? days(doj, lwd) / 365.25 : 0;
  const lastBasic = (ctc / 12) * (basicPct / 100);
  console.log("HAND CALC", j({
    gross_monthly: +(ctc / 12).toFixed(2),
    last_basic_monthly: +lastBasic.toFixed(2),
    per_day_26: +(ctc / 12 / 26).toFixed(2),
    service_years_exact: +years.toFixed(3),
    service_years_completed: Math.floor(years),
    gratuity_if_eligible_15_26: +((lastBasic * 15 / 26) * Math.round(years)).toFixed(2),
    served_notice_days_from_submitted: er.submitted_at ? days(String(er.submitted_at).slice(0, 10), lwd) : null,
    served_notice_days_from_notice_start: er.notice_start_date ? days(String(er.notice_start_date).slice(0, 10), lwd) : null,
  }));
}

async function main() {
  const fromEnv = (process.env.FF_AUDIT_EXIT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ids = fromEnv.length ? fromEnv : [...(await pick("voluntary")).slice(0, 1), ...(await pick("involuntary")).slice(0, 1)];
  const mix = await q(
    `SELECT LOWER(er.exit_type) AS exit_type, LOWER(COALESCE(er.exit_sub_type,'')) AS sub_type,
            LOWER(er.status) AS status, COUNT(*) AS n,
            SUM(EXISTS (SELECT 1 FROM full_final_calculation ff WHERE ff.exit_request_id = er.id)) AS with_ff
       FROM exit_request er GROUP BY 1,2,3 ORDER BY n DESC LIMIT 40`,
  );
  console.log("EXIT MIX (type / sub-type / status / count / with F&F row)", j(mix));
  if (!fromEnv.length) {
    console.log("auto-picked exit ids:", ids.join(", ") || "(none found)");
    console.log("more voluntary candidates:", (await pick("voluntary")).join(", "));
    console.log("more involuntary candidates:", (await pick("involuntary")).join(", "));
  }
  for (const id of ids) await audit(id);
  await db.end?.();
}
main().catch((e) => { console.error(e); process.exit(1); });
