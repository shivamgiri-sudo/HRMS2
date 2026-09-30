/**
 * /api/process-dashboard/:processId/alerts -- rules, events, digests, backtest, test sends.
 * Reads + acknowledge: dashboard viewer roles, scoped by isProcessReadable (re-derived per request).
 * Everything that changes or previews a rule / digest, and every send: ADMIN_ROLES + isProcessWritable, and rate limited per user.
 */
import { Router, type NextFunction, type Response } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, type AuthenticatedRequest } from "../../../middleware/authMiddleware.js";
import { requireRole } from "../../../middleware/requireRole.js";
import { logger } from "../../../logger.js";
import { ADMIN_ROLES, VIEWER_ROLES, isProcessReadable, isProcessWritable } from "../pd.config.service.js";
import { loadConfigOrThrow } from "../pd.dataset.js";
import { PdError } from "../pd.source.js";
import { metricChoices } from "./alerts.data.js";
import { assertNamedRecipientsInScope, resolvePeople, searchRecipientCandidates } from "./alerts.recipients.js";
import * as repo from "./alerts.repo.js";
import { backtestRule, sendDigest, sendTestDigest, sendTestForRule } from "./alerts.service.js";
import { parseDigestInput, parseRecipients, parseRuleInput } from "./alerts.types.js";

const router = Router({ mergeParams: true });
type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const OUT_OF_SCOPE = { success: false, code: "OUT_OF_SCOPE", message: "That process is outside your scope." };
const h = (fn: Handler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch((err: unknown) => {
    if (err instanceof PdError) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    logger.error({ err, path: req.path }, "[process-dashboard/alerts] request failed");
    next(err);
  });
};
const byUser = { keyGenerator: (req: unknown) => (req as AuthenticatedRequest).authUser?.id ?? "anon", standardHeaders: true, legacyHeaders: false, validate: false as const };
const writeLimiter = rateLimit({ ...byUser, windowMs: 60_000, max: 40, message: { success: false, code: "RATE_LIMITED", message: "Too many changes, please slow down." } });
const heavyLimiter = rateLimit({ ...byUser, windowMs: 60_000, max: 10, message: { success: false, code: "RATE_LIMITED", message: "Too many previews or test sends, please wait a minute." } });

const viewer = requireRole(...VIEWER_ROLES);
const admin = requireRole(...ADMIN_ROLES);
const pid = (req: AuthenticatedRequest): string => { const { processId } = req.params; if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id"); return processId; };
const readable = async (req: AuthenticatedRequest, res: Response): Promise<string | null> => { const id = pid(req); if (!(await isProcessReadable(req.authUser.id, id))) { res.status(403).json(OUT_OF_SCOPE); return null; } return id; };
const writable = async (req: AuthenticatedRequest, res: Response): Promise<string | null> => { const id = pid(req); if (!(await isProcessWritable(req.authUser.id, id))) { res.status(403).json(OUT_OF_SCOPE); return null; } return id; };
const ruleId = (req: AuthenticatedRequest): string => { const { ruleId: r } = req.params; if (!UUID_RE.test(r)) throw new PdError(400, "BAD_RULE", "Invalid rule id"); return r; };
const int = (v: unknown, d: number): number => { const n = Number.parseInt(String(v ?? ""), 10); return Number.isFinite(n) ? n : d; };

router.use(requireAuth);

/** Metric picker source: the process's category profile KPIs/columns (with units + targets) plus the anomaly types. */
router.get("/metrics", viewer, h(async (req, res) => {
  const id = await readable(req, res); if (!id) return;
  const l = await loadConfigOrThrow(id, { requireEnabled: false });
  res.json({ success: true, data: await metricChoices(l) });
}));
router.get("/summary", viewer, h(async (req, res) => {
  const id = await readable(req, res); if (!id) return;
  res.json({ success: true, data: { open: await repo.openCount(id), canManage: await isProcessWritable(req.authUser.id, id).catch(() => false) } });
}));

/* ---- rules ---- */
router.get("/rules", viewer, h(async (req, res) => {
  const id = await readable(req, res); if (!id) return;
  res.json({ success: true, data: await repo.listRules(id) });
}));
const metricMap = async (id: string) => new Map((await metricChoices(await loadConfigOrThrow(id, { requireEnabled: false }))).map((m) => [m.key, m]));
router.post("/rules", admin, writeLimiter, h(async (req, res) => {
  const id = await writable(req, res); if (!id) return;
  const draft = parseRuleInput((req.body ?? {}) as Record<string, unknown>, await metricMap(id));
  await assertNamedRecipientsInScope(id, draft.recipients);
  res.status(201).json({ success: true, data: await repo.insertRule(id, req.authUser.id, draft) });
}));
router.put("/rules/:ruleId", admin, writeLimiter, h(async (req, res) => {
  const id = await writable(req, res); if (!id) return;
  const draft = parseRuleInput((req.body ?? {}) as Record<string, unknown>, await metricMap(id));
  await assertNamedRecipientsInScope(id, draft.recipients);
  const row = await repo.updateRule(id, ruleId(req), draft);
  if (!row) return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Rule not found" });
  res.json({ success: true, data: row });
}));
router.delete("/rules/:ruleId", admin, writeLimiter, h(async (req, res) => {
  const id = await writable(req, res); if (!id) return;
  if (!(await repo.deleteRule(id, ruleId(req)))) return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Rule not found" });
  res.json({ success: true, data: { deleted: true } });
}));
/** Live preview for the builder: how often this (unsaved) rule would have fired in the last 14 data days. Writes nothing. */
router.post("/backtest", admin, heavyLimiter, h(async (req, res) => {
  const id = await writable(req, res); if (!id) return;
  const draft = parseRuleInput((req.body ?? {}) as Record<string, unknown>, await metricMap(id), { requireRecipients: false });
  res.json({ success: true, data: await backtestRule(id, { ...draft, name: draft.name || "Preview" }) });
}));
router.post("/rules/:ruleId/test", admin, heavyLimiter, h(async (req, res) => {
  const id = await writable(req, res); if (!id) return;
  const rule = await repo.getRule(id, ruleId(req));
  if (!rule) return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Rule not found" });
  res.json({ success: true, data: { sentTo: "you", ...(await sendTestForRule(id, rule, req.authUser.id)) } });
}));

/* ---- events ---- */
router.get("/events", viewer, h(async (req, res) => {
  const id = await readable(req, res); if (!id) return;
  const st = String(req.query.status ?? "all");
  res.json({ success: true, data: await repo.listEvents(id, { status: st === "open" || st === "acknowledged" ? st : "all", limit: int(req.query.limit, 50), offset: int(req.query.offset, 0) }) });
}));
router.post("/events/:eventId/ack", viewer, writeLimiter, h(async (req, res) => {
  const id = await readable(req, res); if (!id) return;
  const { eventId } = req.params; if (!UUID_RE.test(eventId)) throw new PdError(400, "BAD_EVENT", "Invalid event id");
  if (!(await repo.acknowledgeEvent(id, eventId, req.authUser.id))) return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Alert not found" });
  res.json({ success: true, data: await repo.getEvent(id, eventId) });
}));

/* ---- digests ---- */
router.get("/digests", viewer, h(async (req, res) => {
  const id = await readable(req, res); if (!id) return;
  res.json({ success: true, data: await repo.listDigests(id) });
}));
router.put("/digests", admin, writeLimiter, h(async (req, res) => {
  const id = await writable(req, res); if (!id) return;
  const d = parseDigestInput((req.body ?? {}) as Record<string, unknown>);
  await assertNamedRecipientsInScope(id, d.recipients);
  res.json({ success: true, data: await repo.upsertDigest(id, req.authUser.id, d) });
}));
/** Sends the digest (as configured, or a preview) to the requesting user only and returns the rendered HTML so the UI can show exactly what goes out. */
router.post("/digests/test", admin, heavyLimiter, h(async (req, res) => {
  const id = await writable(req, res); if (!id) return;
  const f = String((req.body as { frequency?: unknown } | undefined)?.frequency ?? "daily");
  const r = await sendTestDigest(id, f === "weekly" ? "weekly" : "daily", req.authUser.id);
  res.json({ success: true, data: { ...r.summary, html: r.html, subject: r.subject } });
}));
router.post("/digests/send-now", admin, heavyLimiter, h(async (req, res) => {
  const id = await writable(req, res); if (!id) return;
  const f = String((req.body as { frequency?: unknown } | undefined)?.frequency ?? "daily");
  const d = (await repo.listDigests(id)).find((x) => x.frequency === (f === "weekly" ? "weekly" : "daily"));
  if (!d) return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Save the digest first" });
  const r = await sendDigest(d);
  if (r.sent) await repo.markDigestSent(d.id);
  res.json({ success: true, data: { sent: r.sent, ...r.summary } });
}));

/* ---- recipient picker / preview ---- */
router.get("/recipients/search", admin, h(async (req, res) => {
  const id = await writable(req, res); if (!id) return;
  const q = String(req.query.q ?? "").trim();
  res.json({ success: true, data: q.length < 2 ? [] : await searchRecipientCandidates(id, q) });
}));
router.post("/recipients/preview", admin, h(async (req, res) => {
  const id = await writable(req, res); if (!id) return;
  const { people, dropped } = await resolvePeople(id, parseRecipients((req.body as { recipients?: unknown } | undefined)?.recipients));
  res.json({ success: true, data: { count: people.length, dropped, withEmail: people.filter((p) => p.email).length, names: people.slice(0, 10).map((p) => p.name) } });
}));

export { router as alertsRouter };
