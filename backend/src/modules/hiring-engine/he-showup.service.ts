/**
 * Show-up learning + the control room. Learning reads finished slots (arrived vs no-show) and stores rates per bucket
 * in he_model_param; the control room scores every booked candidate of upcoming drives and says how many more
 * invites each drive needs to reach its target shows.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { invitesToClose, learnMultiplier, learnRate, pShow, type ShowParams } from "./he-showup.js";
import { learnLifts } from "./he-learn.js";
import { countedNoShow } from "./he-no-show-events.js";

export async function loadShowParams(): Promise<ShowParams> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT param_key, value FROM he_model_param WHERE param_key LIKE 'show.%'");
  return Object.fromEntries(rows.map((r) => [String(r.param_key), Number(r.value)]));
}

const FACTS_SQL = `
  SELECT m.id, m.drive_id, m.state, m.distance_km, m.slot_at, l.walkin_count,
         (SELECT COUNT(*) FROM he_lead_event e WHERE e.lead_id = m.lead_id AND ${countedNoShow("e")} AND (e.drive_id IS NULL OR e.drive_id <> m.drive_id)) AS past_no_shows,
         EXISTS (SELECT 1 FROM he_location_ping p WHERE p.match_id = m.id) AS shared_location,
         EXISTS (SELECT 1 FROM he_message i WHERE i.lead_id = m.lead_id AND i.direction = 'in' AND i.intent IN ('confirm','on_my_way') AND i.created_at >= m.created_at) AS replied_yes
    FROM he_match m JOIN he_lead l ON l.id = m.lead_id`;

/** Learn from finished slots: arrived = showed, no_show = did not. Writes only buckets with >= 30 outcomes. */
export async function learnShowUp(): Promise<{ outcomes: number; learned: string[] }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `${FACTS_SQL} WHERE m.state IN ('arrived','no_show') AND m.slot_at < NOW() AND m.slot_at > DATE_SUB(NOW(), INTERVAL 180 DAY)`);
  const showed = (r: RowDataPacket) => r.state === "arrived";
  // A no-show row no longer says whether it had been confirmed, so read the confirmation from the timeline.
  const [conf] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT m.id FROM he_match m JOIN he_lead_event e ON e.lead_id = m.lead_id AND e.created_at >= m.created_at AND e.event_type IN ('confirmed','call_confirmed','call_rescheduled')
      WHERE m.state IN ('arrived','no_show') AND m.slot_at > DATE_SUB(NOW(), INTERVAL 180 DAY)`);
  const confirmed = new Set(conf.map((c) => String(c.id)));
  const total = rows.length, shows = rows.filter(showed).length;
  const overall = total ? shows / total : 0;
  const bucket = (pred: (r: RowDataPacket) => boolean) => { const b = rows.filter(pred); return [b.filter(showed).length, b.length] as const; };
  const out: Array<[string, number | null, number]> = [];
  const [cs, ct] = bucket((r) => confirmed.has(String(r.id)));
  const [is, it] = bucket((r) => !confirmed.has(String(r.id)));
  out.push(["show.base.confirmed", learnRate(cs, ct), ct], ["show.base.invited", learnRate(is, it), it]);
  for (const [k, pred] of [
    ["show.mult.walked_before", (r: RowDataPacket) => Number(r.walkin_count) > 1],
    ["show.mult.past_no_show", (r: RowDataPacket) => Number(r.past_no_shows) > 0],
    ["show.mult.far", (r: RowDataPacket) => r.distance_km != null && Number(r.distance_km) > 15],
    ["show.mult.location_shared", (r: RowDataPacket) => Number(r.shared_location) === 1],
    ["show.mult.replied_positive", (r: RowDataPacket) => Number(r.replied_yes) === 1],
  ] as const) { const [bs, bt] = bucket(pred); out.push([k, learnMultiplier(bs, bt, overall), bt]); }
  const learned: string[] = [];
  for (const [k, v, n] of out) {
    if (v == null) continue;
    await db.execute("INSERT INTO he_model_param (param_key, value, sample) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value = VALUES(value), sample = VALUES(sample)", [k, v, n]);
    learned.push(k);
  }
  return { outcomes: total, learned };
}

export interface ControlRoomDrive {
  driveId: string; driveDate: string; branch: string; role: string; requisitionCode: string; status: string;
  targetShows: number; suggested: number; invited: number; confirmed: number; arrived: number; noShows: number;
  expectedShows: number; gap: number; invitesNeeded: number; reachableSuggested: number; action: string;
}

/** Today + next 7 days: every active/draft drive with expected shows and what to do next. */
export async function getControlRoom(): Promise<{ drives: ControlRoomDrive[]; learnedParams: number }> {
  const params = await loadShowParams();
  const [drives] = await db.execute<RowDataPacket[]>(
    `SELECT d.id, d.drive_date, d.branch_name, d.status, d.target_shows, jr.designation_name, jr.requisition_code
       FROM he_drive d JOIN job_requisition jr ON jr.id = d.requisition_id
      WHERE d.status IN ('active','draft','paused') AND d.drive_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
      ORDER BY d.drive_date, d.branch_name LIMIT 100`);
  const out: ControlRoomDrive[] = [];
  for (const d of drives) {
    const [rows] = await db.execute<RowDataPacket[]>(`${FACTS_SQL} WHERE m.drive_id = ?`, [d.id]);
    const [reach] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.drive_id = ? AND m.state = 'suggested'
         AND (COALESCE(l.email,'') <> '' OR EXISTS (SELECT 1 FROM he_consent c WHERE c.lead_id = m.lead_id AND c.consent_type = 'whatsapp_contact' AND c.revoked_at IS NULL))`, [d.id]);
    const count = (s: string) => rows.filter((r) => r.state === s).length;
    const booked = rows.filter((r) => (r.state === "invited" || r.state === "confirmed") && r.slot_at);
    const expected = booked.reduce((a, r) => a + pShow({ state: String(r.state), walkedBefore: Number(r.walkin_count) > 0, pastNoShows: Number(r.past_no_shows), distanceKm: r.distance_km == null ? null : Number(r.distance_km), sharedLocation: Number(r.shared_location) === 1, repliedPositive: Number(r.replied_yes) === 1 }, params), 0) + count("arrived");
    const target = Number(d.target_shows) || 0;
    const pNew = pShow({ state: "invited", walkedBefore: false, pastNoShows: 0, distanceKm: null, sharedLocation: false, repliedPositive: false }, params);
    const needed = invitesToClose(target, expected, pNew);
    const reachable = Number(reach[0]?.n ?? 0);
    const action = target === 0 ? "Set a target for this drive"
      : needed === 0 ? "On track: send reminders and watch arrivals"
      : d.status !== "active" ? `Activate the drive: ${needed} more invites needed`
      : reachable >= needed ? `Invite ${needed} more from the ${reachable} reachable suggestions`
      : `Invite all ${reachable} reachable, then source about ${Math.ceil((needed - reachable))} more leads (Find leads / upload / calling)`;
    out.push({
      driveId: d.id, driveDate: String(d.drive_date).slice(0, 10), branch: d.branch_name, role: d.designation_name, requisitionCode: d.requisition_code, status: d.status,
      targetShows: target, suggested: count("suggested"), invited: count("invited"), confirmed: count("confirmed"), arrived: count("arrived"), noShows: count("no_show"),
      expectedShows: Math.round(expected * 10) / 10, gap: Math.max(0, Math.round((target - expected) * 10) / 10), invitesNeeded: needed, reachableSuggested: reachable, action,
    });
  }
  return { drives: out, learnedParams: Object.keys(params).length };
}

/** Learn per-process selection lifts from the last 12 months of walk-ins (recruiter ledger + lead profile). */
export async function learnMatchWeights(): Promise<{ walkins: number; params: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.process_name AS process, l.education_rank AS edu, l.experience_years AS exp, a.hiring_source AS source,
            MAX(a.final_selection_flag OR a.joined_flag) AS selected
       FROM ats_recruiter_hiring_activity a JOIN he_lead l ON l.mobile10 = a.mobile10
      WHERE a.activity_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) AND (a.walkin_flag OR a.final_selection_flag OR a.joined_flag)
      GROUP BY a.mobile10, a.process_name, l.education_rank, l.experience_years, a.hiring_source`);
  const lifts = learnLifts(rows.map((r) => ({ process: String(r.process ?? ""), edu: r.edu == null ? null : Number(r.edu), expYears: r.exp == null ? null : Number(r.exp), source: r.source ? String(r.source) : null, selected: Number(r.selected) === 1 })));
  await db.execute("DELETE FROM he_model_param WHERE param_key LIKE 'match.%'");
  const entries = Object.entries(lifts);
  for (let i = 0; i < entries.length; i += 300) {
    const slice = entries.slice(i, i + 300);
    await db.execute(`INSERT INTO he_model_param (param_key, value, sample) VALUES ${slice.map(() => "(?,?,?)").join(",")}`, slice.flatMap(([k, v]) => [k.slice(0, 80), v.bonus, v.sample]) as never[]);
  }
  return { walkins: rows.length, params: entries.length };
}

export async function loadMatchParams(): Promise<Record<string, number>> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT param_key, value FROM he_model_param WHERE param_key LIKE 'match.%'");
  return Object.fromEntries(rows.map((r) => [String(r.param_key), Number(r.value)]));
}
