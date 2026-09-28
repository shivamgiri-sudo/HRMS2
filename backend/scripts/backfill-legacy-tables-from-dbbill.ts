/**
 * One-time backfill: copies the db_bill-derived fields this report relies on OUT of db_bill
 * and INTO mas_hrms's own dedicated tables — employee_legacy_meta, employee_nominee,
 * employee_education, employee_experience, employee_client_mapping, employee_salary_snapshot,
 * and employees.alternate_mobile.
 *
 * Purpose: once this has run, employeeMasterLive()'s own SQL (which already prefers these
 * mas_hrms tables first, falling to db_bill only when they're blank) finds real data in them
 * and never needs to fall through to db_bill at all — mas_hrms becomes self-sufficient for
 * this report, now and for every future refresh, without deleting or disabling the db_bill
 * fallback code (kept as a safety net for any employee this backfill still misses).
 *
 * Idempotent: every write is INSERT (for tables with an employee_id unique key) with
 * `ON DUPLICATE KEY UPDATE col = COALESCE(NULLIF(col,''), VALUES(col))` — never overwrites a
 * value already in mas_hrms, only fills blanks. For employee_nominee/employee_education (no
 * employee_id unique key — genuinely multi-row-per-employee tables), inserts only when the
 * employee has zero existing rows there, so re-running this never creates duplicates.
 *
 * This repo runs several concurrent Claude sessions and a live backend against the same
 * database (CLAUDE.md's Concurrent Agent Rule) — real lock contention on `employees` is
 * expected here, not exceptional. Uses a single dedicated connection with a short
 * innodb_lock_wait_timeout (a pooled db.execute() would apply SET SESSION to whichever
 * connection happens to serve that one call, not the connection later calls borrow — it
 * silently would not have applied at all), and isolates each employee's writes in its own
 * try/catch so one stuck row is skipped and logged, not a run-ending crash.
 *
 * Run: npx tsx scripts/backfill-legacy-tables-from-dbbill.ts
 */
import { db } from "../src/db/mysql.js";
import { billQuery } from "../src/db/billDb.js";
import type { RowDataPacket } from "mysql2";

interface LegacyRow extends RowDataPacket {
  EmpCode: string | null;
  Father: string | null;
  Husband: string | null;
  BloodGruop: string | null;
  Qualification: string | null;
  Qualification_Details: string | null;
  Passed_Out_Year: string | null;
  Passed_Out_State: string | null;
  Passed_Out_City: string | null;
  Passed_Out_Percent: string | null;
  Experience_Year: string | null;
  Family_Annual_Income: string | null;
  Count_Of_Dependents: string | null;
  LandLine: string | null;
  LandLine1: string | null;
  Mobile1: string | null;
  documentDone: string | null;
  Gross: string | null;
  NetInhand: string | null;
  CTC: string | null;
  PassportNo: string | null;
  dlNo: string | null;
  EntryDate: Date | string | null;
  LeftReason: string | null;
  BoxFileNo: string | null;
  UpdatedBy: string | null;
  NomineeName: string | null;
  NomineeRelation: string | null;
  NomineeDob: Date | string | null;
}

interface EmpMasterRow extends RowDataPacket {
  EmpCode: string | null;
  Fname: string | null;
  CostCenter: string | null;
  EmpFor: string | null;
  Qualification: string | null;
  LeftRmks: string | null;
  TMobNo: string | null;
  CTCOffered: string | null;
}

function blank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function toDateOrNull(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1901) return null;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD for a DATE column
}

async function main() {
  console.log("Fetching db_bill sources...");
  const legacyRows = await billQuery<LegacyRow>(
    `SELECT EmpCode, Father, Husband, BloodGruop, Qualification, Qualification_Details,
            Passed_Out_Year, Passed_Out_State, Passed_Out_City, Passed_Out_Percent,
            Experience_Year, Family_Annual_Income, Count_Of_Dependents, LandLine, LandLine1,
            Mobile1, documentDone, Gross, NetInhand, CTC, PassportNo, dlNo, EntryDate,
            LeftReason, BoxFileNo, UpdatedBy, NomineeName, NomineeRelation, NomineeDob
       FROM masjclrentry
      WHERE EmpCode IS NOT NULL AND EmpCode <> ''`
  );
  const legacyByCode = new Map<string, LegacyRow>();
  for (const r of legacyRows) if (r.EmpCode) legacyByCode.set(String(r.EmpCode).trim().toUpperCase(), r);
  console.log(`masjclrentry: ${legacyByCode.size} rows keyed`);

  const emRows = await billQuery<EmpMasterRow>(
    `SELECT EmpCode, Fname, CostCenter, EmpFor, Qualification, LeftRmks, TMobNo, CTCOffered
       FROM employee_master
      WHERE EmpCode IS NOT NULL AND EmpCode <> ''`
  );
  const emByCode = new Map<string, EmpMasterRow>();
  for (const r of emRows) if (r.EmpCode) emByCode.set(String(r.EmpCode).trim().toUpperCase(), r);
  console.log(`employee_master: ${emByCode.size} rows keyed`);

  const conn = await db.getConnection();
  await conn.query("SET SESSION innodb_lock_wait_timeout = 5");

  try {
    const [employees] = await conn.execute<(RowDataPacket & { id: string; employee_code: string })[]>(
      `SELECT id, employee_code FROM employees`
    );
    console.log(`mas_hrms employees: ${employees.length}`);

    const [existingNomineeRows] = await conn.execute<(RowDataPacket & { employee_id: string })[]>(
      `SELECT DISTINCT employee_id FROM employee_nominee`
    );
    const hasNominee = new Set(existingNomineeRows.map((r) => r.employee_id));

    const [existingEducationRows] = await conn.execute<(RowDataPacket & { employee_id: string })[]>(
      `SELECT DISTINCT employee_id FROM employee_education`
    );
    const hasEducation = new Set(existingEducationRows.map((r) => r.employee_id));

    let lmWritten = 0, nomineeWritten = 0, eduWritten = 0, expWritten = 0, ecmWritten = 0, essWritten = 0, mobileWritten = 0;
    const failures: { employee_code: string; error: string }[] = [];

    for (const emp of employees) {
      try {
        const code = String(emp.employee_code).trim().toUpperCase();
        const lg = legacyByCode.get(code);
        const em = emByCode.get(code);
        if (!lg && !em) continue;

        // employee_legacy_meta
        const fatherName = (lg && (lg.Father || lg.Husband)) || (em && em.Fname) || null;
        const relationshipType = lg && !blank(lg.Father) ? "Father" : lg && !blank(lg.Husband) ? "Husband" : null;
        const bloodGroup = lg?.BloodGruop ?? null;
        const qualification = lg?.Qualification ?? null;
        const landLineP = lg?.LandLine ?? null;
        const landLineT = lg?.LandLine1 ?? null;
        const passportNo = lg?.PassportNo ?? null;
        const dlNo = lg?.dlNo ?? null;
        const boxFileNo = lg?.BoxFileNo ?? null;
        const documentDone = lg?.documentDone ?? null;
        const updatedBy = lg?.UpdatedBy ?? null;
        const entryDate = toDateOrNull(lg?.EntryDate);
        const leftReason = (lg && !blank(lg.LeftReason) ? lg.LeftReason : null) ?? em?.LeftRmks ?? null;

        if (!blank(fatherName) || !blank(bloodGroup) || !blank(qualification) || !blank(landLineP)
            || !blank(landLineT) || !blank(passportNo) || !blank(dlNo) || !blank(boxFileNo)
            || !blank(documentDone) || !blank(updatedBy) || entryDate || !blank(leftReason)) {
          await conn.execute(
            `INSERT INTO employee_legacy_meta
               (id, employee_id, father_name, relationship_type, blood_group, qualification,
                land_line_p, land_line_t, passport_no, dl_no, box_file_no, document_done,
                updated_by, entry_date, left_reason)
             VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               father_name         = COALESCE(NULLIF(father_name,''), VALUES(father_name)),
               relationship_type   = COALESCE(NULLIF(relationship_type,''), VALUES(relationship_type)),
               blood_group         = COALESCE(NULLIF(blood_group,''), VALUES(blood_group)),
               qualification       = COALESCE(NULLIF(qualification,''), VALUES(qualification)),
               land_line_p         = COALESCE(NULLIF(land_line_p,''), VALUES(land_line_p)),
               land_line_t         = COALESCE(NULLIF(land_line_t,''), VALUES(land_line_t)),
               passport_no         = COALESCE(NULLIF(passport_no,''), VALUES(passport_no)),
               dl_no               = COALESCE(NULLIF(dl_no,''), VALUES(dl_no)),
               box_file_no         = COALESCE(NULLIF(box_file_no,''), VALUES(box_file_no)),
               document_done       = COALESCE(NULLIF(document_done,''), VALUES(document_done)),
               updated_by          = COALESCE(NULLIF(updated_by,''), VALUES(updated_by)),
               entry_date          = COALESCE(entry_date, VALUES(entry_date)),
               left_reason         = COALESCE(NULLIF(left_reason,''), VALUES(left_reason))`,
            [emp.id, fatherName, relationshipType, bloodGroup, qualification, landLineP, landLineT,
             passportNo, dlNo, boxFileNo, documentDone, updatedBy, entryDate, leftReason]
          );
          lmWritten++;
        }

        // employees.alternate_mobile — direct column, update only when blank
        const altMobile = (lg && !blank(lg.Mobile1) ? lg.Mobile1 : null) ?? em?.TMobNo ?? null;
        if (altMobile && !blank(altMobile)) {
          const [r] = await conn.execute<import("mysql2").ResultSetHeader>(
            `UPDATE employees SET alternate_mobile = ?
              WHERE id = ? AND (alternate_mobile IS NULL OR alternate_mobile = '')`,
            [altMobile, emp.id]
          );
          if ((r as unknown as { affectedRows: number }).affectedRows > 0) mobileWritten++;
        }

        // employee_nominee — no employee_id unique key (genuinely multi-row); insert only if
        // the employee has zero rows there yet.
        if (lg?.NomineeName && !blank(lg.NomineeName) && !hasNominee.has(emp.id)) {
          await conn.execute(
            `INSERT INTO employee_nominee (id, employee_id, nominee_name, relationship, date_of_birth)
             VALUES (UUID(), ?, ?, ?, ?)`,
            [emp.id, lg.NomineeName, lg.NomineeRelation ?? null, toDateOrNull(lg.NomineeDob)]
          );
          hasNominee.add(emp.id);
          nomineeWritten++;
        }

        // employee_education — same insert-if-absent rule. Qualification itself falls back to
        // employee_master.Qualification when masjclrentry doesn't have it (masjclrentry alone
        // covers 91% of matched employees; employee_master covers a different, overlapping
        // set — combining them is what got the original db_bill-fallback path to 99.8%).
        const qualificationForEdu = (lg && !blank(lg.Qualification) ? lg.Qualification : null) ?? em?.Qualification ?? null;
        if (qualificationForEdu && !blank(qualificationForEdu) && !hasEducation.has(emp.id)) {
          await conn.execute(
            `INSERT INTO employee_education
               (id, employee_id, qualification, specialization_course_name, passed_out_state,
                passed_out_city, passed_out_year, passed_out_percentage)
             VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)`,
            [emp.id, qualificationForEdu, lg?.Qualification_Details ?? null, lg?.Passed_Out_State ?? null,
             lg?.Passed_Out_City ?? null,
             lg?.Passed_Out_Year && /^\d+$/.test(String(lg.Passed_Out_Year).trim()) ? Number(lg.Passed_Out_Year) : null,
             lg?.Passed_Out_Percent && /^[\d.]+$/.test(String(lg.Passed_Out_Percent).trim()) ? Number(lg.Passed_Out_Percent) : null]
          );
          hasEducation.add(emp.id);
          eduWritten++;
        }

        // employee_experience — employee_id unique key, safe upsert.
        if (lg?.Experience_Year && !blank(lg.Experience_Year)) {
          const years = /^[\d.]+$/.test(String(lg.Experience_Year).trim()) ? Number(lg.Experience_Year) : null;
          if (years !== null) {
            await conn.execute(
              `INSERT INTO employee_experience (id, employee_id, experience_years)
               VALUES (UUID(), ?, ?)
               ON DUPLICATE KEY UPDATE experience_years = COALESCE(experience_years, VALUES(experience_years))`,
              [emp.id, years]
            );
            expWritten++;
          }
        }

        // employee_client_mapping — employee_id unique key (uq_emp_client), safe upsert.
        const costCenter = em?.CostCenter ?? null;
        const empFor = em?.EmpFor ?? null;
        if (!blank(costCenter) || !blank(empFor)) {
          await conn.execute(
            `INSERT INTO employee_client_mapping (id, employee_id, cost_center, emp_for, active_status, effective_from)
             VALUES (UUID(), ?, ?, ?, 1, CURDATE())
             ON DUPLICATE KEY UPDATE
               cost_center = COALESCE(NULLIF(cost_center,''), VALUES(cost_center)),
               emp_for     = COALESCE(NULLIF(emp_for,''), VALUES(emp_for))`,
            [emp.id, costCenter, empFor]
          );
          ecmWritten++;
        }

        // employee_salary_snapshot — employee_id unique key, safe upsert. Numeric-only guard
        // since db_bill's Gross/NetInhand/CTC occasionally carry non-numeric junk (blank
        // strings, 'NA') that would otherwise insert as 0.
        const numOrNull = (v: unknown) => {
          const s = String(v ?? "").trim();
          return s !== "" && /^-?[\d.]+$/.test(s) ? Number(s) : null;
        };
        const gross = numOrNull(lg?.Gross);
        const netInHand = numOrNull(lg?.NetInhand);
        // No distinct "CTC offered" column in masjclrentry; its CTC is the closest proxy there.
        // employee_master.CTCOffered is an exact-name match and checked first when present.
        const ctcOffered = numOrNull(em?.CTCOffered) ?? numOrNull(lg?.CTC);
        if (gross !== null || netInHand !== null || ctcOffered !== null) {
          await conn.execute(
            `INSERT INTO employee_salary_snapshot (id, employee_id, snapshot_date, gross, net_in_hand, ctc_offered)
             VALUES (UUID(), ?, CURDATE(), ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               gross       = COALESCE(gross, VALUES(gross)),
               net_in_hand = COALESCE(net_in_hand, VALUES(net_in_hand)),
               ctc_offered = COALESCE(ctc_offered, VALUES(ctc_offered))`,
            [emp.id, gross, netInHand, ctcOffered]
          );
          essWritten++;
        }
      } catch (err) {
        failures.push({ employee_code: emp.employee_code, error: err instanceof Error ? err.message : String(err) });
      }
    }

    console.log({ lmWritten, nomineeWritten, eduWritten, expWritten, ecmWritten, essWritten, mobileWritten });
    console.log(`Failures: ${failures.length}`);
    if (failures.length > 0) {
      console.log("First 20 failures:", failures.slice(0, 20));
    }
  } finally {
    conn.release();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
