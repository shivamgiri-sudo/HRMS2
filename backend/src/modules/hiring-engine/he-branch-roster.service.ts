/**
 * The branch operations person's morning roster: at 08:30 IST (once per day) every branch with an active drive today gets one email
 * listing who is expected, hour by hour, with the role, requisition and booking state, so the interview round is staffed to the
 * numbers. Recipients are the people at that branch with an operations, HR or branch-head role (same rule as the 30-minute arrival
 * alert). Mobiles are masked. Claims the day first so two processes never send twice. Never throws.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { emailService } from "../communication/email.service.js";
import { displayFirstName } from "./he-name.js";

export const ROSTER_ROLES = ["operations_manager", "process_manager", "recruitment_hr", "hr", "branch_head", "branch_admin"] as const;
const STAMP_KEY = "ops.branch_roster_last_day";
const IST_MS = 330 * 60_000;
const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const istHour = (d: Date) => { const x = new Date(d.getTime() + IST_MS); return x.getUTCHours() + x.getUTCMinutes() / 60; };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const mask = (m: unknown) => { const s = String(m ?? ""); return /^\d{10}$/.test(s) ? `xxxxxx${s.slice(-4)}` : "—"; };

export interface RosterRow { hour: string; name: string; mobile: string; role: string; requisition: string; state: string }
export interface BranchRoster { branch: string; booked: number; confirmed: number; byHour: Array<{ hour: string; booked: number; confirmed: number }>; rows: RosterRow[] }

export function buildRoster(branch: string, raw: Array<{ slot_at: unknown; full_name: unknown; mobile10: unknown; role: unknown; code: unknown; state: unknown }>): BranchRoster {
  const rows: RosterRow[] = raw
    .map((r) => ({ hour: String(r.slot_at ?? "").slice(11, 16) || "—", name: displayFirstName(r.full_name), mobile: mask(r.mobile10), role: String(r.role ?? ""), requisition: String(r.code ?? ""), state: String(r.state ?? "") }))
    .sort((a, b) => a.hour.localeCompare(b.hour) || a.name.localeCompare(b.name));
  const hours = new Map<string, { booked: number; confirmed: number }>();
  for (const r of rows) {
    const k = r.hour === "—" ? "—" : `${r.hour.slice(0, 2)}:00`;
    const h = hours.get(k) ?? { booked: 0, confirmed: 0 };
    h.booked++; if (r.state === "confirmed" || r.state === "arrived") h.confirmed++;
    hours.set(k, h);
  }
  return {
    branch, booked: rows.length, confirmed: rows.filter((r) => r.state === "confirmed" || r.state === "arrived").length,
    byHour: [...hours.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([hour, v]) => ({ hour, ...v })), rows,
  };
}

export function rosterEmail(r: BranchRoster, day: string): { subject: string; html: string; text: string } {
  const subject = `Walk-ins expected today at ${r.branch}: ${r.booked} booked, ${r.confirmed} confirmed (${day})`;
  const hours = r.byHour.map((h) => `<tr><td style="padding:3px 10px">${esc(h.hour)}</td><td style="padding:3px 10px;text-align:right">${h.booked}</td><td style="padding:3px 10px;text-align:right">${h.confirmed}</td></tr>`).join("");
  const list = r.rows.slice(0, 300).map((x) => `<tr><td style="padding:2px 8px">${esc(x.hour)}</td><td style="padding:2px 8px">${esc(x.name)}</td><td style="padding:2px 8px">${esc(x.mobile)}</td><td style="padding:2px 8px">${esc(x.role)}</td><td style="padding:2px 8px">${esc(x.requisition)}</td><td style="padding:2px 8px">${esc(x.state)}</td></tr>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:720px"><h3 style="margin:0 0 8px">Walk-ins expected today at ${esc(r.branch)}</h3>
<p style="margin:0 0 10px">${r.booked} candidates are booked, ${r.confirmed} have confirmed. Interviews run from the first slot below.</p>
<table style="border-collapse:collapse;margin-bottom:14px"><thead><tr><th style="padding:3px 10px;text-align:left">Hour</th><th style="padding:3px 10px">Booked</th><th style="padding:3px 10px">Confirmed</th></tr></thead><tbody>${hours}</tbody></table>
<table style="border-collapse:collapse;font-size:13px"><thead><tr><th align="left" style="padding:2px 8px">Slot</th><th align="left" style="padding:2px 8px">Name</th><th align="left" style="padding:2px 8px">Mobile</th><th align="left" style="padding:2px 8px">Role</th><th align="left" style="padding:2px 8px">Requisition</th><th align="left" style="padding:2px 8px">State</th></tr></thead><tbody>${list}</tbody></table>
${r.rows.length > 300 ? `<p>Showing the first 300 of ${r.rows.length}.</p>` : ""}<p style="color:#555">Candidates register at the branch desk; the engine marks them as arrived by mobile number.</p></div>`;
  const text = [`Walk-ins expected today at ${r.branch}: ${r.booked} booked, ${r.confirmed} confirmed.`, "", ...r.byHour.map((h) => `${h.hour}  booked ${h.booked}, confirmed ${h.confirmed}`)].join("\n");
  return { subject, html, text };
}

/** Once per IST day, from 08:30 to 12:00. Returns how many roster emails went out. */
export async function runBranchRosters(now: Date = new Date(), deps: { send?: typeof emailService.send } = {}): Promise<number> {
  try {
    const h = istHour(now);
    if (h < 8.5 || h >= 12) return 0;
    const day = istDay(now);
    const num = Number(day.replace(/-/g, ""));
    const [stamp] = await db.execute<RowDataPacket[]>("SELECT sample FROM he_model_param WHERE param_key = ? LIMIT 1", [STAMP_KEY]);
    if (stamp[0] && Number(stamp[0].sample) === num) return 0;
    await db.execute("INSERT INTO he_model_param (param_key, value, sample) VALUES (?, 0, ?) ON DUPLICATE KEY UPDATE sample = VALUES(sample)", [STAMP_KEY, num]);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT d.branch_name AS branch, m.slot_at, m.state, l.full_name, l.mobile10, jr.designation_name AS role, jr.requisition_code AS code
         FROM he_drive d JOIN he_match m ON m.drive_id = d.id AND m.state IN ('invited','confirmed','arrived') AND m.slot_at IS NOT NULL
         JOIN he_lead l ON l.id = m.lead_id JOIN job_requisition jr ON jr.id = d.requisition_id
        WHERE d.drive_date = CURDATE() AND d.status = 'active'`);
    const by = new Map<string, RowDataPacket[]>();
    for (const r of rows) by.set(String(r.branch), [...(by.get(String(r.branch)) ?? []), r]);
    const send = deps.send ?? emailService.send.bind(emailService);
    let sent = 0;
    for (const [branch, list] of by) {
      const [people] = await db.execute<RowDataPacket[]>(
        `SELECT DISTINCT e.official_email FROM employees e JOIN branch_master bm ON bm.id = e.branch_id
           JOIN user_roles ur ON ur.user_id = e.user_id AND ur.active_status = 1
          WHERE bm.branch_name = ? AND ur.role_key IN (${ROSTER_ROLES.map(() => "?").join(",")}) AND e.active_status = 1 AND e.official_email IS NOT NULL AND e.official_email <> ''`,
        [branch, ...ROSTER_ROLES]);
      if (!people.length) { logger.info({ branch }, "[branch-roster] no recipient at this branch"); continue; }
      const mail = rosterEmail(buildRoster(branch, list as never), day);
      for (const p of people) {
        try { await send({ to: String(p.official_email), subject: mail.subject, html: mail.html, text: mail.text }); sent++; }
        catch (err) { logger.warn({ err: (err as Error).message.slice(0, 100) }, "[branch-roster] email failed"); }
      }
    }
    if (sent) logger.info({ sent, branches: by.size }, "[branch-roster] morning rosters sent");
    return sent;
  } catch (err) {
    logger.warn({ err: (err as Error).message.slice(0, 140) }, "[branch-roster] failed");
    return 0;
  }
}
