import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A duplicated tax band is charged twice, and the result looks entirely plausible.
 *
 * calculateSlabTax sums every row getSlabs hands it. payroll_tax_slab_master has no unique key
 * on (financial_year, regime, slab_from), and verified live on 2026-08-16 every FY2026-27 band
 * is present twice. So the engine would have computed exactly 2x the correct tax and returned a
 * clean number with no warning - at Rs 15L taxable, Rs 195,000 against a correct Rs 97,500.
 *
 * Latent rather than realised: tds_mode is 'manual' on all 66 runs ever created and the auto
 * path is gated on 'auto', so no employee has been over-taxed. But taxEngine.service is imported
 * by the CANONICAL calculator (payroll/payrollCalculate.service.ts:18), not only by the dead
 * payroll-compliance one - so the first run created with tds_mode='auto' would hit it.
 *
 * The fix refuses rather than deduplicating. The duplicate rows are not guaranteed to agree on
 * rate_pct or slab_to, so silently picking one would trade a visible doubling for an invisible
 * wrong rate. That matches how this file already treats a missing slab set: throw, never guess.
 */

const { mockExecute } = vi.hoisted(() => ({ mockExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: mockExecute } }));

const { taxEngineService } = await import("../taxEngine.service.js");

const slab = (from: number, to: number | null, rate: number) => ({
  slab_from: from,
  slab_to: to,
  rate_pct: rate,
});

beforeEach(() => mockExecute.mockReset());

describe("getSlabs refuses an ambiguous slab table", () => {
  it("throws when a band appears twice, naming the duplicated bands", async () => {
    mockExecute.mockResolvedValueOnce([[
      slab(0, 400000, 0),
      slab(0, 400000, 0),
      slab(400000, 800000, 5),
      slab(400000, 800000, 5),
    ]]);

    await expect(taxEngineService.getSlabs("2026-27", "new" as never)).rejects.toMatchObject({
      statusCode: 409,
      code: "TAX_SLABS_AMBIGUOUS",
    });
  });

  it("names the financial year and regime, so the row to deactivate is findable", async () => {
    mockExecute.mockResolvedValueOnce([[slab(0, 400000, 0), slab(0, 400000, 0)]]);
    await expect(taxEngineService.getSlabs("2026-27", "new" as never)).rejects.toThrow(
      /financial year 2026-27, new regime/
    );
  });

  it("catches a duplicate that disagrees on rate — the case dedup would have hidden", async () => {
    // If the two rows differ, silently keeping one is a wrong rate nobody can see.
    mockExecute.mockResolvedValueOnce([[slab(400000, 800000, 5), slab(400000, 800000, 10)]]);
    await expect(taxEngineService.getSlabs("2026-27", "new" as never)).rejects.toMatchObject({
      code: "TAX_SLABS_AMBIGUOUS",
    });
  });

  it("passes a clean slab table straight through", async () => {
    const clean = [slab(0, 400000, 0), slab(400000, 800000, 5), slab(800000, null, 20)];
    mockExecute.mockResolvedValueOnce([clean]);
    await expect(taxEngineService.getSlabs("2026-27", "new" as never)).resolves.toHaveLength(3);
  });

  it("still throws its original error when no slabs exist at all", async () => {
    mockExecute.mockResolvedValueOnce([[]]);
    await expect(taxEngineService.getSlabs("2026-27", "new" as never)).rejects.toThrow(
      /No approved tax slabs/
    );
  });
});

describe("the canonical calculator propagates the refusal instead of silently falling back", () => {
  // payrollCalculate.service.ts wrapped the call to taxEngineService.calculateMonthlyTds in a
  // bare `catch {}` with no error inspection, framed as "fall back when the taxEngine tables are
  // unavailable." That catch does not distinguish "tables unavailable" from "tables available but
  // ambiguous" — it swallowed TAX_SLABS_AMBIGUOUS exactly the same as a real outage, and fell
  // through to a DIFFERENT calculator (calculateTds, reading statutory_config instead of
  // payroll_tax_slab_master). The duplicate-slab guard above exists specifically to stop a run
  // rather than compute a doubled tax; a bare catch after it defeated the entire point.
  //
  // Source-text, not a functional import: payrollCalculate.service.ts is the full per-employee
  // calculation pipeline (attendance, LWP, components, statutory deductions) with heavy DB
  // dependencies well beyond this one branch — mocking it wholesale to exercise a single catch
  // clause would risk pinning behaviour this file has no business asserting. This checks the one
  // thing that matters: the specific error code is inspected and re-thrown before the fallback
  // branch, not that the whole calculation runs correctly (that's payrollCalculate's own tests).
  const SOURCE = readFileSync(
    resolve(process.cwd(), "src/modules/payroll/payrollCalculate.service.ts"),
    "utf8",
  );

  it("checks for TAX_SLABS_AMBIGUOUS and re-throws before reaching the fallback calculator", () => {
    const catchAt = SOURCE.indexOf("} catch (err: unknown) {");
    const fallbackCommentAt = SOURCE.indexOf("Fallback to the synchronous engine");
    expect(catchAt, "the catch block was not found").toBeGreaterThan(-1);
    expect(fallbackCommentAt, "the fallback branch was not found").toBeGreaterThan(catchAt);

    const guardBlock = SOURCE.slice(catchAt, fallbackCommentAt);
    expect(guardBlock).toMatch(/code\s*===\s*"TAX_SLABS_AMBIGUOUS"/);
    expect(guardBlock).toMatch(/throw err;/);
  });

  it("no longer uses a bare catch that cannot distinguish the two failure modes", () => {
    expect(SOURCE).not.toMatch(/tdsMonthly = tdsResult\.tds_monthly;\s*\n\s*\} catch \{/);
  });
});

describe("why it matters: calculateSlabTax sums whatever it is given", () => {
  it("charges a duplicated band twice", () => {
    const correct = taxEngineService.calculateSlabTax(1_500_000, [
      slab(0, 400000, 0),
      slab(400000, 800000, 5),
      slab(800000, 1200000, 10),
      slab(1200000, null, 15),
    ] as never);

    const duplicated = taxEngineService.calculateSlabTax(1_500_000, [
      slab(0, 400000, 0),
      slab(0, 400000, 0),
      slab(400000, 800000, 5),
      slab(400000, 800000, 5),
      slab(800000, 1200000, 10),
      slab(800000, 1200000, 10),
      slab(1200000, null, 15),
      slab(1200000, null, 15),
    ] as never);

    // Exactly double — which is why the number looks reasonable and nothing flags it.
    expect(duplicated).toBe(correct * 2);
  });
});
