/**
 * "N candidates expected within 30 minutes" alert for branch HR. Counts come from confirmed slots plus fresh
 * consented location pings (ETA beats the booked slot). One alert per drive per 30-minute window (UNIQUE row),
 * delivered in-app (work inbox), by WhatsApp template and by email. SMS is intentionally not wired: it needs a
 * DLT-registered template, which does not exist yet.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { emailService } from "../communication/email.service.js";
import { PinbotWhatsAppProvider } from "../communication/providers/whatsapp/pinbot.provider.js";
import { STALE_PING_MS, summarizeExpected, type ExpectedRow } from "./he-eta.js";
import { buildParams } from "./he-template-catalog.js";
import { sendsPaused } from "./he-send.service.js";

const pinbot = new PinbotWhatsAppProvider();
const WINDOW_MIN = 30;

export interface AlertSummary { drives: number; alerted: number; skipped: number; recipients: number }

/** Floor an instant to its 30-minute window, as an IST wall-clock string for the UNIQUE key. */
export function windowStart(now: Date): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  ist.setUTCMinutes(ist.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
  return ist.toISOString().slice(0, 19).replace("T", " ");
}

const parseIst = (s: unknown) => (s ? new Date(String(s).replace(" ", "T") + "+05:30") : null);

/** Expected-arrival inputs for one drive (shared by the alert and the live board so they can never disagree). */
async function loadExpectedRows(driveId: string): Promise<Array<ExpectedRow & { matchId: string; leadId: string; name: string | null; mobile10: string; slotAtRaw: string | null; liveKm: number | null; state: string }>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id AS match_id, m.lead_id, m.state, m.slot_at, l.full_name, l.mobile10, p.created_at AS ping_at, p.eta_min, p.distance_km AS live_km
       FROM he_match m JOIN he_lead l ON l.id = m.lead_id
       LEFT JOIN he_location_ping p ON p.id = (SELECT MAX(id) FROM he_location_ping WHERE match_id = m.id)
      WHERE m.drive_id = ? AND m.state IN ('invited','confirmed','arrived') AND m.slot_at IS NOT NULL ORDER BY m.slot_at`, [driveId]);
  return rows.map((r) => ({
    matchId: r.match_id as string, leadId: r.lead_id as string, name: (r.full_name as string | null) ?? null, mobile10: r.mobile10 as string,
    slotAt: parseIst(r.slot_at), slotAtRaw: r.slot_at ? String(r.slot_at) : null, pingAt: parseIst(r.ping_at), etaMin: r.eta_min == null ? null : Number(r.eta_min),
    liveKm: r.live_km == null ? null : Number(r.live_km), confirmed: r.state === "confirmed" || r.state === "arrived", state: r.state as string,
  }));
}

/** Live board for today's active drives: expected in the next 30 min + every candidate's tracking state. */
export type BoardDrive = { driveId: string; branchName: string; role: string; slotCapacity: number; expected: number; confirmed: number; live: number; arrived: number; candidates: Array<{ matchId: string; leadId: string; name: string | null; mobile10: string; slotAt: string | null; state: string; liveKm: number | null; etaMin: number | null; tracked: boolean }> };

export async function getBoard(): Promise<BoardDrive[]> {
  const now = new Date();
  const [drives] = await db.execute<RowDataPacket[]>(
    `SELECT d.id, d.branch_name, d.slot_capacity, jr.designation_name FROM he_drive d JOIN job_requisition jr ON jr.id = d.requisition_id
      WHERE d.status = 'active' AND d.drive_date = CURDATE() ORDER BY d.branch_name`);
  const out: BoardDrive[] = [];
  for (const d of drives) {
    const rows = await loadExpectedRows(d.id as string);
    const live = rows.filter((r) => r.state !== "arrived");
    const s = summarizeExpected(live, now, WINDOW_MIN);
    out.push({
      driveId: d.id as string, branchName: d.branch_name as string, role: d.designation_name as string, slotCapacity: Number(d.slot_capacity), ...s,
      arrived: rows.filter((r) => r.state === "arrived").length,
      candidates: rows.map((r) => ({ matchId: r.matchId, leadId: r.leadId, name: r.name, mobile10: r.mobile10, slotAt: r.slotAtRaw, state: r.state, liveKm: r.liveKm, etaMin: r.etaMin, tracked: Boolean(r.pingAt && now.getTime() - r.pingAt.getTime() <= STALE_PING_MS) })),
    });
  }
  return out;
}

export async function runHrArrivalAlerts(o: { dryRun?: boolean } = {}): Promise<AlertSummary> {
  const dryRun = o.dryRun !== false;
  const out: AlertSummary = { drives: 0, alerted: 0, skipped: 0, recipients: 0 };
  const now = new Date();
  const [drives] = await db.execute<RowDataPacket[]>("SELECT id, branch_name FROM he_drive WHERE status = 'active' AND drive_date = CURDATE()");
  for (const d of drives) {
    out.drives++;
    const cands = (await loadExpectedRows(d.id as string)).filter((r) => r.state !== "arrived");
    const s = summarizeExpected(cands, now, WINDOW_MIN);
    if (s.expected < 1) { out.skipped++; continue; }
    if (dryRun) { out.alerted++; continue; }

    const ws = windowStart(now);
    const [ins] = await db.execute<RowDataPacket[]>("SELECT 1 FROM he_hr_alert WHERE drive_id = ? AND window_start = ? LIMIT 1", [d.id, ws]);
    if (ins.length) { out.skipped++; continue; }

    const [hr] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT e.user_id, e.full_name, e.mobile, e.official_email
         FROM employees e JOIN branch_master bm ON bm.id = e.branch_id
         JOIN user_roles ur ON ur.user_id = e.user_id AND ur.active_status = 1
        WHERE bm.branch_name = ? AND ur.role_key IN ('recruitment_hr','hr','branch_head','branch_admin') AND e.active_status = 1`, [d.branch_name]);
    const title = `${s.expected} candidate${s.expected === 1 ? "" : "s"} expected within 30 min`;
    const detail = `${d.branch_name}: ${s.confirmed} confirmed, ${s.live} sharing live location.`;
    const channels = { inApp: 0, whatsapp: 0, email: 0 };
    const base = process.env.HE_PUBLIC_BASE_URL ?? "";
    for (const h of hr) {
      if (h.user_id) {
        await db.execute(
          `INSERT INTO work_inbox_item (id, user_id, type, title, description, entity_type, entity_id, action_url, priority, is_read, is_actioned, created_at)
           VALUES (UUID(), ?, 'he_arrival_alert', ?, ?, 'he_drive', ?, '/ats/hiring-engine', 'high', 0, 0, NOW())`, [h.user_id, title, detail, d.id])
          .then(() => { channels.inApp++; }).catch(() => undefined);
      }
      if (!sendsPaused() && h.mobile && pinbot.isConfigured()) {
        const [t] = await db.execute<RowDataPacket[]>("SELECT pinbot_name, language, approval_state FROM he_template WHERE template_key = 'he_hr_arrival_alert:en' LIMIT 1");
        if (t[0]?.approval_state === "approved") {
          try {
            const params = buildParams("he_hr_arrival_alert", "en", { contact_name: String(h.full_name ?? "Team").split(/\s+/)[0], branch_name: d.branch_name, expected_count: s.expected, confirmed_count: s.confirmed, live_count: s.live, board_link: `${base}/ats/hiring-engine` });
            const r = await pinbot.sendTemplate(String(h.mobile), String(t[0].pinbot_name), params, String(t[0].language));
            if (r.success) channels.whatsapp++;
          } catch (err) { logger.warn({ err: (err as Error).message }, "[he-alert] whatsapp skipped"); }
        }
      }
      if (h.official_email && emailService.isConfigured()) {
        try { await emailService.send({ to: String(h.official_email), subject: title, html: `<p>${detail}</p><p><a href="${base}/ats/hiring-engine">Open the Hiring Engine</a></p>` }); channels.email++; }
        catch (err) { logger.warn({ err: (err as Error).message }, "[he-alert] email skipped"); }
      }
    }
    await db.execute("INSERT INTO he_hr_alert (drive_id, window_start, expected, confirmed, live, recipients, channels_json) VALUES (?,?,?,?,?,?,?)", [d.id, ws, s.expected, s.confirmed, s.live, hr.length, JSON.stringify(channels)]);
    out.alerted++; out.recipients += hr.length;
  }
  return out;
}
