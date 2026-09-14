import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { splitSql } from "../../../db/runPendingMigrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const sqlDir = path.join(backendRoot, "sql");
const host = process.env.TEST_DB_HOST;
const port = Number(process.env.TEST_DB_PORT ?? 3306);
const user = process.env.TEST_DB_USER ?? "root";
const password = process.env.TEST_DB_PASSWORD ?? "root";
const dbName = `hrms_lob_it_${process.pid}_${Date.now()}`;

const describeMysql = host ? describe : describe.skip;
let admin: Connection;
let db: Connection;

async function runSqlFile(connection: Connection, filename: string) {
  const raw = fs.readFileSync(path.join(sqlDir, filename), "utf8");
  const statements = splitSql(raw).filter((statement) => {
    const normalized = statement.trim().toUpperCase();
    return normalized && !normalized.startsWith("USE ") && !normalized.startsWith("SOURCE ");
  });
  for (const statement of statements) {
    await connection.query(statement);
  }
}

async function createFixture(connection: Connection) {
  await connection.query(`
    CREATE TABLE process_master (
      id CHAR(36) PRIMARY KEY,
      process_name VARCHAR(160) NOT NULL,
      client_id CHAR(36) NULL,
      branch_id CHAR(36) NULL,
      active_status TINYINT NOT NULL DEFAULT 1
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE cost_centre_master (
      id CHAR(36) PRIMARY KEY,
      cc_code VARCHAR(50) NOT NULL,
      cc_name VARCHAR(160) NOT NULL,
      process_id CHAR(36) NULL,
      active_status TINYINT NOT NULL DEFAULT 1,
      updated_at DATETIME NULL
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE process_revenue_rule (
      id CHAR(36) PRIMARY KEY,
      process_id CHAR(36) NOT NULL,
      contract_id CHAR(36) NULL,
      rule_name VARCHAR(255) NOT NULL,
      billing_model VARCHAR(50) NOT NULL,
      metric_key VARCHAR(100) NOT NULL,
      rate_amount DECIMAL(18,6) NOT NULL DEFAULT 0,
      currency_code CHAR(3) NOT NULL DEFAULT 'INR',
      fx_to_inr DECIMAL(18,6) NOT NULL DEFAULT 1,
      monthly_minimum_commitment DECIMAL(18,2) NOT NULL DEFAULT 0,
      included_units DECIMAL(18,4) NOT NULL DEFAULT 0,
      overage_rate DECIMAL(18,6) NOT NULL DEFAULT 0,
      mandated_seats DECIMAL(12,2) NULL,
      quality_gate_pct DECIMAL(7,4) NULL,
      sla_gate_pct DECIMAL(7,4) NULL,
      effective_from DATE NOT NULL,
      effective_to DATE NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      approved_by CHAR(36) NULL,
      approved_at DATETIME NULL,
      approval_reference VARCHAR(255) NULL,
      created_by CHAR(36) NULL,
      updated_by CHAR(36) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_rule_effective (process_id, effective_from, effective_to, status)
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE process_delivery_actual (
      id CHAR(36) PRIMARY KEY,
      process_id CHAR(36) NOT NULL,
      period_code CHAR(7) NOT NULL,
      activity_date DATE NULL,
      metric_key VARCHAR(100) NOT NULL,
      planned_units DECIMAL(20,4) NOT NULL DEFAULT 0,
      delivered_units DECIMAL(20,4) NOT NULL DEFAULT 0,
      accepted_units DECIMAL(20,4) NOT NULL DEFAULT 0,
      rejected_units DECIMAL(20,4) NOT NULL DEFAULT 0,
      billable_units DECIMAL(20,4) NOT NULL DEFAULT 0,
      productive_hours DECIMAL(20,4) NOT NULL DEFAULT 0,
      login_hours DECIMAL(20,4) NOT NULL DEFAULT 0,
      talk_minutes DECIMAL(20,4) NOT NULL DEFAULT 0,
      quality_score DECIMAL(7,4) NULL,
      sla_score DECIMAL(7,4) NULL,
      data_source VARCHAR(100) NOT NULL DEFAULT 'manual',
      source_reference VARCHAR(255) NOT NULL DEFAULT 'manual',
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      validated_by CHAR(36) NULL,
      validated_at DATETIME NULL,
      created_by CHAR(36) NULL,
      updated_by CHAR(36) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_process_delivery_source (process_id, period_code, metric_key, data_source, source_reference)
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE process_revenue_component (
      id CHAR(36) PRIMARY KEY,
      process_id CHAR(36) NOT NULL,
      period_code CHAR(7) NOT NULL,
      component_type VARCHAR(60) NOT NULL,
      direction VARCHAR(20) NOT NULL,
      description VARCHAR(500) NOT NULL,
      units DECIMAL(20,4) NULL,
      rate DECIMAL(18,6) NULL,
      amount_inr DECIMAL(18,2) NOT NULL,
      recognition_date DATE NULL,
      invoice_reference VARCHAR(255) NULL,
      source_reference VARCHAR(255) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      approved_by CHAR(36) NULL,
      approved_at DATETIME NULL,
      created_by CHAR(36) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE process_pnl_cost_component (
      id CHAR(36) PRIMARY KEY,
      process_id CHAR(36) NULL,
      branch_id CHAR(36) NULL,
      period_code CHAR(7) NOT NULL,
      cost_type VARCHAR(60) NOT NULL,
      description VARCHAR(500) NOT NULL,
      amount_inr DECIMAL(18,2) NOT NULL,
      allocation_driver VARCHAR(60) NOT NULL DEFAULT 'direct',
      manual_allocation_pct DECIMAL(7,4) NULL,
      source_reference VARCHAR(255) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      approved_by CHAR(36) NULL,
      approved_at DATETIME NULL,
      reversed_by CHAR(36) NULL,
      reversed_at DATETIME NULL,
      created_by CHAR(36) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE pnl_adjustment_journal (
      id CHAR(36) PRIMARY KEY,
      process_id CHAR(36) NOT NULL,
      period_code CHAR(7) NOT NULL,
      metric_key VARCHAR(100) NOT NULL,
      previous_value DECIMAL(18,2) NOT NULL DEFAULT 0,
      adjustment_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      revised_value DECIMAL(18,2) NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      maker_user_id CHAR(36) NULL,
      checker_user_id CHAR(36) NULL,
      approval_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE finance_budget_line (
      id CHAR(36) PRIMARY KEY,
      budget_id CHAR(36) NOT NULL,
      process_id CHAR(36) NULL,
      cost_centre_id CHAR(36) NULL,
      head VARCHAR(160) NOT NULL,
      sub_head VARCHAR(160) NULL,
      item_name VARCHAR(255) NOT NULL,
      pnl_cost_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      reserved_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      consumed_amount DECIMAL(18,2) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE grn_request (
      id CHAR(36) PRIMARY KEY,
      branch_id CHAR(36) NULL,
      service_period_end DATE NULL,
      bill_date DATE NULL,
      reviewed_at DATETIME NULL,
      status VARCHAR(60) NOT NULL DEFAULT 'draft',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE grn_cost_allocation (
      id CHAR(36) PRIMARY KEY,
      grn_request_id CHAR(36) NOT NULL,
      budget_line_id CHAR(36) NOT NULL,
      sequence_no INT NOT NULL,
      process_id CHAR(36) NULL,
      cost_centre_id CHAR(36) NULL,
      branch_id CHAR(36) NULL,
      cost_class VARCHAR(20) NOT NULL DEFAULT 'direct',
      pnl_bucket VARCHAR(60) NULL,
      recognition_period CHAR(7) NULL,
      pnl_cost_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      amount_with_tax DECIMAL(18,2) NOT NULL DEFAULT 0,
      lifecycle_status VARCHAR(30) NOT NULL DEFAULT 'draft',
      consumed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE vendor_payment_tracking (
      id CHAR(36) PRIMARY KEY,
      grn_request_id CHAR(36) NOT NULL,
      grn_number VARCHAR(80) NULL,
      vendor_id CHAR(36) NULL,
      vendor_name VARCHAR(160) NULL,
      branch_id CHAR(36) NULL,
      process_id CHAR(36) NULL,
      cost_centre_id CHAR(36) NULL,
      recognition_period CHAR(7) NULL,
      due_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      paid_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      balance_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      payment_status VARCHAR(40) NOT NULL DEFAULT 'Payment Pending',
      due_date DATE NULL,
      payment_date DATE NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE finance_expense_head_master (
      id CHAR(36) PRIMARY KEY,
      head_code VARCHAR(80) NOT NULL,
      head_name VARCHAR(160) NOT NULL,
      active_status TINYINT NOT NULL DEFAULT 1
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE finance_expense_sub_head_master (
      id CHAR(36) PRIMARY KEY,
      head_id CHAR(36) NOT NULL,
      sub_head_code VARCHAR(80) NOT NULL,
      sub_head_name VARCHAR(160) NOT NULL,
      pnl_bucket VARCHAR(60) NOT NULL DEFAULT 'bmc_non_people',
      active_status TINYINT NOT NULL DEFAULT 1
    ) ENGINE=InnoDB
  `);

  await connection.query(
    `INSERT INTO process_master (id, process_name) VALUES ('process-1', 'Example Process')`
  );
  await connection.query(
    `INSERT INTO cost_centre_master (id, cc_code, cc_name, process_id)
     VALUES ('cc-1', 'CC-001', 'Example Cost Centre', 'process-1')`
  );
  await connection.query(
    `INSERT INTO process_revenue_rule
       (id, process_id, rule_name, billing_model, metric_key, rate_amount, effective_from, status)
     VALUES ('rule-1', 'process-1', 'Legacy rate', 'per_seat', 'billable_seats', 1000, '2026-01-01', 'approved')`
  );
  await connection.query(
    `INSERT INTO process_delivery_actual
       (id, process_id, period_code, metric_key, planned_units, delivered_units,
        accepted_units, billable_units, data_source, source_reference, status)
     VALUES ('delivery-1', 'process-1', '2026-07', 'billable_seats', 10, 9, 9, 9, 'manual', 'legacy', 'validated')`
  );
  await connection.query(
    `INSERT INTO process_revenue_component
       (id, process_id, period_code, component_type, direction, description, amount_inr, status)
     VALUES ('component-1', 'process-1', '2026-07', 'incentive', 'increase', 'Legacy incentive', 500, 'approved')`
  );
  await connection.query(
    `INSERT INTO process_pnl_cost_component
       (id, process_id, period_code, cost_type, description, amount_inr, status)
     VALUES ('cost-1', 'process-1', '2026-07', 'depreciation', 'Legacy depreciation', 100, 'approved')`
  );
  await connection.query(
    `INSERT INTO pnl_adjustment_journal
       (id, process_id, period_code, metric_key, previous_value, adjustment_amount, revised_value, reason)
     VALUES ('adjustment-1', 'process-1', '2026-07', 'recognized_revenue', 9000, 500, 9500, 'Legacy adjustment')`
  );
  await connection.query(
    `INSERT INTO finance_budget_line
       (id, budget_id, process_id, cost_centre_id, head, sub_head, item_name, pnl_cost_amount)
     VALUES ('budget-line-1', 'budget-1', 'process-1', 'cc-1', 'Technology', 'Software', 'Licence', 1000)`
  );
  await connection.query(
    `INSERT INTO grn_request
       (id, branch_id, service_period_end, bill_date, reviewed_at, status)
     VALUES ('grn-1', 'branch-1', '2026-07-31', '2026-08-05', NOW(), 'pending_accounts_payment')`
  );
  await connection.query(
    `INSERT INTO grn_cost_allocation
       (id, grn_request_id, budget_line_id, sequence_no, process_id, cost_centre_id,
        branch_id, cost_class, pnl_bucket, recognition_period, pnl_cost_amount,
        amount_with_tax, lifecycle_status, consumed_at)
     VALUES ('allocation-1', 'grn-1', 'budget-line-1', 1, 'process-1', 'cc-1',
             'branch-1', 'direct', 'dsc_non_people', '2026-07', 1000, 1180, 'consumed', NOW())`
  );
  await connection.query(
    `INSERT INTO vendor_payment_tracking
       (id, grn_request_id, grn_number, vendor_id, vendor_name, branch_id,
        process_id, cost_centre_id, recognition_period, due_amount, paid_amount,
        balance_amount, payment_status, due_date)
     VALUES ('payment-1', 'grn-1', 'GRN-1', 'vendor-1', 'Example Vendor', 'branch-1',
             'process-1', 'cc-1', '2026-07', 1180, 0, 1180, 'Payment Pending', '2026-09-04')`
  );
}

describeMysql("Process LOB MySQL migration integration", () => {
  beforeAll(async () => {
    admin = await mysql.createConnection({ host, port, user, password });
    await admin.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    db = await mysql.createConnection({ host, port, user, password, database: dbName });
    await createFixture(db);
  }, 30_000);

  afterAll(async () => {
    if (db) await db.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      await admin.end();
    }
  }, 30_000);

  it("applies migrations 421, 422 and 423 against the legacy-compatible fixture", async () => {
    await runSqlFile(db, "421_process_lob_pnl_foundation.sql");
    await runSqlFile(db, "422_vendor_payment_lob_bridge.sql");
    await runSqlFile(db, "423_cost_centre_lob_compatibility.sql");

    const [tables] = await db.query<RowDataPacket[]>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = ?
          AND table_name IN (
            'process_lob_master','process_lob_monthly_plan','employee_lob_assignment',
            'vendor_payment_allocation','pnl_period_snapshot','pnl_period_snapshot_row'
          )`,
      [dbName]
    );
    expect(tables).toHaveLength(6);
  }, 30_000);

  it("backfills the visible DEFAULT LOB into existing financial records", async () => {
    const [lobs] = await db.query<RowDataPacket[]>(
      `SELECT id, lob_code, approval_status FROM process_lob_master WHERE process_id = 'process-1'`
    );
    expect(lobs).toHaveLength(1);
    expect(lobs[0].lob_code).toBe("DEFAULT");
    expect(lobs[0].approval_status).toBe("approved");
    const lobId = String(lobs[0].id);

    for (const [table, id] of [
      ["process_revenue_rule", "rule-1"],
      ["process_delivery_actual", "delivery-1"],
      ["process_revenue_component", "component-1"],
      ["process_pnl_cost_component", "cost-1"],
      ["pnl_adjustment_journal", "adjustment-1"],
      ["finance_budget_line", "budget-line-1"],
      ["grn_cost_allocation", "allocation-1"],
    ] as const) {
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT process_lob_id FROM ${table} WHERE id = ?`,
        [id]
      );
      expect(String(rows[0].process_lob_id)).toBe(lobId);
    }
  });

  it("exposes the same allocation through GRN and vendor-payment LOB views", async () => {
    const [grnRows] = await db.query<RowDataPacket[]>(
      `SELECT process_id, process_lob_id, period_code, pnl_bucket, pnl_cost_amount, gross_amount
         FROM vw_process_lob_grn_allocation
        WHERE process_id = 'process-1'`
    );
    expect(grnRows).toHaveLength(1);
    expect(Number(grnRows[0].pnl_cost_amount)).toBe(1000);
    expect(Number(grnRows[0].gross_amount)).toBe(1180);
    expect(grnRows[0].period_code).toBe("2026-07");

    const [paymentRows] = await db.query<RowDataPacket[]>(
      `SELECT process_id, process_lob_id, recognition_period, pnl_cost_amount,
              gross_amount, payment_due_amount, payment_status
         FROM vw_vendor_payment_lob_allocation
        WHERE vendor_payment_id = 'payment-1'`
    );
    expect(paymentRows).toHaveLength(1);
    expect(String(paymentRows[0].process_lob_id)).toBe(String(grnRows[0].process_lob_id));
    expect(Number(paymentRows[0].pnl_cost_amount)).toBe(1000);
    expect(Number(paymentRows[0].gross_amount)).toBe(1180);
    expect(Number(paymentRows[0].payment_due_amount)).toBe(1180);
    expect(paymentRows[0].payment_status).toBe("Payment Pending");
  });

  it("backfills canonical cost-centre aliases from cc_code and cc_name", async () => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT cc_code, cc_name, cost_centre_code, cost_centre_name
         FROM cost_centre_master WHERE id = 'cc-1'`
    );
    expect(rows[0].cost_centre_code).toBe("CC-001");
    expect(rows[0].cost_centre_name).toBe("Example Cost Centre");
  });

  it("is idempotent on a second complete run", async () => {
    await runSqlFile(db, "421_process_lob_pnl_foundation.sql");
    await runSqlFile(db, "422_vendor_payment_lob_bridge.sql");
    await runSqlFile(db, "423_cost_centre_lob_compatibility.sql");

    const [lobs] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) count FROM process_lob_master WHERE process_id = 'process-1' AND lob_code = 'DEFAULT'`
    );
    const [bridges] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) count FROM vendor_payment_allocation
        WHERE vendor_payment_id = 'payment-1' AND grn_allocation_id = 'allocation-1'`
    );
    expect(Number(lobs[0].count)).toBe(1);
    expect(Number(bridges[0].count)).toBe(1);
  }, 30_000);
});
