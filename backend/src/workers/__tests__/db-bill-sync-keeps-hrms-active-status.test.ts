import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = fs.readFileSync(path.join(__dirname, "..", "..", "..", "scripts", "sync-db-bill-snapshot.mjs"), "utf8");

describe("db_bill snapshot sync never overwrites HRMS cost-centre status", () => {
  it("does not write active_status or close_date on cost_centre_master", () => {
    const start = script.indexOf("UPDATE cost_centre_master SET");
    const end = script.indexOf("WHERE cost_centre_code = ?", start);
    expect(start).toBeGreaterThan(-1);
    const update = script.slice(start, end);
    expect(update).not.toMatch(/active_status/);
    expect(update).not.toMatch(/close_date/);
  });
});

describe("no scheduled db_bill finance sync (owner directive 2026-09-24)", () => {
  it("has no db-bill-finance-sync worker registered; the script is run by hand only", () => {
    const allWorkers = fs.readFileSync(path.join(__dirname, "..", "all-workers.ts"), "utf8");
    expect(allWorkers).not.toMatch(/DbBillFinanceSync/);
    expect(allWorkers).not.toMatch(/name:\s*"db-bill-finance-sync"/);
    expect(fs.existsSync(path.join(__dirname, "..", "db-bill-finance-sync.worker.ts"))).toBe(false);
  });
});
