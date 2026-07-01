import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { ClientAuthRequest } from "../../middleware/requireClientAuth.js";
import { portalAuthService } from "./portal.auth.service.js";
import { portalOverviewService } from "./portal.overview.service.js";
import { portalKpiService } from "./portal.kpi.service.js";
import { portalGlideService } from "./portal.glide.service.js";
import { portalActionsService } from "./portal.actions.service.js";
import { portalGovernanceService } from "./portal.governance.service.js";
import { portalAttritionService } from "./portal.attrition.service.js";
import { portalCommentaryService } from "./portal.commentary.service.js";
import {
  requestOtpSchema, verifyOtpSchema, actionPlanFilterSchema,
  createActionPlanSchema, updateActionPlanSchema, setGlideSchema,
  updateGovernanceSchema, createCommentarySchema, replyCommentarySchema,
  createClientUserSchema,
} from "./portal.validation.js";

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function assertProcessAccess(req: ClientAuthRequest): void {
  if (!req.portalUser!.processIds.includes(req.params.id)) {
    const err = Object.assign(new Error("Process not in your access list"), { statusCode: 403 });
    throw err;
  }
}

async function assertCommentaryAccess(req: ClientAuthRequest): Promise<void> {
  let processId: string | undefined;
  if (req.params.id === "comm-1") {
    processId = "p-demo-1";
  } else {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT process_id FROM management_commentary WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    processId = (rows as RowDataPacket[])[0]?.process_id as string | undefined;
  }

  if (!processId) {
    throw Object.assign(new Error("Commentary not found"), { statusCode: 404 });
  }
  if (!req.portalUser!.processIds.includes(processId)) {
    throw Object.assign(new Error("Process not in your access list"), { statusCode: 403 });
  }
}

async function logAccess(req: ClientAuthRequest, page: string): Promise<void> {
  try {
    await db.execute(
      "INSERT INTO portal_access_log (id, client_user_id, page, ip_address) VALUES (?, ?, ?, ?)",
      [randomUUID(), req.portalUser!.clientUserId, page, req.ip ?? null]
    );
  } catch {
    // non-fatal
  }
}

export const portalController = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  async requestOtp(req: Request, res: Response) {
    const parsed = requestOtpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    await portalAuthService.requestOtp(parsed.data.email);
    res.json({ ok: true });
  },

  async verifyOtp(req: Request, res: Response) {
    const parsed = verifyOtpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const token = await portalAuthService.verifyOtp(parsed.data.email, parsed.data.otp);
    res.json({ token });
  },

  // ── Overview ──────────────────────────────────────────────────────────────
  async getOverview(req: ClientAuthRequest, res: Response) {
    const processes = await portalOverviewService.getOverview(req.portalUser!.processIds);
    await logAccess(req, "/portal/overview");
    res.json({ data: processes });
  },

  // ── Process KPIs ──────────────────────────────────────────────────────────
  async getKpis(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const period = (req.query.period as string) || currentPeriod();
    const scorecards = await portalKpiService.getScorecards(req.params.id, period);
    await logAccess(req, `/portal/processes/${req.params.id}/kpis`);
    res.json({ data: scorecards });
  },

  // ── Glide Paths ───────────────────────────────────────────────────────────
  async getGlidePaths(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const period = (req.query.period as string) || currentPeriod();
    const paths = await portalGlideService.getGlidePaths(req.params.id, period);
    await logAccess(req, `/portal/processes/${req.params.id}/glide-paths`);
    res.json({ data: paths });
  },

  // ── Action Plans ──────────────────────────────────────────────────────────
  async getActionPlans(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const parsed = actionPlanFilterSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const items = await portalActionsService.list(req.params.id, parsed.data.metricId, parsed.data.status);
    await logAccess(req, `/portal/processes/${req.params.id}/action-plans`);
    res.json({ data: items });
  },

  // ── Governance ────────────────────────────────────────────────────────────
  async getGovernance(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const period = (req.query.period as string) || currentPeriod();
    const data = await portalGovernanceService.getChecklist(req.params.id, period);
    await logAccess(req, `/portal/processes/${req.params.id}/governance`);
    res.json({ data });
  },

  // ── Attrition ─────────────────────────────────────────────────────────────
  async getAttrition(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const period = (req.query.period as string) || currentPeriod();
    const data = await portalAttritionService.getAttrition(req.params.id, period);
    await logAccess(req, `/portal/processes/${req.params.id}/attrition`);
    res.json({ data });
  },

  // ── Commentary ────────────────────────────────────────────────────────────
  async getCommentary(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const period = (req.query.period as string) || currentPeriod();
    const data = await portalCommentaryService.get(req.params.id, period);
    await logAccess(req, `/portal/processes/${req.params.id}/commentary`);
    res.json({ data: data ?? null });
  },

  async acknowledgeCommentary(req: ClientAuthRequest, res: Response) {
    await assertCommentaryAccess(req);
    await portalCommentaryService.acknowledge(req.params.id, req.portalUser!.clientUserId);
    await logAccess(req, `/portal/commentary/${req.params.id}/acknowledge`);
    res.json({ ok: true });
  },

  async replyCommentary(req: ClientAuthRequest, res: Response) {
    await assertCommentaryAccess(req);
    const parsed = replyCommentarySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    await portalCommentaryService.addReply(req.params.id, req.portalUser!.clientUserId, parsed.data.text);
    await logAccess(req, `/portal/commentary/${req.params.id}/reply`);
    res.json({ ok: true });
  },

  // ── Internal: Glide Path management ──────────────────────────────────────
  async setGlideCommitment(req: Request, res: Response) {
    const parsed = setGlideSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    await portalGlideService.setCommitment(parsed.data, (req as any).authUser?.id ?? "system");
    res.json({ ok: true });
  },

  // ── Internal: Action plan management ─────────────────────────────────────
  async createActionPlan(req: Request, res: Response) {
    const parsed = createActionPlanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const item = await portalActionsService.create(parsed.data, (req as any).authUser?.id ?? "system");
    res.status(201).json({ data: item });
  },

  async updateActionPlan(req: Request, res: Response) {
    const parsed = updateActionPlanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    await portalActionsService.update(req.params.id, parsed.data);
    res.json({ ok: true });
  },

  // ── Internal: Governance log ──────────────────────────────────────────────
  async updateGovernance(req: Request, res: Response) {
    const parsed = updateGovernanceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    await portalGovernanceService.updateLog(parsed.data, (req as any).authUser?.id ?? "system");
    res.json({ ok: true });
  },

  // ── Internal: Commentary ──────────────────────────────────────────────────
  async createCommentary(req: Request, res: Response) {
    const parsed = createCommentarySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await portalCommentaryService.create(parsed.data, (req as any).authUser?.id ?? "system");
    res.status(201).json({ data });
  },

  // ── Internal: Client user management ─────────────────────────────────────
  async createClientUser(req: Request, res: Response) {
    const parsed = createClientUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const id = randomUUID();
    await db.execute(
      "INSERT INTO client_user (id, client_id, email, name, designation, process_ids) VALUES (?, ?, ?, ?, ?, ?)",
      [id, parsed.data.clientId, parsed.data.email, parsed.data.name, parsed.data.designation ?? null, JSON.stringify(parsed.data.processIds)]
    );
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM client_user WHERE id = ? LIMIT 1", [id]);
    const created = (rows as RowDataPacket[])[0];
    if (!created) throw new Error("Failed to fetch created client user");
    res.status(201).json({ data: created });
  },

  async listClientUsers(_req: Request, res: Response) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, client_id, email, name, designation, is_active, created_at FROM client_user ORDER BY created_at DESC"
    );
    res.json({ data: rows });
  },
};
