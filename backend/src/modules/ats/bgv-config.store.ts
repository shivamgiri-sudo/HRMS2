/**
 * BGV provider configuration store.
 *
 * Reads provider credentials from `org_settings` (written by Super Admin >
 * Settings > BGV Config). Kept as a leaf module — it imports nothing from the
 * adapter or the Luckpay transport — so both can depend on it without a cycle.
 */
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export interface BgvDbConfig {
  bgv_provider: string;
  infinity_ai_api_url?: string;
  infinity_ai_api_key?: string;
  infinity_ai_client_id?: string;
  infinity_ai_portal_url?: string;
  digio_api_url?: string;
  digio_client_id?: string;
  digio_client_secret?: string;
  digilocker_session_url?: string;
  digilocker_api_key?: string;
  digilocker_client_id?: string;
  befisc_api_url?: string;
  befisc_api_key?: string;
  luckpay_api_url?: string;              // PAN / Bank / UAN base URL
  luckpay_digilocker_base_url?: string;  // DigiLocker + eSign base URL (may differ from PAN URL)
  luckpay_digilocker_basic_token?: string; // separate token for DigiLocker/eSign if different account
  luckpay_digilocker_client_id?: string;   // separate client ID for DigiLocker/eSign if different account
  luckpay_basic_token?: string;
  luckpay_client_id?: string;
  crimescan_api_url?: string;
  crimescan_api_key?: string;
}

export const BGV_DB_CONFIG_KEYS = [
  "bgv_provider",
  "infinity_ai_api_url", "infinity_ai_api_key", "infinity_ai_client_id", "infinity_ai_portal_url",
  "digio_api_url", "digio_client_id", "digio_client_secret",
  "befisc_api_url", "befisc_api_key",
  "luckpay_api_url", "luckpay_basic_token", "luckpay_client_id",
  "luckpay_digilocker_base_url", "luckpay_digilocker_basic_token", "luckpay_digilocker_client_id",
  "crimescan_api_url", "crimescan_api_key",
];

export function cleanSettingValue(value: unknown): string | undefined {
  // Strip all whitespace including embedded newlines/carriage-returns that cause
  // "Invalid header value char" when credential tokens are pasted via the Admin UI.
  const str = String(value ?? "").replace(/\s+/g, "").trim();
  if (!str || str === "••••••••") return undefined;
  return str;
}

// ── Short-TTL cache ───────────────────────────────────────────────────────────
// getConfiguredBgvProviderAdapter() runs on every verification and every
// /provider-status poll; without this it issues an 18-key SELECT each time.
// The only writer is PUT /admin/provider-config, which calls
// resetBgvProviderAdapterCache() → resetBgvDbConfigCache(), so a credential
// change lands on the very next request. The TTL is only a backstop for direct
// SQL edits.

const BGV_CONFIG_TTL_MS = 30_000;
let _cfgCache: { value: BgvDbConfig | null; at: number } | null = null;

export function resetBgvDbConfigCache(): void {
  _cfgCache = null;
}

export async function loadBgvDbConfig(opts?: { force?: boolean }): Promise<BgvDbConfig | null> {
  const now = Date.now();
  if (!opts?.force && _cfgCache && now - _cfgCache.at < BGV_CONFIG_TTL_MS) {
    return _cfgCache.value;
  }

  const placeholders = BGV_DB_CONFIG_KEYS.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT setting_key, setting_value FROM org_settings WHERE setting_key IN (${placeholders})`,
    BGV_DB_CONFIG_KEYS,
  );

  let value: BgvDbConfig | null = null;
  if ((rows as RowDataPacket[]).length) {
    const cfg: Record<string, string> = {};
    for (const row of rows as RowDataPacket[]) {
      const clean = cleanSettingValue(row.setting_value);
      if (clean !== undefined) cfg[String(row.setting_key)] = clean;
    }
    value = cfg.bgv_provider ? (cfg as unknown as BgvDbConfig) : null;
  }

  _cfgCache = { value, at: now };
  return value;
}
