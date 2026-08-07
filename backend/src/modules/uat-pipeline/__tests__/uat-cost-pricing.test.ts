/**
 * Cost accounting.
 *
 * The property worth defending: a price change must not retroactively alter what a historical
 * call cost. That is why the rate is resolved at call time and the amount is stored, rather
 * than recomputed on read — and why the daily cap sums stored amounts rather than re-pricing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../db/mysql.js";
import {
  checkDailyBudget,
  computeCostMicros,
  resolveRate,
  spendTodayMicros,
  type PricingRate,
} from "../uat-cost.service.js";

const mockQuery = db.query as unknown as ReturnType<typeof vi.fn>;

const OPUS: PricingRate = {
  id: "rate-1",
  inputUsdPerMTok: 5,
  outputUsdPerMTok: 25,
  cacheReadMultiplier: 0.1,
};

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue([[], []]);
});

describe("computeCostMicros", () => {
  it("prices input and output at their separate rates", () => {
    // 1M input at $5 + 1M output at $25 = $30 = 30,000,000 micros.
    expect(computeCostMicros({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, OPUS)).toBe(
      30_000_000
    );
  });

  it("ADDS cache reads rather than subtracting them from input", () => {
    // Anthropic reports cache_read_input_tokens as a separate figure, not as a subset of
    // input_tokens. Treating it as a subset understates every cached call — which is most of
    // them, since the checklist prefix is deliberately cacheable.
    const uncached = computeCostMicros({ inputTokens: 1_000_000, outputTokens: 0 }, OPUS);
    const withCache = computeCostMicros(
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000 },
      OPUS
    );
    expect(withCache).toBeGreaterThan(uncached);
    // The cached million costs a tenth of the uncached million.
    expect(withCache - uncached).toBe(500_000);
  });

  it("charges cache reads at the multiplier, not the full input rate", () => {
    expect(computeCostMicros({ cacheReadTokens: 1_000_000 }, OPUS)).toBe(500_000);
  });

  it("returns an integer, so a sum over thousands of rows carries no float drift", () => {
    const c = computeCostMicros({ inputTokens: 1234, outputTokens: 567, cacheReadTokens: 89 }, OPUS);
    expect(Number.isInteger(c)).toBe(true);
  });

  it("treats missing and negative token counts as zero rather than throwing", () => {
    expect(computeCostMicros({}, OPUS)).toBe(0);
    expect(computeCostMicros({ inputTokens: -5, outputTokens: -5 }, OPUS)).toBe(0);
  });
});

describe("resolveRate", () => {
  it("picks the most recent effective_from when two rows overlap", async () => {
    // A price correction entered without closing the previous row leaves two matching rows.
    // ORDER BY effective_from DESC is what makes that answer the one a human would give,
    // rather than an arbitrary row.
    mockQuery.mockResolvedValueOnce([
      [
        {
          id: "newer",
          input_usd_per_mtok: "6.0000",
          output_usd_per_mtok: "30.0000",
          cache_read_multiplier: "0.1000",
        },
      ],
      [],
    ]);
    const rate = await resolveRate("claude", "claude-opus-5");
    expect(rate?.id).toBe("newer");
    expect(rate?.inputUsdPerMTok).toBe(6);

    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/ORDER BY effective_from DESC/);
    expect(sql).toMatch(/effective_from <= NOW\(\)/);
    expect(sql).toMatch(/effective_to IS NULL OR effective_to > NOW\(\)/);
  });

  it("returns null for an unpriced model rather than pretending it is free", async () => {
    // A zero here would mean the daily cap never trips for that model — the one situation
    // where a spend limit most needs to work.
    mockQuery.mockResolvedValueOnce([[], []]);
    expect(await resolveRate("claude", "some-unlisted-model")).toBeNull();
  });

  it("coerces DECIMAL columns, which mysql2 returns as strings", async () => {
    mockQuery.mockResolvedValueOnce([
      [
        {
          id: "r",
          input_usd_per_mtok: "5.0000",
          output_usd_per_mtok: "25.0000",
          cache_read_multiplier: "0.1000",
        },
      ],
      [],
    ]);
    const rate = await resolveRate("claude", "claude-opus-5");
    // Without Number(), "5.0000" * tokens is NaN and every cost silently becomes null.
    expect(typeof rate?.inputUsdPerMTok).toBe("number");
    expect(computeCostMicros({ inputTokens: 1_000_000 }, rate!)).toBe(5_000_000);
  });
});

describe("checkDailyBudget", () => {
  it("sums STORED amounts, so a later price edit cannot move historical spend", async () => {
    mockQuery.mockResolvedValueOnce([[{ total: 1_500_000 }], []]);
    const sql = async () => {
      const v = await checkDailyBudget(25);
      return v;
    };
    const verdict = await sql();
    expect(verdict.spentUsd).toBe(1.5);
    expect(verdict.allowed).toBe(true);
    // It reads cost_usd_micros directly — no join to the pricing table on read.
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/SUM\(cost_usd_micros\)/);
    expect(String(mockQuery.mock.calls[0][0])).not.toMatch(/uat_model_pricing/);
  });

  it("refuses once spend reaches the cap", async () => {
    mockQuery.mockResolvedValueOnce([[{ total: 25_000_000 }], []]);
    const verdict = await checkDailyBudget(25);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/budget exhausted/i);
  });

  it("refuses everything when the cap is zero — a cap of zero is not 'unlimited'", async () => {
    mockQuery.mockResolvedValueOnce([[{ total: 0 }], []]);
    const verdict = await checkDailyBudget(0);
    expect(verdict.allowed).toBe(false);
  });

  it("treats an empty table as zero spend, not as an error", async () => {
    mockQuery.mockResolvedValueOnce([[{ total: 0 }], []]);
    expect(await spendTodayMicros()).toBe(0);
  });
});
