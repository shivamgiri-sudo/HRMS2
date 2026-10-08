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
 * typed totals keep the analytics outcomes read. One type per person and requisition (Live before Old before he) and one campaign (an
 * in-window form fill's campaign first, else the person's first fill's campaign). Each part starts from an index range: meta_campaign by
 * requisition, he_drive by requisition + date, he_message by idx_he_msg_req (forced: on a small table the optimizer would scan it),
 * he_lead_event by idx_he_event_type_time or idx_he_event_drive;
 * everything else by key. Counts and ids only.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { driveCreditSql } from "./he-drive-credit.js";
import { readAgg } from "./he-drive-trend.service.js";
import { campaignFillTypeSql } from "./he-requisition-sources.service.js";
import { attributionJoinsSql, sourceTypeSql } from "./he-source-attribution.js";
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

/** Every part yields: person, requisition_id, source_type, campaign_id, cpri (2 = in-window fill), stage, q, sel, joi. */
export const personsSql = (n: number, streams: boolean, liveFrom: string): string => {
  const type = sourceTypeSql({ streams, d: "d", lead: "al", liveFrom });
  const joins = (leadId: string, requisition: string): string => attributionJoinsSql({ streams, match: "m", requisition, lead: "al", leadId });
  const ids = ph(n);
  return `SELECT p.requisition_id, p.source_type, p.campaign_id, COUNT(*) AS leads, SUM(p.q) AS qualified, SUM(p.stage >= 1) AS contacted,
       SUM(p.stage >= 2) AS invited, SUM(p.stage >= 3) AS confirmed, SUM(p.stage >= 4) AS arrived, SUM(p.sel) AS selected, SUM(p.joi) AS joined
  FROM (
    SELECT u.person, u.requisition_id, SUBSTRING(MIN(CONCAT(FIELD(u.source_type, 'meta_live', 'meta_old', 'he'), u.source_type)), 2) AS source_type,
           NULLIF(SUBSTRING(MAX(CONCAT(u.cpri, COALESCE(u.campaign_id, ''))), 2), '') AS campaign_id,
           MAX(u.stage) AS stage, MAX(u.q) AS q, MAX(u.sel) AS sel, MAX(u.joi) AS joi
      FROM (
        SELECT RIGHT(REGEXP_REPLACE(r.parsed_phone, '[^0-9]', ''), 10) ${CI} AS person, mc.requisition_id ${CI} AS requisition_id,
               ${campaignFillTypeSql("r", liveFrom)} AS source_type, r.campaign_id ${CI} AS campaign_id, 2 AS cpri, 0 AS stage,
               (r.screening_result = 'qualified') AS q, 0 AS sel, 0 AS joi
          FROM meta_campaign mc JOIN meta_lead_raw r ON r.campaign_id = mc.id
         WHERE mc.requisition_id IN (${ids}) AND (r.requisition_id IS NULL OR r.requisition_id = mc.requisition_id) AND r.parsed_phone IS NOT NULL
           AND r.created_at >= ? AND r.created_at < ?
        UNION ALL
        SELECT al.mobile10 ${CI}, d.requisition_id ${CI}, ${type}, alf.campaign_id ${CI}, 1,
               CASE WHEN m.state IN ('arrived','selected') THEN 4 WHEN m.state = 'confirmed' THEN 3 WHEN m.state IN ('invited','slot_released','no_show') THEN 2 ELSE 0 END,
               0, ${FLAG_SELECTED}, ${FLAG_JOINED}
          FROM he_drive d JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id
          ${joins("m.lead_id", "d.requisition_id")}
          LEFT JOIN ats_candidate ac ON ac.id = al.ats_candidate_id ${CI}
         WHERE d.requisition_id IN (${ids}) AND d.drive_date BETWEEN ? AND ?
        UNION ALL
        SELECT x.mobile10 ${CI}, x.requisition_id ${CI}, ${type}, alf.campaign_id ${CI}, 1, x.stage, 0, 0, 0
          FROM (SELECT hm.mobile10, hm.requisition_id, hm.lead_id, hm.drive_id, MAX(IF(hm.template_key LIKE 'he_walkin_invite%', 2, 1)) AS stage
                  FROM he_message hm FORCE INDEX (idx_he_msg_req) WHERE hm.requisition_id IN (${ids}) AND hm.created_at >= ? AND hm.created_at < ? AND hm.direction = 'out'
                   AND (hm.delivery_status IS NULL OR hm.delivery_status <> 'failed')
                 GROUP BY hm.mobile10, hm.requisition_id, hm.lead_id, hm.drive_id) x
          LEFT JOIN he_drive d ON d.id = x.drive_id
          LEFT JOIN he_match m ON m.lead_id = x.lead_id AND m.requisition_id = x.requisition_id
          ${joins("x.lead_id", "x.requisition_id")}
        UNION ALL
        SELECT al.mobile10 ${CI}, x.requisition_id ${CI}, ${type}, alf.campaign_id ${CI}, 1, 3, 0, 0, 0
          FROM he_lead_event ev JOIN he_message x ON x.id = (SELECT h.id FROM he_message h WHERE h.lead_id = ev.lead_id AND h.direction = 'out'
                 AND h.requisition_id IS NOT NULL AND h.created_at <= ev.created_at ORDER BY h.created_at DESC, h.id DESC LIMIT 1)
          LEFT JOIN he_drive d ON d.id = COALESCE(ev.drive_id, x.drive_id)
          LEFT JOIN he_match m ON m.lead_id = ev.lead_id AND m.requisition_id = x.requisition_id
          ${joins("ev.lead_id", "x.requisition_id")}
         WHERE ev.event_type IN ('confirmed','call_confirmed') AND ev.created_at >= ? AND ev.created_at < ? AND x.requisition_id IN (${ids})
        UNION ALL
        SELECT al.mobile10 ${CI}, d.requisition_id ${CI}, ${type}, alf.campaign_id ${CI}, 1, 4, 0, 0, 0
          FROM he_drive d JOIN he_lead_event ev ON ev.drive_id = d.id AND ev.event_type = 'arrived'
          LEFT JOIN he_match m ON m.lead_id = ev.lead_id AND m.requisition_id = d.requisition_id
          ${joins("ev.lead_id", "d.requisition_id")}
         WHERE d.requisition_id IN (${ids}) AND d.drive_date BETWEEN ? AND ?
      ) u
     WHERE u.person IS NOT NULL AND u.person <> ''
     GROUP BY u.person, u.requisition_id
  ) p
 GROUP BY p.requisition_id, p.source_type, p.campaign_id`;
};

const TYPES: readonly SourceType[] = ["meta_live", "meta_old", "he"];
const n0 = (v: unknown): number => { const x = Number(v ?? 0); return Number.isFinite(x) && x > 0 ? x : 0; };

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
const campaignsSql = (n: number): string => `SELECT mc.id, mc.campaign_name, mc.campaign_status, jr.requisition_code
  FROM meta_campaign mc LEFT JOIN job_requisition jr ON jr.id = mc.requisition_id ${CI}
 WHERE mc.id IN (${ph(n)})`;

/** Names, status and the campaign's own requisition (one keyed statement), plus the code and branch of the requisition the activity is for. */
export async function campaignProgress(rows: CampaignProgressRow[], heads: Map<string, { code: string; branch: string }>): Promise<CampaignProgress[]> {
  const ids = [...new Set(rows.map((r) => r.campaignId).filter((x): x is string => !!x))];
  const info = new Map<string, RowDataPacket>();
  for (let i = 0; i < ids.length; i += 200) {
    const b = ids.slice(i, i + 200);
    for (const r of (await db.execute<RowDataPacket[]>(campaignsSql(b.length), b))[0]) info.set(String(r.id), r);
  }
  return rows.map((r) => {
    const c = r.campaignId ? info.get(r.campaignId) : undefined;
    const h = heads.get(r.requisitionId);
    const { campaignId, requisitionId, sourceType, ...stages } = r;
    return {
      campaignId, campaignName: c ? String(c.campaign_name ?? "") : campaignId ? "" : "No campaign", campaignStatus: c?.campaign_status == null ? null : String(c.campaign_status),
      campaignRequisitionCode: c?.requisition_code == null ? null : String(c.requisition_code), requisitionId, requisitionCode: h?.code ?? "", branch: h?.branch ?? "", sourceType, stages,
    };
  }).sort((a, b) => a.requisitionCode.localeCompare(b.requisitionCode) || a.sourceType.localeCompare(b.sourceType) || b.stages.leads - a.stages.leads
    || a.campaignName.localeCompare(b.campaignName));
}

/** One statement per 200 requisitions; throws on failure (the caller's section handles it). */
export async function readPersonStages(ids: string[], w: { from: string; to: string }, liveFrom: string): Promise<ReturnType<typeof aggregatePersons>> {
  const unique = [...new Set(ids)];
  const b = [`${w.from} 00:00:00`, `${addDays(w.to, 1)} 00:00:00`], d = [w.from, w.to];
  const parts: RowDataPacket[][] = [];
  for (let i = 0; i < unique.length; i += 200) {
    const x = unique.slice(i, i + 200);
    parts.push(await readAgg((st) => personsSql(x.length, st, liveFrom), [...x, ...b, ...x, ...d, ...x, ...b, ...b, ...x, ...x, ...d]));
  }
  return aggregatePersons(parts.flat());
}
