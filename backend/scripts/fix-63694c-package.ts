/**
 * Correct employee 63694C's salary records to the active catalog package for band F, CTC 13,250
 * (gross = basic = CTC = net in hand; no bonus, conveyance, PF, ESIC or admin charges).
 *
 *   npx tsx scripts/fix-63694c-package.ts            # dry run (default): prints before/after, writes nothing
 *   npx tsx scripts/fix-63694c-package.ts --apply    # write, one transaction
 *
 * WHY: the offer was made by typing the CTC and pressing Calculate, which re-derived the package with PF/ESIC
 * on and bonus/conveyance on top of an all-basic gross (gross 11,397.85, net 9,944.63). The ATS fix that stops
 * this is in findExactCatalogPackageId; this repairs the one existing employee.
 *
 * Touches exactly three rows for this one candidate: salary_component_assignments (the active row),
 * ats_employment_offer and ats_payroll_hr_validation. Refuses to run unless every record still holds the
 * wrong figures (gross 11,397.85), so re-running is a no-op. Needs exactly one matching catalog package.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db, closePool } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const CODE = "63694C";
const BAND = "F";
const CTC = 13250;
const WRONG_GROSS = 11397.85;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

async function main() {
  const [emp] = (await db.execute<RowDataPacket[]>(`SELECT id FROM employees WHERE employee_code = ? LIMIT 1`, [CODE]))[0] as any[];
  if (!emp) throw new Error(`${CODE} not found`);
  const [bridge] = (await db.execute<RowDataPacket[]>(`SELECT candidate_id FROM ats_onboarding_bridge WHERE employee_id = ? LIMIT 1`, [emp.id]))[0] as any[];
  if (!bridge) throw new Error("no ATS bridge row");
  const candidateId = bridge.candidate_id;

  const [pkgs] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM salary_package_master WHERE band_code = ? AND active_status = 1 AND ABS(package_amount - ?) <= 0.01`, [BAND, CTC]);
  const sig = (r: any) => ["gross", "basic", "hra", "conveyance", "bonus", "special_allowance", "epf_employee", "esic_employee", "epf_employer", "esic_employer", "admin_charges", "net_in_hand"].map((k) => Math.round(n(r[k]) * 100)).join("|");
  const list = pkgs as any[];
  if (!list.length || !list.every((r) => sig(r) === sig(list[0]))) throw new Error(`expected one distinct active band ${BAND} package at CTC ${CTC}, found ${list.length}`);
  const pkg = list[0];
  const other = n(pkg.other_allowance) + n(pkg.lta) + n(pkg.portfolio) + n(pkg.medical) + n(pkg.pli);

  const [scaRows] = await db.execute<RowDataPacket[]>(`SELECT id, gross FROM salary_component_assignments WHERE employee_id = ? AND status = 'active'`, [emp.id]);
  const [offerRows] = await db.execute<RowDataPacket[]>(`SELECT id, gross FROM ats_employment_offer WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`, [candidateId]);
  const [valRows] = await db.execute<RowDataPacket[]>(`SELECT id, gross_salary FROM ats_payroll_hr_validation WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  const sca = (scaRows as any[]); const offer = (offerRows as any[])[0]; const val = (valRows as any[])[0];
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} ${CODE}: package ${pkg.id} gross ${n(pkg.gross)} basic ${n(pkg.basic)} bonus ${n(pkg.bonus)} conv ${n(pkg.conveyance)} pf ${n(pkg.epf_employee)} esic ${n(pkg.esic_employee)} admin ${n(pkg.admin_charges)} net ${n(pkg.net_in_hand)}`);
  console.log(`  current: sca rows ${sca.length} (gross ${sca.map((r) => n(r.gross)).join(",")}), offer gross ${n(offer?.gross)}, validation gross ${n(val?.gross_salary)}`);
  if (sca.length !== 1 || !offer || !val) throw new Error("expected exactly one active package row, one offer and one validation row");
  const stale = [n(sca[0].gross), n(offer.gross), n(val.gross_salary)];
  if (stale.every((g) => Math.abs(g - n(pkg.gross)) < 0.01)) { console.log("already correct, nothing to do"); return; }
  if (!stale.every((g) => Math.abs(g - WRONG_GROSS) < 0.01)) throw new Error(`records do not all hold the expected wrong gross ${WRONG_GROSS}; refusing`);
  if (!APPLY) { console.log("Dry run complete. Re-run with --apply to write."); return; }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE salary_component_assignments
          SET package_id = ?, basic = ?, hra = ?, conveyance = ?, special_allowance = ?, bonus = ?, portfolio = ?, medical_allowance = ?,
              lta = ?, other_allowance = ?, pli = ?, gross = ?, pf_applicable = 0, esi_applicable = 0,
              employer_pf = 0, employer_esi = 0, pf_employee = 0, esic_employee = 0, ctc = ?, net_estimate = ?
        WHERE id = ? AND status = 'active'`,
      [pkg.id, n(pkg.basic), n(pkg.hra), n(pkg.conveyance), n(pkg.special_allowance), n(pkg.bonus), n(pkg.portfolio), n(pkg.medical),
       n(pkg.lta), n(pkg.other_allowance), n(pkg.pli), n(pkg.gross), n(pkg.package_amount), n(pkg.net_in_hand), sca[0].id]);
    await conn.execute(
      `UPDATE ats_employment_offer
          SET basic = ?, hra = ?, conveyance = ?, da = 0, special_allowance = ?, other_allowance = ?, bonus = ?, gross = ?,
              pf_employee = ?, pf_employer = ?, esic_employee = ?, esic_employer = ?, professional_tax = ?, gratuity = 0,
              admin_charges = ?, net_in_hand = ?, offered_ctc = ?
        WHERE id = ?`,
      [n(pkg.basic), n(pkg.hra), n(pkg.conveyance), n(pkg.special_allowance), other, n(pkg.bonus), n(pkg.gross),
       n(pkg.epf_employee), n(pkg.epf_employer), n(pkg.esic_employee), n(pkg.esic_employer), n(pkg.professional_tax),
       n(pkg.admin_charges), n(pkg.net_in_hand), n(pkg.package_amount), offer.id]);
    await conn.execute(
      `UPDATE ats_payroll_hr_validation
          SET gross_salary = ?, basic_salary = ?, hra = ?, conveyance = ?, special_allowance = ?
        WHERE id = ?`,
      [n(pkg.gross), n(pkg.basic), n(pkg.hra), n(pkg.conveyance), n(pkg.special_allowance), val.id]);
    await conn.commit();
    console.log("COMMITTED 3 rows (package row, offer, joining validation)");
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

main().then(() => closePool()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closePool(); } catch { } process.exit(1); });
