-- =============================================================================
-- Diagnostic: IncrementExport Data Quality Investigation
-- RUN READ-ONLY. No inserts, updates or deletes.
-- Purpose: Classify all salary snapshot rows by data quality category.
-- =============================================================================

USE mas_hrms;

-- ── A. Summary counts ─────────────────────────────────────────────────────────
SELECT '=== A. SUMMARY ===' AS section;

SELECT
  COUNT(*) AS total_snapshot_rows,
  COUNT(DISTINCT e.employee_code) AS unique_employee_codes,
  COUNT(DISTINCT e.id) AS unique_employee_ids,

  -- 1970 epoch (null lastUpdated from legacy)
  SUM(CASE WHEN ess.snapshot_date <= '1970-01-02' THEN 1 ELSE 0 END) AS epoch_1970_count,

  -- Zero-value rows
  SUM(CASE WHEN ess.gross = 0 AND ess.ctc_offered = 0 AND ess.basic = 0 THEN 1 ELSE 0 END) AS zero_value_count,

  -- Reconciliation gaps > ₹1
  SUM(CASE
    WHEN ABS(ess.gross - (
      COALESCE(ess.basic,0) + COALESCE(ess.hra,0) + COALESCE(ess.conveyance,0) +
      COALESCE(ess.portfolio_allowance,0) + COALESCE(ess.medical_allowance,0) +
      COALESCE(ess.special_allowance,0) + COALESCE(ess.other_allowance,0) +
      COALESCE(ess.bonus,0) + COALESCE(ess.pli,0)
    )) > 1.00 THEN 1 ELSE 0 END) AS gross_reconciliation_gap_count,

  -- Net gap (net_in_hand ≠ gross − statutory deductions)
  SUM(CASE
    WHEN ABS(ess.net_in_hand - (
      ess.gross - COALESCE(ess.epf_employee,0) - COALESCE(ess.esic_employee,0) - COALESCE(ess.professional_tax,0)
    )) > 1.00 THEN 1 ELSE 0 END) AS net_reconciliation_gap_count

FROM employee_salary_snapshot ess
JOIN employees e ON e.id = ess.employee_id;


-- ── B. 1970-epoch records (null lastUpdated) ──────────────────────────────────
SELECT '=== B. 1970-EPOCH RECORDS (NULL lastUpdated in legacy) ===' AS section;

SELECT
  e.employee_code,
  COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
  e.date_of_joining,
  ess.snapshot_date AS raw_snapshot_date,
  ess.gross,
  ess.ctc_offered,
  'NULL/epoch — lastUpdated was never set in legacy system' AS classification
FROM employee_salary_snapshot ess
JOIN employees e ON e.id = ess.employee_id
WHERE ess.snapshot_date <= '1970-01-02'
ORDER BY e.employee_code
LIMIT 100;


-- ── C. Zero-value salary rows ─────────────────────────────────────────────────
SELECT '=== C. ZERO-VALUE SALARY ROWS ===' AS section;

SELECT
  e.employee_code,
  COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
  e.employment_status,
  ess.snapshot_date,
  ess.basic, ess.gross, ess.ctc_offered,
  'Invalid zero-value revision — possible data-migration issue' AS classification
FROM employee_salary_snapshot ess
JOIN employees e ON e.id = ess.employee_id
WHERE ess.gross = 0 AND ess.ctc_offered = 0 AND ess.basic = 0
ORDER BY e.employee_code
LIMIT 100;


-- ── D. Gross reconciliation gaps ─────────────────────────────────────────────
SELECT '=== D. GROSS RECONCILIATION GAPS (|stored_gross - computed_gross| > ₹1) ===' AS section;

SELECT
  e.employee_code,
  COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
  ess.snapshot_date,
  ess.gross AS stored_gross,
  (COALESCE(ess.basic,0) + COALESCE(ess.hra,0) + COALESCE(ess.conveyance,0) +
   COALESCE(ess.portfolio_allowance,0) + COALESCE(ess.medical_allowance,0) +
   COALESCE(ess.special_allowance,0) + COALESCE(ess.other_allowance,0) +
   COALESCE(ess.bonus,0) + COALESCE(ess.pli,0)) AS computed_gross,
  ABS(ess.gross - (
    COALESCE(ess.basic,0) + COALESCE(ess.hra,0) + COALESCE(ess.conveyance,0) +
    COALESCE(ess.portfolio_allowance,0) + COALESCE(ess.medical_allowance,0) +
    COALESCE(ess.special_allowance,0) + COALESCE(ess.other_allowance,0) +
    COALESCE(ess.bonus,0) + COALESCE(ess.pli,0)
  )) AS gap_amount,
  'Gross ≠ sum of components — legacy entry discrepancy' AS classification
FROM employee_salary_snapshot ess
JOIN employees e ON e.id = ess.employee_id
WHERE ABS(ess.gross - (
  COALESCE(ess.basic,0) + COALESCE(ess.hra,0) + COALESCE(ess.conveyance,0) +
  COALESCE(ess.portfolio_allowance,0) + COALESCE(ess.medical_allowance,0) +
  COALESCE(ess.special_allowance,0) + COALESCE(ess.other_allowance,0) +
  COALESCE(ess.bonus,0) + COALESCE(ess.pli,0)
)) > 1.00
ORDER BY gap_amount DESC
LIMIT 100;


-- ── E. Net-in-hand reconciliation gaps ───────────────────────────────────────
SELECT '=== E. NET RECONCILIATION GAPS (|stored_net - computed_net| > ₹1) ===' AS section;

SELECT
  e.employee_code,
  COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
  ess.gross,
  ess.net_in_hand AS stored_net,
  (ess.gross - COALESCE(ess.epf_employee,0) - COALESCE(ess.esic_employee,0) - COALESCE(ess.professional_tax,0)) AS computed_net,
  ABS(ess.net_in_hand - (
    ess.gross - COALESCE(ess.epf_employee,0) - COALESCE(ess.esic_employee,0) - COALESCE(ess.professional_tax,0)
  )) AS gap_amount,
  CASE
    WHEN ess.net_in_hand > ess.gross THEN 'Net > Gross — impossible, data error'
    ELSE 'Possible unlisted deduction or rounding in legacy system'
  END AS classification
FROM employee_salary_snapshot ess
JOIN employees e ON e.id = ess.employee_id
WHERE ABS(ess.net_in_hand - (
  ess.gross - COALESCE(ess.epf_employee,0) - COALESCE(ess.esic_employee,0) - COALESCE(ess.professional_tax,0)
)) > 1.00
ORDER BY gap_amount DESC
LIMIT 100;


-- ── F. Orphan employee-code rows (same employee different codes) ──────────────
-- Detects employees that appear to be the same person under different codes
-- by matching: first_name + date_of_joining within 30 days
SELECT '=== F. POTENTIAL ORPHAN EMPLOYEE-CODE PAIRS ===' AS section;

SELECT
  e1.employee_code AS code_1,
  e2.employee_code AS code_2,
  COALESCE(NULLIF(e1.full_name,''), CONCAT(e1.first_name,' ',COALESCE(e1.last_name,''))) AS name_1,
  COALESCE(NULLIF(e2.full_name,''), CONCAT(e2.first_name,' ',COALESCE(e2.last_name,''))) AS name_2,
  e1.date_of_joining AS doj_1,
  e2.date_of_joining AS doj_2,
  ABS(DATEDIFF(e1.date_of_joining, e2.date_of_joining)) AS doj_diff_days,
  e1.employment_status AS status_1,
  e2.employment_status AS status_2,
  'Possible same person under different codes — verify manually' AS classification
FROM employees e1
JOIN employees e2
  ON e1.first_name = e2.first_name
  AND ABS(DATEDIFF(COALESCE(e1.date_of_joining,'1900-01-01'), COALESCE(e2.date_of_joining,'1900-01-01'))) <= 30
  AND e1.id < e2.id  -- avoid duplicates A-B and B-A
  AND e1.employee_code <> e2.employee_code
WHERE e1.legacy_emp_id IS NOT NULL
  AND e2.legacy_emp_id IS NOT NULL
ORDER BY e1.first_name, doj_diff_days
LIMIT 100;


-- ── G. Employees with salary snapshot vs increment request mismatch ──────────
SELECT '=== G. LATEST APPROVED INCREMENT vs SNAPSHOT MISMATCH ===' AS section;

SELECT
  e.employee_code,
  COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
  ess.gross AS snapshot_gross,
  ess.ctc_offered AS snapshot_ctc,
  sir.proposed_ctc AS approved_ctc,
  sir.effective_from AS increment_effective_from,
  sir.status AS increment_status,
  ABS(ess.ctc_offered - sir.proposed_ctc) AS ctc_variance,
  CASE
    WHEN ABS(ess.ctc_offered - sir.proposed_ctc) > 1000
      THEN 'Snapshot not updated after approved increment — sync may have overwritten with older legacy data'
    WHEN ABS(ess.ctc_offered - sir.proposed_ctc) <= 1000
      THEN 'Minor rounding or component difference'
  END AS classification
FROM employee_salary_snapshot ess
JOIN employees e ON e.id = ess.employee_id
JOIN (
  SELECT employee_id, proposed_ctc, effective_from, status,
         ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY effective_from DESC) AS rn
  FROM salary_increment_request
  WHERE status = 'implemented'
) sir ON sir.employee_id = ess.employee_id AND sir.rn = 1
WHERE ABS(ess.ctc_offered - sir.proposed_ctc) > 100
ORDER BY ctc_variance DESC
LIMIT 100;


-- ── H. Final classification summary ──────────────────────────────────────────
SELECT '=== H. ROW CLASSIFICATION COUNTS ===' AS section;

SELECT
  classification,
  COUNT(*) AS row_count
FROM (
  SELECT
    CASE
      WHEN ess.gross = 0 AND ess.ctc_offered = 0 AND ess.basic = 0
        THEN 'Invalid zero-value revision'
      WHEN ess.snapshot_date <= '1970-01-02'
        THEN 'Data-migration issue (1970 epoch date)'
      WHEN ABS(ess.gross - (
        COALESCE(ess.basic,0) + COALESCE(ess.hra,0) + COALESCE(ess.conveyance,0) +
        COALESCE(ess.portfolio_allowance,0) + COALESCE(ess.medical_allowance,0) +
        COALESCE(ess.special_allowance,0) + COALESCE(ess.other_allowance,0) +
        COALESCE(ess.bonus,0) + COALESCE(ess.pli,0)
      )) > 1.00
        THEN 'Gross reconciliation gap'
      ELSE 'Current salary revision (clean)'
    END AS classification
  FROM employee_salary_snapshot ess
) t
GROUP BY classification
ORDER BY row_count DESC;
