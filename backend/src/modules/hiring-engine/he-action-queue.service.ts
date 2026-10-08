/**
 * Recruiter action queue reads (HE_ACTION_QUEUE). Read-only and branch-scoped; one statement per kind, each starting from he_drive (or
 * qualified_followup for the failed-WhatsApp follow-up rows), reaching he_lead / he_message / ats_candidate by key through JOINs only.
 * Each section has its own try/catch (logged as section + code); a partial result is never cached. Nothing here sends or assigns:
 * the recruiter is shown as "Assigned" (the candidate's ATS owner) or "Suggested" (the ATS rule over a read-only copy of the pool query).
 * The list carries masked mobiles; the one full number leaves through contactFor, one person per call.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import {
  ACTION_LIMITS, contactHref, pickRecruiter, rankActions,
  type ActionFact, type ActionItem, type ActionKind, type RecruiterCandidate,
} from "./he-action-queue.js";
import { nextWorkingDay } from "./he-plan.service.js";
import { istAddMinutes, nowIst } from "./he-slots.js";
import { valueAddOn } from "./he-valueadd-switches.js";
import { addDays, istToday } from "./requisition-stream.window.js";

export interface ActionQueue {
  enabled: boolean;
  generatedAt: string;
  items: ActionItem[];
  counts: Record<ActionKind, number>;
  truncated: boolean;
  partial: boolean;
  failedSections: string[];
  /** Plain-language reason when the result is partial for a reason other than a failed section read. */
  partialReason?: string;
}

export const zeroCounts = (): Record<ActionKind, number> => ({ replied_not_confirmed: 0, confirmed_no_reminder: 0, no_show_recovery: 0, wa_failed: 0, high_score_not_reached: 0 });

const READ_CAP = 200;
const CACHE_MS = 60_000;
const CACHE_MAX = 50;
const POOL_BRANCHES = 20;
const COLL = "COLLATE utf8mb4_unicode_ci";
const cache = new Map<string, { at: number; data: ActionQueue }>();
export function clearActionQueueCache(): void { cache.clear(); }
const scopeKey = (s: BranchScope): string => (s.all ? "all" : `b:${s.branchName ?? ""}`);
const noTable = (err: unknown): boolean => (err as { code?: unknown })?.code === "ER_NO_SUCH_TABLE";
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const day = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10));
const wallStr = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 19).replace("T", " ") : String(v ?? "").slice(0, 19).replace("T", " "));

interface Filter { requisitionId: string | null; branch: string | null }

/**
 * Drive-based statements: window and drive status first, then the requisition / branch filter through job_requisition. STRAIGHT_JOIN keeps
 * that order: left to itself the optimizer sometimes scans all of he_match first (seen on the throwaway MySQL check), which grows with the table.
 */
function driveSql(select: string, joins: string, where: string, group: string, f: Filter): string {
  return `SELECT STRAIGHT_JOIN ${select}
  FROM he_drive d
  JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id
  JOIN he_lead l ON l.id = m.lead_id
  JOIN job_requisition jr ON jr.id = d.requisition_id ${COLL}
  LEFT JOIN ats_candidate ac ON ac.id = l.ats_candidate_id ${COLL}
  ${joins}
 WHERE ${where} AND d.status <> 'closed'${f.requisitionId ? ` AND d.requisition_id = ?` : ""}${f.branch ? ` AND jr.branch_name = ? ${COLL}` : ""}
 ${group} LIMIT ${READ_CAP}`;
}
const BASE = "m.id AS ref_id, m.lead_id, l.mobile10, l.full_name, d.requisition_id, jr.requisition_code, jr.branch_name, d.drive_date, m.score, ac.recruiter_assigned_name AS recruiter";
const filterParams = (f: Filter): string[] => [...(f.requisitionId ? [f.requisitionId] : []), ...(f.branch ? [f.branch] : [])];

interface Section { name: ActionKind; run: (ctx: Ctx) => Promise<ActionFact[]> }
interface Ctx { today: string; ahead: string; remindDays: [string, string]; noShowFrom: string; replySince: string; f: Filter }

const toFact = (kind: ActionKind, type: "match" | "followup", r: RowDataPacket, eventAt: unknown): ActionFact => ({
  kind, ref: { type, id: String(r.ref_id) }, leadId: str(r.lead_id), mobile10: String(r.mobile10 ?? ""), name: str(r.full_name),
  requisitionId: String(r.requisition_id), requisitionCode: String(r.requisition_code ?? ""), branch: String(r.branch_name ?? ""),
  driveDate: day(r.drive_date), eventAt: wallStr(eventAt), score: r.score == null ? null : Number(r.score), assignedRecruiter: str(r.recruiter),
});

async function rows(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [r] = await db.execute<RowDataPacket[]>(sql, params as never);
  return r;
}

const SECTIONS: Section[] = [
  {
    name: "replied_not_confirmed",
    run: async (c) => (await rows(
      driveSql(`${BASE}, MAX(h.created_at) AS event_at`, "JOIN he_message h ON h.lead_id = m.lead_id AND h.direction = 'in' AND h.created_at >= ?",
        "d.drive_date BETWEEN ? AND ? AND m.state = 'invited'", "GROUP BY m.id, m.lead_id, l.mobile10, l.full_name, d.requisition_id, jr.requisition_code, jr.branch_name, d.drive_date, m.score, ac.recruiter_assigned_name", c.f),
      [c.replySince, c.today, c.ahead, ...filterParams(c.f)])).map((r) => toFact("replied_not_confirmed", "match", r, r.event_at)),
  },
  {
    name: "confirmed_no_reminder",
    run: async (c) => (await rows(
      driveSql(`${BASE}, m.updated_at AS event_at`,
        `LEFT JOIN he_message o ON o.lead_id = m.lead_id AND o.direction = 'out' AND o.drive_id <=> d.id
         AND (o.template_key LIKE 'he_reminder_1d%' OR o.template_key LIKE 'he_reminder_2h%') AND (o.delivery_status IS NULL OR o.delivery_status <> 'failed')`,
        "d.drive_date IN (?, ?) AND m.state = 'confirmed' AND o.id IS NULL", "", c.f),
      [...c.remindDays, ...filterParams(c.f)])).map((r) => toFact("confirmed_no_reminder", "match", r, r.event_at)),
  },
  {
    name: "no_show_recovery",
    run: async (c) => (await rows(
      driveSql(`${BASE}, m.updated_at AS event_at`,
        `LEFT JOIN he_match m2 ON m2.lead_id = m.lead_id AND m2.id <> m.id AND m2.state IN ('invited','confirmed','arrived','selected') AND m2.created_at > m.created_at`,
        "d.drive_date BETWEEN ? AND ? AND m.state = 'no_show' AND l.status NOT IN ('opted_out','joined','dead') AND m2.id IS NULL", "", c.f),
      [c.noShowFrom, c.today, ...filterParams(c.f)])).map((r) => toFact("no_show_recovery", "match", r, r.event_at)),
  },
  {
    name: "wa_failed",
    run: async (c) => {
      // (a) follow-up rows whose WhatsApp failed; (b) invited matches whose latest outbound WhatsApp failed.
      const a = await rows(
        `SELECT qf.id AS ref_id, NULL AS lead_id, qf.mobile10, qf.full_name, qf.requisition_id, jr.requisition_code, qf.branch_name, NULL AS drive_date, NULL AS score,
                ac.recruiter_assigned_name AS recruiter, COALESCE(qf.wa_sent_at, qf.wa_due_at, qf.updated_at) AS event_at
           FROM qualified_followup qf
           JOIN job_requisition jr ON jr.id = qf.requisition_id ${COLL}
           LEFT JOIN ats_candidate ac ON ac.id = qf.ats_candidate_id ${COLL}
          WHERE qf.wa_status = 'failed' AND qf.stopped_reason IS NULL AND qf.owner = 'pipeline' AND qf.call_state IN ('pending','in_file')${c.f.requisitionId ? " AND qf.requisition_id = ?" : ""}${c.f.branch ? ` AND qf.branch_name = ? ${COLL}` : ""}
          ORDER BY qf.qualified_at LIMIT ${READ_CAP}`, filterParams(c.f)).catch((e) => { if (noTable(e)) return [] as RowDataPacket[]; throw e; });
      const b = await rows(
        driveSql(`${BASE}, MAX(w.created_at) AS event_at`,
          `JOIN he_message w ON w.lead_id = m.lead_id AND w.direction = 'out' AND w.channel = 'whatsapp' AND w.delivery_status = 'failed'
           LEFT JOIN he_message nx ON nx.lead_id = w.lead_id AND nx.direction = 'out' AND nx.channel = 'whatsapp' AND nx.created_at > w.created_at`,
          "d.drive_date BETWEEN ? AND ? AND m.state = 'invited' AND nx.id IS NULL", "GROUP BY m.id, m.lead_id, l.mobile10, l.full_name, d.requisition_id, jr.requisition_code, jr.branch_name, d.drive_date, m.score, ac.recruiter_assigned_name", c.f),
        [c.today, c.ahead, ...filterParams(c.f)]);
      return [...a.map((r) => toFact("wa_failed", "followup", r, r.event_at)), ...b.map((r) => toFact("wa_failed", "match", r, r.event_at))];
    },
  },
  {
    name: "high_score_not_reached",
    run: async (c) => (await rows(
      driveSql(`${BASE}, m.created_at AS event_at`,
        `LEFT JOIN he_message o ON o.lead_id = m.lead_id AND o.requisition_id = m.requisition_id AND o.direction = 'out' AND o.delivery_status IN ('sent','delivered','read')`,
        `d.drive_date BETWEEN ? AND ? AND m.state IN ('suggested','invited') AND m.score >= ${ACTION_LIMITS.highScore} AND o.id IS NULL`, "", c.f),
      [c.today, c.ahead, ...filterParams(c.f)])).map((r) => toFact("high_score_not_reached", "match", r, r.event_at)),
  },
];

// Read-only copy of the getAvailableRecruiters SELECT (that function writes roster rows, which a read must not do).
const POOL_SQL = `SELECT DISTINCT e.id AS employee_id, e.first_name, e.last_name,
       CASE WHEN att.clock_in_time IS NOT NULL OR att.attendance_status IN ('present', 'half_day') THEN 1 ELSE 0 END AS present_today
  FROM employees e
  INNER JOIN department_master d ON e.department_id = d.id
  INNER JOIN designation_master des ON e.designation_id = des.id
  INNER JOIN branch_master b ON b.id = e.branch_id
  LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.record_date = ?
 WHERE (LOWER(d.dept_name) LIKE '%human resource%' OR LOWER(d.dept_name) LIKE '%admin/hr%')
   AND (LOWER(des.designation_name) LIKE '%executive%' OR LOWER(des.designation_name) LIKE '%recruiter%' OR LOWER(des.designation_name) LIKE '%hr manager%' OR LOWER(des.designation_name) LIKE '%team leader%')
   AND (b.branch_name = ? OR b.branch_code = ?)
   AND e.active_status = 1
 ORDER BY present_today DESC, e.first_name, e.last_name`;

async function loadPool(branch: string, today: string): Promise<RecruiterCandidate[]> {
  const emp = await rows(POOL_SQL, [today, branch, branch]);
  if (!emp.length) return [];
  const ids = emp.map((e) => String(e.employee_id));
  const q = await rows(
    `SELECT r.employee_id, COUNT(*) AS n FROM ats_queue_token q JOIN ats_recruiter_roster r ON r.id = q.recruiter_id
      WHERE r.employee_id IN (${ids.map(() => "?").join(",")}) AND q.queue_status IN ('waiting','called','in_interview') GROUP BY r.employee_id`, ids);
  const load = new Map(q.map((r) => [String(r.employee_id), Number(r.n) || 0]));
  return emp.map((e) => ({
    name: `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim() || "Recruiter",
    presentToday: Number(e.present_today) === 1,
    activeQueue: load.get(String(e.employee_id)) ?? 0,
  }));
}

/** Null when the requisition or branch is outside the scope or unknown (never says which). The scope check runs before the cache read. */
export async function getActionQueue(q: { requisitionId?: string | null; branch?: string | null }, scope: BranchScope, now: Date = new Date()): Promise<ActionQueue | null> {
  if (!scope.all && !scope.branchName) return null;
  const requisitionId = q.requisitionId || null, branchIn = q.branch || null;
  if (!scope.all && branchIn && branchIn !== scope.branchName) return null;
  const branch = scope.all ? branchIn : scope.branchName;
  if (requisitionId) {
    const h = await rows("SELECT branch_name FROM job_requisition WHERE id = ? LIMIT 1", [requisitionId]);
    if (!h[0]) return null;
    const rb = String(h[0].branch_name ?? "");
    if (!scope.all && rb !== scope.branchName) return null;
    if (branchIn && branchIn !== rb) return null;
  } else if (scope.all && branchIn) {
    let exists = true; // a failing probe must not turn into a 404
    try { exists = (await rows(`SELECT 1 FROM job_requisition WHERE branch_name ${COLL} = ? LIMIT 1`, [branchIn])).length > 0; } catch (err) {
      logger.warn({ section: "branch", code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-action-queue] branch probe failed");
    }
    if (!exists) return null;
  }
  const key = `${scopeKey(scope)}|${requisitionId ?? "*"}|${branchIn ?? "*"}`;
  const t = now.getTime();
  const hit = cache.get(key);
  if (hit && t - hit.at < CACHE_MS) return structuredClone(hit.data);

  const failed: string[] = [];
  const fail = (name: string, err: unknown): void => {
    if (!failed.includes(name)) failed.push(name);
    logger.warn({ section: name, code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-action-queue] section failed");
  };
  const today = istToday(now), nowWall = nowIst(now);
  const ctx: Ctx = {
    today, ahead: addDays(today, ACTION_LIMITS.lookAheadDays), remindDays: [today, nextWorkingDay(now)], noShowFrom: addDays(today, -2),
    replySince: istAddMinutes(nowWall, -ACTION_LIMITS.replyWindowHours * 60), f: { requisitionId, branch },
  };
  const settled = await Promise.all(SECTIONS.map(async (s) => {
    try { return await s.run(ctx); } catch (err) { if (noTable(err)) return []; fail(s.name, err); return [] as ActionFact[]; }
  }));
  const facts = settled.flat();

  const pools = new Map<string, string | null>();
  const wanted = [...new Set(facts.filter((f) => !f.assignedRecruiter && f.branch).map((f) => f.branch))];
  const need = wanted.slice(0, POOL_BRANCHES);
  let partialReason: string | undefined;
  if (wanted.length > need.length) { // suggestions beyond the cap are missing: partial, not cached
    fail("recruiters", { code: "POOL_BRANCH_CAP" });
    partialReason = `Recruiter suggestions were looked up for the first ${POOL_BRANCHES} of ${wanted.length} branches; filter by branch to see the rest.`;
  }
  await Promise.all(need.map(async (b) => {
    try { pools.set(b, pickRecruiter(await loadPool(b, today))); } catch (err) { fail("recruiters", err); pools.set(b, null); }
  }));

  const ranked = rankActions(facts, nowWall, (b) => pools.get(b) ?? null, Number.MAX_SAFE_INTEGER);
  const counts = zeroCounts();
  for (const i of ranked.items) counts[i.kind] += 1;
  const data: ActionQueue = {
    enabled: true, generatedAt: now.toISOString(), items: ranked.items.slice(0, ACTION_LIMITS.cap), counts,
    truncated: ranked.items.length > ACTION_LIMITS.cap, partial: failed.length > 0, failedSections: failed, ...(partialReason ? { partialReason } : {}),
  };
  if (!data.partial) {
    for (const [k, v] of cache) if (t - v.at >= CACHE_MS) cache.delete(k);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: t, data: structuredClone(data) });
  }
  return data;
}

export const offQueue = (): ActionQueue => ({ enabled: false, generatedAt: new Date().toISOString(), items: [], counts: zeroCounts(), truncated: false, partial: false, failedSections: [] });
export const actionQueueOn = (env: NodeJS.ProcessEnv = process.env): boolean => valueAddOn("action_queue", env);

/** The one full number, for one person, after a scope check. Null when out of scope, unknown or not a valid mobile. Never logged. */
export async function contactFor(ref: { type: "match" | "followup"; id: string }, kind: "tel" | "whatsapp", scope: BranchScope): Promise<string | null> {
  if (!scope.all && !scope.branchName) return null;
  const scoped = scope.all ? "" : ` AND %B% = ? ${COLL}`;
  const r = ref.type === "match"
    ? await rows(`SELECT l.mobile10 FROM he_match m JOIN he_lead l ON l.id = m.lead_id JOIN job_requisition jr ON jr.id = m.requisition_id ${COLL}
                   WHERE m.id = ?${scoped.replace("%B%", "jr.branch_name")} LIMIT 1`, scope.all ? [ref.id] : [ref.id, scope.branchName])
    : await rows(`SELECT qf.mobile10 FROM qualified_followup qf WHERE qf.id = ?${scoped.replace("%B%", "qf.branch_name")} LIMIT 1`, scope.all ? [ref.id] : [ref.id, scope.branchName]);
  return r[0] ? contactHref(kind, String(r[0].mobile10 ?? "")) : null;
}
