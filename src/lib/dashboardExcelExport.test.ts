import * as XLSX from "xlsx";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { withoutGridlines } from "./dashboardExcelExport";

describe("withoutGridlines", () => {
  it("turns gridlines off on every sheet and leaves the data readable", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a"], [1]]), "One");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["b"], [2]]), "Two");
    const patched = withoutGridlines(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer));
    const files = unzipSync(patched);
    for (const name of ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) {
      expect(strFromU8(files[name])).toContain('showGridLines="0"');
    }
    const back = XLSX.read(patched, { type: "array" });
    expect(XLSX.utils.sheet_to_json(back.Sheets.Two, { header: 1 })).toEqual([["b"], [2]]);
  });
});
