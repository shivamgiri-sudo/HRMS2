import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { clientBillingNumberingService } from "./client-billing-numbering.service.js";

export interface ProformaLineInput {
  particulars: string;
  qty: number;
  rate: number;
  lineType?: "charge" | "deduction";
}

export interface CreateProformaInput {
  costCentreId: string;
  category: string;
  financeYear: string;
  monthLabel: string;
  invoiceDate: string; // YYYY-MM-DD
  description?: string;
  applyGst?: boolean;
  lines: ProformaLineInput[];
  createdBy: string;
}

export interface ProformaResult {
  id: string;
  proformaNo: string;
  totalAmount: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  grandTotal: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Matches legacy's tax_call block: 18% for an Integrated (inter-state) cost centre, or
 * 9%+9% CGST/SGST split for an Intrastate one. Skipped entirely when applyGst is false.
 */
function computeGst(baseAmount: number, gstType: string, applyGst: boolean) {
  if (!applyGst) return { igst: 0, cgst: 0, sgst: 0 };
  if (gstType === "Integrated") {
    return { igst: round2(baseAmount * 0.18), cgst: 0, sgst: 0 };
  }
  const half = round2(baseAmount * 0.09);
  return { igst: 0, cgst: half, sgst: half };
}

async function createProforma(input: CreateProformaInput): Promise<ProformaResult> {
  if (input.lines.length === 0) {
    throw Object.assign(new Error("At least one line item is required"), { statusCode: 400 });
  }

  const conn = await db.getConnection();
  const invoiceId = randomUUID();

  try {
    await conn.beginTransaction();

    const [costCentreRows] = await conn.execute<RowDataPacket[]>(
      `SELECT cc.gst_type AS gstType, b.gst_state_code AS stateCode
       FROM cost_centre_master cc
       LEFT JOIN branch_master b ON b.id = cc.branch_id
       WHERE cc.id = ?`,
      [input.costCentreId]
    );
    const costCentre = costCentreRows[0] as { gstType: string; stateCode: string | null } | undefined;
    if (!costCentre) {
      throw Object.assign(new Error(`cost_centre_master ${input.costCentreId} not found`), { statusCode: 400 });
    }
    if (!costCentre.stateCode) {
      throw Object.assign(new Error(`cost centre ${input.costCentreId} has no branch GST state code — cannot mint a proforma number`), { statusCode: 400 });
    }
    if (costCentre.gstType !== "Integrated" && costCentre.gstType !== "Intrastate") {
      throw Object.assign(new Error(`cost centre ${input.costCentreId} has an unrecognized GST type '${costCentre.gstType}' — expected 'Integrated' or 'Intrastate'`), { statusCode: 400 });
    }

    const applyGst = input.applyGst ?? true;
    const totalAmount = round2(
      input.lines.reduce((sum, line) => {
        const amount = round2(line.qty * line.rate);
        return line.lineType === "deduction" ? sum - amount : sum + amount;
      }, 0)
    );
    const { igst, cgst, sgst } = computeGst(totalAmount, costCentre.gstType, applyGst);
    const grandTotal = round2(totalAmount + igst + cgst + sgst);

    const proformaNo = await clientBillingNumberingService.mintProformaNumber(costCentre.stateCode);

    await conn.execute<ResultSetHeader>(
      `INSERT INTO client_invoice
         (id, cost_centre_id, invoice_status, category, finance_year, month_label, invoice_date,
          description, proforma_no, gst_type, apply_gst, total_amount, igst_amount, cgst_amount,
          sgst_amount, grand_total, created_by)
       VALUES (?, ?, 'proforma', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceId, input.costCentreId, input.category, input.financeYear, input.monthLabel,
        input.invoiceDate, input.description ?? null, proformaNo, costCentre.gstType,
        applyGst ? 1 : 0, totalAmount, igst, cgst, sgst, grandTotal, input.createdBy,
      ]
    );

    for (const line of input.lines) {
      await conn.execute<ResultSetHeader>(
        `INSERT INTO client_invoice_line (id, invoice_id, line_type, particulars, qty, rate, amount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), invoiceId, line.lineType ?? "charge", line.particulars, line.qty, line.rate, round2(line.qty * line.rate)]
      );
    }

    await conn.commit();
    return { id: invoiceId, proformaNo, totalAmount, igstAmount: igst, cgstAmount: cgst, sgstAmount: sgst, grandTotal };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export const clientBillingService = { createProforma };
