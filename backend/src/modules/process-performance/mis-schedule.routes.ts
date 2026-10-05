import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import {
  createSchedule, getScheduleDetail, listSchedules, parseScheduleInput, resumeSchedule, runScheduleNow, setScheduleStatus,
} from "./mis-schedule.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

// Same viewers as the dashboard Excel export: a scheduled email carries the same raw data.
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

const ID_RE = /^[0-9a-f-]{36}$/i;

router.get("/mis-schedules", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const dashboard = req.query.dashboard ? String(req.query.dashboard).slice(0, 60) : undefined;
  res.json({ success: true, data: await listSchedules(dashboard) });
}));

router.get("/mis-schedules/:id", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!ID_RE.test(id)) { res.status(400).json({ success: false, error: "Invalid schedule id." }); return; }
  const detail = await getScheduleDetail(id);
  if (!detail) { res.status(404).json({ success: false, error: "Schedule not found." }); return; }
  res.json({ success: true, data: detail });
}));

router.post("/mis-schedules", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const parsed = parseScheduleInput(req.body);
  if (!parsed.ok) { res.status(400).json({ success: false, error: parsed.error }); return; }
  let created;
  try {
    created = await createSchedule(parsed.value, req.authUser.id);
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : "Could not create schedule." });
    return;
  }
  await writeAuditLog({
    actor_user_id: req.authUser.id,
    actor_role: req.authUser.role,
    action_type: "MIS_EMAIL_SCHEDULE_CREATE",
    module_key: "process_performance",
    entity_type: "mis_email_schedule",
    entity_id: created.id,
    metadata: {
      dashboard: parsed.value.dashboardKey, frequency: parsed.value.frequency, sendTime: parsed.value.sendTime,
      rangeMode: parsed.value.rangeMode, to: parsed.value.to, cc: parsed.value.cc, nextRunAt: created.nextRunAt,
    },
    req,
  });
  res.status(201).json({ success: true, data: { id: created.id, nextRunAt: created.nextRunAt } });
}));

/** Shared shape for pause / resume / cancel / run-now: validate id, act, audit, reply. */
function actionRoute(
  path: string,
  action: string,
  run: (id: string) => Promise<{ ok: boolean; error?: string; extra?: Record<string, unknown> }>,
) {
  router.post(path, requireRole(...VIEWER_ROLES), h(async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!ID_RE.test(id)) { res.status(400).json({ success: false, error: "Invalid schedule id." }); return; }
    const outcome = await run(id);
    await writeAuditLog({
      actor_user_id: req.authUser.id,
      actor_role: req.authUser.role,
      action_type: action,
      module_key: "process_performance",
      entity_type: "mis_email_schedule",
      entity_id: id,
      metadata: { ok: outcome.ok, error: outcome.error ?? null, ...(outcome.extra ?? {}) },
      req,
    });
    if (!outcome.ok) { res.status(409).json({ success: false, error: outcome.error ?? "Action not allowed." }); return; }
    res.json({ success: true, data: outcome.extra ?? {} });
  }));
}

actionRoute("/mis-schedules/:id/pause", "MIS_EMAIL_SCHEDULE_PAUSE", async (id) => {
  const ok = await setScheduleStatus(id, "paused");
  return ok ? { ok: true } : { ok: false, error: "Only an active schedule can be paused." };
});

actionRoute("/mis-schedules/:id/resume", "MIS_EMAIL_SCHEDULE_RESUME", async (id) => {
  const result = await resumeSchedule(id);
  if (result === "resumed") return { ok: true };
  if (result === "past") return { ok: false, error: "The one-time send date has already passed." };
  return { ok: false, error: result === "not_found" ? "Schedule not found." : "Only a paused schedule can be resumed." };
});

actionRoute("/mis-schedules/:id/cancel", "MIS_EMAIL_SCHEDULE_CANCEL", async (id) => {
  const ok = await setScheduleStatus(id, "cancelled");
  return ok ? { ok: true } : { ok: false, error: "This schedule is already finished or cancelled." };
});

actionRoute("/mis-schedules/:id/run-now", "MIS_EMAIL_SCHEDULE_RUN_NOW", async (id) => {
  const result = await runScheduleNow(id);
  if (!result) return { ok: false, error: "Schedule not found." };
  if (result.status === "failed") return { ok: false, error: result.error ?? "Send failed.", extra: { status: result.status } };
  return { ok: true, extra: { status: result.status } };
});

export { router as misScheduleRouter };
