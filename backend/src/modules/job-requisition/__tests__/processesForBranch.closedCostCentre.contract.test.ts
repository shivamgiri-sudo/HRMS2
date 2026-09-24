import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Reported 2026-09-24: the recruiter form's "Interviewed for Process" dropdown listed
 * closed clients for the branch. Those process_master rows were auto-created from cost
 * centres that db_bill has since closed, and nothing deactivates them. The dropdown must
 * drop any process whose source cost centre is closed, and the nightly backfill must not
 * create new ones from closed cost centres.
 */
const serviceCode = fs.readFileSync(path.resolve(__dirname, "../job-requisition.service.ts"), "utf8");
const syncCode = fs.readFileSync(path.resolve(__dirname, "../../../shared/cost-centre-sync.ts"), "utf8");

function body(code: string, signature: string): string {
  const start = code.indexOf(signature);
  expect(start, `could not find "${signature}"`).toBeGreaterThan(-1);
  return code.slice(start, start + 2500);
}

describe("getProcessesForBranch hides processes of closed cost centres", () => {
  const fn = body(serviceCode, "async getProcessesForBranch(");

  it("still requires an active process_master row", () => {
    expect(fn).toContain("pm.active_status = 1");
  });

  it("excludes a process whose derived cost centre is inactive or closed", () => {
    expect(fn).toMatch(/NOT EXISTS\s*\(\s*SELECT 1 FROM cost_centre_master cc/);
    expect(fn).toMatch(/cc\.active_status = 0 OR LOWER\(cc\.status\) = 'closed'/);
  });

  it("matches cost centres by the same code derivation the backfill uses", () => {
    expect(fn).toContain("LEFT(UPPER(REGEXP_REPLACE(cc.cost_centre_code, '[^A-Za-z0-9]+', '_')), 50) = pm.process_code");
    const backfill = body(syncCode, "export async function backfillProcessMasterForOrphanedCostCentres(");
    expect(backfill).toContain('.replace(/[^A-Za-z0-9]/g, "_")');
    expect(backfill).toContain(".toUpperCase()");
    expect(backfill).toContain(".slice(0, 50)");
  });
});

describe("backfillProcessMasterForOrphanedCostCentres skips closed cost centres", () => {
  it("filters out cost centres whose status is closed", () => {
    const backfill = body(syncCode, "export async function backfillProcessMasterForOrphanedCostCentres(");
    expect(backfill).toContain("cc.active_status = 1");
    expect(backfill).toContain("LOWER(COALESCE(cc.status, '')) <> 'closed'");
  });
});
