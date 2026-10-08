import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The nightly Studio computation.
 *
 * What is protected here is that it CANNOT write by accident. Computation fills
 * kpi_daily_actual — the table every KPI surface reads, and the one an
 * appraisal is drawn from — so a scheduled writer that starts on its own the
 * night it is deployed could rewrite everybody's scores from a half-configured
 * definition. Hence two switches: off entirely by default, and dry-run even
 * once enabled until someone says otherwise.
 */
const { computeStudioKpis, getStudioCapability } = vi.hoisted(() => ({
  computeStudioKpis: vi.fn(),
  getStudioCapability: vi.fn(),
}));
vi.mock("../../modules/kpi/kpi-studio.compute.js", () => ({ computeStudioKpis }));
vi.mock("../../modules/kpi/kpi-studio.service.js", () => ({ getStudioCapability }));

const worker = await import("../kpi-studio-compute.worker.js");

const OUTCOME = {
  date: "2026-09-06", definitions_considered: 2, employees_considered: 10,
  written: 5, no_data: 1, errors: 0, source_failures: [], sample: [],
};

const originalEnv = { ...process.env };

beforeEach(() => {
  computeStudioKpis.mockReset().mockResolvedValue(OUTCOME);
  getStudioCapability.mockReset().mockResolvedValue({
    tables: true, resolution: true, processGrain: true, fieldFilters: true,
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("the two switches", () => {
  it("is disabled unless explicitly enabled", () => {
    delete process.env.KPI_STUDIO_COMPUTE_ENABLED;
    expect(worker.isStudioComputeEnabled()).toBe(false);
  });

  it("treats any value other than 'true' as disabled", () => {
    process.env.KPI_STUDIO_COMPUTE_ENABLED = "1";
    expect(worker.isStudioComputeEnabled()).toBe(false);
    process.env.KPI_STUDIO_COMPUTE_ENABLED = "yes";
    expect(worker.isStudioComputeEnabled()).toBe(false);
    process.env.KPI_STUDIO_COMPUTE_ENABLED = "true";
    expect(worker.isStudioComputeEnabled()).toBe(true);
  });

  it("stays dry-run unless explicitly told otherwise", () => {
    delete process.env.KPI_STUDIO_COMPUTE_DRY_RUN;
    expect(worker.isStudioComputeDryRun()).toBe(true);
    process.env.KPI_STUDIO_COMPUTE_DRY_RUN = "true";
    expect(worker.isStudioComputeDryRun()).toBe(true);
    // Only this exact value releases the brake.
    process.env.KPI_STUDIO_COMPUTE_DRY_RUN = "false";
    expect(worker.isStudioComputeDryRun()).toBe(false);
  });
});

describe("runStudioCompute", () => {
  it("passes dryRun through, so an enabled worker still writes nothing by default", async () => {
    delete process.env.KPI_STUDIO_COMPUTE_DRY_RUN;
    await worker.runStudioCompute();
    expect(computeStudioKpis).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it("writes only when the dry-run brake is explicitly released", async () => {
    process.env.KPI_STUDIO_COMPUTE_DRY_RUN = "false";
    await worker.runStudioCompute();
    expect(computeStudioKpis).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }));
  });

  it("computes yesterday, never today", async () => {
    await worker.runStudioCompute();
    const { date } = computeStudioKpis.mock.calls[0][0];
    const expected = new Date();
    expected.setDate(expected.getDate() - 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(date).toBe(
      `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}`,
    );
  });

  it("computes exactly one day — never a range that would rewrite history", async () => {
    await worker.runStudioCompute();
    expect(computeStudioKpis).toHaveBeenCalledTimes(1);
    const options = computeStudioKpis.mock.calls[0][0];
    expect(options).not.toHaveProperty("from");
    expect(options).not.toHaveProperty("to");
  });

  it("does nothing when the Studio schema is not installed", async () => {
    getStudioCapability.mockResolvedValue({
      tables: false, resolution: false, processGrain: false, fieldFilters: false,
    });
    await worker.runStudioCompute();
    expect(computeStudioKpis).not.toHaveBeenCalled();
  });

  it("survives a compute failure instead of taking the process down", async () => {
    computeStudioKpis.mockRejectedValue(new Error("dialer unreachable"));
    await expect(worker.runStudioCompute()).resolves.toBeUndefined();
  });

  it("reports each unreachable source by name, not just an error count", async () => {
    const errorSpy = vi.spyOn(console, "error");
    computeStudioKpis.mockResolvedValue({
      ...OUTCOME,
      source_failures: [
        { source_code: "CLIENT_ORDERS", error: "connect ETIMEDOUT" },
        { source_code: "QA_SHEET", error: "404" },
      ],
    });
    await worker.runStudioCompute();
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(logged).toContain("CLIENT_ORDERS");
    expect(logged).toContain("QA_SHEET");
  });
});

describe("startWorker", () => {
  it("schedules nothing while disabled", () => {
    delete process.env.KPI_STUDIO_COMPUTE_ENABLED;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    worker.startKpiStudioComputeWorker();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    worker.stopKpiStudioComputeWorker();
  });

  it("schedules a first run when enabled", () => {
    process.env.KPI_STUDIO_COMPUTE_ENABLED = "true";
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    worker.startKpiStudioComputeWorker();
    expect(setTimeoutSpy).toHaveBeenCalled();
    worker.stopKpiStudioComputeWorker();
  });
});
