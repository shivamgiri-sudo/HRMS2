import axios from "axios";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { env } from "../../../config/env.js";

type SanitizedJson = Record<string, unknown>;

type CachedToken = {
  accessToken: string;
  expiresAt: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
};

type LuckpayDigilockerPayload = {
  clientTransactionId: string;
  customerName: string;
  mobileNumber: string;
};

type LuckpayEsignPayload = {
  filePath: string;
  request: {
    clientTransactionId: string;
    signedBy: string;
    location: string;
    reason: string;
  };
};

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

const state: CachedToken = {
  accessToken: "",
  expiresAt: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastFailureMessage: null,
};

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

function ensureLuckpayEnabled() {
  if (!env.LUCKPAY_PROVIDER_ENABLED) {
    throw Object.assign(new Error("Luckpay provider is disabled."), { statusCode: 503 });
  }
  if (!env.LUCKPAY_BASIC_TOKEN || !env.LUCKPAY_CLIENT_ID) {
    throw Object.assign(new Error("Luckpay credentials are not configured."), { statusCode: 503 });
  }
}

function getBaseUrl() {
  return (env.LUCKPAY_ENV === "production" ? env.LUCKPAY_PROD_BASE_URL : env.LUCKPAY_BASE_URL).replace(/\/$/, "");
}

function toSafeProviderError(error: unknown) {
  const status = Number((error as { response?: { status?: number } })?.response?.status ?? 502);
  const responseData = (error as { response?: { data?: unknown } })?.response?.data;
  const sanitized = sanitizeProviderPayload(responseData) as Record<string, unknown> | null;
  const providerMessage = sanitized && typeof sanitized === "object"
    ? String(sanitized.message ?? sanitized.error ?? sanitized.status ?? "")
    : "";
  const message = providerMessage || String((error as Error)?.message ?? "Luckpay provider request failed");
  return Object.assign(new Error(`Luckpay provider request failed: ${message}`), {
    statusCode: status >= 400 && status < 600 ? status : 502,
    providerPayload: sanitized,
  });
}

async function requestWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  let delayMs = 400;
  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (error: unknown) {
      const status = Number((error as { response?: { status?: number } })?.response?.status ?? 0);
      if (attempt >= 3 || ![429, 500, 502, 503, 504].includes(status)) {
        const safeError = toSafeProviderError(error);
        state.lastFailureAt = new Date().toISOString();
        state.lastFailureMessage = safeError.message;
        throw safeError;
      }
      await sleep(delayMs);
      delayMs *= 2;
    }
  }
}

async function getAccessToken() {
  ensureLuckpayEnabled();
  const now = Date.now();
  if (state.accessToken && state.expiresAt > now + 2_000) {
    return state.accessToken;
  }

  const response = await requestWithRetry(async () => axios.post(
    env.LUCKPAY_AUTH_URL,
    undefined,
    {
      timeout: env.LUCKPAY_TIMEOUT_MS,
      headers: {
        Authorization: `Basic ${String(env.LUCKPAY_BASIC_TOKEN ?? "").replace(/\s+/g, "").trim()}`,
      },
    }
  ));

  const payload = response.data?.data ?? response.data ?? {};
  // Sanitize the token — strip any whitespace/newlines before using in HTTP headers.
  const accessToken = String(payload.accessToken ?? payload.access_token ?? payload.token ?? "").replace(/\s+/g, "").trim();
  if (!accessToken) {
    throw Object.assign(new Error("Luckpay auth token response did not include an access token."), { statusCode: 502 });
  }

  const expiresIn = Number(payload.expiresIn ?? payload.expires_in ?? env.LUCKPAY_TOKEN_CACHE_TTL_SECONDS);
  state.accessToken = accessToken;
  state.expiresAt = now + Math.max(1, expiresIn) * 1000;
  state.lastSuccessAt = new Date().toISOString();
  state.lastFailureAt = null;
  state.lastFailureMessage = null;
  return accessToken;
}

async function requestJson<T>(path: string, payload: Record<string, unknown>) {
  const accessToken = await getAccessToken();
  const response = await requestWithRetry(async () => axios.post<T>(
    `${getBaseUrl()}${path}`,
    payload,
    {
      timeout: env.LUCKPAY_TIMEOUT_MS,
      headers: {
        Authorization: String(env.LUCKPAY_CLIENT_ID ?? "").replace(/\s+/g, "").trim(),
        "X-Access-Token": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  ));
  return response.data;
}

async function requestMultipart<T>(path: string, form: FormData) {
  const accessToken = await getAccessToken();
  const response = await requestWithRetry(async () => axios.post<T>(
    `${getBaseUrl()}${path}`,
    form,
    {
      timeout: env.LUCKPAY_TIMEOUT_MS,
      headers: {
        Authorization: String(env.LUCKPAY_CLIENT_ID ?? "").replace(/\s+/g, "").trim(),
        "X-Access-Token": `Bearer ${accessToken}`,
      },
      maxBodyLength: Infinity,
    }
  ));
  return response.data;
}

export const luckpayClient = {
  generateClientTransactionId(prefix: string) {
    return `${prefix}-${randomUUID()}`;
  },

  async initiateDigilockerWithUrl(payload: LuckpayDigilockerPayload) {
    const response = await requestJson<Record<string, unknown>>("/verifyDigilockerWithURL", payload);
    return {
      raw: response,
      sanitized: sanitizeProviderPayload(response) as SanitizedJson,
      verificationUrl: String(
        (response as Record<string, unknown>)?.redirectUrl ??
        (response as Record<string, unknown>)?.redirect_url ??
        (response as Record<string, unknown>)?.verificationUrl ??
        (response as Record<string, unknown>)?.verification_url ??
        ""
      ) || null,
      providerReferenceId: String(
        (response as Record<string, unknown>)?.referenceId ??
        (response as Record<string, unknown>)?.reference_id ??
        (response as Record<string, unknown>)?.transactionId ??
        (response as Record<string, unknown>)?.transaction_id ??
        payload.clientTransactionId
      ),
      status: String((response as Record<string, unknown>)?.status ?? "initiated"),
    };
  },

  async initiateEsignWithUrl(payload: LuckpayEsignPayload) {
    const form = new FormData();
    form.append(
      "file",
      new Blob([fs.readFileSync(payload.filePath)]),
      path.basename(payload.filePath)
    );
    form.append("request", JSON.stringify(payload.request));

    const response = await requestMultipart<Record<string, unknown>>("/eSignWithURL", form);
    return {
      raw: response,
      sanitized: sanitizeProviderPayload(response) as SanitizedJson,
      verificationUrl: String(
        (response as Record<string, unknown>)?.redirectUrl ??
        (response as Record<string, unknown>)?.redirect_url ??
        (response as Record<string, unknown>)?.signUrl ??
        (response as Record<string, unknown>)?.sign_url ??
        ""
      ) || null,
      providerReferenceId: String(
        (response as Record<string, unknown>)?.referenceId ??
        (response as Record<string, unknown>)?.reference_id ??
        (response as Record<string, unknown>)?.transactionId ??
        (response as Record<string, unknown>)?.transaction_id ??
        payload.request.clientTransactionId
      ),
      status: String((response as Record<string, unknown>)?.status ?? "initiated"),
    };
  },

  getRuntimeStatus() {
    return {
      enabled: env.LUCKPAY_PROVIDER_ENABLED,
      environment: env.LUCKPAY_ENV,
      baseUrl: getBaseUrl(),
      lastTokenSuccessAt: state.lastSuccessAt,
      lastApiFailureAt: state.lastFailureAt,
      lastApiFailureMessage: state.lastFailureMessage,
      services: {
        digilockerUrl: true,
        esignUrl: true,
        pan: true,
        uan: true,
        pennyDrop: true,
      },
    };
  },
};

export function sanitizePayload(payload: unknown): Record<string, unknown> {
  return sanitizeProviderPayload(payload) as Record<string, unknown>;
}

export function generateClientTransactionId(prefix = "joining-doc") {
  return luckpayClient.generateClientTransactionId(prefix);
}

export async function esignWithUrl(input: {
  filePath: string;
  clientTransactionId: string;
  signedBy: string;
  location: string;
  reason: string;
}): Promise<{
  clientTransactionId: string;
  providerReferenceId: string | null;
  providerUrl: string | null;
  status: string;
  response: Record<string, unknown>;
}> {
  const result = await luckpayClient.initiateEsignWithUrl({
    filePath: input.filePath,
    request: {
      clientTransactionId: input.clientTransactionId,
      signedBy: input.signedBy,
      location: input.location,
      reason: input.reason,
    },
  });

  return {
    clientTransactionId: input.clientTransactionId,
    providerReferenceId: result.providerReferenceId,
    providerUrl: result.verificationUrl,
    status: result.status,
    response: result.sanitized,
  };
}
