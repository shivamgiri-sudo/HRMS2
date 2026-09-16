/**
 * One-off backfill, 2026-09-16. Companion to backfill-employee-address-from-onboarding.
 *
 * employee-creation-orchestrator.service.ts never wrote employee_education or
 * employee_experience at all -- neither table had any writer in that function before this
 * same commit's code fix. Real data exists in candidate_onboarding_qualification (33,177
 * rows) and candidate_onboarding_experience (286 rows); it was simply never copied over, so
 * the Employee Master report and Employee Profile page (which read employee_education /
 * employee_experience, not the candidate_onboarding_* tables) showed blank qualification and
 * experience for every employee still active from that pipeline.
 *
 * Qualification: highest passed_out_year wins per candidate (matches "Qualification" meaning
 * highest attained, same convention as the legacy masjclrentry.Qualification field).
 * Experience: only backfilled when a real candidate_onboarding_experience row exists --
 * absence is never treated as "confirmed fresher" (the form doesn't collect that as a
 * standalone flag), so employees with no experience row are left untouched, not guessed.
 *
 * Additive only: WHERE NOT EXISTS, never touches an employee that already has a row.
 *
 * Usage: node backfill-employee-education-experience-2026-09-16.mjs           (dry run)
 *        node backfill-employee-education-experience-2026-09-16.mjs --write   (apply)
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const WRITE = process.argv.includes("--write");

const rawConn = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});
const conn = {
  query: async (...args) => {
    for (let a = 1; a <= 6; a++) {
      try { return await rawConn.query(...args); }
      catch (err) {
        if ((err.code === "ER_LOCK_DEADLOCK" || err.code === "ER_LOCK_WAIT_TIMEOUT") && a < 6) {
          await new Promise((r) => setTimeout(r, 1000 * a)); continue;
        }
        throw err;
      }
    }
  },
  end: () => rawConn.end(),
};

// --- Qualification ---
const [qualRows] = await conn.query(`
  SELECT e.id AS employee_id, e.employee_code, best.qualification, best.specialization_course_name,
         best.institution_name, best.passed_out_state, best.passed_out_city,
         best.passed_out_year, best.passed_out_percentage
    FROM employees e
    JOIN (
      SELECT coq.*, ROW_NUMBER() OVER (
               PARTITION BY candidate_id ORDER BY passed_out_year DESC, created_at DESC
             ) AS rn
        FROM candidate_onboarding_qualification coq
    ) best ON best.candidate_id = e.candidate_id AND best.rn = 1
   WHERE e.active_status = 1
     AND best.qualification <> ''
     AND NOT EXISTS (SELECT 1 FROM employee_education ee WHERE ee.employee_id = e.id)
`);
console.log(`\n=== employee_education: ${qualRows.length} employee(s) recoverable ===`);
console.table(qualRows.slice(0, 10).map(r => ({ code: r.employee_code, qualification: r.qualification, year: r.passed_out_year })));
if (WRITE) {
  for (const r of qualRows) {
    await conn.query(
      `INSERT INTO employee_education
         (id, employee_id, qualification, specialization_course_name, institution_name,
          passed_out_state, passed_out_city, passed_out_year, passed_out_percentage)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.employee_id, r.qualification, r.specialization_course_name, r.institution_name,
       r.passed_out_state, r.passed_out_city, r.passed_out_year, r.passed_out_percentage]
    );
  }
  console.log(`Wrote ${qualRows.length} employee_education row(s).`);
}

// --- Experience ---
const [expRows] = await conn.query(`
  SELECT e.id AS employee_id, e.employee_code, best.experience_year
    FROM employees e
    JOIN (
      SELECT coe.*, ROW_NUMBER() OVER (
               PARTITION BY candidate_id ORDER BY to_date DESC, created_at DESC
             ) AS rn
        FROM candidate_onboarding_experience coe
    ) best ON best.candidate_id = e.candidate_id AND best.rn = 1
   WHERE e.active_status = 1
     AND best.experience_year IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM employee_experience ex WHERE ex.employee_id = e.id)
`);
console.log(`\n=== employee_experience: ${expRows.length} employee(s) recoverable ===`);
console.table(expRows.map(r => ({ code: r.employee_code, experience_year: r.experience_year })));
if (WRITE) {
  for (const r of expRows) {
    await conn.query(
      `INSERT INTO employee_experience (id, employee_id, is_fresher, experience_years)
       VALUES (UUID(), ?, 0, ?)`,
      [r.employee_id, Number(r.experience_year) || 0]
    );
  }
  console.log(`Wrote ${expRows.length} employee_experience row(s).`);
}

if (!WRITE) {
  console.log(`\nDRY RUN — would write ${qualRows.length} education + ${expRows.length} experience row(s). Re-run with --write to apply.`);
}

await conn.end();
