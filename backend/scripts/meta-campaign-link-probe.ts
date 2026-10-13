/**
 * For given Meta ad campaign ids: name, status, lifetime and last-30-day spend, and the lead forms their ads use; next to the HRMS campaigns
 * with their lead form ids, so each Meta campaign can be matched to an HRMS campaign by form. STRICTLY READ-ONLY (Graph GET, DB SELECT).
 *   META_CAMPAIGN_IDS=id1,id2 npx tsx scripts/meta-campaign-link-probe.ts
 */
import "dotenv/config";
import axios from "axios";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
const V = process.env.META_GRAPH_API_VERSION || "v19.0";
const T = process.env.META_MARKETING_ACCESS_TOKEN ?? "";
const get = async (path: string, params: Record<string, string> = {}) => {
  try { return (await axios.get(`https://graph.facebook.com/${V}/${path}`, { params: { access_token: T, ...params }, timeout: 20000 })).data; }
  catch (e) { const d = (e as { response?: { data?: { error?: { message?: string; code?: number } } } }).response?.data?.error; console.log(`  GET ${path.split("?")[0]} FAILED ${d?.code} ${String(d?.message ?? (e as Error).message).slice(0, 180)}`); return null; }
};
(async () => {
  const ids = String(process.env.META_CAMPAIGN_IDS ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d{6,25}$/.test(s));
  const [hc] = await db.execute<RowDataPacket[]>("SELECT id, campaign_name, campaign_status, meta_campaign_id, meta_form_id, requisition_id FROM meta_campaign");
  console.log("== HRMS campaigns");
  for (const c of hc) console.log(JSON.stringify({ id: c.id, name: c.campaign_name, status: c.campaign_status, meta_campaign_id: c.meta_campaign_id, form: c.meta_form_id }));
  const [fills] = await db.execute<RowDataPacket[]>(`SELECT campaign_id, JSON_UNQUOTE(JSON_EXTRACT(raw_payload,'$.form_id')) form, JSON_UNQUOTE(JSON_EXTRACT(raw_payload,'$.campaign_id')) meta_cid, COUNT(*) n, MAX(created_at) last
      FROM meta_lead_raw WHERE created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) GROUP BY campaign_id, form, meta_cid ORDER BY n DESC LIMIT 20`);
  console.log("== form fills last 14 days by HRMS campaign, form id, Meta campaign id in payload");
  for (const f of fills) console.log(JSON.stringify(f));
  for (const id of ids) {
    console.log(`== Meta campaign ${id}`);
    const c = await get(id, { fields: "name,effective_status,start_time,objective" });
    if (c) console.log("  ", JSON.stringify(c));
    for (const preset of ["last_30d", "maximum", "today"]) {
      const ins = await get(`${id}/insights`, { fields: "spend,impressions,clicks,actions", date_preset: preset });
      const r = ins?.data?.[0];
      if (ins) console.log(`  insights ${preset}:`, JSON.stringify({ spend: r?.spend ?? "0", impressions: r?.impressions ?? "0", leads: (r?.actions ?? []).find((a: { action_type: string }) => a.action_type === "lead")?.value ?? 0 }));
    }
    const ads = await get(`${id}/ads`, { fields: "id,name,effective_status,creative{object_story_spec,asset_feed_spec}", limit: "50" });
    const forms = new Set<string>();
    for (const ad of ads?.data ?? []) {
      const s = ad.creative?.object_story_spec;
      const f = s?.link_data?.call_to_action?.value?.lead_gen_form_id ?? s?.video_data?.call_to_action?.value?.lead_gen_form_id ?? ad.creative?.asset_feed_spec?.call_to_actions?.[0]?.value?.lead_gen_form_id;
      if (f) forms.add(String(f));
    }
    console.log("  ads", (ads?.data ?? []).length, "lead forms", [...forms].join(","));
  }
  await db.end?.();
})();
