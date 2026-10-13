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
import { STALE_PING_MS, summarizeExpected, type ExpectedRow } from "./he-eta.js";


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

const esc = (v: unknown): string => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The staff e-mail: which requisition, position and process, and every confirmed candidate with name, number and slot. Internal only. */
export function alertEmailHtml(a: { branch: string; requisition: string; position: string; process: string; expected: number; live: number; confirmed: Array<{ name: string | null; mobile10: string; slot: string | null }>; link: string }): string {
  const rows = a.confirmed.map((c) => `<tr><td style="padding:4px 8px;border:1px solid #ddd">${esc(c.name ?? "Candidate")}</td><td style="padding:4px 8px;border:1px solid #ddd">${esc(c.mobile10)}</td><td style="padding:4px 8px;border:1px solid #ddd">${esc(c.slot ? String(c.slot).slice(11, 16) : "")}</td></tr>`).join("");
  return `<p><b>${a.expected} candidate${a.expected === 1 ? "" : "s"} expected within 30 minutes at ${esc(a.branch)}.</b></p>
<table style="border-collapse:collapse;margin:8px 0"><tr><td style="padding:2px 8px 2px 0">Job requisition</td><td><b>${esc(a.requisition)}</b></td></tr>
<tr><td style="padding:2px 8px 2px 0">Position</td><td><b>${esc(a.position)}</b></td></tr><tr><td style="padding:2px 8px 2px 0">Process</td><td><b>${esc(a.process)}</b></td></tr></table>
<p>${a.confirmed.length} confirmed, ${a.live} sharing live location.</p>
${a.confirmed.length ? `<table style="border-collapse:collapse"><tr><th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Confirmed candidate</th><th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Contact number</th><th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Slot</th></tr>${rows}</table>` : "<p>Nobody has confirmed yet for this window.</p>"}
<p><a href="${esc(a.link)}">Open the Hiring Engine</a></p>`;
}

export async function runHrArrivalAlerts(o: { dryRun?: boolean } = {}): Promise<AlertSummary> {
  const dryRun = o.dryRun !== false;
  const out: AlertSummary = { drives: 0, alerted: 0, skipped: 0, recipients: 0 };
  const now = new Date();
  const [drives] = await db.execute<RowDataPacket[]>("SELECT d.id, d.branch_name, jr.requisition_code, jr.designation_name, jr.process_name FROM he_drive d JOIN job_requisition jr ON jr.id = d.requisition_id WHERE d.status = 'active' AND d.drive_date = CURDATE()");
  for (const d of drives) {
    out.drives++;
    const allRows = await loadExpectedRows(d.id as string);
    const cands = allRows.filter((r) => r.state !== "arrived");
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
        WHERE bm.branch_name = ? AND ur.role_key IN ('operations_manager','process_manager','recruitment_hr','hr','branch_head','branch_admin') AND e.active_status = 1`, [d.branch_name]);
    const title = `${s.expected} candidate${s.expected === 1 ? "" : "s"} expected within 30 min`;
    const detail = `${d.branch_name}: ${s.confirmed} confirmed, ${s.live} sharing live location.`;
    const channels = { inApp: 0, whatsapp: 0, email: 0 };
    const base = process.env.HE_PUBLIC_BASE_URL ?? "";
    const html = alertEmailHtml({ branch: String(d.branch_name), requisition: String(d.requisition_code ?? ""), position: String(d.designation_name ?? ""), process: String(d.process_name ?? ""),
      expected: s.expected, live: s.live, confirmed: cands.filter((r) => r.confirmed).map((r) => ({ name: r.name, mobile10: r.mobile10, slot: r.slotAtRaw })), link: `${base}/ats/hiring-engine` });
    for (const h of hr) {
      if (h.user_id) {
        await db.execute(
          `INSERT INTO work_inbox_item (id, user_id, type, title, description, entity_type, entity_id, action_url, priority, is_read, is_actioned, created_at)
           VALUES (UUID(), ?, 'he_arrival_alert', ?, ?, 'he_drive', ?, '/ats/hiring-engine', 'high', 0, 0, NOW())`, [h.user_id, title, detail, d.id])
          .then(() => { channels.inApp++; }).catch(() => undefined);
      }
      // No WhatsApp to HR and branch heads (owner decision 2026-10-13): staff get the in-app item and the email only.
      if (h.official_email && emailService.isConfigured()) {
        try { await emailService.send({ to: String(h.official_email), subject: title, html }); channels.email++; }
        catch (err) { logger.warn({ err: (err as Error).message }, "[he-alert] email skipped"); }
      }
    }
    await db.execute("INSERT INTO he_hr_alert (drive_id, window_start, expected, confirmed, live, recipients, channels_json) VALUES (?,?,?,?,?,?,?)", [d.id, ws, s.expected, s.confirmed, s.live, hr.length, JSON.stringify(channels)]);
    out.alerted++; out.recipients += hr.length;
  }
  return out;
}
