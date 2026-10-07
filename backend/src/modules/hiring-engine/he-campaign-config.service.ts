/**
 * Per Meta campaign settings for the Hiring Engine: who owns the outreach (the old Meta flow or the Hiring Engine), which channels may be used
 * (email / WhatsApp / bot call) and which Superbot campaign the bot call goes to. No row = the defaults (old Meta flow owns, every channel on,
 * the global Superbot campaign), so nothing changes until a campaign is switched over on the Master tab.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface CampaignConfig { campaignId: string; owner: "meta" | "he"; emailOn: boolean; whatsappOn: boolean; voiceOn: boolean; superbotCampaign: string | null }
export type Channel = "email" | "whatsapp" | "voice";

const DEFAULTS = (campaignId: string): CampaignConfig => ({ campaignId, owner: "meta", emailOn: true, whatsappOn: true, voiceOn: true, superbotCampaign: null });
const toConfig = (r: RowDataPacket): CampaignConfig => ({
  campaignId: String(r.campaign_id), owner: r.owner === "he" ? "he" : "meta", emailOn: Number(r.email_on) === 1, whatsappOn: Number(r.whatsapp_on) === 1,
  voiceOn: Number(r.voice_on) === 1, superbotCampaign: r.superbot_campaign ? String(r.superbot_campaign) : null,
});

export async function getCampaignConfig(campaignId: string): Promise<CampaignConfig> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT * FROM he_campaign_config WHERE campaign_id = ? LIMIT 1", [campaignId]);
  return r[0] ? toConfig(r[0]) : DEFAULTS(campaignId);
}

export async function listCampaignConfigs(): Promise<Array<CampaignConfig & { campaignName: string; status: string; requisitionCode: string | null; branchName: string | null; qualified: number }>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.campaign_name, c.campaign_status, jr.requisition_code, jr.branch_name, cfg.*,
            (SELECT COUNT(*) FROM meta_lead_raw r WHERE r.campaign_id = c.id AND r.screening_result = 'qualified') AS qualified
       FROM meta_campaign c LEFT JOIN job_requisition jr ON jr.id = c.requisition_id LEFT JOIN he_campaign_config cfg ON cfg.campaign_id = c.id
      ORDER BY (c.campaign_status = 'active') DESC, c.campaign_name`);
  return rows.map((r) => ({
    ...(r.campaign_id ? toConfig(r) : DEFAULTS(String(r.id))), campaignId: String(r.id), campaignName: String(r.campaign_name), status: String(r.campaign_status),
    requisitionCode: (r.requisition_code as string | null) ?? null, branchName: (r.branch_name as string | null) ?? null, qualified: Number(r.qualified),
  }));
}

export async function setCampaignConfig(campaignId: string, p: Partial<Omit<CampaignConfig, "campaignId">>, userId: string | null): Promise<CampaignConfig> {
  const [c] = await db.execute<RowDataPacket[]>("SELECT 1 FROM meta_campaign WHERE id = ? LIMIT 1", [campaignId]);
  if (!c.length) throw Object.assign(new Error("Campaign not found"), { statusCode: 404 });
  const cur = await getCampaignConfig(campaignId);
  const next = { ...cur, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } as CampaignConfig;
  const sb = next.superbotCampaign ? String(next.superbotCampaign).trim() : "";
  if (sb && !/^[A-Za-z0-9_-]{1,40}$/.test(sb)) throw Object.assign(new Error("Superbot campaign id may only hold letters, digits, - and _"), { statusCode: 400 });
  await db.execute(
    `INSERT INTO he_campaign_config (campaign_id, owner, email_on, whatsapp_on, voice_on, superbot_campaign, updated_by) VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE owner = VALUES(owner), email_on = VALUES(email_on), whatsapp_on = VALUES(whatsapp_on), voice_on = VALUES(voice_on), superbot_campaign = VALUES(superbot_campaign), updated_by = VALUES(updated_by)`,
    [campaignId, next.owner === "he" ? "he" : "meta", next.emailOn ? 1 : 0, next.whatsappOn ? 1 : 0, next.voiceOn ? 1 : 0, sb || null, userId]);
  return getCampaignConfig(campaignId);
}

/** The settings that apply to a person: those of the campaign they filled a form for most recently. No campaign = everything on. */
export async function configForLead(leadId: string): Promise<CampaignConfig | null> {
  const [r] = await db.execute<RowDataPacket[]>(
    `SELECT cfg.* FROM he_lead_campaign lc JOIN he_campaign_config cfg ON cfg.campaign_id = lc.campaign_id
      WHERE lc.lead_id = ? ORDER BY lc.form_filled_at DESC LIMIT 1`, [leadId]);
  return r[0] ? toConfig(r[0]) : null;
}

export async function channelAllowed(leadId: string, channel: Channel): Promise<boolean> {
  const c = await configForLead(leadId);
  if (!c) return true;
  return channel === "email" ? c.emailOn : channel === "whatsapp" ? c.whatsappOn : c.voiceOn;
}

/** Campaign ids whose outreach the Hiring Engine owns (the old Meta flow steps aside for them). */
export async function heOwnedCampaignIds(): Promise<string[]> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT campaign_id FROM he_campaign_config WHERE owner = 'he'");
  return r.map((x) => String(x.campaign_id));
}

/** True when the Hiring Engine owns this campaign (campaign_id null = a lead outside any campaign: never owned). */
export async function heOwnsCampaign(campaignId: string | null | undefined): Promise<boolean> {
  if (!campaignId) return false;
  const [r] = await db.execute<RowDataPacket[]>("SELECT 1 FROM he_campaign_config WHERE campaign_id = ? AND owner = 'he' LIMIT 1", [campaignId]);
  return r.length > 0;
}

/**
 * One owner per lead. The old Meta outreach (lead-outreach.service) asks this before it messages: it steps aside for a campaign the Hiring Engine
 * owns, and when the Hiring Engine already contacted the person in the last 3 days. null = go ahead. A recruiter's explicit force skips it.
 */
export async function metaOutreachBlockedByEngine(metaLeadId: string): Promise<string | null> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT campaign_id, RIGHT(REGEXP_REPLACE(parsed_phone, '[^0-9]', ''), 10) AS m FROM meta_lead_raw WHERE id = ? LIMIT 1", [metaLeadId]);
  if (!r[0]) return null;
  if (await heOwnsCampaign(r[0].campaign_id as string | null)) return "The Hiring Engine owns this campaign's outreach";
  if (r[0].m) {
    const [c] = await db.execute<RowDataPacket[]>(
      "SELECT 1 FROM he_message WHERE mobile10 = ? AND direction = 'out' AND created_at > DATE_SUB(NOW(), INTERVAL 3 DAY) AND delivery_status <> 'failed' LIMIT 1", [r[0].m]);
    if (c.length) return "The Hiring Engine already contacted this person in the last 3 days";
  }
  return null;
}
