/**
 * People per stage from events (not from the current match state), one person per requisition, typed by the shared source rule
 * (he-source-attribution.ts). A person is keyed by their 10-digit mobile. Stages nest: lead (0) <= contacted (1) <= invited (2) <=
 * confirmed (3) <= arrived (4), a person's stage is the furthest any of their rows reached:
 *   - form fills of the requisitions' campaigns imported in the window (lead; screening 'qualified' marks qualified), Live / Old by fill time;
 *   - people lined up on the window's drives, by current match state (so nothing the state buckets counted is lost);
 *   - sent outbound messages of the requisitions in the window (a walk-in invite is invited, any other message contacted; a failed send
 *     is neither), so an invite on a drive that was later closed or re-matched still counts;
 *   - confirmation events (confirmed / call_confirmed) in the window, credited to the requisition of the person's last outbound message
 *     before the event (the events carry no requisition), so a confirmation whose match later became no_show or was deleted still counts;
 *   - arrival events on the window's drives.
 * Selected / joined per person follow the drive credit rule (he-drive-credit.ts) on the window's drives, for the per-campaign rows; the
 * typed totals keep the analytics outcomes read. One type per person and requisition (the person rule: Live only for a first form fill on
 * or after the cutoff and activity on or after it) and one campaign: the campaign of the person's first fill (he_lead.meta_lead_id), or
 * of the fill itself for a person not in the pool. Each part starts from an index range: meta_campaign by
 * requisition, he_drive by requisition + date, he_message by idx_he_msg_req (forced: on a small table the optimizer would scan it),
 * he_lead_event by idx_he_event_type_time or idx_he_event_drive;
 * everything else by key. Counts and ids only.
 */
import type { RowDataPacket } from "mysql2";
import { limitedDb } from "./he-read-limit.js";
import { driveCreditSql } from "./he-drive-credit.js";
import { readAgg } from "./he-drive-trend.service.js";
import { creditJoinsSql, fillFirstCampaignSql, fillPhoneSql, fillTypeSql } from "./he-source-attribution.js";
import { PersonFacts, typeKeyColsSql } from "./he-person-facts.service.js";
import type { SourceType } from "./qualified-followup.types.js";
import { addDays } from "./requisition-stream.window.js";

export interface PersonStages { leads: number; invited: number; confirmed: number; arrived: number }
export interface CampaignProgressRow {
  campaignId: string | null; requisitionId: string; sourceType: "meta_live" | "meta_old";
  leads: number; qualified: number; contacted: number; invited: number; confirmed: number; arrived: number; selected: number; joined: number;
}

const ph = (n: number): string => Array(n).fill("?").join(",");
const CI = "COLLATE utf8mb4_unicode_ci";
const { joined: FLAG_JOINED, selected: FLAG_SELECTED } = driveCreditSql({ m: "m", d: "d", hl: "al", ac: "ac" });

/**
 * Every part yields: cur (1 = the window, 0 = the previous window), person, requisition_id, fill type rank (form fills, typed in SQL by
 * fillTypeSql; NULL for other rows), the person signals of other rows (tl lead id, tm Meta credit / drive, tr activity on or after the
 * cutoff), campaign_id, cpri (campaign tie-break), stage, q, sel, joi. One statement covers the window and the previous window (`cur` is the
 * first column of each part, so its parameter comes first); the campaign of a fill's person is looked up for the window's rows only.
 * Form fills are read by import time (idx_ml_created, forced: the campaign index would read every fill of the campaign, with its payload).
 * The result is one row per person and requisition (no names, no mobiles); PersonFacts types it in JS (personType).
 */
export const personsSql = (n: number, streams: boolean, liveFrom: string): string => {
  const keys = (leadId: string, ref: string): string => typeKeyColsSql({ streams, d: "d", leadId, ref, liveFrom });
  const joins = (leadId: string, requisition: string): string => `${creditJoinsSql({ streams, match: "m", requisition })}
          LEFT JOIN he_lead al ON al.id = ${leadId}
          LEFT JOIN meta_lead_raw alf ON alf.id = al.meta_lead_id ${CI}`;
  const ids = ph(n);
  return `SELECT p.cur, p.requisition_id, p.tl, p.frank, p.lead_rows, p.any_m, p.any_r, p.any_mr, p.campaign_id, p.stage, p.q, p.sel, p.joi
  FROM (
    SELECT u.cur, u.person, u.requisition_id, MIN(u.ft) AS frank, MAX(u.tl) AS tl, MAX(u.ft IS NULL) AS lead_rows,
           MAX(u.ft IS NULL AND u.tm) AS any_m, MAX(u.ft IS NULL AND u.tr) AS any_r, MAX(u.ft IS NULL AND u.tm AND u.tr) AS any_mr,
           NULLIF(SUBSTRING(MAX(CONCAT(u.cpri, COALESCE(u.campaign_id, ''))), 2), '') AS campaign_id,
           MAX(u.stage) AS stage, MAX(u.q) AS q, MAX(u.sel) AS sel, MAX(u.joi) AS joi
      FROM (
        SELECT (r.created_at >= ?) AS cur, ${fillPhoneSql("r")} ${CI} AS person, mc.requisition_id ${CI} AS requisition_id,
               FIELD(${fillTypeSql("r", liveFrom)}, 'meta_live', 'meta_old', 'he') AS ft, NULL AS tl, 0 AS tm, 0 AS tr,
               IF(r.created_at >= ?, ${fillFirstCampaignSql("r")}, NULL) ${CI} AS campaign_id, 1 AS cpri, 0 AS stage,
               (r.screening_result = 'qualified') AS q, 0 AS sel, 0 AS joi
          FROM meta_lead_raw r FORCE INDEX (idx_ml_created) STRAIGHT_JOIN meta_campaign mc ON mc.id = r.campaign_id ${CI}
         WHERE mc.requisition_id IN (${ids}) AND (r.requisition_id IS NULL OR r.requisition_id = mc.requisition_id) AND r.parsed_phone IS NOT NULL
           AND r.created_at >= ? AND r.created_at < ?
        UNION ALL
        SELECT (d.drive_date >= ?), al.mobile10 ${CI}, d.requisition_id ${CI}, NULL, ${keys("m.lead_id", "d.drive_date")}, alf.campaign_id ${CI}, 1,
               CASE WHEN m.state IN ('arrived','selected') THEN 4 WHEN m.state = 'confirmed' THEN 3 WHEN m.state IN ('invited','slot_released','no_show') THEN 2 ELSE 0 END,
               0, ${FLAG_SELECTED}, ${FLAG_JOINED}
          FROM he_drive d JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id
          ${joins("m.lead_id", "d.requisition_id")}
          LEFT JOIN ats_candidate ac ON ac.id = al.ats_candidate_id ${CI}
         WHERE d.requisition_id IN (${ids}) AND d.drive_date BETWEEN ? AND ?
        UNION ALL
        SELECT x.cur, x.mobile10 ${CI}, x.requisition_id ${CI}, NULL, ${keys("x.lead_id", "x.last_at")}, alf.campaign_id ${CI}, 1, x.stage, 0, 0, 0
          FROM (SELECT (hm.created_at >= ?) AS cur, hm.mobile10, hm.requisition_id, hm.lead_id, hm.drive_id,
                       MAX(IF(hm.template_key LIKE 'he_walkin_invite%', 2, 1)) AS stage, MAX(hm.created_at) AS last_at
                  FROM he_message hm FORCE INDEX (idx_he_msg_req) WHERE hm.requisition_id IN (${ids}) AND hm.created_at >= ? AND hm.created_at < ? AND hm.direction = 'out'
                   AND (hm.delivery_status IS NULL OR hm.delivery_status <> 'failed')
                 GROUP BY 1, hm.mobile10, hm.requisition_id, hm.lead_id, hm.drive_id) x
          LEFT JOIN he_drive d ON d.id = x.drive_id
          LEFT JOIN he_match m ON m.lead_id = x.lead_id AND m.requisition_id = x.requisition_id
          ${joins("x.lead_id", "x.requisition_id")}
        UNION ALL
        SELECT (ev.created_at >= ?), al.mobile10 ${CI}, x.requisition_id ${CI}, NULL, ${keys("ev.lead_id", "ev.created_at")}, alf.campaign_id ${CI}, 1, 3, 0, 0, 0
          FROM he_lead_event ev JOIN he_message x ON x.id = (SELECT h.id FROM he_message h WHERE h.lead_id = ev.lead_id AND h.direction = 'out'
                 AND h.requisition_id IS NOT NULL AND (h.delivery_status IS NULL OR h.delivery_status <> 'failed') AND h.created_at <= ev.created_at
                 ORDER BY h.created_at DESC, h.id DESC LIMIT 1)
          LEFT JOIN he_drive d ON d.id = x.drive_id
          LEFT JOIN he_match m ON m.lead_id = ev.lead_id AND m.requisition_id = x.requisition_id
          ${joins("ev.lead_id", "x.requisition_id")}
         WHERE ev.event_type IN ('confirmed','call_confirmed') AND ev.created_at >= ? AND ev.created_at < ? AND x.requisition_id IN (${ids})
        UNION ALL
        SELECT (d.drive_date >= ?), al.mobile10 ${CI}, d.requisition_id ${CI}, NULL, ${keys("ev.lead_id", "d.drive_date")}, alf.campaign_id ${CI}, 1, 4, 0, 0, 0
          FROM he_drive d JOIN he_lead_event ev ON ev.drive_id = d.id AND ev.event_type = 'arrived'
          LEFT JOIN he_match m ON m.lead_id = ev.lead_id AND m.requisition_id = d.requisition_id
          ${joins("ev.lead_id", "d.requisition_id")}
         WHERE d.requisition_id IN (${ids}) AND d.drive_date BETWEEN ? AND ?
      ) u
     WHERE u.person IS NOT NULL AND u.person <> ''
     GROUP BY u.cur, u.person, u.requisition_id
  ) p`;
};

/**
 * One person's type from their rows' signals (the shared rule, exactly as typing each row and keeping the most-Meta one): form fills are
 * ranked in SQL (frank: 1 Live, 2 Old); other rows are Live when one of them is on or after the cutoff and Meta (the person is Meta-origin
 * or the row is) and the person's first fill is Live, Meta when the person or one of the rows is, else he.
 */
export function personType(r: Record<string, unknown> | RowDataPacket, facts: PersonFacts): SourceType {
  const one = (v: unknown): boolean => Number(v) === 1;
  let rank = Number.isFinite(Number(r.frank)) && r.frank !== null ? Number(r.frank) : 3;
  if (one(r.lead_rows)) {
    const f = facts.factOf(r.tl);
    const live = f.fl && (f.pm ? one(r.any_r) : one(r.any_mr));
    rank = Math.min(rank, live ? 1 : f.pm || one(r.any_m) ? 2 : 3);
  }
  return TYPE_BY_RANK[rank] ?? "he";
}
const TYPE_BY_RANK: Record<number, SourceType> = { 1: "meta_live", 2: "meta_old", 3: "he" };

/** Per-person rows (personsSql) to the per requisition, type and campaign counts aggregatePersons reads; other rows pass through. */
export function typePersonRows(rows: RowDataPacket[], facts: PersonFacts): Array<Record<string, unknown>> {
  if (!rows.length || rows[0].lead_rows === undefined) return rows;
  const acc = new Map<string, Record<string, unknown> & { leads: number; qualified: number; contacted: number; invited: number; confirmed: number; arrived: number; selected: number; joined: number }>();
  for (const r of rows) {
    const t = personType(r, facts);
    const key = `${String(r.cur)}|${String(r.requisition_id)}|${t}|${r.campaign_id == null ? "" : String(r.campaign_id)}`;
    let a = acc.get(key);
    if (!a) { a = { cur: r.cur, requisition_id: r.requisition_id, source_type: t, campaign_id: r.campaign_id ?? null, leads: 0, qualified: 0, contacted: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 }; acc.set(key, a); }
    const st = Number(r.stage ?? 0);
    a.leads += 1; a.qualified += Number(r.q ?? 0) > 0 ? 1 : 0; a.contacted += st >= 1 ? 1 : 0; a.invited += st >= 2 ? 1 : 0;
    a.confirmed += st >= 3 ? 1 : 0; a.arrived += st >= 4 ? 1 : 0; a.selected += Number(r.sel ?? 0) > 0 ? 1 : 0; a.joined += Number(r.joi ?? 0) > 0 ? 1 : 0;
  }
  return [...acc.values()];
}

const TYPES: readonly SourceType[] = ["meta_live", "meta_old", "he"];
const n0 = (v: unknown): number => { const x = Number(v ?? 0); return Number.isFinite(x) && x > 0 ? x : 0; };

/** Rows of one window (cur = 1) or all rows when no cur column is present. */
export function aggregatePersons(rows: RowDataPacket[] | Array<Record<string, unknown>>): { byType: Record<SourceType, PersonStages>; campaigns: CampaignProgressRow[] } {
  const zero = (): PersonStages => ({ leads: 0, invited: 0, confirmed: 0, arrived: 0 });
  const byType: Record<SourceType, PersonStages> = { meta_live: zero(), meta_old: zero(), he: zero() };
  const campaigns: CampaignProgressRow[] = [];
  for (const r of rows) {
    const t = TYPES.find((x) => x === r.source_type);
    if (!t) continue;
    const s = byType[t];
    s.leads += n0(r.leads); s.invited += n0(r.invited); s.confirmed += n0(r.confirmed); s.arrived += n0(r.arrived);
    if (t === "he") continue;
    campaigns.push({
      campaignId: r.campaign_id == null ? null : String(r.campaign_id), requisitionId: String(r.requisition_id), sourceType: t,
      leads: n0(r.leads), qualified: n0(r.qualified), contacted: n0(r.contacted), invited: n0(r.invited), confirmed: n0(r.confirmed), arrived: n0(r.arrived),
      selected: n0(r.selected), joined: n0(r.joined),
    });
  }
  return { byType, campaigns };
}

export interface CampaignProgress {
  campaignId: string | null; campaignName: string; campaignStatus: string | null; campaignRequisitionCode: string | null;
  requisitionId: string; requisitionCode: string; branch: string; sourceType: "meta_live" | "meta_old";
  stages: { leads: number; qualified: number; contacted: number; invited: number; confirmed: number; arrived: number; selected: number; joined: number };
}
const campaignsSql = (n: number): string => `SELECT mc.id, mc.campaign_name, mc.campaign_status, mc.requisition_id, jr.requisition_code
  FROM meta_campaign mc LEFT JOIN job_requisition jr ON jr.id = mc.requisition_id ${CI}
 WHERE mc.id IN (${ph(n)})`;

export const OTHER_BRANCH_CAMPAIGN = "Campaign of another branch";
/**
 * Names, status and the campaign's own requisition (one keyed statement), plus the code and branch of the requisition the activity is for.
 * A branch-scoped caller never sees a campaign whose own requisition is outside their scope (`heads` are the in-scope requisitions): its
 * rows keep their counts under a blank campaign ("Campaign of another branch") and are merged per requisition and type.
 */
export async function campaignProgress(rows: CampaignProgressRow[], heads: Map<string, { code: string; branch: string }>, scopeAll = true): Promise<CampaignProgress[]> {
  const ids = [...new Set(rows.map((r) => r.campaignId).filter((x): x is string => !!x))];
  const info = new Map<string, RowDataPacket>();
  for (let i = 0; i < ids.length; i += 200) {
    const b = ids.slice(i, i + 200);
    for (const r of (await limitedDb.execute<RowDataPacket[]>(campaignsSql(b.length), b))[0]) info.set(String(r.id), r);
  }
  const out = new Map<string, CampaignProgress>();
  for (const r of rows) {
    const found = r.campaignId ? info.get(r.campaignId) : undefined;
    const hidden = !scopeAll && !!r.campaignId && !heads.has(String(found?.requisition_id ?? ""));
    const c = hidden ? undefined : found;
    const campaignId = hidden ? null : r.campaignId;
    const h = heads.get(r.requisitionId);
    const { requisitionId, sourceType, ...counts } = r;
    delete (counts as Partial<CampaignProgressRow>).campaignId;
    const key = `${campaignId ?? (hidden ? "~other" : "~none")}|${requisitionId}|${sourceType}`;
    const prev = out.get(key);
    if (prev) { for (const k of Object.keys(prev.stages) as Array<keyof CampaignProgress["stages"]>) prev.stages[k] += counts[k]; continue; }
    out.set(key, {
      campaignId, campaignName: c ? String(c.campaign_name ?? "") : hidden ? OTHER_BRANCH_CAMPAIGN : campaignId ? "" : "No campaign",
      campaignStatus: c?.campaign_status == null ? null : String(c.campaign_status),
      campaignRequisitionCode: c?.requisition_code == null ? null : String(c.requisition_code), requisitionId, requisitionCode: h?.code ?? "", branch: h?.branch ?? "", sourceType,
      stages: { ...counts },
    });
  }
  return [...out.values()].sort((a, b) => a.requisitionCode.localeCompare(b.requisitionCode) || a.sourceType.localeCompare(b.sourceType)
    || Number(a.campaignId === null) - Number(b.campaignId === null) || b.stages.leads - a.stages.leads
    || a.campaignName.localeCompare(b.campaignName));
}

/**
 * The window and, with `prev`, the previous window (the days just before it) in one statement per 200 requisitions; throws on failure
 * (the caller's section handles it). `previous` is the previous window's per-type counts (no campaign rows).
 */
export async function readPersonStages(ids: string[], w: { from: string; to: string }, liveFrom: string, prev?: { from: string; to: string } | null, facts?: PersonFacts)
  : Promise<ReturnType<typeof aggregatePersons> & { previous: Record<SourceType, PersonStages> }> {
  const unique = [...new Set(ids)];
  // The window and the previous window run side by side (same statement, own bounds): every previous-window row has cur = 0 because its
  // bounds end where the window starts. The previous window holds bulk imports, so it must not hold up the window.
  const ranges: Array<{ from: string; to: string }> = [w, ...(prev ? [prev] : [])];
  const curAt = `${w.from} 00:00:00`;
  const reads: Array<Promise<RowDataPacket[]>> = [];
  for (const g of ranges) {
    const b = [`${g.from} 00:00:00`, `${addDays(g.to, 1)} 00:00:00`], d = [g.from, g.to];
    for (let i = 0; i < unique.length; i += 200) {
      const x = unique.slice(i, i + 200);
      reads.push(readAgg((st) => personsSql(x.length, st, liveFrom),
        [curAt, curAt, ...x, ...b, w.from, ...x, ...d, curAt, ...x, ...b, curAt, ...b, ...x, w.from, ...x, ...d]));
    }
  }
  const parts = await Promise.all(reads);
  const pf = facts ?? new PersonFacts(liveFrom);
  const raw = parts.flat();
  await pf.loadRows(raw);
  const rows = typePersonRows(raw, pf) as RowDataPacket[];
  const isCur = (r: RowDataPacket): boolean => r.cur === undefined || Number(r.cur) === 1;
  const cur = aggregatePersons(rows.filter(isCur));
  return { ...cur, previous: aggregatePersons(rows.filter((r) => !isCur(r))).byType };
}
