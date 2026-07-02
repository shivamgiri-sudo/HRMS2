import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type {
  CreateProcessInput,
  ProcessFilters,
  ProcessMaster,
  ProcessRepository,
  UpdateProcessInput,
} from "./process.types.js";

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function mapRow(row: RowDataPacket): ProcessMaster {
  return {
    id: row.id as string,
    process_code: row.process_code as string,
    process_name: row.process_name as string,
    department_id: (row.department_id as string | null) ?? null,
    process_type: (row.process_type as string | null) ?? null,
    branch_name: (row.branch_name as string | null) ?? null,
    location_name: (row.location_name as string | null) ?? null,
    process_owner_employee_id: (row.process_owner_employee_id as string | null) ?? null,
    process_manager_employee_id: (row.process_manager_employee_id as string | null) ?? null,
    active_status: row.active_status === 1 || row.active_status === true,
    description: (row.description as string | null) ?? null,
    metadata: parseMetadata(row.metadata),
    created_by: (row.created_by as string | null) ?? null,
    updated_by: (row.updated_by as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export const processRepositoryMySQL: ProcessRepository = {
  async list(filters: ProcessFilters): Promise<ProcessMaster[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.departmentId) {
      conditions.push("department_id = ?");
      params.push(filters.departmentId);
    }

    if (filters.activeStatus === "active") {
      conditions.push("active_status = 1");
    } else if (filters.activeStatus === "inactive") {
      conditions.push("active_status = 0");
    }

    if (filters.search?.trim()) {
      const term = `%${filters.search.trim()}%`;
      conditions.push(
        "(process_code LIKE ? OR process_name LIKE ? OR process_type LIKE ? OR branch_name LIKE ? OR location_name LIKE ?)"
      );
      params.push(term, term, term, term, term);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `SELECT DISTINCT * FROM process_master ${where} ORDER BY process_name ASC`;

    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return (rows as RowDataPacket[]).map(mapRow);
  },

  async getById(id: string): Promise<ProcessMaster | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM process_master WHERE id = ? LIMIT 1",
      [id]
    );
    const row = (rows as RowDataPacket[])[0];
    return row ? mapRow(row) : null;
  },

  async create(
    input: CreateProcessInput,
    userId: string
  ): Promise<ProcessMaster> {
    const id = randomUUID();
    const metadataJson = JSON.stringify({});

    await db.execute(
      `INSERT INTO process_master
        (id, process_code, process_name, department_id, process_type,
         branch_name, location_name, process_owner_employee_id,
         process_manager_employee_id, description, active_status,
         metadata, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        id,
        input.processCode.trim(),
        input.processName.trim(),
        input.departmentId ?? null,
        input.processType ?? null,
        input.branchName ?? null,
        input.locationName ?? null,
        input.processOwnerEmployeeId ?? null,
        input.processManagerEmployeeId ?? null,
        input.description ?? null,
        metadataJson,
        userId,
        userId,
      ]
    );

    const created = await this.getById(id);
    if (!created) {
      throw new Error("Failed to retrieve process after creation");
    }
    return created;
  },

  async update(
    id: string,
    input: UpdateProcessInput,
    userId: string
  ): Promise<ProcessMaster> {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (input.processName !== undefined) {
      setClauses.push("process_name = ?");
      params.push(input.processName.trim());
    }
    if (input.departmentId !== undefined) {
      setClauses.push("department_id = ?");
      params.push(input.departmentId ?? null);
    }
    if (input.processType !== undefined) {
      setClauses.push("process_type = ?");
      params.push(input.processType ?? null);
    }
    if (input.branchName !== undefined) {
      setClauses.push("branch_name = ?");
      params.push(input.branchName ?? null);
    }
    if (input.locationName !== undefined) {
      setClauses.push("location_name = ?");
      params.push(input.locationName ?? null);
    }
    if (input.processOwnerEmployeeId !== undefined) {
      setClauses.push("process_owner_employee_id = ?");
      params.push(input.processOwnerEmployeeId ?? null);
    }
    if (input.processManagerEmployeeId !== undefined) {
      setClauses.push("process_manager_employee_id = ?");
      params.push(input.processManagerEmployeeId ?? null);
    }
    if (input.activeStatus !== undefined) {
      setClauses.push("active_status = ?");
      params.push(input.activeStatus ? 1 : 0);
    }
    if (input.description !== undefined) {
      setClauses.push("description = ?");
      params.push(input.description ?? null);
    }

    setClauses.push("updated_by = ?");
    params.push(userId);

    if (setClauses.length === 1) {
      // Only updated_by was added — nothing meaningful to update, just re-fetch
      const existing = await this.getById(id);
      if (!existing) {
        throw new Error(`Process with id '${id}' not found`);
      }
      return existing;
    }

    params.push(id);

    await db.execute(
      `UPDATE process_master SET ${setClauses.join(", ")} WHERE id = ?`,
      params
    );

    const updated = await this.getById(id);
    if (!updated) {
      throw new Error(`Process with id '${id}' not found`);
    }
    return updated;
  },

  async updateStatus(
    id: string,
    activeStatus: boolean,
    userId: string
  ): Promise<ProcessMaster> {
    await db.execute(
      "UPDATE process_master SET active_status = ?, updated_by = ? WHERE id = ?",
      [activeStatus ? 1 : 0, userId, id]
    );

    const updated = await this.getById(id);
    if (!updated) {
      throw new Error(`Process with id '${id}' not found`);
    }
    return updated;
  },
};
