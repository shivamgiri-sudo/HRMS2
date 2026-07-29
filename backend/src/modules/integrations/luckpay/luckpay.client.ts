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

const COMPLETED = ["completed", "complete", "verified", "signed", "approved", "done", "success"];
const FAILED = ["failed", "failure", "rejected", "declined", "cancelled", "canceled", "error"];
const EXPIRED = ["expired", "timeout", "timedout"];

/**
 * Where the real lifecycle state lives, per flow.
 *
 * For eSign this must NOT be `data.status`: that field reads "SUCCESS" on the
 * initiate call as well as on a completed signature — it reports whether the API
 * call worked, not whether anybody signed. The signing state is
 * esignDetails.agreement_status ("requested" -> "completed"). Reading data.status
 * would mark a document signed the instant it was sent out.
 *
 * For DigiLocker, data.status is the genuine state ("requested" -> "approved").
 */
const STATUS_PATHS: Record<"kyc" | "esign", string[]> = {
  kyc: ["details.status", "kycStatus", "status", "state"],
  esign: ["esignDetails.agreement_status", "esignDetails.signing_parties.0.status", "esignStatus"],
};

function toStatusResult(
  response: LuckpayResponse,
  ref: LuckpayTransactionRef,
  kind: "kyc" | "esign",
): LuckpayStatusResult {
  const providerStatus = pickLuckpayField(response, STATUS_PATHS[kind]);
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
    // gatewayId is Luckpay's transaction identifier — the value every
    // status/download call expects as `transactionId`.
    transactionId: pickLuckpayField(response, ["gatewayId", "transactionId", "transaction_id"]) ?? ref.transactionId,
    clientTransactionId: pickLuckpayField(response, ["clientTransactionId", "client_transaction_id"]) ?? ref.clientTransactionId,
    message: pickLuckpayField(response, ["responseMessage", "message", "statusDescription", "description"]),
    sanitized: response.sanitized,
  };
}

function decodeBase64(value: string | null): Buffer | null {
  if (!value || /^https?:\/\//i.test(value)) return null;
  const cleaned = value.replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
  if (cleaned.length < 32 || !/^[A-Za-z0-9+/=]+$/.test(cleaned)) return null;
  const decoded = Buffer.from(cleaned, "base64");
  return decoded.length ? decoded : null;
}

/**
 * Extracts the document from a download response.
 *
 * The two endpoints differ, and both nest the payload:
 *   downloadESignDocument -> data.esignDownloadDetails.file  = base64 PDF
 *   downloadKycDocument   -> data.details.file               = base64 of a JSON
 *                            wrapper {file_in_base64, size_in_bytes, file_name,
 *                            file_type}, so the bytes need decoding twice.
 */
function toDocumentResult(response: LuckpayResponse): LuckpayDocumentResult {
  const raw = pickLuckpayField(response, [
    "esignDownloadDetails.file", "details.file", "esignDetails.file",
    "document", "documentBase64", "fileBase64", "base64", "fileContent", "content", "file",
  ]);
  const url = pickLuckpayField(response, [
    "documentUrl", "document_url", "fileUrl", "file_url", "downloadUrl", "download_url", "url",
  ]);

  let buffer = decodeBase64(raw);
  let fileName = pickLuckpayField(response, [
    "details.file_name", "esignDownloadDetails.file_name", "esignDetails.file_name",
    "fileName", "file_name", "documentName", "document_name",
  ]);
  let contentType = pickLuckpayField(response, ["contentType", "content_type", "mimeType", "mime_type"]);

  // Unwrap the KYC JSON envelope when present. Detected by content rather than
  // by endpoint so either endpoint may return either shape.
  if (buffer && buffer[0] === 0x7b /* '{' */) {
    try {
      const wrapper = JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;
      const inner = decodeBase64(String(wrapper.file_in_base64 ?? wrapper.fileInBase64 ?? ""));
      if (inner) {
        buffer = inner;
        fileName = (wrapper.file_name as string) ?? (wrapper.fileName as string) ?? fileName;
        contentType = (wrapper.file_type as string) ?? (wrapper.fileType as string) ?? contentType;
      }
    } catch {
      // Not the wrapper shape — keep the bytes we already decoded.
    }
  }

  return {
    buffer,
    url: url && /^https?:\/\//i.test(url) ? url : null,
    fileName,
    contentType,
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
      // gatewayId is Luckpay's transaction id and the value checkKycStatus /
      // checkESignStatus expect back as `transactionId`. Without it the
      // completion half has nothing to poll with.
      providerReferenceId: pickLuckpayField(response, [
        "gatewayId",
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
        "gatewayId",
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
    return toStatusResult(response, payload, "kyc");
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
    return toStatusResult(response, payload, "esign");
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
