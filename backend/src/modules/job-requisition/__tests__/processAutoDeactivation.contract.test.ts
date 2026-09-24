import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Owner ruling 2026-09-24: "if their cost centre is inactive then mark process also inactive
 * and it should be auto". syncProcessActiveStatusWithCostCentres (shared/cost-centre-sync.ts)
 * runs nightly from cost-centre-process-resolver.worker.
 */
const root = path.resolve(__dirname, "../../../..");
const sync = fs.readFileSync(path.join(root, "src/shared/cost-centre-sync.ts"), "utf8");
const worker = fs.readFileSync(path.join(root, "src/workers/cost-centre-process-resolver.worker.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "sql/1862_process_master_auto_deactivation.sql"), "utf8");
const manifest = fs.readFileSync(path.join(root, "src/db/runPendingMigrations.ts"), "utf8");

function fnBody(): string {
  const start = sync.indexOf("export async function syncProcessActiveStatusWithCostCentres(");
  expect(start).toBeGreaterThan(-1);
  return sync.slice(start);
}

describe("syncProcessActiveStatusWithCostCentres", () => {
  const fn = fnBody();

  it("links a process to cost centres by process_id or by the backfill's derived code", () => {
    expect(sync).toContain("SELECT process_id AS pid, is_closed FROM cc WHERE process_id IS NOT NULL");
    expect(sync).toContain("JOIN cc ON cc.derived_code = pm.process_code");
    expect(sync).toContain("LEFT(UPPER(REGEXP_REPLACE(cost_centre_code, '[^A-Za-z0-9]+', '_')), 50) AS derived_code");
  });

  it("treats inactive or status=closed cost centres as closed", () => {
    expect(sync).toContain("(active_status = 0 OR LOWER(COALESCE(status, '')) = 'closed') AS is_closed");
  });

  it("deactivates only when every linked cost centre is closed", () => {
    expect(fn).toContain("HAVING MIN(is_closed) = 1");
    expect(fn).toContain("UPDATE process_master SET active_status = 0");
  });

  it("never deactivates a process that still has active employees or an open requisition", () => {
    expect(fn).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM employees e WHERE e\.process_id = pm\.id AND e\.employment_status = 'active'/);
    expect(fn).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM job_requisition jr/);
  });

  it("logs every automatic deactivation and reactivates only logged rows", () => {
    expect(fn).toContain("INSERT INTO process_master_auto_deactivation");
    expect(fn).toContain("JOIN process_master_auto_deactivation d ON d.process_id = pm.id AND d.reactivated_at IS NULL");
    expect(fn).toContain("UPDATE process_master SET active_status = 1");
  });

  it("is run by the nightly cost-centre-process-resolver worker", () => {
    expect(worker).toContain("await syncProcessActiveStatusWithCostCentres()");
  });

  it("has its log table created by a registered, idempotent migration", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS process_master_auto_deactivation");
    expect(manifest).toContain('"1862_process_master_auto_deactivation.sql"');
  });
});
