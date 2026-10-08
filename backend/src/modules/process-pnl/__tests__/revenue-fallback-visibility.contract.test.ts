import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const repoRoot = path.resolve(backendRoot, "..");

function read(fromRepoRoot: string) {
  return fs.readFileSync(path.join(repoRoot, fromRepoRoot), "utf8");
}

describe("fallback revenue rows are no longer indistinguishable from configured ones", () => {
  it("CSV export carries a Revenue Data Status column matching each row's field", () => {
    const overlay = read("backend/src/modules/process-pnl/bpo-pnl-allocation-overlay.service.ts");
    expect(overlay).toContain('"Revenue Data Status"');
    expect(overlay).toContain("row.revenueDataStatus");
    // Column count in the header row must match the number of value expressions in each data row —
    // catches the classic off-by-one where a column is added to one array but not the other.
    const headerMatch = overlay.match(/const headers = \[([\s\S]*?)\];/);
    expect(headerMatch).not.toBeNull();
    const headerCount = (headerMatch![1].match(/"/g) ?? []).length / 2;
    const rowMatch = overlay.match(/\.\.\.summary\.rows\.map\(\(row\) => \[([\s\S]*?)\]\.map\(escape\)/);
    expect(rowMatch).not.toBeNull();
    const valueCount = (rowMatch![1].match(/row\.\w+/g) ?? []).length;
    expect(headerCount).toBe(valueCount);
  });

  it("the process matrix table flags an accounting_fallback row inline, not just in the alerts tab", () => {
    const table = read("src/components/finance/pnl/BpoPnlMatrixTable.tsx");
    expect(table).toContain('row.revenueDataStatus === "accounting_fallback"');
    expect(table).toContain("AlertTriangle");
    expect(table).toContain("Revenue logic not configured");
  });
});

describe("classification-rule / allocation-policy effective-dating — audit correction", () => {
  it("the P&L calculation engine already bounds both by effective_from AND effective_to (not just from)", () => {
    // The original audit flagged these as unbounded; reading the actual calculation path
    // (not the admin listing path, which is intentionally unfiltered) shows both bounds are
    // already enforced via monthRange(period), matching the pattern already used for revenue
    // rate rules. No code change was needed here — this test locks in that finding so it
    // doesn't get silently re-broken.
    const service = read("backend/src/modules/process-pnl/bpo-pnl.service.ts");
    const allocFn = service.slice(service.indexOf("async function getAllocationPolicies"), service.indexOf("async function getAllocationPolicies") + 600);
    const classFn = service.slice(service.indexOf("async function getClassificationRules"), service.indexOf("async function getClassificationRules") + 600);
    for (const fn of [allocFn, classFn]) {
      expect(fn).toContain("effective_from <= ?");
      expect(fn).toContain("effective_to IS NULL OR effective_to >= ?");
      expect(fn).toContain("monthRange(period)");
    }
  });
});
