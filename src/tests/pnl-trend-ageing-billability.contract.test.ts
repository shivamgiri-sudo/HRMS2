import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lightweight source-contract tests for the three additions built 2026-09-10:
 * revenue/cost/margin + headcount trend, receivables ageing, seat billability.
 * Follows the same read-the-source-text convention as process-pnl-page.contract.test.tsx
 * rather than mounting components, matching this repo's existing test style for this page.
 */

const trendHook = readFileSync(resolve(process.cwd(), "src/hooks/usePnlTrend.ts"), "utf8");
const ageingHook = readFileSync(resolve(process.cwd(), "src/hooks/usePnlReceivablesAgeing.ts"), "utf8");
const seatHook = readFileSync(resolve(process.cwd(), "src/hooks/usePnlSeatBillability.ts"), "utf8");
const trendChart = readFileSync(resolve(process.cwd(), "src/components/finance/pnl/PnlTrendCharts.tsx"), "utf8");
const ageingPanel = readFileSync(resolve(process.cwd(), "src/components/finance/pnl/PnlReceivablesAgeingPanel.tsx"), "utf8");
const seatPanel = readFileSync(resolve(process.cwd(), "src/components/finance/pnl/PnlSeatBillabilityPanel.tsx"), "utf8");
const pageSource = readFileSync(resolve(process.cwd(), "src/pages/finance/ProcessPnlPage.tsx"), "utf8");
const routesSource = readFileSync(
  resolve(process.cwd(), "backend/src/modules/process-pnl/process-pnl.routes.ts"),
  "utf8",
);

describe("pnl trend hook + chart", () => {
  it("hits the trend endpoint", () => {
    expect(trendHook).toContain("/api/finance/pnl/trend");
  });

  it("defaults to a real trailing-12-month window, not the full multi-year dump", () => {
    // 2026-09-11 restructure: the default chart must show exactly the trailing 12 real calendar
    // months from today (mas_hrms live months backfilled with real db_bill months), with the full
    // multi-year history and YoY reachable behind an explicit toggle — never loaded by default.
    expect(trendChart).toContain("lastNPeriods(12)");
    expect(trendChart).toContain("trailing12");
    expect(trendChart).toContain("showFullHistory");
    expect(trendChart).toContain("data.realMonths");
    expect(trendChart).toContain("spanLabel(");
  });

  it("shows an explicit empty state instead of fabricating months", () => {
    expect(trendChart).toContain("No month has enough real billing rows yet");
  });
});

describe("pnl trend db_bill history + YoY (2026-09-10 extension)", () => {
  const historyService = readFileSync(
    resolve(process.cwd(), "backend/src/modules/process-pnl/pnl-trend-history.service.ts"),
    "utf8",
  );
  const trendService = readFileSync(
    resolve(process.cwd(), "backend/src/modules/process-pnl/pnl-trend.service.ts"),
    "utf8",
  );

  it("sources db_bill revenue from tbl_invoice.total (GST-net), not grnd (GST-inclusive)", () => {
    expect(historyService).toContain("FROM tbl_invoice");
    expect(historyService).toContain("SUM(total) AS revenue");
    expect(historyService).not.toContain("SUM(grnd)");
  });

  it("excludes status=1 invoices with a documented reason", () => {
    expect(historyService).toContain("WHERE status = 0");
  });

  it("stops db_bill history strictly before the live mas_hrms era to avoid double counting", () => {
    expect(historyService).toContain("MAS_HRMS_ERA_STARTS_AT");
    expect(trendService).toContain("getDbBillHistory(new Set(realMonths))");
  });

  it("tags every merged month with its source so the UI can render eras distinctly", () => {
    expect(trendService).toContain('source: "mas_hrms"');
    expect(historyService).toContain('source: "db_bill"');
    expect(trendChart).toContain('src === "db_bill"');
  });

  it("renders the legacy-data caveat note and a YoY chart when the data supports it", () => {
    expect(trendChart).toContain("Historical data note");
    expect(trendChart).toContain("legacy db_bill system");
    expect(trendChart).toContain("PnlYoyChart");
    expect(trendChart).toContain("Year-over-year cumulative profit");
  });

  it("does not attempt a per-process COST breakdown for the unreliable cost_centre_master mapping", () => {
    expect(historyService).toContain("COMPANY-GRAIN ONLY");
  });

  it("2026-09-11: builds a per-process REVENUE breakdown from tbl_invoice.cost_process directly", () => {
    // Re-investigated harder: cost_centre_master.process_id is too sparse (47/941), but
    // tbl_invoice.cost_process sits on the invoice row itself and matches process_master.process_name
    // directly for the large majority of rows — see getDbBillHistoryByProcess's doc comment.
    expect(historyService).toContain("getDbBillHistoryByProcess");
    expect(historyService).toContain("cost_process");
    expect(trendService).toContain("getDbBillHistoryByProcess");
    expect(trendService).toContain("processHistoryRevenue");
  });
});

describe("pnl receivables ageing hook + panel", () => {
  it("hits the receivables-ageing endpoint", () => {
    expect(ageingHook).toContain("/api/finance/pnl/receivables-ageing");
  });

  it("labels buckets by days since invoice, never as days overdue", () => {
    expect(ageingPanel).toContain("not days overdue");
  });

  it("always renders the data-quality caveat as a visible badge", () => {
    expect(ageingPanel).toContain("data.caveat");
    expect(ageingPanel).toContain("Data quality unconfirmed");
  });
});

describe("pnl seat billability hook + panel", () => {
  it("hits the seat-billability endpoint", () => {
    expect(seatHook).toContain("/api/finance/pnl/seat-billability");
  });

  it("flags cost centres with no mandated seats instead of showing a fabricated 0%", () => {
    expect(seatPanel).toContain("Not configured");
    expect(seatPanel).toContain('seatConfigStatus === "not_configured"');
  });
});

describe("ProcessPnlPage wiring", () => {
  it("mounts all three new panels", () => {
    expect(pageSource).toContain("<PnlTrendCharts");
    expect(pageSource).toContain("<PnlReceivablesAgeingPanel");
    expect(pageSource).toContain("<PnlSeatBillabilityPanel");
  });
});

describe("backend routes for trend/ageing/seat-billability", () => {
  it("registers all three GET routes under /pnl (inherits PNL_READ_ROLES gate)", () => {
    expect(routesSource).toContain('router.get("/pnl/trend"');
    expect(routesSource).toContain('router.get("/pnl/receivables-ageing"');
    expect(routesSource).toContain('router.get("/pnl/seat-billability"');
  });
});
