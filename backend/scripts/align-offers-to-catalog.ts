/**
 * Offers that were Calculated from a typed CTC when the CTC is exactly one active catalog package.
 *
 *   npx tsx scripts/align-offers-to-catalog.ts            # dry run (default): lists every offer, writes nothing
 *   npx tsx scripts/align-offers-to-catalog.ts --apply    # repairs the SAFE ones, one transaction each
 *
 * WHY: before the 2026-10-04 ATS fix, a typed CTC borrowed only the matching package's basic/HRA split and
 * re-derived the rest with PF/ESIC on (63694C: no-PF package came out with PF, ESIC, admin, bonus, conveyance).
 *
 * An offer is a CANDIDATE when its latest row (status not rejected/cancelled/draft-less) has an exact unique
 * active catalog package (same band, package_amount = offered_ctc, identical components across copies) and
 * its gross, bonus, conveyance, PF/ESIC (employee) or net differ from that package.
 * SAFE to repair (--apply) = a candidate with NO salary_prep_line yet (nothing paid or calculated from the old
 * figures). Repair sets the offer, the joining validation and, if an employee already exists, the single
 * active package row to the catalog package, exactly as fix-63694c-package.ts does.
 * NOT safe (report only) = anything that already has a salary line, and every issued offer letter
 * (ats_offer_letters is a stored snapshot; it is listed so someone can reissue it, never rewritten here).
 * Output: employee_code or candidate id only, no names.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db, closePool } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const SIG = ["gross", "basic", "hra", "conveyance", "bonus", "special_allowance", "epf_employee", "esic_employee", "epf_employer", "esic_employer", "admin_charges", "net_in_hand"];
const sig = (r: any) => SIG.map((k) => Math.round(n(r[k]) * 100)).join("|");

async function main() {
  const [offers] = await db.execute<RowDataPacket[]>(
    `SELECT o.id AS offer_id, o.candidate_id, o.status, o.salary_band, o.offered_ctc, o.gross, o.bonus, o.conveyance,
            o.pf_employee, o.esic_employee, o.admin_charges, o.net_in_hand, o.created_at
       FROM ats_employment_offer o
       JOIN (SELECT candidate_id, MAX(created_at) AS mx FROM ats_employment_offer GROUP BY candidate_id) l
         ON l.candidate_id = o.candidate_id AND l.mx = o.created_at
      WHERE o.salary_band IS NOT NULL AND o.offered_ctc > 0
        AND COALESCE(o.is_proposed_exception, 0) = 0
        AND LOWER(COALESCE(o.status, '')) NOT IN ('rejected', 'cancelled', 'withdrawn')`);
  const [pkgRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM salary_package_master WHERE active_status = 1`);
  const byKey = new Map<string, any[]>();
  for (const p of pkgRows as any[]) {
    const k = `${p.band_code}|${Math.round(n(p.package_amount) * 100)}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(p);
  }

  const cands: any[] = [];
  let scanned = 0, exact = 0;
  for (const o of offers as any[]) {
    scanned++;
    const list = byKey.get(`${o.salary_band}|${Math.round(n(o.offered_ctc) * 100)}`);
    if (!list || !list.every((r) => sig(r) === sig(list[0]))) continue;
    exact++;
    const p = list[0];
    const differs = ["gross", "bonus", "conveyance", "net_in_hand", "admin_charges"].some((k) => Math.abs(n(o[k]) - n(p[k])) > 1)
      || Math.abs(n(o.pf_employee) - n(p.epf_employee)) > 1 || Math.abs(n(o.esic_employee) - n(p.esic_employee)) > 1;
    if (!differs) continue;
    const [br] = await db.execute<RowDataPacket[]>(
      `SELECT b.employee_id, e.employee_code FROM ats_onboarding_bridge b LEFT JOIN employees e ON e.id = b.employee_id WHERE b.candidate_id = ? LIMIT 1`, [o.candidate_id]);
    const empId = (br as any[])[0]?.employee_id ?? null;
    const code = (br as any[])[0]?.employee_code ?? null;
    let lines = 0;
    let scaGross: number | null = null, scaCount = 0;
    if (empId) {
      const [l] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM salary_prep_line WHERE employee_id = ?`, [empId]);
      lines = n((l as any[])[0].c);
      const [s] = await db.execute<RowDataPacket[]>(`SELECT gross FROM salary_component_assignments WHERE employee_id = ? AND status = 'active'`, [empId]);
      scaCount = (s as any[]).length; scaGross = scaCount === 1 ? n((s as any[])[0].gross) : null;
    }
    const [letters] = await db.execute<RowDataPacket[]>(`SELECT status, salary_gross FROM ats_offer_letters WHERE candidate_id = ?`, [o.candidate_id]).catch(() => [[] as RowDataPacket[]] as any);
    cands.push({ o, p, empId, code, lines, scaGross, scaCount, letters: letters as any[], safe: lines === 0 && (!empId || scaCount === 1) });
  }

  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${scanned} latest offers scanned, ${exact} match one catalog package exactly, ${cands.length} differ from it`);
  console.table(cands.map((c) => ({
    who: c.code ?? String(c.o.candidate_id).slice(0, 8), offer_status: c.o.status, band: c.o.salary_band, ctc: n(c.o.offered_ctc),
    offer_gross: n(c.o.gross), pkg_gross: n(c.p.gross), offer_pf: n(c.o.pf_employee), pkg_pf: n(c.p.epf_employee),
    offer_bonus: n(c.o.bonus), offer_conv: n(c.o.conveyance), offer_net: n(c.o.net_in_hand), pkg_net: n(c.p.net_in_hand),
    employee: c.empId ? "yes" : "no", sca_gross: c.scaGross, salary_lines: c.lines,
    letters: c.letters.map((l) => `${l.status}:${n(l.salary_gross)}`).join(" ") || "-", safe_to_repair: c.safe,
  })));
  if (!APPLY) { console.log("Dry run complete. Re-run with --apply to repair the safe_to_repair rows."); return; }

  let done = 0;
  for (const c of cands.filter((x) => x.safe)) {
    const p = c.p;
    const other = n(p.other_allowance) + n(p.lta) + n(p.portfolio) + n(p.medical) + n(p.pli);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `UPDATE ats_employment_offer
            SET basic = ?, hra = ?, conveyance = ?, da = 0, special_allowance = ?, other_allowance = ?, bonus = ?, gross = ?,
                pf_employee = ?, pf_employer = ?, esic_employee = ?, esic_employer = ?, professional_tax = ?, gratuity = 0,
                admin_charges = ?, net_in_hand = ?
          WHERE id = ?`,
        [n(p.basic), n(p.hra), n(p.conveyance), n(p.special_allowance), other, n(p.bonus), n(p.gross),
         n(p.epf_employee), n(p.epf_employer), n(p.esic_employee), n(p.esic_employer), n(p.professional_tax),
         n(p.admin_charges), n(p.net_in_hand), c.o.offer_id]);
      await conn.execute(
        `UPDATE ats_payroll_hr_validation SET gross_salary = ?, basic_salary = ?, hra = ?, conveyance = ?, special_allowance = ? WHERE candidate_id = ?`,
        [n(p.gross), n(p.basic), n(p.hra), n(p.conveyance), n(p.special_allowance), c.o.candidate_id]);
      if (c.empId && c.scaCount === 1) {
        await conn.execute(
          `UPDATE salary_component_assignments
              SET package_id = ?, basic = ?, hra = ?, conveyance = ?, special_allowance = ?, bonus = ?, portfolio = ?, medical_allowance = ?,
                  lta = ?, other_allowance = ?, pli = ?, gross = ?, pf_applicable = ?, esi_applicable = ?,
                  employer_pf = ?, employer_esi = ?, pf_employee = ?, esic_employee = ?, ctc = ?, net_estimate = ?
            WHERE employee_id = ? AND status = 'active'`,
          [p.id, n(p.basic), n(p.hra), n(p.conveyance), n(p.special_allowance), n(p.bonus), n(p.portfolio), n(p.medical),
           n(p.lta), n(p.other_allowance), n(p.pli), n(p.gross), n(p.epf_employee) > 0 ? 1 : 0, n(p.esic_employee) > 0 ? 1 : 0,
           n(p.epf_employer), n(p.esic_employer), n(p.epf_employee), n(p.esic_employee), n(p.package_amount), n(p.net_in_hand), c.empId]);
      }
      await conn.commit();
      done++;
      console.log(`repaired ${c.code ?? c.o.candidate_id}`);
    } catch (e: any) {
      await conn.rollback();
      console.error(`FAILED ${c.code ?? c.o.candidate_id}: ${e?.message ?? e}`);
    } finally {
      conn.release();
    }
  }
  console.log(`COMMITTED ${done} repairs; ${cands.filter((x) => !x.safe).length} left for review`);
}

main().then(() => closePool()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closePool(); } catch { } process.exit(1); });
