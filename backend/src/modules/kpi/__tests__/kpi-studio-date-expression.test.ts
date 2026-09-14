import { describe, it, expect } from "vitest";
import {
  dateExpression,
  isSupportedDateFormat,
  DATE_FORMATS,
} from "../kpi-studio.sources.js";

/**
 * A spreadsheet exported "as values" leaves a day count behind rather than a date
 * string — db_masmis.neemans_sale_raw and neemans_allocation both store 46174-style
 * numbers in a varchar `date`. STR_TO_DATE returns NULL for every one of those, so
 * before `excel_serial` existed the whole table read as a confident zero rather than
 * failing loudly: the month filter simply matched nothing.
 */
describe("dateExpression", () => {
  it("uses a real date column directly", () => {
    expect(dateExpression("CallDate")).toBe("`CallDate`");
    expect(dateExpression("CallDate", null)).toBe("`CallDate`");
  });

  it("parses a text date column with STR_TO_DATE", () => {
    expect(dateExpression("order_date", "%d-%m-%Y")).toBe(
      "STR_TO_DATE(`order_date`, '%d-%m-%Y')",
    );
  });

  it("renders an Excel serial with the 1899-12-30 epoch, not STR_TO_DATE", () => {
    const sql = dateExpression("date", "excel_serial");
    expect(sql).toBe("DATE_ADD('1899-12-30', INTERVAL CAST(`date` AS SIGNED) DAY)");
    expect(sql).not.toContain("STR_TO_DATE");
  });

  it("keeps the table qualifier when one is supplied", () => {
    expect(dateExpression("date", "excel_serial", "s.")).toBe(
      "DATE_ADD('1899-12-30', INTERVAL CAST(s.`date` AS SIGNED) DAY)",
    );
  });

  it("refuses a format that is not on the whitelist rather than interpolating it", () => {
    expect(() => dateExpression("date", "%Y-%m-%d'); DROP TABLE x; --")).toThrow(
      /Unsupported date format/,
    );
    expect(() => dateExpression("date", "%d.%m.%Y")).toThrow(/Unsupported date format/);
  });

  it("treats excel_serial as a supported format", () => {
    expect(isSupportedDateFormat("excel_serial")).toBe(true);
    expect(DATE_FORMATS).toContain("excel_serial");
  });

  /**
   * The epoch is 1899-12-30 rather than 1900-01-01 because Excel counts 1900 as a
   * leap year, so its serials run one day ahead of the true calendar from
   * 1900-03-01 onward. 46174 is the lowest real value in neemans_sale_raw, and
   * MySQL's own DATE_ADD agrees it is 2026-06-01.
   */
  it("maps a real serial from the Neemans export to the date the sheet showed", () => {
    const epoch = Date.UTC(1899, 11, 30);
    const asDate = new Date(epoch + 46174 * 86_400_000).toISOString().slice(0, 10);
    expect(asDate).toBe("2026-06-01");
  });
});

/**
 * dateExpression can only protect a text date if it is actually handed the format.
 * kpi-studio.compute.ts loads each source with an explicit column list, and that
 * list once omitted date_format — so every source reached buildProcessQueryPlan
 * with date_format undefined and the guard above was bypassed on the main compute
 * path. An excel_serial source then returned zero rows, and a '%d-%m-%Y' source
 * would have compared dates as strings and returned the wrong month without error.
 */
describe("compute loads the columns dateExpression needs", () => {
  it("selects date_format on the same column list as date_column", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = fileURLToPath(new URL("../kpi-studio.compute.ts", import.meta.url));
    const src = readFileSync(path, "utf8");

    // Assert on the column list itself, not the prose around it: an earlier version
    // of this test searched a window of surrounding text and matched a comment that
    // merely mentioned date_format, so it passed with the bug reintroduced.
    const line = src
      .split("\n")
      .find((l) => l.includes("employee_key_column") && l.includes("date_column"));

    expect(line, "compute.ts source SELECT column list not found").toBeDefined();
    expect(line).toContain("date_format");
  });
});
