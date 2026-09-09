import { randomUUID } from "crypto";
import * as XLSX from "xlsx";
import type { ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Statement upload parsing (Bank Reconciliation, Phase 4). Banks export wildly different
 * column layouts, so instead of assuming one fixed shape, the caller tells us — once per
 * bank account, reused on every later upload — which uploaded column is which field. See
 * bank-reconciliation.routes.ts's upload endpoint for how that mapping is offered back to the
 * user pre-filled from their last import.
 */

export interface ColumnMapping {
  date: string;
  description: string;
  reference?: string;
  debit?: string;
  credit?: string;
  amount?: string; // single signed column: negative = debit, positive = credit
}

export interface ParsedStatementLine {
  txn_date: string;      // YYYY-MM-DD
  description: string;
  reference: string | null;
  debit_amount: number;
  credit_amount: number;
}

function columnIndex(headers: string[], name: string): number {
  const idx = headers.indexOf(name);
  if (idx === -1) throw new Error(`Column mapping refers to "${name}", which is not in the uploaded file's header row.`);
  return idx;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const str = String(value).trim();
  // DD/MM/YYYY (the common Indian bank export format)
  const dmy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  // YYYY-MM-DD already
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  return null;
}

export function parseStatementRows(headers: string[], rows: unknown[][], mapping: ColumnMapping): ParsedStatementLine[] {
  const dateIdx = columnIndex(headers, mapping.date);
  const descIdx = columnIndex(headers, mapping.description);
  const refIdx = mapping.reference ? columnIndex(headers, mapping.reference) : -1;
  const debitIdx = mapping.debit ? columnIndex(headers, mapping.debit) : -1;
  const creditIdx = mapping.credit ? columnIndex(headers, mapping.credit) : -1;
  const amountIdx = mapping.amount ? columnIndex(headers, mapping.amount) : -1;

  const result: ParsedStatementLine[] = [];
  for (const row of rows) {
    const txn_date = toIsoDate(row[dateIdx]);
    if (!txn_date) continue; // not a data row (blank line, footer, subtotal, etc.)

    let debit_amount = 0;
    let credit_amount = 0;
    if (amountIdx !== -1) {
      const signed = toNumber(row[amountIdx]);
      if (signed < 0) debit_amount = Math.abs(signed); else credit_amount = signed;
    } else {
      if (debitIdx !== -1) debit_amount = toNumber(row[debitIdx]);
      if (creditIdx !== -1) credit_amount = toNumber(row[creditIdx]);
    }
    if (debit_amount === 0 && credit_amount === 0) continue; // no actual movement — skip

    result.push({
      txn_date,
      description: String(row[descIdx] ?? "").trim(),
      reference: refIdx !== -1 && row[refIdx] ? String(row[refIdx]).trim() : null,
      debit_amount,
      credit_amount,
    });
  }
  return result;
}

export const bankStatementImportService = {
  /** Reads the first worksheet of an uploaded CSV/XLSX buffer into a plain header+rows shape. */
  parseWorkbook(buffer: Buffer): { headers: string[]; rows: unknown[][] } {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
    const [headerRow, ...dataRows] = matrix;
    return { headers: (headerRow ?? []).map((h) => String(h).trim()), rows: dataRows };
  },

  async saveImport(
    bankAccountId: string, periodId: string, filename: string,
    mapping: ColumnMapping, lines: ParsedStatementLine[], importedBy: string,
  ): Promise<{ importId: string; rowCount: number }> {
    const importId = randomUUID();
    await db.execute<ResultSetHeader>(
      `INSERT INTO bank_statement_import (id, bank_account_id, period_id, original_filename, column_mapping, imported_by, row_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [importId, bankAccountId, periodId, filename, JSON.stringify(mapping), importedBy, lines.length],
    );
    for (const line of lines) {
      await db.execute<ResultSetHeader>(
        `INSERT INTO bank_statement_line (id, import_id, txn_date, description, reference, debit_amount, credit_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), importId, line.txn_date, line.description, line.reference, line.debit_amount, line.credit_amount],
      );
    }
    return { importId, rowCount: lines.length };
  },
};
