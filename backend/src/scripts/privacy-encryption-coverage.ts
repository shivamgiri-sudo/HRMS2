/**
 * Privacy Encryption Coverage
 *
 * Read-only. Answers the question privacy-inventory-scan.ts cannot: not "is this column
 * sensitive" but "is this sensitive column actually protected".
 *
 * WHY IT EXISTS
 *   The inventory scanner classifies 505 columns across 173 tables by NAME, and its output
 *   carries no encryption field at all. So it reports employees.aadhaar_number as
 *   highly_sensitive and says nothing about the fact that the column holds tens of thousands
 *   of values while employees.aadhaar_number_encrypted, built for exactly this, holds none.
 *   Naming a column sensitive and knowing it is unprotected are different questions, and only
 *   the first was being asked. That is how a plaintext identity store goes unnoticed for
 *   months in a codebase that already has privacy tooling.
 *
 * WHAT IT DOES
 *   For every column matching a sensitive-identifier pattern, finds its protected siblings in
 *   the same table (<col>_encrypted / _enc / _hash / _masked / _last4) and counts how many
 *   rows are populated on each side. A column with data and an empty protected sibling is the
 *   finding: the protection was designed, shipped as schema, and never applied.
 *
 * USAGE
 *   node --env-file=backend/.env node_modules/.bin/tsx backend/src/scripts/privacy-encryption-coverage.ts
 *   Optional: --output <path>   (defaults to stdout; see the warning below)
 *
 * OUTPUT IS SENSITIVE
 *   This report is a precise map of unprotected personal data. It never prints a VALUE — only
 *   table, column and counts — but the map itself is exactly what an attacker would want.
 *   privacy-inventory-findings.json and *privacy-findings*.json are gitignored for this
 *   reason; keep any file you write here out of the repository too.
 *
 * SAFETY
 *   SELECT and information_schema only. It issues no DDL, no UPDATE, no DELETE, and reads no
 *   column value — every query is a COUNT.
 */
import mysql from "mysql2/promise";
import fs from "fs";

/** Columns worth asking the question about. Deliberately narrow: identity and finance. */
const SENSITIVE = [
  /^aadhaar(_number|_id)?$/i,
  /^pan(_number|_no)?$/i,
  /^uan(_number|_no)?$/i,
  /^passport(_number|_no)?$/i,
  /^(bank_)?account(_number|_no)$/i,
];

/** Suffixes that indicate a protected form of the same value. */
const PROTECTED_SUFFIXES = ["_encrypted", "_enc", "_hash", "_masked", "_last4"];

type Row = Record<string, unknown>;

function isSensitive(column: string): boolean {
  // A protected sibling is not itself the raw column.
  if (PROTECTED_SUFFIXES.some((s) => column.toLowerCase().endsWith(s))) return false;
  return SENSITIVE.some((re) => re.test(column));
}

async function main(): Promise<void> {
  const database = process.env.DB_NAME ?? "mas_hrms";
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: "information_schema",
    connectTimeout: 20000,
  });

  const [columns] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME, COLUMN_NAME
       FROM COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database],
  );

  const byTable = new Map<string, string[]>();
  for (const r of columns as Row[]) {
    // mysql2 returns information_schema keys in either case depending on server config, so
    // accept both rather than silently reading undefined and reporting "no columns found".
    const table = String(r.TABLE_NAME ?? r.table_name);
    const column = String(r.COLUMN_NAME ?? r.column_name);
    if (!byTable.has(table)) byTable.set(table, []);
    byTable.get(table)!.push(column);
  }

  const findings: Array<Record<string, unknown>> = [];

  for (const [table, cols] of byTable) {
    for (const col of cols) {
      if (!isSensitive(col)) continue;

      const siblings = PROTECTED_SUFFIXES.map((s) => `${col}${s}`).filter((s) =>
        cols.some((c) => c.toLowerCase() === s.toLowerCase()),
      );

      let rawPopulated = 0;
      try {
        const [c] = await conn.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM \`${database}\`.\`${table}\`
            WHERE \`${col}\` IS NOT NULL AND TRIM(\`${col}\`) <> ''`,
        );
        rawPopulated = Number((c as Row[])[0].n);
      } catch {
        continue; // no read access, or a type TRIM cannot take — not a finding either way
      }
      if (rawPopulated === 0) continue;

      const siblingCounts: Record<string, number> = {};
      for (const s of siblings) {
        try {
          const [c] = await conn.query<mysql.RowDataPacket[]>(
            `SELECT COUNT(*) AS n FROM \`${database}\`.\`${table}\` WHERE \`${s}\` IS NOT NULL`,
          );
          siblingCounts[s] = Number((c as Row[])[0].n);
        } catch {
          siblingCounts[s] = -1;
        }
      }

      const protectedRows = Math.max(0, ...Object.values(siblingCounts));
      findings.push({
        table,
        column: col,
        raw_populated: rawPopulated,
        protected_siblings: siblings.length ? siblingCounts : null,
        // The three states worth acting on, in order of severity.
        verdict:
          siblings.length === 0
            ? "NO_PROTECTED_COLUMN_EXISTS"
            : protectedRows === 0
              ? "PROTECTION_BUILT_BUT_UNUSED"
              : protectedRows < rawPopulated
                ? "PARTIALLY_PROTECTED"
                : "PROTECTED_ALONGSIDE_RAW",
      });
    }
  }

  await conn.end();

  findings.sort((a, b) => Number(b.raw_populated) - Number(a.raw_populated));

  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex !== -1 && process.argv[outputIndex + 1]) {
    fs.writeFileSync(process.argv[outputIndex + 1], JSON.stringify(findings, null, 2), "utf8");
    console.log(`[encryption-coverage] ${findings.length} finding(s) written. Keep this file out of the repository.`);
  } else {
    for (const f of findings) {
      console.log(
        `${String(f.verdict).padEnd(28)} ${String(f.table)}.${String(f.column)}  raw_rows=${f.raw_populated}` +
          (f.protected_siblings ? `  protected=${JSON.stringify(f.protected_siblings)}` : "  (no protected column)"),
      );
    }
    console.log(`\n[encryption-coverage] ${findings.length} sensitive column(s) hold data. READ-ONLY: no value was read, nothing modified.`);
  }
}

main().catch((err) => {
  console.error("[encryption-coverage] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
