import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Revenue forecast lifecycle on real SQL (in-memory SQLite; skipped on Node < 22.5):
 * draft -> submit -> Finance Head + Payroll Head approve (OPEN, counted by the P&L) -> close with
 * actuals (CLOSED, closed amount counted) -> Finance Head reopen; and the rejection loop.
 */
type Sqlite = { exec(sql: string): void; prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): { changes: number } } };
let sqlite: Sqlite | null = null;
try {
  const mod = await import("node:sqlite" as string);
  sqlite = new mod.DatabaseSync(":memory:") as Sqlite;
} catch {
  sqlite = null;
}

function run(sql: string, params: unknown[] = []): unknown {
  const db = sqlite!;
  if (/information_schema\.tables/i.test(sql)) {
    return db.prepare(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?`).all(String(params[0]));
  }
  const text = sql.replace(/\s+FOR UPDATE\b/gi, "").replace(/\bNOW\(\)/g, "CURRENT_TIMESTAMP");
  const p = params.map((v) => (v === undefined ? null : v));
  if (/^\s*SELECT/i.test(text)) return db.prepare(text).all(...p);
  return { affectedRows: db.prepare(text).run(...p).changes };
}

const { execute, inbox } = vi.hoisted(() => ({ execute: vi.fn(), inbox: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute, query: execute,
    getConnection: async () => ({
      execute, beginTransaction: async () => sqlite!.exec("BEGIN"), commit: async () => sqlite!.exec("COMMIT"),
      rollback: async () => sqlite!.exec("ROLLBACK"), release: () => undefined,
    }),
  },
}));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem: inbox } }));
vi.mock("../../../shared/recipient-resolver.js", () => ({ resolveRoleHolderUserIds: async (role: string) => [`${role}-user`] }));
vi.mock("../../../shared/istDate.js", async (orig) => ({ ...(await orig<typeof import("../../../shared/istDate.js")>()), getCurrentDateIST: () => "2026-10-06" }));

const SCHEMA = `
CREATE TABLE branch_master (id TEXT PRIMARY KEY, branch_name TEXT);
CREATE TABLE cost_centre_master (id TEXT PRIMARY KEY, cost_centre_code TEXT, cost_centre_name TEXT, company_name TEXT, branch_id TEXT, active_status INT);
CREATE TABLE revenue_forecast (id TEXT PRIMARY KEY, branch_id TEXT, cost_centre_id TEXT, period_code TEXT, status TEXT DEFAULT 'draft',
  forecast_amount REAL DEFAULT 0, closed_amount REAL, notes TEXT,
  finance_head_status TEXT DEFAULT 'pending', finance_head_by TEXT, finance_head_at TEXT, finance_head_note TEXT,
  payroll_head_status TEXT DEFAULT 'pending', payroll_head_by TEXT, payroll_head_at TEXT, payroll_head_note TEXT,
  submitted_by TEXT, submitted_at TEXT, approved_at TEXT, closed_by TEXT, closed_at TEXT, close_note TEXT,
  reopened_by TEXT, reopened_at TEXT, reopen_reason TEXT, created_by TEXT, UNIQUE (cost_centre_id, period_code));
CREATE TABLE revenue_forecast_line (id TEXT PRIMARY KEY, forecast_id TEXT, line_no INT, line_type TEXT, description TEXT, metric_key TEXT,
  quantity REAL, rate REAL, amount REAL, actual_quantity REAL, actual_rate REAL, actual_amount REAL);
INSERT INTO branch_master VALUES ('B1','NOIDA-2');
INSERT INTO cost_centre_master VALUES ('cc1','BSS/IB/NOIDA/1','Inbound','Mas Callnet India Pvt Ltd','B1',1),
  ('cc2','BSS/IB/NOIDA/2','Outbound','Mas Callnet India Pvt Ltd','B1',1),
  ('ccX','OTHER/1','Other co','Somebody Else Ltd','B1',1);
`;

beforeAll(() => {
  if (!sqlite) return;
  sqlite.exec(SCHEMA);
  execute.mockImplementation(async (sql: string, params?: unknown[]) => [run(String(sql), params ?? []), []]);
});

const LINES = [
  { lineType: "seat", description: "Inbound seats @ 25,000", quantity: 10, rate: 25000 },
  { lineType: "seat", description: "Inbound seats @ 22,000", quantity: 4, rate: 22000 },
  { lineType: "metric", description: "Talk time", metricKey: "talk_minutes", quantity: 20000, rate: 2.5 },
  { lineType: "reward", description: "SLA reward", amount: 15000 },
  { lineType: "penalty", description: "AHT penalty", amount: 5000 },
] as const;
// 250000 + 88000 + 50000 + 15000 - 5000
const TOTAL = 398000;

describe("line arithmetic and due date", () => {
  it("seat/metric = qty x rate, reward positive, penalty always negative", async () => {
    const { lineAmount } = await import("../revenue-forecast.service.js");
    expect(lineAmount({ lineType: "seat", quantity: 10, rate: 25000 })).toBe(250000);
    expect(lineAmount({ lineType: "metric", quantity: 20000, rate: 2.5 })).toBe(50000);
    expect(lineAmount({ lineType: "reward", amount: -15000 })).toBe(15000);
    expect(lineAmount({ lineType: "penalty", amount: 5000 })).toBe(-5000);
    expect(lineAmount({ lineType: "penalty", quantity: 2, rate: 1000 })).toBe(-2000);
    expect(() => lineAmount({ lineType: "seat", quantity: 10 })).toThrow(/quantity and a rate/);
    expect(() => lineAmount({ lineType: "fixed" })).toThrow(/amount/);
  });
  it("due on the 26th of the month before (January -> 26 Dec)", async () => {
    const { forecastDueDate } = await import("../revenue-forecast.service.js");
    expect(forecastDueDate("2026-11")).toBe("2026-10-26");
    expect(forecastDueDate("2027-01")).toBe("2026-12-26");
  });
});

describe.skipIf(!sqlite)("draft -> two approvals -> open -> close -> reopen", () => {
  let id = "";
  it("saves a draft with several seat rates, a metric line, reward and penalty", async () => {
    const { revenueForecastService } = await import("../revenue-forecast.service.js");
    const f = await revenueForecastService.saveDraft({ costCentreId: "cc1", branchId: "B1", period: "2026-11", lines: [...LINES] as any }, "bh-1");
    id = String(f.id);
    expect(f.status).toBe("draft");
    expect(Number(f.forecast_amount)).toBe(TOTAL);
    expect(f.lines.map((l: any) => Number(l.amount))).toEqual([250000, 88000, 50000, 15000, -5000]);
  });

  it("refuses a past month", async () => {
    const { revenueForecastService } = await import("../revenue-forecast.service.js");
    await expect(revenueForecastService.saveDraft({ costCentreId: "cc1", branchId: "B1", period: "2026-09", lines: [...LINES] as any }, "bh-1")).rejects.toThrow(/current or a future month/);
  });

  it("lists every MAS cost centre for the month, the missing one as missing", async () => {
    const { revenueForecastService } = await import("../revenue-forecast.service.js");
    const out = await revenueForecastService.list("2026-11", ["B1"]);
    expect(out.dueDate).toBe("2026-10-26");
    expect(out.rows.map((r) => [r.costCentreId, r.status])).toEqual([["cc1", "draft"], ["cc2", "missing"]]);
  });

  it("submit notifies both heads; one approval is not enough; both make it OPEN", async () => {
    const { revenueForecastService, getForecastRevenueByCostCentre } = await import("../revenue-forecast.service.js");
    await revenueForecastService.submit(id, "bh-1");
    expect(inbox.mock.calls.map((c) => c[0].user_id).sort()).toEqual(["finance_head-user", "payroll_head-user"]);
    await expect(revenueForecastService.review(id, "finance_head", "approved", null, "bh-1")).rejects.toThrow(/you submitted/);
    let f = await revenueForecastService.review(id, "finance_head", "approved", null, "fh-1");
    expect(f.status).toBe("submitted");
    expect((await getForecastRevenueByCostCentre("2026-11")).size).toBe(0);
    await expect(revenueForecastService.review(id, "finance_head", "approved", null, "fh-1")).rejects.toThrow(/already been given/);
    f = await revenueForecastService.review(id, "payroll_head", "approved", null, "ph-1");
    expect(f.status).toBe("approved");
    expect((await getForecastRevenueByCostCentre("2026-11")).get("cc1")).toEqual({ amount: TOTAL, forecastAmount: TOTAL, state: "OPEN" });
  });

  it("an open forecast cannot be edited", async () => {
    const { revenueForecastService } = await import("../revenue-forecast.service.js");
    await expect(revenueForecastService.saveDraft({ costCentreId: "cc1", branchId: "B1", period: "2026-11", lines: [...LINES] as any }, "bh-1")).rejects.toThrow(/no longer be edited/);
  });

  it("close with actuals: the P&L switches to the closed amount, variance visible", async () => {
    const { revenueForecastService, getForecastRevenueByCostCentre } = await import("../revenue-forecast.service.js");
    const f0 = await revenueForecastService.get(id);
    const actuals = f0.lines.map((l: any) => ({ lineId: l.id, actualQuantity: l.quantity, actualRate: l.rate, actualAmount: l.amount }));
    actuals[0].actualQuantity = 9; // one seat fewer billed
    const f = await revenueForecastService.close(id, actuals, "Invoiced", "bh-1");
    expect(f.status).toBe("closed");
    expect(Number(f.closed_amount)).toBe(TOTAL - 25000);
    expect((await getForecastRevenueByCostCentre("2026-11")).get("cc1")).toEqual({ amount: TOTAL - 25000, forecastAmount: TOTAL, state: "CLOSED" });
    const row = (await revenueForecastService.list("2026-11", null)).rows.find((r) => r.costCentreId === "cc1")!;
    expect(row.variance).toBe(-25000);
    expect(row.pnlBasis).toBe("CLOSED");
  });

  it("Finance Head reopen puts it back to OPEN", async () => {
    const { revenueForecastService, getForecastRevenueByCostCentre } = await import("../revenue-forecast.service.js");
    await expect(revenueForecastService.reopen(id, "", "fh-1")).rejects.toThrow(/reason/);
    const f = await revenueForecastService.reopen(id, "Credit note received", "fh-1");
    expect(f.status).toBe("approved");
    expect((await getForecastRevenueByCostCentre("2026-11")).get("cc1")?.state).toBe("OPEN");
  });
});

describe.skipIf(!sqlite)("rejection loop", () => {
  it("either head rejecting sends it back; resubmission needs both approvals again", async () => {
    const { revenueForecastService } = await import("../revenue-forecast.service.js");
    const f = await revenueForecastService.saveDraft({ costCentreId: "cc2", branchId: "B1", period: "2026-11", lines: [LINES[0]] as any }, "bh-1");
    const id = String(f.id);
    await revenueForecastService.submit(id, "bh-1");
    await revenueForecastService.review(id, "finance_head", "approved", null, "fh-1");
    await expect(revenueForecastService.review(id, "payroll_head", "rejected", "", "ph-1")).rejects.toThrow(/reason/);
    let after = await revenueForecastService.review(id, "payroll_head", "rejected", "Seat count too high", "ph-1");
    expect(after.status).toBe("rejected");
    after = await revenueForecastService.saveDraft({ costCentreId: "cc2", branchId: "B1", period: "2026-11", lines: [{ ...LINES[0], quantity: 8 }] as any }, "bh-1");
    expect(Number(after.forecast_amount)).toBe(200000);
    after = await revenueForecastService.submit(id, "bh-1");
    expect([after.status, after.finance_head_status, after.payroll_head_status]).toEqual(["submitted", "pending", "pending"]);
  });
});
