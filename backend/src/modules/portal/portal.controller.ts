import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { ClientAuthRequest } from "../../middleware/requireClientAuth.js";
import { portalAuthService } from "./portal.auth.service.js";
import { ensureProcessSlug, generateCredentialsFromSlug, disambiguateLoginId, portalUrlFromSlug } from "./portal-credentials.js";
import { portalOverviewService } from "./portal.overview.service.js";
import { portalKpiService } from "./portal.kpi.service.js";
import { portalGlideService } from "./portal.glide.service.js";
import { portalActionsService } from "./portal.actions.service.js";
import { portalAttritionService } from "./portal.attrition.service.js";
import { portalTrainingComplianceService } from "./portal.training-compliance.service.js";
import { portalCommentaryService } from "./portal.commentary.service.js";
import { portalGovernanceService } from "./portal.governance.service.js";
import { getLiveDashboardForPortal } from "./portal.live-dashboard.service.js";
import { getProcessOperationsForPortal, getProcessBusinessHealthForPortal, getMetricDrilldownForPortal } from "../process-operations/process-operations.service.js";
import {
  requestOtpSchema, verifyOtpSchema, actionPlanFilterSchema,
  createActionPlanSchema, updateActionPlanSchema, setGlideSchema,
  createCommentarySchema, replyCommentarySchema,
  createClientUserSchema, passwordLoginSchema, changeClientPasswordSchema,
  resetClientPasswordSchema, updateGovernanceSchema,
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

  /**
   * Forgot-password recovery: set a brand-new password with no current-password check,
   * for a client authenticated by having just completed a real OTP verification rather
   * than by already knowing a password. Requires requireClientAuth same as
   * changePassword above -- the caller must already hold a token from POST
   * /auth/verify-otp -- so this can never be reached without first proving control of the
   * account's email, closing the gap where a client with no admin contact and no memory
   * of their login_id/password had no way back into the password-login system at all.
   */
  async resetPassword(req: ClientAuthRequest, res: Response) {
    const parsed = resetClientPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const { loginId } = await portalAuthService.resetPasswordAfterOtp(req.portalUser!.clientUserId, parsed.data.newPassword);
      // loginId is echoed back so a client who never had one (27 of 28 live accounts, see
      // resetPasswordAfterOtp's own comment) learns their new sign-in ID immediately --
      // otherwise the reset would leave them with a password but no way to discover what
      // ID it pairs with.
      res.json({ ok: true, loginId });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  },

  /**
   * Revokes THIS session's own jti server-side. A token minted before session tracking
   * existed has no jti (see PortalTokenPayload.jti's own comment) -- there is nothing to
   * revoke for one of those, so this is a no-op success rather than an error for them;
   * the frontend still clears its local copy either way, which is the effective sign-out
   * for a jti-less token same as it always was.
   */
  async logout(req: ClientAuthRequest, res: Response) {
    if (req.portalUser!.jti) {
      await portalAuthService.revokeSession(req.portalUser!.jti);
    }
    res.json({ ok: true });
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

  // ── Governance Checklist ───────────────────────────────────────────────────
  // Fully-built, real-data service (governance_activity_master has 418 active seeded
  // activities; governance_checklist_log records actual completion) that had no route,
  // no controller entry, and no frontend tab at all -- found during a follow-up audit
  // pass, same "real backend, zero client exposure" gap glide paths/commentary had
  // before this session's admin UI. Read-only for the client (they see the same
  // completion-vs-required rollup staff already write via updateLog below);
  // completion is recorded by internal ops staff, not the client, matching how Action
  // Plans/Glide Paths/Commentary all separate client-read from staff-write.
  async getGovernance(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const period = (req.query.period as string) || currentPeriod();
    const items = await portalGovernanceService.getChecklist(req.params.id, period);
    await logAccess(req, `/portal/processes/${req.params.id}/governance`);
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
    // "hygiene" (unresolved punches, correction load, roster ack, open attendance issues)
    // used to fall through both this filter and getQuality's below -- it doesn't match
    // any of the 5 other section keys, so it was silently dropped everywhere in the
    // portal even though it carries no financial/PII data and is exactly the kind of
    // real operational signal a client should see. Attached to Operations rather than a
    // 4th tab since it's about running the floor day-to-day, the same category Operations
    // already covers. `ungrouped` (any metric with real readings that process-operations
    // .service.ts couldn't place in one of its 6 named sections) was previously dropped
    // unconditionally too, since this handler only ever read result.sections -- surfaced
    // here as its own section so a real metric never vanishes just for being uncategorized.
    const opsSections = result.sections.filter((s) => s.key === "operations" || s.key === "conversion" || s.key === "hygiene");
    const sections = result.ungrouped.length > 0
      ? [...opsSections, { key: "ungrouped", title: "Other tracked metrics", blurb: null, metrics: result.ungrouped }]
      : opsSections;
    res.json({ data: { ...result, sections } });
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

  // ── Live Dashboard (real-time-ish call/campaign metrics for named clients) ────
  // See portal.live-dashboard.service.ts's own header comment for the full scope
  // decision: aggregate call/campaign metrics only, no per-agent rows, Billing
  // excluded entirely (internal cost/profitability data). null means this process
  // has no named live dashboard (most don't) or maps to the excluded Billing/Dalmia
  // ones -- rendered identically to the client either way, "no live dashboard here".
  async getLiveDashboard(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const { from, to } = req.query as { from?: string; to?: string };
    const result = await getLiveDashboardForPortal(req.params.id, { from, to });
    await logAccess(req, `/portal/processes/${req.params.id}/live-dashboard`);
    res.json({ data: result });
  },

  // ── Metric drill-down (Operations/Quality tiles → formula, source, daily readings) ──
  // Closes a real gap: the internal ProcessOperationsPage.tsx lets staff click any
  // metric tile to see its formula/data-source/daily-reading history
  // (getMetricDrilldown), but the portal's Operations/Quality tabs only ever returned
  // the flat tile (value + sparkline) with no way to see what's behind a number. Reuses
  // the exact same computation via getMetricDrilldownForPortal -- no agent-level
  // attribution or raw source rows included (see that function's own comment for why
  // those two stay internal-only).
  async getMetricDrilldown(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const metricKey = req.params.metricKey;
    if (!metricKey) return res.status(400).json({ error: "metricKey is required" });
    const period = readReportPeriod(req);
    const result = await getMetricDrilldownForPortal(req.params.id, metricKey, 30, period);
    await logAccess(req, `/portal/processes/${req.params.id}/metrics/${metricKey}/drilldown`);
    if (!result) return res.status(404).json({ error: "No data for this metric on this process" });
    res.json({ data: result });
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

  // ── Training Compliance (Quality-Learning Governance) ───────────────────────
  async getTrainingCompliance(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const period = (req.query.period as string) || currentPeriod();
    const data = await portalTrainingComplianceService.getTrainingCompliance(
      req.params.id, period, req.portalUser!.processIds,
    );
    await logAccess(req, `/portal/processes/${req.params.id}/training-compliance`);
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

  // ── Internal: Governance checklist logging ────────────────────────────────
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

    // Wrapped in try/catch -- confirmed missing during a later audit pass: every sibling
    // handler in this file that can hit a real DB constraint (resetPassword, changePassword,
    // loginWithPassword) catches and returns a clean {error} 400/401. This one didn't, so a
    // genuine second-attempt ER_DUP_ENTRY (e.g. the disambiguated login_id ALSO collides, or
    // a duplicate client_user.email) propagated to Express's default error handler as an
    // unhandled rejection -- likely a raw 500 with a driver-internal message, not the
    // structured shape every other portal error follows.
    try {
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
        generatedCredentials: { loginId, temporaryPassword: generated.password, portalUrl: portalUrlFromSlug(slug) },
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  },

  async listClientUsers(_req: Request, res: Response) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, client_id, email, name, designation, is_active, created_at, login_id FROM client_user ORDER BY created_at DESC"
    );
    res.json({ data: rows });
  },

  /**
   * (Re)generate a client_user's login_id/password_hash on demand.
   *
   * Needed for two real, live situations, not a hypothetical:
   *   1. 27 of the 28 active client_user rows predate migration 1814 (the password-login
   *      system) and were seeded directly with email-only OTP access — they have
   *      login_id = NULL and can never reach POST /auth/login, only email OTP or admin
   *      impersonation. There was no way to hand these clients real credentials.
   *   2. A client can legitimately need a password reset (forgot it, suspects it leaked)
   *      without wanting to go through the admin-impersonation flow to change it
   *      themselves via the self-service endpoint.
   *
   * Reuses ensureProcessSlug/generateCredentialsFromSlug/disambiguateLoginId — the exact
   * same convention createClientUser above uses — so a retrofitted account and a
   * freshly-created one are indistinguishable. Sets must_change_password = 1 so the new
   * one-time value is never left as the client's permanent password, same as create.
   */
  async generatePortalLogin(req: Request, res: Response) {
    const { id } = req.params;
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, process_ids FROM client_user WHERE id = ? AND is_active = 1 LIMIT 1",
      [id]
    );
    const user = (rows as RowDataPacket[])[0];
    if (!user) return res.status(404).json({ error: "Active client user not found" });

    let processIds: string[];
    try {
      processIds = typeof user.process_ids === "string" ? JSON.parse(user.process_ids) : (user.process_ids ?? []);
    } catch {
      return res.status(500).json({ error: "Portal user has invalid process_ids data" });
    }
    if (!processIds.length) {
      return res.status(400).json({ error: "This portal user has no assigned process — cannot derive a login ID" });
    }

    // Wrapped in try/catch -- same fix as createClientUser above: ensureProcessSlug throws
    // a raw "process_master row not found for id <uuid>" if processIds[0] is a stale/
    // dangling id (the process was since deleted or the JSON drifted), and a second
    // disambiguation collision on the UPDATE below would otherwise propagate unhandled.
    try {
      const slug = await ensureProcessSlug(processIds[0]);
      const generated = generateCredentialsFromSlug(slug);
      const passwordHash = await bcrypt.hash(generated.password, 10);

      let loginId = generated.loginId;
      let updated = false;
      for (let attempt = 0; attempt < 2 && !updated; attempt++) {
        try {
          await db.execute(
            "UPDATE client_user SET login_id = ?, password_hash = ?, must_change_password = 1 WHERE id = ?",
            [loginId, passwordHash, id]
          );
          updated = true;
        } catch (err) {
          // A different client_user already holds this exact login_id (e.g. it was
          // retrofitted moments earlier by someone else, or two portal users share the same
          // primary process) — retry once with a short disambiguator, same pattern as create.
          if ((err as { code?: string }).code === "ER_DUP_ENTRY" && attempt === 0) {
            loginId = disambiguateLoginId(generated.loginId);
            continue;
          }
          throw err;
        }
      }

      res.json({
        data: { clientUserId: id, loginId },
        generatedCredentials: { loginId, temporaryPassword: generated.password, portalUrl: portalUrlFromSlug(slug) },
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
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
