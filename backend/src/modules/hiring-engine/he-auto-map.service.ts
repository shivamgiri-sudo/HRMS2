/**
 * Maps the Hiring Engine pool to the requisition being filled, with no HR click. For every process + designation + branch the requisition
 * at the front of the sequence (nearest end date, not yet at its join target) gets one "he" pool stream: open from today to its end date
 * (at most MAX_CREATE_DAYS), sized to the daily need the fulfilment view computed, capped at the stream limit of 500. When that
 * requisition reaches its target, the next one becomes the front and is mapped on the next pass. Streams that already exist are left alone.
 * Switch: policy.auto_map_pool = 0 turns it off (absent = on). Never throws.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import { getFulfilment } from "./he-fulfilment.service.js";
import { nextWorkingDay } from "./he-plan.service.js";
import { planStreamsForDay } from "./he-stream-plan.service.js";
import { loadStreamsOfType, tryCreateStream } from "./requisition-stream.service.js";
import { MAX_CREATE_DAYS, istToday } from "./requisition-stream.window.js";

export const AUTO_MAP_KEY = "policy.auto_map_pool";
const MIN_DAILY = 50, MAX_DAILY = 500, DEFAULT_DAYS = 14;
const ALL = { all: true, branchName: null } as unknown as BranchScope;

export interface AutoMapReport { off: boolean; considered: number; created: string[]; kept: string[]; skipped: Array<{ code: string; reason: string }> }

async function switchedOn(): Promise<boolean> {
  try {
    const [r] = await db.execute<RowDataPacket[]>("SELECT value FROM he_model_param WHERE param_key = ? LIMIT 1", [AUTO_MAP_KEY]);
    return r[0] ? Number(r[0].value) !== 0 : true;
  } catch { return false; }
}

export async function autoMapPoolStreams(now: Date = new Date()): Promise<AutoMapReport> {
  const rep: AutoMapReport = { off: false, considered: 0, created: [], kept: [], skipped: [] };
  try {
    if (!(await switchedOn())) { rep.off = true; return rep; }
    const view = await getFulfilment(now);
    if (view.computing) { rep.skipped.push({ code: "*", reason: "sizing_not_ready" }); return rep; }
    const today = istToday(now);
    const front = view.requisitions.filter((r) => r.sequence === 1 && r.verdict !== "past_deadline" && r.verdict !== "no_history" && r.seatsOpen > 0);
    for (const r of front) {
      rep.considered++;
      if (r.verdict === "covered") { rep.skipped.push({ code: r.code, reason: "already_covered" }); continue; }
      const existing = await loadStreamsOfType(r.id, "he");
      if (existing.some((s) => s.status === "open" || s.status === "paused" || s.status === "draft")) { rep.kept.push(r.code); continue; }
      const days = Math.min(MAX_CREATE_DAYS, Math.max(1, r.daysLeft != null && r.daysLeft > 0 ? r.daysLeft : DEFAULT_DAYS));
      const daily = Math.min(MAX_DAILY, Math.max(MIN_DAILY, r.perDayNeeded || MIN_DAILY));
      const out = await tryCreateStream({ requisitionId: r.id, sourceType: "he", originId: "pool", openFrom: today, openDays: days, dailyInvites: daily, open: true,
        reason: "auto-mapped: the front of its sequence" }, { userId: null, isAdmin: false, scope: ALL }, now);
      if (!out.ok) { rep.skipped.push({ code: r.code, reason: out.reason }); continue; }
      rep.created.push(r.code);
      // Line up the next working day now instead of waiting for the evening pass.
      await planStreamsForDay({ date: nextWorkingDay(now), dryRun: false, requisitionId: r.id }).catch(() => undefined);
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message.slice(0, 140) }, "[auto-map] pass failed");
  }
  if (rep.created.length) logger.info({ created: rep.created, kept: rep.kept.length }, "[auto-map] pool streams mapped");
  return rep;
}
