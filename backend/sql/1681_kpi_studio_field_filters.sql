-- KPI Studio: per-field filters.
--
-- A field could only be AGG(column) over every row the source returned. That
-- cannot express the pair most call-centre and sales metrics are built from:
-- two differently-filtered numbers out of the SAME table in one query. AL% is
-- answered/offered, where offered is every call and answered is the calls that
-- reached an agent; SL% and Abn% have the same shape. Those had to be
-- hand-written in TypeScript (quality-dashboard/inbound-ops.service.ts, and
-- again in process-performance/kpi-cdr-source.ts) precisely because they could
-- not be configured.
--
-- A filter compiles to AGG(CASE WHEN <condition> THEN column END) — the same
-- shape those hand-written queries already use. Columns are validated as
-- identifiers, operators come from a fixed map, and every value is bound.
--
-- Deliberately no ELSE branch: when nothing matches, the answer is NULL rather
-- than 0, so "no rows here" stays distinguishable from "measured zero". A
-- formula that genuinely wants a zero says COALESCE(x, 0) and means it.
--
-- Purely additive: NULL means no filters, which is exactly how every existing
-- field already behaves.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_studio_source_field'
              AND COLUMN_NAME = 'filter_json');
SET @s := IF(@c = 0,
  'ALTER TABLE kpi_studio_source_field ADD COLUMN filter_json JSON NULL AFTER source_expression',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
