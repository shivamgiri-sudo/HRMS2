import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const _cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

function cacheKey(domainKey: string, sectionKey: string, configKey: string): string {
  return `${domainKey}:${sectionKey}:${configKey}`;
}

export async function getPolicyValue(
  domainKey: string,
  sectionKey: string,
  configKey: string,
  fallback: string
): Promise<string> {
  const key = cacheKey(domainKey, sectionKey, configKey);
  const now = Date.now();

  const cached = _cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT config_value FROM business_policy_config
       WHERE domain_key = ? AND section_key = ? AND config_key = ?
         AND active_status = 1 AND effective_from <= CURDATE()
       ORDER BY effective_from DESC LIMIT 1`,
      [domainKey, sectionKey, configKey]
    );
    const value = rows[0]?.config_value ?? fallback;
    _cache.set(key, { value, expiresAt: now + TTL_MS });
    return value;
  } catch {
    return fallback;
  }
}

export function invalidatePolicyCache(domainKey: string): void {
  for (const key of _cache.keys()) {
    if (key.startsWith(`${domainKey}:`)) {
      _cache.delete(key);
    }
  }
}

export function invalidatePolicyCacheKey(
  domainKey: string,
  sectionKey: string,
  configKey: string
): void {
  _cache.delete(cacheKey(domainKey, sectionKey, configKey));
}
