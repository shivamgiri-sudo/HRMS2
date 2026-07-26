const DATABASE_UNAVAILABLE_CODES = new Set([
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ER_ACCESS_DENIED_ERROR",
  "ER_BAD_DB_ERROR",
  "ER_BAD_FIELD_ERROR",
  "ER_CON_COUNT_ERROR",
  "ER_DBACCESS_DENIED_ERROR",
  "ER_NO_SUCH_TABLE",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
]);

const SERVICE_UNAVAILABLE_MESSAGE =
  "Authentication service temporarily unavailable. Please try again shortly.";

export function classifyLoginError(error: unknown): {
  status: 401 | 503;
  message: string;
} {
  const dbError =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown; errno?: unknown; sqlState?: unknown })
      : null;
  const code = String(dbError?.code ?? "");
  const isDatabaseError =
    DATABASE_UNAVAILABLE_CODES.has(code) ||
    dbError?.errno !== undefined ||
    dbError?.sqlState !== undefined;

  if (isDatabaseError) {
    return { status: 503, message: SERVICE_UNAVAILABLE_MESSAGE };
  }

  return {
    status: 401,
    message: error instanceof Error ? error.message : "Authentication failed",
  };
}
