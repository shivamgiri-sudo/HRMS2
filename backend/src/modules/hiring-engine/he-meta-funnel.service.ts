/**
 * The Meta campaign walk-in funnel, per campaign and in total, from the first form fill to a hire:
 *   leads -> qualified -> in the engine pool -> emailed / WhatsApped / called -> replied -> confirmed -> arrived -> walked in -> selected -> joined
 * The first two and the last four come from the recruitment count (requisition records); the middle comes from what the Hiring Engine did for the
 * same leads (he_lead.meta_lead_id links a pool lead to its Meta form fill). Read-only, cached a minute.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getMetaRecruitment, type CampaignRecruitment, type RecruitmentCounts } from "./he-meta-recruitment.service.js";

export interface OutreachCounts { inPool: number; emailed: number; whatsapped: number; called: number; replied: number; confirmed: number; arrived: number; reachable: number }
export interface FunnelRow extends RecruitmentCounts, OutreachCounts { campaignId: string; campaignName: string; status: string; requisitionCode: string | null; branchName: string | null }
export interface MetaFunnel { campaigns: FunnelRow[]; total: RecruitmentCounts & OutreachCounts }

const zero = (): OutreachCounts => ({ inPool: 0, emailed: 0, whatsapped: 0, called: 0, replied: 0, confirmed: 0, arrived: 0, reachable: 0 });
let cache: { at: number; data: MetaFunnel } | null = null;

export async function getMetaFunnel(): Promise<MetaFunnel> {
  if (cache && Date.now() - cache.at < 60_000) return cache.data;
  const rec = await getMetaRecruitment();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.campaign_id AS cid, COUNT(*) AS in_pool,
            SUM(f.em) AS emailed, SUM(f.wa) AS whatsapped, SUM(f.cl) AS called, SUM(f.rp) AS replied, SUM(f.cf) AS confirmed, SUM(f.ar) AS arrived, SUM(f.ok) AS reachable
       FROM meta_lead_raw r
       JOIN (SELECT l.id, l.meta_lead_id,
                    EXISTS (SELECT 1 FROM he_message x WHERE x.lead_id = l.id AND x.direction = 'out' AND x.channel = 'email' AND x.delivery_status <> 'failed') AS em,
                    EXISTS (SELECT 1 FROM he_message x WHERE x.lead_id = l.id AND x.direction = 'out' AND x.channel = 'whatsapp' AND x.delivery_status <> 'failed') AS wa,
                    EXISTS (SELECT 1 FROM he_call x WHERE x.lead_id = l.id) AS cl,
                    EXISTS (SELECT 1 FROM he_message x WHERE x.lead_id = l.id AND x.direction = 'in') AS rp,
                    EXISTS (SELECT 1 FROM he_match x WHERE x.lead_id = l.id AND x.state IN ('confirmed','arrived','selected')) AS cf,
                    EXISTS (SELECT 1 FROM he_match x WHERE x.lead_id = l.id AND x.state IN ('arrived','selected')) AS ar,
                    (l.status NOT IN ('opted_out','dead') AND (l.email IS NOT NULL OR l.mobile10 IS NOT NULL)) AS ok
               FROM he_lead l WHERE l.meta_lead_id IS NOT NULL) f ON f.meta_lead_id = r.id
      WHERE r.campaign_id IS NOT NULL GROUP BY r.campaign_id`);
  const by = new Map(rows.map((x) => [String(x.cid), x]));
  const total = zero();
  const campaigns = rec.campaigns.map((c: CampaignRecruitment): FunnelRow => {
    const x = by.get(c.campaignId);
    const o: OutreachCounts = x ? { inPool: Number(x.in_pool), emailed: Number(x.emailed), whatsapped: Number(x.whatsapped), called: Number(x.called), replied: Number(x.replied), confirmed: Number(x.confirmed), arrived: Number(x.arrived), reachable: Number(x.reachable) } : zero();
    (Object.keys(o) as Array<keyof OutreachCounts>).forEach((k) => { total[k] += o[k]; });
    return { ...c, ...o };
  });
  const data: MetaFunnel = { campaigns, total: { ...rec.total, ...total } };
  cache = { at: Date.now(), data };
  return data;
}
