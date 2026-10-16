import { beforeEach, describe, expect, it, vi } from "vitest";

const summary = vi.fn();
vi.mock("../../process-pnl/canonical-pnl.service.js", () => ({
  getCachedAllocationSummary: (...a: unknown[]) => summary(...a),
}));

import { buildProcessPnl } from "../pnl.js";

const branch = { branchId: "b1", branchCode: "NOIDA", branchName: "NOIDA" };

function row(over: Record<string, unknown> = {}) {
  return {
    processId: "p1", processName: "Alpha", clientName: "Client A", costCentreCode: "CC1",
    recognizedRevenue: 1000, totalPeopleCost: 600, totalOperatingCost: 900, ebitda: 200,
    operatingProfit: 100, operatingProfitPct: 10, processStatus: "profitable",
    seatFillPct: 90, mandatedSeats: 50, activeHc: 45, outstandingReceivable: 30, revenueVariance: -5,
    ...over,
  };
}

beforeEach(() => { summary.mockReset(); });

describe("buildProcessPnl", () => {
  it("calls the summary with period and branchId, drops DialDesk/I-Spark/Dataconnect rows, sorts worst first", async () => {
    summary.mockResolvedValue({ rows: [
      row({ processId: "a", processName: "Good", operatingProfit: 300, operatingProfitPct: 30, recognizedRevenue: 1000, totalOperatingCost: 700, totalPeopleCost: 500, processStatus: "profitable" }),
      row({ processId: "b", processName: "Bad", operatingProfit: -200, operatingProfitPct: -20, recognizedRevenue: 1000, totalOperatingCost: 1200, totalPeopleCost: 800, processStatus: "loss-making" }),
      row({ processId: "c", processName: "Dial Desk Inbound" }),
      row({ processId: "d", processName: "X", clientName: "I-Spark Ltd" }),
      row({ processId: "e", processName: "Data-Connect Ops" }),
      row({ processId: "f", processName: "Y", costCentreCode: "DIALDESK-01" }),
      row({ processId: "g", processName: "Mid", operatingProfit: 10, operatingProfitPct: 1, recognizedRevenue: 1000, totalOperatingCost: 990, totalPeopleCost: 400, processStatus: "at-risk", revenueVariance: null, seatFillPct: null, mandatedSeats: null }),
    ] });
    const r = await buildProcessPnl(branch, "2026-10-15");
    expect(summary).toHaveBeenCalledWith({ period: "2026-10", branchId: "b1" });
    expect(r.status).toBe("ok");
    expect(r.data!.period).toBe("2026-10");
    expect(r.data!.rows.map((x) => x.processId)).toEqual(["b", "g", "a"]);
    expect(r.data!.rows[0]).toMatchObject({ otherCost: 400, peopleCost: 800, revenue: 1000, status: "loss-making", revenueVsBudget: -5 });
    expect(r.data!.rows[1]).toMatchObject({ revenueVsBudget: null, seatFillPct: null, mandatedSeats: null });
    expect(r.data!.totals).toEqual({
      revenue: 3000, totalCost: 2890, operatingProfit: 110, opPct: (110 / 3000) * 100,
      loss: 1, atRisk: 1, profitable: 1, noActivity: 0, outstandingReceivable: 90,
    });
  });
  it("keeps the true otherCost difference (no flooring)", async () => {
    summary.mockResolvedValue({ rows: [row({ totalOperatingCost: 500, totalPeopleCost: 600 })] });
    const r = await buildProcessPnl(branch, "2026-10-15");
    expect(r.data!.rows[0].otherCost).toBe(-100);
  });
  it("empty when no rows remain", async () => {
    summary.mockResolvedValue({ rows: [row({ processName: "DialDesk" })] });
    expect((await buildProcessPnl(branch, "2026-10-15")).status).toBe("empty");
    summary.mockResolvedValue({ rows: [] });
    expect((await buildProcessPnl(branch, "2026-10-15")).status).toBe("empty");
  });
  it("error section, not a throw, when the summary rejects", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    summary.mockRejectedValue(new Error("boom db secret"));
    const r = await buildProcessPnl(branch, "2026-10-15");
    expect(r.status).toBe("error");
    expect(r.message).toBe("P&L could not be loaded");
    expect(r.data).toBeNull();
    spy.mockRestore();
  });
  it("opPct null when revenue is zero", async () => {
    summary.mockResolvedValue({ rows: [row({ recognizedRevenue: 0, operatingProfit: -5, operatingProfitPct: null, totalOperatingCost: 5, totalPeopleCost: 5, processStatus: "loss-making" })] });
    const r = await buildProcessPnl(branch, "2026-10-15");
    expect(r.data!.totals.opPct).toBeNull();
    expect(r.data!.rows[0].opPct).toBeNull();
  });
  it("zero-activity rows are not counted as loss/at-risk/profitable and are reported as noActivity", async () => {
    summary.mockResolvedValue({ rows: [
      row({ processId: "a", recognizedRevenue: 1000, totalOperatingCost: 900, totalPeopleCost: 500, operatingProfit: 100, operatingProfitPct: 10, processStatus: "profitable" }),
      row({ processId: "z", processName: "BSS_X", recognizedRevenue: 0, totalOperatingCost: 0, totalPeopleCost: 0, operatingProfit: 0, operatingProfitPct: null, processStatus: "at-risk" }),
    ] });
    const r = await buildProcessPnl(branch, "2026-10-15");
    expect(r.data!.totals).toMatchObject({ loss: 0, atRisk: 0, profitable: 1, noActivity: 1 });
    expect(r.data!.rows).toHaveLength(2);
  });
});
