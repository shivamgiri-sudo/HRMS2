-- Migration 433: Attendance half-day threshold update
-- Date: 2026-08-23
--
-- Changes:
--   1. Global biometric default: half_day_minutes 240 → 270 (4.5 hrs)
--      Applies to: all non-executive designations (TL, QA, Trainer, Manager, HR, IT, Admin, etc.)
--
--   2. Add designation-specific biometric rules for all 27 EXECUTIVE variants: half_day=240
--      These override the global rule via specificity scoring (designation_id = score 4 vs global = score 0)
--      Ensures Executives (biometric fallback) stay at 240 min, consistent with APR path.
--
--   3. APR rules (arc-agent-001, arc-apr-ops-exec) UNCHANGED at half_day=240.
--
-- Result:
--   Executive designations (APR or biometric): half_day = 240 min (4 hrs)
--   All other designations:                    half_day = 270 min (4.5 hrs)

-- 1. Update global biometric default
UPDATE attendance_rule_config
SET half_day_minutes = 270, updated_at = NOW()
WHERE id = 'arc-global-001' AND attendance_source = 'biometric';

-- 2. Update feature flag
UPDATE attendance_feature_config
SET config_value = '270', updated_at = NOW(), updated_by = 'system'
WHERE config_key = 'biometric_half_day_floor_minutes';

-- 3. Insert designation-specific biometric rules for all Executive variants (half_day=240)
--    Uses INSERT IGNORE so safe to re-run.
INSERT IGNORE INTO attendance_rule_config
  (id, rule_name, scope_type, designation_id, process_id, branch_id,
   attendance_source, full_day_minutes, half_day_minutes, grace_minutes,
   effective_from, effective_to, notes, active_status, created_by, created_at, updated_at)
SELECT
  CONCAT('arc-exec-bio-', LEFT(dm.id,8)),
  CONCAT('Biometric Rule — ', dm.designation_name),
  'designation',
  dm.id,
  NULL, NULL,
  'biometric',
  540,
  240,
  15,
  '2026-01-01',
  NULL,
  'Designation-specific biometric rule. Executives use 240-min half-day. Global biometric default uses 270 for non-executive roles.',
  1,
  'system',
  NOW(), NOW()
FROM designation_master dm
WHERE dm.designation_name REGEXP '[Ee]xecutive';
