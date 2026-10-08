/**
 * Campaign launches: line up the people of one or more Meta campaigns (a re-run of old leads, or a live campaign) or of one or more portal upload
 * batches for ONE open requisition on ONE date, as a normal Hiring Engine drive (email -> WhatsApp -> bot call -> reminders -> arrival -> no-show).
 * The drive remembers its audience (he_drive.source_kind / source_ids), so the scheduler keeps lining up only those people, and each launch is its
 * own row in the list with its own funnel - an original push and a re-run of the same campaign never mix.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { bridgeMetaLeads } from "./he-meta-bridge.service.js";
import { createDrive, setDriveStatus, suggestMatchesDetailed, type SuggestResult } from "./he-drive.service.js";
import { getDailyPlan } from "./he-policy.service.js";
import { dailyPlanNumbers } from "./he-slots.js";
import { launchStreamCheck, REQUISITION_STREAM_FED, STREAM_CHECK_FAILED } from "./he-stream-guard.service.js";

export interface LaunchInput {
  kind: "campaign" | "batch"; ids: string[]; requisitionId: string; date: string;
  maxLeadAgeDays?: number | null; label?: string | null; reinvite?: boolean; walkInsWanted?: number | null; autoSend?: boolean; userId?: string | null;
}
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");

async function validate(i: LaunchInput): Promise<{ requisition: RowDataPacket }> {
  if (!["campaign", "batch"].includes(i.kind)) throw fail("kind must be campaign or batch");
  if (!Array.isArray(i.ids) || !i.ids.length || i.ids.length > 50 || i.ids.some((x) => typeof x !== "string")) throw fail("Pick 1 to 50 campaigns or upload batches");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw fail("date must be YYYY-MM-DD");
  if (i.date < istToday()) throw fail("The date is in the past");
  if (new Date(`${i.date}T00:00:00Z`).getUTCDay() === 0) throw fail("Sunday: pick a working day");
  const [rq] = await db.execute<RowDataPacket[]>(
    "SELECT id, requisition_code, designation_name, branch_name, approval_status, active_status, requested_headcount, fulfilled_headcount FROM job_requisition WHERE id = ? LIMIT 1", [i.requisitionId]);
  const r = rq[0];
  if (!r) throw fail("Requisition not found", 404);
  if (r.approval_status !== "approved" || !r.active_status || Number(r.fulfilled_headcount) >= Number(r.requested_headcount)) throw fail("That requisition is closed or filled. Pick an open requisition of the same branch.");
  const table = i.kind === "campaign" ? "meta_campaign" : "he_import_batch";
  const [ok] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${table} WHERE id IN (${ph(i.ids.length)})`, i.ids);
  if (Number(ok[0].n) !== new Set(i.ids).size) throw fail(`One of the ${i.kind === "campaign" ? "campaigns" : "upload batches"} was not found`, 404);
  const [ex] = await db.execute<RowDataPacket[]>("SELECT status FROM he_drive WHERE requisition_id = ? AND drive_date = ? AND status <> 'closed' LIMIT 1", [i.requisitionId, i.date]);
  if (ex[0]) throw fail(`A ${ex[0].status} drive for this requisition on ${i.date} already exists. Pick another date, or close that drive first.`, 409);
  // a launch's whole-audience line-up would undo the streams' caps and credits
  const streams = await launchStreamCheck(i.requisitionId, i.date);
  if (streams === "streams") throw fail(REQUISITION_STREAM_FED, 409);
  if (streams === "unknown") throw fail(STREAM_CHECK_FAILED, 503);
  return { requisition: r };
}

export interface LaunchPreview { requisition: { code: string; role: string; branch: string; open: number }; audience: { people: number; qualified?: number; inWindow?: number; alreadyInPool: number; optedOut: number; joinedOrEmployee: number; liveBooking: number } }

/** What a launch would start from, before anything is written. */
export async function previewLaunch(i: LaunchInput): Promise<LaunchPreview> {
  const { requisition: r } = await validate(i);
  const age = i.maxLeadAgeDays && i.maxLeadAgeDays > 0 ? Math.floor(i.maxLeadAgeDays) : 0;
  let people = 0, qualified: number | undefined, inWindow: number | undefined, alreadyInPool = 0, optedOut = 0, joinedOrEmployee = 0, liveBooking = 0;
  if (i.kind === "campaign") {
    const [t] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT RIGHT(REGEXP_REPLACE(parsed_phone, '[^0-9]', ''), 10)) AS people,
              COUNT(DISTINCT IF(screening_result = 'qualified', RIGHT(REGEXP_REPLACE(parsed_phone, '[^0-9]', ''), 10), NULL)) AS qualified,
              COUNT(DISTINCT IF(screening_result = 'qualified' ${age ? "AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)" : ""}, RIGHT(REGEXP_REPLACE(parsed_phone, '[^0-9]', ''), 10), NULL)) AS in_window
         FROM meta_lead_raw WHERE campaign_id IN (${ph(i.ids.length)})`, [...(age ? [age] : []), ...i.ids]);
    people = Number(t[0].people); qualified = Number(t[0].qualified); inWindow = Number(t[0].in_window);
    const [p] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT l.id) AS pool, SUM(l.status = 'opted_out') AS oo, SUM(l.is_employee = 1 OR l.final_status = 'joined') AS jn,
              SUM(EXISTS (SELECT 1 FROM he_match m WHERE m.lead_id = l.id AND m.slot_at >= NOW() AND m.state IN ('invited','confirmed'))) AS live
         FROM he_lead l JOIN he_lead_campaign lc ON lc.lead_id = l.id WHERE lc.campaign_id IN (${ph(i.ids.length)})`, i.ids);
    alreadyInPool = Number(p[0].pool); optedOut = Number(p[0].oo ?? 0); joinedOrEmployee = Number(p[0].jn ?? 0); liveBooking = Number(p[0].live ?? 0);
  } else {
    const [p] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT l.id) AS pool, SUM(l.status = 'opted_out') AS oo, SUM(l.is_employee = 1 OR l.final_status = 'joined') AS jn,
              SUM(EXISTS (SELECT 1 FROM he_match m WHERE m.lead_id = l.id AND m.slot_at >= NOW() AND m.state IN ('invited','confirmed'))) AS live
         FROM he_lead l JOIN he_lead_batch lb ON lb.lead_id = l.id WHERE lb.batch_id IN (${ph(i.ids.length)})`, i.ids);
    people = alreadyInPool = Number(p[0].pool); optedOut = Number(p[0].oo ?? 0); joinedOrEmployee = Number(p[0].jn ?? 0); liveBooking = Number(p[0].live ?? 0);
  }
  return {
    requisition: { code: String(r.requisition_code), role: String(r.designation_name), branch: String(r.branch_name), open: Number(r.requested_headcount) - Number(r.fulfilled_headcount) },
    audience: { people, qualified, inWindow, alreadyInPool, optedOut, joinedOrEmployee, liveBooking },
  };
}

export interface LaunchResult { driveId: string; bridged?: { poolRows: number; linked: number }; shortlist: SuggestResult }

export async function startLaunch(i: LaunchInput): Promise<LaunchResult> {
  await validate(i);
  const plan = await getDailyPlan();
  const n = dailyPlanNumbers(plan);
  const wanted = i.walkInsWanted && i.walkInsWanted > 0 ? Math.min(2000, Math.floor(i.walkInsWanted)) : n.targetShows;
  const age = i.maxLeadAgeDays && i.maxLeadAgeDays > 0 ? Math.floor(i.maxLeadAgeDays) : null;
  const bridged = i.kind === "campaign" ? await bridgeMetaLeads({ campaignIds: i.ids, maxAgeDays: age }) : undefined;
  const label = (i.label?.trim() || `${i.kind === "campaign" ? "Campaign" : "Upload"} launch ${i.date}`).slice(0, 120);
  const d = await createDrive({
    requisitionId: i.requisitionId, driveDate: i.date, slotStart: plan.slotStart, slotEnd: plan.slotEnd, slotMinutes: plan.slotMinutes, slotCapacity: n.perSlot,
    showRatePct: plan.showRatePct, targetShows: wanted, autoSend: i.autoSend !== false, createdBy: i.userId ?? null,
    audience: { kind: i.kind, ids: [...new Set(i.ids)], maxLeadAgeDays: age, label, reinvite: i.reinvite !== false },
  });
  await setDriveStatus(d.id, "active");
  const shortlist = await suggestMatchesDetailed(d.id);
  return { driveId: d.id, bridged, shortlist };
}

export interface LaunchRow {
  driveId: string; label: string; kind: string; date: string; status: string; requisition: string; role: string; branch: string; reinvite: boolean; autoSend: boolean; audienceNames: string[];
  lined: number; invited: number; confirmed: number; arrived: number; noShow: number; declined: number; emailed: number; whatsapped: number; called: number; replied: number;
}

/** Non-pool drives, newest first. `requisitionCode` narrows to one requisition in SQL so its older drives are not cut off by the latest-N limit. */
export async function listLaunches(limit = 40, requisitionCode?: string): Promise<LaunchRow[]> {
  const code = (requisitionCode ?? "").trim();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT d.id, d.run_label, d.source_kind, d.source_ids, d.drive_date, d.status, d.reinvite, d.auto_send, jr.requisition_code, jr.designation_name, jr.branch_name,
            (SELECT COUNT(*) FROM he_match m WHERE m.drive_id = d.id) AS lined,
            (SELECT COUNT(*) FROM he_match m WHERE m.drive_id = d.id AND m.state IN ('invited','confirmed','slot_released','arrived','no_show','selected')) AS invited,
            (SELECT COUNT(*) FROM he_match m WHERE m.drive_id = d.id AND m.state IN ('confirmed','arrived','selected')) AS confirmed,
            (SELECT COUNT(*) FROM he_match m WHERE m.drive_id = d.id AND m.state IN ('arrived','selected')) AS arrived,
            (SELECT COUNT(*) FROM he_match m WHERE m.drive_id = d.id AND m.state = 'no_show') AS no_show,
            (SELECT COUNT(*) FROM he_match m WHERE m.drive_id = d.id AND m.state = 'declined') AS declined,
            (SELECT COUNT(DISTINCT x.lead_id) FROM he_message x WHERE x.drive_id = d.id AND x.direction = 'out' AND x.channel = 'email' AND x.delivery_status <> 'failed') AS emailed,
            (SELECT COUNT(DISTINCT x.lead_id) FROM he_message x WHERE x.drive_id = d.id AND x.direction = 'out' AND x.channel = 'whatsapp' AND x.delivery_status <> 'failed') AS whatsapped,
            (SELECT COUNT(DISTINCT c.lead_id) FROM he_call c JOIN he_match m ON m.id = c.match_id WHERE m.drive_id = d.id) AS called,
            (SELECT COUNT(DISTINCT x.lead_id) FROM he_message x JOIN he_match m ON m.lead_id = x.lead_id AND m.drive_id = d.id WHERE x.direction = 'in' AND x.created_at >= d.created_at) AS replied
       FROM he_drive d JOIN job_requisition jr ON jr.id = d.requisition_id
      WHERE d.source_kind <> 'pool'${code ? " AND jr.requisition_code = ?" : ""} ORDER BY d.drive_date DESC, d.created_at DESC LIMIT ?`,
    [...(code ? [code] : []), Math.max(1, Math.min(100, Math.floor(limit)))]);
  const names = new Map<string, string>();
  const [cn] = await db.execute<RowDataPacket[]>("SELECT id, campaign_name AS n FROM meta_campaign");
  for (const r of cn) names.set(String(r.id), String(r.n));
  const [bn] = await db.execute<RowDataPacket[]>("SELECT id, label AS n FROM he_import_batch");
  for (const r of bn) names.set(String(r.id), String(r.n));
  return rows.map((r) => {
    let ids: string[] = []; try { const raw = r.source_ids; ids = Array.isArray(raw) ? raw.map(String) : raw ? JSON.parse(String(raw)) : []; } catch { ids = []; }
    return {
      driveId: String(r.id), label: String(r.run_label ?? ""), kind: String(r.source_kind), date: String(r.drive_date).slice(0, 10), status: String(r.status), requisition: String(r.requisition_code), role: String(r.designation_name), branch: String(r.branch_name),
      reinvite: Number(r.reinvite) === 1, autoSend: Number(r.auto_send) === 1, audienceNames: ids.map((x) => names.get(x) ?? x),
      lined: Number(r.lined), invited: Number(r.invited), confirmed: Number(r.confirmed), arrived: Number(r.arrived), noShow: Number(r.no_show), declined: Number(r.declined),
      emailed: Number(r.emailed), whatsapped: Number(r.whatsapped), called: Number(r.called), replied: Number(r.replied),
    };
  });
}

export interface BatchRow { id: string; label: string; fileName: string | null; source: string; consentAttested: boolean; rows: number; created: number; enriched: number; rejected: number; blocked: Record<string, number>; createdAt: string; byStatus: Record<string, number> }

export async function listBatches(limit = 30): Promise<BatchRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM he_import_batch ORDER BY created_at DESC LIMIT ?", [Math.max(1, Math.min(100, Math.floor(limit)))]);
  const out: BatchRow[] = [];
  for (const b of rows) {
    const [st] = await db.execute<RowDataPacket[]>("SELECT l.status, COUNT(*) AS n FROM he_lead_batch lb JOIN he_lead l ON l.id = lb.lead_id WHERE lb.batch_id = ? GROUP BY l.status", [b.id]);
    let blocked: Record<string, number> = {}; try { const raw = b.blocked_json; blocked = (typeof raw === "string" ? JSON.parse(raw) : raw) ?? {}; } catch { blocked = {}; }
    out.push({ id: String(b.id), label: String(b.label), fileName: (b.file_name as string | null) ?? null, source: String(b.source), consentAttested: Number(b.consent_attested) === 1, rows: Number(b.rows_total), created: Number(b.created_count), enriched: Number(b.enriched_count), rejected: Number(b.rejected_count), blocked, createdAt: String(b.created_at), byStatus: Object.fromEntries(st.map((x) => [String(x.status), Number(x.n)])) });
  }
  return out;
}
