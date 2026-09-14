-- 1089_finance_approval_event.sql
-- A workflow history that cannot silently lose a row.
--
-- THE PROBLEM THIS SOLVES
-- Finance has exactly one workflow-history table today: finance_budget_approval_log
-- (411_branch_budget_grn_approval_flow.sql:80-93), and it is budget-only — it carries a
-- budget_id FK, not an entity type. GRN, top-up, imprest and vendor payment have nothing.
-- A GRN records its transitions by OVERWRITING reviewed_by / reviewed_at / review_note on
-- grn_request, so a GRN that was rejected, corrected and then approved retains only the
-- last actor. Requirement 9 (imprest returned to Branch Head, reason preserved, resubmit,
-- history intact) is impossible against that shape.
--
-- WHY NOT REUSE THE EXISTING AUDIT TABLES
-- audit_action_log and sensitive_action_log (backend/src/shared/auditLog.ts) are
-- deliberately NON-THROWING: on failure they print to stderr and let the primary operation
-- continue. That is right for security telemetry and wrong for a workflow history — a
-- history that can drop a row is not a history. 1033_sensitive_action_log_entity_id_width.sql
-- records what that costs in practice: 26 approved regularizations left no trail at all
-- because entity_id overflowed and the write was silently dropped. Neither table has
-- from_status / to_status either.
--
-- Writers of this table MUST pass the same PoolConnection as the status UPDATE, inside the
-- same transaction, and MUST let errors propagate. Existing logSensitiveAction calls stay
-- exactly as they are — they serve a different purpose and are not replaced.
--
-- WHY NOT GENERALISE finance_budget_approval_log INSTEAD
-- It carries `budget_id CHAR(36) NOT NULL` with `FOREIGN KEY ... REFERENCES
-- finance_budget_header(id) ON DELETE CASCADE`. Generalising means dropping a live FK on a
-- table with production rows and live readers — a destructive change to the only working
-- finance audit trail, to save one table. It is left completely untouched.
--
-- entity_id has NO foreign key on purpose: it is polymorphic across grn_request,
-- finance_budget_topup_request, imprest_allocation and vendor_payment_tracking. entity_type
-- is what disambiguates. Width is VARCHAR(64), not CHAR(36), so a composite key never
-- overflows the way it did in 1033.
--
-- NO BACKFILL HERE. Historical timelines can be reconstructed from grn_request's
-- submitted_at / branch_head_reviewed_at / finance_head_reviewed_at / approved_at columns,
-- but that is a separate, reviewable data step: it would write one row per historical
-- transition at boot, and a migration that writes tens of thousands of rows while
-- MIGRATION_STOP_ON_FAILURE is true is a startup risk this table does not need to carry.
-- Until then a historical entity simply has no events, which reads honestly as
-- "not captured" rather than as invented history.
--
-- Additive only, safe to rerun.

CREATE TABLE IF NOT EXISTS finance_approval_event (
  id CHAR(36) NOT NULL,
  entity_type VARCHAR(60) NOT NULL COMMENT 'grn | budget | budget_topup | imprest_allocation | vendor_payment',
  entity_id VARCHAR(64) NOT NULL COMMENT 'Polymorphic; deliberately no FK. Wider than CHAR(36) so a composite key cannot overflow.',
  action VARCHAR(80) NOT NULL COMMENT 'submit | approve | reject | return | resubmit | cancel | override | reverse | billing_cycle_set',
  from_status VARCHAR(60) NULL,
  to_status VARCHAR(60) NOT NULL,
  decision VARCHAR(40) NULL,
  actor_user_id CHAR(36) NOT NULL,
  actor_role VARCHAR(80) NOT NULL COMMENT 'The role that OWNS the stage, from resolveFinanceStageRole - not necessarily the actor''s primary role',
  remarks TEXT NULL,
  details_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_finance_approval_entity (entity_type, entity_id, created_at),
  INDEX idx_finance_approval_actor (actor_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1089_finance_approval_event.sql applied' AS migration_status;
