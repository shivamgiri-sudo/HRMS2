/**
 * Emergency stop for outbound notifications on the dispatchService path.
 *
 * The path this guards — notificationEventService.dispatch() ->
 * dispatchService.send() — carries the whole 53-event catalogue and consulted no
 * enable flag whatsoever. When esign-compliance sent 1,863 messages over three
 * days in August 2026, the only lever available was `pm2 stop hrms2-workers`,
 * which stops all 45 workers. This is the narrow lever that was missing.
 *
 * Deliberately NOT notification_event_config: recipient_spec there is
 * `json NOT NULL` and the gateway resolves recipients from it, so a row inserted
 * merely to get an on/off flag asserts a recipient policy this path never reads.
 * See migration 1112 for the full reasoning.
 *
 * Fails OPEN, and that asymmetry is the point. The esign cooldown (1109) fails
 * CLOSED because there the danger is sending too much; here the danger is sending
 * nothing, so a database blip must not silence payslip and leave notifications.
 * An operator's explicit `blocked = 1` is the only thing that stops mail.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";

/** Short enough that flipping the switch is felt quickly, long enough to spare the DB. */
const TTL_MS = 60_000;

interface BlockRow extends RowDataPacket {
  scope: string;
  blocked: number;
  reason: string | null;
}

let cache: { at: number; blocked: Map<string, string | null> } | null = null;

async function loadBlocks(): Promise<Map<string, string | null>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.blocked;

  try {
    const [rows] = await db.query<BlockRow[]>(
      `SELECT scope, blocked, reason FROM notification_dispatch_block WHERE blocked = 1`,
    );
    const blocked = new Map<string, string | null>();
    for (const r of rows) blocked.set(String(r.scope), r.reason ?? null);
    cache = { at: Date.now(), blocked };
    return blocked;
  } catch {
    // Table absent (migration not yet applied) or a DB blip. Allow — see the
    // fail-open note above. Cached so a hard outage does not add a query per
    // notification on top of whatever is already wrong.
    cache = { at: Date.now(), blocked: new Map() };
    return cache.blocked;
  }
}

export interface DispatchBlock {
  blocked: boolean;
  /** 'global' or the event code that matched — named in the log line. */
  scope?: string;
  reason?: string | null;
}

/**
 * Whether outbound delivery is currently stopped, globally or for this event.
 *
 * `eventCode` is optional: callers that do not identify their event still get
 * the global stop, which is the one that matters in an incident.
 */
export async function getDispatchBlock(eventCode?: string): Promise<DispatchBlock> {
  const blocks = await loadBlocks();
  if (blocks.size === 0) return { blocked: false };

  if (blocks.has("global")) {
    return { blocked: true, scope: "global", reason: blocks.get("global") ?? null };
  }
  if (eventCode && blocks.has(eventCode)) {
    return { blocked: true, scope: eventCode, reason: blocks.get(eventCode) ?? null };
  }
  return { blocked: false };
}

/** Test/ops hook: drop the cache so a flipped switch is honoured immediately. */
export function clearDispatchBlockCache(): void {
  cache = null;
}
