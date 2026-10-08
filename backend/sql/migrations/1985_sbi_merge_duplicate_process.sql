-- Migration 1985: one SBI process, not two.
--
-- Process Operations listed TWO SBI processes with different dashboards:
--   * "SBI Credit Cards" (SBI_CREDIT_CARDS, Ahmedabad Jaldarshan): the REAL process - its cost centre, staff, ATS
--     requisition and master-employee rows - but no dashboard.
--   * "SBI Card Collections" (SBI_CARD): created by migration 1932 beside it, no branch, no cost centre, no staff, empty
--     data tables - but the dashboard, the five uploaders and the KPI metrics, all of which find their process BY CODE.
-- Merge them onto the real one without touching a single code path: the real process takes the code SBI_CARD, so the
-- dashboard / uploaders / KPI registry / access catalog resolve to it. The duplicate is RETIRED, never deleted.
--
-- Every step is guarded and every statement touches tiny, key-addressed tables (startup-safe, no ALTER, no hot table):
--   * does nothing unless BOTH processes are as expected (real one exists, duplicate still holds the code SBI_CARD);
--   * does nothing if the duplicate has employees or cost centres (it would then not be an empty duplicate);
--   * does nothing if the five SBI tables already hold more than 5,000 rows (moving them is not an instant step);
--   * idempotent - a second run finds nothing to do.
-- Nothing in the code is keyed to the code SBI_CREDIT_CARDS (searched), and process_master is the only table storing it.
--
-- ROLLBACK (all reversible, nothing deleted):
--   UPDATE process_master SET process_code='SBI_CREDIT_CARDS' WHERE id=<real id>;
--   UPDATE process_master SET process_code='SBI_CARD', slug='sbi-card-collections', active_status=1 WHERE process_code='SBI_CARD_RETIRED';
--   and move process_dashboard_config.process_id back to the retired id.

SET @real_id = (SELECT id FROM process_master WHERE process_code = 'SBI_CREDIT_CARDS' ORDER BY active_status DESC, id LIMIT 1);
SET @dup_id  = (SELECT id FROM process_master WHERE process_code = 'SBI_CARD' AND id <> COALESCE(@real_id, '') ORDER BY id LIMIT 1);

SET @dup_busy = (
  (SELECT COUNT(*) FROM employees WHERE process_id = @dup_id)
  + (SELECT COUNT(*) FROM cost_centre_master WHERE process_id = @dup_id)
);
SET @sbi_rows = (
  (SELECT COUNT(*) FROM sbi_card_dialer_mis       WHERE process_id = @dup_id)
  + (SELECT COUNT(*) FROM sbi_card_agent_mis      WHERE process_id = @dup_id)
  + (SELECT COUNT(*) FROM sbi_card_account_file   WHERE process_id = @dup_id)
  + (SELECT COUNT(*) FROM sbi_card_downtime       WHERE process_id = @dup_id)
  + (SELECT COUNT(*) FROM sbi_card_pen_estimation WHERE process_id = @dup_id)
);
SET @ok = (@real_id IS NOT NULL AND @dup_id IS NOT NULL AND @dup_busy = 0 AND @sbi_rows <= 5000);

-- 1. Move what hangs off the duplicate onto the real process (tiny tables; empty today).
SET @sql = IF(@ok, "UPDATE sbi_card_dialer_mis       SET process_id = @real_id WHERE process_id = @dup_id", "SELECT 1"); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql = IF(@ok, "UPDATE sbi_card_agent_mis        SET process_id = @real_id WHERE process_id = @dup_id", "SELECT 1"); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql = IF(@ok, "UPDATE sbi_card_account_file     SET process_id = @real_id WHERE process_id = @dup_id", "SELECT 1"); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql = IF(@ok, "UPDATE sbi_card_downtime         SET process_id = @real_id WHERE process_id = @dup_id", "SELECT 1"); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql = IF(@ok, "UPDATE sbi_card_pen_estimation   SET process_id = @real_id WHERE process_id = @dup_id", "SELECT 1"); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- KPI values the importers already rolled up under the duplicate (process-grain). Only rows that would not collide.
SET @sql = IF(@ok, "UPDATE process_metric_actual a SET a.process_id = @real_id WHERE a.process_id = @dup_id AND NOT EXISTS (SELECT 1 FROM (SELECT metric_key, score_date FROM process_metric_actual WHERE process_id = @real_id) r WHERE r.metric_key = a.metric_key AND r.score_date = a.score_date)", "SELECT 1"); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The config-driven dashboard registration (disabled today) follows the real process, unless it already has one.
SET @sql = IF(@ok, "UPDATE process_dashboard_config SET process_id = @real_id WHERE process_id = @dup_id AND NOT EXISTS (SELECT 1 FROM (SELECT process_id FROM process_dashboard_config WHERE process_id = @real_id) x)", "SELECT 1"); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. Retire the duplicate: frees the code SBI_CARD, hides it from Process Operations. Not deleted.
SET @sql = IF(@ok, "UPDATE process_master SET process_code = 'SBI_CARD_RETIRED', slug = 'sbi-card-collections-retired', active_status = 0 WHERE id = @dup_id", "SELECT 1"); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. The real process takes the code every SBI code path looks for. Its name, branch, cost centre and staff are untouched.
SET @sql = IF(@ok, "UPDATE process_master SET process_code = 'SBI_CARD' WHERE id = @real_id AND process_code = 'SBI_CREDIT_CARDS'", "SELECT 1"); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
