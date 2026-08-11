-- 1127_scope_apr_eligibility_by_process.sql
--
-- NOT REGISTERED IN MIGRATION_MANIFEST. Listed in MIGRATION_MANIFEST.lock.json
-- under knownUnlisted so the manifest guard passes without this running at boot.
-- Registering it (or running it by hand) changes payroll inputs for 472 people and
-- needs explicit sign-off. See "TO ACTIVATE" at the bottom.
--
-- WHAT IS WRONG
--
-- apr_eligibility_config decides whether an employee's attendance is judged on the
-- APR/dialler feed. Matching in attendanceEngineService.isAprEligible() is:
--
--   (designation_id = ? OR designation_id IS NULL)
--   AND (department_id = ? OR department_id IS NULL)
--   AND (process_id    = ? OR process_id    IS NULL)
--
-- and returns true if ANY active row matches. The four active rows pin a designation
-- (EXECUTIVE and its BACKEND/FIELD/VOICE variants) and department (OPERATIONS) but
-- leave process_id NULL, so they match every process in the company.
--
-- Measured on mas_hrms, 2026-08-11. Of 828 active employees the config classifies as
-- dialler agents, APR presence splits cleanly along the process axis and nowhere else:
--
--   IDAM Natural Wellness  63/68    Onfido                      0/173
--   Neemans                34/35    Godfrey Philips India Ltd   0/147
--   Guardian Healthcare    27/28    Bluevine Technologies       0/72
--   BTM Ventures           22/22    Finnable                    0/24
--   Bella-Vita Organic     19/19    CUSTOMER ACQUISITION        0/15
--   Clovia                 12/12    Eresolution                 0/12
--   BirlaNu Limited        10/11    BACK OFFICE                 0/7
--   Captureatrip           10/12    INBOUND CUSTOMER SERVICES   0/4
--   Dalmia Cement           7/8     TELEVERIFICATION            0/4
--   Exicom                  5/5     VIRTUAL ACCOUNT MANAGEMENT  0/3
--   VST                     4/4     POST PAID RETENTION         0/3
--   Viega                   2/2     VNT                         0/3
--                                   PREPAID RETENTION & UPSELL  0/2
--                                   Adani Wilmar Limited        0/2
--                                   UPSELLING & CROSSELLING     0/1
--
-- The distribution is bimodal with nothing between 44% and 83%. In the right-hand
-- column not one employee has EVER had a row in `apr` — not this month, not ever —
-- while the APR feed itself is healthy (2,676 rows / 245 users in August, current to
-- 2026-08-10). They are not dialler agents; the rule simply over-reaches.
--
-- Consequence: 1,722 attendance_daily_record rows in August 2026 carry
-- source_system='apr_no_activity' across 649 employees. Unresolved missing_punch
-- pays zero, and 286 of those days have a biometric punch on the very same day.
--
-- WHAT THIS DOES NOT DO
--
-- It does not touch the ruling of 2026-08-07 that Operations Executives are judged on
-- APR alone with no biometric fallback. That rule governs HOW a dialler agent is
-- judged. This changes only WHO is a dialler agent, using the process_id column the
-- config table already provides. No engine, payroll or threshold logic is altered.
--
-- Deliberately conservative: every process with ANY APR history at all is KEPT on APR,
-- including the three with weak adoption (Housing.com 3/79, DU Digital 4/9, Appriciate
-- Wealth 4/17). Only the 15 processes with zero APR history ever are moved off. Moving
-- a genuine dialler agent to biometric could suppress their pay, so the ambiguous cases
-- keep the status quo until someone who knows the business says otherwise.
--
-- ###########################################################################
-- BLOCKER — DO NOT RUN THIS FILE UNTIL THE NINE BELOW HAVE A process_id
-- ###########################################################################
--
-- 25 of the 828 have no process_id at all. A rule row cannot target "no process"
-- (process_id IS NULL in a *rule* matches EVERY employee), so all 25 lose APR
-- eligibility when this runs. Checked 2026-08-11 — they are NOT test accounts:
-- 0 of 25 match test/e2e/demo/dummy naming, 0 lack a branch, 0 have a test email.
-- All 25 are a real June-2026 cohort at NOIDA / NOIDA-2 / AHMEDABAD-JALDARSHAN,
-- all have 2 salary_prep_line rows, all are biometrically enrolled, all have
-- August attendance. Different population from the known 10 E2E accounts, which
-- have no branch and no payroll line.
--
-- 16 of them have no APR history and correctly belong on biometric — no action.
--
-- The other NINE are live dialler agents and this file would silently cut them off:
--
--   MAS62903 GAUSH ALAM DANISH   CART_2, INACTIVE, SHELTER   62 rows, last 2026-08-05
--   MAS62905 JAISIKA SAHOO       BELLA_O, CHAT2O             17 rows, last 2026-08-10
--   MAS62906 UZMA ABDULLAH       BELLA_O, CHAT2O             41 rows, last 2026-08-11
--   MAS62907 AQSHA NOOR          BELLA_O, CHAT2O             50 rows, last 2026-08-11
--   MAS62908 SIMRAN DUBEY        BELLA_O, CART_3, CHAT2O     51 rows, last 2026-08-10
--   MAS62909 ARPIT VERMA         CART_2, CHAT2O, SHELTER     76 rows, last 2026-08-10
--   MAS62910 AANCHAL VERMA       CART_2, CART_3, SHELTER     75 rows, last 2026-08-11
--   MAS62913 MANSI               BELLA_O, CHAT2O             55 rows, last 2026-08-11
--   MAS62901 A KARTHIK           EMAIL                        8 rows, last 2026-07-10 (stale)
--
-- Eight of the nine dialled within 24 hours of this measurement.
--
-- Their correct process could NOT be determined from data, and the two available
-- signals disagree:
--   - Campaign mix points at IDAM Natural Wellness / Bella-Vita Organic. CART_2,
--     SHELTER and INACTIVE are 100% IDAM among employees who do have a process;
--     BELLA_O and CHAT2O split ~55/45 IDAM vs Bella-Vita; EMAIL spreads across four
--     processes. Campaigns are shared between processes, so they cannot pin one.
--   - Eight of the nine report to SUDEEP NEGI (MAS01963), whose own process is
--     VIRTUAL ACCOUNT MANAGEMENT — zero APR history (0/3). That contradicts the
--     campaign evidence, so the manager's process looks stale too.
--   - campaign_master is empty (0 rows), so no authoritative mapping exists.
--
-- Whichever of IDAM / Bella-Vita / Neemans / BTM / Clovia they belong to, all are on
-- the KEEP list, so any correct assignment preserves their APR eligibility. WFM or
-- Ops must confirm which. Until then this file must not run.
--
-- Wider context: 144 of 1,125 active employees (12.8%) have no process_id.

-- ---------------------------------------------------------------------------
-- 1. Add process-scoped rules for every process that demonstrably runs on APR.
--    Runs BEFORE the deactivation below on purpose: isAprEligible() falls back to
--    isOperationsExecutiveByRegex() when the config has zero active rows, and that
--    regex matches broadly. The config must never be momentarily empty.
--    Idempotent on the primary key.
-- ---------------------------------------------------------------------------
INSERT INTO apr_eligibility_config
  (id, rule_name, designation_id, department_id, process_id, active_status, notes, created_by)
SELECT
  CONCAT('apr-elig-', d.slug, '--', LEFT(p.pid, 8)),
  CONCAT('APR: ', d.dname, ' / ', p.pname),
  d.did,
  d.dept,
  p.pid,
  1,
  'Seeded by 1127: process-scoped replacement for the four process_id IS NULL rules, which matched every process in the company.',
  'system'
FROM (
            SELECT '79271db7-5e88-11f1-adb1-00155d0ab410' AS did, '7782964a-5e88-11f1-adb1-00155d0ab410' AS dept, 'exec'         AS slug, 'EXECUTIVE'           AS dname
  UNION ALL SELECT '7993fbc1-5e88-11f1-adb1-00155d0ab410',        '7782964a-5e88-11f1-adb1-00155d0ab410',        'exec-backend',       'EXECUTIVE - BACKEND'
  UNION ALL SELECT '7957720b-5e88-11f1-adb1-00155d0ab410',        '7782964a-5e88-11f1-adb1-00155d0ab410',        'exec-field',         'EXECUTIVE - FIELD'
  UNION ALL SELECT '7975e39c-5e88-11f1-adb1-00155d0ab410',        '7782964a-5e88-11f1-adb1-00155d0ab410',        'exec-voice',         'EXECUTIVE - VOICE'
) d
CROSS JOIN (
            SELECT 'b0afc80e-6969-11f1-adb1-00155d0ab410' AS pid, 'IDAM Natural Wellness'   AS pname
  UNION ALL SELECT '05150ba3-67ba-11f1-adb1-00155d0ab410',        'Neemans Private Limited'
  UNION ALL SELECT 'b0b5eb22-6969-11f1-adb1-00155d0ab410',        'Guardian Healthcare'
  UNION ALL SELECT 'b0b6e055-6969-11f1-adb1-00155d0ab410',        'BTM Ventures'
  UNION ALL SELECT '050b7ba8-67ba-11f1-adb1-00155d0ab410',        'Bella-Vita Organic'
  UNION ALL SELECT '050de032-67ba-11f1-adb1-00155d0ab410',        'Clovia'
  UNION ALL SELECT '05168f65-67ba-11f1-adb1-00155d0ab410',        'BirlaNu Limited'
  UNION ALL SELECT 'b0b7dfb8-6969-11f1-adb1-00155d0ab410',        'Captureatrip'
  UNION ALL SELECT '05061340-67ba-11f1-adb1-00155d0ab410',        'Dalmia Cement'
  UNION ALL SELECT '050a0fa0-67ba-11f1-adb1-00155d0ab410',        'Exicom'
  UNION ALL SELECT '0518068a-67ba-11f1-adb1-00155d0ab410',        'VST'
  UNION ALL SELECT '0508d1cd-67ba-11f1-adb1-00155d0ab410',        'Viega'
  -- Weak APR adoption, kept on APR deliberately (see header).
  UNION ALL SELECT '05191bc1-67ba-11f1-adb1-00155d0ab410',        'Housing.com'
  UNION ALL SELECT '050cc297-67ba-11f1-adb1-00155d0ab410',        'DU Digital'
  UNION ALL SELECT '0510ca4d-67ba-11f1-adb1-00155d0ab410',        'Appriciate Wealth'
) p
ON DUPLICATE KEY UPDATE
  active_status = 1,
  updated_at    = CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------------
-- 2. Retire the four unscoped rules.
--    The guard in the WHERE clause is the safety interlock: it refuses to run unless
--    the 60 scoped rules above are actually present and active, so a partial apply can
--    never leave the config empty (regex fallback) or leave nobody on APR. Written as a
--    derived table because MySQL cannot read the target table directly in an UPDATE.
-- ---------------------------------------------------------------------------
UPDATE apr_eligibility_config
   SET active_status = 0,
       notes = CONCAT(COALESCE(notes, ''),
                      ' | DEACTIVATED by 1127: process_id IS NULL matched every process. ',
                      'Replaced by 60 process-scoped rules covering the 15 processes with real APR history. ',
                      'The 15 processes with zero APR history ever (472 active employees, incl. Onfido 173, ',
                      'Godfrey Philips 147, Bluevine 72) move to biometric.'),
       updated_at = CURRENT_TIMESTAMP
 WHERE id IN (
         'apr-elig-ops-executive',
         'apr-elig-ops-executive--backend',
         'apr-elig-ops-executive--field',
         'apr-elig-ops-executive--voice'
       )
   AND process_id IS NULL
   AND active_status = 1
   AND (SELECT c FROM (
          SELECT COUNT(*) AS c
            FROM apr_eligibility_config
           WHERE active_status = 1
             AND process_id IS NOT NULL
        ) AS guard) >= 60;

-- ---------------------------------------------------------------------------
-- TO ACTIVATE (all three steps need sign-off; none is done by this file)
--
-- 1. Confirm the process split above with someone who knows which campaigns dial.
--    The three weak-adoption processes and the 25 employees with no process are the
--    judgement calls.
--
-- 2. Run this file against mas_hrms inside a transaction and verify BEFORE COMMIT:
--      SELECT COUNT(*) FROM apr_eligibility_config WHERE active_status=1 AND process_id IS NOT NULL;  -- expect 60
--      SELECT COUNT(*) FROM apr_eligibility_config WHERE active_status=1 AND process_id IS NULL;      -- expect 0
--    then re-run the eligibility count per process and confirm 331 employees remain
--    APR-eligible and 472 have moved off.
--
-- 3. Existing rows are NOT rewritten by this file. August's 1,722 apr_no_activity rows
--    keep their status until the affected employees are reprocessed. Reprocess with
--    processEmployee() per employee/date — NOT processDateBatch(), which rewrites the
--    whole cohort. Payroll for any affected month must be re-checked before finalise.
--
-- ROLLBACK
--   UPDATE apr_eligibility_config SET active_status = 1
--    WHERE id IN ('apr-elig-ops-executive','apr-elig-ops-executive--backend',
--                 'apr-elig-ops-executive--field','apr-elig-ops-executive--voice');
--   UPDATE apr_eligibility_config SET active_status = 0
--    WHERE id LIKE 'apr-elig-exec%--%' AND created_by = 'system' AND process_id IS NOT NULL;
-- ---------------------------------------------------------------------------
