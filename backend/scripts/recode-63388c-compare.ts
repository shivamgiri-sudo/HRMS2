/**
 * STRICTLY READ-ONLY. (1) Field-by-field compare of HRMS 63388C (Tina) against db_bill masjclrentry; identifiers are
 * compared but only match / mismatch is printed. (2) Every code-text row still keyed 63388C or 63388C-OLD, with its
 * timestamps, to decide whose it is. (3) Talabhai's post-exit attendance and biometric rows by source.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const d10 = (v: unknown) => (v ? (v instanceof Date ? v.toLocaleDateString("en-CA") : String(v).slice(0, 10)) : null);
const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();
const say = async (label: string, f: () => Promise<unknown>) => { try { console.log(`${label}:`, JSON.stringify(await f())); } catch (e) { console.log(`${label}: [failed ${(e as Error).message.slice(0, 90)}]`); } };

async function main() {
  const [h] = await q(`SELECT e.*, (SELECT branch_name FROM branch_master WHERE id=e.branch_id) bn,
      (SELECT dept_name FROM department_master WHERE id=e.department_id) dn,
      (SELECT designation_name FROM designation_master WHERE id=e.designation_id) dg,
      (SELECT cost_centre_name FROM cost_centre_master WHERE id=e.cost_centre_id) cc
      FROM employees e WHERE employee_code = '63388C'`);
  const [b] = await billQuery<RowDataPacket>(`SELECT * FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) = '63388C' LIMIT 1`);
  const rows: Array<[string, unknown, unknown]> = [
    ["name", `${h.first_name} ${h.last_name ?? ""}`, b.EmpName], ["dob", d10(h.date_of_birth), d10(b.DOB)], ["doj", d10(h.date_of_joining), d10(b.DOJ)],
    ["gender", h.gender, b.Gendar], ["mobile", h.mobile, b.Mobile], ["email", h.email, b.EmailId], ["status", h.active_status ? "1" : "0", b.Status],
    ["branch", h.bn, b.BranchName], ["department", h.dn, b.Dept], ["designation", h.dg, b.Desgination], ["cost_centre", h.cc, b.CostCenter],
    ["bank_account", h.bank_account_number, b.AcNo], ["ifsc", h.ifsc_code, b.IFSCCode], ["epf", h.epf_number, b.EPFNo], ["esic", h.esic_number, b.ESICNo],
    ["marital", h.marital_status, b.MaritalStatus], ["blood", h.blood_group, b.BloodGruop], ["address1", h.address_line1, b.Adrress1], ["city", h.city, b.City], ["pincode", h.pincode, b.PinCode],
  ];
  console.log("== HRMS 63388C vs db_bill ==");
  for (const [k, a, c] of rows) console.log(`  ${k}: ${norm(a) === norm(c) ? "same" : `DIFFERENT (hrms=${k.match(/mobile|email|bank|ifsc|epf|esic|address|pincode/) ? "[hidden]" : norm(a)} bill=${k.match(/mobile|email|bank|ifsc|epf|esic|address|pincode/) ? "[hidden]" : norm(c)})`}`);
  console.log("  PAN match:", norm(h.pan_number) === norm(b.PanNo), "| Aadhaar last4 match:", String(h.aadhaar_last4 ?? "") === String(b.AdharId ?? "").replace(/\s/g, "").slice(-4));
  console.log("  qualification present in db_bill:", !!norm(b.Qualification));

  console.log("\n== code-text rows (table: code -> count, earliest, latest) ==");
  const T: Array<[string, string, string]> = [
    ["ats_candidate", "employee_code", "created_at"], ["ats_onboarding_bridge", "employee_code", "created_at"],
    ["attendance_legacy_snapshot", "employee_code", "created_at"], ["attendance_reconciliation_issue", "employee_code", "created_at"],
    ["cosec_user_sync_queue", "employee_code", "created_at"], ["employee_document_promotion_backfill_log", "employee_code", "created_at"],
    ["employee_master_snapshot", "employee_code", "created_at"], ["integration_biometric_daily", "employee_code", "created_at"],
    ["legacy_salary_snapshot", "employee_code", "created_at"], ["master_employee_database", "employee_code", "created_at"],
    ["pnl_running_salary_snapshot", "employee_code", "created_at"],
  ];
  for (const [t, c, ts] of T) for (const code of ["63388C", "63388C-OLD"]) {
    await say(`  ${t} ${code}`, async () => (await q(`SELECT COUNT(*) n, MIN(${ts}) first_at, MAX(${ts}) last_at FROM \`${t}\` WHERE \`${c}\` = ?`, [code]))[0]);
  }
  const [old] = await q(`SELECT id FROM employees WHERE employee_code = '63388C-OLD'`);
  console.log("\n== Talabhai post-exit (after 2026-08-24) ==");
  await say("  wfm_attendance_session", async () => q(`SELECT COUNT(*) n FROM wfm_attendance_session WHERE employee_id = ? AND DATE(created_at) > '2026-08-24'`, [old.id]));
  await say("  biometric_attendance_log", async () => q(`SELECT COUNT(*) n FROM biometric_attendance_log WHERE employee_id = ? AND punch_date > '2026-08-24'`, [old.id]));
  await say("  attendance_daily_record by source", async () => q(`SELECT attendance_status s, attendance_source src, COUNT(*) n FROM attendance_daily_record WHERE employee_id = ? AND record_date > '2026-08-24' GROUP BY s, src`, [old.id]));
  await say("  Tina rows in biometric/wfm", async () => { const [t] = await q(`SELECT id FROM employees WHERE employee_code='63388C'`); return { bio: (await q(`SELECT COUNT(*) n FROM biometric_attendance_log WHERE employee_id = ?`, [t.id]))[0].n, wfm: (await q(`SELECT COUNT(*) n FROM wfm_attendance_session WHERE employee_id = ?`, [t.id]))[0].n }; });
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await closeBillPool().catch(() => {}); process.exit(process.exitCode ?? 0); });
