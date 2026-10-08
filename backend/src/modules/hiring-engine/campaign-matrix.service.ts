/**
 * The campaign x requisition x drive matrix read (WS3 C1). Rows: every active or draft campaign x each of its linked requisitions (the
 * primary mirror before migration 2142), paused / completed campaigns only when a Live Meta stream or 48 h activity names them, plus one
 * requisition-only row (Hiring Engine column) for every open requisition no campaign row covers. One statement per fact family, all keyed
 * by the requisition ids, each behind the analytics read limiter; optional families (responses, shortlist) that fail are listed in
 * `partial` and read as unknown. 60 s cache per scope and filter.
 */
import type { RowDataPacket } from "mysql2";
import { limitedDb } from "./he-read-limit.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import { closedReasonOf } from "../meta-campaign/campaign-requisition.service.js";
import { compileCriteria } from "../selection/compile-criteria.js";
import { LOAD_ROW_SQL, toCriteriaRow } from "../selection/criteria-row.js";
import { endDateOf, endDatePassed, seatsLeft } from "./requisition-criteria.js";
import { fillPhoneSql, fillTypeSql } from "./he-source-attribution.js";
import { loadLiveFrom } from "./he-source-attribution.service.js";
import { followupMode } from "./qualified-followup.schedule.js";
import { engineMode } from "./he-policy.service.js";
import { DRIVE_KINDS, matrixRows, type DriveKind, type MatrixFacts, type MatrixRow, type MatrixStream } from "./campaign-matrix.js";

export interface MatrixQuery { branch?: string | null; requisitionId?: string | null; campaignId?: string | null }
export interface CampaignMatrix { rows: MatrixRow[]; generatedAt: string; partial: string[]; enforcedEndDate: boolean }

const CI = "COLLATE utf8mb4_unicode_ci";
const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: CampaignMatrix }>();
export const clearMatrixCache = (): void => cache.clear();
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000);
const istDay = (d: Date) => ist(d).toISOString().slice(0, 10);
const istText = (d: Date) => ist(d).toISOString().slice(0, 19).replace("T", " ");
const noTable = (e: unknown) => (e as { code?: string })?.code === "ER_NO_SUCH_TABLE";
const run = async (sql: string, p: unknown[]): Promise<RowDataPacket[]> => (await limitedDb.execute<RowDataPacket[]>(sql, p))[0];

const CAMPAIGNS_SQL = `SELECT mc.id, mc.campaign_name, mc.campaign_status, mc.meta_form_id, mc.requisition_id AS primary_id, l.requisition_id AS link_id
  FROM meta_campaign mc LEFT JOIN meta_campaign_requisition l ON l.campaign_id = mc.id ${CI} AND l.removed_at IS NULL ORDER BY mc.created_at, l.is_primary DESC, l.sort_order`;
const CAMPAIGNS_NO_LINKS_SQL = `SELECT mc.id, mc.campaign_name, mc.campaign_status, mc.meta_form_id, mc.requisition_id AS primary_id, mc.requisition_id AS link_id
  FROM meta_campaign mc ORDER BY mc.created_at`;
const REQ_EXTRA = `jr.active_status, jr.closed_at, jr.requested_headcount, jr.fulfilled_headcount, jr.requisition_validity,
       (jr.bmi_assessment_url IS NOT NULL AND jr.bmi_assessment_url <> '') AS has_bmi,`;
const reqSql = (n: number, branch: boolean): string => LOAD_ROW_SQL.replace("SELECT jr.id,", `SELECT jr.id, ${REQ_EXTRA}`)
  .replace("WHERE jr.id = ? LIMIT 1", `WHERE (jr.id IN (${n ? ph(n) : "NULL"}) OR (jr.approval_status = 'approved' AND jr.active_status = 1 AND jr.closed_at IS NULL))${branch ? " AND jr.branch_name = ?" : ""}`);

/** People contacted in 48 h per requisition, kind (shared attribution rule) and campaign of their first fill. */
const activitySql = (n: number, liveFrom: string): string => `SELECT x.requisition_id, x.kind, x.campaign_id, COUNT(DISTINCT x.person) AS n /* activity48h */ FROM (
    SELECT COALESCE(r.requisition_id, mc.requisition_id) ${CI} AS requisition_id, ${fillTypeSql("r", liveFrom)} AS kind, r.campaign_id ${CI} AS campaign_id, ${fillPhoneSql("r")} ${CI} AS person
      FROM meta_lead_raw r JOIN meta_campaign mc ON mc.id = r.campaign_id ${CI}
     WHERE r.notification_sent_at >= ? AND COALESCE(r.requisition_id, mc.requisition_id) IN (${ph(n)})
    UNION ALL
    SELECT hm.requisition_id ${CI}, IF(f.id IS NULL, 'he', ${fillTypeSql("f", liveFrom)}), f.campaign_id ${CI}, hm.mobile10 ${CI}
      FROM he_message hm FORCE INDEX (idx_he_msg_req) LEFT JOIN he_lead l ON l.id = hm.lead_id LEFT JOIN meta_lead_raw f ON f.id = l.meta_lead_id ${CI}
     WHERE hm.requisition_id IN (${ph(n)}) AND hm.created_at >= ? AND hm.direction = 'out' AND (hm.delivery_status IS NULL OR hm.delivery_status <> 'failed')
  ) x GROUP BY x.requisition_id, x.kind, x.campaign_id`;
const responsesSql = (n: number, liveFrom: string): string => `SELECT cr.requisition_id, IF(f.id IS NULL, 'he', ${fillTypeSql("f", liveFrom)}) AS kind, f.campaign_id, COUNT(DISTINCT cr.mobile10) AS n
  FROM candidate_response cr LEFT JOIN he_lead l ON l.mobile10 = cr.mobile10 ${CI} LEFT JOIN meta_lead_raw f ON f.id = COALESCE(cr.meta_lead_id, l.meta_lead_id) ${CI}
 WHERE cr.requisition_id IN (${ph(n)}) AND cr.occurred_at >= ? GROUP BY cr.requisition_id, kind, f.campaign_id`;
const shortlistSql = (n: number): string => `SELECT r.requisition_id, r.source_kind, r.created_at, SUM(c.status IN ('picked','review')) AS waiting, COUNT(c.id) AS n
  FROM shortlist_run r JOIN (SELECT requisition_id, source_kind, MAX(created_at) AS m FROM shortlist_run WHERE requisition_id IN (${ph(n)}) GROUP BY requisition_id, source_kind) x
    ON x.requisition_id = r.requisition_id AND x.source_kind = r.source_kind AND x.m = r.created_at
  LEFT JOIN shortlist_candidate c ON c.run_id = r.id GROUP BY r.id, r.requisition_id, r.source_kind, r.created_at`;

const STREAM_RANK: Record<string, number> = { open: 0, paused: 1, draft: 2, closed: 3 };
const jsonOf = (v: unknown): Record<string, unknown> | null => {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  try { return typeof v === "string" ? (JSON.parse(v) as Record<string, unknown>) : null; } catch { return null; }
};

export async function getCampaignMatrix(q: MatrixQuery, scope: BranchScope, now = new Date()): Promise<CampaignMatrix> {
  const branch = scope.all ? (q.branch ?? null) : scope.branchName;
  if (!scope.all && !scope.branchName) return { rows: [], generatedAt: now.toISOString(), partial: [], enforcedEndDate: false };
  if (!scope.all && q.branch && q.branch !== scope.branchName) return { rows: [], generatedAt: now.toISOString(), partial: [], enforcedEndDate: false };
  const key = JSON.stringify([branch, q.requisitionId ?? null, q.campaignId ?? null]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await build(q, branch, now);
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function build(q: MatrixQuery, branch: string | null, now: Date): Promise<CampaignMatrix> {
  const partial: string[] = [];
  const [campaigns, params, liveFrom] = await Promise.all([
    run(CAMPAIGNS_SQL, []).catch((e) => { if (noTable(e)) return run(CAMPAIGNS_NO_LINKS_SQL, []); throw e; }),
    run("SELECT param_key, value FROM he_model_param WHERE param_key IN ('policy.req_end_date_enforced', 'policy.shortlist.enrol', 'policy.engine_auto')", []).catch(() => [] as RowDataPacket[]),
    loadLiveFrom(),
  ]);
  const param = (k: string) => Number(params.find((p) => p.param_key === k)?.value ?? 0) === 1;
  const enforced = param("policy.req_end_date_enforced");
  const engineLive = engineMode(process.env, param("policy.engine_auto")) === "live";
  const enrolHe = engineLive || param("policy.shortlist.enrol");

  const referenced = [...new Set(campaigns.map((c) => String(c.link_id ?? c.primary_id ?? "")).filter(Boolean))];
  const reqRows = await run(reqSql(referenced.length, !!branch), [...referenced, ...(branch ? [branch] : [])]);
  const reqById = new Map(reqRows.map((r) => [String(r.id), r]));
  const ids = [...reqById.keys()];
  if (!ids.length) return { rows: [], generatedAt: now.toISOString(), partial, enforcedEndDate: enforced };

  const since48 = istText(new Date(now.getTime() - 48 * 3600_000)), since3d = istText(new Date(now.getTime() - 72 * 3600_000));
  const today = istDay(now), in3 = istDay(new Date(now.getTime() + 3 * 86_400_000));
  const optional = async (name: string, sql: string, p: unknown[], absentIsNull = true): Promise<RowDataPacket[] | null> => {
    try { return await run(sql, p); } catch (e) { if (absentIsNull && noTable(e)) return null; partial.push(name); return null; }
  };
  const [streams, activity, responses, drives, runs] = await Promise.all([
    run(`SELECT id, requisition_id, source_type, origin_id, status FROM requisition_stream WHERE requisition_id IN (${ph(ids.length)}) ORDER BY updated_at DESC`, ids).catch((e) => { if (noTable(e)) return [] as RowDataPacket[]; throw e; }),
    run(activitySql(ids.length, liveFrom), [since48, ...ids, ...ids, since48]),
    optional("responses", responsesSql(ids.length, liveFrom), [...ids, since3d]),
    run(`SELECT requisition_id, COUNT(*) AS n FROM he_drive WHERE requisition_id IN (${ph(ids.length)}) AND drive_date BETWEEN ? AND ? AND status IN ('active', 'draft') GROUP BY requisition_id`, [...ids, today, in3]),
    optional("shortlist", shortlistSql(ids.length), ids),
  ]);

  // rows
  const inScope = (id: string) => reqById.has(id) && (!q.requisitionId || q.requisitionId === id);
  const activeCampaign = (c: RowDataPacket) => ["active", "draft"].includes(String(c.campaign_status));
  const liveStreamFor = (cid: string, rid: string) => streams.some((s) => String(s.origin_id) === cid && String(s.requisition_id) === rid && s.source_type === "meta_live");
  const actFor = (cid: string, rid: string) => activity.some((a) => String(a.campaign_id ?? "") === cid && String(a.requisition_id) === rid && Number(a.n) > 0);
  const pairs: Array<{ c: RowDataPacket | null; rid: string }> = [];
  const seen = new Set<string>();
  for (const c of campaigns) {
    const rid = String(c.link_id ?? c.primary_id ?? "");
    if (!rid || !inScope(rid) || (q.campaignId && String(c.id) !== q.campaignId)) continue;
    if (!activeCampaign(c) && !liveStreamFor(String(c.id), rid) && !actFor(String(c.id), rid)) continue;
    const k = `${c.id}|${rid}`;
    if (seen.has(k)) continue;
    seen.add(k); pairs.push({ c, rid });
  }
  const covered = new Set(pairs.map((p) => p.rid));
  if (!q.campaignId) for (const r of reqRows) if (!covered.has(String(r.id)) && inScope(String(r.id)) && !closedReasonOf(r) && r.approval_status === "approved") pairs.push({ c: null, rid: String(r.id) });

  const facts: MatrixFacts[] = pairs.map(({ c, rid }) => {
    const r = reqById.get(rid)!;
    const cid = c ? String(c.id) : null;
    const v = { validity: r.requisition_validity as string | Date | null };
    const streamsOf: Partial<Record<DriveKind, MatrixStream>> = {};
    for (const kind of DRIVE_KINDS) {
      const cands = streams.filter((s) => String(s.requisition_id) === rid && s.source_type === kind && (kind !== "meta_live" || String(s.origin_id) === cid));
      const best = cands.sort((a, b) => (STREAM_RANK[String(a.status)] ?? 9) - (STREAM_RANK[String(b.status)] ?? 9))[0];
      if (best) streamsOf[kind] = { id: String(best.id), status: String(best.status) as MatrixStream["status"], originId: String(best.origin_id) };
    }
    const count = (rows: RowDataPacket[] | null, kind: DriveKind) => (rows ?? []).filter((a) => String(a.requisition_id) === rid && a.kind === kind && (kind === "he" || String(a.campaign_id ?? "") === cid))
      .reduce((s, a) => s + Number(a.n), 0);
    const per = (rows: RowDataPacket[] | null) => ({ meta_live: count(rows, "meta_live"), meta_old: count(rows, "meta_old"), he: count(rows, "he") });
    const eligible: MatrixFacts["eligible"] = {}, pending: MatrixFacts["pendingApproval"] = {};
    for (const x of runs ?? []) {
      if (String(x.requisition_id) !== rid) continue;
      const kind = x.source_kind as DriveKind;
      eligible[kind] = Number(x.waiting ?? 0);
      const at = Date.parse(`${String(x.created_at).replace(" ", "T")}+05:30`);
      pending[kind] = Number(x.waiting ?? 0) > 0 && Number.isFinite(at) && now.getTime() - at > 24 * 3600_000;
    }
    const cfg = jsonOf(r.meta_screening_config);
    return {
      campaign: c ? { id: String(c.id), name: String(c.campaign_name ?? ""), status: String(c.campaign_status ?? ""), hasForm: !!String(c.meta_form_id ?? "").trim() } : null,
      requisition: { id: rid, code: String(r.requisition_code ?? ""), branch: String(r.branch_name ?? ""), closedReason: closedReasonOf(r), endDate: endDateOf(v), endDatePassed: endDatePassed(v, istDay(now)),
        seatsLeft: seatsLeft({ requestedHeadcount: Number(r.requested_headcount ?? 0), fulfilledHeadcount: Number(r.fulfilled_headcount ?? 0) }), bmiLinkPresent: Number(r.has_bmi) === 1,
        completeness: compileCriteria(toCriteriaRow(r)).completeness },
      streams: streamsOf, activity48h: per(activity), responses3d: responses ? per(responses) : null,
      drivesNext3d: Number(drives.find((d) => String(d.requisition_id) === rid)?.n ?? 0), eligible, pendingApproval: pending,
      enrolmentOn: { meta_live: cfg?.auto_notify !== false || followupMode() !== "off", meta_old: enrolHe, he: enrolHe }, enforcedEndDate: enforced,
    };
  });
  return { rows: matrixRows(facts), generatedAt: now.toISOString(), partial, enforcedEndDate: enforced };
}
