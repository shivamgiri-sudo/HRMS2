/**
 * Bring salary increments that exist ONLY in db_bill into HRMS salary packages.
 *
 * WHY
 *   For August 2026, 34 employees have a higher salary package in db_bill than HRMS holds
 *   (₹1,30,600 a month in total). For every one of them HRMS's July package equals db_bill's July
 *   package, so the raise happened in August and was entered in db_bill only. 28 of the 34 have no
 *   matching row in salary_package_master, so the Salary Change Center (which assigns an existing
 *   package) cannot enter them; this writes the assignment straight from db_bill's own components.
 *
 * WHAT IT DOES (--apply)
 *   1. For each employee whose db_bill package gross is higher than the active HRMS assignment AND
 *      either whose db_bill PREVIOUS month equals the HRMS package (a genuine new raise) or who is a
 *      joiner whose approved offer CTC agrees with db_bill's within 3% (HRMS then holds a stale
 *      automatic band package, e.g. MAS63422: offer 25,500 CTC, HRMS 16,588, db_bill 25,000): marks the active assignment 'superseded' and inserts a new 'active' one effective
 *      the given date, with every component copied from db_bill (basic, hra, conveyance, bonus,
 *      portfolio, medical, lta, other, special) and PF / ESI flags from db_bill's PFELig / ESIElig.
 *      Writes employee_salary_change_log exactly as the Salary Change Center does.
 *      Components must add up to the gross, or that employee is skipped and reported.
 *   2. Repairs assignments whose components fall short of their gross because the Salary Change
 *      Center dropped the package's bonus (MAS63489: 23,500 gross, components 22,459): sets bonus
 *      from the package only when it equals the shortfall.
 *   Employer PF/ESI, employee PF/ESIC and net estimate are informational (payroll reads the
 *   components and gross) and are scaled from the previous assignment.
 *
 * SAFETY
 *   Dry run by default (reads only). --apply uses ONE transaction and re-checks every written
 *   assignment (components == gross) before committing. Re-running is a no-op: an employee whose
 *   active assignment already equals db_bill is skipped. Never lowers a salary.
 *
 *   needs db_bill access (BILL_DB_HOST / PORT / USER / PASSWORD / NAME), from backend/:
 *     npx tsx scripts/apply-dbbill-increments.ts                       # dry run, Aug 2026
 *     npx tsx scripts/apply-dbbill-increments.ts --apply               # write
 *     npx tsx scripts/apply-dbbill-increments.ts --month=2026-08 --effective=2026-08-01 --apply
 *     npx tsx scripts/apply-dbbill-increments.ts --skip=MAS60358       # leave an employee for someone else
 *
 *   Whoever runs this should not be an employee on the list: change their own row with --skip and
 *   have the Payroll Head enter it.
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery } from "../src/db/billDb.js";

const APPLY = process.argv.includes("--apply");
const arg = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const MONTH = arg("month", "2026-08");
const SKIP = new Set(arg("skip", "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean));
const EFFECTIVE = arg("effective", `${MONTH}-01`);
const [y, m] = MONTH.split("-").map(Number);
const PREV = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;
const yn = (v: unknown) => String(v ?? "").trim().toUpperCase();
const key = (c: unknown) => String(c ?? "").trim().toUpperCase();

const COMP: Array<[string, string]> = [
  ["basic", "Basic"], ["hra", "HRA"], ["conveyance", "Conv"], ["bonus", "Bonus"], ["portfolio", "Portfolio"],
  ["medical_allowance", "MedicalAllowance"], ["lta", "LTA"], ["other_allowance", "OtherAllowance"], ["special_allowance", "SpecialAllowance"],
];
const sumComp = (get: (col: string) => number) => COMP.reduce((s, [a]) => s + get(a), 0);

async function main() {
  const [act] = await db.execute<RowDataPacket[]>(
    `SELECT a.*, UPPER(TRIM(e.employee_code)) AS code, e.full_name
       FROM salary_component_assignments a JOIN employees e ON e.id = a.employee_id
      WHERE a.status = 'active' AND e.active_status = 1`,
  );
  const A = new Map<string, any>((act as any[]).map((a) => [a.code, a]));

  const sel = (mon: string) => billQuery(
    `SELECT EmpCode, Basic, HRA, Conv, Bonus, Portfolio, MedicalAllowance, LTA, SpecialAllowance, OtherAllowance, Gross, CurrentCTC, PFELig, ESIElig
       FROM salary_data WHERE DATE_FORMAT(SalDate, '%Y-%m') = ?`, [mon]) as Promise<any[]>;
  const [bill, prev] = await Promise.all([sel(MONTH), sel(PREV)]);
  const P = new Map(prev.map((r) => [key(r.EmpCode), r]));

  // Approved offers, keyed by employee code, for joiners that have no previous db_bill month.
  const [offerRows] = await db.execute<RowDataPacket[]>(
    `SELECT UPPER(TRIM(c.employee_code)) AS code, o.offered_ctc, o.gross, o.status
       FROM ats_candidate c JOIN ats_employment_offer o ON o.candidate_id = c.id
      WHERE c.employee_code IS NOT NULL AND o.status IN ('approved','bh_approved','accepted','issued')
      ORDER BY o.created_at`);
  const OFFER = new Map<string, any>();
  for (const o of offerRows as any[]) OFFER.set(o.code, o); // latest wins

  type Plan = { a: any; b: any; newPf: number; newEsi: number; effective: string; basis: string };
  const plans: Plan[] = [];
  const skipped: Array<{ code: string; why: string }> = [];
  for (const b of bill) {
    const code = key(b.EmpCode);
    const a = A.get(code);
    const bg = num(b.Gross);
    if (!a || bg <= 0) continue;
    if (bg - num(a.gross) <= 1) continue; // equal, or HRMS higher: never lowered
    if (SKIP.has(code)) { skipped.push({ code, why: "left out with --skip" }); continue; }
    const p = P.get(code);
    let basis = `raise: db_bill ${PREV} equals HRMS (${num(a.gross)})`;
    let effective = EFFECTIVE;
    if (!p) {
      // A joiner: no previous month to prove a raise. Accept only when the approved offer agrees with
      // db_bill's CTC (within 3%) - then HRMS's own package is the stale one - and keep the
      // assignment's original effective date.
      const o = OFFER.get(code);
      const billCtc = num(b.CurrentCTC);
      if (!o || !(billCtc > 0) || Math.abs(num(o.offered_ctc) - billCtc) / billCtc > 0.03) {
        skipped.push({ code, why: `no ${PREV} db_bill row and no approved offer matching db_bill CTC ${billCtc} (offer ${o ? num(o.offered_ctc) : "none"}); db_bill ${bg}, HRMS ${num(a.gross)}` });
        continue;
      }
      basis = `joiner: approved offer CTC ${num(o.offered_ctc)} matches db_bill CTC ${billCtc}; HRMS package was ${num(a.gross)}`;
      effective = String(a.effective_date instanceof Date ? a.effective_date.toISOString().slice(0, 10) : a.effective_date).slice(0, 10);
    } else if (Math.abs(num(p.Gross) - num(a.gross)) > 1) {
      skipped.push({ code, why: `HRMS ${num(a.gross)} does not equal db_bill ${PREV} ${num(p.Gross)}: a mismatch, not a new raise` }); continue;
    }
    const comps = sumComp((c) => num(b[COMP.find(([k]) => k === c)![1]]));
    if (Math.abs(comps - bg) > 1) { skipped.push({ code, why: `db_bill components ${comps} do not add up to its gross ${bg}` }); continue; }
    plans.push({ a, b, newPf: yn(b.PFELig) === "YES" ? 1 : 0, newEsi: yn(b.ESIElig) === "YES" ? 1 : 0, effective, basis });
  }

  // components short of gross because a flow dropped the package bonus
  const repairs: Array<{ id: string; code: string; gap: number; bonus: number }> = [];
  const unresolved: Array<{ code: string; gap: number }> = [];
  const planIds = new Set(plans.map((p) => p.a.id));
  for (const a of act as any[]) {
    if (planIds.has(a.id)) continue;
    const gap = num(a.gross) - sumComp((c) => num(a[c]));
    if (gap <= 1) continue;
    const [pk] = await db.execute<RowDataPacket[]>(`SELECT bonus FROM salary_package_master WHERE id = ?`, [a.package_id]);
    const pb = num((pk as any[])[0]?.bonus);
    if (num(a.bonus) === 0 && Math.abs(pb - gap) <= 1) repairs.push({ id: a.id, code: a.code, gap: r2(gap), bonus: pb });
    else unresolved.push({ code: a.code, gap: r2(gap) });
  }

  console.log(`\n=== ${APPLY ? "APPLY" : "DRY RUN (nothing is written)"}: db_bill ${MONTH} increments, effective ${EFFECTIVE} ===`);
  console.log(`Increments to enter: ${plans.length}, +₹${plans.reduce((s, p) => s + num(p.b.Gross) - num(p.a.gross), 0).toLocaleString("en-IN")} a month`);
  console.table(plans.slice(0, 40).map((p) => ({ code: p.a.code, name: p.a.full_name, hrmsGross: num(p.a.gross), billGross: num(p.b.Gross), basic: `${num(p.a.basic)}→${num(p.b.Basic)}`, from: String(p.effective), basis: p.basis.slice(0, 60) })));
  if (skipped.length) { console.log("SKIPPED (needs a person):"); console.table(skipped); }
  console.log(`Bonus repairs: ${repairs.length}`); if (repairs.length) console.table(repairs);
  if (unresolved.length) { console.log("Components short of gross, no matching package bonus (report only):"); console.table(unresolved); }
  if (!APPLY) { console.log("\nDry run complete. Re-run with --apply to write."); return; }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const touched: string[] = [];
    for (const { a, b, newPf, newEsi, effective } of plans) {
      const id = randomUUID();
      const bRatio = num(a.basic) > 0 ? num(b.Basic) / num(a.basic) : 1;
      const gRatio = num(a.gross) > 0 ? num(b.Gross) / num(a.gross) : 1;
      const newCtc = num(b.CurrentCTC) || num(a.ctc) * gRatio;
      const net = r2(num(a.net_estimate) + (num(b.Gross) - num(a.gross)));
      await conn.execute(`UPDATE salary_component_assignments SET status = 'superseded' WHERE id = ? AND status = 'active'`, [a.id]);
      await conn.execute(
        `INSERT INTO salary_component_assignments
           (id, employee_id, effective_date, package_id, basic, hra, conveyance, special_allowance, bonus, portfolio,
            medical_allowance, lta, other_allowance, pli, gross, pf_applicable, esi_applicable, employer_pf, employer_esi,
            pf_employee, esic_employee, ctc, net_estimate, assigned_by, assigned_at, approval_reference, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, 'active')`,
        [id, a.employee_id, effective, a.package_id, num(b.Basic), num(b.HRA), num(b.Conv), num(b.SpecialAllowance), num(b.Bonus),
         num(b.Portfolio), num(b.MedicalAllowance), num(b.LTA), num(b.OtherAllowance), num(b.Gross), newPf, newEsi,
         r2(num(a.employer_pf) * bRatio), r2(num(a.employer_esi) * gRatio), r2(num(a.pf_employee) * bRatio), r2(num(a.esic_employee) * gRatio),
         newCtc, net, a.assigned_by, `db_bill increment ${MONTH}`]);
      await conn.execute(
        `INSERT INTO employee_salary_change_log
           (id, employee_id, old_salary_component_assignment_id, new_salary_component_assignment_id,
            requested_by_user_id, requested_by_name, actor_user_id, reason, old_ctc, new_ctc, effective_date)
         VALUES (UUID(), ?, ?, ?, NULL, 'db_bill increment sync', ?, ?, ?, ?, ?)`,
        [a.employee_id, a.id, id, a.assigned_by, `Increment entered in db_bill for ${MONTH}, not yet in HRMS (apply-dbbill-increments)`, num(a.ctc), newCtc, effective]);
      touched.push(id);
    }
    for (const r of repairs) {
      await conn.execute(`UPDATE salary_component_assignments SET bonus = ? WHERE id = ? AND bonus = 0 AND status = 'active'`, [r.bonus, r.id]);
      touched.push(r.id);
    }
    if (touched.length) {
      const [chk] = await conn.execute<RowDataPacket[]>(
        `SELECT id, gross, basic + hra + conveyance + bonus + portfolio + medical_allowance + lta + other_allowance + special_allowance AS comp
           FROM salary_component_assignments WHERE id IN (${touched.map(() => "?").join(",")})`, touched);
      const bad = (chk as any[]).filter((r) => Math.abs(num(r.gross) - num(r.comp)) > 1);
      if (bad.length) throw new Error(`components do not add up to gross for ${bad.length} written assignment(s)`);
    }
    await conn.commit();
    console.log(`\nCOMMITTED: ${plans.length} increments entered, ${repairs.length} bonus repairs.`);
  } catch (e) {
    await conn.rollback();
    console.error("ROLLED BACK:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    conn.release();
  }
}

main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
