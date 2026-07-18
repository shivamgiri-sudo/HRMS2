# Performance Source Activation Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a read-only validation path for live Mydashboards performance sources before any production KPI writes are activated.

**Architecture:** Keep credentials in the existing Integration Hub `integration_config` system. Add inactive metadata-only connector keys, a backend preview service that reads the same source formulas without writing facts, and a CLI command that prints mapping/formula readiness for a date/month.

**Tech Stack:** TypeScript, mysql2, existing external DB pools, Vitest, tsx scripts.

## Global Constraints

- No credentials in source files.
- No upstream writes.
- No production SQL execution in this implementation step.
- Preview command is read-only and must not call `INSERT`, `UPDATE`, `DELETE`, `ALTER`, or `DROP`.
- Connector placeholders are inactive until configured by an admin.

---

### Task 1: Preview Service

**Files:**
- Create: `backend/src/modules/kpi/performance-source-preview.service.ts`
- Test: `backend/src/modules/kpi/__tests__/performance-source-preview.service.test.ts`

**Checks:**
- Previews APR, quality, and conversion formulas.
- Reports source rows, mapped rows, unmapped rows, sample metric values, connector status, and errors.
- Does not write KPI facts.

### Task 2: Operator Command

**Files:**
- Create: `backend/scripts/performance-source-preview.ts`
- Modify: `backend/package.json`

**Checks:**
- `npm run performance:preview -- --date=YYYY-MM-DD --year-month=YYYY-MM` prints a read-only validation report.

### Task 3: Connector Metadata

**Files:**
- Create: `backend/sql/505_performance_source_connector_keys.sql`
- Modify: `backend/src/db/runPendingMigrations.ts`

**Checks:**
- Adds inactive connector placeholders for `quality_audit`, `outbound_calls`, and `sales_brand_mis`.
- Does not include secrets.

### Task 4: Verification

**Commands:**
- `npm run test -- src/modules/kpi/__tests__/performance-source-preview.service.test.ts src/modules/kpi/__tests__/kpi-data-connector.service.test.ts`
- `npm run typecheck`
- `git diff --check`
- Changed-file secret/destructive SQL scan.