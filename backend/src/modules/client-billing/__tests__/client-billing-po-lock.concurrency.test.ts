/**
 * Gap 2 — approveInvoice's PO-sufficiency check has no row lock (real MySQL, not mocked).
 *
 * The `SELECT id, balance_amount FROM client_po_number WHERE po_number IN (...) AND
 * cost_centre_id = ?` inside approveInvoice's transaction originally had no `FOR UPDATE`.
 * Two concurrent approvals against the same PO can both read the same pre-consumption
 * balance, both pass the sufficiency check, and both proceed to decrement
 * `balance_amount` — driving it negative and creating two `client_po_particular` rows
 * that together over-consume the PO.
 *
 * Per this module's own testing discipline (docs/superpowers/specs/2026-08-19-client-
 * billing-approval-workflow-design.md §7 — "every task's implementer must verify its SQL
 * against a real MySQL 8 connection ... not only against the mocked db.execute test
 * suite"), this test runs against the live mas_hrms schema via the app's own connection
 * pool (db/mysql.ts, already configured from env.DB_*), calling the real (unmocked)
 * clientBillingApprovalService — not a reimplementation of the query. client_invoice /
 * client_po_number / cost_centre_master additions this test makes are all deleted in
 * afterAll; nothing is left behind. Confirmed
 * before writing this test: client_invoice and client_po_number both hold 0 production
 * rows as of 2026-08-19, and none of the 45 live branch_master rows has gst_state_code
 * set, so this test creates its own throwaway branch_master + cost_centre_master row
 * carrying a real state code, deleted alongside everything else in afterAll.
 *
 * PROOF OF THE FIX
 *   Run against the pre-fix code (git stash the FOR UPDATE addition, or check out the
 *   commit before it): "one wins, one loses the sufficiency check" fails — both
 *   approvals succeed and the PO balance goes negative. Run again after the fix: exactly
 *   one approval succeeds, the other is rejected for insufficient PO balance, and the
 *   final balance is exactly 0, never negative. See this session's report for the actual
 *   before/after console output.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { resolve } from "node:path";
import dotenv from "dotenv";
import type { RowDataPacket } from "mysql2/promise";

// The global mock in tests/setup.ts stubs `../../db/mysql.js` for every test file so the
// rest of the suite never touches a real database. This file is the deliberate, narrowly-
// scoped exception: real locking behaviour cannot be proven against a stub. Unmock it so the
// app's real db/mysql.ts pool is what gets imported below.
//
// vitest.config.ts loads .env.test (DB_HOST=127.0.0.1 — deliberately not the live schema,
// per that file's own header comment) into process.env for the whole run before any test
// file executes, and config/env.ts's own dotenv.config() call uses override:false, so it
// cannot un-set that once vitest has already set it. Re-load the real backend/.env here with
// override:true, for this one opt-in test only, instead of hardcoding a credential — the
// value comes from the same file the app's own bootstrap reads, never duplicated as a
// literal in source.
dotenv.config({ path: resolve(process.cwd(), ".env"), override: true });
vi.unmock("../../../db/mysql.js");

const RUN_LIVE = process.env.RUN_CLIENT_BILLING_MYSQL_TESTS === "1";

describe.skipIf(!RUN_LIVE)("approveInvoice PO-sufficiency race (real MySQL, real concurrent connections)", () => {
  // The app's own pool (db/mysql.ts) — already configured from env.DB_*, not duplicated here.
  // Calling approveInvoice() twice concurrently below checks out two separate physical
  // connections from this same pool, which is what makes the row-lock race real.
  let pool: typeof import("../../../db/mysql.js")["db"];
  let clientBillingApprovalService: typeof import("../client-billing-approval.service.js")["clientBillingApprovalService"];

  const branchId = randomUUID();
  const costCentreId = randomUUID();
  const poId = randomUUID();
  const poNumber = `TESTPO-${randomUUID().slice(0, 8)}`;
  const invoiceAId = randomUUID();
  const invoiceBId = randomUUID();
  const actorId = "00000000-0000-0000-0000-000000000001";
  const PO_BALANCE = 10000;

  beforeAll(async () => {
    ({ db: pool } = await import("../../../db/mysql.js"));
    await pool.query("SELECT 1");

    ({ clientBillingApprovalService } = await import("../client-billing-approval.service.js"));

    const [seqRows] = await pool.query<RowDataPacket[]>(
      "SELECT COALESCE(MAX(branch_seq), 0) + 5000 AS n FROM branch_master"
    );
    const branchSeq = Number((seqRows[0] as { n: number }).n);

    await pool.execute(
      `INSERT INTO branch_master (id, branch_code, branch_name, gst_state_code, branch_seq, active_status)
       VALUES (?, ?, ?, '09', ?, 1)`,
      [branchId, `TB${branchSeq}`, "PO Lock Test Branch (throwaway)", branchSeq]
    );
    await pool.execute(
      `INSERT INTO cost_centre_master (id, cost_centre_code, cost_centre_name, branch_id, company_name, active_status)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [costCentreId, `TCC${branchSeq}`, "PO Lock Test Cost Centre (throwaway)", branchId, "PO Lock Test Co"]
    );
    await pool.execute(
      `INSERT INTO client_po_number (id, cost_centre_id, po_number, period_from, period_to, total_amount, balance_amount)
       VALUES (?, ?, ?, '2026-04-01', '2027-03-31', ?, ?)`,
      [poId, costCentreId, poNumber, PO_BALANCE, PO_BALANCE]
    );
    for (const invId of [invoiceAId, invoiceBId]) {
      await pool.execute(
        `INSERT INTO client_invoice
           (id, cost_centre_id, invoice_status, category, finance_year, month_label, invoice_date,
            gst_type, apply_gst, total_amount, grand_total, created_by)
         VALUES (?, ?, 'proforma', 'Services', '2026-27', 'Apr-26', '2026-04-15', 'Integrated', 1, ?, ?, ?)`,
        [invId, costCentreId, PO_BALANCE, PO_BALANCE, actorId]
      );
    }
  }, 30000);

  afterAll(async () => {
    if (!pool) return;
    await pool.execute(`DELETE FROM client_po_particular WHERE po_id = ?`, [poId]).catch(() => {});
    await pool.execute(`DELETE FROM client_invoice_audit_log WHERE invoice_id IN (?, ?)`, [invoiceAId, invoiceBId]).catch(() => {});
    await pool.execute(`DELETE FROM client_invoice WHERE id IN (?, ?)`, [invoiceAId, invoiceBId]).catch(() => {});
    await pool.execute(`DELETE FROM client_po_number WHERE id = ?`, [poId]).catch(() => {});
    await pool.execute(`DELETE FROM cost_centre_master WHERE id = ?`, [costCentreId]).catch(() => {});
    await pool.execute(`DELETE FROM branch_master WHERE id = ?`, [branchId]).catch(() => {});
    // A successful approval mints a real row in the shared client_invoice_number_sequence
    // counter table (kind='bill', scoped to this test's own throwaway company name) —
    // delete it too so re-running this test never leaves a stray scope behind.
    await pool
      .execute(`DELETE FROM client_invoice_number_sequence WHERE kind = 'bill' AND scope_key = ?`, [
        `09|PO Lock Test Co|2026-27`,
      ])
      .catch(() => {});
    await pool.end().catch(() => {});
  }, 30000);

  it(
    "racing two approvals against a PO whose balance equals exactly one invoice's total: " +
      "exactly one succeeds, the other fails the sufficiency check, balance never goes negative",
    async () => {
      const [resultA, resultB] = await Promise.allSettled([
        clientBillingApprovalService.approveInvoice({ invoiceId: invoiceAId, poNumbers: [poNumber], userId: actorId }),
        clientBillingApprovalService.approveInvoice({ invoiceId: invoiceBId, poNumbers: [poNumber], userId: actorId }),
      ]);

      const outcomes = [resultA, resultB];
      const fulfilled = outcomes.filter((r) => r.status === "fulfilled");
      const rejected = outcomes.filter((r) => r.status === "rejected");

      // The actual bug: without FOR UPDATE, both of these come back fulfilled.
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        statusCode: 400,
        message: expect.stringMatching(/PO balance/),
      });

      const [poRows] = await pool.query<RowDataPacket[]>(
        `SELECT balance_amount FROM client_po_number WHERE id = ?`,
        [poId]
      );
      const finalBalance = Number((poRows[0] as { balance_amount: number }).balance_amount);
      // The actual bug: without FOR UPDATE this goes to -10000 (both consumed the full amount).
      expect(finalBalance).toBe(0);

      const [particularRows] = await pool.query<RowDataPacket[]>(
        `SELECT invoice_id FROM client_po_particular WHERE po_id = ?`,
        [poId]
      );
      // The actual bug: without FOR UPDATE this is 2 (one particular row per approval).
      expect(particularRows).toHaveLength(1);

      const [invoiceRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, invoice_status FROM client_invoice WHERE id IN (?, ?)`,
        [invoiceAId, invoiceBId]
      );
      const approvedCount = (invoiceRows as Array<{ invoice_status: string }>).filter(
        (r) => r.invoice_status === "approved"
      ).length;
      expect(approvedCount).toBe(1);
    },
    30000
  );
});
