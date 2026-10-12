/**
 * What the Meta Marketing token can see: ad accounts, their campaigns with lifetime and last-30-day spend, and which lead form each ad
 * uses. STRICTLY READ-ONLY (Graph GET only); the token is never printed. Used to map HRMS campaigns to Meta ad campaigns for cost tracking.
 */
import "dotenv/config";
import axios from "axios";
const V = process.env.META_GRAPH_VERSION || "v19.0";
const BASE = `https://graph.facebook.com/${V}`;
const T = process.env.META_MARKETING_ACCESS_TOKEN ?? "";
const get = async (path: string, params: Record<string, string> = {}) => {
  try { return (await axios.get(`${BASE}/${path}`, { params: { access_token: T, ...params }, timeout: 20000 })).data; }
  catch (e) { const d = (e as { response?: { data?: { error?: { message?: string; code?: number } } } }).response?.data?.error; console.log(`GET ${path} FAILED`, d?.code, String(d?.message ?? (e as Error).message).slice(0, 200)); return null; }
};
(async () => {
  if (!T) { console.log("META_MARKETING_ACCESS_TOKEN not set"); return; }
  const accts = await get("me/adaccounts", { fields: "id,name,account_status,currency", limit: "50" });
  for (const a of accts?.data ?? []) {
    console.log(`\n== ad account ${a.id} ${a.name} status=${a.account_status} ${a.currency}`);
    const camps = await get(`${a.id}/campaigns`, { fields: "id,name,effective_status,start_time", limit: "100" });
    for (const c of camps?.data ?? []) {
      const ins = await get(`${c.id}/insights`, { fields: "spend,impressions,clicks,actions", date_preset: "maximum" });
      const r = ins?.data?.[0] ?? {};
      const leads = (r.actions ?? []).find((x: { action_type: string }) => x.action_type === "lead")?.value ?? 0;
      console.log(JSON.stringify({ id: c.id, name: c.name, status: c.effective_status, start: String(c.start_time ?? "").slice(0, 10), spend: r.spend ?? "0", leads: Number(leads), clicks: r.clicks ?? "0" }));
    }
    const ads = await get(`${a.id}/ads`, { fields: "id,name,campaign_id,adset_id,creative{object_story_spec}", limit: "100" });
    const forms = new Map<string, Set<string>>();
    for (const ad of ads?.data ?? []) {
      const form = ad.creative?.object_story_spec?.link_data?.call_to_action?.value?.lead_gen_form_id ?? ad.creative?.object_story_spec?.video_data?.call_to_action?.value?.lead_gen_form_id;
      if (form) { if (!forms.has(String(ad.campaign_id))) forms.set(String(ad.campaign_id), new Set()); forms.get(String(ad.campaign_id))!.add(String(form)); }
    }
    for (const [cid, f] of forms) console.log(`campaign ${cid} uses form(s) ${[...f].join(",")}`);
  }
})();
