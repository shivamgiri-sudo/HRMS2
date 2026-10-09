/**
 * Per-path switches for the answer buttons in invitation emails. All default OFF, so emails stay exactly as they are until the owner
 * turns a path on (he_model_param, 0/1):
 *   policy.email_buttons.legacy_meta    legacy Meta Notify / Notify All / sync email
 *   policy.email_buttons.pipeline_meta  qualified follow-up pipeline email for Meta rows without a match
 *   policy.email_buttons.stop_link      "Stop messages" link on Hiring Engine invite emails
 * Canary lists (org_settings, JSON arrays): he_email_buttons_campaigns (Meta campaign ids), he_email_buttons_test_leads (meta_lead_raw ids).
 * A read error turns everything off (the email is then today's email).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { logText } from "./log-text.js";

export interface EmailButtonSwitches {
  legacyMeta: boolean; legacyMetaCampaigns: ReadonlySet<string>; testLeads: ReadonlySet<string>; pipelineMeta: boolean; stopLink: boolean;
}
export const EMAIL_BUTTONS_OFF: EmailButtonSwitches = { legacyMeta: false, legacyMetaCampaigns: new Set(), testLeads: new Set(), pipelineMeta: false, stopLink: false };
const CAMPAIGNS_KEY = "he_email_buttons_campaigns";
const TEST_LEADS_KEY = "he_email_buttons_test_leads";

function idList(raw: unknown): Set<string> {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()).slice(0, 500) : []);
  } catch { return new Set(); }
}

export async function loadEmailButtonSwitches(): Promise<EmailButtonSwitches> {
  try {
    const [p] = await db.execute<RowDataPacket[]>("SELECT param_key, value FROM he_model_param WHERE param_key LIKE 'policy.email_buttons.%'");
    const m = new Map(p.map((r) => [String(r.param_key), Number(r.value) === 1]));
    const [s] = await db.execute<RowDataPacket[]>("SELECT setting_key, setting_value FROM org_settings WHERE setting_key IN (?, ?)", [CAMPAIGNS_KEY, TEST_LEADS_KEY]);
    const st = new Map(s.map((r) => [String(r.setting_key), r.setting_value]));
    return {
      legacyMeta: m.get("policy.email_buttons.legacy_meta") ?? false, pipelineMeta: m.get("policy.email_buttons.pipeline_meta") ?? false,
      stopLink: m.get("policy.email_buttons.stop_link") ?? false,
      legacyMetaCampaigns: idList(st.get(CAMPAIGNS_KEY)), testLeads: idList(st.get(TEST_LEADS_KEY)),
    };
  } catch (err) {
    logger.warn({ err: logText(err) }, "[email-buttons] switch read failed, buttons off");
    return EMAIL_BUTTONS_OFF;
  }
}

export function legacyButtonsOn(s: EmailButtonSwitches, a: { campaignId: string | null; metaLeadId: string }): boolean {
  return s.legacyMeta || (!!a.campaignId && s.legacyMetaCampaigns.has(a.campaignId)) || s.testLeads.has(a.metaLeadId);
}

/** Reply-To for invitation emails when the inbound mailbox is configured. "+{token}" carries the answer token (removed when there is none). */
export function replyToFor(token: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.INBOUND_EMAIL_REPLY_TO?.trim();
  if (!raw) return null;
  if (!raw.includes("{token}")) return raw;
  return token ? raw.replace("{token}", token) : raw.replace(/\+?\{token\}/, "");
}
