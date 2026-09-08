/**
 * The upstream databases a KPI source may read, by name.
 *
 * WHY THIS EXISTS
 * ---------------
 * A source could read two things: mas_hrms (`local_query`, via the shared pool)
 * or a connector registered in integration_config. Neither reaches the databases
 * this system already talks to every day. onfido_db and bella_db each have their
 * own credentials in the environment and their own pool module, so:
 *
 *   local_query           -> "Access denied for user 'shivam_user' to 'onfido_db'"
 *   integration_connector -> needs the credential copied into integration_config
 *
 * The second is worse than it looks. provider-config's own comment makes the
 * point: a credential that lives in two places is two records of one secret that
 * can disagree, and rotating one leaves the other silently stale.
 *
 * So a source may instead name a pool that ALREADY EXISTS in this codebase. The
 * credential stays exactly where it is — in the environment, read by that pool's
 * own module — and nothing is copied anywhere.
 *
 * ADDING ONE
 * ----------
 * Add a row below pointing at the module's existing accessor. Nothing else. The
 * name is what a source stores in integration_key, so keep it short and stable;
 * changing one orphans every source that named it.
 *
 * Deliberately a fixed map rather than anything dynamic: the value arrives from
 * stored configuration, and only a key present here can ever resolve to a
 * connection.
 */
import type { Pool } from 'mysql2/promise';
import { getDialerPool } from '../../db/dialerDb.js';
import { getOnfidoPool } from '../../db/onfidoDb.js';
import { getBellaPool } from '../../db/bellaDb.js';
import { getAprPool } from '../../db/aprDb.js';
import { getMasmisPool } from '../../db/masmisDb.js';

export interface NamedPool {
  /** Shown when picking a source, so the list reads as places rather than keys. */
  label: string;
  /** What it holds, for the same reason. */
  description: string;
  get: () => Promise<Pool> | Pool;
}

export const NAMED_POOLS: Readonly<Record<string, NamedPool>> = Object.freeze({
  dialer: {
    label: 'Dialer (dialer_db)',
    description: 'Call detail and agent activity logs. ~66M rows, current to yesterday.',
    get: getDialerPool,
  },
  onfido: {
    label: 'Onfido (onfido_db)',
    description: 'DOC and POA task, audit and escalation extracts.',
    get: getOnfidoPool,
  },
  bella: {
    label: 'Bella Vita (bella_db)',
    description: 'Sales lines, lead allocation, target plan and cancellations, uploaded monthly.',
    get: getBellaPool,
  },
  apr: {
    label: 'APR productivity',
    description: 'Agent productivity reports.',
    get: getAprPool,
  },
  masmis: {
    label: 'MIS (db_masmis)',
    description: 'Client operational exports: orders, chat tickets, allocations.',
    get: getMasmisPool,
  },
});

export type NamedPoolKey = keyof typeof NAMED_POOLS;

export function isNamedPool(key: unknown): key is string {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(NAMED_POOLS, key);
}

/**
 * Resolves a pool by name.
 *
 * Throws rather than returning null: a source naming a pool that is not here is
 * misconfigured, and failing loudly at read time beats returning no rows, which
 * reads as "this client has no data".
 */
export async function getNamedPool(key: string): Promise<Pool> {
  const entry = NAMED_POOLS[key];
  if (!entry) {
    throw new Error(
      `"${key}" is not a database this system knows. Choose one of: ${Object.keys(NAMED_POOLS).join(', ')}`,
    );
  }
  return await entry.get();
}

/** For the picker, and for an error message that can name the alternatives. */
export function listNamedPools(): Array<{ key: string; label: string; description: string }> {
  return Object.entries(NAMED_POOLS).map(([key, value]) => ({
    key,
    label: value.label,
    description: value.description,
  }));
}
