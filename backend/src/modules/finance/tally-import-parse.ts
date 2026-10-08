/**
 * Reads what Tally exports, without needing Tally on this machine.
 *
 *  - XML: Tally's voucher / Day Book export (ENVELOPE > BODY > ... > TALLYMESSAGE > VOUCHER), the same
 *    shape the Tally import XML uses. Each voucher's ledger lines carry ISDEEMEDPOSITIVE (Yes = debit)
 *    and a signed AMOUNT, and a payment against an invoice carries BILLALLOCATIONS.LIST (the bill name,
 *    i.e. the invoice number the payment was made against).
 *  - Sheets (Excel / CSV): the Day Book or a vendor's "Ledger Vouchers" report, with Date, Particulars,
 *    Vch Type, Vch No., Debit and Credit columns. A "Ledger: <vendor>" title row names the party for a
 *    ledger report, whose Particulars column is the counter-ledger (the bank), not the vendor.
 *
 * Pure functions: no I/O, so every format quirk is covered by a unit test.
 */

export type TallyLedgerLine = { name: string; debit: number; credit: number };
export type TallyBillRef = { name: string; amount: number };
export type TallyVoucher = {
  /** Stable identity for "have we taken this voucher already": Tally's GUID, else date|type|number|amount. */
  key: string;
  guid: string | null;
  date: string | null; // YYYY-MM-DD
  type: string; // Payment, Purchase, Journal, ...
  number: string;
  narration: string;
  party: string;
  ledgers: TallyLedgerLine[];
  billRefs: TallyBillRef[];
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

/** Tally dates: 20260921, 21-09-2026, 21/09/2026, 2026-09-21, 21-Sep-2026, 21-Sep-26, an Excel serial or Date. */
export function parseTallyDate(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return `${raw.getUTCFullYear()}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}`;
  if (typeof raw === "number" && raw > 20000 && raw < 80000) {
    const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(raw ?? "").trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`; }
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]*(\d{2,4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(Number(m[1]))}`; }
  return null;
}

/** "1,23,456.50", "(500)", "5,000 Dr", "-12.5" -> number. Empty / unreadable -> 0. */
export function parseTallyAmount(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  let s = String(raw ?? "").trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[(),\s₹]|Rs\.?|Dr|Cr/gi, "").replace(/^-/, "");
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&");

const tag = (block: string, name: string): string | null => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? unescapeXml(m[1].trim()) : null;
};
const blocks = (block: string, name: string): string[] =>
  [...block.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`, "gi"))].map((m) => m[0]);

export function voucherKey(v: { guid: string | null; date: string | null; type: string; number: string; ledgers: TallyLedgerLine[] }) {
  if (v.guid) return `guid:${v.guid}`;
  const amount = v.ledgers.reduce((s, l) => s + l.debit, 0);
  return `${v.date ?? "-"}|${v.type.toUpperCase()}|${v.number}|${amount.toFixed(2)}`;
}

export function parseTallyXml(xml: string): TallyVoucher[] {
  const out: TallyVoucher[] = [];
  for (const block of blocks(xml, "VOUCHER")) {
    const attrType = block.match(/<VOUCHER\b[^>]*\bVCHTYPE="([^"]*)"/i)?.[1];
    const attrGuid = block.match(/<VOUCHER\b[^>]*\bREMOTEID="([^"]*)"/i)?.[1];
    const type = tag(block, "VOUCHERTYPENAME") ?? (attrType ? unescapeXml(attrType) : "");
    const ledgers: TallyLedgerLine[] = [];
    const billRefs: TallyBillRef[] = [];
    for (const entry of [...blocks(block, "ALLLEDGERENTRIES.LIST"), ...blocks(block, "LEDGERENTRIES.LIST")]) {
      const name = tag(entry, "LEDGERNAME");
      if (!name) continue;
      const signed = parseTallyAmount(tag(entry, "AMOUNT"));
      const deemed = (tag(entry, "ISDEEMEDPOSITIVE") ?? "").toLowerCase();
      // Yes = debit (amount negative in Tally's own export); No = credit. Fall back to the sign.
      const isDebit = deemed === "yes" ? true : deemed === "no" ? false : signed < 0;
      ledgers.push({ name, debit: isDebit ? Math.abs(signed) : 0, credit: isDebit ? 0 : Math.abs(signed) });
      for (const ref of blocks(entry, "BILLALLOCATIONS.LIST")) {
        const refName = tag(ref, "NAME");
        if (refName) billRefs.push({ name: refName, amount: Math.abs(parseTallyAmount(tag(ref, "AMOUNT"))) });
      }
    }
    const guid = tag(block, "GUID") ?? attrGuid ?? null;
    const date = parseTallyDate(tag(block, "DATE"));
    const number = tag(block, "VOUCHERNUMBER") ?? "";
    out.push({
      key: voucherKey({ guid, date, type, number, ledgers }), guid, date, type, number,
      narration: tag(block, "NARRATION") ?? "", party: tag(block, "PARTYLEDGERNAME") ?? "", ledgers, billRefs,
    });
  }
  return out;
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * A Day Book / Ledger Vouchers sheet. `rows` is every row as strings or values (Excel cells, CSV fields).
 * Finds the header row by its column names, so title lines and blank rows above it are fine.
 */
export function parseTallySheet(rows: unknown[][]): TallyVoucher[] {
  let headerAt = -1;
  let col: Record<string, number> = {};
  let title = "";
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = (rows[i] ?? []).map(norm);
    const find = (...names: string[]) => cells.findIndex((c) => names.some((n) => c === n || c.startsWith(n)));
    const date = find("date");
    const vchType = find("vch type", "voucher type");
    if (date !== -1 && vchType !== -1) {
      headerAt = i;
      col = { date, particulars: find("particulars", "ledger", "account"), type: vchType, number: find("vch no", "voucher no", "voucher number"), debit: find("debit"), credit: find("credit"), narration: find("narration") };
      break;
    }
    const first = String((rows[i] ?? [])[0] ?? "").trim();
    const t = first.match(/^(?:ledger|account)\s*[:\-]\s*(.+)$/i);
    if (t) title = t[1].trim();
  }
  if (headerAt === -1) return [];
  const out: TallyVoucher[] = [];
  let lastDate: string | null = null;
  for (const r of rows.slice(headerAt + 1)) {
    const cell = (i: number) => (i >= 0 ? (r ?? [])[i] : undefined);
    const type = String(cell(col.type) ?? "").trim();
    if (!type) continue; // continuation lines, totals, blank rows
    const date = parseTallyDate(cell(col.date)) ?? lastDate;
    lastDate = date;
    const particulars = String(cell(col.particulars) ?? "").replace(/^\s*(?:To|By)\s+/i, "").trim();
    const debit = Math.abs(parseTallyAmount(cell(col.debit)));
    const credit = Math.abs(parseTallyAmount(cell(col.credit)));
    // Ledger Vouchers of one vendor: the party is the title; the Particulars is the bank. Day Book: the party is Particulars.
    const party = title || particulars;
    const counter = title ? particulars : "";
    const number = String(cell(col.number) ?? "").trim();
    const ledgers: TallyLedgerLine[] = [{ name: party, debit, credit }];
    if (counter) ledgers.push({ name: counter, debit: credit, credit: debit });
    out.push({
      key: voucherKey({ guid: null, date, type, number, ledgers }), guid: null, date, type, number,
      narration: String(cell(col.narration) ?? "").trim(), party, ledgers, billRefs: [],
    });
  }
  return out;
}

/** Minimal CSV reader (quoted fields, doubled quotes, CRLF) so a CSV export needs no extra library. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') inQuotes = false; else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && src[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
