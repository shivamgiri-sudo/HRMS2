/**
 * "WhatsApp me a sample journey": plays a real candidate journey (for example invite, confirmation, day-before reminder, 2-hour reminder)
 * to the signed-in user's OWN mobile (the number on their employee profile, never one passed in), ONE message at a time with a gap
 * between them, so it reads the way a candidate experiences it. It is also a real round trip to Pinbot/Meta, so each rejection
 * reason is reported per template. Nothing is written to the candidate message log. Runs in the background; progress is polled.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { PinbotWhatsAppProvider } from "../communication/providers/whatsapp/pinbot.provider.js";
import { normalizeMobile10 } from "./he-phone.js";
import { sampleContext } from "./he-samples.service.js";
import { buildParams, getTemplate, type TemplateKey } from "./he-template-catalog.js";

export const SCENARIOS: Array<{ id: string; label: string; keys: TemplateKey[] }> = [
  { id: "happy", label: "Happy path: invite, confirmation, day-before reminder, 2-hour reminder", keys: ["he_walkin_invite", "he_walkin_confirmed", "he_reminder_1d", "he_reminder_2h_location"] },
  { id: "reschedule", label: "Asks for another time: invite, new slot offer, confirmation", keys: ["he_walkin_invite", "he_reschedule_offer", "he_walkin_confirmed"] },
  { id: "noshow", label: "Misses the interview: 2-hour reminder, no-show follow-up, new slot, confirmation", keys: ["he_reminder_2h_location", "he_no_show_recovery", "he_reschedule_offer", "he_walkin_confirmed"] },
  { id: "unreached", label: "Bot could not reach them: missed-call message, confirmation", keys: ["he_missed_call", "he_walkin_confirmed"] },
  { id: "other", label: "Other cases: other opening, win-back, opt-out acknowledgement", keys: ["he_other_role_offer", "he_winback", "he_optout_ack"] },
  { id: "hr", label: "Branch HR alert (this goes to HR, not to candidates)", keys: ["he_hr_arrival_alert"] },
  { id: "all", label: "Everything, in journey order", keys: ["he_walkin_invite", "he_walkin_confirmed", "he_reminder_1d", "he_reminder_2h_location", "he_reschedule_offer", "he_no_show_recovery", "he_other_role_offer", "he_winback", "he_missed_call", "he_optout_ack", "he_hr_arrival_alert"] },
];
export const GAPS_MIN = [1, 2, 5, 10];

export interface WaStep { key: string; name: string; status: "waiting" | "sent" | "failed"; error?: string; at?: string }
export interface WaJob { runId: string; scenario: string; gapMin: number; to: string; steps: WaStep[]; done: boolean }
const mask = (m: string) => `${m.slice(0, 2)}xxxxxx${m.slice(-2)}`;
const jobs = new Map<string, WaJob>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function ownMobile(userId: string): Promise<string | null> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT mobile FROM employees WHERE user_id = ? AND active_status = 1 AND mobile IS NOT NULL AND mobile <> '' LIMIT 1", [userId]);
  return normalizeMobile10(r[0]?.mobile);
}

export async function previewWhatsAppSamples(userId: string) {
  const [t] = await db.execute<RowDataPacket[]>("SELECT template_key FROM he_template WHERE template_key LIKE '%:en' AND approval_state = 'approved' AND pinbot_name IS NOT NULL");
  const ok = new Set(t.map((r) => String(r.template_key).replace(/:en$/, "")));
  const m = await ownMobile(userId);
  return {
    configured: new PinbotWhatsAppProvider().isConfigured(), to: m ? mask(m) : null, gaps: GAPS_MIN,
    scenarios: SCENARIOS.map((s) => ({ id: s.id, label: s.label, steps: s.keys.map((k) => ({ key: k, name: getTemplate(k).metaName.en ?? k, approved: ok.has(k) })) })),
    active: jobs.get(userId) && !jobs.get(userId)!.done ? jobs.get(userId) : null,
  };
}

export function whatsAppSampleStatus(userId: string): WaJob | null { return jobs.get(userId) ?? null; }

/** Starts the journey in the background and returns at once; the first message goes now, the rest follow after the chosen gap. */
export async function startWhatsAppSample(userId: string, scenarioId: string, gapMin: number): Promise<WaJob> {
  const sc = SCENARIOS.find((s) => s.id === scenarioId);
  if (!sc) throw Object.assign(new Error("Unknown scenario."), { statusCode: 400 });
  if (!GAPS_MIN.includes(gapMin)) throw Object.assign(new Error("Pick a gap of 1, 2, 5 or 10 minutes."), { statusCode: 400 });
  const prev = jobs.get(userId);
  if (prev && !prev.done) throw Object.assign(new Error("A sample journey is already running. Wait for it to finish."), { statusCode: 409 });
  const mobile = await ownMobile(userId);
  if (!mobile) throw Object.assign(new Error("There is no mobile number on your employee profile, so a sample cannot be sent to you."), { statusCode: 400 });
  const pinbot = new PinbotWhatsAppProvider();
  if (!pinbot.isConfigured()) throw Object.assign(new Error("WhatsApp (Pinbot) is not configured on the server."), { statusCode: 409 });
  const job: WaJob = { runId: `${Date.now()}`, scenario: sc.id, gapMin, to: mask(mobile), steps: sc.keys.map((k) => ({ key: k, name: getTemplate(k).metaName.en ?? k, status: "waiting" as const })), done: false };
  jobs.set(userId, job);
  void (async () => {
    try {
      const [rows] = await db.execute<RowDataPacket[]>("SELECT template_key, pinbot_name, language FROM he_template WHERE template_key LIKE '%:en' AND approval_state = 'approved' AND pinbot_name IS NOT NULL");
      const byKey = new Map(rows.map((r) => [String(r.template_key).replace(/:en$/, ""), r]));
      const { ctx } = sampleContext();
      for (let i = 0; i < sc.keys.length; i++) {
        if (i > 0) await sleep(gapMin * 60_000);
        const key = sc.keys[i], step = job.steps[i], row = byKey.get(key);
        step.at = new Date().toISOString();
        if (!row) { step.status = "failed"; step.error = "not approved in the Templates tab"; continue; }
        step.name = String(row.pinbot_name);
        try {
          const hasUrl = getTemplate(key).buttons.en.some((b) => b.startsWith("URL:"));
          const r = await pinbot.sendTemplate(mobile, String(row.pinbot_name), buildParams(key, "en", ctx), String(row.language), hasUrl ? String(ctx.location_token) : undefined);
          if (r.success) step.status = "sent"; else { step.status = "failed"; step.error = String(r.error ?? "rejected").slice(0, 220); }
        } catch (e) { step.status = "failed"; step.error = (e instanceof Error ? e.message : String(e)).slice(0, 220); }
      }
    } finally { job.done = true; }
  })();
  return job;
}
