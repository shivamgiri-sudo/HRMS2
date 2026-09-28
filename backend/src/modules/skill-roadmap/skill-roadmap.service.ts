import { db } from "../../db/mysql.js";
import { randomUUID } from "node:crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

export const skillRoadmapService = {

  async listRoadmaps() {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, label, description, node_count, is_active FROM skill_roadmaps WHERE is_active = 1 ORDER BY label`
    );
    return rows as RowDataPacket[];
  },

  async getEmployeeRoadmaps(employeeId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT r.id, r.label, r.description, r.node_count, era.assigned_at
       FROM employee_roadmap_assignments era
       JOIN skill_roadmaps r ON r.id = era.roadmap_id
       WHERE era.employee_id = ? AND era.is_active = 1
       ORDER BY r.label`,
      [employeeId]
    );
    return rows as RowDataPacket[];
  },

  async assignRoadmap(employeeId: string, roadmapId: string, assignedBy: string) {
    await db.execute(
      `INSERT INTO employee_roadmap_assignments (id, employee_id, roadmap_id, assigned_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE is_active = 1, assigned_by = VALUES(assigned_by), assigned_at = NOW()`,
      [randomUUID(), employeeId, roadmapId, assignedBy]
    );
  },

  async unassignRoadmap(employeeId: string, roadmapId: string) {
    await db.execute(
      `UPDATE employee_roadmap_assignments SET is_active = 0 WHERE employee_id = ? AND roadmap_id = ?`,
      [employeeId, roadmapId]
    );
  },

  async getRoadmapNodes(roadmapId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, node_slug, label, description, sort_order
       FROM skill_roadmap_nodes
       WHERE roadmap_id = ? AND is_active = 1
       ORDER BY sort_order, label`,
      [roadmapId]
    );
    return rows as RowDataPacket[];
  },

  async getEmployeeSkillStates(employeeId: string, roadmapId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ess.node_id, ess.status, ess.notes, ess.updated_at,
              n.label, n.node_slug
       FROM employee_skill_states ess
       JOIN skill_roadmap_nodes n ON n.id = ess.node_id
       WHERE ess.employee_id = ? AND n.roadmap_id = ?`,
      [employeeId, roadmapId]
    );
    return rows as RowDataPacket[];
  },

  async setSkillState(
    employeeId: string,
    nodeId: string,
    status: "none" | "in_progress" | "done",
    updatedBy: string,
    notes?: string
  ) {
    await db.execute(
      `INSERT INTO employee_skill_states (id, employee_id, node_id, status, updated_by, notes)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), updated_by = VALUES(updated_by),
         notes = COALESCE(VALUES(notes), notes), updated_at = NOW()`,
      [randomUUID(), employeeId, nodeId, status, updatedBy, notes ?? null]
    );
  },

  async getSkillSummary(employeeId: string, roadmapId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(n.id)                                  AS total,
         SUM(ess.status = 'done')                     AS done_count,
         SUM(ess.status = 'in_progress')              AS inprog_count
       FROM skill_roadmap_nodes n
       LEFT JOIN employee_skill_states ess
         ON ess.node_id = n.id AND ess.employee_id = ?
       WHERE n.roadmap_id = ? AND n.is_active = 1`,
      [employeeId, roadmapId]
    );
    const r = (rows as RowDataPacket[])[0] ?? {};
    const total = Number(r.total ?? 0);
    const done = Number(r.done_count ?? 0);
    const inprog = Number(r.inprog_count ?? 0);
    return { total, done, inprog, pct: total ? Math.round((done / total) * 100) : 0 };
  },

  async getGapSkills(employeeId: string, roadmapId: string, designationId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT n.id AS node_id, n.label, n.node_slug,
              COALESCE(ess.status, 'none') AS status
       FROM designation_required_skills drs
       JOIN skill_roadmap_nodes n ON n.id = drs.node_id AND n.roadmap_id = ?
       LEFT JOIN employee_skill_states ess
         ON ess.node_id = n.id AND ess.employee_id = ?
       WHERE drs.designation_id = ?
         AND (ess.status IS NULL OR ess.status = 'none')`,
      [roadmapId, employeeId, designationId]
    );
    return rows as RowDataPacket[];
  },

  async bulkUpsertNodes(
    roadmapId: string,
    nodes: Array<{ slug: string; label: string; description?: string; sortOrder: number }>
  ) {
    if (nodes.length === 0) return;
    // Single multi-row INSERT instead of N separate round-trips.
    const placeholders = nodes.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
    const values = nodes.flatMap((node) => [
      `${roadmapId}:${node.slug}`,
      roadmapId,
      node.slug,
      node.label,
      node.description ?? null,
      node.sortOrder,
    ]);
    await db.execute(
      `INSERT INTO skill_roadmap_nodes (id, roadmap_id, node_slug, label, description, sort_order)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description),
         sort_order = VALUES(sort_order)`,
      values,
    );
    await db.execute(
      `UPDATE skill_roadmaps SET node_count = (SELECT COUNT(*) FROM skill_roadmap_nodes WHERE roadmap_id = ?) WHERE id = ?`,
      [roadmapId, roadmapId],
    );
  },
};
