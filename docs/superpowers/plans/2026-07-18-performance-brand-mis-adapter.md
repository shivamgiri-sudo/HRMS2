# Phase 2D: Performance Brand MIS Adapter

## Current behaviour

- HRMS Performance Hub has a safe scorecard API and role-scoped UI.
- KPI connector sync supports APR productivity, quality audit, attendance, and outbound conversion sources.
- Connector metadata includes `sales_brand_mis`, but the code did not yet read the existing `db_masmis` brand APR tables.

## Implementation scope

- Add a backend adapter for existing `db_masmis.bb_apr` and `db_masmis.gnc_apr`.
- Produce daily KPI facts for DIALS, AHT, CONVERSION_RATE, SALES_COUNT, and QUALITY_SCORE.
- Add the same source to the read-only preview so activation can be validated before writes.
- Wire the adapter into the existing admin KPI sync route and nightly worker.

## Files changed

- `backend/src/modules/kpi/kpi-data-connector.service.ts`
- `backend/src/modules/kpi/performance-source-preview.service.ts`
- `backend/src/modules/kpi/kpi-master.routes.ts`
- `backend/src/workers/kpi-daily-sync.worker.ts`
- `backend/src/modules/kpi/__tests__/kpi-data-connector.service.test.ts`
- `backend/src/modules/kpi/__tests__/performance-source-preview.service.test.ts`

## Database and API impact

- No production SQL was executed.
- No new public API route was added.
- Existing `POST /api/kpi-master/sync` now includes `salesBrandMis` when a date is supplied.
- Existing read-only preview command now includes `salesBrandMis`.

## Known boundary

- `neemans_apr` and `neemans_sale_raw` remain reserved connector metadata because this repository does not yet contain their actual table contract.
