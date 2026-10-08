/**
 * Luckpay credential resolution: org_settings first, server env as fallback.
 *
 * DigiLocker and eSign resolve through the `luckpay_digilocker_*` keys, which
 * fall back to the PAN/UAN/Penny-Drop values when unset. In production all five
 * endpoints share one account and one base URL, so the DigiLocker-specific keys
 * are normally empty and the fallback is the live path. They remain supported so
 * a separate staging/production DigiLocker account can still be configured.
 */
import { env } from "../../../config/env.js";
import { loadBgvDbConfig, type BgvDbConfig } from "../../ats/bgv-config.store.js";
import { normalizeLuckpayConfig, type LuckpayResolvedConfig } from "./luckpay.transport.js";

export type LuckpayScope = "core" | "digilocker";

/** Base URL implied by the server env, honouring LUCKPAY_ENV. */
export function envLuckpayBaseUrl(): string {
  return env.LUCKPAY_ENV === "production" ? env.LUCKPAY_PROD_BASE_URL : env.LUCKPAY_BASE_URL;
}

/**
 * Last config resolved per scope. getRuntimeStatus() must stay synchronous (its
 * callers don't await it), so it reads these snapshots instead of re-resolving.
 * "core" wins when both are present; in production they are identical anyway.
 */
const lastResolved: Partial<Record<LuckpayScope, LuckpayResolvedConfig>> = {};

export function getLastResolvedLuckpayConfig(): LuckpayResolvedConfig {
  return lastResolved.core ?? lastResolved.digilocker ?? normalizeLuckpayConfig({
    baseUrl: envLuckpayBaseUrl(),
    basicToken: env.LUCKPAY_BASIC_TOKEN,
    clientId: env.LUCKPAY_CLIENT_ID,
    source: "env",
  });
}

/** Test/admin hook — drops the snapshots so runtime status reflects fresh config. */
export function resetLuckpayConfigSnapshot(): void {
  delete lastResolved.core;
  delete lastResolved.digilocker;
}

/** Synchronous resolution from an already-loaded org_settings config. No DB access. */
export function resolveLuckpayConfigFrom(
  dbCfg: BgvDbConfig | null | undefined,
  scope: LuckpayScope,
): LuckpayResolvedConfig {
  const baseUrl = scope === "digilocker"
    ? (dbCfg?.luckpay_digilocker_base_url ?? dbCfg?.luckpay_api_url)
    : dbCfg?.luckpay_api_url;
  const basicToken = scope === "digilocker"
    ? (dbCfg?.luckpay_digilocker_basic_token ?? dbCfg?.luckpay_basic_token)
    : dbCfg?.luckpay_basic_token;
  const clientId = scope === "digilocker"
    ? (dbCfg?.luckpay_digilocker_client_id ?? dbCfg?.luckpay_client_id)
    : dbCfg?.luckpay_client_id;

  // A field falls back to env independently, so a DB row that only sets the URL
  // still picks up env credentials rather than silently resolving to empty.
  const resolved = normalizeLuckpayConfig({
    baseUrl: baseUrl ?? envLuckpayBaseUrl(),
    basicToken: basicToken ?? env.LUCKPAY_BASIC_TOKEN,
    clientId: clientId ?? env.LUCKPAY_CLIENT_ID,
    source: (baseUrl || basicToken || clientId) ? "db" : "env",
  });

  lastResolved[scope] = resolved;
  return resolved;
}

/** Resolves credentials, loading org_settings (30s TTL cache) when not supplied. */
export async function resolveLuckpayConfig(
  scope: LuckpayScope,
  dbCfg?: BgvDbConfig | null,
): Promise<LuckpayResolvedConfig> {
  const cfg = dbCfg !== undefined ? dbCfg : await loadBgvDbConfig();
  return resolveLuckpayConfigFrom(cfg, scope);
}
