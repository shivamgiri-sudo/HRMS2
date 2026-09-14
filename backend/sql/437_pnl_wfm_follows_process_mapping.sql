-- 437_pnl_wfm_follows_process_mapping.sql
--
-- Removes the blanket "DIALER & WFM -> bmc_people" rule seeded by 436.
--
-- WFM is not shared-by-nature the way HR, IT, Administration and Finance are. A WFM person mapped
-- to a specific process is that process's own support and belongs to DSC; a WFM person not mapped
-- to a process is working across branches and belongs to BMC. Classifying the whole department as
-- BMC put process-mapped WFM staff in the wrong bucket and understated DSC.
--
-- No replacement rule is needed, because the fallback in bpo-pnl.service.ts already expresses
-- exactly this:
--
--   bucket = process_id ? (isSupportRole(person) ? 'dsc_people' : 'agent_salary')
--                       : 'bmc_people'
--
-- isSupportRole() already matches wfm/workforce, so with no department rule in the way:
--   WFM person WITH a process_id    -> dsc_people   (process-specific support)
--   WFM person WITHOUT a process_id -> bmc_people   (shared across branches)
--
-- The departments that ARE shared by nature keep their blanket BMC rules from 436:
-- Administration, Finance & Accounts, Human Resource and Development, Information Technology,
-- Management, Projects & Compliance, Sales & Marketing. Training and Quality keeps its DSC rule.
--
-- Rollback:
--   INSERT INTO pnl_cost_classification_rule
--     (id, scope_type, scope_key, process_id, branch_id, pnl_bucket, priority,
--      effective_from, effective_to, active_status)
--   SELECT UUID(), 'department', d.dept_name, NULL, NULL, 'bmc_people', 50, '2020-01-01', NULL, 1
--     FROM department_master d WHERE UPPER(TRIM(d.dept_name)) = 'DIALER & WFM';

DELETE FROM pnl_cost_classification_rule
 WHERE scope_type = 'department'
   AND priority = 50
   AND UPPER(TRIM(scope_key)) = 'DIALER & WFM';
