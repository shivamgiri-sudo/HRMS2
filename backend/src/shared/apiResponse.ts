import { logger } from "../logger.js";

export type ApiMeta = Record<string, unknown>;

export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
  meta?: ApiMeta;
};

export type ApiErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
  };
  status: number;
};

export function apiSuccess<T>(data: T, meta?: ApiMeta): ApiSuccessResponse<T> {
  return meta ? { success: true, data, meta } : { success: true, data };
}

export function apiError(code: string, message: string, status = 500): ApiErrorResponse {
  return {
    success: false,
    error: { code, message },
    status,
  };
}

/**
 * Driver-level detail pulled off a caught error, for diagnosing a swallowed failure.
 * `errorCode` is the mysql2 code (e.g. ER_BAD_FIELD_ERROR) when present.
 */
export type SourceFailureDetail = {
  errorCode: string | null;
  errorMessage: string;
  sqlState: string | null;
};

export function describeSourceFailure(error: unknown): SourceFailureDetail {
  const err = error as { code?: unknown; sqlState?: unknown; message?: unknown } | null;
  return {
    errorCode: typeof err?.code === "string" ? err.code : null,
    errorMessage: typeof err?.message === "string" ? err.message : String(error),
    sqlState: typeof err?.sqlState === "string" ? err.sqlState : null,
  };
}

/**
 * Log a data-source failure that is being deliberately swallowed so the caller can
 * degrade gracefully. Without this, a broken query and a genuinely empty table are
 * indistinguishable in the response — which is how nonexistent-column bugs survived
 * three audit passes. Always log; never change the response shape here.
 *
 * Grep `[source-failure]` to find every degraded read.
 */
export function logSourceFailure(
  scope: string,
  error: unknown,
  context: Record<string, unknown> = {},
): SourceFailureDetail {
  const detail = describeSourceFailure(error);
  logger.error({ scope, ...detail, ...context }, `[source-failure] ${scope}`);
  return detail;
}
