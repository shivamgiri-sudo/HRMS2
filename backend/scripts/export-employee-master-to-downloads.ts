/**
 * One-off script: runs the employee-master report executor exactly as the app would (full
 * org-wide scope, no filters) and writes the resulting workbook to the user's Downloads folder,
 * using the same buildCatalogWorkbook() builder report-suite.routes.ts uses for this report
 * (CATALOG_FORMAT_CODES path) — so the file matches what a real export download produces.
 *
 * Run: npx tsx scripts/export-employee-master-to-downloads.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { employeeMaster } from "../src/modules/reporting/executors/employee.executor.js";
import { buildCatalogWorkbook, type CatalogWorkbookColumn } from "../src/modules/reporting/catalog-workbook.js";
import { REPORT_CATALOG } from "../src/modules/reporting/report-catalog.js";
import { buildSecureFilename } from "../src/modules/reporting/xlsx-secure-builder.js";
import type { ExecScope, ExecOptions } from "../src/modules/reporting/executors/types.js";

async function main() {
  const scope: ExecScope = {
    companyId: "1",
    isSuperAdmin: true,
    branchScope: { mode: "all", ids: [] },
    processScope: { mode: "all", ids: [] },
    departmentScope: { mode: "all", ids: [] },
    costCentreScope: { mode: "all", ids: [] },
    canViewAllEmployees: true,
    canViewSensitiveFields: true,
    canExportSensitiveReports: true,
    roles: ["super_admin"],
  };

  const options: ExecOptions = {
    limit: 100_000,
    offset: 0,
    cursor: null,
    includeTotal: true,
    mode: "export",
  };

  console.log("Running employeeMaster() executor against live DB (full org-wide scope)...");
  const result = await employeeMaster({}, scope, options);
  console.log(`Rows returned: ${result.rows.length} (rowCount=${result.rowCount}, truncated=${result.isTruncated})`);

  const catalogEntry = REPORT_CATALOG.find((r) => r.code === "employee-master");
  if (!catalogEntry) throw new Error("employee-master not found in REPORT_CATALOG");

  const buffer = await buildCatalogWorkbook({
    rows: result.rows,
    columns: catalogEntry.columns as CatalogWorkbookColumn[],
    sheetName: catalogEntry.name,
  });

  const filename = buildSecureFilename(catalogEntry.name, `manual-run-v2-${Date.now()}`);
  const downloadsDir = path.join(os.homedir(), "Downloads");
  const outPath = path.join(downloadsDir, filename);
  writeFileSync(outPath, buffer);

  console.log(`Wrote ${buffer.length} bytes to: ${outPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
