import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { portalKpiService } from "./portal.kpi.service.js";
import { portalAttritionService } from "./portal.attrition.service.js";
import { portalGovernanceService } from "./portal.governance.service.js";
import { maskPortalEmployee } from "../../shared/portalMask.js";

type SnapshotType = "kpi" | "governance" | "attrition" | "staffing" | "quality";

export interface QueueItem {
  id: string;
  process_id: string;
  snapshot_type: SnapshotType;
  period: string;
  prepared_data: unknown;
  prepared_by: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export interface PublishedSnapshot {
  id: string;
  process_id: string;
  snapshot_type: SnapshotType;
  period: string;
  snapshot_data: unknown;
  approved_by: string;
  approved_at: string;
  is_active: number;
  notes: string | null;
  created_at: string;
}

async function fetchSnapshotData(
  processId: string,
  snapshotType: SnapshotType,
  period: string
): Promise<unknown> {
  switch (snapshotType) {
    case "kpi": {
      const scorecards = await portalKpiService.getScorecards(processId, period);
      // KPI service already masks via maskPortalEmployee internally; return as-is
      return scorecards;
    }
    case "attrition": {
      const data = await portalAttritionService.getAttrition(processId, period);
      // Attrition data is aggregate-only by design — no individual records
      return data;
    }
    case "governance": {
      const data = await portalGovernanceService.getChecklist(processId, period);
      return data;
    }
    case "staffing":
    case "quality": {
      // Future snapshot types — fetch from relevant tables, apply masking
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT process_id, period, COUNT(*) AS record_count
         FROM employees
         WHERE process_id = ?
         GROUP BY process_id, DATE_FORMAT(CURDATE(), '%Y-%m')`,
        [processId]
      ).catch((): [RowDataPacket[], unknown] => [[{ process_id: processId, period, record_count: 0 } as RowDataPacket], null]);

      return (rows as RowDataPacket[]).map(r =>
        maskPortalEmployee(r as Record<string, unknown>)
      );
    }
  }
}

export const portalSnapshotService = {
  async prepare(
    processId: string,
    snapshotType: SnapshotType,
    period: string,
    preparedBy: string
  ): Promise<{ id: string; preview: unknown }> {
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw Object.assign(new Error("Invalid period format — expected YYYY-MM"), { statusCode: 400 });
    }

    const preview = await fetchSnapshotData(processId, snapshotType, period);

    const id = randomUUID();
    await db.execute(
      `INSERT INTO portal_data_approval_queue
         (id, process_id, snapshot_type, period, prepared_data, prepared_by, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [id, processId, snapshotType, period, JSON.stringify(preview), preparedBy]
    );

    return { id, preview };
  },

  async listQueue(): Promise<QueueItem[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, process_id, snapshot_type, period, prepared_data, prepared_by,
              status, reviewed_by, reviewed_at, rejection_reason, created_at
       FROM portal_data_approval_queue
       ORDER BY created_at DESC`
    );
    return (rows as RowDataPacket[]).map(r => ({
      ...r,
      prepared_data: typeof r.prepared_data === "string"
        ? JSON.parse(r.prepared_data)
        : r.prepared_data,
    })) as QueueItem[];
  },

  async review(
    id: string,
    action: "approved" | "rejected",
    reviewedBy: string,
    rejectionReason?: string
  ): Promise<void> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM portal_data_approval_queue WHERE id = ? LIMIT 1",
      [id]
    );
    const item = (rows as RowDataPacket[])[0];
    if (!item) {
      throw Object.assign(new Error("Queue item not found"), { statusCode: 404 });
    }
    if (item.status !== "pending") {
      throw Object.assign(
        new Error(`Item is already ${item.status as string}`),
        { statusCode: 409 }
      );
    }

    await db.execute(
      `UPDATE portal_data_approval_queue
       SET status = ?, reviewed_by = ?, reviewed_at = NOW(), rejection_reason = ?
       WHERE id = ?`,
      [action, reviewedBy, rejectionReason ?? null, id]
    );

    if (action === "approved") {
      const preparedData = typeof item.prepared_data === "string"
        ? item.prepared_data
        : JSON.stringify(item.prepared_data);

      // Deactivate any prior active snapshot for the same process/type/period
      await db.execute(
        `UPDATE portal_published_snapshot
         SET is_active = 0
         WHERE process_id = ? AND snapshot_type = ? AND period = ? AND is_active = 1`,
        [item.process_id, item.snapshot_type, item.period]
      );

      await db.execute(
        `INSERT INTO portal_published_snapshot
           (id, process_id, snapshot_type, period, snapshot_data, approved_by, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [randomUUID(), item.process_id, item.snapshot_type, item.period, preparedData, reviewedBy]
      );
    }
  },

  async listPublished(): Promise<PublishedSnapshot[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, process_id, snapshot_type, period, snapshot_data,
              approved_by, approved_at, is_active, notes, created_at
       FROM portal_published_snapshot
       ORDER BY approved_at DESC`
    );
    return (rows as RowDataPacket[]).map(r => ({
      ...r,
      snapshot_data: typeof r.snapshot_data === "string"
        ? JSON.parse(r.snapshot_data)
        : r.snapshot_data,
    })) as PublishedSnapshot[];
  },

  async deactivate(id: string): Promise<void> {
    const [result] = await db.execute(
      "UPDATE portal_published_snapshot SET is_active = 0 WHERE id = ?",
      [id]
    );
    const affected = (result as unknown as { affectedRows: number }).affectedRows;
    if (affected === 0) {
      throw Object.assign(new Error("Snapshot not found"), { statusCode: 404 });
    }
  },

  async listAccessLog(
    processId?: string,
    fromDate?: string,
    toDate?: string
  ): Promise<RowDataPacket[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (processId) {
      // portal_access_log stores page like /portal/processes/:id/...
      conditions.push("page LIKE ?");
      params.push(`%/processes/${processId}%`);
    }
    if (fromDate) {
      conditions.push("created_at >= ?");
      params.push(`${fromDate} 00:00:00`);
    }
    if (toDate) {
      conditions.push("created_at <= ?");
      params.push(`${toDate} 23:59:59`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT pal.id, pal.client_user_id, cu.name AS client_user_name, cu.email,
              pal.page, pal.ip_address, pal.created_at
       FROM portal_access_log pal
       LEFT JOIN client_user cu ON cu.id = pal.client_user_id
       ${where}
       ORDER BY pal.created_at DESC
       LIMIT 500`,
      params
    ).catch((): [RowDataPacket[], unknown] => [[], null]);

    return rows as RowDataPacket[];
  },
};
