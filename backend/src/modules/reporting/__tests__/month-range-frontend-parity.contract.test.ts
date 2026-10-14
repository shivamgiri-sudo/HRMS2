import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MONTH_SINGLE_ONLY_CODES, MONTH_STACKABLE_CODES, ROW_DATE_COLUMN } from "../month-range.js";

/** A From/To picker is only honest where the backend honours it; these must agree. */
const view = readFileSync(resolve(process.cwd(), "../src/components/reports/views/ReportLibraryView.tsx"), "utf8");
const line = (code: string) => view.split("\n").find(l => l.startsWith(`    "${code}":`)) ?? "";

describe("From/To pickers match backend range support", () => {
  for (const code of [...MONTH_STACKABLE_CODES, ...MONTH_SINGLE_ONLY_CODES, ...Object.keys(ROW_DATE_COLUMN)]) {
    it(`${code} offers From/To`, () => {
      expect(line(code)).toMatch(/dateFilters|DATE_FROM/);
    });
  }
});
