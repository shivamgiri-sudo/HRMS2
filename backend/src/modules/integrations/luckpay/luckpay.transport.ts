/**
 * Shared Luckpay HTTP transport.
 *
 * Single place where every Luckpay call (PAN, UAN, Penny-Drop, DigiLocker, eSign)
 * acquires its token and issues its request. Both the env-driven client facade
 * (luckpay.client.ts) and the org_settings-driven CompositeBgvProviderAdapter
 * call through here, so they can no longer disagree about base URL, auth URL,
 * token caching or response unwrapping.
 *
 * Auth contract (identical for every endpoint):
 *   POST {baseUrl}/auth/token   header: Authorization: Basic <basicToken>
 *   POST {baseUrl}{path}        headers: Authorization: base64(clientId)
 *                                        X-Access-Token: Bearer <token>
 *
 * The business-endpoint Authorization header is the BASE64 of the client id, not
 * the raw id — vendor docs show `Authorization: TFBNNA==`, which is base64 of
 * "LPM4". Sending the raw id (e.g. "LPM14") makes the gateway's base64 decode
 * fail and every call is rejected with 401 VAL_EXT_001 "Invalid Base64 encoding",
 * regardless of how valid the token and payload are.
 */
import axios from "axios";
import { env } from "../../../config/env.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LuckpayResolvedConfig {
  /** Base URL, trailing slash stripped. Auth URL is always `${baseUrl}/auth/token`. */
  baseUrl: string;
  /** Basic token, whitespace-stripped, WITHOUT the "Basic " prefix. */
  basicToken: string;
  /** Client id, whitespace-stripped. Sent raw in the Authorization header. */
  clientId: string;
  timeoutMs: number;
  /** Where the credentials came from — surfaced by getRuntimeStatus() for diagnostics. */
  source: "db" | "env";
  /** env.LUCKPAY_PROVIDER_ENABLED. The transport never enforces this; callers decide. */
  enabled: boolean;
}

export type LuckpayResponse = {
  /** Raw axios res.data, exactly as the provider sent it. */
  envelope: Record<string, unknown>;
  /** res.data?.data ?? res.data — the node the adapter has always read fields from. */
  data: Record<string, unknown>;
  /** PII-masked copy of the envelope, safe to persist in transaction logs. */
  sanitized: Record<string, unknown>;
};

// ── PII masking ───────────────────────────────────────────────────────────────

const SECRET_KEYWORDS = [
  "aadhaar",
  "aadhar",
  "pan",
  "mobile",
  "phone",
  "account",
  "ifsc",
  "token",
  "authorization",
  "x-access-token",
  "otp",
  "file_path",
  "path",
  "idnumber",
  "identifier",
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function maskString(value: string) {
  if (/^\d{12}$/.test(value)) return `${value.slice(0, 2)}XXXXXXXX${value.slice(-2)}`;
  if (/^[A-Z]{5}\d{4}[A-Z]$/i.test(value)) return `${value.slice(0, 3)}XXXX${value.slice(-2)}`;
  if (/^\d{10}$/.test(value)) return `${value.slice(0, 2)}XXXXXX${value.slice(-2)}`;
  if (/^\d{8,18}$/.test(value)) return `${value.slice(0, 2)}XXXX${value.slice(-2)}`;
  if (value.length > 12) return `${value.slice(0, 4)}...${value.slice(-4)}`;
  return "***";
}

export function sanitizeProviderPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.map((item) => sanitizeProviderPayload(item));
  if (!payload || typeof payload !== "object") {
    if (typeof payload === "string") return payload;
    return payload;
  }

  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).map(([key, value]) => {
      const lowered = key.toLowerCase();
      if (SECRET_KEYWORDS.some((word) => lowered.includes(word))) {
        return [key, typeof value === "string" ? maskString(value) : "***"];
      }
      return [key, sanitizeProviderPayload(value)];
    })
  );
}

// ── Config normalisation & guards ─────────────────────────────────────────────

const stripWs = (value: unknown) => String(value ?? "").replace(/\s+/g, "").trim();

export function normalizeLuckpayConfig(input: {
  baseUrl?: string | null;
  basicToken?: string | null;
  clientId?: string | null;
  timeoutMs?: number;
  source?: "db" | "env";
  enabled?: boolean;
}): LuckpayResolvedConfig {
  return {
    baseUrl: String(input.baseUrl ?? "").trim().replace(/\/$/, ""),
    basicToken: stripWs(input.basicToken),
    clientId: stripWs(input.clientId),
    timeoutMs: input.timeoutMs ?? env.LUCKPAY_TIMEOUT_MS,
    source: input.source ?? "env",
    enabled: input.enabled ?? env.LUCKPAY_PROVIDER_ENABLED,
  };
}

/**
 * Business-endpoint Authorization header value: base64 of the client id.
 *
 * Accepts a value that is ALREADY base64 so an operator who pastes the header
 * form straight from the vendor docs into BGV settings still works. "LPM14" is
 * not valid base64 (length 5), so a raw client id can never be mistaken for one.
 */
export function luckpayAuthHeader(clientId: string): string {
  const clean = stripWs(clientId);
  if (clean.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
    try {
      const decoded = Buffer.from(clean, "base64").toString("utf8");
      if (decoded.length > 0 && /^[\x20-\x7E]+$/.test(decoded)) return clean;
    } catch {
      // fall through and encode
    }
  }
  return Buffer.from(clean, "utf8").toString("base64");
}

/** Throws 503 when credentials are missing. Does NOT consider `enabled` — see assertLuckpayEnabled. */
export function assertLuckpayCredentials(cfg: LuckpayResolvedConfig): void {
  if (!cfg.baseUrl) {
    throw Object.assign(new Error("Luckpay API Base URL is not configured in BGV settings."), { statusCode: 503 });
  }
  if (!cfg.basicToken || !cfg.clientId) {
    throw Object.assign(new Error("Luckpay Basic Token and Client ID are not configured in BGV settings."), { statusCode: 503 });
  }
}

/**
 * Master on/off switch. Kept separate from credential validation because the
 * BGV adapter path has never consulted LUCKPAY_PROVIDER_ENABLED — only the
 * env-driven client did. Callers opt in explicitly to preserve that.
 */
export function assertLuckpayEnabled(cfg: LuckpayResolvedConfig): void {
  if (!cfg.enabled) {
    throw Object.assign(new Error("Luckpay provider is disabled."), { statusCode: 503 });
  }
}

// ── Auth URL resolution ───────────────────────────────────────────────────────

const warnedAuthUrls = new Set<string>();

/**
 * The auth URL is always derived from the resolved base URL.
 *
 * `LUCKPAY_AUTH_URL` is retained for backwards compatibility but is only honoured
 * when it agrees with the resolved base. Previously it was used unconditionally,
 * which meant a staging auth URL could mint a token that was then sent to the
 * production host — a guaranteed 401 that this check makes impossible.
 */
export function resolveAuthUrl(cfg: LuckpayResolvedConfig): string {
  const derived = `${cfg.baseUrl}/auth/token`;
  const configured = String(env.LUCKPAY_AUTH_URL ?? "").trim().replace(/\/$/, "");
  if (!configured) return derived;
  if (configured.startsWith(cfg.baseUrl)) return configured;
  if (!warnedAuthUrls.has(configured)) {
    warnedAuthUrls.add(configured);
    console.warn(
      `[Luckpay] LUCKPAY_AUTH_URL (${configured}) does not match the resolved base URL (${cfg.baseUrl}) — ignoring it and using ${derived}.`,
    );
  }
  return derived;
}

// ── Error shaping & retry ─────────────────────────────────────────────────────

export function toSafeProviderError(error: unknown) {
  const status = Number((error as { response?: { status?: number } })?.response?.status ?? 502);
  const responseData = (error as { response?: { data?: unknown } })?.response?.data;
  const sanitized = sanitizeProviderPayload(responseData) as Record<string, unknown> | null;
  const providerMessage = sanitized && typeof sanitized === "object"
    ? String(sanitized.message ?? sanitized.error ?? sanitized.status ?? "")
    : "";
  const message = providerMessage || String((error as Error)?.message ?? "Luckpay provider request failed");
  const providerCode = (error as { code?: string })?.code;

  // Luckpay rejects non-whitelisted egress IPs with AUTH_023. It is by far the
  // most common deployment-time failure, so flag it on every path rather than
  // only in the BGV adapter — operators need to see it, not a generic 4xx.
  const lowered = message.toLowerCase();
  const isIpWhitelistError =
    (lowered.includes("ip") && lowered.includes("whitelist")) ||
    lowered.includes("not authorized") ||
    providerCode === "ECONNREFUSED";

  return Object.assign(new Error(`Luckpay provider request failed: ${message}`), {
    statusCode: isIpWhitelistError ? 503 : (status >= 400 && status < 600 ? status : 502),
    providerPayload: sanitized,
    /** Marks this error as already sanitized so downstream wrappers don't re-derive from response.data. */
    luckpayConverted: true as const,
    providerCode,
    isIpWhitelistError,
  });
}

// ── Runtime diagnostics (feeds getRuntimeStatus / provider-status endpoint) ────

const diagnostics = {
  lastSuccessAt: null as string | null,
  lastFailureAt: null as string | null,
  lastFailureMessage: null as string | null,
};

export function getLuckpayDiagnostics() {
  return { ...diagnostics };
}

/**
 * Retry a provider call.
 *
 * `idempotent` must be true ONLY for calls that can be repeated safely. Luckpay's
 * business endpoints are not: each carries a clientTransactionId the vendor records
 * on first receipt, so resending after a 5xx comes back as
 * "Transaction ID <uuid> already exists" (HTTP 409), permanently. A live penny drop
 * failed exactly that way, and because the vendor accepted the first request we may
 * have paid for a verification whose result was then discarded.
 *
 * Only the token endpoint is safe to repeat: it carries no transaction id and simply
 * mints another token.
 */
async function requestWithRetry<T>(fn: () => Promise<T>, opts: { idempotent: boolean }): Promise<T> {
  let attempt = 0;
  let delayMs = 400;
  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (error: unknown) {
      const status = Number((error as { response?: { status?: number } })?.response?.status ?? 0);
      if (!opts.idempotent || attempt >= 3 || ![429, 500, 502, 503, 504].includes(status)) {
        const safeError = toSafeProviderError(error);
        diagnostics.lastFailureAt = new Date().toISOString();
        diagnostics.lastFailureMessage = safeError.message;
        throw safeError;
      }
      await sleep(delayMs);
      delayMs *= 2;
    }
  }
}

// ── Token cache ───────────────────────────────────────────────────────────────

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

const cacheKey = (cfg: LuckpayResolvedConfig) => `${cfg.baseUrl}::${cfg.clientId}`;

/** Clears every cached token. Wired into resetBgvProviderAdapterCache() so a credential change takes effect immediately. */
export function resetLuckpayTokenCache(): void {
  tokenCache.clear();
}

export async function getLuckpayAccessToken(cfg: LuckpayResolvedConfig): Promise<string> {
  assertLuckpayCredentials(cfg);

  const key = cacheKey(cfg);
  const now = Date.now();
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > now + 2_000) {
    return cached.accessToken;
  }

  // NOTE: headers must contain Authorization ONLY — no Content-Type.
  const response = await requestWithRetry(async () => axios.post(
    resolveAuthUrl(cfg),
    undefined,
    {
      timeout: cfg.timeoutMs,
      headers: { Authorization: `Basic ${cfg.basicToken}` },
    },
  ), { idempotent: true });

  const payload = (response as { data?: Record<string, unknown> })?.data ?? {};
  const inner = (payload as { data?: Record<string, unknown> })?.data ?? payload;
  const accessToken = stripWs(
    (inner as Record<string, unknown>)?.accessToken
    ?? (inner as Record<string, unknown>)?.access_token
    ?? (inner as Record<string, unknown>)?.token,
  );
  if (!accessToken) {
    throw Object.assign(new Error("Luckpay auth token response did not include an access token."), { statusCode: 502 });
  }

  const expiresIn = Number(
    (inner as Record<string, unknown>)?.expiresIn
    ?? (inner as Record<string, unknown>)?.expires_in
    ?? env.LUCKPAY_TOKEN_CACHE_TTL_SECONDS,
  );
  tokenCache.set(key, { accessToken, expiresAt: now + Math.max(1, expiresIn) * 1000 });
  diagnostics.lastSuccessAt = new Date().toISOString();
  diagnostics.lastFailureAt = null;
  diagnostics.lastFailureMessage = null;
  return accessToken;
}

// ── Requests ──────────────────────────────────────────────────────────────────

function toLuckpayResponse(raw: unknown): LuckpayResponse {
  const envelope = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { data: raw }) as Record<string, unknown>;
  const inner = envelope.data;
  const data = (inner && typeof inner === "object" && !Array.isArray(inner) ? inner : envelope) as Record<string, unknown>;
  return {
    envelope,
    data,
    sanitized: sanitizeProviderPayload(envelope) as Record<string, unknown>,
  };
}

export async function luckpayPostJson(
  cfg: LuckpayResolvedConfig,
  path: string,
  payload: Record<string, unknown>,
): Promise<LuckpayResponse> {
  const accessToken = await getLuckpayAccessToken(cfg);
  const response = await requestWithRetry(async () => axios.post(
    `${cfg.baseUrl}${path}`,
    payload,
    {
      timeout: cfg.timeoutMs,
      headers: {
        Authorization: luckpayAuthHeader(cfg.clientId),
        "X-Access-Token": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    },
  ), { idempotent: false });
  return toLuckpayResponse((response as { data?: unknown })?.data);
}

export async function luckpayPostMultipart(
  cfg: LuckpayResolvedConfig,
  path: string,
  parts: {
    file: { buffer: Buffer; filename: string; contentType?: string };
    request: Record<string, unknown>;
  },
): Promise<LuckpayResponse> {
  const accessToken = await getLuckpayAccessToken(cfg);

  // `form-data` (Node) rather than the global FormData/Blob — it produces a real
  // stream with correct multipart headers for axios under Node.
  const FormData = (await import("form-data")).default;
  const form = new FormData();
  form.append("file", parts.file.buffer, {
    filename: parts.file.filename,
    contentType: parts.file.contentType ?? "application/pdf",
  });
  form.append("request", JSON.stringify(parts.request), { contentType: "application/json" });

  const response = await requestWithRetry(async () => axios.post(
    `${cfg.baseUrl}${path}`,
    form,
    {
      timeout: cfg.timeoutMs,
      headers: {
        ...form.getHeaders(),
        Authorization: luckpayAuthHeader(cfg.clientId),
        "X-Access-Token": `Bearer ${accessToken}`,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    },
  ), { idempotent: false });
  return toLuckpayResponse((response as { data?: unknown })?.data);
}

// ── Response field extraction ─────────────────────────────────────────────────

function resolvePath(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const segment of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/**
 * Looks each name up in the unwrapped `data` node first, then the raw envelope.
 *
 * Names may be dotted paths — the real payloads nest the values that matter
 * (`details.file`, `esignDetails.agreement_status`), and the envelope repeats
 * generic keys like `status` at several levels with different meanings, so the
 * caller has to be able to say exactly which one it wants.
 */
export function pickLuckpayField(r: LuckpayResponse, names: string[]): string | null {
  for (const name of names) {
    for (const scope of [r.data, r.envelope]) {
      const value = name.includes(".") ? resolvePath(scope, name) : scope?.[name];
      if (value === null || value === undefined) continue;
      if (typeof value === "string") {
        if (value.trim()) return value;
        continue;
      }
      if (typeof value === "number" || typeof value === "boolean") return String(value);
    }
  }
  return null;
}
