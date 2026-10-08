/**
 * DigiLocker sessions nobody came back to check. 24 of the 79 joiners in the Ops Control Tower's
 * DigiLocker pending list on 2026-10-06 had started a Luckpay session that was never polled again.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, sync } = vi.hoisted(() => ({ execute: vi.fn(), sync: vi.fn() }));
vi.mock("../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../config/env.js", () => ({ env: { DIGILOCKER_RECONCILIATION_ENABLED: false } }));
vi.mock("../../modules/integrations/luckpay/luckpay-status.service.js", () => ({ syncDigilockerStatus: sync }));

const worker = await import("../digilocker-reconciliation.worker.js");

beforeEach(() => { execute.mockReset(); sync.mockReset(); });

describe("findOpenDigilockerSessions", () => {
  it("picks only the latest, still-open, pollable Luckpay session per candidate", async () => {
    execute.mockResolvedValue([[{ candidate_id: "c1" }, { candidate_id: "c1" }, { candidate_id: "c2" }]]);
    expect(await worker.findOpenDigilockerSessions()).toEqual(["c1", "c2"]);
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toContain("service_type = 'digilocker'");
    expect(sql).toContain("NOT IN ('documents_received', 'completed', 'failed', 'expired')");
    expect(sql).toContain("provider_reference_id");
    expect(sql).toContain("INTERVAL 15 MINUTE");
  });
});

describe("runDigilockerReconciliationOnce", () => {
  it("polls each open session and tallies the outcome, surviving a provider error", async () => {
    execute.mockResolvedValue([[{ candidate_id: "a" }, { candidate_id: "b" }, { candidate_id: "c" }, { candidate_id: "d" }]]);
    sync
      .mockResolvedValueOnce({ state: "completed" })
      .mockResolvedValueOnce({ state: "pending" })
      .mockResolvedValueOnce({ state: "failed" })
      .mockRejectedValueOnce(new Error("timeout"));
    expect(await worker.runDigilockerReconciliationOnce()).toEqual({
      examined: 4, completed: 1, stillPending: 1, failed: 1, errors: 1,
    });
    expect(sync).toHaveBeenCalledTimes(4);
  });

  it("does not start while the flag is off", async () => {
    await worker.startDigilockerReconciliationWorker();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("an already-completed session still brings the bridge level", () => {
  it("syncDigilockerStatus's early return for a completed log advances the bridge", () => {
    const src = readFileSync(resolve(process.cwd(), "src/modules/integrations/luckpay/luckpay-status.service.ts"), "utf8");
    const at = src.indexOf('if (["documents_received", "completed"].includes(String(row.status ?? "")))');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("}", at + 120));
    expect(block).toContain('syncBridgeDigilockerStatus(db, candidateId, "completed")');
  });
});
