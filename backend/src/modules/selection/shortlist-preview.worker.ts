/**
 * WS3 D4: shortlist PREVIEW runs in the evening (17:00-20:00 IST, one per requisition x source x IST day) and on Live Meta arrival
 * (new qualified leads since the requisition's last Live Meta run, at most one run per 30 minutes). Preview only: it never approves or
 * enrols; HR approves on the approve bar as before. Per campaign through SHORTLIST_AUTO_PREVIEW (off | all | campaign ids), off by
 * default: no timer and no statement. A MySQL advisory lock keeps two processes apart; a tick makes at most MAX_RUNS_PER_TICK runs.
 */
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { requisitionState, runShortlist } from "./approval.service.js";
import { cacheMetaLeadFacts, refreshFactCache } from "./fact-cache.service.js";
import { istText } from "./facts-loader.service.js";
import type { SourceKind } from "./selection-types.js";

export const PREVIEW_LOCK = "shortlist_preview_tick";
export const MAX_RUNS_PER_TICK = 6;
export const EVENING_REFRESH_MAX_CHUNKS = 30; // 30 x 2,000 people per source and evening (plan budget: 60k)
const ARRIVAL_DEBOUNCE_MIN = 30;
const ARRIVAL_MAX_LEADS = 200;
const INTERVAL_MS = 5 * 60 * 1000;
const SOURCES: SourceKind[] = ["meta_live", "meta_old", "he"];
const IST_MS = 330 * 60_000;

export function autoPreviewCampaigns(env: NodeJS.ProcessEnv = process.env): "off" | "all" | string[] {
  const v = String(env.SHORTLIST_AUTO_PREVIEW ?? "").trim();
  if (!v || /^(off|0|false)$/i.test(v)) return "off";
  if (/^(all|1|true|on)$/i.test(v)) return "all";
  const ids = v.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length ? ids : "off";
}

export function inEveningWindow(now: Date): boolean {
  const hour = new Date(now.getTime() + IST_MS).getUTCHours();
  return hour >= 17 && hour < 20;
}

export interface PreviewDeps {
  runShortlist: (a: Parameters<typeof runShortlist>[0]) => Promise<unknown>;
  notOpen: (requisitionId: string, now: Date) => Promise<string | null>;
  refreshFactCache: (o: Parameters<typeof refreshFactCache>[0]) => Promise<unknown>;
  cacheMetaLeadFacts: (ids: string[], now: Date) => Promise<number>;
}
const defaultDeps: PreviewDeps = {
  runShortlist,
  notOpen: async (id, now) => (await requisitionState(id, now)).notOpen,
  refreshFactCache,
  cacheMetaLeadFacts,
};

export interface PreviewTickReport {
  skipped?: "off" | "locked" | "running";
  evening: { runs: number; exists: number; refreshed: SourceKind[] };
  arrival: { runs: number; people: number };
  closed: number; errors: number;
}

const refreshedDay = new Map<SourceKind, string>(); // in memory: a restart refreshes again at most once
let running = false;
const isDup = (e: unknown) => (e as { code?: string })?.code === "ER_DUP_ENTRY";

export async function runShortlistPreviewTick(o: { now?: Date; env?: NodeJS.ProcessEnv; deps?: Partial<PreviewDeps> } = {}): Promise<PreviewTickReport> {
  const out: PreviewTickReport = { evening: { runs: 0, exists: 0, refreshed: [] }, arrival: { runs: 0, people: 0 }, closed: 0, errors: 0 };
  const campaigns = autoPreviewCampaigns(o.env ?? process.env);
  if (campaigns === "off") return { ...out, skipped: "off" };
  if (running) return { ...out, skipped: "running" };
  running = true;
  const now = o.now ?? new Date();
  const d = { ...defaultDeps, ...o.deps };
  let conn: PoolConnection | undefined;
  let locked = false;
  try {
    conn = await db.getConnection();
    const [l] = await conn.execute<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS got", [PREVIEW_LOCK]);
    if (Number(l[0]?.got) !== 1) return { ...out, skipped: "locked" };
    locked = true;
    const list = campaigns === "all" ? [] : campaigns;
    const [links] = await db.execute<RowDataPacket[]>(
      `SELECT mcr.campaign_id, mcr.requisition_id FROM meta_campaign_requisition mcr${list.length ? ` WHERE mcr.campaign_id IN (${list.map(() => "?").join(",")})` : ""}
        ORDER BY mcr.requisition_id`, list);
    const open: string[] = [];
    for (const id of [...new Set(links.map((r) => String(r.requisition_id)))]) {
      if (await d.notOpen(id, now).catch(() => "unreadable")) out.closed++;
      else open.push(id);
    }
    let budget = MAX_RUNS_PER_TICK;
    if (inEveningWindow(now) && open.length) {
      const day = istText(now).slice(0, 10);
      for (const sourceKind of SOURCES) {
        if (refreshedDay.get(sourceKind) === day) continue;
        await d.refreshFactCache({ sourceKind, now, maxChunks: EVENING_REFRESH_MAX_CHUNKS })
          .then(() => { refreshedDay.set(sourceKind, day); out.evening.refreshed.push(sourceKind); })
          .catch((e) => { out.errors++; logger.warn({ sourceKind, err: String((e as Error).message).slice(0, 200) }, "[shortlist-preview] facts refresh failed"); });
      }
      for (const requisitionId of open) {
        for (const sourceKind of SOURCES) {
          if (budget <= 0) break;
          const [x] = await db.execute<RowDataPacket[]>("SELECT 1 AS hit FROM shortlist_run WHERE requisition_id = ? AND source_kind = ? AND evening_date = ? LIMIT 1", [requisitionId, sourceKind, day]);
          if (x.length) { out.evening.exists++; continue; }
          budget--;
          try {
            await d.runShortlist({ requisitionId, sourceKind, now, createdBy: null, trigger: "evening", eveningDate: day });
            out.evening.runs++;
          } catch (e) {
            if (isDup(e)) out.evening.exists++;
            else { out.errors++; logger.warn({ requisitionId, sourceKind, err: String((e as Error).message).slice(0, 200) }, "[shortlist-preview] evening run failed"); }
          }
        }
      }
    }
    for (const requisitionId of open) {
      if (budget <= 0) break;
      const [lr] = await db.execute<RowDataPacket[]>(
        `SELECT MAX(created_at) AS last, MAX(created_at) > DATE_SUB(NOW(), INTERVAL ${ARRIVAL_DEBOUNCE_MIN} MINUTE) AS recent
           FROM shortlist_run WHERE requisition_id = ? AND source_kind = 'meta_live'`, [requisitionId]);
      if (Number(lr[0]?.recent ?? 0) === 1) continue;
      const since = lr[0]?.last ? String(lr[0].last instanceof Date ? istText(lr[0].last) : lr[0].last) : "1970-01-01 00:00:00";
      const [ar] = await db.execute<RowDataPacket[]>(
        `SELECT r.id FROM meta_lead_raw r WHERE r.requisition_id = ? AND r.screening_result = 'qualified' AND r.created_at > ? ORDER BY r.created_at LIMIT ${ARRIVAL_MAX_LEADS}`,
        [requisitionId, since]);
      if (!ar.length) continue;
      budget--;
      try {
        await d.cacheMetaLeadFacts(ar.map((r) => String(r.id)), now);
        await d.runShortlist({ requisitionId, sourceKind: "meta_live", now, createdBy: null, trigger: "arrival" });
        out.arrival.runs++;
        out.arrival.people += ar.length;
      } catch (e) {
        out.errors++;
        logger.warn({ requisitionId, err: String((e as Error).message).slice(0, 200) }, "[shortlist-preview] arrival run failed");
      }
    }
    if (out.evening.runs || out.arrival.runs || out.errors) logger.info({ ...out }, "[shortlist-preview] tick");
    return out;
  } finally {
    if (conn) {
      if (locked) await conn.execute("SELECT RELEASE_LOCK(?)", [PREVIEW_LOCK]).catch(() => undefined);
      conn.release();
    }
    running = false;
  }
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Idempotent; nothing starts while SHORTLIST_AUTO_PREVIEW is off (the default). */
export function startShortlistPreviewWorker(): void {
  if (timer) return;
  if (autoPreviewCampaigns() === "off") return;
  timer = setInterval(() => {
    runShortlistPreviewTick().catch((err) => logger.error({ err: (err as Error).message }, "[shortlist-preview] tick failed"));
  }, INTERVAL_MS);
  timer.unref();
}

export function stopShortlistPreviewWorker(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

/** For tests: forget which sources were refreshed today. */
export function resetShortlistPreviewState(): void { refreshedDay.clear(); running = false; }
