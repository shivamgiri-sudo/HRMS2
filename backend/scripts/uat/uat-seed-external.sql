-- =============================================================================================
-- UAT seed for the EXTERNAL database (uat-external-mysql, 127.0.0.1:13307, database dialer_uat).
--
-- This is a genuinely separate MySQL server, not another schema on the same one. That distinction is
-- the whole point of the integration_connector source type: the KPI Studio has to open a second
-- connection pool through external-db.service.ts, with its own encrypted credentials, and query a
-- table it cannot join to. Putting this table in mas_hrms_test would have exercised none of that.
--
-- Keys on AGENT CODE, not on the HRMS employee id, because that is how a real dialer behaves — it
-- has never heard of employees.id. readConnectorQuery resolves ids to codes before querying, and
-- this table is what proves that translation happens.
-- =============================================================================================

CREATE TABLE IF NOT EXISTS agent_daily_productivity (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  agent_code      VARCHAR(32)   NOT NULL,
  stat_date       DATE          NOT NULL,
  calls_offered   INT           NOT NULL DEFAULT 0,
  calls_handled   INT           NOT NULL DEFAULT 0,
  talk_time_sec   INT           NOT NULL DEFAULT 0,
  sales_closed    INT           NOT NULL DEFAULT 0,
  UNIQUE KEY uq_agent_day (agent_code, stat_date),
  KEY idx_stat_date (stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DELETE FROM agent_daily_productivity WHERE agent_code LIKE 'UAT%';

-- 2026-03-01..2026-08-31 for the four working agents. Deterministic from the day number so a
-- re-run yields identical KPI values.
INSERT INTO agent_daily_productivity (agent_code, stat_date, calls_offered, calls_handled, talk_time_sec, sales_closed)
WITH RECURSIVE d AS (
  SELECT DATE('2026-03-01') AS dt
  UNION ALL SELECT dt + INTERVAL 1 DAY FROM d WHERE dt < DATE('2026-08-31')
),
a AS (
  SELECT 'UAT001' AS code, 1 AS seed UNION ALL SELECT 'UAT002', 2
  UNION ALL SELECT 'UAT003', 3 UNION ALL SELECT 'UAT004', 4
)
SELECT
  a.code,
  d.dt,
  80 + (DAYOFMONTH(d.dt) * a.seed) % 40                       AS calls_offered,
  70 + (DAYOFMONTH(d.dt) * a.seed) % 30                       AS calls_handled,
  9000 + (DAYOFMONTH(d.dt) * a.seed * 37) % 4000              AS talk_time_sec,
  -- Deliberately 0 on some days: a zero numerator is a real value and must NOT be confused with a
  -- missing one. The formula engine treats null and 0 differently on purpose.
  CASE WHEN (DAYOFMONTH(d.dt) * a.seed) % 5 = 0 THEN 0
       ELSE 1 + (DAYOFMONTH(d.dt) * a.seed) % 6 END           AS sales_closed
FROM d CROSS JOIN a
WHERE NOT (a.code = 'UAT004' AND d.dt > DATE('2026-07-18'));

SELECT COUNT(*) AS rows_seeded, MIN(stat_date) AS from_date, MAX(stat_date) AS to_date
FROM agent_daily_productivity WHERE agent_code LIKE 'UAT%';
