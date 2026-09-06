/**
 * The genuine per-channel kill switch — separate from communication_provider_config.is_enabled,
 * which does NOT stop a channel from sending (see provider.interface.ts's isConfigured() comment
 * and provider.factory.ts). This one is read by providerFactory itself, guarding every caller
 * (dispatch.service.ts, ats.otp.service.ts, ats.onboarding.service.ts) at one place.
 *
 * Same fail-open/cached philosophy as notification-dispatch-block.ts: an operator's explicit
 * send_blocked = 1 is the only thing that stops a channel, and a DB blip must not silence a
 * working one. Cached across BOTH a synchronous reader (providerFactory.getProvider(), which
 * cannot await a query) and an async one (getProviderAsync()) — the async reader refreshes the
 * cache when stale; the sync reader only ever consults whatever is already cached, which is a
 * deliberate trade: a pause flipped a few seconds ago might not yet be honoured by a sync caller,
 * but a pause is an admin action, not a millisecond-sensitive gate.
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../../../db/mysql.js';
import type { Channel } from '../communication.types.js';

const TTL_MS = 60_000;

interface BlockRow extends RowDataPacket {
  channel: Channel;
  block_reason: string | null;
}

export interface SendBlock {
  blocked: boolean;
  reason: string | null;
}

let cache: { at: number; blocked: Map<Channel, string | null> } | null = null;
let refreshing: Promise<Map<Channel, string | null>> | null = null;

async function refreshCache(): Promise<Map<Channel, string | null>> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const [rows] = await db.query<BlockRow[]>(
        `SELECT channel, block_reason FROM communication_provider_config WHERE send_blocked = 1`,
      );
      const blocked = new Map<Channel, string | null>();
      for (const r of rows) blocked.set(r.channel, r.block_reason ?? null);
      cache = { at: Date.now(), blocked };
      return blocked;
    } catch {
      // Table/column not yet migrated, or a DB blip. Fail OPEN — same reasoning as
      // notification-dispatch-block.ts: a killswitch that silences everything the moment
      // information_schema hiccups is a worse outage than the one it prevents.
      const blocked = new Map<Channel, string | null>();
      cache = { at: Date.now(), blocked };
      return blocked;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Async reader — refreshes when the cache is missing or stale. Used by getProviderAsync(). */
export async function isBlocked(channel: Channel): Promise<SendBlock> {
  if (!cache || Date.now() - cache.at >= TTL_MS) await refreshCache();
  const reason = cache!.blocked.get(channel);
  return { blocked: cache!.blocked.has(channel), reason: reason ?? null };
}

/**
 * Sync reader — used by getProvider(), which cannot await a query. Reads whatever is currently
 * cached (fails open to "not blocked" if nothing has been loaded yet) and kicks off a background
 * refresh so the NEXT call has fresher data; never blocks on it.
 */
export function isBlockedSync(channel: Channel): SendBlock {
  if (!cache) {
    void refreshCache();
    return { blocked: false, reason: null };
  }
  if (Date.now() - cache.at >= TTL_MS) void refreshCache(); // stale — refresh in the background, still answer from what we have
  const reason = cache.blocked.get(channel);
  return { blocked: cache.blocked.has(channel), reason: reason ?? null };
}

/** Test/ops hook: drop the cache so a flipped switch is honoured immediately. */
export function clearSendBlockCache(): void {
  cache = null;
}
