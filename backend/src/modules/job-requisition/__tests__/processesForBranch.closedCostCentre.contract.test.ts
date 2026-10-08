import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Owner ruling 2026-09-24: the recruiter form's "Interviewed for Process" dropdown must list
 * "only mas callnet company process and active process for that branch". process_master
 * holds auto-created rows for cost centres db_bill has since closed, rows for IDC cost
 * centres, and auto-created duplicates of mapped clients. A process is listed only when it
 * is tied to an open MAS Callnet cost centre. The nightly backfill must also not create new
 * processes from closed cost centres.
 */
const serviceCode = fs.readFileSync(path.resolve(__dirname, "../job-requisition.service.ts"), "utf8");
const syncCode = fs.readFileSync(path.resolve(__dirname, "../../../shared/cost-centre-sync.ts"), "utf8");

function body(code: string, signature: string): string {
  const start = code.indexOf(signature);
  expect(start, `could not find "${signature}"`).toBeGreaterThan(-1);
  return code.slice(start, start + 2500);
}

describe("getProcessesForBranch lists only live MAS Callnet processes", () => {
  const fn = body(serviceCode, "async getProcessesForBranch(");

  it("still requires an active process_master row in the branch", () => {
    expect(fn).toContain("pm.active_status = 1");
    expect(fn).toContain("LOWER(TRIM(bm.branch_name)) = LOWER(TRIM(?))");
  });

  it("counts only open cost centres of the MAS Callnet company", () => {
    expect(serviceCode).toMatch(/const MAS_COMPANY_NAME = "Mas Callnet India Pvt Ltd";/);
    expect(fn).toContain("company_name = ?");
    expect(fn).toContain("active_status = 1");
    expect(fn).toContain("LOWER(COALESCE(status, '')) <> 'closed'");
    expect(fn).toContain("[MAS_COMPANY_NAME, branchName]");
  });

  it("requires the process to be tied to such a cost centre (a JOIN, not an exclusion)", () => {
    expect(fn).toContain("JOIN live_process lp ON lp.id = pm.id");
  });

  it("ties by process_id, by derived code only for unmapped cost centres, or by active staff", () => {
    expect(fn).toContain("SELECT process_id AS id FROM open_cc WHERE process_id IS NOT NULL");
    expect(fn).toContain("oc.process_id IS NULL AND oc.derived_code = pm2.process_code");
    expect(fn).toMatch(/JOIN open_cc oc ON oc\.id = e\.cost_centre_id\s*WHERE e\.employment_status = 'active'/);
  });

  it("derives the cost-centre code the same way the backfill does", () => {
    expect(fn).toContain("LEFT(UPPER(REGEXP_REPLACE(cost_centre_code, '[^A-Za-z0-9]+', '_')), 50) AS derived_code");
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
