/**
 * Backfills the upload feeds (SBI Card collections, Bellavita chat, Clovia email) into kpi_daily_actual for the last N
 * days (default 45, max 93). Idempotent upserts; prints per-feed totals. Run on the production host via the ops workflow.
 *   npx tsx scripts/kpi-feed-backfill.ts [days]
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { syncUploadFeedsRange } from "../src/modules/kpi/kpi-upload-feeds.service.js";

const days = Math.min(93, Math.max(1, Number(process.argv[2] ?? 45) || 45));
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

try {
  const to = istToday();
  const from = new Date(new Date(`${to}T00:00:00Z`).getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
  console.log(`feed backfill ${from} -> ${to}`);
  const results = await syncUploadFeedsRange(from, to);
  const byFeed = new Map<string, { rows: number; written: number; unmapped: number; errors: Set<string>; days: number }>();
  for (const r of results) {
    const t = byFeed.get(r.feed) ?? { rows: 0, written: 0, unmapped: 0, errors: new Set<string>(), days: 0 };
    t.rows += r.rows; t.written += r.written; t.unmapped += r.unmapped; if (r.rows > 0) t.days++; if (r.error) t.errors.add(r.error);
    byFeed.set(r.feed, t);
  }
  for (const [feed, t] of byFeed) {
    console.log(`feed | ${feed} | source rows ${t.rows} | days with data ${t.days} | facts written ${t.written} | unmapped agent-days ${t.unmapped}${t.errors.size ? ` | ERRORS ${[...t.errors].join("; ")}` : ""}`);
  }
} finally {
  await (db as unknown as { end?: () => Promise<void> }).end?.();
  process.exit(0);
}
