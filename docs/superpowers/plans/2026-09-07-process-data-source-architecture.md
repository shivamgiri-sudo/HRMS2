# Process Data Source Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each client process supply the KPI figures HRMS cannot measure itself — either by entering/uploading them, or by connecting the client's own database — and have the Process KPI Dashboard read them through the same honest resolver contract as every other source.

**Architecture:** A new process-grain table `process_metric_actual` receives values from two writers: a manual entry/upload path, and a connector path that aggregates a mapped column out of an external database registered in the existing `integration_config` store. `kpi-metric-registry.ts` gains a fourth source marker (`processSource`) and `kpi-scorecard.service.ts` resolves it, exactly as it already resolves `kpiMetricCode`, `cdrSource` and the Shivamgiri fallback.

**Tech Stack:** Express + TypeScript, MySQL (`mas_hrms`), `mysql2/promise`, Vitest, React 18 + Vite + shadcn/Radix, TanStack Query.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-07-process-data-source-architecture-design.md`.
- Migration files live in `backend/sql/` (flat). `backend/sql/migrations/` is dead — never put a file there. Next free number is **1677**.
- **Never run any migration against production.** Write the file; do not execute it against the live DB. Charter hard gate.
- Never change the schema or behaviour of `kpi_daily_actual` or `kpi_studio_manual_value`.
- Backend authorization is mandatory and enforced in SQL via `buildScopeWhereClause`, never by hiding UI.
- A metric with no rows returns `availability: "no_data"` and `actual: null` — never `0`. This rule is the point of the whole dashboard.
- Stage files by explicit path in every `git add`. Never `git add -A` / `git add .` / `git commit -a` — concurrent Claude sessions share this working tree.
- Commit message trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- Backend typecheck is `cd backend && npx tsc --noEmit` — read only the lines mentioning files you touched; the repo has pre-existing unrelated errors.

## File Structure

| File | Responsibility |
|---|---|
| `backend/sql/1677_process_metric_actual.sql` (create) | `process_metric_actual` table + `integration_config.process_id` column + page_catalog/role grants |
| `backend/src/modules/process-performance/process-metric-source.ts` (create) | Read side: resolve a registry metric from `process_metric_actual` |
| `backend/src/modules/process-performance/kpi-metric-registry.ts` (modify) | `processSource` marker on the 14 unmeasurable metrics |
| `backend/src/modules/process-performance/kpi-scorecard.service.ts` (modify) | Resolve `processSource` metrics inside `computeScorecards` |
| `backend/src/modules/process-data-source/process-data-source.service.ts` (create) | Write side: manual upsert, spreadsheet batch, scope check |
| `backend/src/modules/process-data-source/process-data-source.routes.ts` (create) | HTTP surface for entry/upload/list |
| `backend/src/modules/process-data-source/connector-refresh.service.ts` (create) | Connector metric mapping + aggregate + upsert |
| `backend/src/modules/external-db/external-db.routes.ts` (modify) | `POST /` create connector, `process_id` tagging, process-scoped roles |
| `backend/src/modules/kpi/kpi-studio.compute.ts` (modify) | Bundled fix: write `process_id_at_event`/`branch_id_at_event` |
| `backend/src/app.ts` (modify) | Mount `processDataSourceRouter` |
| `src/pages/ProcessDataSourcePage.tsx` (create) | Entry form, upload, connector config UI |
| `src/config/routes/performance.routes.tsx`, `src/lib/pageRoutePageCodes.ts`, `src/components/layout/navConfig.tsx`, `src/lib/demoCreds.ts` (modify) | Route / page-code / nav / demo-page wiring |

---

### Task 1: Schema

**Files:**
- Create: `backend/sql/1677_process_metric_actual.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `process_metric_actual` with columns `id, process_id, metric_key, score_date, actual_value, source, source_connector_key, note, created_by, created_at, updated_at`; column `integration_config.process_id`; page code `PROCESS_DATA_SOURCE`.

- [ ] **Step 1: Write the migration**

Create `backend/sql/1677_process_metric_actual.sql`:

```sql
-- Process-grain KPI values that HRMS cannot measure itself: entered by hand,
-- uploaded, or pulled from a client's own database through integration_config.
-- Deliberately NOT kpi_daily_actual: that table is per-employee and every
-- consumer inner-joins employees on it, so a process-wide figure has no honest
-- employee_id to carry. See the design spec for the full reasoning.

CREATE TABLE IF NOT EXISTS process_metric_actual (
  id                   CHAR(36)      NOT NULL,
  process_id           CHAR(36)      NOT NULL,
  metric_key           VARCHAR(64)   NOT NULL,
  score_date           DATE          NOT NULL,
  actual_value         DECIMAL(18,4)     NULL,
  source               ENUM('manual','connector') NOT NULL DEFAULT 'manual',
  source_connector_key VARCHAR(64)       NULL,
  note                 TEXT              NULL,
  created_by           CHAR(36)          NULL,
  created_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_process_metric_date (process_id, metric_key, score_date),
  KEY idx_process_date (process_id, score_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tag a connector to one process. NULL keeps every existing estate-wide
-- connector (COSEC, dialer, db_bill) meaning exactly what it means today.
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'integration_config'
               AND COLUMN_NAME = 'process_id');
SET @sql := IF(@col = 0,
  'ALTER TABLE integration_config ADD COLUMN process_id CHAR(36) NULL AFTER integration_name',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status)
VALUES (UUID(), 'PROCESS_DATA_SOURCE', 'Process Data Sources',
        '/performance/process-data-sources', 'performance', 1);

INSERT IGNORE INTO role_page_access (id, role_name, page_code, can_view, can_edit, active_status)
SELECT UUID(), r.role_name, 'PROCESS_DATA_SOURCE', 1,
       CASE WHEN r.role_name IN ('admin','process_manager','operations_manager') THEN 1 ELSE 0 END, 1
FROM (SELECT 'admin' AS role_name UNION ALL SELECT 'ceo' UNION ALL SELECT 'coo'
      UNION ALL SELECT 'process_manager' UNION ALL SELECT 'operations_manager'
      UNION ALL SELECT 'branch_head' UNION ALL SELECT 'manager') r;
```

- [ ] **Step 2: Verify the SQL parses without executing it against production**

Run: `cd backend && node -e "const s=require('fs').readFileSync('sql/1677_process_metric_actual.sql','utf8'); if(!/CREATE TABLE IF NOT EXISTS process_metric_actual/.test(s)) throw new Error('missing table'); if(!/information_schema\.COLUMNS/.test(s)) throw new Error('unguarded ALTER'); console.log('shape ok')"`

Expected: `shape ok`

The `information_schema` guard matters: an unguarded `ALTER` in a migration took production down once already (see `hrms2-migration-must-guard-columns-it-reads`).

- [ ] **Step 3: Commit**

```bash
git add backend/sql/1677_process_metric_actual.sql
git commit -F - <<'EOF'
feat(process-data-source): schema for process-grain manual and connector values

process_metric_actual holds a figure HRMS cannot measure itself, keyed by
(process_id, metric_key, score_date). Deliberately separate from
kpi_daily_actual, which is per-employee and inner-joined against employees
everywhere -- a process-wide figure has no honest employee_id to carry.

integration_config gains a nullable process_id so a connector can belong to one
client process; NULL keeps every existing estate-wide connector unchanged.

Migration file only. NOT executed against production.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: Read side — resolve `processSource` metrics onto the dashboard

**Files:**
- Create: `backend/src/modules/process-performance/process-metric-source.ts`
- Modify: `backend/src/modules/process-performance/kpi-metric-registry.ts`
- Modify: `backend/src/modules/process-performance/kpi-scorecard.service.ts`
- Test: `backend/src/modules/process-performance/__tests__/process-metric-source.test.ts`

**Interfaces:**
- Consumes: `process_metric_actual` (Task 1).
- Produces:
  - `interface ProcessMetricReading { value: number | null; count: number; trend: Array<{ period: string; value: number | null }> }`
  - `fetchProcessMetricValues(processId: string, metricKeys: string[], from: string, to: string, sumKeys?: string[]): Promise<Map<string, ProcessMetricReading>>` — `sumKeys` names the metrics summed rather than averaged (the volume family); it defaults to `[]`.
  - `KpiMetricDef.processSource?: { grain: "process" }`

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/process-performance/__tests__/process-metric-source.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const src = await import("../process-metric-source.js");

describe("fetchProcessMetricValues", () => {
  beforeEach(() => execute.mockReset());

  it("returns no entry for a metric with no rows, rather than a zero", async () => {
    execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[], []]);
    const out = await src.fetchProcessMetricValues("p1", ["abc_roi"], "2026-08-01", "2026-08-31");
    expect(out.get("abc_roi")).toBeUndefined();
  });

  it("averages rate metrics and carries a monthly trend", async () => {
    execute
      .mockResolvedValueOnce([[{ metric_key: "abc_prepaid_pct", value: "82.5", n: 3 }], []])
      .mockResolvedValueOnce([[
        { metric_key: "abc_prepaid_pct", period: "2026-08", value: "82.5" },
      ], []]);
    const out = await src.fetchProcessMetricValues("p1", ["abc_prepaid_pct"], "2026-08-01", "2026-08-31");
    expect(out.get("abc_prepaid_pct")).toEqual({
      value: 82.5,
      count: 3,
      trend: [{ period: "2026-08", value: 82.5 }],
    });
  });

  it("scopes every query to the process it was asked for", async () => {
    execute.mockResolvedValue([[], []]);
    await src.fetchProcessMetricValues("p-target", ["m1"], "2026-08-01", "2026-08-31");
    for (const call of execute.mock.calls) {
      expect(call[1]).toContain("p-target");
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/modules/process-performance/__tests__/process-metric-source.test.ts`
Expected: FAIL — cannot find module `../process-metric-source.js`.

- [ ] **Step 3: Write the reader**

Create `backend/src/modules/process-performance/process-metric-source.ts`:

```typescript
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Read side for process_metric_actual — the figures a client supplies by hand,
 * by spreadsheet, or out of their own database, for the metrics no internal
 * pipeline measures.
 *
 * Aggregation splits the same way kpi-scorecard.service.ts's aggExprFor does:
 * a volume is summed over the window, everything else averaged. The caller
 * passes the split because the registry, not this file, knows a metric's family.
 *
 * A metric with no rows is simply absent from the returned map. It is never a
 * zero: on this dashboard a zero means "measured zero", and inventing one is the
 * exact failure this whole feature exists to avoid.
 */

export interface ProcessMetricReading {
  value: number | null;
  count: number;
  trend: Array<{ period: string; value: number | null }>;
}

export async function fetchProcessMetricValues(
  processId: string,
  metricKeys: string[],
  from: string,
  to: string,
  sumKeys: string[] = [],
): Promise<Map<string, ProcessMetricReading>> {
  const out = new Map<string, ProcessMetricReading>();
  if (!metricKeys.length) return out;

  const placeholders = metricKeys.map(() => "?").join(",");
  const sumSet = new Set(sumKeys);
  // One expression handles both families: SUM for volumes, AVG for the rest,
  // decided per row by the key list the registry supplied.
  const sumCase = sumKeys.length
    ? `CASE WHEN metric_key IN (${sumKeys.map(() => "?").join(",")}) THEN 1 ELSE 0 END`
    : `0`;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT metric_key,
            CASE WHEN ${sumCase} = 1 THEN SUM(actual_value) ELSE AVG(actual_value) END AS value,
            COUNT(actual_value) AS n
       FROM process_metric_actual
      WHERE process_id = ?
        AND metric_key IN (${placeholders})
        AND score_date BETWEEN ? AND ?
      GROUP BY metric_key`,
    [...sumKeys, processId, ...metricKeys, from, to],
  );

  const [trendRows] = await db.execute<RowDataPacket[]>(
    `SELECT metric_key, DATE_FORMAT(score_date, '%Y-%m') AS period,
            CASE WHEN ${sumCase} = 1 THEN SUM(actual_value) ELSE AVG(actual_value) END AS value
       FROM process_metric_actual
      WHERE process_id = ?
        AND metric_key IN (${placeholders})
        AND score_date BETWEEN ? AND ?
      GROUP BY metric_key, period
      ORDER BY period ASC`,
    [...sumKeys, processId, ...metricKeys, from, to],
  );

  const trendByKey = new Map<string, Array<{ period: string; value: number | null }>>();
  for (const r of trendRows) {
    const key = String(r.metric_key);
    const list = trendByKey.get(key) ?? [];
    list.push({ period: String(r.period), value: r.value == null ? null : Number(r.value) });
    trendByKey.set(key, list);
  }

  for (const r of rows) {
    const key = String(r.metric_key);
    const n = Number(r.n ?? 0);
    // COUNT(actual_value) ignores NULLs, so a row entered with a blank value
    // counts as no reading rather than as a measured zero.
    if (n === 0) continue;
    out.set(key, {
      value: r.value == null ? null : Number(r.value),
      count: n,
      trend: trendByKey.get(key) ?? [],
    });
  }
  void sumSet;
  return out;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd backend && npx vitest run src/modules/process-performance/__tests__/process-metric-source.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the registry marker**

In `backend/src/modules/process-performance/kpi-metric-registry.ts`, add to the `KpiMetricDef` interface, directly after the `cdrSource` field:

```typescript
  /**
   * Set when this metric's number can only come from the client: entered by
   * hand, uploaded, or pulled from their own database into
   * process_metric_actual. Distinct from kpiMetricCode/cdrSource, which are
   * measured by an internal pipeline. Its presence is what turns a metric from
   * "not_tracked" (nothing anywhere can measure this) into "no_data" (a place
   * to put it exists, nothing has been supplied yet).
   */
  processSource?: { grain: "process" };
```

- [ ] **Step 6: Mark the fourteen unmeasurable metrics**

In the same file, add `processSource: { grain: "process" }` to exactly these entries, keeping `kpiMetricCode: null` and the existing `notTrackedNote` on each:

`BLA_BLI_BLU`: `abc_prepaid_pct`, `abc_net_revenue`, `abc_roi`, `upgrade_prepaid_pct`, `upgrade_net_revenue`, `upgrade_roi`
`REGINALD`: `email_closure_hr`, `mo_email_closure_hr`, `abc_roi`, `reshipment_sec`
`FINNABLE`: `pan_submission_count`
`GS1`: `gs1_email_tat_sec`, `gs1_datacart_tat_sec`, `gs1_approval_tat_sec`

Example of the edit shape (apply the same to all fourteen):

```typescript
{ metricKey: "abc_prepaid_pct", label: "Prepaid Target %", family: "rate", unit: "percent", target: 85, direction: "higher_is_better", lobLabel: "ABC", kpiMetricCode: null, processSource: { grain: "process" }, notTrackedNote: NO_METRIC_CODE + " (COD_SHARE is tracked; prepaid = 100 − COD_SHARE is not computed anywhere)." },
```

- [ ] **Step 7: Resolve them in the scorecard service**

In `backend/src/modules/process-performance/kpi-scorecard.service.ts`, add the import beside the existing source imports:

```typescript
import { fetchProcessMetricValues, type ProcessMetricReading } from "./process-metric-source.js";
```

Inside `computeScorecards`, directly after the `cdrByMetricKey` block and before `return set.metrics.map(...)`, add:

```typescript
  // Client-supplied figures (manual entry, upload, or the client's own database).
  // Gated on processId for the same reason the two blocks above are: a null
  // processId means out of scope, and a supplied figure must not leak past it.
  const processMetrics = set.metrics.filter((m) => !m.kpiMetricCode && !m.cdrSource && m.processSource);
  let processReadings = new Map<string, ProcessMetricReading>();
  if (processId && processMetrics.length) {
    processReadings = await fetchProcessMetricValues(
      processId,
      processMetrics.map((m) => m.metricKey),
      filters.from,
      filters.to,
      processMetrics.filter((m) => m.family === "volume").map((m) => m.metricKey),
    );
  }
```

Then, inside the `set.metrics.map(...)` callback, add this branch immediately before the existing `if (!m.kpiMetricCode) { ... not_tracked ... }` branch:

```typescript
    if (!m.kpiMetricCode && m.processSource) {
      const reading = processReadings.get(m.metricKey);
      const availability: Availability = reading && reading.count > 0 ? "ok" : "no_data";
      return {
        metricKey: m.metricKey, label: m.label, family: m.family, unit: m.unit, lobLabel: m.lobLabel,
        target: m.target, direction: m.direction, availability,
        actual: availability === "ok" ? reading!.value : null,
        rag: availability === "ok" && reading!.value != null ? ragFor(reading!.value, m.target, m.direction) : null,
        trend: reading?.trend ?? [],
        note: availability === "no_data"
          ? "No figure supplied for this window yet — this metric is filled in from the process's own upload or database connection."
          : undefined,
      };
    }
```

- [ ] **Step 8: Typecheck and commit**

Run: `cd backend && npx tsc --noEmit 2>&1 | grep -E "process-metric-source|kpi-metric-registry|kpi-scorecard" ; echo done`
Expected: only `done` — no errors naming those files.

```bash
git add backend/src/modules/process-performance/process-metric-source.ts \
        backend/src/modules/process-performance/kpi-metric-registry.ts \
        backend/src/modules/process-performance/kpi-scorecard.service.ts \
        backend/src/modules/process-performance/__tests__/process-metric-source.test.ts
git commit -F - <<'EOF'
feat(process-kpi): resolve client-supplied metrics from process_metric_actual

Adds the fourth source type to the registry resolver, beside kpi_daily_actual,
the dialer CDR feed and the Shivamgiri audit pilot. The fourteen metrics no
internal pipeline can measure (Prepaid%, Net Revenue, ROI, the email/reshipment
TATs, PAN Submission, GS1's three TATs) now read from process_metric_actual.

Their availability moves from "not_tracked" to "no_data": a place to supply the
figure now exists, so the honest state is "nothing supplied yet" rather than
"nothing can ever measure this". A metric with no rows still returns null, never
a zero.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Write side — manual entry, scoped

**Files:**
- Create: `backend/src/modules/process-data-source/process-data-source.service.ts`
- Create: `backend/src/modules/process-data-source/process-data-source.routes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/modules/process-data-source/__tests__/process-data-source.service.test.ts`

**Interfaces:**
- Consumes: `process_metric_actual` (Task 1), `findMetricDef` and `resolveProcessCodeById` from the registry/scorecard modules.
- Produces:
  - `assertProcessWritable(userId: string, processId: string): Promise<boolean>`
  - `saveManualMetricValue(input: { userId: string; processId: string; metricKey: string; scoreDate: string; value: number | null; note?: string | null }): Promise<{ ok: true }>`
  - `listProcessMetricValues(processId: string, from: string, to: string): Promise<Array<{ metricKey: string; scoreDate: string; value: number | null; source: string; note: string | null }>>`
  - Router export `processDataSourceRouter`, mounted at `/api/process-data-source`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/process-data-source/__tests__/process-data-source.service.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, buildScopeWhereClause } = vi.hoisted(() => ({
  execute: vi.fn(),
  buildScopeWhereClause: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ buildScopeWhereClause }));

const svc = await import("../process-data-source.service.js");

describe("saveManualMetricValue", () => {
  beforeEach(() => {
    execute.mockReset();
    buildScopeWhereClause.mockReset();
    buildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
  });

  it("refuses a metric key that is not in the registry for that process", async () => {
    execute.mockResolvedValueOnce([[{ process_code: "GS1" }], []]);
    await expect(
      svc.saveManualMetricValue({
        userId: "u1", processId: "p1", metricKey: "not_a_real_metric",
        scoreDate: "2026-08-01", value: 10,
      }),
    ).rejects.toThrow(/not a registered metric/i);
  });

  it("refuses a date that is not YYYY-MM-DD", async () => {
    execute.mockResolvedValueOnce([[{ process_code: "GS1" }], []]);
    await expect(
      svc.saveManualMetricValue({
        userId: "u1", processId: "p1", metricKey: "gs1_email_tat_sec",
        scoreDate: "01/08/2026", value: 10,
      }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("upserts a valid value with source manual", async () => {
    execute
      .mockResolvedValueOnce([[{ process_code: "GS1" }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const out = await svc.saveManualMetricValue({
      userId: "u1", processId: "p1", metricKey: "gs1_email_tat_sec",
      scoreDate: "2026-08-01", value: 3200, note: "from client MIS",
    });
    expect(out).toEqual({ ok: true });
    const insert = execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO process_metric_actual"));
    expect(insert).toBeTruthy();
    expect(insert![1]).toContain("manual");
    expect(insert![1]).toContain(3200);
  });

  it("stores a null value rather than coercing a blank to zero", async () => {
    execute
      .mockResolvedValueOnce([[{ process_code: "GS1" }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await svc.saveManualMetricValue({
      userId: "u1", processId: "p1", metricKey: "gs1_email_tat_sec",
      scoreDate: "2026-08-01", value: null,
    });
    const insert = execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO process_metric_actual"));
    expect(insert![1]).toContain(null);
    expect(insert![1]).not.toContain(0);
  });
});

describe("assertProcessWritable", () => {
  beforeEach(() => {
    execute.mockReset();
    buildScopeWhereClause.mockReset();
  });

  it("is false when the scope predicate matches no row", async () => {
    buildScopeWhereClause.mockResolvedValue({ sql: "1=0", params: [] });
    execute.mockResolvedValueOnce([[], []]);
    await expect(svc.assertProcessWritable("u1", "p-outside")).resolves.toBe(false);
  });

  it("is true when the scope predicate matches the process", async () => {
    buildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
    execute.mockResolvedValueOnce([[{ id: "p1" }], []]);
    await expect(svc.assertProcessWritable("u1", "p1")).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/modules/process-data-source/__tests__/process-data-source.service.test.ts`
Expected: FAIL — cannot find module `../process-data-source.service.js`.

- [ ] **Step 3: Write the service**

Create `backend/src/modules/process-data-source/process-data-source.service.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { findMetricDef } from "../process-performance/kpi-metric-registry.js";

/**
 * Write side for process_metric_actual.
 *
 * Two things are enforced here rather than in the UI, because the UI is not a
 * security boundary: a caller may only write to a process inside their own
 * scope, and may only write a metric the registry actually defines for that
 * process. Without the second check a typo (or a crafted request) would create
 * an orphan metric_key that no dashboard reads and nobody ever notices.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const WRITER_ROLES = [
  "super_admin", "admin", "process_manager", "operations_manager",
];

/** Is this process inside the caller's own scope? Predicate, not UI state. */
export async function assertProcessWritable(userId: string, processId: string): Promise<boolean> {
  const scope = await buildScopeWhereClause(userId, WRITER_ROLES, {
    processId: "p.id", branchId: "p.branch_id",
  }, { allowAdminBypass: true });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.id FROM process_master p WHERE p.id = ? AND (${scope.sql}) LIMIT 1`,
    [processId, ...scope.params],
  );
  return rows.length > 0;
}

async function processCodeFor(processId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT process_code FROM process_master WHERE id = ? LIMIT 1`, [processId],
  );
  return rows.length ? String(rows[0].process_code) : null;
}

export async function saveManualMetricValue(input: {
  userId: string;
  processId: string;
  metricKey: string;
  scoreDate: string;
  value: number | null;
  note?: string | null;
}): Promise<{ ok: true }> {
  if (!ISO_DATE.test(input.scoreDate)) throw new Error("Date must be YYYY-MM-DD");

  const processCode = await processCodeFor(input.processId);
  if (!processCode) throw new Error("Unknown process");
  const def = findMetricDef(processCode, input.metricKey);
  if (!def) throw new Error(`${input.metricKey} is not a registered metric for ${processCode}`);

  await db.execute(
    `INSERT INTO process_metric_actual
       (id, process_id, metric_key, score_date, actual_value, source, note, created_by)
     VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)
     ON DUPLICATE KEY UPDATE
       actual_value         = VALUES(actual_value),
       source               = 'manual',
       source_connector_key = NULL,
       note                 = VALUES(note),
       created_by           = VALUES(created_by)`,
    [
      randomUUID(), input.processId, input.metricKey, input.scoreDate,
      input.value, input.note?.trim() || null, input.userId,
    ],
  );
  return { ok: true };
}

export interface ProcessMetricRow {
  metricKey: string;
  scoreDate: string;
  value: number | null;
  source: string;
  note: string | null;
}

export async function listProcessMetricValues(
  processId: string, from: string, to: string,
): Promise<ProcessMetricRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT metric_key, DATE_FORMAT(score_date, '%Y-%m-%d') AS score_date,
            actual_value, source, note
       FROM process_metric_actual
      WHERE process_id = ? AND score_date BETWEEN ? AND ?
      ORDER BY score_date DESC, metric_key ASC
      LIMIT 500`,
    [processId, from, to],
  );
  return rows.map((r) => ({
    metricKey: String(r.metric_key),
    scoreDate: String(r.score_date),
    value: r.actual_value == null ? null : Number(r.actual_value),
    source: String(r.source),
    note: r.note == null ? null : String(r.note),
  }));
}
```

Note `DATE_FORMAT(score_date, '%Y-%m-%d')`: `mysql2` returns a bare `DATE` column as a JS `Date`, which stringifies to `"Fri Aug 01 2026 …"`. That exact trap produced a live bug earlier in this module's history; formatting in SQL avoids it.

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd backend && npx vitest run src/modules/process-data-source/__tests__/process-data-source.service.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the routes**

Create `backend/src/modules/process-data-source/process-data-source.routes.ts`:

```typescript
import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./process-data-source.service.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

// Read is open to the same viewers who can read the dashboard; write is narrower
// and additionally scope-checked per process inside each handler.
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
] as const;
const WRITER_ROLES = ["admin", "process_manager", "operations_manager"] as const;

router.get("/:processId/values", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const today = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const from = q.from || iso(new Date(today.getFullYear(), today.getMonth(), 1));
  const to = q.to || iso(today);

  if (!(await svc.assertProcessWritable(req.authUser!.id, req.params.processId))) {
    return res.status(403).json({ success: false, code: "OUT_OF_SCOPE", message: "That process is outside your scope." });
  }
  res.json({ success: true, data: await svc.listProcessMetricValues(req.params.processId, from, to) });
}));

router.post("/:processId/values", requireAuth, requireRole(...WRITER_ROLES), h(async (req, res) => {
  const { processId } = req.params;
  if (!(await svc.assertProcessWritable(req.authUser!.id, processId))) {
    return res.status(403).json({ success: false, code: "OUT_OF_SCOPE", message: "That process is outside your scope." });
  }
  const body = req.body as { metricKey?: string; scoreDate?: string; value?: number | null; note?: string };
  if (!body.metricKey || !body.scoreDate) {
    return res.status(400).json({ success: false, code: "MISSING_FIELDS", message: "metricKey and scoreDate are required." });
  }
  try {
    const out = await svc.saveManualMetricValue({
      userId: req.authUser!.id,
      processId,
      metricKey: body.metricKey,
      scoreDate: body.scoreDate,
      value: body.value === undefined || body.value === null || Number.isNaN(Number(body.value))
        ? null : Number(body.value),
      note: body.note ?? null,
    });
    res.json({ success: true, data: out });
  } catch (err) {
    res.status(400).json({ success: false, code: "INVALID_VALUE", message: (err as Error).message });
  }
}));

export const processDataSourceRouter = router;
export default router;
```

- [ ] **Step 6: Mount it**

In `backend/src/app.ts`, beside the existing `kpiScorecardRouter` import:

```typescript
import { processDataSourceRouter } from "./modules/process-data-source/process-data-source.routes.js";
```

and beside its `app.use`:

```typescript
app.use("/api/process-data-source", processDataSourceRouter);
```

- [ ] **Step 7: Verify the route is actually reachable, not just imported**

Run: `cd backend && grep -n "process-data-source" src/app.ts`
Expected: two lines — the import and the `app.use`. An imported router with no `app.use` returns 401 on every call and looks like a permissions bug (see `hrms2-missing-routes-return-401`).

- [ ] **Step 8: Typecheck and commit**

Run: `cd backend && npx tsc --noEmit 2>&1 | grep -E "process-data-source|app\.ts" ; echo done`
Expected: only `done`.

```bash
git add backend/src/modules/process-data-source/process-data-source.service.ts \
        backend/src/modules/process-data-source/process-data-source.routes.ts \
        backend/src/modules/process-data-source/__tests__/process-data-source.service.test.ts \
        backend/src/app.ts
git commit -F - <<'EOF'
feat(process-data-source): manual entry of client-supplied process metrics

POST/GET /api/process-data-source/:processId/values, scoped per process through
buildScopeWhereClause rather than by role alone, so a process manager can only
write to their own processes. The metric key is validated against the registry,
so a typo cannot create an orphan key no dashboard reads.

A blank value stores NULL, not 0 -- COUNT(actual_value) then reports it as no
reading rather than as a measured zero.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Spreadsheet upload

**Files:**
- Modify: `backend/src/modules/process-data-source/process-data-source.service.ts`
- Modify: `backend/src/modules/process-data-source/process-data-source.routes.ts`
- Test: `backend/src/modules/process-data-source/__tests__/process-data-source.upload.test.ts`

**Interfaces:**
- Consumes: `saveManualMetricValue` (Task 3).
- Produces: `importMetricRows(input: { userId: string; processId: string; rows: Array<{ metricKey: string; scoreDate: string; value: string | number | null; note?: string }> }): Promise<{ imported: number; errors: Array<{ row: number; message: string }> }>`

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/process-data-source/__tests__/process-data-source.upload.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, buildScopeWhereClause } = vi.hoisted(() => ({
  execute: vi.fn(),
  buildScopeWhereClause: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ buildScopeWhereClause }));

const svc = await import("../process-data-source.service.js");

describe("importMetricRows", () => {
  beforeEach(() => {
    execute.mockReset();
    buildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
    execute.mockResolvedValue([[{ process_code: "GS1" }], []]);
  });

  it("imports the good rows and reports the bad ones by row number", async () => {
    const out = await svc.importMetricRows({
      userId: "u1", processId: "p1",
      rows: [
        { metricKey: "gs1_email_tat_sec", scoreDate: "2026-08-01", value: "3200" },
        { metricKey: "nope", scoreDate: "2026-08-01", value: "1" },
        { metricKey: "gs1_approval_tat_sec", scoreDate: "not-a-date", value: "1" },
      ],
    });
    expect(out.imported).toBe(1);
    expect(out.errors).toHaveLength(2);
    expect(out.errors[0].row).toBe(2);
    expect(out.errors[1].row).toBe(3);
  });

  it("treats an empty value cell as no reading, not as zero", async () => {
    await svc.importMetricRows({
      userId: "u1", processId: "p1",
      rows: [{ metricKey: "gs1_email_tat_sec", scoreDate: "2026-08-01", value: "" }],
    });
    const insert = execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO process_metric_actual"));
    expect(insert![1]).toContain(null);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/modules/process-data-source/__tests__/process-data-source.upload.test.ts`
Expected: FAIL — `svc.importMetricRows is not a function`.

- [ ] **Step 3: Implement the importer**

Append to `backend/src/modules/process-data-source/process-data-source.service.ts`:

```typescript
export interface ImportRow {
  metricKey: string;
  scoreDate: string;
  value: string | number | null;
  note?: string;
}

/**
 * Spreadsheet import. Every row is validated independently and a bad row is
 * reported by its own number rather than aborting the batch, because an ops
 * user pasting a month of figures should not lose 29 good rows to one typo.
 *
 * A blank value cell means "no reading", which is stored as NULL. Coercing it
 * to 0 would be indistinguishable on the dashboard from a genuinely measured
 * zero.
 */
export async function importMetricRows(input: {
  userId: string;
  processId: string;
  rows: ImportRow[];
}): Promise<{ imported: number; errors: Array<{ row: number; message: string }> }> {
  const errors: Array<{ row: number; message: string }> = [];
  let imported = 0;

  for (let index = 0; index < input.rows.length; index++) {
    const row = input.rows[index];
    const raw = row.value;
    const trimmed = typeof raw === "string" ? raw.trim() : raw;
    const value =
      trimmed === "" || trimmed === null || trimmed === undefined || Number.isNaN(Number(trimmed))
        ? null
        : Number(trimmed);
    try {
      await saveManualMetricValue({
        userId: input.userId,
        processId: input.processId,
        metricKey: String(row.metricKey ?? "").trim(),
        scoreDate: String(row.scoreDate ?? "").trim(),
        value,
        note: row.note ?? null,
      });
      imported++;
    } catch (err) {
      errors.push({ row: index + 1, message: (err as Error).message });
    }
  }
  return { imported, errors };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd backend && npx vitest run src/modules/process-data-source/__tests__/process-data-source.upload.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Add the upload route**

In `backend/src/modules/process-data-source/process-data-source.routes.ts`, before the `export` lines:

```typescript
router.post("/:processId/import", requireAuth, requireRole(...WRITER_ROLES), h(async (req, res) => {
  const { processId } = req.params;
  if (!(await svc.assertProcessWritable(req.authUser!.id, processId))) {
    return res.status(403).json({ success: false, code: "OUT_OF_SCOPE", message: "That process is outside your scope." });
  }
  const rows = (req.body as { rows?: svc.ImportRow[] }).rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ success: false, code: "NO_ROWS", message: "Send a non-empty rows array." });
  }
  if (rows.length > 2000) {
    return res.status(400).json({ success: false, code: "TOO_MANY_ROWS", message: "Import at most 2000 rows at a time." });
  }
  res.json({ success: true, data: await svc.importMetricRows({ userId: req.authUser!.id, processId, rows }) });
}));
```

- [ ] **Step 6: Typecheck and commit**

Run: `cd backend && npx tsc --noEmit 2>&1 | grep process-data-source ; echo done`
Expected: only `done`.

```bash
git add backend/src/modules/process-data-source/process-data-source.service.ts \
        backend/src/modules/process-data-source/process-data-source.routes.ts \
        backend/src/modules/process-data-source/__tests__/process-data-source.upload.test.ts
git commit -F - <<'EOF'
feat(process-data-source): spreadsheet import for client-supplied metrics

Per-row validation that reports a bad row by number instead of failing the whole
batch, so one typo does not cost a month of correct rows. Blank value cells
store NULL rather than 0, keeping "not supplied" distinguishable from "measured
zero" on the dashboard.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: Register a client's database at runtime

**Files:**
- Modify: `backend/src/modules/external-db/external-db.routes.ts`
- Test: `backend/src/modules/external-db/__tests__/external-db.create.test.ts`

**Interfaces:**
- Consumes: `encryptCredentials`, `SaveDbConfigSchema` (both already exist in that module), `assertProcessWritable` (Task 3).
- Produces: `POST /api/external-db` → `{ success: true, data: { integration_key: string } }`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/external-db/__tests__/external-db.create.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The create route is what makes a genuinely new client database registrable at
 * runtime; before it, integration_config rows could only be edited, never added,
 * so a new client's database could not be connected without a migration.
 */
const source = readFileSync(
  resolve(process.cwd(), "src/modules/external-db/external-db.routes.ts"),
  "utf8",
);

describe("external-db create route", () => {
  it("exposes POST / to create a connector", () => {
    expect(source).toMatch(/router\.post\(\s*['"]\/['"]/);
  });

  it("stores credentials encrypted, never in config_json", () => {
    const post = source.slice(source.indexOf("router.post('/'"));
    expect(post).toMatch(/encryptCredentials/);
    expect(post).not.toMatch(/config_json[^)]*password/);
  });

  it("scope-checks the process a connector is attached to", () => {
    const post = source.slice(source.indexOf("router.post('/'"));
    expect(post).toMatch(/assertProcessWritable/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/modules/external-db/__tests__/external-db.create.test.ts`
Expected: FAIL — no `router.post('/'` in the file.

- [ ] **Step 3: Add the create route**

In `backend/src/modules/external-db/external-db.routes.ts`, add to the imports:

```typescript
import { randomUUID } from 'node:crypto';
import { assertProcessWritable } from '../process-data-source/process-data-source.service.js';
```

and insert this route immediately after the `router.use(requireAuth);` line:

```typescript
// POST /api/external-db — register a NEW connector. Until this existed, PUT/:key
// could only edit a pre-seeded row, so a new client's database could not be
// connected without shipping a migration. A connector may be attached to one
// process (process_id), which is scope-checked here; an estate-wide connector
// (process_id null) stays admin-only.
router.post('/', requireRole('admin', 'process_manager', 'operations_manager'), h(async (req, res) => {
  const parsed = SaveDbConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
  }
  const input = parsed.data;
  const processId = (req.body?.process_id as string | undefined) ?? null;
  const name = String(req.body?.integration_name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'integration_name is required' });

  const role = (req as any).authUser?.role;
  if (processId) {
    if (!(await assertProcessWritable((req as any).authUser?.id, processId))) {
      return res.status(403).json({ error: 'That process is outside your scope' });
    }
  } else if (role !== 'admin' && role !== 'super_admin') {
    return res.status(403).json({ error: 'Only an admin may create an estate-wide connector' });
  }

  const key = `proc_${randomUUID().slice(0, 8)}`;
  const creds: DbCredentials = {
    host: input.host,
    port: input.port,
    database: input.database,
    username: input.username,
    password: input.password ?? '',
    date_column: input.date_column ?? 'event_time',
    employee_code_column: input.employee_code_column ?? 'agent_user',
    tables: input.tables ?? [],
    db_type: input.db_type,
    encrypt: input.encrypt ?? false,
    trust_server_certificate: input.trust_server_certificate ?? true,
  };

  // The password goes only into encrypted_credentials. config_json is read back
  // to the browser in the list/detail routes above, so a secret placed there
  // would be handed to every admin screen in clear text.
  const config = {
    host: input.host, port: input.port, database: input.database,
    username: input.username, date_column: creds.date_column,
    employee_code_column: creds.employee_code_column, tables: creds.tables,
    db_type: input.db_type, encrypt: creds.encrypt,
    trust_server_certificate: creds.trust_server_certificate,
  };

  await db.execute(
    `INSERT INTO integration_config
       (id, integration_key, integration_name, integration_type, process_id,
        config_json, encrypted_credentials, active_status, created_at, updated_at)
     VALUES (UUID(), ?, ?, 'database', ?, ?, ?, 1, NOW(), NOW())`,
    [key, name, processId, JSON.stringify(config), encryptCredentials(creds)],
  );

  return res.status(201).json({ success: true, data: { integration_key: key } });
}));
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd backend && npx vitest run src/modules/external-db/__tests__/external-db.create.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `cd backend && npx tsc --noEmit 2>&1 | grep external-db ; echo done`
Expected: only `done`.

```bash
git add backend/src/modules/external-db/external-db.routes.ts \
        backend/src/modules/external-db/__tests__/external-db.create.test.ts
git commit -F - <<'EOF'
feat(external-db): register a new client database at runtime

Until now integration_config rows could only be edited, never created, so
connecting a new client's database needed a migration. POST / creates one,
attachable to a single process and scope-checked against the caller's own
processes; an estate-wide connector (process_id null) stays admin-only.

The password is written only to encrypted_credentials. config_json is echoed
back to the browser by the existing list/detail routes, so a secret placed there
would be handed out in clear text.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: Pull a metric out of the connected database

**Files:**
- Create: `backend/src/modules/process-data-source/connector-refresh.service.ts`
- Modify: `backend/src/modules/process-data-source/process-data-source.routes.ts`
- Test: `backend/src/modules/process-data-source/__tests__/connector-refresh.test.ts`

**Interfaces:**
- Consumes: `getPoolForKey` from `external-db.service.js`, `assertSafeIdentifier` from `integration-hub/adapters/databaseAdapter.js`, `process_metric_actual` (Task 1).
- Produces: `refreshConnectorMetric(input: { connectorKey: string; processId: string; metricKey: string; table: string; valueColumn: string; aggregate: "SUM"|"AVG"|"COUNT"|"MAX"|"MIN"; dateColumn: string; from: string; to: string }): Promise<{ written: number }>`

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/process-data-source/__tests__/connector-refresh.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, getPoolForKey, poolQuery } = vi.hoisted(() => ({
  execute: vi.fn(),
  getPoolForKey: vi.fn(),
  poolQuery: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../external-db/external-db.service.js", () => ({ getPoolForKey }));

const svc = await import("../connector-refresh.service.js");

const BASE = {
  connectorKey: "proc_abc123", processId: "p1", metricKey: "abc_prepaid_pct",
  table: "orders", valueColumn: "prepaid_flag", aggregate: "AVG" as const,
  dateColumn: "order_date", from: "2026-08-01", to: "2026-08-31",
};

describe("refreshConnectorMetric", () => {
  beforeEach(() => {
    execute.mockReset(); poolQuery.mockReset(); getPoolForKey.mockReset();
    getPoolForKey.mockResolvedValue({ query: poolQuery });
    execute.mockResolvedValue([{ affectedRows: 1 }, []]);
  });

  it("rejects an identifier that is not a plain column name", async () => {
    await expect(svc.refreshConnectorMetric({ ...BASE, valueColumn: "x; DROP TABLE y" }))
      .rejects.toThrow();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("rejects an aggregate outside the whitelist", async () => {
    await expect(svc.refreshConnectorMetric({ ...BASE, aggregate: "SLEEP" as never }))
      .rejects.toThrow(/aggregate/i);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("writes one row per day returned, tagged as connector-sourced", async () => {
    poolQuery.mockResolvedValue([[
      { d: "2026-08-01", v: "0.82" },
      { d: "2026-08-02", v: "0.79" },
    ], []]);
    const out = await svc.refreshConnectorMetric(BASE);
    expect(out.written).toBe(2);
    const insert = execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO process_metric_actual"));
    expect(insert![1]).toContain("connector");
    expect(insert![1]).toContain("proc_abc123");
  });

  it("writes nothing when the source returns no rows", async () => {
    poolQuery.mockResolvedValue([[], []]);
    const out = await svc.refreshConnectorMetric(BASE);
    expect(out.written).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/modules/process-data-source/__tests__/connector-refresh.test.ts`
Expected: FAIL — cannot find module `../connector-refresh.service.js`.

- [ ] **Step 3: Implement the refresh**

Create `backend/src/modules/process-data-source/connector-refresh.service.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";
import { getPoolForKey } from "../external-db/external-db.service.js";
import { assertSafeIdentifier } from "../integration-hub/adapters/databaseAdapter.js";

/**
 * Pull one metric out of a client's own database and land it in
 * process_metric_actual.
 *
 * SQL injection surface, and how it is closed: a table or column name cannot be
 * a bound parameter, so a configurable source unavoidably interpolates
 * identifiers. Every one goes through assertSafeIdentifier -- the same guard
 * KPI Studio's own connector reader uses -- and the aggregate is matched against
 * a fixed whitelist rather than passed through. Dates are bound.
 *
 * Reads are read-only: external-db.service.ts's pools already enforce it, and
 * the only statement issued here is a SELECT.
 */

const AGGREGATES = ["SUM", "AVG", "COUNT", "MAX", "MIN"] as const;
export type ConnectorAggregate = (typeof AGGREGATES)[number];

export async function refreshConnectorMetric(input: {
  connectorKey: string;
  processId: string;
  metricKey: string;
  table: string;
  valueColumn: string;
  aggregate: ConnectorAggregate;
  dateColumn: string;
  from: string;
  to: string;
}): Promise<{ written: number }> {
  assertSafeIdentifier(input.table);
  assertSafeIdentifier(input.valueColumn);
  assertSafeIdentifier(input.dateColumn);
  if (!AGGREGATES.includes(input.aggregate)) {
    throw new Error(`Unsupported aggregate: ${input.aggregate}`);
  }

  const pool = await getPoolForKey(input.connectorKey);
  // DATE_FORMAT, not DATE(): mysql2 hands back a bare DATE column as a JS Date,
  // whose toString is "Fri Aug 01 2026 ...". Formatting in SQL keeps it a string.
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(\`${input.dateColumn}\`, '%Y-%m-%d') AS d,
            ${input.aggregate}(\`${input.valueColumn}\`) AS v
       FROM \`${input.table}\`
      WHERE \`${input.dateColumn}\` >= ?
        AND \`${input.dateColumn}\` < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY DATE_FORMAT(\`${input.dateColumn}\`, '%Y-%m-%d')
      ORDER BY d ASC`,
    [input.from, input.to],
  );

  const list = rows as Array<{ d: string; v: string | number | null }>;
  if (!list.length) return { written: 0 };

  const placeholders = list.map(() => "(?, ?, ?, ?, ?, 'connector', ?, NULL)").join(", ");
  const params: unknown[] = [];
  for (const row of list) {
    params.push(
      randomUUID(), input.processId, input.metricKey, row.d,
      row.v == null ? null : Number(row.v),
      input.connectorKey,
    );
  }

  await db.execute(
    `INSERT INTO process_metric_actual
       (id, process_id, metric_key, score_date, actual_value, source, source_connector_key, note)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       actual_value         = VALUES(actual_value),
       source               = 'connector',
       source_connector_key = VALUES(source_connector_key)`,
    params,
  );

  return { written: list.length };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd backend && npx vitest run src/modules/process-data-source/__tests__/connector-refresh.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Expose the refresh route**

In `backend/src/modules/process-data-source/process-data-source.routes.ts`, add the import:

```typescript
import { refreshConnectorMetric, type ConnectorAggregate } from "./connector-refresh.service.js";
```

and this route before the `export` lines:

```typescript
router.post("/:processId/connector-refresh", requireAuth, requireRole(...WRITER_ROLES), h(async (req, res) => {
  const { processId } = req.params;
  if (!(await svc.assertProcessWritable(req.authUser!.id, processId))) {
    return res.status(403).json({ success: false, code: "OUT_OF_SCOPE", message: "That process is outside your scope." });
  }
  const b = req.body as Record<string, string | undefined>;
  const required = ["connectorKey", "metricKey", "table", "valueColumn", "aggregate", "dateColumn", "from", "to"];
  const missing = required.filter((k) => !b[k]);
  if (missing.length) {
    return res.status(400).json({ success: false, code: "MISSING_FIELDS", message: `Missing: ${missing.join(", ")}` });
  }
  try {
    const out = await refreshConnectorMetric({
      connectorKey: b.connectorKey!, processId, metricKey: b.metricKey!,
      table: b.table!, valueColumn: b.valueColumn!,
      aggregate: b.aggregate as ConnectorAggregate,
      dateColumn: b.dateColumn!, from: b.from!, to: b.to!,
    });
    res.json({ success: true, data: out });
  } catch (err) {
    res.status(400).json({ success: false, code: "REFRESH_FAILED", message: (err as Error).message });
  }
}));
```

- [ ] **Step 6: Typecheck and commit**

Run: `cd backend && npx tsc --noEmit 2>&1 | grep -E "connector-refresh|process-data-source" ; echo done`
Expected: only `done`.

```bash
git add backend/src/modules/process-data-source/connector-refresh.service.ts \
        backend/src/modules/process-data-source/process-data-source.routes.ts \
        backend/src/modules/process-data-source/__tests__/connector-refresh.test.ts
git commit -F - <<'EOF'
feat(process-data-source): pull a metric from a client's own database

Maps {table, value column, aggregate, date column} on a registered connector and
lands one process_metric_actual row per day. Identifiers go through the same
assertSafeIdentifier guard KPI Studio's connector reader uses and the aggregate
is whitelisted, so a configurable source cannot become an injection point; dates
are bound. The only statement issued is a SELECT, on pools that already enforce
read-only.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: Bundled fix — Studio writes no process dashboard can see

**Files:**
- Modify: `backend/src/modules/kpi/kpi-studio.compute.ts:402-420`
- Test: `backend/src/modules/kpi/__tests__/kpi-studio-lineage.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports; the existing `kpi_daily_actual` insert gains `process_id_at_event` and `branch_id_at_event`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/kpi/__tests__/kpi-studio-lineage.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Studio computes real figures and writes them to kpi_daily_actual, but the
 * insert omitted process_id_at_event and branch_id_at_event -- the two columns
 * every process-scoped dashboard filters on. Anything Studio computed was
 * therefore invisible to the Process KPI Dashboard and to process-performance,
 * silently, with the row plainly present in the table.
 */
const source = readFileSync(
  resolve(process.cwd(), "src/modules/kpi/kpi-studio.compute.ts"),
  "utf8",
);

describe("kpi-studio compute lineage", () => {
  it("writes process_id_at_event on every actual it inserts", () => {
    const insert = source.slice(source.indexOf("INSERT INTO kpi_daily_actual"));
    expect(insert.slice(0, 400)).toMatch(/process_id_at_event/);
  });

  it("writes branch_id_at_event too", () => {
    const insert = source.slice(source.indexOf("INSERT INTO kpi_daily_actual"));
    expect(insert.slice(0, 400)).toMatch(/branch_id_at_event/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/modules/kpi/__tests__/kpi-studio-lineage.test.ts`
Expected: FAIL — both assertions.

- [ ] **Step 3: Read the surrounding code to find the employee's fields**

Run: `cd backend && grep -n "employee.id\|employee_code\|for (const employee" src/modules/kpi/kpi-studio.compute.ts | head -20`

You need the loop variable that already holds each employee. The `writes.push({ employeeId: employee.id, ... })` line near line 375 confirms it is `employee`.

- [ ] **Step 4: Carry the lineage onto each write**

In `backend/src/modules/kpi/kpi-studio.compute.ts`, change the `writes.push(...)` near line 375 to also carry the employee's current process and branch:

```typescript
    writes.push({
      employeeId: employee.id,
      metricId: definition.metric_id,
      value: evaluated.value,
      processId: (employee as { process_id?: string | null }).process_id ?? null,
      branchId: (employee as { branch_id?: string | null }).branch_id ?? null,
    });
```

Then replace the insert block (the `const CHUNK = 200;` loop) with:

```typescript
  // ── Write actuals ──
  // source='calculated' distinguishes a Studio-computed figure from one an existing sync wrote, so
  // the two can never be confused when reconciling a number with its origin.
  //
  // process_id_at_event / branch_id_at_event are written from the employee's CURRENT
  // process and branch. Without them these rows are invisible to every process-scoped
  // dashboard -- they filter on exactly these columns -- so a Studio figure appeared to
  // compute successfully and then silently never showed up anywhere.
  const CHUNK = 200;
  for (let index = 0; index < writes.length; index += CHUNK) {
    const chunk = writes.slice(index, index + CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params: unknown[] = [];
    for (const write of chunk) {
      params.push(
        write.employeeId, write.metricId, options.date, write.value, 'calculated',
        write.processId ?? null, write.branchId ?? null,
      );
    }
    await db.execute(
      `INSERT INTO kpi_daily_actual
         (employee_id, metric_id, score_date, actual_value, source,
          process_id_at_event, branch_id_at_event)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         actual_value        = VALUES(actual_value),
         source              = VALUES(source),
         process_id_at_event = VALUES(process_id_at_event),
         branch_id_at_event  = VALUES(branch_id_at_event)`,
      params,
    );
    outcome.written += chunk.length;
  }
```

- [ ] **Step 5: Make sure the employee query actually selects those columns**

Run: `cd backend && grep -n "FROM employees" src/modules/kpi/kpi-studio.compute.ts`

Open each result. If the `SELECT` list does not already include `process_id` and `branch_id`, add them — otherwise both values are `undefined` at runtime and the fix writes NULLs, which looks identical to the bug it replaces. Add them exactly as `e.process_id`, `e.branch_id` (matching whatever alias that query uses).

- [ ] **Step 6: Run the test and the module's existing tests**

Run: `cd backend && npx vitest run src/modules/kpi/__tests__/kpi-studio-lineage.test.ts src/modules/kpi/__tests__/kpi-data-connector.service.test.ts`
Expected: PASS. The connector test is included because it asserts against `kpi_daily_actual` inserts and must not regress.

- [ ] **Step 7: Typecheck and commit**

Run: `cd backend && npx tsc --noEmit 2>&1 | grep kpi-studio ; echo done`
Expected: only `done`.

```bash
git add backend/src/modules/kpi/kpi-studio.compute.ts \
        backend/src/modules/kpi/__tests__/kpi-studio-lineage.test.ts
git commit -F - <<'EOF'
fix(kpi-studio): write process/branch lineage on computed actuals

The insert into kpi_daily_actual omitted process_id_at_event and
branch_id_at_event, the two columns every process-scoped dashboard filters on.
A Studio-computed figure therefore landed in the table and was invisible to the
Process KPI Dashboard and to process-performance, with no error anywhere -- the
row was plainly there, it just never matched.

Both are now written from the employee's current process and branch, the same
live-hierarchy approach already used after team_leader_id_at_event turned out
never to be written either.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 8: The screen

**Files:**
- Create: `src/pages/ProcessDataSourcePage.tsx`
- Modify: `src/config/routes/performance.routes.tsx`
- Modify: `src/lib/pageRoutePageCodes.ts`
- Modify: `src/components/layout/navConfig.tsx`
- Modify: `src/lib/demoCreds.ts`

**Interfaces:**
- Consumes: `GET/POST /api/process-data-source/:processId/values`, `POST /api/process-data-source/:processId/import`, `POST /api/process-data-source/:processId/connector-refresh`, and `GET /api/process-kpi-dashboard/processes` for the picker.
- Produces: route `/performance/process-data-sources`, page code `PROCESS_DATA_SOURCE`.

- [ ] **Step 1: Read the sibling page for the house patterns**

Run: `cd C:/Users/ADMIN/Desktop/HRMS2-latest && sed -n '1,60p' src/pages/ProcessKpiDashboardPage.tsx`

Copy from it: the `hrmsApi` import style, the `useQuery` key shape (`["process-kpi-dashboard", ...]`), the process-picker query, and the date-filter helpers. Do not invent a second pattern for any of these.

- [ ] **Step 2: Build the page**

Create `src/pages/ProcessDataSourcePage.tsx`. Every closed set is a `Select` per the Form Input Rule in `CLAUDE.md`; free text is legitimate only for name, host, database, username, table/column names, and the note. Import paths for `Select`, `Input`, `Button`, `Sheet` and `hrmsApi` must be copied from `ProcessKpiDashboardPage.tsx` (Step 1) rather than guessed — `hrmsApi` never prepends `/api`, so every path below spells it out.

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const AGGREGATES = ["SUM", "AVG", "COUNT", "MAX", "MIN"] as const;

type MetricDef = { metricKey: string; label: string; lobLabel: string; availability: string };
type ValueRow = { metricKey: string; scoreDate: string; value: number | null; source: string; note: string | null };

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function ProcessDataSourcePage() {
  const qc = useQueryClient();
  const [processCode, setProcessCode] = useState<string>("");
  const [from, setFrom] = useState(isoMonthStart());
  const [to, setTo] = useState(isoToday());
  const [drawerRow, setDrawerRow] = useState<ValueRow | null>(null);

  const processes = useQuery({
    queryKey: ["process-kpi-dashboard", "processes"],
    queryFn: () => hrmsApi.get<{ data: Array<{ processCode: string; billingName: string }> }>(
      "/api/process-kpi-dashboard/processes"),
  });

  const header = useQuery({
    queryKey: ["process-kpi-dashboard", "header", processCode],
    enabled: !!processCode,
    queryFn: () => hrmsApi.get<{ data: { processId: string } }>(
      `/api/process-kpi-dashboard/${processCode}/header`),
  });
  const processId = header.data?.data?.processId ?? "";

  // Only metrics the registry says are client-supplied can be entered here.
  const scorecards = useQuery({
    queryKey: ["process-kpi-dashboard", "scorecards", processCode, from, to],
    enabled: !!processCode,
    queryFn: () => hrmsApi.get<{ data: MetricDef[] }>(
      `/api/process-kpi-dashboard/${processCode}/scorecards?from=${from}&to=${to}`),
  });
  const suppliedMetrics = (scorecards.data?.data ?? []).filter(
    (m) => m.availability === "no_data" || m.availability === "ok");

  const values = useQuery({
    queryKey: ["process-data-source", "values", processId, from, to],
    enabled: !!processId,
    queryFn: () => hrmsApi.get<{ data: ValueRow[] }>(
      `/api/process-data-source/${processId}/values?from=${from}&to=${to}`),
  });

  const [entry, setEntry] = useState({ metricKey: "", scoreDate: isoToday(), value: "", note: "" });
  const saveValue = useMutation({
    mutationFn: () => hrmsApi.post(`/api/process-data-source/${processId}/values`, {
      metricKey: entry.metricKey,
      scoreDate: entry.scoreDate,
      value: entry.value.trim() === "" ? null : Number(entry.value),
      note: entry.note || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["process-data-source", "values", processId] });
      qc.invalidateQueries({ queryKey: ["process-kpi-dashboard", "scorecards", processCode] });
      setEntry((e) => ({ ...e, value: "", note: "" }));
    },
  });

  const [conn, setConn] = useState({
    integration_name: "", host: "", port: "3306", database: "", username: "", password: "",
    db_type: "mysql",
  });
  const [connKey, setConnKey] = useState("");
  const createConnector = useMutation({
    mutationFn: () => hrmsApi.post<{ data: { integration_key: string } }>("/api/external-db", {
      ...conn, port: Number(conn.port), process_id: processId, tables: [],
    }),
    onSuccess: (res) => setConnKey(res.data.integration_key),
  });
  const testConnector = useMutation({
    mutationFn: () => hrmsApi.post(`/api/external-db/${connKey}/test`, {}),
  });

  const [mapping, setMapping] = useState({
    metricKey: "", table: "", valueColumn: "", aggregate: "SUM", dateColumn: "",
  });
  const refresh = useMutation({
    mutationFn: () => hrmsApi.post(`/api/process-data-source/${processId}/connector-refresh`, {
      connectorKey: connKey, ...mapping, from, to,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["process-data-source", "values", processId] });
      qc.invalidateQueries({ queryKey: ["process-kpi-dashboard", "scorecards", processCode] });
    },
  });

  return (
    <div className="p-6 space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Process Data Sources</h1>
        <p className="text-sm text-muted-foreground">
          Supply the figures HRMS cannot measure itself — enter them, or connect the client's own database.
        </p>
      </header>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-medium block mb-1">Process</label>
          <Select value={processCode} onValueChange={setProcessCode}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Select a process" /></SelectTrigger>
            <SelectContent>
              {(processes.data?.data ?? []).map((p) => (
                <SelectItem key={p.processCode} value={p.processCode}>{p.billingName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">From</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">To</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
      </div>

      {!processCode && <p className="text-sm text-muted-foreground">Pick a process to begin.</p>}

      {processCode && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Supplied values</h2>
            {values.data?.data?.length ? (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="text-left py-2">Metric</th><th className="text-left">Date</th>
                      <th className="text-right">Value</th><th className="text-left pl-4">Source</th></tr>
                </thead>
                <tbody>
                  {values.data.data.map((r) => (
                    <tr key={`${r.metricKey}-${r.scoreDate}`}
                        className="border-t cursor-pointer hover:bg-muted/50"
                        onClick={() => setDrawerRow(r)}>
                      <td className="py-2">{r.metricKey}</td>
                      <td>{r.scoreDate}</td>
                      <td className="text-right tabular-nums">{r.value ?? "—"}</td>
                      <td className="pl-4">{r.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing supplied for this window yet.</p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Add a value</h2>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs font-medium block mb-1">Metric</label>
                <Select value={entry.metricKey} onValueChange={(v) => setEntry((e) => ({ ...e, metricKey: v }))}>
                  <SelectTrigger className="w-64"><SelectValue placeholder="Select a metric" /></SelectTrigger>
                  <SelectContent>
                    {suppliedMetrics.map((m) => (
                      <SelectItem key={m.metricKey} value={m.metricKey}>{m.lobLabel} — {m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Date</label>
                <Input type="date" value={entry.scoreDate} className="w-40"
                       onChange={(e) => setEntry((s) => ({ ...s, scoreDate: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Value</label>
                <Input type="number" value={entry.value} className="w-32" placeholder="blank = no reading"
                       onChange={(e) => setEntry((s) => ({ ...s, value: e.target.value }))} />
              </div>
              <div className="flex-1 min-w-48">
                <label className="text-xs font-medium block mb-1">Note</label>
                <Input value={entry.note} onChange={(e) => setEntry((s) => ({ ...s, note: e.target.value }))} />
              </div>
              <Button disabled={!entry.metricKey || saveValue.isPending} onClick={() => saveValue.mutate()}>
                {saveValue.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
            {saveValue.isError && (
              <p className="text-sm text-destructive">{(saveValue.error as Error).message}</p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Connect this client's database</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {([
                ["integration_name", "Name"], ["host", "Host"], ["port", "Port"],
                ["database", "Database"], ["username", "Username"], ["password", "Password"],
              ] as const).map(([field, label]) => (
                <div key={field}>
                  <label className="text-xs font-medium block mb-1">{label}</label>
                  <Input type={field === "password" ? "password" : "text"}
                         value={conn[field]}
                         onChange={(e) => setConn((c) => ({ ...c, [field]: e.target.value }))} />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium block mb-1">Type</label>
                <Select value={conn.db_type} onValueChange={(v) => setConn((c) => ({ ...c, db_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mysql">MySQL</SelectItem>
                    <SelectItem value="mssql">SQL Server</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-3 items-center">
              <Button variant="outline" disabled={createConnector.isPending}
                      onClick={() => createConnector.mutate()}>Save connection</Button>
              <Button variant="outline" disabled={!connKey || testConnector.isPending}
                      onClick={() => testConnector.mutate()}>Test connection</Button>
              {connKey && <span className="text-xs text-muted-foreground">Key: {connKey}</span>}
            </div>

            <h3 className="text-sm font-semibold pt-2">Map a metric to a column</h3>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs font-medium block mb-1">Metric</label>
                <Select value={mapping.metricKey} onValueChange={(v) => setMapping((m) => ({ ...m, metricKey: v }))}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="Select a metric" /></SelectTrigger>
                  <SelectContent>
                    {suppliedMetrics.map((m) => (
                      <SelectItem key={m.metricKey} value={m.metricKey}>{m.lobLabel} — {m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {([["table", "Table"], ["valueColumn", "Value column"], ["dateColumn", "Date column"]] as const)
                .map(([field, label]) => (
                <div key={field}>
                  <label className="text-xs font-medium block mb-1">{label}</label>
                  <Input className="w-40" value={mapping[field]}
                         onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))} />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium block mb-1">Aggregate</label>
                <Select value={mapping.aggregate} onValueChange={(v) => setMapping((m) => ({ ...m, aggregate: v }))}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AGGREGATES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button disabled={!connKey || !mapping.metricKey || refresh.isPending}
                      onClick={() => refresh.mutate()}>
                {refresh.isPending ? "Refreshing…" : "Refresh now"}
              </Button>
            </div>
            {refresh.isError && <p className="text-sm text-destructive">{(refresh.error as Error).message}</p>}
            {refresh.isSuccess && <p className="text-sm text-emerald-600">Refreshed.</p>}
          </section>
        </>
      )}

      <Sheet open={!!drawerRow} onOpenChange={(o) => !o && setDrawerRow(null)}>
        <SheetContent className="max-w-2xl overflow-y-auto">
          <SheetHeader><SheetTitle>{drawerRow?.metricKey}</SheetTitle></SheetHeader>
          {drawerRow && (
            <dl className="mt-4 space-y-3 text-sm">
              {([["Metric", drawerRow.metricKey], ["Date", drawerRow.scoreDate],
                 ["Value", drawerRow.value ?? "— (no reading)"], ["Source", drawerRow.source],
                 ["Note", drawerRow.note ?? "None"]] as const).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">{k}</dt>
                  <dd>{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
```

- [ ] **Step 3: Wire the route, page code, nav and demo list**

- `src/config/routes/performance.routes.tsx` — add beside the existing Process KPI Dashboard route, same `<ProtectedRoute roles={...}>` + gate composition, path `/performance/process-data-sources`.
- `src/lib/pageRoutePageCodes.ts` — map that path to `PROCESS_DATA_SOURCE`.
- `src/components/layout/navConfig.tsx` — one entry next to Process KPI Dashboard.
- `src/lib/demoCreds.ts` — add `"PROCESS_DATA_SOURCE"` to `ALL_PAGES`. Without this the demo super-admin login gets "Access Denied", because demo mode computes its page list client-side from that array and never calls the real access API.

- [ ] **Step 4: Build and verify the page is reachable**

Run: `cd C:/Users/ADMIN/Desktop/HRMS2-latest && npm run build 2>&1 | tail -5`
Expected: build completes with no TypeScript errors.

Run: `grep -rn "PROCESS_DATA_SOURCE" src/lib/pageRoutePageCodes.ts src/lib/demoCreds.ts src/components/layout/navConfig.tsx`
Expected: one hit in each — an unlinked route is a page nobody can reach.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProcessDataSourcePage.tsx \
        src/config/routes/performance.routes.tsx \
        src/lib/pageRoutePageCodes.ts \
        src/components/layout/navConfig.tsx \
        src/lib/demoCreds.ts
git commit -F - <<'EOF'
feat(process-data-source): screen to supply or connect a process's own data

One page per process: the values already supplied, a form to add one, and a
connector setup that registers the client's database, tests it, maps a metric to
a column plus aggregate, and refreshes on demand.

Every closed set is a dropdown per the Form Input Rule -- a free-text metric or
aggregate would fork the key space silently. Rows drill into a slide-over per the
Drill-Down Mandate.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## End-to-end verification

Run after Task 8, before reporting the feature done.

- [ ] **Backend suite for everything touched**

Run: `cd backend && npx vitest run src/modules/process-data-source src/modules/process-performance/__tests__/process-metric-source.test.ts src/modules/external-db src/modules/kpi/__tests__/kpi-studio-lineage.test.ts`
Expected: all pass.

- [ ] **Typecheck both halves**

Run: `cd backend && npx tsc --noEmit 2>&1 | grep -E "process-data-source|process-metric-source|external-db|kpi-studio" ; echo done`
Expected: only `done`.

Run: `cd C:/Users/ADMIN/Desktop/HRMS2-latest && npm run build 2>&1 | tail -5`
Expected: clean build.

- [ ] **Live smoke test against the running local backend**

The local dev server on `http://localhost:8080` is connected to the real `mas_hrms` and hot-reloads. `mock-token-super_admin` is a valid bearer token while `INTERNAL_DEMO_BYPASS=true`.

The table does not exist locally until the migration is applied to a **local/staging** schema — never production. With it applied:

```bash
# A not_tracked metric should now report no_data, with a null actual
curl -s -H "Authorization: Bearer mock-token-super_admin" \
  "http://localhost:8080/api/process-kpi-dashboard/GS1/scorecards?from=2026-08-01&to=2026-08-31" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const m=JSON.parse(d).data.find(x=>x.metricKey==='gs1_email_tat_sec');console.log(m.availability,m.actual)})"
```
Expected: `no_data null`

```bash
# Supply a value, then confirm the dashboard reads it back
PROC=$(curl -s -H "Authorization: Bearer mock-token-super_admin" \
  "http://localhost:8080/api/process-kpi-dashboard/GS1/header" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).data.processId))")

curl -s -X POST -H "Authorization: Bearer mock-token-super_admin" -H "Content-Type: application/json" \
  -d '{"metricKey":"gs1_email_tat_sec","scoreDate":"2026-08-15","value":3200,"note":"smoke test"}' \
  "http://localhost:8080/api/process-data-source/$PROC/values"
```
Expected: `{"success":true,...}`, then re-running the scorecards call reports `ok 3200`.

- [ ] **Scope boundary, tested at the API rather than in the UI**

Call `POST /api/process-data-source/<some other process id>/values` with a `process_manager` token whose scope excludes it.
Expected: HTTP 403 `OUT_OF_SCOPE` — not a 200 with a silently ignored write.

- [ ] **The honesty rule still holds**

Confirm a metric with a row whose `actual_value` is NULL reports `no_data`, not `0`. This is the property the whole dashboard rests on.

## Not done by this plan, and deliberately

- The migration is **not** executed against production. It needs separate explicit approval, then a deploy.
- No per-connector refresh schedule UI; refresh is on demand.
- No backfill of history from a newly connected database beyond the window asked for.
