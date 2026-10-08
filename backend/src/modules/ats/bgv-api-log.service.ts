/**
 * Central write path for candidate_bgv_api_request_log.
 *
 * Before this existed, every call site inlined its own INSERT *after* the
 * provider call returned. A thrown error therefore skipped the write, so the log
 * could only ever contain successes — the exact opposite of what it is for. It
 * also hardcoded response_status_code to 200 and derived success_flag from the
 * business result, which made "the API is down" indistinguishable from "the name
 * did not match".
 *
 * `recordBgvApiCall` wraps the provider call instead, so success and failure are
 * both recorded, with the reason attached.
 *
 * Leaf module: imports only db, so any provider service can use it.
 */
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export type BgvApiOutcome =
  | "success"
  | "mismatch"
  | "manual_review"
  | "provider_error"
  | "network_error"
  | "config_error";

export type BgvApiLogEntry = {
  candidateId: string;
  endpointKey: string;
  providerKey: string;
  checkId?: string | null;
  requestRef?: string | null;
  requestPayloadHash?: string | null;
  httpStatus?: number | null;
  responsePayload?: unknown;
  durationMs?: number | null;
  outcome: BgvApiOutcome;
  errorCode?: string | null;
  errorMessage?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  attemptNo?: number;
};

const SUCCESS_OUTCOMES: BgvApiOutcome[] = ["success"];

/** Never let logging break a verification flow. */
export async function writeBgvApiLog(entry: BgvApiLogEntry): Promise<string | null> {
  const id = randomUUID();
  try {
    await db.execute(
      `INSERT INTO candidate_bgv_api_request_log
         (id, candidate_id, check_id, provider_key, endpoint_key, request_ref,
          request_payload_hash, response_status_code, response_payload, duration_ms,
          success_flag, outcome, error_code, error_message, actor_type, actor_id, attempt_no)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.candidateId,
        entry.checkId ?? null,
        entry.providerKey,
        entry.endpointKey,
        entry.requestRef ?? null,
        entry.requestPayloadHash ?? null,
        entry.httpStatus ?? null,
        entry.responsePayload === undefined ? null : JSON.stringify(entry.responsePayload).slice(0, 4_000_000),
        entry.durationMs ?? null,
        SUCCESS_OUTCOMES.includes(entry.outcome) ? 1 : 0,
        entry.outcome,
        entry.errorCode ?? null,
        entry.errorMessage ? String(entry.errorMessage).slice(0, 2000) : null,
        entry.actorType ?? null,
        entry.actorId ?? null,
        entry.attemptNo ?? 1,
      ],
    );
    return id;
  } catch (error) {
    console.error(`[bgv-api-log] failed to record ${entry.endpointKey} for ${entry.candidateId}:`, (error as Error)?.message);
    return null;
  }
}

/**
 * Turns a thrown provider error into an operator-readable reason.
 *
 * Recognises the shapes the Luckpay transport produces (statusCode +
 * providerPayload + isIpWhitelistError) as well as raw axios/node errors, so an
 * operator reading the log sees "IP address x.x.x.x is not whitelisted" rather
 * than a bare 502.
 */
export function classifyProviderError(error: unknown): {
  outcome: BgvApiOutcome;
  errorCode: string;
  errorMessage: string;
  httpStatus: number | null;
} {
  const e = error as {
    statusCode?: number;
    message?: string;
    code?: string;
    providerCode?: string;
    isIpWhitelistError?: boolean;
    providerPayload?: Record<string, unknown> | null;
    response?: { status?: number; data?: Record<string, unknown> };
  };

  const httpStatus = e?.statusCode ?? e?.response?.status ?? null;
  const providerPayload = e?.providerPayload ?? e?.response?.data ?? null;
  const providerCode = providerPayload && typeof providerPayload === "object"
    ? String(providerPayload.code ?? "")
    : "";
  const transportCode = e?.code ?? e?.providerCode ?? "";
  const message = String(e?.message ?? "Unknown provider failure");

  if (e?.isIpWhitelistError || providerCode === "AUTH_023") {
    return { outcome: "provider_error", errorCode: providerCode || "IP_NOT_WHITELISTED", errorMessage: message, httpStatus };
  }
  if (["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ECONNABORTED"].includes(String(transportCode))) {
    return { outcome: "network_error", errorCode: String(transportCode), errorMessage: message, httpStatus };
  }
  if (httpStatus === 503 && /not configured|disabled/i.test(message)) {
    return { outcome: "config_error", errorCode: "PROVIDER_NOT_CONFIGURED", errorMessage: message, httpStatus };
  }
  return {
    outcome: "provider_error",
    errorCode: providerCode || (httpStatus ? `HTTP_${httpStatus}` : "PROVIDER_ERROR"),
    errorMessage: message,
    httpStatus,
  };
}

/**
 * Runs a provider call and records it either way.
 *
 * The error is re-thrown after logging so callers keep their existing control
 * flow — this only guarantees the attempt leaves a trace.
 */
export async function recordBgvApiCall<T>(
  meta: Omit<BgvApiLogEntry, "outcome" | "durationMs" | "httpStatus" | "responsePayload" | "errorCode" | "errorMessage">
    & { classifyResult?: (result: T) => { outcome: BgvApiOutcome; payload?: unknown; checkId?: string | null } },
  call: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await call();
    const classified = meta.classifyResult?.(result);
    await writeBgvApiLog({
      ...meta,
      checkId: classified?.checkId ?? meta.checkId ?? null,
      outcome: classified?.outcome ?? "success",
      httpStatus: 200,
      responsePayload: classified?.payload ?? result,
      durationMs: Date.now() - started,
    });
    return result;
  } catch (error) {
    const { outcome, errorCode, errorMessage, httpStatus } = classifyProviderError(error);
    await writeBgvApiLog({
      ...meta,
      outcome,
      errorCode,
      errorMessage,
      httpStatus,
      responsePayload: (error as { providerPayload?: unknown })?.providerPayload ?? null,
      durationMs: Date.now() - started,
    });
    throw error;
  }
}

/**
 * Runs a provider call and, if it throws, records why before re-throwing.
 *
 * Success is left to the caller's existing INSERT — this closes the gap where a
 * thrown error meant no row at all, which is why failed calls were invisible.
 */
export async function withProviderFailureLogged<T>(
  meta: { candidateId: string; endpointKey: string; providerKey: string; actorType?: string | null; actorId?: string | null },
  call: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    return await call();
  } catch (error) {
    const { outcome, errorCode, errorMessage, httpStatus } = classifyProviderError(error);
    await writeBgvApiLog({
      candidateId: meta.candidateId,
      endpointKey: meta.endpointKey,
      providerKey: meta.providerKey,
      actorType: meta.actorType ?? null,
      actorId: meta.actorId ?? null,
      outcome,
      errorCode,
      errorMessage,
      httpStatus,
      responsePayload: (error as { providerPayload?: unknown })?.providerPayload ?? null,
      durationMs: Date.now() - started,
    });
    throw error;
  }
}

// ── Cost reporting ────────────────────────────────────────────────────────────

/**
 * Maps a logged endpoint_key to the check type the cost settings are keyed by.
 *
 * The frontend did this with a regex that silently fell back to ₹2 for anything
 * it could not parse, so ADDRESS_DOC_VERIFY and COURT_VERIFICATION_COMPLETED
 * were both being billed at the wrong rate. Doing it server-side with an
 * explicit table makes the gaps visible instead.
 */
const ENDPOINT_TO_CHECK_TYPE: Record<string, string> = {
  PAN_VERIFY: "pan",
  BANK_VERIFY: "bank",
  UAN_VERIFY: "uan",
  COURT_VERIFY: "court",
  COURT_VERIFICATION_COMPLETED: "court",
  EDUCATION_VERIFY: "education",
  ADDRESS_DOC_VERIFY: "address",
  AADHAAR_VERIFY: "aadhaar",
  AADHAAR_OFFLINE_VERIFY: "aadhaar",
  AADHAAR_OTP: "aadhaar",
  DIGILOCKER_INITIATE: "digilocker",
  DIGILOCKER_STATUS: "digilocker",
  DIGILOCKER_DOWNLOAD: "digilocker",
  ESIGN_INITIATE: "esign",
  ESIGN_STATUS: "esign",
  ESIGN_DOWNLOAD: "esign",
};

export function endpointToCheckType(endpointKey: string): string {
  const direct = ENDPOINT_TO_CHECK_TYPE[endpointKey];
  if (direct) return direct;
  return String(endpointKey).toLowerCase().replace(/^verify_/, "").replace(/_verify$/, "").replace(/_offline$/, "");
}

export type BgvApiCostRow = {
  endpointKey: string;
  checkType: string;
  billableCalls: number;
  failedCalls: number;
  totalCalls: number;
  unitCost: number;
  totalCost: number;
  rateConfigured: boolean;
};

/**
 * Actual spend, computed server-side from the log.
 *
 * Only non-failed calls are billed: a request that never reached the provider
 * (network_error / config_error) costs nothing, and billing for it would
 * overstate spend during an outage. Provider errors are counted separately so
 * the number can be reviewed rather than silently dropped.
 */
export async function getBgvApiCostReport(days = 30): Promise<{
  days: number;
  rows: BgvApiCostRow[];
  totalCost: number;
  totalCalls: number;
  unmappedEndpoints: string[];
}> {
  const [rateRows] = await db.execute<RowDataPacket[]>(
    // org_settings is a flat key/value table — it has no `category` column, so the previous
    // filter threw ER_BAD_FIELD_ERROR and this report 500'd on every call. The rates live as
    // individual bgv_api_cost_<type> keys, which is exactly what the prefix strip below
    // assumes.
    `SELECT setting_key, setting_value FROM org_settings WHERE setting_key LIKE 'bgv_api_cost_%'`,
  );
  const rates: Record<string, number> = {};
  for (const row of rateRows as RowDataPacket[]) {
    rates[String(row.setting_key).replace("bgv_api_cost_", "")] = parseFloat(String(row.setting_value)) || 0;
  }

  const [usageRows] = await db.execute<RowDataPacket[]>(
    `SELECT endpoint_key,
            COUNT(*) AS total_calls,
            SUM(CASE WHEN outcome IN ('network_error','config_error') THEN 1 ELSE 0 END) AS unbilled,
            SUM(CASE WHEN outcome NOT IN ('success','mismatch','manual_review') THEN 1 ELSE 0 END) AS failed
       FROM candidate_bgv_api_request_log
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY endpoint_key`,
    [days],
  );

  const rows: BgvApiCostRow[] = [];
  const unmapped: string[] = [];
  let totalCost = 0;
  let totalCalls = 0;

  for (const row of usageRows as RowDataPacket[]) {
    const endpointKey = String(row.endpoint_key);
    const checkType = endpointToCheckType(endpointKey);
    const total = Number(row.total_calls) || 0;
    const billable = total - (Number(row.unbilled) || 0);
    const rateConfigured = Object.prototype.hasOwnProperty.call(rates, checkType);
    if (!rateConfigured) unmapped.push(endpointKey);
    const unitCost = rates[checkType] ?? 0;
    const cost = billable * unitCost;
    totalCost += cost;
    totalCalls += total;
    rows.push({
      endpointKey,
      checkType,
      billableCalls: billable,
      failedCalls: Number(row.failed) || 0,
      totalCalls: total,
      unitCost,
      totalCost: cost,
      rateConfigured,
    });
  }

  rows.sort((a, b) => b.totalCost - a.totalCost);
  return { days, rows, totalCost, totalCalls, unmappedEndpoints: unmapped };
}
