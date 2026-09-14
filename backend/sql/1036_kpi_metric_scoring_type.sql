-- 1036_kpi_metric_scoring_type.sql
--
-- Lets a metric declare how it is scored, so min_threshold can finally do something.
--
-- kpi_master_config has carried min_threshold on all 291 production rows since it was
-- created, and the scoring engine has never read it. calculateMetricScore()'s higher/lower
-- better branches use only (actual / target); minValue is consulted by the 'range' type
-- alone, which nothing selects. So every configured floor and ceiling is inert:
--   DIALS          target 80    floor 60     — an agent on 30 dials still scores 37.5%
--   TALK_TIME      target 240s  ceiling 360s — 480s still scores 50%
--   ATTENDANCE_PCT target 95%   floor 85%
--
-- Deliberately opt-in rather than switching the floor on everywhere. Measured against live
-- actuals, a blanket change would score zero for:
--   ATTENDANCE_PCT  33,423 of 38,415 rows (87.0%)
--   DIALS              738 of  2,113 rows (34.9%)
--   TALK_TIME           18 of  2,113 rows ( 0.9%)
-- Attendance only ever holds 0/50/100, so every half-day sits below the 85 floor and would
-- fall from 52.6% to 0. That is a data artefact, not a performance judgement.
--
-- NULL scoring_type keeps today's behaviour exactly. No score moves until a metric is
-- explicitly opted in.
--
-- Safe to re-run.

SET @has_scoring_type := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'kpi_metric_master'
     AND COLUMN_NAME = 'scoring_type'
);
SET @sql := IF(@has_scoring_type = 0,
  'ALTER TABLE kpi_metric_master
     ADD COLUMN scoring_type VARCHAR(30) NULL
       COMMENT "How this metric scores. NULL = ratio to target, ignoring min_threshold (legacy default). floor_gated_higher / floor_gated_lower = score 0 once min_threshold is breached."
       AFTER direction',
  'SELECT "scoring_type already present" AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- No metric is opted in here. Turn one on deliberately, e.g.:
--   UPDATE kpi_metric_master SET scoring_type = 'floor_gated_lower'  WHERE metric_code = 'AHT';
--   UPDATE kpi_metric_master SET scoring_type = 'floor_gated_higher' WHERE metric_code = 'SALES_COUNT';
-- and leave ATTENDANCE_PCT alone until it stops being a 0/50/100 flag.

SELECT metric_code, unit, direction, scoring_type
  FROM kpi_metric_master
 ORDER BY metric_code;
