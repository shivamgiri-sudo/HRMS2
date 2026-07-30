-- 438_pnl_people_classification_seed_v2.sql
--
-- Supersedes 436, which FAILED on "Field 'rule_name' doesn't have a default value" and could not
-- be retried: the migration runner had already written its filename into schema_migrations, so a
-- re-run hit a duplicate primary key. Tracking is by filename, so the corrected statement ships
-- under a new name rather than by editing a file the runner considers spent.
--
-- Also folds in the WFM decision that 437 expressed as a DELETE: DIALER & WFM gets NO blanket
-- rule. WFM is not shared-by-nature the way HR, IT, Administration and Finance are — a WFM person
-- mapped to a process is that process's own support (DSC), and one who is not is working across
-- branches (BMC). The fallback in bpo-pnl.service.ts already expresses exactly that:
--
--   bucket = process_id ? (isSupportRole(person) ? 'dsc_people' : 'agent_salary')
--                       : 'bmc_people'
--
-- isSupportRole() already matches wfm/workforce, so leaving WFM unseeded gives the right answer in
-- both directions. 437 remains applied and is now a harmless no-op.
--
-- The definition being encoded:
--   Agent  — the front-line agents of a process.
--   DSC    — that cost centre's / process's own support: team leader, quality auditor, trainer,
--            assistant manager, the process manager. Non-agent but process-specific.
--   BMC    — resources used ACROSS branches: Administration, HR, IT, Finance, Management, and the
--            branch head.
--
-- Department-scoped rules, so they apply organisation-wide and need no per-branch maintenance.
-- Priority 50 keeps them ahead of any narrower rule added later at the default 100; an
-- employee-scoped or designation-scoped exception can still be added at a lower number to win.
-- Rows carry NULL process_id / branch_id, meaning "everywhere".
--
-- Rollback:
--   DELETE FROM pnl_cost_classification_rule WHERE scope_type = 'department' AND priority = 50;

INSERT INTO pnl_cost_classification_rule
  (id, rule_name, scope_type, scope_key, process_id, branch_id, pnl_bucket, priority,
   effective_from, effective_to, active_status)
SELECT UUID(),
       CONCAT('Department: ', d.dept_name, ' -> ', x.bucket),
       'department', d.dept_name, NULL, NULL, x.bucket, 50, '2020-01-01', NULL, 1
  FROM department_master d
  JOIN (
    -- Shared across branches -> BMC
    SELECT 'ADMINISTRATION'                   AS dept, 'bmc_people' AS bucket
    UNION ALL SELECT 'FINANCE & ACCOUNTS',            'bmc_people'
    UNION ALL SELECT 'HUMAN RESOURCE AND DEVELOPMENT','bmc_people'
    UNION ALL SELECT 'INFORMATION TECHNOLOGY',        'bmc_people'
    UNION ALL SELECT 'MANAGEMENT',                    'bmc_people'
    UNION ALL SELECT 'PROJECTS & COMPLIANCE',         'bmc_people'
    UNION ALL SELECT 'SALES & MARKETING',             'bmc_people'
    -- Process-specific support -> DSC. Operations is deliberately absent: within it the split
    -- between agent and support is a designation question, which the existing fallback handles.
    UNION ALL SELECT 'TRAINING AND QUALITY',          'dsc_people'
  ) x ON UPPER(TRIM(d.dept_name)) = UPPER(x.dept)
 WHERE NOT EXISTS (
   SELECT 1 FROM pnl_cost_classification_rule r
    WHERE r.scope_type = 'department'
      AND UPPER(TRIM(r.scope_key)) = UPPER(TRIM(d.dept_name))
      AND r.priority = 50
 );
