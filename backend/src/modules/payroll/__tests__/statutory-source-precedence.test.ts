import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which table the payable payroll run reads its statutory rates from.
 *
 * statutory_config_version is authoritative wherever it can be read: it is the
 * only one that can hold two financial years at once, and the only one that
 * records approval. The charter requires payable figures to rest on approved
 * effective-dated configuration, so an unapproved row there is a proposal and
 * must not reach a payslip.
 *
 * The subtle case — and the one worth pinning — is the difference between
 * "versioning is not deployed here" and "versioning is deployed and says a key
 * is missing". The first is a deployment gap and falls back to the flat table,
 * which is what payroll read before versioning existed. The second is a real
 * configuration gap and must NOT fall back, or approval becomes bypassable by
 * simply leaving a key out of the versioned table.
 */

const { getStatutoryConfigForPeriod, loadFlatStatutoryConfig } = vi.hoisted(() => ({
  getStatutoryConfigForPeriod: vi.fn(),
  loadFlatStatutoryConfig: vi.fn(),
}));
vi.mock("../statutory-config.resolver.js", () => ({ getStatutoryConfigForPeriod }));
vi.mock("../statutory-config.loader.js", () => ({ loadFlatStatutoryConfig }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(), getConnection: vi.fn() } }));

// The real function the payable run calls, not a restatement of it — so a change
// to the call site is caught here rather than passing silently.
import { resolveStatutoryConfigForRun as resolveStatConfig } from "../payrollCalculate.service.js";

describe("statutory source precedence for a payable run", () => {
  beforeEach(() => {
    getStatutoryConfigForPeriod.mockReset();
    loadFlatStatutoryConfig.mockReset();
  });

  it("prefers the versioned table when it is readable", async () => {
    getStatutoryConfigForPeriod.mockResolvedValue({
      period: "2026-07", source: "versioned", missing: [],
      values: { tds_cess_pct: 4, tds_standard_deduction: 75000 },
    });

    const config = await resolveStatConfig("2026-07");

    expect(config).toEqual({ tds_cess_pct: 4, tds_standard_deduction: 75000 });
    // The flat table must not even be consulted, or a stale row there could
    // shadow an approved version.
    expect(loadFlatStatutoryConfig).not.toHaveBeenCalled();
  });

  it("does NOT fall back when the versioned table is readable but incomplete", async () => {
    // The rule that makes approval mean something. Falling back here would let
    // anyone bypass the approval gate by omitting a key from the versioned
    // table — the flat row would quietly supply it instead.
    getStatutoryConfigForPeriod.mockResolvedValue({
      period: "2026-07", source: "versioned",
      missing: ["tds_slab_2400001_above"],
      values: { tds_cess_pct: 4 },
    });

    const config = await resolveStatConfig("2026-07");

    expect(loadFlatStatutoryConfig).not.toHaveBeenCalled();
    // The gap survives into calculateTds, which reports pending_configuration
    // naming the key, and the run stops rather than under-deducting.
    expect("tds_slab_2400001_above" in config).toBe(false);
  });

  it("falls back to the flat table where migration 1030 has not been applied", async () => {
    // A deployment gap, not a licence to relax: the flat loader still filters
    // is_active and effective_from, so this is the same period-resolved reading
    // payroll used before versioning existed — never a hardcoded rate.
    getStatutoryConfigForPeriod.mockResolvedValue({
      period: "2026-07", source: "unavailable", missing: ["tds_cess_pct"], values: {},
    });
    loadFlatStatutoryConfig.mockResolvedValue({ tds_cess_pct: 4, pf_employee_pct: 12 });

    const config = await resolveStatConfig("2026-07");

    expect(loadFlatStatutoryConfig).toHaveBeenCalledWith("2026-07");
    expect(config).toEqual({ tds_cess_pct: 4, pf_employee_pct: 12 });
  });

  it("resolves for the run's own month, never for today", async () => {
    // Recalculating an earlier month must apply the rates that governed it, or
    // a reissued payslip disagrees with what was deducted and filed.
    getStatutoryConfigForPeriod.mockResolvedValue({
      period: "2025-06", source: "versioned", missing: [], values: { tds_cess_pct: 4 },
    });

    await resolveStatConfig("2025-06");

    expect(getStatutoryConfigForPeriod).toHaveBeenCalledWith("2025-06");
  });
});
