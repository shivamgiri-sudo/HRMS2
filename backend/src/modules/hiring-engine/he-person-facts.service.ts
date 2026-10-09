/**
 * Person facts, resolved ONCE per analytics build (or trend / dashboard read) instead of inside every statement: per he_lead, whether the
 * person is Meta-origin (meta_lead_id or a he_lead_campaign link) and whether their first form fill is Live (on or after the cutoff). The
 * statements return only the row-level signals next to the lead id (tl = lead id, tm = Meta stream credit / Meta-sourced drive / a
 * follow-up row's own meta_lead_id, tr = activity on or after the cutoff, tx = a row's own first-fill verdict where it is not the lead's),
 * and typeOf() applies the shared rule of he-source-attribution.ts in JS. One keyed statement per 500 lead ids (he_lead by primary key).
 */
import type { RowDataPacket } from "mysql2";
import { limitedDb } from "./he-read-limit.js";
import { cutoffSql, liveFirstFillSql, metaDriveSql, metaOriginSql } from "./he-source-attribution.js";
import type { SourceType } from "./qualified-followup.types.js";

const CI = "COLLATE utf8mb4_unicode_ci";
const BATCH = 500;
const UUIDISH = /^[0-9A-Za-z-]{1,64}$/;

export const personFactsSql = (n: number, liveFrom: string): string => `SELECT l.id, ${metaOriginSql("l")} AS pm, ${liveFirstFillSql("l", "lf", liveFrom)} AS fl
  FROM he_lead l LEFT JOIN meta_lead_raw lf ON lf.id = l.meta_lead_id ${CI}
 WHERE l.id IN (${Array(n).fill("?").join(",")})`;

/** Row-level signals that go next to a lead id. `extraMeta`: one more Meta signal of the row itself. */
export function typeKeyColsSql(o: { streams: boolean; d: string; leadId: string; ref: string; liveFrom: string; stream?: string; extraMeta?: string }): string {
  const credit = o.streams ? `${o.stream ?? "rs"}.source_type IN ('meta_live','meta_old') OR ` : "";
  return `${o.leadId} AS tl, (${credit}${metaDriveSql(o.d)}${o.extraMeta ? ` OR ${o.extraMeta}` : ""}) AS tm, (${o.ref} >= ${cutoffSql(o.liveFrom)}) AS tr`;
}
/** Column names of typeKeyColsSql (for GROUP BY). */
export const TYPE_KEY_GROUP = "tl, tm, tr";

export interface TypeKeys { tl?: unknown; tm?: unknown; tr?: unknown; tx?: unknown; source_type?: unknown }
const one = (v: unknown): boolean => Number(v) === 1;

export class PersonFacts {
  private readonly known = new Map<string, { pm: boolean; fl: boolean }>();
  private readonly pending = new Map<string, Promise<void>>();
  constructor(readonly liveFrom: string) {}

  /** Loads the facts of every id not loaded yet; ids another reader is already loading are awaited, never read twice. Throws on a failed
   *  read (the caller's section handles it). */
  async load(ids: Iterable<unknown>): Promise<void> {
    const wanted = [...new Set([...ids].filter((x): x is string => typeof x === "string" && UUIDISH.test(x) && !this.known.has(x)))];
    const missing = wanted.filter((x) => !this.pending.has(x));
    for (let i = 0; i < missing.length; i += BATCH) {
      const b = missing.slice(i, i + BATCH);
      const p = (async () => {
        const [rows] = await limitedDb.execute<RowDataPacket[]>(personFactsSql(b.length, this.liveFrom), b);
        for (const id of b) this.known.set(id, { pm: false, fl: false }); // an id with no he_lead row is not Meta-origin
        for (const r of rows) this.known.set(String(r.id), { pm: one(r.pm), fl: one(r.fl) });
      })();
      p.catch(() => undefined).finally(() => { for (const id of b) this.pending.delete(id); });
      for (const id of b) this.pending.set(id, p);
    }
    await Promise.all([...new Set(wanted.map((x) => this.pending.get(x)).filter((x): x is Promise<void> => !!x))]);
  }

  /** Loads the facts the rows need. */
  async loadRows(rows: Array<TypeKeys | RowDataPacket>): Promise<void> { await this.load(rows.map((r) => r.tl)); }

  /** A lead's facts (an unknown or missing lead is not Meta-origin). */
  factOf(tl: unknown): { pm: boolean; fl: boolean } {
    return (typeof tl === "string" ? this.known.get(tl) : undefined) ?? { pm: false, fl: false };
  }

  /** The shared rule over a row's signals and its person's facts; a row without signals keeps the type it carries. */
  typeOf(r: TypeKeys | RowDataPacket): SourceType {
    if (r.tl === undefined && r.tm === undefined) return (r.source_type as SourceType) ?? "he";
    const f = typeof r.tl === "string" ? this.known.get(r.tl) : undefined;
    if (!(f?.pm || one(r.tm))) return "he";
    const firstLive = r.tx !== undefined && r.tx !== null ? one(r.tx) : !!f?.fl;
    return firstLive && one(r.tr) ? "meta_live" : "meta_old";
  }
}
