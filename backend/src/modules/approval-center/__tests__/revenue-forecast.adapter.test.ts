import { describe, expect, it, vi } from "vitest";
import { fakeCtx, field } from "./finance-test-utils.js";

let roles = ["finance_head"];
vi.mock("../adapters/finance-shared.js", async () => {
  const actual = await vi.importActual<any>("../adapters/finance-shared.js");
  return { ...actual, callerRoles: async () => roles };
});
import { periodWindow, revenueForecastAdapter } from "../adapters/revenue-forecast.js";
import { beforeEach as __scopeBeforeEach } from "vitest";
import { useScope, ORG_WIDE } from "./scope-fixture.js";
__scopeBeforeEach(() => useScope(ORG_WIDE));

const listRow = (o: any = {}) => ({ costCentreId: "c1", costCentreCode: "CC1", branchName: "Noida", processName: "Acme", forecastId: "f1", status: "submitted", financeHeadStatus: "pending", forecastAmount: 900000, ...o });
const detail = (o: any = {}) => ({ data: { id: "f1", status: "submitted", finance_head_status: "pending", payroll_head_status: "pending", submitted_by: "u-bh", submitted_at: "2026-10-04T00:00:00Z", forecast_amount: 900000, cost_centre_code: "CC1", cost_centre_name: "Acme Noida", branch_name: "Noida", notes: "steady", lines: [{ line_type: "seat", description: "Seats", quantity: 60, rate: 15000, amount: 900000 }], ...o } });

function routes(rowsByCall: any[], det: any = detail()) {
  const r: any = { "GET /api/finance/revenue-forecasts/f1": det };
  let n = 0;
  r["GET /api/finance/revenue-forecasts"] = () => ({ data: { rows: rowsByCall[n++] ?? [] } });
  return r;
}

describe("revenue forecast adapter", () => {
  it("periodWindow spans prev..+2", () => {
    expect(periodWindow(new Date(Date.UTC(2026, 10, 5)))).toEqual(["2026-10", "2026-11", "2026-12", "2027-01"]);
  });
  it("maps submitted forecast with lines + deep link", async () => {
    roles = ["finance_head"];
    const { ctx } = fakeCtx(routes([[], [listRow(), listRow({ forecastId: null, status: "missing" })]]));
    const items = await revenueForecastAdapter.list(ctx);
    expect(items).toHaveLength(1);
    expect(field(items[0], "Forecast amount")).toBe("₹9,00,000");
    expect(field(items[0], "Line detail")).toContain("Seat: Seats | 60 x ₹15,000 = ₹9,00,000");
    expect(field(items[0], "Notes")).toBe("steady");
    expect(items[0].viewPath).toMatch(/^\/finance\/revenue-forecast\?period=\d{4}-\d{2}&approvalId=f1$/);
    expect(items[0].rejectNeedsReason).toBe(true);
  });
  it("skips own submission and non-finance roles", async () => {
    roles = ["finance_head"];
    const { ctx } = fakeCtx(routes([[listRow()]], detail({ submitted_by: "u-me" })));
    expect(await revenueForecastAdapter.list(ctx)).toEqual([]);
    roles = ["branch_head"];
    const { ctx: c2, calls } = fakeCtx({});
    expect(await revenueForecastAdapter.list(c2)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it("decide", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/finance/revenue-forecasts/f1/review": {} });
    await revenueForecastAdapter.decide(ctx, { id: "f1" }, "approve", "");
    await revenueForecastAdapter.decide(ctx, { id: "f1" }, "reject", "too high");
    expect(calls.map((c) => c.body)).toEqual([{ decision: "approved", note: null }, { decision: "rejected", note: "too high" }]);
  });
});
