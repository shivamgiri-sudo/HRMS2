/**
 * Drop_Duplicate_Employee_Indexes — removes EXACT duplicate secondary indexes from
 * mas_hrms.employees (same columns, same order, same prefix lengths, same direction, all
 * non-unique BTREE). One copy of each group is kept, so every query and every foreign key
 * that was served by the group is still served. Dropping an index never changes results,
 * only write cost and disk.
 *
 * Found live 2026-09-25: 41 indexes on a 55k-row table, 10 of them duplicates created by
 * different migrations and one-off scripts under different names, e.g. five identical
 * indexes on employee_code / department_id-style columns. Every INSERT/UPDATE on employees
 * maintains all of them.
 *
 * Why a script and NOT a boot-time migration: employees is read by long jobs (the Employee
 * Master snapshot runs for minutes). A DDL waits for the metadata lock those readers hold,
 * and every new query then queues behind the waiting DDL. Inside the migration runner a
 * timeout would fail the boot and block production startup. Here the operator picks a quiet
 * moment, the script refuses to start while long queries are running, uses a short
 * lock_wait_timeout with retries, and a failure changes nothing.
 *
 *   # from /var/www/HRMS2/backend (or any host that can reach mas_hrms)
 *   npx tsx scripts/drop-duplicate-employee-indexes.ts             # plan only, changes nothing
 *   npx tsx scripts/drop-duplicate-employee-indexes.ts --confirm   # actually drops
 *
 * Rollback: the run prints an ADD INDEX statement for every index it drops.
 *
 * Deliberately NOT touched: UNIQUE indexes, PRIMARY, FULLTEXT, and prefix-redundant indexes
 * such as (a) alongside (a,b). Those are not exact duplicates and need their own review.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2/promise";

const TABLE = "employees";
const LOCK_WAIT_SECONDS = 10;
const MAX_ATTEMPTS = 5;
const RETRY_PAUSE_MS = 5000;
const LONG_QUERY_SECONDS = 30;

export type IndexRow = {
  name: string;
  nonUnique: number;
  indexType: string;
  seq: number;
  column: string;
  subPart: number | null;
  collation: string | null;
};

export type DropPlanEntry = { drop: string; keep: string; columns: string[] };

const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;

function assertSafeIdentifier(value: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(`Refusing unsafe identifier: ${JSON.stringify(value)}`);
  }
  return value;
}

export function buildDropStatement(indexName: string): string {
  return `ALTER TABLE \`${TABLE}\` DROP INDEX \`${assertSafeIdentifier(indexName)}\`, ALGORITHM=INPLACE, LOCK=NONE`;
}

export function buildRestoreStatement(
  indexName: string,
  columns: string[],
): string {
  const cols = columns.map((c) => `\`${assertSafeIdentifier(c)}\``).join(", ");
  return `ALTER TABLE \`${TABLE}\` ADD INDEX \`${assertSafeIdentifier(indexName)}\` (${cols}), ALGORITHM=INPLACE, LOCK=NONE`;
}

type IndexShape = {
  name: string;
  nonUnique: number;
  indexType: string;
  parts: { column: string; subPart: number | null; collation: string }[];
};

function shapesOf(rows: IndexRow[]): IndexShape[] {
  const byName = new Map<string, IndexShape>();
  for (const r of [...rows].sort((a, b) => a.seq - b.seq)) {
    const shape = byName.get(r.name) ?? {
      name: r.name,
      nonUnique: r.nonUnique,
      indexType: r.indexType,
      parts: [],
    };
    shape.parts.push({
      column: r.column,
      subPart: r.subPart,
      collation: r.collation ?? "A",
    });
    byName.set(r.name, shape);
  }
  return [...byName.values()];
}

const signatureOf = (s: IndexShape): string =>
  s.parts.map((p) => `${p.column}|${p.subPart ?? ""}|${p.collation}`).join(",");

// idx_emp_* is the original naming; the later idx_employees_* names are the copies.
const keepRank = (name: string): number =>
  name.startsWith("idx_emp_") ? 0 : 1;

export function planDuplicateIndexDrops(rows: IndexRow[]): DropPlanEntry[] {
  const eligible = shapesOf(rows).filter(
    (s) => s.name !== "PRIMARY" && s.nonUnique === 1 && s.indexType === "BTREE",
  );
  const groups = new Map<string, IndexShape[]>();
  for (const s of eligible) {
    const key = signatureOf(s);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  const plan: DropPlanEntry[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ordered = [...members].sort(
      (a, b) =>
        keepRank(a.name) - keepRank(b.name) || a.name.localeCompare(b.name),
    );
    const [keep, ...extras] = ordered;
    for (const extra of extras) {
      plan.push({
        drop: extra.name,
        keep: keep.name,
        columns: extra.parts.map((p) => p.column),
      });
    }
  }
  return plan.sort((a, b) => a.drop.localeCompare(b.drop));
}

type Db = {
  execute: <T extends RowDataPacket[]>(
    sql: string,
    params?: unknown[],
  ) => Promise<[T, unknown]>;
  getConnection: () => Promise<{
    query: (sql: string) => Promise<unknown>;
    release: () => void;
  }>;
};

async function readIndexRows(db: Db): Promise<IndexRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT INDEX_NAME, NON_UNIQUE, INDEX_TYPE, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART, COLLATION
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [TABLE],
  );
  return (rows as RowDataPacket[]).map((r) => ({
    name: String(r.INDEX_NAME),
    nonUnique: Number(r.NON_UNIQUE),
    indexType: String(r.INDEX_TYPE),
    seq: Number(r.SEQ_IN_INDEX),
    column: String(r.COLUMN_NAME),
    subPart: r.SUB_PART === null ? null : Number(r.SUB_PART),
    collation: r.COLLATION === null ? null : String(r.COLLATION),
  }));
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const { db } = (await import("../src/db/mysql.js")) as unknown as { db: Db };

  const plan = planDuplicateIndexDrops(await readIndexRows(db));
  console.log(
    confirm
      ? "MODE: CONFIRMED (will drop)"
      : "MODE: PLAN ONLY (nothing will be dropped)",
  );
  console.log(`Exact duplicate indexes on ${TABLE}: ${plan.length}`);
  for (const p of plan) {
    console.log(
      `  drop ${p.drop}  (keeps ${p.keep})  on (${p.columns.join(", ")})`,
    );
  }
  if (plan.length === 0 || !confirm) {
    if (!confirm && plan.length > 0)
      console.log("\nPLAN ONLY — re-run with --confirm to drop.");
    return;
  }

  const [busy] = await db.execute<RowDataPacket[]>(
    `SELECT id, time FROM information_schema.processlist
      WHERE command <> 'Sleep' AND info LIKE '%employees%' AND time > ? AND id <> CONNECTION_ID()`,
    [LONG_QUERY_SECONDS],
  );
  if ((busy as RowDataPacket[]).length > 0) {
    console.error(
      `\nREFUSING: ${(busy as RowDataPacket[]).length} query(ies) on employees have run > ${LONG_QUERY_SECONDS}s. ` +
        "A DDL would wait behind them and block every new query. Re-run when they finish.",
    );
    process.exitCode = 2;
    return;
  }

  const conn = await db.getConnection();
  const restore: string[] = [];
  try {
    await conn.query(`SET SESSION lock_wait_timeout = ${LOCK_WAIT_SECONDS}`);
    for (const p of plan) {
      // Re-check right before each drop: only drop while the kept twin still exists.
      const current = planDuplicateIndexDrops(await readIndexRows(db));
      if (!current.some((c) => c.drop === p.drop && c.keep === p.keep)) {
        console.log(`  skip ${p.drop}: no longer a duplicate of ${p.keep}`);
        continue;
      }
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          await conn.query(buildDropStatement(p.drop));
          console.log(`  dropped ${p.drop}`);
          restore.push(buildRestoreStatement(p.drop, p.columns));
          break;
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code === "ER_LOCK_WAIT_TIMEOUT" && attempt < MAX_ATTEMPTS) {
            console.log(
              `  ${p.drop}: metadata lock busy, retry ${attempt}/${MAX_ATTEMPTS - 1}`,
            );
            await sleep(RETRY_PAUSE_MS);
            continue;
          }
          throw err;
        }
      }
    }
  } finally {
    conn.release();
    if (restore.length > 0) {
      console.log("\nRollback statements:");
      restore.forEach((s) => console.log(`  ${s};`));
    }
  }
}

if (
  process.argv[1] &&
  /drop-duplicate-employee-indexes\.(ts|js)$/.test(process.argv[1])
) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
