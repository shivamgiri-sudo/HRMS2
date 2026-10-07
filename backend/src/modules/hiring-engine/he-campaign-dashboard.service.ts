/**
 * One read-only dashboard for the three ways walk-ins are driven:
 *   1 live Meta campaigns   (per active campaign, the Meta funnel from form fill to joined)
 *   2 old Meta data re-runs (every launch made from Meta campaigns, one row each)
 *   3 saved data            (upload batches and every other pool source, one row each)
 * plus today's and tomorrow's drives. Cached for a minute: it is read by managers, and the numbers move slowly.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getMetaFunnel, type FunnelRow } from "./he-meta-funnel.service.js";
import { listBatches, listLaunches, type BatchRow, type LaunchRow } from "./he-launch.service.js";
import { getCampaignConfig } from "./he-campaign-config.service.js";
import { getDriveGroupsDetailed, type DriveGroup } from "./he-drive-trend.service.js";

export interface PoolSourceRow { source: string; people: number; contacted: number; invited: number; confirmed: number; arrived: number; noShow: number }
export interface DriveDayRow { driveId: string; date: string; branch: string; requisition: string; role: string; status: string; wanted: number; lined: number; invited: number; confirmed: number; arrived: number; noShow: number; declined: number }
export interface CampaignDashboard {
  generatedAt: string;
  live: Array<FunnelRow & { owner: "meta" | "he" }>;
  reruns: LaunchRow[];
  saved: { batches: Array<BatchRow & { launches: number }>; sources: PoolSourceRow[]; batchLaunches: LaunchRow[] };
  drives: DriveDayRow[];
  /** The same drives grouped per requisition, branch and source type, zero-filled over the window. Plan 4 switches the card to this and drops `drives`. */
  driveGroups: DriveGroup[];
  /** Only present when the grouped read failed (driveGroups is then empty); the dashboard is not cached in that case. */
  failedSections?: string[];
}
let cache: { at: number; data: CampaignDashboard } | null = null;
/** Test hook. */
export function clearCampaignDashboardCache(): void { cache = null; }

async function poolSources(): Promise<PoolSourceRow[]> {
  const [people] = await db.execute<RowDataPacket[]>("SELECT primary_source AS s, COUNT(*) AS n FROM he_lead GROUP BY primary_source");
  const [contacted] = await db.execute<RowDataPacket[]>(
    "SELECT l.primary_source AS s, COUNT(DISTINCT x.lead_id) AS n FROM he_message x JOIN he_lead l ON l.id = x.lead_id WHERE x.direction = 'out' AND x.delivery_status <> 'failed' GROUP BY l.primary_source");
  const [states] = await db.execute<RowDataPacket[]>(
    `SELECT l.primary_source AS s, COUNT(DISTINCT IF(m.state IN ('invited','confirmed','slot_released','arrived','no_show','selected'), m.lead_id, NULL)) AS invited,
            COUNT(DISTINCT IF(m.state IN ('confirmed','arrived','selected'), m.lead_id, NULL)) AS confirmed,
            COUNT(DISTINCT IF(m.state IN ('arrived','selected'), m.lead_id, NULL)) AS arrived,
            COUNT(DISTINCT IF(m.state = 'no_show', m.lead_id, NULL)) AS no_show
       FROM he_match m JOIN he_lead l ON l.id = m.lead_id GROUP BY l.primary_source`);
  const by = <T extends RowDataPacket>(rows: T[]) => new Map(rows.map((r) => [String(r.s), r]));
  const c = by(contacted), st = by(states);
  return people.map((p) => {
    const k = String(p.s), s = st.get(k);
    return { source: k, people: Number(p.n), contacted: Number(c.get(k)?.n ?? 0), invited: Number(s?.invited ?? 0), confirmed: Number(s?.confirmed ?? 0), arrived: Number(s?.arrived ?? 0), noShow: Number(s?.no_show ?? 0) };
  }).sort((a, b) => b.people - a.people);
}

async function driveDays(): Promise<DriveDayRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT d.id, d.drive_date, d.branch_name, d.status, d.target_shows, jr.requisition_code, jr.designation_name,
            COUNT(m.id) AS lined,
            SUM(m.state IN ('invited','confirmed','slot_released','arrived','no_show','selected')) AS invited,
            SUM(m.state IN ('confirmed','arrived','selected')) AS confirmed, SUM(m.state IN ('arrived','selected')) AS arrived,
            SUM(m.state = 'no_show') AS no_show, SUM(m.state = 'declined') AS declined
       FROM he_drive d JOIN job_requisition jr ON jr.id = d.requisition_id LEFT JOIN he_match m ON m.drive_id = d.id
      WHERE d.drive_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND DATE_ADD(CURDATE(), INTERVAL 3 DAY) AND d.status <> 'closed'
      GROUP BY d.id ORDER BY d.drive_date, d.branch_name`);
  return rows.map((r) => ({
    driveId: String(r.id), date: String(r.drive_date).slice(0, 10), branch: String(r.branch_name), requisition: String(r.requisition_code), role: String(r.designation_name), status: String(r.status),
    wanted: Number(r.target_shows), lined: Number(r.lined), invited: Number(r.invited ?? 0), confirmed: Number(r.confirmed ?? 0), arrived: Number(r.arrived ?? 0), noShow: Number(r.no_show ?? 0), declined: Number(r.declined ?? 0),
  }));
}

/** The grouped rows never take the dashboard down: an unexpected throw becomes an empty list plus a failed section. */
async function groupedSafe(): Promise<{ groups: DriveGroup[]; failedSections: string[] }> {
  try { return await getDriveGroupsDetailed(); } catch { return { groups: [], failedSections: ["driveGroups"] }; }
}

export async function getCampaignDashboard(): Promise<CampaignDashboard> {
  if (cache && Date.now() - cache.at < 60_000) return cache.data;
  const [funnel, launches, batches, sources, drives, grouped] = await Promise.all([getMetaFunnel(), listLaunches(100), listBatches(100), poolSources(), driveDays(), groupedSafe()]);
  const live = await Promise.all(funnel.campaigns.filter((c) => c.status === "active" || c.leads > 0).map(async (c) => ({ ...c, owner: (await getCampaignConfig(c.campaignId)).owner })));
  live.sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || b.leads - a.leads);
  const batchLaunches = launches.filter((l) => l.kind === "batch");
  const data: CampaignDashboard = {
    generatedAt: new Date().toISOString(), live,
    reruns: launches.filter((l) => l.kind === "campaign"),
    saved: { batches: batches.map((b) => ({ ...b, launches: batchLaunches.filter((l) => l.audienceNames.includes(b.label)).length })), sources, batchLaunches },
    drives, driveGroups: grouped.groups,
    ...(grouped.failedSections.length ? { failedSections: ["driveGroups"] } : {}),
  };
  if (!data.failedSections) cache = { at: Date.now(), data };
  return data;
}
