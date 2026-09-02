/**
 * db_bill (I-Spark's backing DB, source of truth) vs mas_hrms client_invoice/client_credit_note
 * (the rebuilt data the Tally/GST export reads from) — field-by-field reconciliation.
 *
 * READ-ONLY. Every query here is a SELECT against both databases. Nothing is written anywhere.
 *
 * Mirrors client-billing-cutover/verify-2026-08-21.mjs's connection pattern (host fallback,
 * quote-stripped env vars) and load.ts's own field mapping (legacy_id = tbl_invoice.id /
 * tbl_credit_note.id; total_amount<-total; igst/cgst/sgst_amount<-igst/cgst/sgst;
 * grand_total<-grnd; tally_head<-cost_TallyHead; client_tally_name<-cost_client_tally_name),
 * so a "mismatch" reported here is a real reconciliation failure, not a mapping error in the
 * check itself.
 *
 * Run: node verify-tally-reconciliation.mjs
 */
import "dotenv/config";
import mysql from "mysql2/promise";

function stripQuotes(v) {
  return (v ?? "").replace(/^["']|["']$/g, "");
}

async function connectWithFallback(hosts, cfg, label) {
  for (const host of hosts) {
    try {
      const conn = await mysql.createConnection({ ...cfg, host, connectTimeout: 8000 });
      await conn.query("SELECT 1");
      console.log(`[${label}] connected via ${host}`);
      return conn;
    } catch (e) {
      console.log(`[${label}] ${host} failed: ${e.code || e.message}`);
    }
  }
  throw new Error(`[${label}] all hosts failed`);
}

// Same tolerance load.ts's own money handling implies (rounding, not exactness, across two
// engines' DECIMAL/VARCHAR round-trips) and the same one gst-export.service.ts itself uses.
const MONEY_TOL = 1.0;

function parseLegacyDecimal(raw) {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN; // NaN marks an unparseable legacy value (e.g. "8800\r0")
}

function moneyMismatch(a, b) {
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  if (Number.isNaN(a) || Number.isNaN(b)) return true;
  return Math.abs(a - b) > MONEY_TOL;
}

// Dates are selected pre-formatted via DATE_FORMAT() below — this only has to handle the
// resulting 'YYYY-MM-DD' string (or NULL), never a JS Date object subject to driver timezone
// conversion.
function dateKey(v) {
  return v ? String(v) : null;
}

async function main() {
  const hrmsCfg = {
    user: stripQuotes(process.env.DB_USER),
    password: stripQuotes(process.env.DB_PASSWORD),
    database: stripQuotes(process.env.DB_NAME),
    port: Number(process.env.DB_PORT || 3306),
  };
  const billCfg = {
    user: stripQuotes(process.env.BILL_DB_USER),
    password: stripQuotes(process.env.BILL_DB_PASSWORD),
    database: stripQuotes(process.env.BILL_DB_NAME),
    port: Number(process.env.BILL_DB_PORT || 3306),
  };

  const hrms = await connectWithFallback(["192.168.10.6", "122.184.128.90"], hrmsCfg, "mas_hrms");
  const bill = await connectWithFallback(["192.168.10.22", "14.97.30.236"], billCfg, "db_bill");

  const report = { generated_at: new Date().toISOString() };

  // ═══ INVOICES ═══════════════════════════════════════════════════════════════
  const [hrmsInv] = await hrms.query(
    `SELECT legacy_id, bill_no, DATE_FORMAT(invoice_date, '%Y-%m-%d') AS invoice_date,
            total_amount, igst_amount, cgst_amount,
            sgst_amount, grand_total, tally_head, client_tally_name
       FROM client_invoice WHERE is_migrated = 1 AND legacy_id IS NOT NULL`
  );
  console.log(`[mas_hrms] client_invoice migrated rows: ${hrmsInv.length}`);

  const legacyIds = hrmsInv.map((r) => r.legacy_id);
  const billInvMap = new Map();
  const CHUNK = 2000;
  for (let i = 0; i < legacyIds.length; i += CHUNK) {
    const chunk = legacyIds.slice(i, i + CHUNK);
    const [rows] = await bill.query(
      `SELECT id, bill_no, DATE_FORMAT(invoiceDate, '%Y-%m-%d') AS invoiceDate, total, igst, cgst, sgst, grnd,
              cost_TallyHead, cost_client_tally_name
         FROM tbl_invoice WHERE id IN (${chunk.map(() => "?").join(",")})`,
      chunk
    );
    for (const r of rows) billInvMap.set(r.id, r);
  }
  console.log(`[db_bill] tbl_invoice rows fetched by legacy_id: ${billInvMap.size}`);

  let invMissingInBill = 0;
  let invBillNoMismatch = 0;
  let invDateMismatch = 0;
  let invMoneyMismatch = 0;
  let invTallyHeadDiffers = 0;
  let invClientTallyNameDiffers = 0;
  let invExactMatch = 0;
  const invMismatchSamples = [];
  const tallyHeadSamples = [];
  const clientTallySamples = [];

  for (const h of hrmsInv) {
    const b = billInvMap.get(h.legacy_id);
    if (!b) { invMissingInBill++; continue; }

    const billNoOk = String(h.bill_no ?? "").trim() === String(b.bill_no ?? "").trim();
    const dateOk = dateKey(h.invoice_date) === dateKey(b.invoiceDate);
    const moneyOk =
      !moneyMismatch(Number(h.total_amount), parseLegacyDecimal(b.total)) &&
      !moneyMismatch(Number(h.igst_amount), parseLegacyDecimal(b.igst) ?? 0) &&
      !moneyMismatch(Number(h.cgst_amount), parseLegacyDecimal(b.cgst) ?? 0) &&
      !moneyMismatch(Number(h.sgst_amount), parseLegacyDecimal(b.sgst) ?? 0) &&
      !moneyMismatch(Number(h.grand_total), parseLegacyDecimal(b.grnd));

    // tally_head/client_tally_name were backfilled from staging AFTER load.ts ran (migration
    // 1308, separate pass) and are legitimately NULL on rows that pass never had a legacy
    // value — that is not a mismatch, it's an untouched/never-populated field.
    const tallyHeadOk =
      (h.tally_head ?? null) === (b.cost_TallyHead ?? null) ||
      (h.tally_head === null && (b.cost_TallyHead === null || String(b.cost_TallyHead).trim() === ""));
    const clientTallyOk =
      (h.client_tally_name ?? null) === (b.cost_client_tally_name ?? null) ||
      (h.client_tally_name === null && (b.cost_client_tally_name === null || String(b.cost_client_tally_name).trim() === ""));

    if (!billNoOk) invBillNoMismatch++;
    if (!dateOk) invDateMismatch++;
    if (!moneyOk) invMoneyMismatch++;
    if (!tallyHeadOk) { invTallyHeadDiffers++; if (tallyHeadSamples.length < 12) tallyHeadSamples.push({ legacy_id: h.legacy_id, hrms: h.tally_head, bill: b.cost_TallyHead }); }
    if (!clientTallyOk) { invClientTallyNameDiffers++; if (clientTallySamples.length < 12) clientTallySamples.push({ legacy_id: h.legacy_id, hrms: h.client_tally_name, bill: b.cost_client_tally_name }); }

    if (billNoOk && dateOk && moneyOk) invExactMatch++;
    else if (invMismatchSamples.length < 15) {
      invMismatchSamples.push({
        legacy_id: h.legacy_id,
        bill_no: { hrms: h.bill_no, bill: b.bill_no, ok: billNoOk },
        invoice_date: { hrms: dateKey(h.invoice_date), bill: dateKey(b.invoiceDate), ok: dateOk },
        total_amount: { hrms: Number(h.total_amount), bill: parseLegacyDecimal(b.total) },
        grand_total: { hrms: Number(h.grand_total), bill: parseLegacyDecimal(b.grnd) },
      });
    }
  }

  report.invoices = {
    hrms_migrated_rows: hrmsInv.length,
    matched_in_db_bill: hrmsInv.length - invMissingInBill,
    missing_in_db_bill: invMissingInBill,
    exact_match_bill_no_date_money: invExactMatch,
    bill_no_mismatch: invBillNoMismatch,
    date_mismatch: invDateMismatch,
    money_mismatch: invMoneyMismatch,
    tally_head_differs: invTallyHeadDiffers,
    tally_head_differs_samples: tallyHeadSamples,
    client_tally_name_differs: invClientTallyNameDiffers,
    client_tally_name_differs_samples: clientTallySamples,
    mismatch_samples: invMismatchSamples,
  };

  // ═══ CREDIT NOTES ═══════════════════════════════════════════════════════════
  const [hrmsCn] = await hrms.query(
    `SELECT legacy_id, credit_no, DATE_FORMAT(credit_date, '%Y-%m-%d') AS credit_date,
            total_amount, igst_amount, cgst_amount,
            sgst_amount, grand_total
       FROM client_credit_note WHERE is_migrated = 1 AND legacy_id IS NOT NULL`
  );
  console.log(`[mas_hrms] client_credit_note migrated rows: ${hrmsCn.length}`);

  const cnLegacyIds = hrmsCn.map((r) => r.legacy_id);
  const billCnMap = new Map();
  for (let i = 0; i < cnLegacyIds.length; i += CHUNK) {
    const chunk = cnLegacyIds.slice(i, i + CHUNK);
    if (!chunk.length) continue;
    const [rows] = await bill.query(
      `SELECT id, credit_no, DATE_FORMAT(creditDate, '%Y-%m-%d') AS creditDate, total, igst, cgst, sgst, grnd
         FROM tbl_credit_note WHERE id IN (${chunk.map(() => "?").join(",")})`,
      chunk
    );
    for (const r of rows) billCnMap.set(r.id, r);
  }
  console.log(`[db_bill] tbl_credit_note rows fetched by legacy_id: ${billCnMap.size}`);

  let cnMissingInBill = 0, cnNoMismatch = 0, cnDateMismatch = 0, cnMoneyMismatch = 0, cnExactMatch = 0;
  const cnMismatchSamples = [];

  for (const h of hrmsCn) {
    const b = billCnMap.get(h.legacy_id);
    if (!b) { cnMissingInBill++; continue; }

    const noOk = String(h.credit_no ?? "").trim() === String(b.credit_no ?? "").trim();
    const dateOk = dateKey(h.credit_date) === dateKey(b.creditDate);
    const moneyOk =
      !moneyMismatch(Number(h.total_amount), parseLegacyDecimal(b.total)) &&
      !moneyMismatch(Number(h.grand_total), parseLegacyDecimal(b.grnd));

    if (!noOk) cnNoMismatch++;
    if (!dateOk) cnDateMismatch++;
    if (!moneyOk) cnMoneyMismatch++;

    if (noOk && dateOk && moneyOk) cnExactMatch++;
    else if (cnMismatchSamples.length < 15) {
      cnMismatchSamples.push({
        legacy_id: h.legacy_id,
        credit_no: { hrms: h.credit_no, bill: b.credit_no, ok: noOk },
        credit_date: { hrms: dateKey(h.credit_date), bill: dateKey(b.creditDate), ok: dateOk },
        total_amount: { hrms: Number(h.total_amount), bill: parseLegacyDecimal(b.total) },
      });
    }
  }

  report.credit_notes = {
    hrms_migrated_rows: hrmsCn.length,
    matched_in_db_bill: hrmsCn.length - cnMissingInBill,
    missing_in_db_bill: cnMissingInBill,
    exact_match_credit_no_date_money: cnExactMatch,
    credit_no_mismatch: cnNoMismatch,
    date_mismatch: cnDateMismatch,
    money_mismatch: cnMoneyMismatch,
    mismatch_samples: cnMismatchSamples,
  };

  // ═══ COVERAGE: db_bill rows that have NO mas_hrms counterpart at all ═════════
  const [[billInvTotal]] = await bill.query("SELECT COUNT(*) n FROM tbl_invoice");
  const [[billCnTotal]] = await bill.query("SELECT COUNT(*) n FROM tbl_credit_note");

  // Every legacy id mas_hrms already has, so the gap rows below are whatever db_bill holds
  // that mas_hrms does not — computed in JS since the two databases are on different hosts.
  const hrmsInvIds = new Set(hrmsInv.map((r) => r.legacy_id));
  const hrmsCnIds = new Set(hrmsCn.map((r) => r.legacy_id));
  const [allBillInvIds] = await bill.query(
    "SELECT id, DATE_FORMAT(invoiceDate, '%Y-%m-%d') d, grnd FROM tbl_invoice"
  );
  const [allBillCnIds] = await bill.query(
    "SELECT id, DATE_FORMAT(creditDate, '%Y-%m-%d') d, createdate FROM tbl_credit_note"
  );
  const gapInv = allBillInvIds.filter((r) => !hrmsInvIds.has(r.id));
  const gapCn = allBillCnIds.filter((r) => !hrmsCnIds.has(r.id));
  const dates = (rows) => rows.map((r) => r.d).filter(Boolean).sort();

  report.coverage = {
    db_bill_tbl_invoice_total: billInvTotal.n,
    db_bill_tbl_credit_note_total: billCnTotal.n,
    hrms_migrated_invoice_total: hrmsInv.length,
    hrms_migrated_credit_note_total: hrmsCn.length,
    invoice_gap: gapInv.length,
    invoice_gap_date_range: dates(gapInv).length
      ? { earliest: dates(gapInv)[0], latest: dates(gapInv)[dates(gapInv).length - 1] }
      : null,
    invoice_gap_sample_ids: gapInv.slice(0, 20).map((r) => ({ id: r.id, date: r.d })),
    invoice_gap_pre_cutover_2026_08_19: gapInv.filter((r) => r.d && r.d < "2026-08-19").length,
    invoice_gap_post_cutover_2026_08_19: gapInv.filter((r) => r.d && r.d >= "2026-08-19").length,
    invoice_gap_post_cutover_grand_total_sum: Math.round(
      gapInv
        .filter((r) => r.d && r.d >= "2026-08-19")
        .reduce((sum, r) => sum + (parseLegacyDecimal(r.grnd) || 0), 0)
    ),
    invoice_gap_post_cutover_sample: gapInv
      .filter((r) => r.d && r.d >= "2026-08-19")
      .slice(0, 15)
      .map((r) => ({ id: r.id, date: r.d, grand_total: parseLegacyDecimal(r.grnd) })),
    credit_note_gap: gapCn.length,
    credit_note_gap_date_range: dates(gapCn).length
      ? { earliest: dates(gapCn)[0], latest: dates(gapCn)[dates(gapCn).length - 1] }
      : null,
  };

  console.log("\n" + JSON.stringify(report, null, 2));

  await hrms.end();
  await bill.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
