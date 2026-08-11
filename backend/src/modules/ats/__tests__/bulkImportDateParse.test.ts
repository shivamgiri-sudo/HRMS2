import { describe, expect, it } from "vitest";
import { parseHistoricalDate } from "../bulk-import.service.js";

/**
 * 453 ats_candidate rows carry a created_at in the FUTURE.
 *
 * Measured on production 2026-08-11: 453 rows between 2026-09-03 and 2026-12-05 against a DB
 * clock of 2026-08-11. On every one of them DATE(created_at) equals walk_in_date, all are
 * sourcing_channel WALKIN, and all are genuine candidates rather than legacy imports — so both
 * columns came from this parser, via bulk-import.service.ts.
 *
 * The cause is the ambiguous branch: when both parts of d/m/yyyy are <= 12 the string cannot
 * say which is the month, and this defaulted to M/D/YYYY. The justification in the code —
 * "US format matches sample data 3/21/2026 = March 21" — could not have been tested against
 * that branch, because 21 > 12 takes the unambiguous path.
 *
 * The tell is that if the source really were M/D, no row could land in the future at all.
 */

const iso = (s: string | null) => (s ?? "").slice(0, 10);

describe("parseHistoricalDate — unambiguous inputs are untouched", () => {
  it("uses the part above 12 as the day (M/D/YYYY)", () => {
    expect(iso(parseHistoricalDate("3/21/2026"))).toBe("2026-03-21");
  });

  it("uses the leading part above 12 as the day (D/M/YYYY)", () => {
    expect(iso(parseHistoricalDate("21/3/2026"))).toBe("2026-03-21");
  });

  it("still reads Excel serial numbers", () => {
    expect(parseHistoricalDate("45000")).toMatch(/^\d{4}-\d{2}-\d{2} /);
  });

  it("returns null rather than guessing at nonsense", () => {
    expect(parseHistoricalDate("not-a-date")).toBeNull();
    expect(parseHistoricalDate(undefined)).toBeNull();
    expect(parseHistoricalDate("13/13/2026")).toBeNull();
  });
});

describe("parseHistoricalDate — ambiguous inputs never land in the future", () => {
  /**
   * The two ends of the production range. Under the old M/D default these produced
   * 2026-09-03 and 2026-12-05, both after the import ran.
   */
  it("reads 9/3/2026 as 9 March, not 3 September", () => {
    expect(iso(parseHistoricalDate("9/3/2026"))).toBe("2026-03-09");
  });

  it("reads 12/5/2026 as 12 May, not 5 December", () => {
    expect(iso(parseHistoricalDate("12/5/2026"))).toBe("2026-05-12");
  });

  it("takes the swap wherever it removes a future date", () => {
    // Exhaustive over the ambiguous space for the current year. The parser can only help when
    // ONE reading is in the future; where both are (8/12 is either 12 August or 8 December,
    // both ahead of an August import) no swap fixes it, and the created_at clamp in
    // bulk-import.service.ts is the backstop for those.
    const year = new Date().getFullYear();
    const fixable: string[] = [];
    for (let a = 1; a <= 12; a++) {
      for (let b = 1; b <= 12; b++) {
        const us  = new Date(`${year}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}T00:00:00Z`).getTime();
        const dmy = new Date(`${year}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}T00:00:00Z`).getTime();
        const onlyUsIsFuture = us > Date.now() && dmy <= Date.now();
        if (!onlyUsIsFuture) continue;
        const out = iso(parseHistoricalDate(`${a}/${b}/${year}`));
        if (new Date(`${out}T00:00:00Z`).getTime() > Date.now()) fixable.push(`${a}/${b}/${year} -> ${out}`);
      }
    }
    expect(
      fixable,
      "Where exactly one reading is in the past, the parser must choose it — an import of " +
        "historical records cannot have been created after today.",
    ).toEqual([]);
  });

});

describe("parseHistoricalDate — behaviour is unchanged where both readings are plausible", () => {
  it("keeps the M/D default when neither reading is in the future", () => {
    // Both 2 March and 3 February are in the past, so the string is genuinely ambiguous and
    // nothing here can improve on a default. Preserving it keeps historical imports stable.
    const lastYear = new Date().getFullYear() - 1;
    expect(iso(parseHistoricalDate(`3/2/${lastYear}`))).toBe(`${lastYear}-03-02`);
  });

  it("does not rewrite a date that is only valid one way", () => {
    // 2/30 is not a real date under the swapped reading, so the swap must not be taken.
    expect(iso(parseHistoricalDate("2/30/2020"))).toBe("2020-02-30");
  });

  it("preserves the time component", () => {
    expect(parseHistoricalDate("9/3/2026", "14:30:00")).toBe("2026-03-09 14:30:00");
  });
});
