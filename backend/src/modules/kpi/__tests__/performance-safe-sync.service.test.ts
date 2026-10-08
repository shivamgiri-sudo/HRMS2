import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  previewPerformanceSources,
  syncAprMetrics,
  syncConversionMetrics,
  syncQualityMetrics,
  syncSalesBrandMisMetrics,
  syncSalesOrderMetrics,
} = vi.hoisted(() => ({
  previewPerformanceSources: vi.fn(),
  syncAprMetrics: vi.fn(),
  syncConversionMetrics: vi.fn(),
  syncQualityMetrics: vi.fn(),
  syncSalesBrandMisMetrics: vi.fn(),
  syncSalesOrderMetrics: vi.fn(),
}));

vi.mock("../performance-source-preview.service.js", () => ({
  previewPerformanceSources,
}));

vi.mock("../kpi-data-connector.service.js", () => ({
  syncAprMetrics,
  syncConversionMetrics,
  syncQualityMetrics,
  syncSalesBrandMisMetrics,
  syncSalesOrderMetrics,
}));

import {
  parseSafeSyncSources,
  resolveSafeSyncInput,
  runSafePerformanceSyncRange,
  runSafePerformanceSync,
} from "../performance-safe-sync.service.js";

describe("performance-safe-sync.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to fast, production-safe sources and excludes slow dialer APR", () => {
    expect(parseSafeSyncSources()).toEqual(["quality", "conversion", "salesBrandMis", "salesOrders"]);
  });

  it("rejects unknown source names before any sync can run", () => {
    expect(() => parseSafeSyncSources("quality,badSource")).toThrow("Invalid source(s): badSource");
  });

  it("validates date input and resolves year month", () => {
    expect(resolveSafeSyncInput({ date: "2026-07-02", sources: "quality,quality,salesOrders" })).toMatchObject({
      date: "2026-07-02",
      yearMonth: "2026-07",
      sources: ["quality", "salesOrders"],
      apply: false,
    });
    expect(() => resolveSafeSyncInput({ date: "02-07-2026" })).toThrow("Invalid --date");
  });

  it("dry-runs selected sources through preview without calling sync writers", async () => {
    previewPerformanceSources.mockResolvedValueOnce({
      sources: {
        apr: { key: "apr" },
        quality: { key: "quality", sourceRows: 2 },
        conversion: { key: "conversion", sourceRows: 1 },
        salesBrandMis: { key: "salesBrandMis", sourceRows: 3 },
        salesOrders: { key: "salesOrders", sourceRows: 4 },
      },
    });

    const result = await runSafePerformanceSync({
      date: "2026-07-02",
      sources: "quality,salesOrders",
    });

    expect(result).toMatchObject({
      mode: "dry-run",
      sources: ["quality", "salesOrders"],
      note: "Dry run only. No KPI facts were written.",
    });
    expect(Object.keys(result.results)).toEqual(["quality", "salesOrders"]);
    expect(previewPerformanceSources).toHaveBeenCalledWith({ date: "2026-07-02", yearMonth: "2026-07" });
    expect(syncQualityMetrics).not.toHaveBeenCalled();
    expect(syncSalesOrderMetrics).not.toHaveBeenCalled();
  });

  it("applies only explicitly selected source syncs", async () => {
    syncQualityMetrics.mockResolvedValueOnce({ synced: 43, skipped: 2, errors: [] });
    syncSalesOrderMetrics.mockResolvedValueOnce({ synced: 11, skipped: 2, errors: [] });

    const result = await runSafePerformanceSync({
      date: "2026-07-02",
      yearMonth: "2026-07",
      sources: "quality,salesOrders",
      apply: true,
    });

    expect(result.mode).toBe("apply");
    expect(result.results).toEqual({
      quality: { synced: 43, skipped: 2, errors: [] },
      salesOrders: { synced: 11, skipped: 2, errors: [] },
    });
    expect(syncQualityMetrics).toHaveBeenCalledWith("2026-07");
    expect(syncSalesOrderMetrics).toHaveBeenCalledWith("2026-07-02");
    expect(syncAprMetrics).not.toHaveBeenCalled();
    expect(syncConversionMetrics).not.toHaveBeenCalled();
    expect(syncSalesBrandMisMetrics).not.toHaveBeenCalled();
  });

  it("applies date ranges daily but runs monthly quality only once", async () => {
    syncQualityMetrics.mockResolvedValueOnce({ synced: 43, skipped: 2, errors: [] });
    syncConversionMetrics.mockResolvedValue({ synced: 10, skipped: 0, errors: [] });
    syncSalesBrandMisMetrics.mockResolvedValue({ synced: 8, skipped: 1, errors: [] });
    syncSalesOrderMetrics.mockResolvedValue({ synced: 11, skipped: 2, errors: [] });

    const result = await runSafePerformanceSyncRange({
      from: "2026-07-01",
      to: "2026-07-03",
      sources: "quality,conversion,salesBrandMis,salesOrders",
      apply: true,
    });

    expect(result).toMatchObject({
      from: "2026-07-01",
      to: "2026-07-03",
      mode: "apply",
      dates: ["2026-07-01", "2026-07-02", "2026-07-03"],
    });
    expect(syncQualityMetrics).toHaveBeenCalledTimes(1);
    expect(syncQualityMetrics).toHaveBeenCalledWith("2026-07");
    expect(syncConversionMetrics).toHaveBeenCalledTimes(3);
    expect(syncSalesBrandMisMetrics).toHaveBeenCalledTimes(3);
    expect(syncSalesOrderMetrics).toHaveBeenCalledTimes(3);
    expect(syncAprMetrics).not.toHaveBeenCalled();
  });
});
