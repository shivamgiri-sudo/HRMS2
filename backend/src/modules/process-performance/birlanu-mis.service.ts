import { db } from "../../db/mysql.js";
import { buildMis, rowToFact, type Fact, type MisFilters, type RawRow } from "./birlanu-mis.js";

/**
 * Birlanu MIS feed: loads the lead rows of db_masmis.birlanu_sale (the reference
 * workbook's "Data" sheet, uploaded via Uploader -> Sale) and runs the pure
 * aggregation in birlanu-mis.ts. Read-only. The normalised rows are cached for
 * a minute so changing a filter on the dashboard does not re-read ~45k rows.
 */

const CACHE_MS = 60_000;
let cache: { at: number; facts: Fact[] } | null = null;

async function loadFacts(): Promise<Fact[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.facts;
  const [rows] = await db.execute<RawRow[] & import("mysql2").RowDataPacket[]>(
    `SELECT weeks, lead_register_month, lead_register_date, call_type, calling_status, interested_status,
            sub_calling_status, sub_sub_calling_status, enquiry_source, brand, organic_paid, lead_closer_status,
            lead_closer_month, seller_email_id, sale_mt, sale_inr, bucket, frt
       FROM db_masmis.birlanu_sale`,
  );
  const facts = (rows as RawRow[]).map(rowToFact);
  cache = { at: Date.now(), facts };
  return facts;
}

const clean = (v: unknown, max = 60): string | undefined => {
  const s = String(v ?? "").trim().slice(0, max);
  return s === "" || s.toLowerCase() === "all" ? undefined : s;
};

export async function getBirlanuMis(q: Record<string, unknown>) {
  const filters: MisFilters = {
    month: clean(q.month), week: clean(q.week), channel: clean(q.channel), brand: clean(q.brand),
    bau1: clean(q.bau1), bau2: clean(q.bau2), status: clean(q.status), closureMonth: clean(q.closureMonth),
  };
  return buildMis(await loadFacts(), filters);
}
