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

/**
 * Amount cell -> number. Bank exports write "1,23,456.00", "₹ 500", "500.00 Cr", "250.00 Dr" or
 * "(250.00)"; a cell that cannot be read used to become 0 and the row was silently skipped.
 * Dr / brackets / a leading minus give a negative number (only meaningful in a signed amount column).
 */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  let str = String(value).trim();
  if (!str || str === "-") return 0;
  const negative = /\bdr\.?$/i.test(str) || /^\(.*\)$/.test(str) || str.startsWith("-");
  str = str.replace(/\b(cr|dr)\.?$/i, "").replace(/[₹,\s()]|rs\.?|inr/gi, "").replace(/^-/, "");
  const n = Number(str);
  if (!Number.isFinite(n)) return 0;
  return Math.round((negative ? -n : n) * 100) / 100;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};
const pad = (n: string | number) => String(n).padStart(2, "0");
const year4 = (y: string) => (y.length === 2 ? `20${y}` : y);

/**
 * Statement date cell -> YYYY-MM-DD. Indian bank exports are day-first: 03/10/2026, 03-10-26,
 * 03-Oct-2026, 03 Oct 26, 2026-10-03, a real Excel date cell (Date object) or an Excel serial number.
 */
export function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // SheetJS builds date cells at (or 1 ms before) local midnight; shifting by half a day before
    // reading local parts lands inside the right day either way.
    const d = new Date(value.getTime() + 12 * 3_600_000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const str = String(value).trim();
  const dmy = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s|$)/);
  if (dmy) return `${year4(dmy[3])}-${pad(dmy[2])}-${pad(dmy[1])}`;
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;
  const dMonY = str.match(/^(\d{1,2})[\s/.-]*([a-z]{3,4})[a-z]*[\s/.,-]*(\d{2}|\d{4})(?:\s|$)/i);
  if (dMonY && MONTHS[dMonY[2].toLowerCase()]) return `${year4(dMonY[3])}-${MONTHS[dMonY[2].toLowerCase()]}-${pad(dMonY[1])}`;
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
      // Separate columns: the column says the direction, so a "Dr"/"Cr" suffix or brackets only decorate it.
      if (debitIdx !== -1) debit_amount = Math.abs(toNumber(row[debitIdx]));
      if (creditIdx !== -1) credit_amount = Math.abs(toNumber(row[creditIdx]));
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
    // raw: CSV text stays exactly as typed (no US month-first date guessing); cellDates: real Excel
    // date cells arrive as Date objects. sheet_to_json raw keeps numbers as numbers. Formatted text
    // turned 03/10/2026 into "3/10/26" and every row was dropped by the date check.
    const workbook = XLSX.read(buffer, { type: "buffer", raw: true, cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
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
    if (lines.length > 0) {
      const placeholders = lines.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
      const values: unknown[] = [];
      for (const line of lines) {
        values.push(randomUUID(), importId, line.txn_date, line.description, line.reference, line.debit_amount, line.credit_amount);
      }
      await db.execute<ResultSetHeader>(
        `INSERT INTO bank_statement_line (id, import_id, txn_date, description, reference, debit_amount, credit_amount) VALUES ${placeholders}`,
        values,
      );
    }
    return { importId, rowCount: lines.length };
  },
};
