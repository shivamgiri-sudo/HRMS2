# Make Silent Failures Visible Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every schema/logic database failure visible in logs and at startup, so defects like a report that never returns a row or a dashboard tile showing a confident zero cannot survive unnoticed.

**Architecture:** Three independent guards, each additive. (1) One log statement in the DB layer's retry wrapper, so a failing query is recorded *before* any caller can swallow it — this covers 90 known silent catches without editing 90 files. (2) A startup check that compares tables the code references against the live schema and logs what is missing, because `SKIP_MIGRATIONS=true` means deploys never apply schema. (3) A test that fails when a new table is created on a non-standard collation, stopping the 44-table drift from growing.

**Tech Stack:** TypeScript, Node 24, Express, MySQL 8 (`mysql2/promise`), Vitest, pino.

## Global Constraints

- Production is live. Every change is additive; no existing behaviour is removed.
- Other agents edit this repo concurrently. Stage files by explicit path; never `git add -A`.
- `backend/tsconfig.json` sets `"types": ["node"]`. Scoped typecheck configs must include
  `src/**/*.ts` or they produce false `Express.Multer` errors.
- Never put backticks inside a SQL `--` comment nested in a JS template literal; it
  terminates the literal. Use plain words.
- Verify unique keys with `SHOW INDEX`, never `information_schema` (its UPPERCASE keys make
  assertions silently invert).
- The backend build is `tsc --noEmitOnError false` — it emits despite errors. Always capture
  the exit code.

---

### Task 1: Log database schema/logic errors at the source

**Files:**
- Modify: `backend/src/db/mysql.ts` (inside `withTransientRetry`, around line 134-174)
- Test: `backend/src/db/__tests__/query-error-visibility.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `isSchemaOrLogicDbError(error: unknown): boolean` exported from
  `backend/src/db/mysql.ts`. Task 2 does not use it; Task 3 does not use it. Exported only
  so the test can assert classification directly.

**Why here:** `withTransientRetry` already sees every query error. It handles transient and
connection-pressure errors and rethrows everything else untouched. A caller that writes
`.catch(() => [[{ cnt: 0 }]])` then converts that rethrow into a fake zero. 90 such call
sites exist. Logging once here covers all of them.

**Do NOT** log transient/connection errors — they are already handled, retried, and would
flood the log during a deploy blip.

- [ ] **Step 1: Write the failing test**

Create `backend/src/db/__tests__/query-error-visibility.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isSchemaOrLogicDbError } from "../mysql.js";

const err = (code: string) => Object.assign(new Error(code), { code });

describe("isSchemaOrLogicDbError", () => {
  it.each([
    "ER_BAD_FIELD_ERROR",
    "ER_NO_SUCH_TABLE",
    "ER_CANT_AGGREGATE_2COLLATIONS",
    "ER_PARSE_ERROR",
    "ER_DUP_ENTRY",
    "ER_DATA_TOO_LONG",
    "ER_WRONG_ARGUMENTS",
  ])("classifies %s as a schema/logic error worth logging", (code) => {
    expect(isSchemaOrLogicDbError(err(code))).toBe(true);
  });

  it.each(["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "ETIMEDOUT", "ER_CON_COUNT_ERROR"])(
    "does NOT classify transient %s (already retried; logging would flood)",
    (code) => {
      expect(isSchemaOrLogicDbError(err(code))).toBe(false);
    },
  );

  it("ignores a non-error value", () => {
    expect(isSchemaOrLogicDbError(undefined)).toBe(false);
    expect(isSchemaOrLogicDbError("boom")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend && npx vitest run src/db/__tests__/query-error-visibility.test.ts`
Expected: FAIL — `isSchemaOrLogicDbError` is not exported from `../mysql.js`.

- [ ] **Step 3: Implement the classifier and the log**

In `backend/src/db/mysql.ts`, add near the other error predicates:

```ts
/**
 * Schema and logic errors — a wrong column, a missing table, a collation mismatch. These
 * are bugs, not blips: retrying cannot help and the caller frequently swallows them into a
 * fake empty result. Logged here, once, so a swallowed failure still leaves a trace.
 *
 * Deliberately excludes transient/connection codes: those are already retried above, and
 * logging them would flood the log on every deploy blip.
 */
const SCHEMA_OR_LOGIC_DB_CODES = new Set([
  "ER_BAD_FIELD_ERROR",
  "ER_NO_SUCH_TABLE",
  "ER_BAD_TABLE_ERROR",
  "ER_CANT_AGGREGATE_2COLLATIONS",
  "ER_CANT_AGGREGATE_3COLLATIONS",
  "ER_CANT_AGGREGATE_NCOLLATIONS",
  "ER_PARSE_ERROR",
  "ER_DUP_ENTRY",
  "ER_DATA_TOO_LONG",
  "ER_WRONG_ARGUMENTS",
  "ER_WRONG_VALUE_COUNT_ON_ROW",
  "ER_TRUNCATED_WRONG_VALUE",
  "ER_NO_REFERENCED_ROW_2",
  "ER_ROW_IS_REFERENCED_2",
  "ER_CHECK_CONSTRAINT_VIOLATED",
]);

export function isSchemaOrLogicDbError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && SCHEMA_OR_LOGIC_DB_CODES.has(code);
}
```

Then inside `withTransientRetry`, in the `catch (error)` block, immediately after
`lastError = error;` and BEFORE the connection-pressure branch:

```ts
      // Visibility, not control flow: the error still propagates exactly as before. Many
      // callers convert it into an empty result set, which is how a report that never
      // returned a row and a dashboard tile stuck at zero both went unnoticed.
      if (isSchemaOrLogicDbError(error)) {
        const e = error as { code?: string; sqlMessage?: string; sql?: string };
        console.error(
          `[mysql] ${e.code}: ${(e.sqlMessage ?? "").slice(0, 200)} | sql: ${(e.sql ?? "").replace(/\s+/g, " ").slice(0, 300)}`,
        );
      }
```

- [ ] **Step 4: Run the test and make sure it passes**

Run: `cd backend && npx vitest run src/db/__tests__/query-error-visibility.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Prove it does not change behaviour**

Run: `cd backend && npx vitest run src/db/__tests__/`
Expected: all existing DB tests still pass — the change adds a log line and rethrows the
same error object.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/mysql.ts backend/src/db/__tests__/query-error-visibility.test.ts
git commit -m "fix(db): log schema and logic query errors before callers can swallow them"
```

---

### Task 2: Fail loudly at startup when a referenced table is missing

**Files:**
- Create: `backend/src/db/schema-presence-check.ts`
- Modify: `backend/src/server.ts` (call it after the pool is ready, before route mounting)
- Test: `backend/src/db/__tests__/schema-presence-check.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `checkRequiredTables(db: Pick<Connection, "query">, required: string[]):
  Promise<{ missing: string[] }>` from `backend/src/db/schema-presence-check.ts`.

**Why:** `SKIP_MIGRATIONS=true` in production means a deploy never applies schema. Code
therefore ships referencing tables that do not exist — `employee_geofence_alerts` logged 167
errors this way, and `ats_sla_tat_rules` still does. A startup line naming the missing tables
turns a slow drip of runtime errors into one obvious message.

**Scope:** report, do not throw. Throwing would take production down for a table some
optional feature wants. The point is visibility.

- [ ] **Step 1: Write the failing test**

Create `backend/src/db/__tests__/schema-presence-check.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkRequiredTables } from "../schema-presence-check.js";

function fakeDb(existing: string[]) {
  return {
    query: async () => [existing.map((n) => ({ TABLE_NAME: n })), []] as never,
  };
}

describe("checkRequiredTables", () => {
  it("reports nothing when every required table exists", async () => {
    const r = await checkRequiredTables(fakeDb(["employees", "leave_request"]), [
      "employees",
      "leave_request",
    ]);
    expect(r.missing).toEqual([]);
  });

  it("names the tables that are absent", async () => {
    const r = await checkRequiredTables(fakeDb(["employees"]), [
      "employees",
      "employee_geofence_alerts",
      "ats_sla_tat_rules",
    ]);
    expect(r.missing).toEqual(["ats_sla_tat_rules", "employee_geofence_alerts"]);
  });

  it("is case-insensitive, because MySQL table names are on Linux but not Windows", async () => {
    const r = await checkRequiredTables(fakeDb(["Employees"]), ["employees"]);
    expect(r.missing).toEqual([]);
  });

  it("returns no missing tables when asked for none", async () => {
    const r = await checkRequiredTables(fakeDb([]), []);
    expect(r.missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend && npx vitest run src/db/__tests__/schema-presence-check.test.ts`
Expected: FAIL — cannot find module `../schema-presence-check.js`.

- [ ] **Step 3: Implement it**

Create `backend/src/db/schema-presence-check.ts`:

```ts
import type { RowDataPacket } from "mysql2";

/**
 * Compares a list of tables the application needs against what the database actually has.
 *
 * Exists because production runs with SKIP_MIGRATIONS=true, so a deploy applies no schema.
 * Code can therefore ship referencing a table nobody created — employee_geofence_alerts
 * logged 167 errors before anyone noticed, and its migration had simply never been run.
 *
 * Reports; does not throw. A missing table for one optional feature must not stop the
 * server booting.
 */
export async function checkRequiredTables(
  db: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  required: string[],
): Promise<{ missing: string[] }> {
  if (required.length === 0) return { missing: [] };

  const result = (await db.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`,
  )) as [RowDataPacket[], unknown];

  const present = new Set(
    (result[0] ?? []).map((r) => String((r as { TABLE_NAME: string }).TABLE_NAME).toLowerCase()),
  );

  const missing = required
    .map((t) => t.toLowerCase())
    .filter((t) => !present.has(t))
    .sort();

  return { missing };
}

/**
 * Tables whose absence has already caused production errors, plus the ones a core flow
 * cannot work without. Deliberately a short curated list rather than every table the code
 * mentions: a generated list is mostly false positives from aliases and CTEs, and a check
 * nobody trusts is a check nobody reads.
 */
export const REQUIRED_TABLES: string[] = [
  "employees",
  "branch_master",
  "leave_request",
  "attendance_daily_record",
  "salary_prep_run",
  "notification_event_config",
  "notification_dispatch_claim",
  "communication_template",
  "employee_geofence_alerts",
  "tat_matrix_master",
  "escalation_matrix_master",
  "finance_grn_sequence",
  "grn_request",
  "lms_employee_mapping",
];
```

- [ ] **Step 4: Run the test and make sure it passes**

Run: `cd backend && npx vitest run src/db/__tests__/schema-presence-check.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire it into startup**

In `backend/src/server.ts`, add the import beside the other db imports:

```ts
import { checkRequiredTables, REQUIRED_TABLES } from "./db/schema-presence-check.js";
```

Then, inside the async startup path after the pool is confirmed reachable and before the
server begins listening, add:

```ts
  // SKIP_MIGRATIONS=true in production means a deploy applies no schema, so code can ship
  // against a table nobody created. Name them once at boot instead of discovering it later
  // from a drip of runtime errors.
  void checkRequiredTables(db, REQUIRED_TABLES)
    .then(({ missing }) => {
      if (missing.length > 0) {
        console.error(
          `[schema] ${missing.length} required table(s) MISSING — run the matching migration: ${missing.join(", ")}`,
        );
      }
    })
    .catch((err: unknown) => {
      console.warn("[schema] presence check skipped:", (err as Error).message);
    });
```

- [ ] **Step 6: Typecheck**

Run:
```bash
cd backend && cat > tsconfig.presence.json <<'EOF'
{ "extends": "./tsconfig.json",
  "include": ["src/**/*.ts"],
  "compilerOptions": { "noEmit": true } }
EOF
npx tsc -p tsconfig.presence.json 2>&1 | head -10; echo "EXIT=${PIPESTATUS[0]}"; rm -f tsconfig.presence.json
```
Expected: `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/schema-presence-check.ts backend/src/db/__tests__/schema-presence-check.test.ts backend/src/server.ts
git commit -m "feat(db): name missing tables at startup instead of discovering them from runtime errors"
```

---

### Task 3: Stop the collation drift growing

**Files:**
- Create: `backend/src/db/__tests__/collation-drift.test.ts`
- Create: `backend/sql/1045_collation_drift_guard_notes.sql` (documentation only, no DDL)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by other tasks.

**Why:** 44 of 807 tables are `utf8mb4_0900_ai_ci` while 757 are `utf8mb4_unicode_ci`. Each is
a latent `ER_CANT_AGGREGATE_2COLLATIONS` the moment someone text-joins across the boundary —
which is exactly what kept `employee_reimbursement_claim` broken from the day it was created.
The cause is DDL that writes `DEFAULT CHARSET=utf8mb4` and omits `COLLATE`, letting MySQL 8
apply its server default.

**Scope:** converting 44 populated tables in one migration is a large, lock-heavy change
justified by nothing yet observed. Convert individually when a real failure points at one
(as `1038` did). This task stops the count *growing*.

- [ ] **Step 1: Write the failing test**

Create `backend/src/db/__tests__/collation-drift.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SQL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "sql");

/**
 * MySQL 8 applies the SERVER default collation (utf8mb4_0900_ai_ci) when DDL names a
 * charset but no collation. mas_hrms is overwhelmingly utf8mb4_unicode_ci, so such a table
 * cannot be text-joined to employees without ER_CANT_AGGREGATE_2COLLATIONS. That is what
 * broke employee_reimbursement_claim from creation.
 */
function offendingCreateTables(sql: string): string[] {
  const out: string[] = [];
  const re = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?(\w+)`?[\s\S]*?;/gi;
  for (const m of sql.matchAll(re)) {
    const body = m[0];
    if (/DEFAULT\s+CHARSET\s*=\s*utf8mb4/i.test(body) && !/COLLATE\s*=?\s*utf8mb4_\w+/i.test(body)) {
      out.push(m[1]);
    }
  }
  return out;
}

describe("collation drift", () => {
  it("detects DDL that sets a charset but no collation", () => {
    const bad = "CREATE TABLE x (id INT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";
    expect(offendingCreateTables(bad)).toEqual(["x"]);
  });

  it("accepts DDL that pins the collation", () => {
    const good =
      "CREATE TABLE y (id INT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;";
    expect(offendingCreateTables(good)).toEqual([]);
  });

  it("no migration numbered 1039 or higher creates a table without COLLATE", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(SQL_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f))) {
      if (Number(f.slice(0, 4)) < 1039) continue; // pre-existing debt, converted as touched
      const found = offendingCreateTables(readFileSync(resolve(SQL_DIR, f), "utf8"));
      if (found.length) offenders.push(`${f}: ${found.join(", ")}`);
    }
    expect(offenders, `Add COLLATE=utf8mb4_unicode_ci to:\n${offenders.join("\n")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd backend && npx vitest run src/db/__tests__/collation-drift.test.ts`
Expected: PASS, 3 tests. If the third fails, it has found a real new offender — add
`COLLATE=utf8mb4_unicode_ci` to the named migration and re-run.

- [ ] **Step 3: Record the remaining debt**

Create `backend/sql/1045_collation_drift_guard_notes.sql`:

```sql
-- 1045_collation_drift_guard_notes.sql
--
-- DOCUMENTATION ONLY. This file intentionally contains no DDL and never needs running.
--
-- 44 of 807 tables are utf8mb4_0900_ai_ci while 757 are utf8mb4_unicode_ci. Each is a
-- latent ER_CANT_AGGREGATE_2COLLATIONS the moment it is text-joined across the boundary.
-- employee_reimbursement_claim was broken from the day it was created for exactly this
-- reason; migration 1038 converted it, and 426 was corrected before it was ever applied.
--
-- These are NOT converted wholesale on purpose: rewriting 44 populated tables takes a
-- metadata lock on each and is justified by nothing yet observed. Convert one when a real
-- failure points at it, using:
--
--   ALTER TABLE <t> CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--
-- On an empty table that is instant. On a populated one it rewrites every row — take a
-- window.
--
-- The growth is stopped by src/db/__tests__/collation-drift.test.ts, which fails when any
-- migration numbered 1039+ creates a table with a charset but no collation.
--
-- To list the current offenders:
--   SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES
--    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
--      AND TABLE_COLLATION <> 'utf8mb4_unicode_ci'
--    ORDER BY TABLE_NAME;
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/__tests__/collation-drift.test.ts backend/sql/1045_collation_drift_guard_notes.sql
git commit -m "test(db): fail the build when new DDL omits COLLATE"
```

---

## Verification (all tasks)

- [ ] `cd backend && npx vitest run src/db/__tests__/` — all pass
- [ ] Scoped typecheck with `"include": ["src/**/*.ts"]` — `EXIT=0`
- [ ] Deploy, then confirm the startup line appears once:
      `pm2 logs hrms2-backend --out --lines 200 --nostream | grep "\[schema\]"`
- [ ] Confirm swallowed failures now surface:
      `pm2 logs hrms2-backend --err --lines 200 --nostream | grep "^\[mysql\] ER_"`
      Expected: entries for any query still failing — previously invisible.
