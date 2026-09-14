import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The on-screen preview and the exported XLSX for `attendance-register-monthly` only show
 * matching "Mon-DD" day headers (Requirement 3.5) if two structural preconditions hold:
 *
 * 1. The backend catalog actually declares day_1..day_31 keys on this report's `columns`
 *    array, so `withDayColumnLabels` (which only overrides labels for keys it finds) has a
 *    full month's worth of columns to act on instead of silently doing nothing.
 * 2. `attendance-register-monthly` is registered in `CATALOG_FORMAT_CODES` in
 *    report-suite.routes.ts, so the export path actually routes through the label-verbatim
 *    `buildCatalogWorkbook` builder instead of silently falling through to the generic
 *    `buildSecureXlsxBuffer` (which uppercases raw keys and ignores catalog labels).
 *
 * This test pins both preconditions via source-level parsing (no live DB), in the same
 * lightweight style as `catalog-frontend-parity.contract.test.ts`.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("attendance-register-monthly header-parity preconditions", () => {
  it("declares day_1 through day_31 in the backend catalog's columns array", () => {
    const src = read("src/modules/reporting/report-catalog.ts");

    const marker = 'code: "attendance-register-monthly"';
    const start = src.indexOf(marker);
    expect(start, "attendance-register-monthly entry not found in report-catalog.ts").toBeGreaterThanOrEqual(0);

    const nextCodeIdx = src.indexOf('code: "', start + marker.length);
    const segment = src.slice(start, nextCodeIdx === -1 ? src.length : nextCodeIdx);

    const dayKeys = new Set(
      [...segment.matchAll(/key:\s*"day_(\d+)"/g)].map((m) => Number(m[1])),
    );

    const missing: number[] = [];
    for (let day = 1; day <= 31; day++) {
      if (!dayKeys.has(day)) missing.push(day);
    }

    expect(
      missing,
      `attendance-register-monthly's columns array is missing day keys: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("registers attendance-register-monthly in CATALOG_FORMAT_CODES", () => {
    const src = read("src/modules/reporting/report-suite.routes.ts");

    const declRe = /CATALOG_FORMAT_CODES\s*=\s*new Set\(\s*\[[^\]]*\]\s*\)/;
    const decl = declRe.exec(src);
    expect(decl, "CATALOG_FORMAT_CODES declaration not found in report-suite.routes.ts").not.toBeNull();

    expect(decl![0]).toContain('"attendance-register-monthly"');
  });
});
