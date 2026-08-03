import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql, { type RowDataPacket } from "mysql2/promise";

const host = process.env.DB_HOST ?? "127.0.0.1";
const port = Number(process.env.DB_PORT ?? 3306);
const user = process.env.DB_USER ?? "root";
const password = process.env.DB_PASSWORD ?? "";
const database = process.env.DB_NAME ?? "hrms_migration_test_038";

function assertDisposableTarget(): void {
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`Refusing destructive migration verification on non-loopback host: ${host}`);
  }
  if (!/^hrms_migration_test_[a-z0-9_]+$/i.test(database)) {
    throw new Error(
      `Refusing destructive migration verification: DB_NAME must start with hrms_migration_test_ (received ${database})`,
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid DB_PORT: ${String(process.env.DB_PORT ?? "")}`);
  }
}

async function scalar(
  connection: mysql.Connection,
  query: string,
  params: unknown[] = [],
): Promise<number> {
  const [rows] = await connection.execute<RowDataPacket[]>(query, params);
  return Number(Object.values(rows[0] ?? {})[0] ?? 0);
}

async function main(): Promise<void> {
  assertDisposableTarget();

  const admin = await mysql.createConnection({
    host,
    port,
    user,
    password,
    charset: "utf8mb4",
  });

  let connection: mysql.Connection | null = null;
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      database,
      charset: "utf8mb4",
      multipleStatements: true,
    });

    // Migration 038 depends only on the employees primary key from earlier core
    // migrations. Keep this verification isolated so failures are attributable
    // to migration 038 rather than hundreds of unrelated migrations.
    await connection.query(`
      CREATE TABLE employees (
        id VARCHAR(36) NOT NULL PRIMARY KEY
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const migrationPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../sql/038_engagement_gamification.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    // First run proves a clean database can execute the complete migration.
    await connection.query(sql);
    // Second run proves its compatibility and seed operations remain idempotent.
    await connection.query(sql);

    const expectedTables = [
      "gamification_badge_master",
      "employee_badge_earned",
      "gamification_point_log",
      "gamification_points_ledger",
      "gamification_tier_master",
      "employee_tier_status",
      "kudos_master",
      "kudos_transaction",
      "survey_master",
      "survey_question",
      "survey_response",
      "pulse_check",
    ];

    const tableCount = await scalar(
      connection,
      `SELECT COUNT(*) AS total
         FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME IN (${expectedTables.map(() => "?").join(",")})`,
      [database, ...expectedTables],
    );
    if (tableCount !== expectedTables.length) {
      throw new Error(`Expected ${expectedTables.length} engagement tables, found ${tableCount}`);
    }

    const canonicalQuestionColumns = await scalar(
      connection,
      `SELECT COUNT(*) AS total
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = 'survey_question'
          AND COLUMN_NAME IN ('question_id', 'question_order')`,
      [database],
    );
    if (canonicalQuestionColumns !== 2) {
      throw new Error("survey_question is missing canonical question_id/question_order columns");
    }

    const legacyQuestionColumns = await scalar(
      connection,
      `SELECT COUNT(*) AS total
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = 'survey_question'
          AND COLUMN_NAME IN ('id', 'display_order')`,
      [database],
    );
    if (legacyQuestionColumns !== 0) {
      throw new Error("survey_question still exposes legacy id/display_order columns");
    }

    const badgeCount = await scalar(connection, "SELECT COUNT(*) AS total FROM gamification_badge_master");
    const tierCount = await scalar(connection, "SELECT COUNT(*) AS total FROM gamification_tier_master");
    const surveyCount = await scalar(connection, "SELECT COUNT(*) AS total FROM survey_master");
    const questionCount = await scalar(connection, "SELECT COUNT(*) AS total FROM survey_question");

    if (badgeCount !== 15) throw new Error(`Expected 15 seeded badges, found ${badgeCount}`);
    if (tierCount !== 5) throw new Error(`Expected 5 seeded tiers, found ${tierCount}`);
    if (surveyCount !== 2) throw new Error(`Expected 2 seeded surveys, found ${surveyCount}`);
    if (questionCount !== 9) throw new Error(`Expected 9 seeded survey questions, found ${questionCount}`);

    console.log(
      JSON.stringify(
        {
          result: "PASS",
          database,
          tables: tableCount,
          badges: badgeCount,
          tiers: tierCount,
          surveys: surveyCount,
          questions: questionCount,
          idempotentRuns: 2,
        },
        null,
        2,
      ),
    );
  } finally {
    await connection?.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
