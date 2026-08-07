/**
 * Cost accounting for LLM calls.
 *
 * WHY THE RATE IS RESOLVED AT CALL TIME AND STORED
 *   Prices change. If cost were computed on read from whatever rate is current, every
 *   historical figure would silently move the next time a price is edited, and a spend
 *   report run twice would disagree with itself. So the rate in force at the moment of the
 *   call is resolved from uat_model_pricing, the cost is computed once, and both the amount
 *   and the pricing row's id are written to uat_llm_call. Nothing recomputes it afterwards.
 *
 * WHY MICROS
 *   A single call can cost fractions of a cent. Storing dollars as a float accumulates
 *   error across thousands of rows, and the daily cap is an inequality on that sum.
 *   BIGINT micros (1e-6 USD) is exact for any volume this will ever see.
 *
 * WHY AN UNPRICED MODEL IS AN ERROR, NOT A ZERO
 *   A model with no pricing row would otherwise cost nothing, which means the daily cap
 *   would never trip for it — the one situation where a spend limit most needs to work.
 *   resolveRate() returns null and the caller records the call with a null cost and a
 *   visible reason.
 */
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

type UatConnection = PoolConnection | Awaited<ReturnType<typeof db.getConnection>>;

export interface PricingRate {
  id: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  cacheReadMultiplier: number;
}

interface PricingRow extends RowDataPacket {
  id: string;
  input_usd_per_mtok: string | number;
  output_usd_per_mtok: string | number;
  cache_read_multiplier: string | number;
}

/**
 * The rate in force now for a provider/model.
 *
 * ORDER BY effective_from DESC LIMIT 1 rather than trusting effective_to to be maintained:
 * a price correction entered without closing the previous row would otherwise match two
 * rows, and picking the most recent start is the answer a human would give.
 */
export async function resolveRate(
  providerKey: string,
  modelId: string,
  conn?: UatConnection
): Promise<PricingRate | null> {
  const runner = conn ?? db;
  const [rows] = await runner.query<PricingRow[]>(
    `SELECT id, input_usd_per_mtok, output_usd_per_mtok, cache_read_multiplier
       FROM uat_model_pricing
      WHERE provider_key = ? AND model_id = ?
        AND effective_from <= NOW()
        AND (effective_to IS NULL OR effective_to > NOW())
      ORDER BY effective_from DESC
      LIMIT 1`,
    [providerKey, modelId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    inputUsdPerMTok: Number(r.input_usd_per_mtok),
    outputUsdPerMTok: Number(r.output_usd_per_mtok),
    cacheReadMultiplier: Number(r.cache_read_multiplier),
  };
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Cached input tokens, billed at inputRate × cacheReadMultiplier. */
  cacheReadTokens?: number;
}

/**
 * Cost in micro-dollars.
 *
 * Anthropic reports cache reads as a SEPARATE figure from input_tokens, not as a subset of
 * it, so the two are added rather than one subtracted from the other. Getting this backwards
 * would understate cost on every cached call — which is most of them, since the checklist
 * prefix is deliberately cacheable.
 */
export function computeCostMicros(usage: TokenUsage, rate: PricingRate): number {
  const input = Math.max(0, usage.inputTokens ?? 0);
  const output = Math.max(0, usage.outputTokens ?? 0);
  const cached = Math.max(0, usage.cacheReadTokens ?? 0);

  const usd =
    (input / 1_000_000) * rate.inputUsdPerMTok +
    (cached / 1_000_000) * rate.inputUsdPerMTok * rate.cacheReadMultiplier +
    (output / 1_000_000) * rate.outputUsdPerMTok;

  return Math.round(usd * 1_000_000);
}

/**
 * Spend since local midnight, in micros. Reads only what was stored at call time, so it
 * cannot be moved by a later price edit.
 */
export async function spendTodayMicros(conn?: UatConnection): Promise<number> {
  const runner = conn ?? db;
  const [rows] = await runner.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(cost_usd_micros), 0) AS total
       FROM uat_llm_call
      WHERE created_at >= CURDATE()`
  );
  return Number(rows[0]?.total ?? 0);
}

export interface BudgetVerdict {
  allowed: boolean;
  spentUsd: number;
  capUsd: number;
  reason?: string;
}

/**
 * Daily budget check, run BEFORE a call rather than after.
 *
 * Checked before because a cap enforced after the fact is not a cap. The cost of the call
 * about to be made is unknown, so this is a floor check: spend must be strictly under the
 * cap to proceed, meaning the cap can be exceeded by at most one call. That is the correct
 * trade — the alternative is estimating the cost of a call whose output length nobody knows,
 * and refusing on a guess.
 */
export async function checkDailyBudget(
  capUsd: number,
  conn?: UatConnection
): Promise<BudgetVerdict> {
  const spentMicros = await spendTodayMicros(conn);
  const spentUsd = spentMicros / 1_000_000;
  if (capUsd <= 0) {
    return {
      allowed: false,
      spentUsd,
      capUsd,
      reason: "Daily LLM budget is set to zero; no calls are permitted.",
    };
  }
  if (spentUsd >= capUsd) {
    return {
      allowed: false,
      spentUsd,
      capUsd,
      reason: `Daily LLM budget exhausted: $${spentUsd.toFixed(4)} spent against a $${capUsd.toFixed(2)} cap.`,
    };
  }
  return { allowed: true, spentUsd, capUsd };
}

export interface RecordCallInput {
  feedbackId: string;
  stage: "validator" | "prompt_writer" | "repair";
  providerKey: string;
  modelId: string;
  modelVersion?: string | null;
  effort?: string | null;
  maxTokens?: number | null;
  promptTemplateVersion: string;
  registrySha?: string | null;
  promptSha256: string;
  responseSha256?: string | null;
  attemptNo?: number;
  schemaValid: boolean;
  stopReason?: string | null;
  refusalCategory?: string | null;
  usage?: TokenUsage;
  latencyMs?: number | null;
  errorMessage?: string | null;
  responseJson?: unknown;
}

/**
 * Write the call log and return its id.
 *
 * Every call is recorded, including failures and refusals — a refusal still consumed tokens,
 * and a stage that logged only successes would make "why did this item stall" unanswerable.
 */
export async function recordLlmCall(
  input: RecordCallInput,
  conn?: UatConnection
): Promise<{ id: string; costMicros: number | null; priced: boolean }> {
  const runner = conn ?? db;
  const rate = await resolveRate(input.providerKey, input.modelId, conn);
  const costMicros = rate && input.usage ? computeCostMicros(input.usage, rate) : null;

  const [res] = await runner.query(
    `INSERT INTO uat_llm_call
       (feedback_id, stage, provider_key, model_id, model_version, effort, max_tokens,
        prompt_template_version, registry_sha, prompt_sha256, response_sha256, attempt_no,
        schema_valid, stop_reason, refusal_category, input_tokens, output_tokens,
        cache_read_tokens, cost_usd_micros, pricing_version_id, latency_ms, error_message,
        response_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.feedbackId,
      input.stage,
      input.providerKey,
      input.modelId,
      input.modelVersion ?? null,
      input.effort ?? null,
      input.maxTokens ?? null,
      input.promptTemplateVersion,
      input.registrySha ?? null,
      input.promptSha256,
      input.responseSha256 ?? null,
      input.attemptNo ?? 1,
      input.schemaValid ? 1 : 0,
      input.stopReason ?? null,
      input.refusalCategory ?? null,
      input.usage?.inputTokens ?? null,
      input.usage?.outputTokens ?? null,
      input.usage?.cacheReadTokens ?? null,
      costMicros,
      rate?.id ?? null,
      input.latencyMs ?? null,
      input.errorMessage ? String(input.errorMessage).slice(0, 1000) : null,
      input.responseJson ? JSON.stringify(input.responseJson) : null,
    ]
  );

  const insertId = (res as { insertId?: number }).insertId;
  void insertId; // the PK is a UUID default, so read it back by the natural key
  const [rows] = await runner.query<RowDataPacket[]>(
    `SELECT id FROM uat_llm_call
      WHERE feedback_id = ? AND prompt_sha256 = ? AND attempt_no = ?
      ORDER BY created_at DESC LIMIT 1`,
    [input.feedbackId, input.promptSha256, input.attemptNo ?? 1]
  );

  return {
    id: String(rows[0]?.id ?? ""),
    costMicros,
    priced: Boolean(rate),
  };
}
