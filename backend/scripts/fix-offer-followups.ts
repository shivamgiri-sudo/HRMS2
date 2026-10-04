/**
 * Follow-ups to align-offers-to-catalog: employees whose payroll PACKAGE (salary_component_assignments, sca)
 * is missing or wrong although their approved offer is exactly one active catalog package.
 *
 *   npx tsx scripts/fix-offer-followups.ts            # dry run (default), writes nothing
 *   npx tsx scripts/fix-offer-followups.ts --apply    # write, one transaction per employee
 *
 * Cases (each needs: latest offer not rejected, band + offered_ctc = ONE distinct active catalog package, an active
 * employee_salary_assignment whose ctc equals the offer, and NO salary line with pay for the employee):
 *   A  no active sca        -> insert one from the catalog package. Without it the engine has no package and
 *                              falls back to paying CTC as gross.
 *   B  several active sca   -> if exactly one equals the catalog package, mark the others superseded (the engine
 *                              picks the latest effective_date, which was the wrong row for MAS63460).
 *   C  one active sca off the catalog gross -> set it to the catalog package (copied from a mis-calculated offer).
 * Anything else (a sca that differs because of a real increment, an esa ctc that differs from the offer, a line
 * that already paid) is reported and left alone. Re-running is a no-op.
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db, closePool } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const SIG = ["gross", "basic", "hra", "conveyance", "bonus", "special_allowance", "epf_employee", "esic_employee", "epf_employer", "esic_employer", "admin_charges", "net_in_hand"];
const sig = (r: any) => SIG.map((k) => Math.round(n(r[k]) * 100)).join("|");

type Plan = { kind: "A" | "B" | "C"; code: string; empId: string; pkg: any; keepId?: string; supersedeIds?: string[]; scaId?: string; effective: string; note: string };

async function main() {
  const [pkgRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM salary_package_master WHERE active_status = 1`);
  const byKey = new Map<string, any[]>();
  for (const p of pkgRows as any[]) { const k = `${p.band_code}|${Math.round(n(p.package_amount) * 100)}`; (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(p); }

  const [cands] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id, e.employee_code, e.date_of_joining, o.salary_band, o.offered_ctc, o.created_at
       FROM ats_employment_offer o
       JOIN (SELECT candidate_id, MAX(created_at) AS mx FROM ats_employment_offer GROUP BY candidate_id) l
         ON l.candidate_id = o.candidate_id AND l.mx = o.created_at
       JOIN ats_onboarding_bridge b ON b.candidate_id = o.candidate_id
       JOIN employees e ON e.id = b.employee_id AND e.active_status = 1
      WHERE o.salary_band IS NOT NULL AND o.offered_ctc > 0 AND COALESCE(o.is_proposed_exception, 0) = 0
        AND LOWER(COALESCE(o.status, '')) NOT IN ('rejected', 'cancelled', 'withdrawn')`);

  const plans: Plan[] = [];
  const left: string[] = [];
  for (const c of cands as any[]) {
    const list = byKey.get(`${c.salary_band}|${Math.round(n(c.offered_ctc) * 100)}`);
    if (!list || !list.every((r) => sig(r) === sig(list[0]))) continue;
    const pkg = list[0];
    const [sca] = await db.execute<RowDataPacket[]>(`SELECT id, gross, effective_date FROM salary_component_assignments WHERE employee_id = ? AND status = 'active' ORDER BY effective_date DESC`, [c.employee_id]);
    const act = sca as any[];
    const matches = act.filter((r) => Math.abs(n(r.gross) - n(pkg.gross)) <= 1);
    if (act.length === 1 && matches.length === 1) continue; // already right
    const [esa] = await db.execute<RowDataPacket[]>(`SELECT ctc_annual FROM employee_salary_assignment WHERE employee_id = ? AND active_status = 1`, [c.employee_id]);
    const esaOk = (esa as any[]).length >= 1 && (esa as any[]).some((r) => Math.abs(n(r.ctc_annual) / 12 - n(c.offered_ctc)) < 1);
    const [paid] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS k FROM salary_prep_line WHERE employee_id = ? AND net_salary > 0`, [c.employee_id]);
    if (!esaOk || n((paid as any[])[0].k) > 0) { left.push(`${c.employee_code}(${!esaOk ? "esa ctc differs" : "already paid"})`); continue; }
    const doj = c.date_of_joining ? new Date(c.date_of_joining).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    if (act.length === 0) plans.push({ kind: "A", code: c.employee_code, empId: c.employee_id, pkg, effective: doj, note: "no active package row" });
    else if (act.length > 1) {
      if (matches.length === 1) plans.push({ kind: "B", code: c.employee_code, empId: c.employee_id, pkg, keepId: matches[0].id, supersedeIds: act.filter((r) => r.id !== matches[0].id).map((r) => r.id), effective: doj, note: `${act.length} active rows, keeping the catalog one` });
      else left.push(`${c.employee_code}(${act.length} active rows, none or several match)`);
    } else plans.push({ kind: "C", code: c.employee_code, empId: c.employee_id, pkg, scaId: act[0].id, effective: doj, note: `package gross ${n(act[0].gross)} -> ${n(pkg.gross)}` });
  }

  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${plans.length} fixes, ${left.length} left alone`);
  console.table(plans.map((p) => ({ code: p.code, case: p.kind, band: p.pkg.band_code, ctc: n(p.pkg.package_amount), pkg_gross: n(p.pkg.gross), note: p.note })));
  if (left.length) console.log("left alone:", left.join(", "));
  if (!APPLY) { console.log("Dry run complete. Re-run with --apply to write."); return; }

  let done = 0;
  for (const p of plans) {
    const k = p.pkg;
    const cols = [k.id, n(k.basic), n(k.hra), n(k.conveyance), n(k.special_allowance), n(k.bonus), n(k.portfolio), n(k.medical), n(k.lta), n(k.other_allowance), n(k.pli), n(k.gross),
      n(k.epf_employee) > 0 ? 1 : 0, n(k.esic_employee) > 0 ? 1 : 0, n(k.epf_employer), n(k.esic_employer), n(k.epf_employee), n(k.esic_employee), n(k.package_amount), n(k.net_in_hand)];
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      if (p.kind === "A") {
        await conn.execute(
          `INSERT INTO salary_component_assignments
             (id, employee_id, effective_date, package_id, basic, hra, conveyance, special_allowance, bonus, portfolio, medical_allowance, lta, other_allowance, pli,
              gross, pf_applicable, esi_applicable, employer_pf, employer_esi, pf_employee, esic_employee, ctc, net_estimate, assigned_at, approval_reference, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'catalog package of approved offer', 'active')`,
          [randomUUID(), p.empId, p.effective, ...cols]);
      } else if (p.kind === "B") {
        await conn.execute(`UPDATE salary_component_assignments SET status = 'superseded' WHERE id IN (${p.supersedeIds!.map(() => "?").join(",")}) AND status = 'active'`, p.supersedeIds!);
      } else {
        await conn.execute(
          `UPDATE salary_component_assignments
              SET package_id = ?, basic = ?, hra = ?, conveyance = ?, special_allowance = ?, bonus = ?, portfolio = ?, medical_allowance = ?, lta = ?, other_allowance = ?, pli = ?,
                  gross = ?, pf_applicable = ?, esi_applicable = ?, employer_pf = ?, employer_esi = ?, pf_employee = ?, esic_employee = ?, ctc = ?, net_estimate = ?
            WHERE id = ? AND status = 'active'`, [...cols, p.scaId]);
      }
      await conn.commit();
      done++;
      console.log(`fixed ${p.code} (case ${p.kind})`);
    } catch (e: any) {
      await conn.rollback();
      console.error(`FAILED ${p.code}: ${e?.message ?? e}`);
    } finally {
      conn.release();
    }
  }
  console.log(`COMMITTED ${done} fixes`);
}

main().then(() => closePool()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closePool(); } catch { } process.exit(1); });
