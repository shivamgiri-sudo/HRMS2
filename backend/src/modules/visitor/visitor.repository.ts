import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { ActorScope, CreateVisitInput, VisitListFilters } from "./visitor.types.js";

type IdRow = RowDataPacket & { id: string };

export function normalizeMobile(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length > 10 && digits.startsWith("91") ? digits.slice(-10) : digits;
}

export async function getActiveBranch(branchId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_code, branch_name, city, state
       FROM branch_master
      WHERE id = ? AND active_status = 1
      LIMIT 1`,
    [branchId],
  );
  return rows[0] ?? null;
}

export async function listPublicBranches() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_code, branch_name, city, state
       FROM branch_master
      WHERE active_status = 1
      ORDER BY branch_name`,
  );
  return rows;
}

export async function resolveActiveHost(input: { employeeId?: string; employeeCode?: string; branchId?: string }) {
  const where: string[] = ["e.active_status = 1", "LOWER(COALESCE(e.employment_status, 'active')) = 'active'"];
  const params: unknown[] = [];
  if (input.employeeId) { where.push("e.id = ?"); params.push(input.employeeId); }
  if (input.employeeCode) { where.push("UPPER(e.employee_code) = UPPER(?)"); params.push(input.employeeCode); }
  if (input.branchId) { where.push("e.branch_id = ?"); params.push(input.branchId); }
  if (!input.employeeId && !input.employeeCode) return null;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.branch_id,
            COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS full_name,
            e.department_id, e.designation_id
       FROM employees e
      WHERE ${where.join(" AND ")}
      LIMIT 1`,
    params,
  );
  return rows[0] ?? null;
}

export async function getActorEmployee(userId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.branch_id, e.reporting_manager_id, e.employee_code,
            COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS full_name
       FROM employees e
      WHERE e.user_id = ? AND e.active_status = 1
      LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function upsertVisitorProfile(input: CreateVisitInput["visitor"]): Promise<string> {
  const normalized = normalizeMobile(input.mobile);
  const [existing] = await db.execute<IdRow[]>(
    `SELECT id FROM visitor_profile
      WHERE mobile_normalized = ? AND active_status = 1
      ORDER BY updated_at DESC LIMIT 1`,
    [normalized],
  );
  const id = existing[0]?.id ?? randomUUID();
  if (existing[0]) {
    await db.executeRun(
      `UPDATE visitor_profile
          SET full_name = ?, mobile = ?, email = ?, company_name = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [input.full_name, input.mobile, input.email || null, input.company_name || null, id],
    );
  } else {
    await db.executeRun(
      `INSERT INTO visitor_profile
         (id, full_name, mobile, mobile_normalized, email, company_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.full_name, input.mobile, normalized, input.email || null, input.company_name || null],
    );
  }
  return id;
}

export async function insertVisit(input: CreateVisitInput & {
  visitorId: string;
  visitId: string;
  visitNumber: string;
  trackingTokenHash: string;
  hostEmployeeId: string | null;
  hostDisplayName: string | null;
}) {
  await db.executeRun(
    `INSERT INTO visitor_visit
       (id, visit_number, visitor_id, branch_id, host_employee_id, created_by_user_id,
        source_channel, visit_type, purpose, status, scheduled_start, scheduled_end,
        tracking_token_hash, host_display_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?)`,
    [
      input.visitId, input.visitNumber, input.visitorId, input.branch_id,
      input.hostEmployeeId, input.created_by_user_id ?? null, input.source_channel,
      input.visit_type, input.purpose, new Date(input.scheduled_start), new Date(input.scheduled_end),
      input.trackingTokenHash, input.hostDisplayName,
    ],
  );

  for (const companion of input.companions ?? []) {
    await db.executeRun(
      `INSERT INTO visitor_companion (id, visit_id, full_name, mobile, relationship_label)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), input.visitId, companion.full_name, companion.mobile ?? null, companion.relationship_label ?? null],
    );
  }
  if (input.vehicle) {
    await db.executeRun(
      `INSERT INTO visitor_vehicle (id, visit_id, vehicle_number, vehicle_type, parking_slot)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), input.visitId, input.vehicle.vehicle_number, input.vehicle.vehicle_type ?? null, input.vehicle.parking_slot ?? null],
    );
  }
  for (const item of input.belongings ?? []) {
    await db.executeRun(
      `INSERT INTO visitor_belonging (id, visit_id, item_type, description, serial_number)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), input.visitId, item.item_type, item.description ?? null, item.serial_number ?? null],
    );
  }
  if (input.hostEmployeeId) {
    await db.executeRun(
      `INSERT INTO visitor_approval
         (id, visit_id, approval_level, approver_employee_id, status)
       VALUES (?, ?, 'host', ?, 'pending')`,
      [randomUUID(), input.visitId, input.hostEmployeeId],
    );
  }
}

export async function createVisitAtomic(input: CreateVisitInput & {
  visitId: string;
  visitNumber: string;
  trackingTokenHash: string;
  hostEmployeeId: string | null;
  hostDisplayName: string | null;
  consent?: {
    consentType: string;
    consentVersion: string;
    accepted: boolean;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
}): Promise<string> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const normalized = normalizeMobile(input.visitor.mobile);
    const [existing] = await conn.execute<IdRow[]>(
      `SELECT id FROM visitor_profile
        WHERE mobile_normalized = ? AND active_status = 1
        ORDER BY updated_at DESC LIMIT 1
        FOR UPDATE`,
      [normalized],
    );
    const visitorId = existing[0]?.id ?? randomUUID();
    if (existing[0]) {
      await conn.execute<ResultSetHeader>(
        `UPDATE visitor_profile
            SET full_name = ?, mobile = ?, email = ?, company_name = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [
          input.visitor.full_name,
          input.visitor.mobile,
          input.visitor.email || null,
          input.visitor.company_name || null,
          visitorId,
        ],
      );
    } else {
      await conn.execute<ResultSetHeader>(
        `INSERT INTO visitor_profile
           (id, full_name, mobile, mobile_normalized, email, company_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          visitorId,
          input.visitor.full_name,
          input.visitor.mobile,
          normalized,
          input.visitor.email || null,
          input.visitor.company_name || null,
        ],
      );
    }

    await conn.execute<ResultSetHeader>(
      `INSERT INTO visitor_visit
         (id, visit_number, visitor_id, branch_id, host_employee_id, created_by_user_id,
          source_channel, visit_type, purpose, status, scheduled_start, scheduled_end,
          tracking_token_hash, host_display_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?)`,
      [
        input.visitId,
        input.visitNumber,
        visitorId,
        input.branch_id,
        input.hostEmployeeId,
        input.created_by_user_id ?? null,
        input.source_channel,
        input.visit_type,
        input.purpose,
        new Date(input.scheduled_start),
        new Date(input.scheduled_end),
        input.trackingTokenHash,
        input.hostDisplayName,
      ],
    );

    for (const companion of input.companions ?? []) {
      await conn.execute<ResultSetHeader>(
        `INSERT INTO visitor_companion (id, visit_id, full_name, mobile, relationship_label)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), input.visitId, companion.full_name, companion.mobile ?? null, companion.relationship_label ?? null],
      );
    }
    if (input.vehicle) {
      await conn.execute<ResultSetHeader>(
        `INSERT INTO visitor_vehicle (id, visit_id, vehicle_number, vehicle_type, parking_slot)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), input.visitId, input.vehicle.vehicle_number, input.vehicle.vehicle_type ?? null, input.vehicle.parking_slot ?? null],
      );
    }
    for (const item of input.belongings ?? []) {
      await conn.execute<ResultSetHeader>(
        `INSERT INTO visitor_belonging (id, visit_id, item_type, description, serial_number)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), input.visitId, item.item_type, item.description ?? null, item.serial_number ?? null],
      );
    }
    if (input.hostEmployeeId) {
      await conn.execute<ResultSetHeader>(
        `INSERT INTO visitor_approval
           (id, visit_id, approval_level, approver_employee_id, status)
         VALUES (?, ?, 'host', ?, 'pending')`,
        [randomUUID(), input.visitId, input.hostEmployeeId],
      );
    }
    if (input.consent) {
      await conn.execute<ResultSetHeader>(
        `INSERT INTO visitor_consent
           (id, visitor_id, visit_id, consent_type, consent_version, accepted, ip_address, user_agent, withdrawn_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          visitorId,
          input.visitId,
          input.consent.consentType,
          input.consent.consentVersion,
          input.consent.accepted ? 1 : 0,
          input.consent.ipAddress ?? null,
          input.consent.userAgent?.slice(0, 512) ?? null,
          input.consent.accepted ? null : new Date(),
        ],
      );
    }

    await conn.commit();
    return visitorId;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function recordConsent(input: {
  visitorId: string;
  visitId: string;
  consentType: string;
  consentVersion: string;
  accepted: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  await db.executeRun(
    `INSERT INTO visitor_consent
       (id, visitor_id, visit_id, consent_type, consent_version, accepted, ip_address, user_agent, withdrawn_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       accepted = VALUES(accepted), accepted_at = CURRENT_TIMESTAMP,
       ip_address = VALUES(ip_address), user_agent = VALUES(user_agent),
       withdrawn_at = VALUES(withdrawn_at)`,
    [
      randomUUID(), input.visitorId, input.visitId, input.consentType, input.consentVersion,
      input.accepted ? 1 : 0, input.ipAddress ?? null, input.userAgent?.slice(0, 512) ?? null,
      input.accepted ? null : new Date(),
    ],
  );
}

export async function getVisitByTrackingHash(hash: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT vv.id, vv.visit_number, vv.visitor_id, vv.branch_id, vv.host_employee_id,
            vv.visit_type, vv.purpose, vv.status, vv.scheduled_start, vv.scheduled_end,
            vv.checked_in_at, vv.checked_out_at, vv.checkout_requested_at,
            vp.full_name AS visitor_name, vp.company_name,
            bm.branch_name, vv.host_display_name
       FROM visitor_visit vv
       JOIN visitor_profile vp ON vp.id = vv.visitor_id
       JOIN branch_master bm ON bm.id = vv.branch_id
      WHERE vv.tracking_token_hash = ?
      LIMIT 1`,
    [hash],
  );
  return rows[0] ?? null;
}

export async function listHosts(scope: ActorScope, query: string, branchId?: string) {
  const where = [
    "e.active_status = 1",
    "LOWER(COALESCE(e.employment_status, 'active')) = 'active'",
    `(e.employee_code LIKE ? OR COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) LIKE ?)`,
  ];
  const params: unknown[] = [`%${query}%`, `%${query}%`];
  if (!scope.unrestricted) {
    if (!scope.branchId) return [];
    where.push("e.branch_id = ?"); params.push(scope.branchId);
  } else if (branchId) {
    where.push("e.branch_id = ?"); params.push(branchId);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.branch_id,
            COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS full_name,
            dm.dept_name, dgm.designation_name
       FROM employees e
       LEFT JOIN department_master dm ON dm.id = e.department_id
       LEFT JOIN designation_master dgm ON dgm.id = e.designation_id
      WHERE ${where.join(" AND ")}
      ORDER BY full_name LIMIT 25`,
    params,
  );
  return rows;
}

export async function listVisits(scope: ActorScope, filters: VisitListFilters) {
  // mysql2 prepared statements are not supported for LIMIT/OFFSET by every
  // production MySQL configuration. These values have already passed the Zod
  // integer bounds, and the defensive clamp keeps interpolation SQL-safe.
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(filters.limit) || 50)));
  const offset = Math.max(0, Math.trunc(Number(filters.offset) || 0));
  const where: string[] = ["1=1"];
  const params: unknown[] = [];
  if (!scope.unrestricted) {
    if (scope.roles.some((role) => ["visitor_security", "visitor_reception", "branch_head", "branch_hr", "hr_branch"].includes(role))) {
      if (!scope.branchId) return [];
      where.push("vv.branch_id = ?"); params.push(scope.branchId);
    } else {
      if (!scope.employeeId) return [];
      where.push("vv.host_employee_id = ?"); params.push(scope.employeeId);
    }
  }
  if (filters.branch_id) { where.push("vv.branch_id = ?"); params.push(filters.branch_id); }
  if (filters.host_employee_id) { where.push("vv.host_employee_id = ?"); params.push(filters.host_employee_id); }
  if (filters.status) { where.push("vv.status = ?"); params.push(filters.status); }
  if (filters.date_from) { where.push("DATE(vv.scheduled_start) >= ?"); params.push(filters.date_from); }
  if (filters.date_to) { where.push("DATE(vv.scheduled_start) <= ?"); params.push(filters.date_to); }
  if (filters.search) {
    where.push("(vp.full_name LIKE ? OR vp.mobile_normalized LIKE ? OR vv.visit_number LIKE ? OR vp.company_name LIKE ?)");
    const q = `%${filters.search}%`; params.push(q, q, q, q);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT vv.id, vv.visit_number, vv.visit_type, vv.purpose, vv.status,
            vv.scheduled_start, vv.scheduled_end, vv.checked_in_at, vv.checked_out_at,
            vv.branch_id, bm.branch_name, vv.host_employee_id, vv.host_display_name,
            vp.full_name AS visitor_name, vp.company_name,
            CONCAT('******', RIGHT(vp.mobile_normalized, 4)) AS masked_mobile
       FROM visitor_visit vv
       JOIN visitor_profile vp ON vp.id = vv.visitor_id
       JOIN branch_master bm ON bm.id = vv.branch_id
      WHERE ${where.join(" AND ")}
      ORDER BY vv.scheduled_start DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return rows;
}

export async function getVisitDetail(visitId: string): Promise<any | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT vv.*, vp.full_name AS visitor_name, vp.mobile, vp.email, vp.company_name,
            bm.branch_name, bm.branch_code
       FROM visitor_visit vv
       JOIN visitor_profile vp ON vp.id = vv.visitor_id
       JOIN branch_master bm ON bm.id = vv.branch_id
      WHERE vv.id = ? LIMIT 1`,
    [visitId],
  );
  const row = rows[0];
  if (!row) return null;

  const [companions, belongings, vehicles, approvals, events] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT id, full_name, mobile, relationship_label, created_at
         FROM visitor_companion WHERE visit_id = ? ORDER BY created_at`,
      [visitId],
    ).then(([data]) => data),
    db.execute<RowDataPacket[]>(
      `SELECT id, item_type, description, serial_number, verified_out, created_at
         FROM visitor_belonging WHERE visit_id = ? ORDER BY created_at`,
      [visitId],
    ).then(([data]) => data),
    db.execute<RowDataPacket[]>(
      `SELECT id, vehicle_number, vehicle_type, parking_slot, created_at
         FROM visitor_vehicle WHERE visit_id = ? ORDER BY created_at`,
      [visitId],
    ).then(([data]) => data),
    db.execute<RowDataPacket[]>(
      `SELECT id, approval_level, approver_employee_id, status, decision_reason, decided_at, created_at
         FROM visitor_approval WHERE visit_id = ? ORDER BY created_at`,
      [visitId],
    ).then(([data]) => data),
    db.execute<RowDataPacket[]>(
      `SELECT id, event_type, gate_code, badge_id, actor_user_id, occurred_at, metadata_json
         FROM visitor_check_event WHERE visit_id = ? ORDER BY occurred_at`,
      [visitId],
    ).then(([data]) => data),
  ]);

  const safeVisit: Record<string, any> = { ...row };
  delete safeVisit.tracking_token_hash;
  return { ...safeVisit, companions, belongings, vehicles, approvals, events };
}
