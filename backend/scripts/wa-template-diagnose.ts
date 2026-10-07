/**
 * Why does the Pinbot `interview_invitation` template fail with (#132018), and is the HRMS WhatsApp
 * (Pinbot / Meta Cloud) path working at all? STRICTLY READ-ONLY: env presence booleans, GET probes, SELECTs.
 * Never sends a message, never prints a key or token.
 *
 *   npx tsx scripts/wa-template-diagnose.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const has = (k: string) => Boolean((process.env[k] ?? "").trim());
const base = (process.env.PINBOT_BASE_URL?.trim() || "https://partnersv1.pinbot.ai/v3").replace(/\/$/, "");
const phoneId = process.env.PINBOT_PHONE_NUMBER_ID ?? "";
const scrub = (s: string) => s.replace(/(apikey|access_token|token|authorization)(["':= ]+)[^\s"',&]+/gi, "$1$2***");

/** Parameter hygiene Meta enforces: no newline/tab, no 4+ consecutive spaces, not empty, <=1024 chars. */
function paramFlags(v: string | null | undefined) {
  const s = String(v ?? "");
  return {
    len: s.length,
    empty: s.trim() === "",
    newline: /[\r\n]/.test(s),
    tab: /\t/.test(s),
    fourSpaces: /\s{4,}/.test(s),
    leadTrailSpace: s !== s.trim(),
  };
}

async function probe(label: string, url: string) {
  try {
    const res = await fetch(url, { headers: { apikey: process.env.PINBOT_API_KEY ?? "" }, signal: AbortSignal.timeout(12_000) });
    const body = scrub((await res.text()).replace(/\s+/g, " ")).slice(0, 900);
    console.log(`PROBE ${label}: HTTP ${res.status} ${body}`);
  } catch (e) {
    console.log(`PROBE ${label}: FAILED ${(e as Error).message}`);
  }
}

async function main() {
  console.log("ENV", JSON.stringify({
    WHATSAPP_PROVIDER: process.env.WHATSAPP_PROVIDER ?? null,
    PINBOT_API_KEY: has("PINBOT_API_KEY"),
    PINBOT_PHONE_NUMBER_ID: has("PINBOT_PHONE_NUMBER_ID"),
    PINBOT_BASE_URL_override: has("PINBOT_BASE_URL"),
    PINBOT_INTERVIEW_TEMPLATE: process.env.PINBOT_INTERVIEW_TEMPLATE || "(default interview_invitation)",
    META_WA_ACCESS_TOKEN: has("META_WA_ACCESS_TOKEN"),
    META_WA_PHONE_NUMBER_ID: has("META_WA_PHONE_NUMBER_ID"),
  }));

  // Pinbot template info (the endpoint is not documented in this repo, so try the Cloud-API-shaped ones).
  const tpl = process.env.PINBOT_INTERVIEW_TEMPLATE || "interview_invitation";
  if (has("PINBOT_API_KEY") && phoneId) {
    await probe("pinbot template (phone id)", `${base}/${encodeURIComponent(phoneId)}/message_templates?name=${encodeURIComponent(tpl)}`);
    await probe("pinbot templates (root)", `${base}/message_templates?name=${encodeURIComponent(tpl)}`);
    await probe("pinbot phone number", `${base}/${encodeURIComponent(phoneId)}`);
  }

  // The exact values the invite sends, for the leads re-invited today (qualified, notified by email).
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ml.id, ml.parsed_name, jr.requisition_code, jr.branch_name, jr.bmi_assessment_url, bm.address AS branch_address
       FROM meta_lead_raw ml
       JOIN job_requisition jr ON jr.id = ml.requisition_id
       LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE ml.screening_result = 'qualified' AND ml.notification_sent_at >= DATE_SUB(NOW(), INTERVAL 6 HOUR)
      ORDER BY ml.notification_sent_at DESC LIMIT 40`
  );
  console.log(`RE-INVITED RECENTLY: ${rows.length} lead(s)`);
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.branch_name}|${r.bmi_assessment_url}`;
    if (!seen.has(key)) {
      seen.add(key);
      console.log("TEMPLATE PARAMS (shared)", JSON.stringify({
        requisition: r.requisition_code,
        branch: r.branch_name,
        branch_address: r.branch_address,
        branch_address_flags: paramFlags(r.branch_address),
        bmi_url: r.bmi_assessment_url,
        bmi_url_flags: paramFlags(r.bmi_assessment_url),
      }));
    }
  }
  const nameFlags = rows.map((r) => paramFlags(r.parsed_name));
  console.log("NAME PARAM FLAGS", JSON.stringify({
    total: nameFlags.length,
    empty: nameFlags.filter((f) => f.empty).length,
    newline: nameFlags.filter((f) => f.newline).length,
    tab: nameFlags.filter((f) => f.tab).length,
    fourSpaces: nameFlags.filter((f) => f.fourSpaces).length,
    leadTrailSpace: nameFlags.filter((f) => f.leadTrailSpace).length,
    maxLen: Math.max(0, ...nameFlags.map((f) => f.len)),
  }));
  console.log("SLOT LABEL FORMAT (from interview-slot.service)", JSON.stringify({ dateLabel: "Wed, 24 Sep 2026", timeLabel: "10:30 AM" }));

  // Is HRMS WhatsApp working at all? Recent WhatsApp dispatches and their failures.
  try {
    const [byStatus] = await db.execute<RowDataPacket[]>(
      `SELECT DATE(created_at) AS d, status, COUNT(*) AS n, MAX(created_at) AS last_at FROM dispatch_log
        WHERE channel = 'whatsapp' AND created_at >= DATE_SUB(NOW(), INTERVAL 5 DAY)
        GROUP BY DATE(created_at), status ORDER BY d DESC, status`
    );
    console.log("WHATSAPP DISPATCH (5d)", JSON.stringify(byStatus));
    const [errs] = await db.execute<RowDataPacket[]>(
      `SELECT LEFT(error_message, 170) AS err, COUNT(*) AS n, MAX(created_at) AS last_at FROM dispatch_log
        WHERE channel = 'whatsapp' AND status = 'failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 5 DAY)
        GROUP BY LEFT(error_message, 170) ORDER BY n DESC LIMIT 8`
    );
    console.log("WHATSAPP DISPATCH FAILURES (5d)", JSON.stringify(errs));
  } catch (e) {
    console.log("dispatch_log n/a:", (e as Error).message);
  }
  try {
    const [he] = await db.execute<RowDataPacket[]>(
      `SELECT DATE(created_at) AS d, delivery_status, COUNT(*) AS n FROM meta_lead_messages
        WHERE direction = 'outbound' AND created_at >= DATE_SUB(NOW(), INTERVAL 5 DAY) GROUP BY DATE(created_at), delivery_status ORDER BY d DESC`
    );
    console.log("META LEAD OUTBOUND MESSAGES (5d)", JSON.stringify(he));
  } catch (e) {
    console.log("meta_lead_messages n/a:", (e as Error).message);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
