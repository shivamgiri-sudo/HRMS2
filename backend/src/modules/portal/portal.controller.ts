import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { ClientAuthRequest } from "../../middleware/requireClientAuth.js";
import { portalAuthService } from "./portal.auth.service.js";
import { ensureProcessSlug, generateCredentialsFromSlug, disambiguateLoginId } from "./portal-credentials.js";
import { portalOverviewService } from "./portal.overview.service.js";
import { portalKpiService } from "./portal.kpi.service.js";
import { portalGlideService } from "./portal.glide.service.js";
import { portalActionsService } from "./portal.actions.service.js";
import { portalAttritionService } from "./portal.attrition.service.js";
import { portalCommentaryService } from "./portal.commentary.service.js";
import { getProcessOperationsForPortal, getProcessBusinessHealthForPortal } from "../process-operations/process-operations.service.js";
import {
  requestOtpSchema, verifyOtpSchema, actionPlanFilterSchema,
  createActionPlanSchema, updateActionPlanSchema, setGlideSchema,
  createCommentarySchema, replyCommentarySchema,
  createClientUserSchema, passwordLoginSchema, changeClientPasswordSchema,
} from "./portal.validation.js";

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

// process-operations.service.ts's ReportPeriod ("trend"|"today"|"wtd"|"mtd"), deliberately
// NOT the "YYYY-MM" month string the KPI/Attrition/Commentary tabs use above -- this data is
// a 30-day rolling window by nature (daily process_metric_actual rows), not something that
// maps onto a calendar month picker. Defaults to "trend" (rolling window).
const VALID_REPORT_PERIODS = new Set(["trend", "today", "wtd", "mtd"]);
function readReportPeriod(req: ClientAuthRequest): "trend" | "today" | "wtd" | "mtd" {
  const raw = String(req.query.period ?? "trend");
  return (VALID_REPORT_PERIODS.has(raw) ? raw : "trend") as "trend" | "today" | "wtd" | "mtd";
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
    try {
      await portalAuthService.requestOtp(parsed.data.email);
    } catch (err) {
      if ((err as { code?: string }).code === "DELIVERY_FAILED") {
        return res.status(503).json({ error: "Unable to send OTP. Please try again or contact support." });
      }
      throw err;
    }
    res.json({ ok: true });
  },

  async verifyOtp(req: Request, res: Response) {
    const parsed = verifyOtpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const token = await portalAuthService.verifyOtp(parsed.data.email, parsed.data.otp);
    res.json({ token });
  },

  async loginWithPassword(req: Request, res: Response) {
    const parsed = passwordLoginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const { token, mustChangePassword } = await portalAuthService.loginWithPassword(
        parsed.data.loginId,
        parsed.data.password
      );
      res.json({ token, mustChangePassword });
    } catch (err) {
      res.status(401).json({ error: (err as Error).message });
    }
  },

  async changePassword(req: ClientAuthRequest, res: Response) {
    const parsed = changeClientPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      await portalAuthService.changePassword(
        req.portalUser!.clientUserId,
        parsed.data.currentPassword,
        parsed.data.newPassword
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  },

  /** Public: resolves a URL slug (from /:slug_clientportal) to the process/client name
   *  the login page should display -- no auth required, this is purely cosmetic branding
   *  for the login screen, never a data-access grant. */
  async getProcessBySlug(req: Request, res: Response) {
    const slug = String(req.params.slug ?? "").trim();
    if (!slug) return res.status(400).json({ error: "slug is required" });
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT p.id AS process_id, p.process_name, cm.client_name
       FROM process_master p
       JOIN client_master cm ON cm.id = p.client_id
       WHERE p.slug = ? AND p.active_status = 1 LIMIT 1`,
      [slug]
    );
    const row = (rows as RowDataPacket[])[0];
    if (!row) return res.status(404).json({ error: "Unknown portal URL" });
    res.json({ data: row });
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
    // Pass the token's processIds through. portalKpiService re-checks them, but only when
    // it is given them — the parameter is optional and its guard is skipped when it is
    // absent, so omitting it here left the service-level check inert. assertProcessAccess
    // above is still the primary boundary; this makes the second one real rather than
    // decorative, which matters the day a new handler forgets the first.
    const scorecards = await portalKpiService.getScorecards(
      req.params.id, period, req.portalUser!.processIds,
    );
    await logAccess(req, `/portal/processes/${req.params.id}/kpis`);
    res.json({ data: scorecards });
  },

  // ── Glide Paths ───────────────────────────────────────────────────────────
  async getGlidePaths(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const period = (req.query.period as string) || currentPeriod();
    const result = await portalGlideService.getGlidePaths(req.params.id, period);
    await logAccess(req, `/portal/processes/${req.params.id}/glide-paths`);
    res.json({ data: result });
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

  // ── Operations & Quality ──────────────────────────────────────────────────
  // Real data, not a portal-only invention: reuses process-operations.service.ts's
  // process_metric_actual read (the same "operations"/"quality"/"hygiene" section
  // catalog that backs the internal-staff ProcessOperationsPage.tsx), scoped by the
  // portal's own process_ids boundary instead of the internal readableProcessIds(userId)
  // check. Section split lets the client dashboard show operations tiles (AHT, SL%,
  // shrinkage) and quality tiles (QA_QUALITY_PCT, fatal call rate, etc.) as two
  // separate, clearly-labelled tabs from the exact same underlying read.
  async getOperations(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const result = await getProcessOperationsForPortal(req.params.id, 30, readReportPeriod(req));
    await logAccess(req, `/portal/processes/${req.params.id}/operations`);
    if (!result) return res.json({ data: null });
    const opsSections = result.sections.filter((s) => s.key === "operations" || s.key === "conversion");
    res.json({ data: { ...result, sections: opsSections } });
  },

  async getQuality(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const result = await getProcessOperationsForPortal(req.params.id, 30, readReportPeriod(req));
    await logAccess(req, `/portal/processes/${req.params.id}/quality`);
    if (!result) return res.json({ data: null });
    const qualitySections = result.sections.filter((s) => s.key === "quality" || s.key === "risk" || s.key === "conduct");
    res.json({ data: { ...result, sections: qualitySections } });
  },

  // ── Workforce (headcount vs. mandate + hiring pipeline) ──────────────────
  // Deliberately excludes getProcessBusinessHealthForPortal's `finance` field
  // (revenue, GRN, agent salary, EBIT, operating profit %) -- internal cost and
  // profitability data this portal's own policy (see the Client Portal master
  // prompt's commercial-section rules) explicitly bars from anything client-facing.
  // Headcount-vs-mandate and the hiring pipeline carry no cost or PII, so those
  // two are safe to surface as-is.
  async getWorkforce(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const result = await getProcessBusinessHealthForPortal(req.params.id);
    await logAccess(req, `/portal/processes/${req.params.id}/workforce`);
    if (!result) return res.json({ data: null });
    res.json({
      data: {
        periodCode: result.periodCode,
        headcount: result.headcount,
        hiring: result.hiring,
        // finance intentionally omitted -- internal cost/profitability data.
      },
    });
  },

  // ── Attrition ─────────────────────────────────────────────────────────────
  async getAttrition(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const period = (req.query.period as string) || currentPeriod();
    const data = await portalAttritionService.getAttrition(
      req.params.id, period, req.portalUser!.processIds,
    );
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

    // Login ID / password are derived from the user's first assigned process's slug
    // (ensureProcessSlug persists one on process_master if it doesn't have one yet).
    // Collisions on client_user.login_id (a real UNIQUE KEY, migration 1814) are retried
    // once with a short disambiguator rather than failing outright -- two different
    // portal users legitimately scoped to the same process should not be blocked from
    // both existing.
    const primaryProcessId = parsed.data.processIds[0];
    const slug = await ensureProcessSlug(primaryProcessId);
    const generated = generateCredentialsFromSlug(slug);
    const passwordHash = await bcrypt.hash(generated.password, 10);

    let loginId = generated.loginId;
    let inserted = false;
    for (let attempt = 0; attempt < 2 && !inserted; attempt++) {
      try {
        await db.execute(
          `INSERT INTO client_user
             (id, client_id, email, name, designation, process_ids, login_id, password_hash, must_change_password)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [id, parsed.data.clientId, parsed.data.email, parsed.data.name, parsed.data.designation ?? null,
           JSON.stringify(parsed.data.processIds), loginId, passwordHash]
        );
        inserted = true;
      } catch (err) {
        if ((err as { code?: string }).code === "ER_DUP_ENTRY" && attempt === 0) {
          loginId = disambiguateLoginId(generated.loginId);
          continue;
        }
        throw err;
      }
    }

    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM client_user WHERE id = ? LIMIT 1", [id]);
    const created = (rows as RowDataPacket[])[0];
    if (!created) throw new Error("Failed to fetch created client user");
    // The one-time plaintext password is returned ONLY on this create response -- it is
    // never stored or retrievable again, same convention as
    // employee-activation.service.ts's temp-password flow. The admin must share it with
    // the client out-of-band right now, or reset it later via a new endpoint.
    res.status(201).json({
      data: created,
      generatedCredentials: { loginId, temporaryPassword: generated.password },
    });
  },

  async listClientUsers(_req: Request, res: Response) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, client_id, email, name, designation, is_active, created_at FROM client_user ORDER BY created_at DESC"
    );
    res.json({ data: rows });
  },

  // ── Process Info (name + client + RAG) ────────────────────────────────────
  async getProcessInfo(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const processes = await portalOverviewService.getOverview([req.params.id]);
    const proc = processes[0];
    if (!proc) return res.json({ data: { process_name: null, client_name: null, rag: null } });
    res.json({ data: { process_name: proc.process_name, client_name: proc.client_name, rag: proc.rag } });
  },
};
