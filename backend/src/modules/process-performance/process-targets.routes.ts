import type { Router, Response, NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import {
  PROCESSES, getTargetsPage, getTargetDetail, setOverride, deleteOverride, auditEntityId, normName, saveManualAgent, deleteManualAgent, type ProcessKey, type TargetLevel,
} from "./process-targets.service.js";

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

/**
 * Mounts the Process Details endpoints for one process on its router:
 *   GET    <base>            the page (AM/Center, TL and agent targets: roster vs effective)
 *   GET    <base>/detail     one entity with its children and history
 *   PUT    <base>            change a target (audited)
 *   DELETE <base>/:id        reset to the roster target (audited)
 * ACCESS IS BY EXPLICIT PER-USER GRANT ONLY. The page is a page_catalog entry (PP_HOUSING_OWNER_PROCESS_DETAILS /
 * PP_HOUSING_PREMIUM_PROCESS_DETAILS) that an admin assigns to individual users in Access Control (user_page_access): can_view to
 * read, can_edit to change targets or add / remove agents. No role carries these pages, so a role alone gives no access; a super admin
 * is the only bypass. Hiding the card in the UI is a convenience -- this check is the enforcement.
 */
export const PROCESS_DETAILS_PAGE: Record<ProcessKey, string> = {
  housing_owner: "PP_HOUSING_OWNER_PROCESS_DETAILS",
  housing_premium: "PP_HOUSING_PREMIUM_PROCESS_DETAILS",
};

async function hasProcessDetailsAccess(req: AuthenticatedRequest, pageCode: string, perm: "view" | "edit"): Promise<boolean> {
  const userId = req.authUser?.id;
  if (!userId) return false;
  if (req.authUser?.roles?.includes("super_admin") || req.authUser?.role === "super_admin") return true;
  const [ur] = await db.execute<RowDataPacket[]>("SELECT 1 FROM user_roles WHERE user_id = ? AND role_key = 'super_admin' AND active_status = 1 LIMIT 1", [userId]);
  if (ur.length > 0) return true;
  const col = perm === "edit" ? "upa.can_edit" : "upa.can_view";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM user_page_access upa
       LEFT JOIN page_catalog pc ON pc.page_code = upa.page_code
      WHERE upa.user_id = ? AND upa.page_code = ? AND upa.active_status = 1 AND upa.revoked_at IS NULL
        AND (upa.expires_at IS NULL OR upa.expires_at > NOW()) AND COALESCE(pc.active_status, 1) = 1 AND ${col} = 1 LIMIT 1`,
    [userId, pageCode]);
  return rows.length > 0;
}
const needAccess = (pageCode: string, perm: "view" | "edit") => async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (await hasProcessDetailsAccess(req, pageCode, perm)) return next();
    return res.status(403).json({ success: false, error: perm === "edit" ? "You have not been given permission to change these targets." : "You have not been given access to Process Details." });
  } catch (err) { return next(err); }
};

export function mountProcessTargetRoutes(
  router: Router, opts: { base: string; process: ProcessKey; wrap: (fn: Handler) => never },
): void {
  const { base, process } = opts;
  const pageCode = PROCESS_DETAILS_PAGE[process];
  const canView = needAccess(pageCode, "view");
  const canEdit = needAccess(pageCode, "edit");
  const h = opts.wrap as unknown as (fn: Handler) => never;
  const cfg = PROCESSES[process];
  const monthOf = (v: unknown): string => String(v ?? "").trim();
  const levelOk = (l: string): l is TargetLevel => l === "agent" || l === "tl" || l === cfg.topLevel;

  router.get(base, canView, h(async (req, res) => {
    res.json({ success: true, data: await getTargetsPage(process, monthOf(req.query.month)) });
  }));

  router.get(`${base}/detail`, canView, h(async (req, res) => {
    const level = String(req.query.level ?? "");
    if (!levelOk(level)) return res.status(400).json({ success: false, error: `level must be ${["agent", "tl", cfg.topLevel].join(", ")}` });
    const data = await getTargetDetail(process, level, String(req.query.name ?? ""), monthOf(req.query.month));
    return data ? res.json({ success: true, data }) : res.status(404).json({ success: false, error: "Not found on the roster" });
  }));

  router.put(base, canEdit, h(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    let change;
    try {
      change = await setOverride(process, {
        level: String(body.level ?? ""), entityName: String(body.name ?? ""), effectiveMonth: String(body.month ?? ""), monthlyTarget: body.target as number | string,
      }, req.authUser!.id);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ER_NO_SUCH_TABLE") return res.status(409).json({ success: false, error: "The target table db_masmis.process_target_override does not exist yet (sql/dba/1872_process_target_override.sql has to be run by a DBA)." });
      return res.status(400).json({ success: false, error: err instanceof Error ? err.message : "Invalid target" });
    }
    const n = change.newValue;
    await writeAuditLog({
      actor_user_id: req.authUser!.id,
      action_type: `${process.toUpperCase()}_TARGET_${change.oldValue ? "UPDATE" : "CREATE"}`,
      module_key: "process-performance", entity_type: "process_target", entity_id: auditEntityId(process, n.level, n.entityName),
      metadata: { process, level: n.level, name: n.entityName, month: n.effectiveMonth, reason: body.reason ? String(body.reason).slice(0, 500) : null, oldValue: change.oldValue, newValue: n },
      req,
    });
    res.json({ success: true, data: change });
  }));

  // ---- agents added by hand (merged into the roster at read time; the uploaded roster is never touched)
  const manualAudit = (n: { id: number; name: string }) => `${process === "housing_owner" ? "ho" : "hp"}:agent:${n.id}`;
  const agentBody = (b: Record<string, unknown>) => ({
    name: String(b.name ?? ""), empId: b.empId === undefined || b.empId === null ? null : String(b.empId), tl: String(b.tl ?? ""), group: String(b.group ?? ""),
    status: String(b.status ?? ""), doj: b.doj ? String(b.doj) : null, monthlyTarget: b.target as number | string, effectiveFrom: String(b.month ?? ""),
  });
  const manualFail = (res: Response, err: unknown) => {
    if ((err as { code?: string }).code === "ER_NO_SUCH_TABLE") return res.status(409).json({ success: false, error: "db_masmis.process_manual_agent does not exist yet (sql/dba/1873_process_manual_agent.sql has to be run by a DBA)." });
    return res.status(400).json({ success: false, error: err instanceof Error ? err.message : "Invalid agent" });
  };

  router.post(`${base}/agents`, canEdit, h(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    let change;
    try { change = await saveManualAgent(process, agentBody(body), req.authUser!.id); } catch (err) { return manualFail(res, err); }
    await writeAuditLog({
      actor_user_id: req.authUser!.id, action_type: `${process.toUpperCase()}_AGENT_ADD`, module_key: "process-performance", entity_type: "process_manual_agent",
      entity_id: manualAudit(change.newValue), metadata: { process, name: change.newValue.name, oldValue: null, newValue: change.newValue }, req,
    });
    res.status(201).json({ success: true, data: change });
  }));

  router.put(`${base}/agents/:id`, canEdit, h(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: "Invalid id" });
    let change;
    try { change = await saveManualAgent(process, agentBody((req.body ?? {}) as Record<string, unknown>), req.authUser!.id, id); } catch (err) { return manualFail(res, err); }
    await writeAuditLog({
      actor_user_id: req.authUser!.id, action_type: `${process.toUpperCase()}_AGENT_UPDATE`, module_key: "process-performance", entity_type: "process_manual_agent",
      entity_id: manualAudit(change.newValue), metadata: { process, name: change.newValue.name, oldValue: change.oldValue, newValue: change.newValue }, req,
    });
    res.json({ success: true, data: change });
  }));

  router.delete(`${base}/agents/:id`, canEdit, h(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: "Invalid id" });
    const removed = await deleteManualAgent(process, id);
    if (!removed) return res.status(404).json({ success: false, error: "Agent not found" });
    await writeAuditLog({
      actor_user_id: req.authUser!.id, action_type: `${process.toUpperCase()}_AGENT_REMOVE`, module_key: "process-performance", entity_type: "process_manual_agent",
      entity_id: manualAudit(removed), metadata: { process, name: removed.name, oldValue: removed, newValue: null }, req,
    });
    res.json({ success: true, data: removed });
  }));

  router.delete(`${base}/:id`, canEdit, h(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: "Invalid id" });
    const removed = await deleteOverride(process, id);
    if (!removed) return res.status(404).json({ success: false, error: "Override not found" });
    await writeAuditLog({
      actor_user_id: req.authUser!.id, action_type: `${process.toUpperCase()}_TARGET_DELETE`, module_key: "process-performance",
      entity_type: "process_target", entity_id: auditEntityId(process, removed.level, removed.entityName),
      metadata: { process, level: removed.level, name: normName(removed.entityName), month: removed.effectiveMonth, reason: "reset to roster target", oldValue: removed, newValue: null }, req,
    });
    res.json({ success: true, data: removed });
  }));
}
