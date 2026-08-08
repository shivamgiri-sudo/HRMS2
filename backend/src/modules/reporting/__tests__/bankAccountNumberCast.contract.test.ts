/**
 * employee_bank_detail.account_number is VARBINARY(500). Selected raw it serialises
 * to JSON as {"type":"Buffer","data":[...]}, not a usable account number. Confirmed
 * live at sites that had no CAST: bank-change-requests, neft-transfer-file, and the
 * payroll statutory export (ac_no). A further site, cheque-name-mismatch-report, also
 * reads this column raw but references other nonexistent columns (verification_status,
 * penny_drop_name, mismatch_reason) and needs a separate redesign — deliberately not
 * covered here.
 *
 * Positive tripwire (assert the fix is present) rather than a negative regex trying
 * to exclude the one legitimate bare `GROUP BY ebd.account_number` reference, which
 * is far more fragile than asserting the known-good CAST count directly.
 *
 * Scope note (2026-08-07): this used to read report-suite.routes.ts alone and require 3
 * casts there. neft-transfer-file has since moved out of that file's inline `case` block
 * into executors/payroll.executor.ts, as part of collapsing the three parallel SQL paths
 * a report code could have. The cast moved with it. Counting per-file would now pass or
 * fail on where the SQL happens to live rather than on whether the cast is applied, so
 * the check spans every file that reads this column.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Every file that selects employee_bank_detail.account_number **as literal SQL**.
 *
 * Scope correction (2026-08-08): the header above says this check "spans every file that reads
 * this column". That was not true. A third reader — bpo-master-verified-workforce-adapters.ts,
 * feeding BANK_ACCOUNT_NUMBER on the BPO master reports — never appears here because it does not
 * spell the column out: it resolves columns at runtime and builds the reference through
 * directField(), so there is no `CAST(ebd.account_number AS CHAR)` literal to count and adding
 * the path to SITES would simply fail. It had no CAST at all and emitted a Buffer to anyone
 * entitled to the unmasked value.
 *
 * That generated path is now covered by binary-column-cast.contract.test.ts, which asserts by
 * DATA TYPE (via sourceColumnReference) rather than by matching text — so it also covers the next
 * binary column without anyone remembering this. Keep both: this file guards hand-written SQL,
 * that one guards generated SQL, and neither can see the other's sites.
 */
const SITES = [
  "src/modules/reporting/report-suite.routes.ts",
  "src/modules/reporting/executors/payroll.executor.ts",
] as const;

const sources = SITES.map(path => ({ path, text: read(path) }));

describe("account_number is cast to CHAR before it reaches JSON", () => {
  it("every raw select of the column is a CAST, across all files that read it", () => {
    const casts = sources.reduce(
      (n, s) => n + (s.text.match(/CAST\(ebd\.account_number AS CHAR\)/g) ?? []).length,
      0,
    );

    expect(
      casts,
      "bank-change-requests, neft-transfer-file and the payroll statutory export (ac_no) " +
        "should each CAST account_number. If this count changed, confirm whether a site " +
        "was added or removed deliberately — a bare select ships a Buffer to the client.",
    ).toBeGreaterThanOrEqual(3);
  });

  /**
   * cheque-name-mismatch-report selects the column bare, and is left that way on purpose.
   *
   * It cannot run at all: it also selects ebd.verification_status, ebd.penny_drop_name and
   * ebd.mismatch_reason, none of which exist on employee_bank_detail (verified against live
   * 2026-08-07 — the table has account_holder_name, account_number, bank_name and ifsc_code
   * of the columns it names). The query throws ER_BAD_FIELD_ERROR before serialisation, so
   * the Buffer this test guards against is never reached.
   *
   * Adding a CAST would make the report look repaired while leaving it broken, which is
   * worse than leaving the one bare select visible. It needs the redesign the file header
   * already calls for, not a cosmetic fix.
   */
  const KNOWN_BARE_SELECT = /cheque-name-mismatch-report/;

  it("no runnable report selects the column bare in a SELECT list", () => {
    // A bare `ebd.account_number,` in a SELECT list is the actual defect. GROUP BY and
    // ON clauses may reference it raw — those never reach the response.
    const offenders: string[] = [];
    for (const { path, text } of sources) {
      for (const m of text.matchAll(/^\s*ebd\.account_number\s*(?:AS\s+\w+)?\s*,/gm)) {
        // Attribute the hit to the nearest preceding `case "..."` so an exemption names a
        // report rather than a line number that moves.
        const before = text.slice(0, m.index);
        const owner = [...before.matchAll(/case\s+"([a-z0-9-]+)"/g)].pop()?.[1] ?? "unknown";
        if (KNOWN_BARE_SELECT.test(owner)) continue;
        offenders.push(`${path}:${before.split("\n").length} (${owner})`);
      }
    }
    expect(offenders, `account_number selected without CAST at:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("neft-transfer-file's GROUP BY still includes the raw column (functional dependency, not a leak)", () => {
    const payroll = sources.find(s => s.path.endsWith("payroll.executor.ts"))!.text;
    expect(payroll).toMatch(/GROUP BY[\s\S]*?ebd\.account_number/);
  });
});
