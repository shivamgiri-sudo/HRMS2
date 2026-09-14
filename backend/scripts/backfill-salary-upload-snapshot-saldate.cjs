/**
 * Restore salary_upload_snapshot.sal_date from its real source in db_bill.
 *
 * All 39,099 rows of mas_hrms.salary_upload_snapshot.sal_date hold
 * '0000-00-00 00:00:00'. The cause is in sync-all-tables-from-dbbill.mjs, which
 * copies the column straight across:
 *
 *     SELECT ... SalDate AS sal_date, ... FROM salary_master_upload
 *
 * db_bill.salary_master_upload.SalDate is **varchar(100)**, not a date, and it
 * carries four different shapes. Feeding any of them into a DATETIME column
 * yields a zero date rather than an error, so every row silently lost its date:
 *
 *     D-Mon-YY        29,999   e.g. '30-Apr-18'
 *     Excel serial     5,614   e.g. '43343'  (days since 1899-12-30)
 *     M/D/YYYY         1,456   e.g. '4/30/2021'
 *     blank            2,030   empty string in db_bill itself
 *
 * This backfills the parsed value per DataId -> data_id. Verified against the
 * live source before writing: the parser leaves ZERO rows unparsed, the Excel
 * serials round-trip against FinanceMonth (43343 -> 2018-08-31 = 'Aug',
 * 43496 -> 2019-01-31 = 'Jan'), and 37,047 of 37,069 parsed dates agree with
 * their FinanceMonth.
 *
 * The 22 that disagree (a '31-Dec-18' filed under 'Jan', a '30-Oct-19' under
 * 'Sep') are copied EXACTLY as db_bill holds them. This mirrors the source of
 * truth; it does not clean it. Same for the 2,030 blanks — they become NULL,
 * which the column already allows. A month-end date could be inferred from
 * FinanceYear/FinanceMonth for those, but that would be inventing a value the
 * finance system does not have, so it is deliberately not done.
 *
 * READ-ONLY by default. Pass --apply to write.
 */
const mysql = require("mysql2/promise");
require("dotenv").config();

const APPLY = process.argv.includes("--apply");

// Mirrors the four shapes found live. Anything unrecognised stays NULL rather
// than guessing — and the dry run reports the count so it can never pass silently.
const PARSE_SQL = `CASE
  WHEN SalDate IS NULL OR TRIM(SalDate) = '' THEN NULL
  WHEN SalDate REGEXP '^[0-9]{5}$' THEN DATE_ADD('1899-12-30', INTERVAL CAST(SalDate AS UNSIGNED) DAY)
  WHEN STR_TO_DATE(SalDate, '%d-%b-%y') IS NOT NULL THEN STR_TO_DATE(SalDate, '%d-%b-%y')
  WHEN STR_TO_DATE(SalDate, '%m/%d/%Y') IS NOT NULL THEN STR_TO_DATE(SalDate, '%m/%d/%Y')
  ELSE NULL END`;

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

(async () => {
  const bill = await mysql.createConnection({
    host: process.env.BILL_DB_HOST,
    port: process.env.BILL_DB_PORT || 3306,
    user: process.env.BILL_DB_USER,
    password: process.env.BILL_DB_PASSWORD,
    database: process.env.BILL_DB_NAME,
    connectTimeout: 15000,
    dateStrings: true,
  });
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    dateStrings: true,
  });

  console.log(`\n=== salary_upload_snapshot.sal_date backfill — ${APPLY ? "APPLY" : "DRY RUN"} ===`);
  console.log(`    source: ${process.env.BILL_DB_NAME} @ ${process.env.BILL_DB_HOST} (MySQL 5.5)`);
  console.log(`    target: ${process.env.DB_NAME} @ ${process.env.DB_HOST}\n`);

  const [src] = await bill.query(
    `SELECT DataId, ${PARSE_SQL} AS parsed,
            (SalDate IS NOT NULL AND TRIM(SalDate) <> '' AND ${PARSE_SQL} IS NULL) AS unparsed
       FROM salary_master_upload`
  );

  const unparsed = src.filter((r) => Number(r.unparsed) === 1);
  const withDate = src.filter((r) => r.parsed);
  const blanks = src.length - withDate.length - unparsed.length;

  console.log(`source rows        : ${src.length}`);
  console.log(`  parseable        : ${withDate.length}`);
  console.log(`  blank in db_bill : ${blanks}  -> NULL`);
  console.log(`  UNPARSEABLE      : ${unparsed.length}${unparsed.length ? "  <-- investigate before applying" : ""}`);

  const [[before]] = await hrms.query(
    `SELECT COUNT(*) total,
            SUM(CAST(sal_date AS CHAR) LIKE '0000-00-00%') zero_dates,
            SUM(sal_date IS NULL) nulls
       FROM salary_upload_snapshot`
  );
  console.log(`\ntarget before      : ${before.total} rows, ${before.zero_dates} zero-dates, ${before.nulls} nulls`);

  // Dates repeat heavily (one per payroll month), so grouping by value turns
  // ~39k row updates into a few dozen statements.
  const byDate = new Map();
  for (const r of withDate) {
    const k = String(r.parsed).slice(0, 10);
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(r.DataId);
  }
  console.log(`distinct dates     : ${byDate.size}`);

  if (!APPLY) {
    const sample = [...byDate.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5);
    console.log(`\nlargest groups:`);
    for (const [d, ids] of sample) console.log(`    ${d}  ${ids.length} rows`);
    console.log(`\nDRY RUN — nothing written. Re-run with --apply.`);
    await bill.end(); await hrms.end();
    return;
  }

  if (unparsed.length) {
    console.error(`REFUSING TO APPLY — ${unparsed.length} source rows did not parse. Fix the parser first.`);
    process.exitCode = 1;
    await bill.end(); await hrms.end();
    return;
  }

  await hrms.beginTransaction();
  try {
    let updated = 0;
    for (const [date, ids] of byDate) {
      for (const part of chunk(ids, 5000)) {
        const [res] = await hrms.query(
          `UPDATE salary_upload_snapshot SET sal_date = ? WHERE data_id IN (?)`,
          [date, part]
        );
        updated += res.affectedRows;
      }
    }

    // Blanks in db_bill become NULL, not a zero date.
    const blankIds = src.filter((r) => !r.parsed && Number(r.unparsed) === 0).map((r) => r.DataId);
    let nulled = 0;
    for (const part of chunk(blankIds, 5000)) {
      const [res] = await hrms.query(
        `UPDATE salary_upload_snapshot SET sal_date = NULL WHERE data_id IN (?)`,
        [part]
      );
      nulled += res.affectedRows;
    }

    await hrms.commit();
    console.log(`\nAPPLIED — ${updated} rows dated, ${nulled} set NULL.`);

    const [[after]] = await hrms.query(
      `SELECT COUNT(*) total,
              SUM(CAST(sal_date AS CHAR) LIKE '0000-00-00%') zero_dates,
              SUM(sal_date IS NULL) nulls,
              MIN(sal_date) earliest, MAX(sal_date) latest
         FROM salary_upload_snapshot`
    );
    console.log(`target after       : ${after.total} rows, ${after.zero_dates} zero-dates, ${after.nulls} nulls`);
    console.log(`date range         : ${after.earliest} .. ${after.latest}`);
  } catch (e) {
    await hrms.rollback();
    console.error("ROLLED BACK —", e.message);
    process.exitCode = 1;
  }

  await bill.end();
  await hrms.end();
})();
