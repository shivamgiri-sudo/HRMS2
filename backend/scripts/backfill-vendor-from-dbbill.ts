/**
 * Backfill vendor_master columns that exist in db_bill but were never carried into mas_hrms.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 *
 * Measured 2026-08-17 across 1,821 HRMS vendors vs 1,829 in db_bill: six columns are populated
 * upstream and empty here — roughly 5,373 values in total.
 *
 *   tally_name  <- TallyHead    1,807 (98.8%) -> 0    the field that reconciles a vendor to Tally
 *   state       <- state        1,147 (62.7%) -> 0
 *   pin_code    <- pincode      1,039 (56.8%) -> 0
 *   tds_rate    <- TDS            655 (35.8%) -> 0
 *   tds_section <- TDSSection     623 (34.1%) -> 0
 *   tds_enabled <- TDSEnabled     102 ( 5.6%) -> 0
 *
 * Not attempted: contact_name, contact_email, city, payment_terms. Those are blank in HRMS because
 * tbl_vendormaster has no such columns — nothing was lost, so there is nothing to restore. And
 * address / contact_phone are already at parity (98/98 and 13/13); they only look bad because the
 * source is that sparse.
 *
 * JOIN KEY. The original migration stamped `vendor_code` as `DB_BILL_<tbl_vendormaster.Id>`, so
 * the mapping is explicit rather than inferred. Cross-checked independently on vendor names:
 * 1,542 of 1,551 matched (99.4%).
 *
 * SAFETY. Only ever fills a column that is currently NULL/blank — an existing HRMS value is never
 * overwritten, so this cannot clobber anything edited since the migration.
 */
import mysql from "mysql2/promise";
import "dotenv/config";

const APPLY = process.argv.includes("--apply");

/** Values that are "filled in" upstream but carry no information. */
const PLACEHOLDERS = new Set(["na", "n/a", "n.a.", "-", "--", "nil", "none", "null", ""]);
const isBlank = (value: unknown) =>
  value === null || value === undefined || PLACEHOLDERS.has(String(value).trim().toLowerCase());

/**
 * TDSSection is varchar(100) of free text; the target is varchar(20). The 26 distinct raw values
 * fall into four groups, and only two of them are safe to write:
 *
 *   A  "TDS Contractor (194C)", "TDS Intrest (194A)"   323 rows — code inside the parens.
 *   B  "TDS Rent (1941)", "TDS Machinery Rental (1941)" 213 rows — "1941" is almost certainly 194I
 *      (capital i typed as a one); both descriptions say Rent, and rent IS section 194I. Almost
 *      certainly is not certainly, and rewriting a tax section on inference is not a call a
 *      migration script gets to make. Held back for a human decision.
 *   C  "194 (I)", "194 ( C )", "194 ( J )"               33 rows — the 194 sits OUTSIDE the parens,
 *      so taking only the parenthesised part yields "I"/"C"/"J". Joining the two is parsing, not
 *      guessing, so these are recovered correctly.
 *   D  "15", "14", "33", "9" …                           54 rows — bare numbers. There is no TDS
 *      section 15 or 33; whatever these are, they are not sections. Rejected outright.
 */
/**
 * Corrections the data owner authorised, NOT inferences this script made on its own.
 *
 * "1941" -> "194I": 213 vendors, from "TDS Rent (1941)" (137) and "TDS Machinery Rental (1941)"
 * (76). A capital i typed as a one. Both descriptions say rent, and TDS on rent is section 194I,
 * so the free text corroborates the reading independently of the code itself. Confirmed by the
 * user on 2026-08-17 before this mapping was added; it deliberately did not exist until then.
 */
const AUTHORISED_SECTION_CORRECTIONS = new Map([["1941", "194I"]]);

function extractSection(raw: unknown): { value: string | null; reason?: string } {
  if (isBlank(raw)) return { value: null, reason: "blank/placeholder" };
  const text = String(raw).trim();

  // Group C: digits before the bracket, letter inside — "194 ( I )" -> 194I
  const split = text.match(/(\d{3})\s*\(\s*([A-Za-z]{1,2})\s*\)/);
  if (split) return { value: `${split[1]}${split[2].toUpperCase()}` };

  // Groups A and B: the whole code sits inside the brackets.
  const inParens = text.match(/\(\s*([0-9A-Za-z]{1,6})\s*\)/);
  const candidate = inParens ? inParens[1].trim().toUpperCase() : text.toUpperCase();

  const corrected = AUTHORISED_SECTION_CORRECTIONS.get(candidate);
  if (corrected) return { value: corrected };
  // A real section is three digits plus an optional letter: 194C, 194A, 194I, 192, 195.
  if (/^\d{3}[A-Z]{0,2}$/.test(candidate)) return { value: candidate };
  return { value: null, reason: `"${text}" is not a recognisable TDS section` };
}

function parseRate(raw: unknown): { value: number | null; reason?: string } {
  if (isBlank(raw)) return { value: null, reason: "blank/placeholder" };
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) return { value: null, reason: `not a rate: ${raw}` };
  return { value: n };
}

type Plan = { column: string; wouldSet: number; skippedHasValue: number; skippedNoSource: number; unmapped: string[] };

async function main() {
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const bill = await mysql.createConnection({
    host: process.env.BILL_DB_HOST, port: Number(process.env.BILL_DB_PORT),
    user: process.env.BILL_DB_USER, password: process.env.BILL_DB_PASSWORD, database: process.env.BILL_DB_NAME,
  });

  try {
    const [hrmsRows] = await hrms.query<any[]>(
      `SELECT id, vendor_code, vendor_name, tally_name, state, pin_code, tds_rate, tds_section, tds_enabled
         FROM vendor_master WHERE vendor_code LIKE 'DB_BILL_%'`
    );
    const [billRows] = await bill.query<any[]>(
      `SELECT Id, vendor, TallyHead, state, pincode, TDS, TDSSection, TDSEnabled FROM tbl_vendormaster`
    );
    const source = new Map<string, any>(billRows.map((r) => [String(r.Id), r]));

    const plans: Record<string, Plan> = {};
    for (const column of ["tally_name", "state", "pin_code", "tds_rate", "tds_section", "tds_enabled"]) {
      plans[column] = { column, wouldSet: 0, skippedHasValue: 0, skippedNoSource: 0, unmapped: [] };
    }

    const updates: Array<{ id: string; sets: Record<string, unknown>; vendor: string }> = [];
    let unmatched = 0;
    const samples: string[] = [];

    for (const row of hrmsRows) {
      const legacyId = String(row.vendor_code).replace(/^DB_BILL_/, "");
      const src = source.get(legacyId);
      if (!src) { unmatched += 1; continue; }

      const sets: Record<string, unknown> = {};
      const consider = (column: string, current: unknown, next: unknown, reason?: string) => {
        const plan = plans[column];
        if (!isBlank(current)) { plan.skippedHasValue += 1; return; }
        if (next === null || next === undefined) {
          plan.skippedNoSource += 1;
          if (reason && !reason.startsWith("blank") && plan.unmapped.length < 8) plan.unmapped.push(reason);
          return;
        }
        sets[column] = next;
        plan.wouldSet += 1;
      };

      consider("tally_name", row.tally_name, isBlank(src.TallyHead) ? null : String(src.TallyHead).trim());
      consider("state", row.state, isBlank(src.state) ? null : String(src.state).trim());
      consider("pin_code", row.pin_code, isBlank(src.pincode) ? null : String(src.pincode).trim());

      const rate = parseRate(src.TDS);
      consider("tds_rate", row.tds_rate, rate.value, rate.reason);

      const section = extractSection(src.TDSSection);
      consider("tds_section", row.tds_section, section.value, section.reason);

      // tds_enabled is NOT NULL and currently 0 everywhere; only a 1 upstream is a real change.
      const enabled = Number(src.TDSEnabled) === 1 ? 1 : null;
      if (enabled === 1 && Number(row.tds_enabled) !== 1) { sets.tds_enabled = 1; plans.tds_enabled.wouldSet += 1; }
      else if (Number(row.tds_enabled) === 1) plans.tds_enabled.skippedHasValue += 1;
      else plans.tds_enabled.skippedNoSource += 1;

      if (Object.keys(sets).length) {
        updates.push({ id: String(row.id), sets, vendor: String(row.vendor_name) });
        if (samples.length < 5) samples.push(`  ${row.vendor_name} -> ${JSON.stringify(sets)}`);
      }
    }

    console.log(`\nHRMS vendors with a DB_BILL code : ${hrmsRows.length}`);
    console.log(`No matching db_bill row           : ${unmatched}`);
    console.log(`Vendors that would change         : ${updates.length}\n`);
    console.table(Object.values(plans).map((p) => ({
      column: p.column, wouldSet: p.wouldSet,
      skipped_already_set: p.skippedHasValue, skipped_no_source: p.skippedNoSource,
    })));
    for (const plan of Object.values(plans)) {
      if (plan.unmapped.length) console.log(`\n${plan.column} unmapped examples:\n  - ` + plan.unmapped.join("\n  - "));
    }
    console.log("\nSample rows:\n" + samples.join("\n"));

    // Distinct TDS sections that would be written, so the "1941" question is visible before any write.
    const sections = new Map<string, number>();
    for (const u of updates) {
      const value = u.sets.tds_section;
      if (typeof value === "string") sections.set(value, (sections.get(value) ?? 0) + 1);
    }
    if (sections.size) {
      console.log("\nDistinct tds_section values that would be written:");
      console.table([...sections.entries()].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, n })));
    }

    if (!APPLY) {
      console.log("\nDRY RUN — nothing written. Re-run with --apply to commit these changes.");
      return;
    }

    let written = 0;
    for (const update of updates) {
      const columns = Object.keys(update.sets);
      await hrms.execute(
        `UPDATE vendor_master SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
        [...columns.map((c) => update.sets[c]), update.id]
      );
      written += 1;
    }
    console.log(`\nAPPLIED — ${written} vendor row(s) updated.`);
  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch((error) => { console.error("FAILED:", error); process.exit(1); });
