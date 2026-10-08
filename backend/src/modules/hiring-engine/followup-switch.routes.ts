/**
 * Master-tab switches for the unified follow-up (Task 16), under /api/he. Per source mode (off / dry run / test / canary / live, capped
 * by the env ceiling QUAL_FOLLOWUP_MODE), the canary requisitions, the per-branch canary caps, the kill switch and the Pinbot-inbound
 * verified flag. Every write is audited with the user id. Canary / live is refused (409) while Pinbot inbound WhatsApp is not verified
 * unless the owner explicitly acknowledges the risk (stored as policy.followup.wa_inbound_ack); STOP still works through the other channels.
 * Must be registered before /qualified-followup/:id.
 */
import type { Request, Response, Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { requisitionOpenReason } from "./followup-guards.js";
import { branchFirstContactsToday, loadRequisitionFacts, sharedWaSentToday } from "./followup-guards.service.js";
import { waInboundHealth } from "./followup-optout.service.js";
import { getPinbotQuality } from "./he-pinbot-quality.service.js";
import { applyInboundGate, readSwitches, SOURCE_MODE_CODES, switchRefusal } from "./qualified-followup.policy.js";
import { waDailyBudget } from "./qualified-followup.rules.js";
import type { SourceMode, SourceType } from "./qualified-followup.types.js";

const SOURCES: readonly SourceType[] = ["meta_live", "meta_old", "he"];
const MODES = Object.keys(SOURCE_MODE_CODES) as SourceMode[];
const MODE_BY_CODE = new Map<number, SourceMode>(Object.entries(SOURCE_MODE_CODES).map(([m, c]) => [c, m as SourceMode]));
const PREFIX_RE = /^[A-Z0-9][A-Z0-9_-]{0,39}$/;
const REQ_ID_RE = /^[A-Za-z0-9-]{1,36}$/;
const IST_MS = 5.5 * 3600_000;
const C = "COLLATE utf8mb4_unicode_ci";

const isSource = (v: unknown): v is SourceType => typeof v === "string" && (SOURCES as readonly string[]).includes(v);
const wall = (d: Date | null) => (d ? new Date(d.getTime() + IST_MS).toISOString().slice(0, 19).replace("T", " ") : null);
const userOf = (req: Request) => (req as AuthenticatedRequest).authUser?.id ?? "unknown";

async function setParam(key: string, value: number): Promise<void> {
  await db.execute("INSERT INTO he_model_param (param_key, value, sample) VALUES (?,?,0) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);
}

async function audit(req: Request, entity: string, change: Record<string, unknown>): Promise<void> {
  await writeAuditLog({ actor_user_id: userOf(req), action_type: "he_followup_switch", module_key: "hiring_engine", entity_type: "followup_switch", entity_id: entity, metadata: change, req });
}

function fail(res: Response, what: string, err: unknown): void {
  logger.error({ err: String((err as Error)?.message ?? err).split("\n")[0].replace(/\d{6,}/g, "#").slice(0, 200) }, `[he] follow-up switches: ${what} failed`);
  res.status(500).json({ success: false, message: `Could not ${what}` });
}

async function readParams(): Promise<Map<string, number>> {
  const [p] = await db.execute<RowDataPacket[]>("SELECT param_key, value FROM he_model_param WHERE param_key LIKE 'policy.followup.%'");
  return new Map(p.map((r) => [String(r.param_key), Number(r.value)]));
}

export async function switchesView(now: Date = new Date()): Promise<Record<string, unknown>> {
  const params = await readParams();
  const [canaryRows] = await db.execute<RowDataPacket[]>(
    `SELECT fc.source_type, fc.requisition_id, jr.requisition_code, jr.branch_name FROM followup_canary fc
       LEFT JOIN job_requisition jr ON jr.id ${C} = fc.requisition_id ${C} ORDER BY fc.added_at`);
  const canary = canaryRows.map((r) => ({ sourceType: String(r.source_type) as SourceType, requisitionId: String(r.requisition_id), code: r.requisition_code ? String(r.requisition_code) : null, branch: r.branch_name ? String(r.branch_name) : null }));
  const s = applyInboundGate(readSwitches(process.env, params, canary), params);
  const sources = Object.fromEntries(SOURCES.map((src) => {
    const code = params.get(`policy.followup.${src}`);
    return [src, { mode: (code !== undefined && MODE_BY_CODE.get(code)) || "off", effective: s.sourceModes[src] }];
  }));
  const caps = await Promise.all([...s.canaryCaps].map(async ([prefix, dailyMax]) => ({ prefix, dailyMax, usedToday: await branchFirstContactsToday(prefix, now) })));
  const quality = await getPinbotQuality();
  const inb = await waInboundHealth(now);
  const [cnt] = await db.execute<RowDataPacket[]>("SELECT source_type, journey_state, COUNT(*) AS n FROM qualified_followup GROUP BY source_type, journey_state");
  const counts: Record<string, Record<string, number>> = Object.fromEntries(SOURCES.map((src) => [src, {}]));
  for (const r of cnt) if (counts[String(r.source_type)]) counts[String(r.source_type)][String(r.journey_state)] = Number(r.n);
  return {
    ceiling: s.ceiling, killSwitch: s.killSwitch, envPaused: s.sendsPaused, inboundGate: s.inboundGate, sources, canary, caps,
    budget: { max: waDailyBudget(quality, s.waDailyMax), quality, used: await sharedWaSentToday(now) },
    inbound: { lastInboundAt: wall(inb.lastInboundAt), inbound7d: inb.inbound7d, verified: inb.verified, acknowledged: params.get("policy.followup.wa_inbound_ack") === 1 },
    counts,
  };
}

export function registerFollowupSwitchRoutes(r: Router, roles: { view: string[]; admin: string[] }): void {
  const view = [requireAuth, requireRole(...roles.view)];
  const admin = [requireAuth, requireRole(...roles.admin)];

  r.get("/qualified-followup/switches", ...view, async (_req, res) => {
    try { res.json({ success: true, data: await switchesView() }); } catch (err) { fail(res, "load the follow-up switches", err); }
  });

  r.put("/qualified-followup/switches/:source", ...admin, async (req, res) => {
    const source = req.params.source;
    const mode = (req.body ?? {}).mode;
    if (!isSource(source)) return res.status(400).json({ success: false, message: "Unknown source" });
    if (!MODES.includes(mode)) return res.status(400).json({ success: false, message: `mode must be one of ${MODES.join(", ")}` });
    const ack = (req.body ?? {}).acknowledgeInboundUnverified === true;
    try {
      const params = await readParams();
      const inbound = { verified: params.get("policy.followup.wa_inbound_verified") === 1, acknowledged: params.get("policy.followup.wa_inbound_ack") === 1 || ack };
      const refusal = switchRefusal(mode, inbound);
      if (refusal) return res.status(409).json({ success: false, message: refusal, code: "inbound_unverified" });
      if (ack && params.get("policy.followup.wa_inbound_ack") !== 1 && params.get("policy.followup.wa_inbound_verified") !== 1) await setParam("policy.followup.wa_inbound_ack", 1);
      await setParam(`policy.followup.${source}`, SOURCE_MODE_CODES[mode as SourceMode]);
      await audit(req, `policy.followup.${source}`, { from: MODE_BY_CODE.get(params.get(`policy.followup.${source}`) ?? 0) ?? "off", to: mode, acknowledgedInboundUnverified: ack });
      res.json({ success: true });
    } catch (err) { fail(res, "change the follow-up switch", err); }
  });

  r.post("/qualified-followup/canary", ...admin, async (req, res) => {
    const { sourceType, requisitionId } = req.body ?? {};
    if (!isSource(sourceType) || typeof requisitionId !== "string" || !REQ_ID_RE.test(requisitionId)) return res.status(400).json({ success: false, message: "sourceType and requisitionId are required" });
    try {
      const why = requisitionOpenReason(await loadRequisitionFacts(requisitionId), { endDateEnforced: true });
      if (why) return res.status(409).json({ success: false, message: `Only an open requisition can be a canary: ${why}` });
      await db.execute("INSERT INTO followup_canary (source_type, requisition_id, added_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE added_by = VALUES(added_by)", [sourceType, requisitionId, userOf(req)]);
      await audit(req, `canary.${sourceType}`, { added: requisitionId });
      res.json({ success: true });
    } catch (err) { fail(res, "add the canary requisition", err); }
  });

  r.delete("/qualified-followup/canary/:sourceType/:requisitionId", ...admin, async (req, res) => {
    const { sourceType, requisitionId } = req.params;
    if (!isSource(sourceType) || !REQ_ID_RE.test(requisitionId)) return res.status(400).json({ success: false, message: "Invalid canary entry" });
    try {
      await db.execute("DELETE FROM followup_canary WHERE source_type = ? AND requisition_id = ?", [sourceType, requisitionId]);
      await audit(req, `canary.${sourceType}`, { removed: requisitionId });
      res.json({ success: true });
    } catch (err) { fail(res, "remove the canary requisition", err); }
  });

  r.put("/qualified-followup/caps/:prefix", ...admin, async (req, res) => {
    const prefix = String(req.params.prefix ?? "").trim().toUpperCase();
    const dailyMax = (req.body ?? {}).dailyMax;
    if (!PREFIX_RE.test(prefix)) return res.status(400).json({ success: false, message: "Invalid branch prefix" });
    if (!Number.isInteger(dailyMax) || dailyMax < 0 || dailyMax > 1000) return res.status(400).json({ success: false, message: "dailyMax must be a whole number from 0 to 1000" });
    try {
      await setParam(`policy.followup.canary_cap.${prefix}`, dailyMax);
      await audit(req, `policy.followup.canary_cap.${prefix}`, { to: dailyMax });
      res.json({ success: true });
    } catch (err) { fail(res, "change the canary cap", err); }
  });

  for (const [path, field, key] of [["kill", "paused", "policy.followup.paused"], ["inbound-verified", "verified", "policy.followup.wa_inbound_verified"]] as const) {
    r.put(`/qualified-followup/${path}`, ...admin, async (req, res) => {
      const v = (req.body ?? {})[field];
      if (typeof v !== "boolean") return res.status(400).json({ success: false, message: `${field} must be true or false` });
      try {
        await setParam(key, v ? 1 : 0);
        await audit(req, key, { to: v });
        res.json({ success: true });
      } catch (err) { fail(res, `change ${field}`, err); }
    });
  }
}
