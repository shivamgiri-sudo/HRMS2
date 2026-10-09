/**
 * hrms2-workers starts at the same time as the API and never runs migrations (the API runs them before it listens). A scheduler that needs
 * new schema waits here until the ledger (schema_migrations, success = 1) records its migrations: poll every 10 s, log once a minute, and
 * after 15 minutes start anyway (the statements have safe fallbacks for a missing schema; see followup-schema-guard).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";

/** The follow-up / selection migrations the Hiring Engine scheduler reads. */
export const ENGINE_MIGRATIONS: readonly string[] = [
  "migrations/2138_unified_followup.sql", "migrations/2140_walkin_invite.sql", "migrations/2141_candidate_response.sql",
  "migrations/2142_campaign_requisition.sql", "migrations/2145_requisition_selection_rules.sql", "migrations/2146_selection_person_fact.sql",
  "migrations/2147_shortlist_decisions.sql", "migrations/2148_followup_shortlist_link.sql",
];

export interface WaitDeps {
  applied?: (files: readonly string[]) => Promise<string[]>;
  now?: () => number; sleep?: (ms: number) => Promise<void>; log?: (msg: string) => void;
  pollMs?: number; logEveryMs?: number; maxWaitMs?: number;
}

async function appliedFromLedger(files: readonly string[]): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT filename FROM schema_migrations WHERE success = 1 AND filename IN (${files.map(() => "?").join(",")})`, [...files]);
  return rows.map((r) => String(r.filename));
}

export async function waitForMigrations(files: readonly string[], d: WaitDeps = {}): Promise<{ ready: boolean; missing: string[]; waitedMs: number }> {
  const applied = d.applied ?? appliedFromLedger;
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.()));
  const log = d.log ?? ((m: string) => console.warn(m));
  const pollMs = d.pollMs ?? 10_000, logEveryMs = d.logEveryMs ?? 60_000, maxWaitMs = d.maxWaitMs ?? 15 * 60_000;
  const start = now();
  let lastLog = -Infinity;
  let missing = [...files];
  for (;;) {
    try {
      const done = new Set(await applied(files));
      missing = files.filter((f) => !done.has(f));
    } catch { /* ledger not readable yet: keep the last answer and retry */ }
    const waited = now() - start;
    if (!missing.length) return { ready: true, missing: [], waitedMs: waited };
    if (waited >= maxWaitMs) {
      log(`[workers] migrations still not recorded after ${Math.round(waited / 60_000)} min (${missing.join(", ")}): starting anyway with the safe fallbacks`);
      return { ready: false, missing, waitedMs: waited };
    }
    if (waited - lastLog >= logEveryMs) { lastLog = waited; log(`[workers] waiting for the API to apply migrations before starting the Hiring Engine scheduler: ${missing.join(", ")}`); }
    await sleep(pollMs);
  }
}
