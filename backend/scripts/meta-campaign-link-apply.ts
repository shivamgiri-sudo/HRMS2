/**
 * Links three HRMS campaigns to their Meta ad campaigns (owner-approved 2026-10-13; matched by lead form id and by the Meta campaign id the
 * form fills carry), marks Ahmedabad DRA active so the spend sync reads it, then runs the spend sync once. Dry run unless APPLY=1.
 */
import "dotenv/config";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { metaCampaignService } from "../src/modules/meta-campaign/meta-campaign.service.js";

const LINKS = [
  { hrms: "afdf94f8-b59c-11f1-b9a7-00155d0ab410", meta: "120250938721530749", form: "27936517096019427" }, // Telecaller -> NOIDA Appriciate Wealth
  { hrms: "afe20b06-b59c-11f1-b9a7-00155d0ab410", meta: "120250991600960749", form: "3296457817218956" },  // Okaya DVE -> NOIDA-2 Onfido
  { hrms: "afe2eec3-b59c-11f1-b9a7-00155d0ab410", meta: "120250971983060749", form: "2856996751366206" },  // DRA Ahmedabad -> AHMEDABAD DRA
];
const ACTIVATE = "afe2eec3-b59c-11f1-b9a7-00155d0ab410";
(async () => {
  const apply = process.env.APPLY === "1";
  for (const l of LINKS) {
    const [r] = await db.execute<RowDataPacket[]>("SELECT campaign_name, campaign_status, meta_campaign_id, meta_form_id FROM meta_campaign WHERE id = ?", [l.hrms]);
    const c = r[0];
    if (!c) { console.log("MISSING", l.hrms); process.exit(1); }
    if (String(c.meta_form_id) !== l.form) { console.log("REFUSED: form id changed for", c.campaign_name); process.exit(1); }
    console.log(`${apply ? "LINK" : "WOULD LINK"} ${c.campaign_name}: meta_campaign_id ${c.meta_campaign_id ?? "(none)"} -> ${l.meta}${l.hrms === ACTIVATE ? `; status ${c.campaign_status} -> active` : ""}`);
    if (apply) {
      const [u] = await db.execute<ResultSetHeader>(
        `UPDATE meta_campaign SET meta_campaign_id = ?${l.hrms === ACTIVATE ? ", campaign_status = 'active'" : ""} WHERE id = ? AND meta_form_id = ?`, [l.meta, l.hrms, l.form]);
      console.log("  rows", u.affectedRows);
    }
  }
  if (apply) {
    const s = await metaCampaignService.syncAllCampaignMetrics();
    console.log("spend sync", JSON.stringify(s));
    const [after] = await db.execute<RowDataPacket[]>("SELECT campaign_name, campaign_status, meta_campaign_id, spend_inr, impressions, clicks, last_synced_at, last_sync_error FROM meta_campaign WHERE meta_campaign_id IN (?,?,?)", LINKS.map((l) => l.meta));
    for (const a of after) console.log(JSON.stringify(a));
  }
  await db.end?.();
})();
