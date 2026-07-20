/**
 * Privacy Inventory Scanner
 * Read-only. Queries information_schema to identify candidate PII columns.
 * Outputs a JSON review file. Never modifies any application data.
 *
 * Usage: npx ts-node src/scripts/privacy-inventory-scan.ts [--output findings.json]
 */
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";

const PII_PATTERNS = [
  { pattern: /aadhaar|aadhar/i, category: "statutory", sensitivity: "highly_sensitive" },
  { pattern: /pan_number|pan_no/i, category: "statutory", sensitivity: "highly_sensitive" },
  { pattern: /bank_account|account_no|account_number/i, category: "financial", sensitivity: "highly_sensitive" },
  { pattern: /uan|pf_number|esic_number/i, category: "statutory", sensitivity: "highly_sensitive" },
  { pattern: /passport/i, category: "identity", sensitivity: "highly_sensitive" },
  { pattern: /biometric/i, category: "biometric", sensitivity: "highly_sensitive" },
  { pattern: /salary|gross_salary|net_salary|ctc|tds/i, category: "payroll", sensitivity: "highly_sensitive" },
  { pattern: /personal_email/i, category: "contact", sensitivity: "pii" },
  { pattern: /mobile|phone/i, category: "contact", sensitivity: "pii" },
  { pattern: /date_of_birth|dob/i, category: "identity", sensitivity: "pii" },
  { pattern: /address/i, category: "contact", sensitivity: "pii" },
  { pattern: /nominee|emergency_contact/i, category: "family_nominee", sensitivity: "pii" },
  { pattern: /medical|health/i, category: "health", sensitivity: "sensitive" },
  { pattern: /ip_address/i, category: "device", sensitivity: "pii" },
  { pattern: /user_agent/i, category: "device", sensitivity: "internal" },
  { pattern: /otp|token|password|secret/i, category: "authentication", sensitivity: "highly_sensitive" },
];

interface ColumnFinding {
  table_name: string;
  column_name: string;
  data_type: string;
  category: string;
  sensitivity: string;
  review_status: "needs_review";
  notes: string;
}

async function scan(): Promise<void> {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST ?? "localhost",
    port: parseInt(process.env.DB_PORT ?? "3306"),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: "information_schema",
  });

  const dbName = process.env.DB_NAME ?? "mas_hrms";

  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, DATA_TYPE AS data_type
     FROM COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME NOT LIKE '%_log'
       AND TABLE_NAME NOT LIKE 'schema_migrations'
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [dbName]
  );

  await conn.end();

  const findings: ColumnFinding[] = [];
  for (const row of rows) {
    const colName = (row.column_name as string).toLowerCase();
    for (const rule of PII_PATTERNS) {
      if (rule.pattern.test(colName)) {
        findings.push({
          table_name: row.table_name,
          column_name: row.column_name,
          data_type: row.data_type,
          category: rule.category,
          sensitivity: rule.sensitivity,
          review_status: "needs_review",
          notes: `Matched pattern: ${rule.pattern.toString()}`,
        });
        break;
      }
    }
  }

  const outputArg = process.argv.find((a) => a.startsWith("--output=") || process.argv.indexOf("--output") !== -1 && process.argv[process.argv.indexOf("--output") + 1] === a);
  let outputPath = "privacy-inventory-findings.json";
  const outputIdx = process.argv.indexOf("--output");
  if (outputIdx !== -1 && process.argv[outputIdx + 1]) {
    outputPath = process.argv[outputIdx + 1];
  }

  const report = {
    scanned_at: new Date().toISOString(),
    database: dbName,
    total_findings: findings.length,
    tables_with_pii: [...new Set(findings.map((f) => f.table_name))].length,
    findings,
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`[privacy-scan] Found ${findings.length} candidate PII columns across ${report.tables_with_pii} tables`);
  console.log(`[privacy-scan] Report written to: ${path.resolve(outputPath)}`);
  console.log("[privacy-scan] This is a READ-ONLY scan. No data was modified.");
}

scan().catch((err) => {
  console.error("[privacy-scan] Error:", err.message);
  process.exit(1);
});
