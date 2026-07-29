/**
 * Luckpay client facade.
 *
 * Thin wrapper over luckpay.transport.ts. Kept at this path with its original
 * export surface so existing call sites and test mocks are unaffected. All HTTP,
 * token caching and PII masking now live in the transport; credential resolution
 * (org_settings first, env fallback) lives in luckpay.config.ts.
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { env } from "../../../config/env.js";
import {
  assertLuckpayCredentials,
  assertLuckpayEnabled,
  getLuckpayDiagnostics,
  luckpayPostJson,
  luckpayPostMultipart,
  pickLuckpayField,
  sanitizeProviderPayload,
  type LuckpayResponse,
} from "./luckpay.transport.js";
import { getLastResolvedLuckpayConfig, resolveLuckpayConfig } from "./luckpay.config.js";

export { sanitizeProviderPayload };

type SanitizedJson = Record<string, unknown>;

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

/** Both identifiers are required by every status/download endpoint. */
export type LuckpayTransactionRef = {
  /** Our id, generated at initiate time. */
  clientTransactionId: string;
  /** Luckpay's id, returned by verifyDigilockerWithURL / eSignWithURL. */
  transactionId: string;
};

export type LuckpayStatusResult = {
  /** Normalised lifecycle state. */
  state: "pending" | "completed" | "failed" | "expired";
  /** Provider's own status string, unmapped. */
  providerStatus: string | null;
  transactionId: string;
  clientTransactionId: string;
  message: string | null;
  sanitized: Record<string, unknown>;
};

export type LuckpayDocumentResult = {
  /** Decoded document bytes when the provider returns inline base64. */
  buffer: Buffer | null;
  /** Set instead of `buffer` when the provider returns a fetch URL. */
  url: string | null;
  fileName: string | null;
  contentType: string | null;
  sanitized: Record<string, unknown>;
};

const COMPLETED = ["success", "completed", "complete", "verified", "signed", "approved", "done"];
const FAILED = ["failed", "failure", "rejected", "declined", "cancelled", "canceled", "error"];
const EXPIRED = ["expired", "timeout", "timedout"];

function toStatusResult(response: LuckpayResponse, ref: LuckpayTransactionRef): LuckpayStatusResult {
  const providerStatus = pickLuckpayField(response, [
    "kycStatus", "esignStatus", "eSignStatus", "transactionStatus", "status", "state",
  ]);
  const lowered = (providerStatus ?? "").toLowerCase();
  // Default to "pending" — never treat an unrecognised status as terminal, or a
  // candidate's session could be closed out before they have actually finished.
  const state: LuckpayStatusResult["state"] =
    COMPLETED.some((s) => lowered === s || lowered.includes(s)) ? "completed"
    : FAILED.some((s) => lowered.includes(s)) ? "failed"
    : EXPIRED.some((s) => lowered.includes(s)) ? "expired"
    : "pending";

  return {
    state,
    providerStatus,
    transactionId: pickLuckpayField(response, ["transactionId", "transaction_id"]) ?? ref.transactionId,
    clientTransactionId: pickLuckpayField(response, ["clientTransactionId", "client_transaction_id"]) ?? ref.clientTransactionId,
    message: pickLuckpayField(response, ["message", "statusDescription", "description"]),
    sanitized: response.sanitized,
  };
}

function toDocumentResult(response: LuckpayResponse): LuckpayDocumentResult {
  // The provider may return the document inline as base64 or as a signed URL;
  // the contract is not pinned down, so accept either.
  const base64 = pickLuckpayField(response, [
    "document", "documentBase64", "fileBase64", "base64", "fileContent", "content", "data",
  ]);
  const url = pickLuckpayField(response, [
    "documentUrl", "document_url", "fileUrl", "file_url", "downloadUrl", "download_url", "url",
  ]);

  let buffer: Buffer | null = null;
  if (base64 && !/^https?:\/\//i.test(base64)) {
    // Tolerate data: URIs and stray whitespace from JSON pretty-printing.
    const cleaned = base64.replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
    if (cleaned.length > 64 && /^[A-Za-z0-9+/=]+$/.test(cleaned)) {
      const decoded = Buffer.from(cleaned, "base64");
      if (decoded.length) buffer = decoded;
    }
  }

  return {
    buffer,
    url: url && /^https?:\/\//i.test(url) ? url : null,
    fileName: pickLuckpayField(response, ["fileName", "file_name", "documentName", "document_name"]),
    contentType: pickLuckpayField(response, ["contentType", "content_type", "mimeType", "mime_type"]),
    sanitized: response.sanitized,
  };
}

/** DigiLocker and eSign both resolve through the digilocker scope (which falls back to the core credentials). */
async function digilockerConfig() {
  const cfg = await resolveLuckpayConfig("digilocker");
  assertLuckpayEnabled(cfg);
  assertLuckpayCredentials(cfg);
  return cfg;
}

export const luckpayClient = {
  generateClientTransactionId(prefix: string) {
    return `${prefix}-${randomUUID()}`;
  },

  async initiateDigilockerWithUrl(payload: LuckpayDigilockerPayload) {
    const cfg = await digilockerConfig();
    const response = await luckpayPostJson(cfg, "/verifyDigilockerWithURL", payload);
    return {
      raw: response.envelope,
      sanitized: response.sanitized as SanitizedJson,
      verificationUrl: pickLuckpayField(response, [
        "redirectUrl",
        "redirect_url",
        "verificationUrl",
        "verification_url",
      ]),
      providerReferenceId: pickLuckpayField(response, [
        "referenceId",
        "reference_id",
        "transactionId",
        "transaction_id",
      ]) ?? payload.clientTransactionId,
      status: pickLuckpayField(response, ["status"]) ?? "initiated",
    };
  },

  async initiateEsignWithUrl(payload: LuckpayEsignPayload) {
    const cfg = await digilockerConfig();
    const buffer = await fs.promises.readFile(payload.filePath);
    const response = await luckpayPostMultipart(cfg, "/eSignWithURL", {
      file: { buffer, filename: path.basename(payload.filePath) },
      request: payload.request,
    });
    return {
      raw: response.envelope,
      sanitized: response.sanitized as SanitizedJson,
      verificationUrl: pickLuckpayField(response, [
        "redirectUrl",
        "redirect_url",
        "signUrl",
        "sign_url",
      ]),
      providerReferenceId: pickLuckpayField(response, [
        "referenceId",
        "reference_id",
        "transactionId",
        "transaction_id",
      ]) ?? payload.request.clientTransactionId,
      status: pickLuckpayField(response, ["status"]) ?? "initiated",
    };
  },

  /**
   * Poll a DigiLocker session. Called after the candidate returns from the
   * provider-hosted flow — Luckpay does not reliably push a callback, so the
   * completion half of the flow is pull-based.
   */
  async checkKycStatus(payload: LuckpayTransactionRef) {
    const cfg = await digilockerConfig();
    const response = await luckpayPostJson(cfg, "/checkKycStatus", payload);
    return toStatusResult(response, payload);
  },

  /** Retrieve the DigiLocker/KYC documents once checkKycStatus reports success. */
  async downloadKycDocument(payload: LuckpayTransactionRef) {
    const cfg = await digilockerConfig();
    const response = await luckpayPostJson(cfg, "/downloadKycDocument", payload);
    return toDocumentResult(response);
  },

  /** Poll an eSign request for completion. */
  async checkESignStatus(payload: LuckpayTransactionRef) {
    const cfg = await digilockerConfig();
    const response = await luckpayPostJson(cfg, "/checkESignStatus", payload);
    return toStatusResult(response, payload);
  },

  /** Retrieve the signed PDF once checkESignStatus reports success. */
  async downloadESignDocument(payload: LuckpayTransactionRef) {
    const cfg = await digilockerConfig();
    const response = await luckpayPostJson(cfg, "/downloadESignDocument", payload);
    return toDocumentResult(response);
  },

  /**
   * Synchronous by contract — bgv-verification.routes.ts calls this without
   * awaiting. Reads the last resolved config snapshot rather than re-resolving.
   */
  getRuntimeStatus() {
    const cfg = getLastResolvedLuckpayConfig();
    const diagnostics = getLuckpayDiagnostics();
    return {
      enabled: env.LUCKPAY_PROVIDER_ENABLED,
      environment: env.LUCKPAY_ENV,
      baseUrl: cfg.baseUrl,
      configSource: cfg.source,
      lastTokenSuccessAt: diagnostics.lastSuccessAt,
      lastApiFailureAt: diagnostics.lastFailureAt,
      lastApiFailureMessage: diagnostics.lastFailureMessage,
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
