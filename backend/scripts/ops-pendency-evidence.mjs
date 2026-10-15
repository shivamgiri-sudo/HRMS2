/**
 * ops-pendency-evidence.mjs — READ-ONLY. Explains why new joiners still show under the Ops Control Tower
 * "Penny drop missing" block, and how the "Address review" queue is distributed. Prints employee CODES only
 * (no names, no account numbers). Writes nothing.
 */
import mysql from "mysql2/promise";
import "dotenv/config";

const c = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});
const run = async (title, sql, params = []) => {
  try { const [rows] = await c.query(sql, params); console.log(`== ${title} (${rows.length})`); console.table(rows); return rows; }
  catch (e) { console.log(`== ${title}: ${e.code ?? e.message}`); return []; }
};

const STILL = "(e.active_status = 1 OR LOWER(COALESCE(e.employment_status,'')) = 'preboarding')";
const EVIDENCE = `(
  EXISTS (SELECT 1 FROM bank_penny_drop_log l WHERE l.employee_id = e.id AND l.penny_drop_status IN ('success','skipped')
            AND l.initiated_at = (SELECT MAX(l2.initiated_at) FROM bank_penny_drop_log l2 WHERE l2.employee_id = e.id))
  OR EXISTS (SELECT 1 FROM ats_onboarding_bridge pb WHERE pb.employee_id = e.id
              AND (LOWER(COALESCE(pb.penny_drop_status,'')) = 'verified' OR pb.penny_drop_verified_at IS NOT NULL))
  OR EXISTS (SELECT 1 FROM employee_bank_detail pd WHERE pd.employee_id = e.id AND pd.verified = 1)
  OR EXISTS (SELECT 1 FROM ats_onboarding_bridge pb2 JOIN candidate_bank_verification pv ON pv.candidate_id = pb2.candidate_id
              WHERE pb2.employee_id = e.id AND LOWER(COALESCE(pv.verification_status,'')) = 'verified'
                AND LOWER(COALESCE(pv.verification_method,'')) <> 'mock'))`;

const pending = `FROM employees e WHERE e.created_at >= NOW() - INTERVAL 30 DAY AND ${STILL} AND NOT ${EVIDENCE}`;
await run("PENDING joiners (30d) by raw evidence combination", `SELECT
    COALESCE((SELECT l.penny_drop_status FROM bank_penny_drop_log l WHERE l.employee_id = e.id ORDER BY l.initiated_at DESC LIMIT 1),'(no log)') AS log_latest,
    COALESCE((SELECT NULLIF(b.penny_drop_status,'') FROM ats_onboarding_bridge b WHERE b.employee_id = e.id LIMIT 1),'(none)') AS bridge_status,
    COALESCE((SELECT GROUP_CONCAT(DISTINCT CONCAT(COALESCE(v.verification_status,'?'),'/',COALESCE(v.verification_method,'?')))
                FROM ats_onboarding_bridge b JOIN candidate_bank_verification v ON v.candidate_id = b.candidate_id
               WHERE b.employee_id = e.id),'(none)') AS cand_bank_verif,
    COALESCE((SELECT GROUP_CONCAT(DISTINCT CONCAT(d.verified,'/',d.active_status)) FROM employee_bank_detail d WHERE d.employee_id = e.id),'(no row)') AS emp_bank_verified_active,
    COALESCE((SELECT GROUP_CONCAT(DISTINCT o.validation_status)
                FROM ats_onboarding_bridge b JOIN candidate_onboarding_bank_detail o ON o.candidate_id = b.candidate_id
               WHERE b.employee_id = e.id),'(none)') AS cand_onb_bank_validation,
    COUNT(*) AS n
  ${pending} GROUP BY 1,2,3,4,5 ORDER BY n DESC LIMIT 40`);

await run("PENDING sample codes with any verified-looking signal", `SELECT e.employee_code,
    (SELECT GROUP_CONCAT(DISTINCT l.penny_drop_status) FROM bank_penny_drop_log l WHERE l.employee_id = e.id) AS log_statuses,
    (SELECT GROUP_CONCAT(DISTINCT CONCAT(o.validation_status)) FROM ats_onboarding_bridge b JOIN candidate_onboarding_bank_detail o ON o.candidate_id = b.candidate_id WHERE b.employee_id = e.id) AS onb_validation,
    (SELECT GROUP_CONCAT(DISTINCT CONCAT(v.verification_status,'/',v.verification_method)) FROM ats_onboarding_bridge b JOIN candidate_bank_verification v ON v.candidate_id = b.candidate_id WHERE b.employee_id = e.id) AS cand_verif
  ${pending}
    AND (EXISTS (SELECT 1 FROM ats_onboarding_bridge b JOIN candidate_onboarding_bank_detail o ON o.candidate_id = b.candidate_id WHERE b.employee_id = e.id AND o.validation_status = 'verified')
      OR EXISTS (SELECT 1 FROM ats_onboarding_bridge b JOIN candidate_bank_verification v ON v.candidate_id = b.candidate_id WHERE b.employee_id = e.id AND LOWER(COALESCE(v.verification_status,'')) IN ('verified','success','passed','completed')))
  ORDER BY e.created_at DESC LIMIT 40`);

await run("Address review queue: distance buckets", `SELECT
    CASE WHEN v.gps_distance_m IS NULL THEN 'no GPS / no reference'
         WHEN v.gps_distance_m <= 50 THEN '<=50m'
         WHEN v.gps_distance_m <= 500 THEN '51-500m'
         WHEN v.gps_distance_m <= 2000 THEN '0.5-2km'
         WHEN v.gps_distance_m <= 10000 THEN '2-10km'
         WHEN v.gps_distance_m <= 50000 THEN '10-50km' ELSE '>50km' END AS bucket,
    (v.ref_latitude IS NULL) AS no_ref, COUNT(*) AS n, ROUND(AVG(v.gps_accuracy_m)) AS avg_accuracy_m
  FROM candidate_bgv_address_verification v
  WHERE v.status = 'submitted' AND (v.hr_decision IS NULL OR v.hr_decision = 'review')
    AND NOT EXISTS (SELECT 1 FROM candidate_bgv_address_verification vv WHERE vv.candidate_id = v.candidate_id AND vv.status = 'verified')
  GROUP BY 1,2 ORDER BY n DESC`);
await run("Address verification overall", `SELECT status, hr_decision, COUNT(*) n FROM candidate_bgv_address_verification GROUP BY 1,2 ORDER BY n DESC`);
await run("address_bgv_reminder_log by outcome / reminder number", `SELECT reminder_no, outcome, COUNT(*) n, MIN(sent_at) first_at, MAX(sent_at) last_at FROM address_bgv_reminder_log GROUP BY 1,2`);
await run("migration 2217 applied?", `SELECT COUNT(*) AS applied FROM schema_migrations WHERE filename LIKE '%2217_address_bgv_reminder_log%'`);
await run("address links by sent_via/status", `SELECT sent_via, status, COUNT(*) n FROM candidate_bgv_address_verification GROUP BY 1,2`);
await c.end();
