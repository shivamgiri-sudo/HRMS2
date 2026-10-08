import type { RowDataPacket } from "mysql2";
import { queryRows, tableExists } from "../../shared/dbHelpers.js";

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const vendorPaymentLobAttributionService = {
  async get(paymentId: string) {
    if (!(await tableExists("vendor_payment_tracking"))) {
      throw Object.assign(new Error("Vendor payment tracking is unavailable"), { statusCode: 503 });
    }
    const payments = await queryRows<RowDataPacket>(
      `SELECT id, grn_request_id, grn_number, vendor_id, vendor_name, branch_id,
              process_id, cost_centre_id, due_amount, paid_amount, balance_amount,
              payment_status, due_date, payment_date, recognition_period,
              amount_without_tax, tax_amount, amount_with_tax, updated_at
         FROM vendor_payment_tracking
        WHERE id = ?
        LIMIT 1`,
      [paymentId]
    );
    const payment = payments[0];
    if (!payment) throw Object.assign(new Error("Vendor payment record not found"), { statusCode: 404 });

    if (!(await tableExists("process_lob_master"))) {
      return {
        payment,
        allocations: [],
        reconciliation: {
          allocationAvailable: false,
          reason: "Migration 421 is not applied",
          allocatedPnlCost: 0,
          allocatedGrossAmount: 0,
          dueAmount: n(payment.due_amount),
          paidAmount: n(payment.paid_amount),
          balanceAmount: n(payment.balance_amount),
          grossVariance: n(payment.due_amount),
          reconciled: false,
        },
      };
    }

    const viewRows = await queryRows<RowDataPacket>(
      `SELECT vendor_payment_id, grn_allocation_id, sequence_no, process_id,
              process_lob_id, cost_centre_id, process_name, lob_code, lob_name,
              cost_centre_name, pnl_bucket, recognition_period, pnl_cost_amount,
              gross_amount, payment_due_amount, payment_paid_amount,
              payment_balance_amount, payment_status, due_date, payment_date, freshness
         FROM vw_vendor_payment_lob_allocation
        WHERE vendor_payment_id = ?
        ORDER BY sequence_no, process_name, lob_code`,
      [paymentId]
    ).catch((error) => {
      throw Object.assign(
        new Error(`Vendor payment LOB allocation view is unavailable: ${error instanceof Error ? error.message : String(error)}`),
        { statusCode: 503 }
      );
    });

    const allocatedPnlCost = viewRows.reduce((total, row) => total + n(row.pnl_cost_amount), 0);
    const allocatedGrossAmount = viewRows.reduce((total, row) => total + n(row.gross_amount), 0);
    const dueAmount = n(payment.due_amount);
    const grossVariance = dueAmount - allocatedGrossAmount;
    const missingLobCount = viewRows.filter((row) => row.process_id && !row.process_lob_id).length;
    const recognitionPeriods = [...new Set(viewRows.map((row) => String(row.recognition_period ?? "")).filter(Boolean))];

    return {
      payment,
      allocations: viewRows,
      reconciliation: {
        allocationAvailable: true,
        allocationCount: viewRows.length,
        missingLobCount,
        recognitionPeriods,
        allocatedPnlCost,
        allocatedGrossAmount,
        dueAmount,
        paidAmount: n(payment.paid_amount),
        balanceAmount: n(payment.balance_amount),
        grossVariance,
        reconciled: viewRows.length > 0 && missingLobCount === 0 && Math.abs(grossVariance) <= 0.02,
      },
    };
  },
};
