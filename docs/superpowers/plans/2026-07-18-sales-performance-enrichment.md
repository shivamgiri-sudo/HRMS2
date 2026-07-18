# Phase 2E: Sales Performance Enrichment

## Current behaviour

- HRMS can now ingest APR, quality, conversion, attendance, and brand APR facts into `kpi_daily_actual`.
- Existing sales upload/schema foundations already define `db_masmis.bb_sale` and `db_masmis.gnc_sale`.
- Rich sales measures were not yet available as reusable Performance Hub facts.

## Implementation scope

- Add sales-order KPI sync from `db_masmis.bb_sale` and `db_masmis.gnc_sale`.
- Capture daily `SALES_COUNT`, `REVENUE`, `AOV`, `COD_SHARE`, and `RTO_RATE` per mapped employee.
- Add those metrics to Performance Hub aggregation and frontend formatting so later role dashboards can reuse the same facts.
- Add read-only preview support for sales order data before any write sync.

## Files changed

- `backend/sql/506_sales_performance_metric_foundation.sql`
- `backend/src/db/runPendingMigrations.ts`
- `backend/src/modules/kpi/kpi-data-connector.service.ts`
- `backend/src/modules/kpi/performance-source-preview.service.ts`
- `backend/src/modules/kpi/kpi-master.routes.ts`
- `backend/src/workers/kpi-daily-sync.worker.ts`
- `backend/src/modules/kpi/__tests__/kpi-data-connector.service.test.ts`
- `backend/src/modules/kpi/__tests__/performance-source-preview.service.test.ts`
- `backend/src/modules/performance-intelligence/performance-intelligence.contracts.ts`
- `backend/src/modules/performance-intelligence/performance-intelligence.formulas.ts`
- `backend/src/modules/performance-intelligence/__tests__/performance-intelligence.formulas.test.ts`
- `src/types/performanceHub.ts`
- `src/components/performance-hub/PerformanceMetricGrid.tsx`

## Database and API impact

- No production SQL was executed.
- Migration 506 is additive only and seeds missing sales metric/formula definitions.
- Existing `POST /api/kpi-master/sync` now returns `salesOrders` when `date` is supplied.
- Existing read-only preview now reports both `salesBrandMis` and `salesOrders`.

## Rollback

- Revert this phase's code changes and do not run migration 506.
- If migration 506 was applied in staging, leave seeded metrics inactive/draft or remove them only after confirming no KPI facts reference them.
