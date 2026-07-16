import { createHash, randomBytes, randomUUID } from "crypto";
import type { Request } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { writeAuditLog, writeSensitiveActionLog } from "../../shared/auditLog.js";
import { getUserRoleKeys } from "../../shared/roleResolver.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import * as repository from "./visitor.repository.js";
import { canTransitionVisit, type ActorScope, type CreateVisitInput, type VisitListFilters, type VisitStatus } from "./visitor.types.js";

const UNRESTRICTED_ROLES = new Set(["super_admin", "admin", "ho_hr", "hr_admin", "security_head"]);
const BRANCH_SECURITY_ROLES = new Set(["visitor_security", "visitor_reception", "branch_head", "branch_hr", "hr_branch"]);

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function visitNumber(): string {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `VIS-${ymd}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function publicStatus(row: any) {
  return {
    visit_number: row.visit_number,
    visitor_name: row.visitor_name,
    company_name: row.company_name,
    branch_name: row.branch_name,
    host_display_name: row.host_display_name,
    visit_type: row.visit_type,
    purpose: row.purpose,
    status: row.status,
    scheduled_start: row.scheduled_start,
    scheduled_end: row.scheduled_end,
    checked_in_at: row.checked_in_at,
    checked_out_at: row.checked_out_at,
    checkout_requested_at: row.checkout_requested_at,
  };
}

async function actorScope(userId: string): Promise<ActorScope> {
  const [roles, employee] = await Promise.all([
    getUserRoleKeys(userId),
    repository.getActorEmployee(userId),
  ]);
  return {
    userId,
    employeeId: employee?.id ?? null,
    branchId: employee?.branch_id ?? null,
    roles,
    unrestricted: roles.some((role) => UNRESTRICTED_ROLES.has(role)),
  };
}

function mayAccessVisit(scope: ActorScope, visit: any): boolean {
  if (scope.unrestricted) return true;
  if (scope.employeeId && visit.host_employee_id === scope.employeeId) return true;
  return Boolean(scope.branchId && scope.branchId === visit.branch_id && scope.roles.some((role) => BRANCH_SECURITY_ROLES.has(role)));
}

async function createVisit(input: CreateVisitInput, req: Request, consent?: { consent_type: string; consent_version: string; accepted: boolean }) {
  const branch = await repository.getActiveBranch(input.branch_id);
  if (!branch) throw Object.assign(new Error("Active branch not found"), { statusCode: 400 });

  const host = await repository.resolveActiveHost({
    employeeId: input.host_employee_id,
    employeeCode: input.host_employee_code,
    branchId: input.branch_id,
  });
  if ((input.host_employee_id || input.host_employee_code) && !host) {
    throw Object.assign(new Error("Active host was not found in the selected branch"), { statusCode: 400 });
  }

  const trackingToken = randomBytes(32).toString("hex");
  const visitId = randomUUID();
  const number = visitNumber();
  await repository.createVisitAtomic({
    ...input,
    visitId,
    visitNumber: number,
    trackingTokenHash: tokenHash(trackingToken),
    hostEmployeeId: host?.id ?? null,
    hostDisplayName: host?.full_name ?? null,
    consent: consent ? {
      consentType: consent.consent_type,
      consentVersion: consent.consent_version,
      accepted: consent.accepted,
      ipAddress: req.ip,
      userAgent: String(req.headers["user-agent"] ?? ""),
    } : undefined,
  });
  await writeAuditLog({
    actor_user_id: input.created_by_user_id ?? `public:${tokenHash(trackingToken).slice(0, 16)}`,
    action_type: "VISITOR_VISIT_CREATED",
    module_key: "VISITOR_MANAGEMENT",
    entity_type: "visitor_visit",
    entity_id: visitId,
    metadata: { visit_number: number, branch_id: input.branch_id, source_channel: input.source_channel },
    req,
  });
  return { id: visitId, visit_number: number, tracking_token: trackingToken, status: "pending_approval" as const };
}

export const visitorService = {
  listPublicBranches: repository.listPublicBranches,

  async registerPublic(input: Omit<CreateVisitInput, "source_channel"> & { consent: { consent_type: string; consent_version: string; accepted: boolean } }, req: Request) {
    return createVisit({ ...input, source_channel: "visitor_self" }, req, input.consent);
  },

  async getPublicStatus(trackingToken: string) {
    const row = await repository.getVisitByTrackingHash(tokenHash(trackingToken));
    if (!row) throw Object.assign(new Error("Visit not found"), { statusCode: 404 });
    return publicStatus(row);
  },

  async recordPublicConsent(input: { tracking_token: string; consent_type: string; consent_version: string; accepted: boolean }, req: Request) {
    const row = await repository.getVisitByTrackingHash(tokenHash(input.tracking_token));
    if (!row) throw Object.assign(new Error("Visit not found"), { statusCode: 404 });
    await repository.recordConsent({
      visitorId: row.visitor_id,
      visitId: row.id,
      consentType: input.consent_type,
      consentVersion: input.consent_version,
      accepted: input.accepted,
      ipAddress: req.ip,
      userAgent: String(req.headers["user-agent"] ?? ""),
    });
    return { recorded: true };
  },

  async requestPublicCheckout(trackingToken: string, req: Request) {
    const hash = tokenHash(trackingToken);
    const row = await repository.getVisitByTrackingHash(hash);
    if (!row) throw Object.assign(new Error("Visit not found"), { statusCode: 404 });
    if (row.status !== "checked_in") throw Object.assign(new Error("Checkout can only be requested for a checked-in visitor"), { statusCode: 409 });
    await db.executeRun(
      `UPDATE visitor_visit SET checkout_requested_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'checked_in'`,
      [row.id],
    );
    await db.executeRun(
      `INSERT INTO visitor_check_event (id, visit_id, event_type, metadata_json)
       VALUES (?, ?, 'checkout_requested', ?)`,
      [randomUUID(), row.id, JSON.stringify({ source: "visitor_self" })],
    );
    await writeAuditLog({
      actor_user_id: `public:${hash.slice(0, 16)}`,
      action_type: "VISITOR_CHECKOUT_REQUESTED",
      module_key: "VISITOR_MANAGEMENT",
      entity_type: "visitor_visit",
      entity_id: row.id,
      req,
    });
    return { requested: true };
  },

  async getScope(userId: string) {
    return actorScope(userId);
  },

  async listHosts(userId: string, query: string, branchId?: string) {
    return repository.listHosts(await actorScope(userId), query, branchId);
  },

  async listVisits(userId: string, filters: VisitListFilters) {
    return repository.listVisits(await actorScope(userId), filters);
  },

  async getVisit(userId: string, visitId: string) {
    const [scope, visit] = await Promise.all([actorScope(userId), repository.getVisitDetail(visitId)]);
    if (!visit) throw Object.assign(new Error("Visit not found"), { statusCode: 404 });
    if (!mayAccessVisit(scope, visit)) throw Object.assign(new Error("Visit access denied"), { statusCode: 403 });
    return visit;
  },

  async createInvitation(userId: string, input: Omit<CreateVisitInput, "source_channel" | "created_by_user_id">, req: Request) {
    const scope = await actorScope(userId);
    const hostEmployeeId = input.host_employee_id ?? scope.employeeId ?? undefined;
    if (!hostEmployeeId) throw Object.assign(new Error("An active employee host is required"), { statusCode: 400 });
    if (!scope.unrestricted && scope.branchId !== input.branch_id) {
      throw Object.assign(new Error("You can only invite visitors to your assigned branch"), { statusCode: 403 });
    }
    if (!scope.unrestricted && hostEmployeeId !== scope.employeeId) {
      throw Object.assign(new Error("You can only create an employee invitation for yourself"), { statusCode: 403 });
    }
    return createVisit({
      ...input,
      host_employee_id: hostEmployeeId,
      source_channel: "employee_invitation",
      created_by_user_id: userId,
    }, req);
  },

  async createDeskVisit(userId: string, input: Omit<CreateVisitInput, "source_channel" | "created_by_user_id"> & { host_employee_id: string }, req: Request) {
    const scope = await actorScope(userId);
    if (!scope.unrestricted && scope.branchId !== input.branch_id) {
      throw Object.assign(new Error("You can only register visitors at your assigned branch"), { statusCode: 403 });
    }
    return createVisit({
      ...input,
      source_channel: "guard_desk",
      created_by_user_id: userId,
    }, req);
  },

  async decide(userId: string, visitId: string, decision: "approved" | "rejected", reason: string | undefined, req: AuthenticatedRequest) {
    const scope = await actorScope(userId);
    const conn = await db.getConnection();
    let previousStatus: VisitStatus | undefined;
    try {
      await conn.beginTransaction();
      const [visits] = await conn.execute<RowDataPacket[]>(
        `SELECT id, branch_id, host_employee_id, status
           FROM visitor_visit
          WHERE id = ?
          LIMIT 1
          FOR UPDATE`,
        [visitId],
      );
      const visit = visits[0];
      if (!visit) throw Object.assign(new Error("Visit not found"), { statusCode: 404 });

      const globalOverride = scope.roles.some((role) => ["super_admin", "admin", "security_head"].includes(role));
      const branchOverride = scope.roles.includes("branch_head") && scope.branchId === visit.branch_id;
      const assignedHost = Boolean(scope.employeeId && visit.host_employee_id === scope.employeeId);
      if (!globalOverride && !branchOverride && !assignedHost) {
        throw Object.assign(new Error("Only the assigned host or an authorized approver may decide this visit"), { statusCode: 403 });
      }
      if (!canTransitionVisit(visit.status as VisitStatus, decision)) {
        throw Object.assign(new Error(`Visit cannot move from ${visit.status} to ${decision}`), { statusCode: 409 });
      }
      previousStatus = visit.status as VisitStatus;

      const [result] = await conn.execute<ResultSetHeader>(
        `UPDATE visitor_visit
            SET status = ?, approved_at = IF(? = 'approved', CURRENT_TIMESTAMP, approved_at),
                rejection_reason = IF(? = 'rejected', ?, rejection_reason)
          WHERE id = ? AND status = 'pending_approval'`,
        [decision, decision, decision, reason ?? null, visitId],
      );
      if (result.affectedRows !== 1) {
        throw Object.assign(new Error("Visit was already decided by another user"), { statusCode: 409 });
      }
      await conn.execute<ResultSetHeader>(
        `UPDATE visitor_approval
            SET status = ?, approver_user_id = ?, decision_reason = ?, decided_at = CURRENT_TIMESTAMP
          WHERE visit_id = ? AND status = 'pending'`,
        [decision, userId, reason ?? null, visitId],
      );
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    await writeSensitiveActionLog({
      actor_user_id: userId,
      actor_role: scope.roles[0],
      action_type: decision === "approved" ? "VISITOR_VISIT_APPROVED" : "VISITOR_VISIT_REJECTED",
      module_key: "VISITOR_MANAGEMENT",
      entity_type: "visitor_visit",
      entity_id: visitId,
      reason,
      old_value_json: { status: previousStatus },
      new_value_json: { status: decision },
      req,
    });
    return { id: visitId, status: decision };
  },

  async checkEvent(userId: string, visitId: string, event: "checked_in" | "checked_out", input: { gate_code: string; badge_number?: string; notes?: string }, req: AuthenticatedRequest) {
    const scope = await actorScope(userId);
    const conn = await db.getConnection();
    let previousStatus: VisitStatus | undefined;
    try {
      await conn.beginTransaction();
      const [visits] = await conn.execute<RowDataPacket[]>(
        `SELECT id, branch_id, host_employee_id, status
           FROM visitor_visit
          WHERE id = ?
          LIMIT 1
          FOR UPDATE`,
        [visitId],
      );
      const visit = visits[0];
      if (!visit) throw Object.assign(new Error("Visit not found"), { statusCode: 404 });
      if (!scope.unrestricted && scope.branchId !== visit.branch_id) {
        throw Object.assign(new Error("You can only process visitors at your assigned branch"), { statusCode: 403 });
      }
      if (!canTransitionVisit(visit.status as VisitStatus, event)) {
        throw Object.assign(new Error(`Visit cannot move from ${visit.status} to ${event}`), { statusCode: 409 });
      }
      previousStatus = visit.status as VisitStatus;

      let badgeId: string | null = null;
      if (event === "checked_in" && input.badge_number) {
        const [badges] = await conn.execute<RowDataPacket[]>(
          `SELECT id, status
             FROM visitor_badge
            WHERE badge_number = ? AND branch_id = ?
            LIMIT 1
            FOR UPDATE`,
          [input.badge_number, visit.branch_id],
        );
        if (badges[0] && badges[0].status !== "available") {
          throw Object.assign(new Error("Badge is not available"), { statusCode: 409 });
        }
        badgeId = badges[0]?.id ?? randomUUID();
        await conn.execute<ResultSetHeader>(
          `INSERT INTO visitor_badge (id, badge_number, branch_id, status, current_visit_id, issued_at)
           VALUES (?, ?, ?, 'issued', ?, CURRENT_TIMESTAMP)
           ON DUPLICATE KEY UPDATE status = 'issued', current_visit_id = VALUES(current_visit_id),
                                   issued_at = CURRENT_TIMESTAMP, returned_at = NULL`,
          [badgeId, input.badge_number, visit.branch_id, visitId],
        );
      }

      const timeColumn = event === "checked_in" ? "checked_in_at" : "checked_out_at";
      const expected = event === "checked_in" ? "approved" : "checked_in";
      const [result] = await conn.execute<ResultSetHeader>(
        `UPDATE visitor_visit SET status = ?, ${timeColumn} = CURRENT_TIMESTAMP
          WHERE id = ? AND status = ?`,
        [event, visitId, expected],
      );
      if (result.affectedRows !== 1) {
        throw Object.assign(new Error("Visit status changed; refresh before trying again"), { statusCode: 409 });
      }

      if (event === "checked_out") {
        await conn.execute<ResultSetHeader>(
          `UPDATE visitor_badge SET status = 'available', current_visit_id = NULL, returned_at = CURRENT_TIMESTAMP
            WHERE current_visit_id = ?`,
          [visitId],
        );
        await conn.execute<ResultSetHeader>(
          `UPDATE visitor_belonging SET verified_out = 1 WHERE visit_id = ?`,
          [visitId],
        );
      }
      await conn.execute<ResultSetHeader>(
        `INSERT INTO visitor_check_event
           (id, visit_id, event_type, gate_code, badge_id, actor_user_id, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), visitId, event, input.gate_code, badgeId, userId, JSON.stringify({ notes: input.notes ?? null })],
      );
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    await writeSensitiveActionLog({
      actor_user_id: userId,
      actor_role: scope.roles[0],
      action_type: event === "checked_in" ? "VISITOR_CHECKED_IN" : "VISITOR_CHECKED_OUT",
      module_key: "VISITOR_MANAGEMENT",
      entity_type: "visitor_visit",
      entity_id: visitId,
      reason: input.notes,
      old_value_json: { status: previousStatus },
      new_value_json: { status: event, gate_code: input.gate_code },
      req,
    });
    return { id: visitId, status: event };
  },

  async extendVisit(userId: string, visitId: string, scheduledEnd: string, reason: string, req: AuthenticatedRequest) {
    const [scope, visit] = await Promise.all([actorScope(userId), repository.getVisitDetail(visitId)]);
    if (!visit) throw Object.assign(new Error("Visit not found"), { statusCode: 404 });
    if (!mayAccessVisit(scope, visit)) throw Object.assign(new Error("Visit access denied"), { statusCode: 403 });
    if (!["approved", "checked_in"].includes(visit.status)) throw Object.assign(new Error("Only approved or checked-in visits can be extended"), { statusCode: 409 });
    if (new Date(scheduledEnd).getTime() <= new Date(visit.scheduled_end).getTime()) {
      throw Object.assign(new Error("New end time must be later than the current end time"), { statusCode: 400 });
    }
    await db.executeRun(`UPDATE visitor_visit SET scheduled_end = ? WHERE id = ?`, [new Date(scheduledEnd), visitId]);
    await writeSensitiveActionLog({
      actor_user_id: userId,
      actor_role: scope.roles[0],
      action_type: "VISITOR_VISIT_EXTENDED",
      module_key: "VISITOR_MANAGEMENT",
      entity_type: "visitor_visit",
      entity_id: visitId,
      reason,
      old_value_json: { scheduled_end: visit.scheduled_end },
      new_value_json: { scheduled_end: scheduledEnd },
      req,
    });
    return { id: visitId, status: visit.status, scheduled_end: scheduledEnd };
  },

  async liveOccupancy(userId: string, branchId?: string) {
    const scope = await actorScope(userId);
    if (!scope.unrestricted && !scope.branchId) return [];
    const selectedBranch = scope.unrestricted ? branchId : scope.branchId;
    const where = selectedBranch ? "AND vv.branch_id = ?" : "";
    const params = selectedBranch ? [selectedBranch] : [];
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT vv.branch_id, bm.branch_name, COUNT(*) AS visitors_inside
         FROM visitor_visit vv
         JOIN branch_master bm ON bm.id = vv.branch_id
        WHERE vv.status = 'checked_in' ${where}
        GROUP BY vv.branch_id, bm.branch_name ORDER BY bm.branch_name`,
      params,
    );
    return rows;
  },

  async emergencyRegister(userId: string, branchId?: string) {
    const scope = await actorScope(userId);
    if (!scope.unrestricted && !scope.branchId) return [];
    const selectedBranch = scope.unrestricted ? branchId : scope.branchId;
    const where = selectedBranch ? "AND vv.branch_id = ?" : "";
    const params = selectedBranch ? [selectedBranch] : [];
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT vv.id, vv.visit_number, vp.full_name AS visitor_name,
              CONCAT('******', RIGHT(vp.mobile_normalized, 4)) AS masked_mobile,
              bm.branch_name, vv.host_display_name, vv.checked_in_at
         FROM visitor_visit vv
         JOIN visitor_profile vp ON vp.id = vv.visitor_id
         JOIN branch_master bm ON bm.id = vv.branch_id
        WHERE vv.status = 'checked_in' ${where}
        ORDER BY bm.branch_name, vv.checked_in_at`,
      params,
    );
    return rows;
  },
};
