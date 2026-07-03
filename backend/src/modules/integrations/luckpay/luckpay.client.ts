import axios from "axios";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { env } from "../../../config/env.js";

type LuckpayTokenResponse = {
  access_token?: string;
  token?: string;
  data?: { access_token?: string; token?: string };
};

type LuckpayEsignInput = {
  filePath: string;
  clientTransactionId: string;
  signedBy: string;
  location: string;
  reason: string;
};

type LuckpaySafeResponse = {
  clientTransactionId: string;
  providerReferenceId: string | null;
  providerUrl: string | null;
  status: string;
  response: Record<string, unknown>;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function providerBaseUrl() {
  return env.LUCKPAY_BASE_URL.replace(/\/$/, "");
}

function sanitizePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const raw = payload as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (/token|otp|aadhaar|pan|account/i.test(key)) continue;
    if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizePayload(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function extractAccessToken(payload: LuckpayTokenResponse): string | null {
  return (
    payload.access_token ??
    payload.token ??
    payload.data?.access_token ??
    payload.data?.token ??
    null
  );
}

function extractProviderUrl(payload: Record<string, unknown>): string | null {
  const candidates = [
    payload.redirectUrl,
    payload.redirect_url,
    payload.signUrl,
    payload.sign_url,
    payload.url,
    payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>).url : null,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function extractReferenceId(payload: Record<string, unknown>): string | null {
  const candidates = [
    payload.referenceId,
    payload.reference_id,
    payload.transactionId,
    payload.transaction_id,
    payload.requestId,
    payload.request_id,
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>).referenceId ?? (payload.data as Record<string, unknown>).transactionId
      : null,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

export async function getAccessToken(): Promise<string> {
  if (!env.LUCKPAY_PROVIDER_ENABLED) {
    throw Object.assign(new Error("Luckpay provider is disabled."), { statusCode: 503 });
  }
  if (!env.LUCKPAY_BASIC_TOKEN) {
    throw Object.assign(new Error("Luckpay basic token is not configured."), { statusCode: 503 });
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.value;

  const response = await axios.post<LuckpayTokenResponse>(
    env.LUCKPAY_AUTH_URL,
    {},
    {
      timeout: env.LUCKPAY_TIMEOUT_MS,
      headers: {
        Authorization: `Basic ${env.LUCKPAY_BASIC_TOKEN}`,
      },
    },
  );

  const token = extractAccessToken(response.data);
  if (!token) {
    throw Object.assign(new Error("Luckpay auth response did not contain an access token."), { statusCode: 502 });
  }

  cachedToken = {
    value: token,
    expiresAt: now + env.LUCKPAY_TOKEN_CACHE_TTL_SECONDS * 1000,
  };
  return token;
}

export async function esignWithUrl(input: LuckpayEsignInput): Promise<LuckpaySafeResponse> {
  if (!env.LUCKPAY_CLIENT_ID) {
    throw Object.assign(new Error("Luckpay client id is not configured."), { statusCode: 503 });
  }
  if (!fs.existsSync(input.filePath)) {
    throw Object.assign(new Error("Source file for eSign was not found."), { statusCode: 404 });
  }

  const token = await getAccessToken();
  const form = new FormData();
  const fileName = path.basename(input.filePath);
  const fileBuffer = fs.readFileSync(input.filePath);

  form.append("file", new Blob([fileBuffer]), fileName);
  form.append("request", JSON.stringify({
    clientTransactionId: input.clientTransactionId,
    signedBy: input.signedBy,
    location: input.location,
    reason: input.reason,
  }));

  const response = await axios.post(
    `${providerBaseUrl()}/eSignWithURL`,
    form,
    {
      timeout: env.LUCKPAY_TIMEOUT_MS,
      headers: {
        Authorization: env.LUCKPAY_CLIENT_ID,
        "X-Access-Token": `Bearer ${token}`,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    },
  );

  const payload = response.data && typeof response.data === "object"
    ? sanitizePayload(response.data)
    : { status: "unknown" };

  return {
    clientTransactionId: input.clientTransactionId,
    providerReferenceId: extractReferenceId(payload),
    providerUrl: extractProviderUrl(payload),
    status: typeof payload.status === "string" ? payload.status : "initiated",
    response: payload,
  };
}

export function generateClientTransactionId(prefix = "joining-doc") {
  return `${prefix}-${randomUUID()}`;
}
