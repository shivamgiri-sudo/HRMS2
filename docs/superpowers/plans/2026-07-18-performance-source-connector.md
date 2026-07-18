# Performance Source Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync Mydashboards/live-source KPI facts into HRMS using the audited formulas without writing to upstream databases.

**Architecture:** Keep the existing KPI sync API and worker surface, but replace the brittle APR-only query with source-specific read-only aggregators. Write facts only to `mas_hrms.kpi_daily_actual`, using Phase 1 lineage columns when migration 504 is present and falling back to the legacy columns when it is not.

**Tech Stack:** Express, TypeScript, mysql2, Vitest, existing `integration_config` external DB pool pattern.

## Global Constraints

- No production SQL execution in this phase.
- No credentials in source files.
- Upstream source databases are read-only.
- All new writes target `mas_hrms` only.
- Existing `POST /api/kpi-master/sync` remains backward-compatible.

---

### Task 1: Connector Contract Tests

**Files:**
- Create: `backend/src/modules/kpi/__tests__/kpi-data-connector.service.test.ts`
- Modify: `backend/src/modules/kpi/kpi-data-connector.service.ts`

**Checks:**
- APR uses `vw_agent_log_all.user`, `event_time`, `talk_sec`, `dispo_sec`, and call counts.
- Quality uses `SUM(total_score) / SUM(max_score) * 100` and fatal uses `quality_percentage = 0`.
- Conversion uses `SUM(SaleDone = 1) / COUNT(*) * 100`.
- Employee matching accepts employee code first and biometric code second.
- Missing upstream credentials/errors are returned in the sync result instead of silently pretending zero work happened.

### Task 2: Safe Daily Actual Upsert

**Files:**
- Modify: `backend/src/modules/kpi/kpi-data-connector.service.ts`

**Checks:**
- If migration 504 columns exist, insert numerator, denominator, source system, source record count, formula version id, run id, and computed timestamp.
- If migration 504 columns do not exist, insert only legacy columns.
- Draft formula versions are recorded only as lineage and are not marked active by code.

### Task 3: Source Aggregators

**Files:**
- Modify: `backend/src/modules/kpi/kpi-data-connector.service.ts`

**Checks:**
- `syncAprMetrics(date)` computes DIALS, TALK_TIME, AHT, and ACW from the live dialer view.
- `syncQualityMetrics(yearMonth)` reads the audited quality source when configured.
- `syncConversionMetrics(date)` reads the audited outbound source when configured.
- All source queries are date-bounded.

### Task 4: Route/Worker Compatibility

**Files:**
- Modify: `backend/src/modules/kpi/kpi-master.routes.ts`
- Modify: `backend/src/workers/kpi-daily-sync.worker.ts`

**Checks:**
- Existing request bodies keep working.
- Date-based sync also runs conversion.
- Quality sync response exposes skipped/errors honestly.

### Task 5: Verification

**Commands:**
- `npm run test -- src/modules/kpi/__tests__/kpi-data-connector.service.test.ts`
- `npm run typecheck`
- `git diff --check`
- Secret/destructive SQL scan over changed files.
