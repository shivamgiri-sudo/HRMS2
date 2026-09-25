import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * employees is a ~55k-row table with 40+ indexes and 183 foreign keys pointing at it, read
 * by multi-minute jobs. An ALTER that rebuilds it (the default COPY algorithm) held every
 * write for 13+ minutes on 2026-09-25, and an ALTER that merely waits for its metadata
 * lock queues every other query behind it -- production returned 502 until it cleared.
 * A DDL there must therefore be online: INSTANT for column changes, INPLACE for indexes.
 *
 * Applies to migrations numbered above the last one that predates this rule; the ones
 * already applied are history and are not re-checked.
 */
const FIRST_GUARDED_MIGRATION = 1891;

export function unsafeEmployeesDdl(sql: string): string[] {
  const statements = sql.match(/ALTER\s+TABLE\s+`?employees`?\s[^;]*/gi) ?? [];
  return statements.filter(
    (s) => !/ALGORITHM\s*=\s*(INSTANT|INPLACE)/i.test(s),
  );
}

function guardedMigrationFiles(): string[] {
  const dirs = [
    resolve(process.cwd(), "sql"),
    resolve(process.cwd(), "sql/migrations"),
  ];
  const files: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const m = name.match(/^(\d+)_.*\.sql$/);
      if (m && Number(m[1]) >= FIRST_GUARDED_MIGRATION)
        files.push(join(dir, name));
    }
  }
  return files;
}

describe("employees DDL must be online", () => {
  it("flags a plain ALTER TABLE employees", () => {
    expect(
      unsafeEmployeesDdl(
        "ALTER TABLE employees ADD COLUMN x TINYINT(1) NOT NULL DEFAULT 0;",
      ),
    ).toHaveLength(1);
  });

  it("flags the backtick-quoted form and the form inside a PREPARE string", () => {
    expect(
      unsafeEmployeesDdl("ALTER TABLE `employees` DROP COLUMN x;"),
    ).toHaveLength(1);
    expect(
      unsafeEmployeesDdl(
        "SET @s = 'ALTER TABLE employees ADD INDEX i (a)'; PREPARE p FROM @s;",
      ),
    ).toHaveLength(1);
  });

  it("accepts INSTANT column changes and INPLACE index changes", () => {
    expect(
      unsafeEmployeesDdl(
        "ALTER TABLE employees ADD COLUMN x TINYINT(1) NOT NULL DEFAULT 0, ALGORITHM=INSTANT;",
      ),
    ).toEqual([]);
    expect(
      unsafeEmployeesDdl(
        "ALTER TABLE employees ADD INDEX i (a), ALGORITHM=INPLACE, LOCK=NONE;",
      ),
    ).toEqual([]);
  });

  it("ignores ALTERs on other tables", () => {
    expect(
      unsafeEmployeesDdl("ALTER TABLE employee_address ADD COLUMN x INT;"),
    ).toEqual([]);
  });

  it("no guarded migration alters employees without an online algorithm", () => {
    const offenders = guardedMigrationFiles().flatMap((file) =>
      unsafeEmployeesDdl(readFileSync(file, "utf8")).map(
        (s) => `${file}: ${s.slice(0, 80)}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
