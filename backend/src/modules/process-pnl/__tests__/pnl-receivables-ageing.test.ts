import { beforeEach, describe, expect, it, vi } from "vitest";

/** P&L receivables ageing reads MAS Callnet bills only. */
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { query, execute: query } }));

import { getReceivablesAgeing } from "../pnl-receivables-ageing.service.js";

beforeEach(() => {
  query.mockReset().mockResolvedValue([[
    { processId: "p1", processName: "Inbound", amount: "1000", daysSinceInvoice: 10 },
    { processId: "p1", processName: "Inbound", amount: "500", daysSinceInvoice: 95 },
  ], []]);
});

describe("getReceivablesAgeing", () => {
  it("filters to MAS cost centres, keeping branch / process filters and their params", async () => {
    const r = await getReceivablesAgeing({ branchId: "b1", processId: "p1" });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name, ''))");
    expect(sql).toContain("mascallnet");
    expect(sql).toContain("AND ccm.branch_id = ?");
    expect(sql).toContain("AND pm.id = ?");
    expect(params).toEqual(["b1", "p1"]);
    expect(r.grandTotal).toBe(1500);
    expect(r.totals).toMatchObject({ "0-30": 1000, "90+": 500 });
  });
});
