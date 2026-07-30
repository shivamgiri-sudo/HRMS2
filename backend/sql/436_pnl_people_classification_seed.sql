-- 436_pnl_people_classification_seed.sql
--
-- Seeds pnl_cost_classification_rule so payroll splits into Agent / DSC / BMC the way the business
-- defines them. The table, the buckets and the matching engine all already existed; nothing was
-- ever seeded, so every person fell through to the fallback in bpo-pnl.service.ts:
--
--   bucket = person.process_id
--     ? (isSupportRole(person) ? 'dsc_people' : 'agent_salary')
--     : 'bmc_people'
--
-- That fallback has two problems against the real definition:
--
--   1. BMC can only ever happen when process_id is NULL. An HR, IT or Admin person attached to a
--      process — which is common — is classified DSC or Agent, never BMC.
--   2. isSupportRole() treats quality, training, WFM, MIS, HR, admin, IT and finance as one
--      "support" class. They are not: Quality and Training are process-specific support and belong
--      to DSC, while HR, IT, Admin, Finance and Management are shared across branches and belong
--      to BMC.
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
  (id, scope_type, scope_key, process_id, branch_id, pnl_bucket, priority,
   effective_from, effective_to, active_status)
SELECT UUID(), 'department', d.dept_name, NULL, NULL, x.bucket, 50, '2020-01-01', NULL, 1
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
    UNION ALL SELECT 'DIALER & WFM',                  'bmc_people'
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
