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
