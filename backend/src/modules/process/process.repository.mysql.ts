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

/**
 * Input fields that process_master has no column for.
 *
 * The repository was written against a schema that does not exist. Its INSERT
 * named fourteen columns and nine of them - department_id, branch_name,
 * location_name, process_owner_employee_id, process_manager_employee_id,
 * description, metadata, created_by, updated_by - are absent from the table, so
 * POST /api/processes has always returned ER_BAD_FIELD_ERROR. update() appended
 * `updated_by = ?` unconditionally, so PUT /api/processes/:id failed too, and
 * PATCH /:id/status failed on the same column.
 *
 * These are rejected rather than quietly dropped. Silently accepting a
 * description and storing nothing is the failure mode this whole class of bug is
 * made of; a caller that sends one deserves to be told there is nowhere to put
 * it.
 *
 * branchName and processOwnerEmployeeId are no longer among them. By decision on
 * 2026-08-12 they are resolved instead of refused: a branch name is looked up in
 * branch_master and stored as branch_id, and an owner's employee id is looked up
 * in employees and stored as process_owner_name. Both are rejected with a 400 if
 * they do not resolve, rather than being written as NULL - a process silently
 * losing its branch is the failure this whole change is about.
 */
const UNSTORABLE_FIELDS = [
  "departmentId",
  "locationName",
  "processManagerEmployeeId",
  "description",
] as const;

/** branch_master.branch_name -> process_master.branch_id */
async function resolveBranchId(branchName: string): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM branch_master WHERE branch_name = ? LIMIT 1",
    [branchName.trim()]
  );
  if (rows.length === 0) {
    throw Object.assign(new Error(`No branch named '${branchName}' exists.`), {
      statusCode: 400,
      code: "BRANCH_NOT_FOUND",
    });
  }
  return (rows[0] as { id: string }).id;
}

/** employees.full_name -> process_master.process_owner_name */
async function resolveOwnerName(employeeId: string): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT full_name FROM employees WHERE id = ? LIMIT 1",
    [employeeId]
  );
  if (rows.length === 0) {
    throw Object.assign(new Error(`No employee with id '${employeeId}' exists.`), {
      statusCode: 400,
      code: "PROCESS_OWNER_NOT_FOUND",
    });
  }
  return (rows[0] as { full_name: string }).full_name;
}

function rejectUnstorableFields(input: CreateProcessInput | UpdateProcessInput): void {
  const bag = input as Record<string, unknown>;
  const supplied = UNSTORABLE_FIELDS.filter((f) => bag[f] !== undefined && bag[f] !== null);
  if (supplied.length > 0) {
    throw Object.assign(
      new Error(
        `process_master cannot store: ${supplied.join(", ")}. The table holds ` +
          `process_code, process_name, process_type, business_lob, branch_id, ` +
          `client_id, client_name and the SLA/escalation fields.`
      ),
      { statusCode: 400, code: "PROCESS_FIELDS_UNSUPPORTED" }
    );
  }
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

  /**
   * The processes a specific user is explicitly assigned to.
   *
   * Reads user_assignment_scope, the same table scopeAccess.ts uses for every other row-scope
   * decision, so "assigned to me" means the same thing here as everywhere else.
   *
   * THREE DELIBERATE NARROWINGS, each measured against production on 2026-08-09:
   *
   * 1. Explicit assignments only — `process_id IS NOT NULL`. Live there are 36 rows of
   *    scope_type 'all' and 34 of 'branch', none carrying a process_id. Expanding 'all' to
   *    "every process" would hand those users 52 processes, and the only caller fires one
   *    payroll-readiness request per process on a 120s interval against a pool of 10. The
   *    26 rows that DO carry a process_id average exactly one process per user, so this
   *    keeps the fan-out at one request. Broad views have their own endpoints already
   *    (/grouped-summary, /branch/:branchId).
   *
   * 2. Active processes only. 131 rows exist, 52 are active; a closed process has no
   *    readiness to declare.
   *
   * 3. branch_id must be present. The caller builds
   *    /api/payroll/process-readiness/{branch_id}/{id}, so a process without a branch
   *    produces a request that cannot resolve. Of the 26 explicit assignments only 10 clear
   *    all three filters — returning the other 16 would render a permanently blank card,
   *    whereas omitting them leaves the page's own "Contact your HR admin to map you to a
   *    process" message, which is the truthful description of an incomplete mapping.
   */
  async listAssignedToUser(userId: string): Promise<Array<{ id: string; branch_id: string; process_name: string }>> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT p.id, p.branch_id, p.process_name
         FROM user_assignment_scope uas
         JOIN process_master p ON p.id = uas.process_id
        WHERE uas.user_id = ?
          AND uas.active_status = 1
          AND uas.process_id IS NOT NULL
          AND p.active_status = 1
          AND p.branch_id IS NOT NULL
        ORDER BY p.process_name ASC`,
      [userId]
    );
    return (rows as RowDataPacket[]).map((r) => ({
      id: String(r.id),
      branch_id: String(r.branch_id),
      process_name: String(r.process_name),
    }));
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
    rejectUnstorableFields(input);

    const id = randomUUID();

    // Nine of the fourteen columns this used to name do not exist on
    // process_master - see UNSTORABLE_FIELDS. userId has nowhere to go either:
    // the table has created_at/updated_at but no created_by/updated_by.
    const branchId = input.branchName ? await resolveBranchId(input.branchName) : null;
    const ownerName = input.processOwnerEmployeeId
      ? await resolveOwnerName(input.processOwnerEmployeeId)
      : null;

    await db.execute(
      `INSERT INTO process_master
        (id, process_code, process_name, process_type, branch_id, process_owner_name, active_status)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        id,
        input.processCode.trim(),
        input.processName.trim(),
        input.processType ?? null,
        branchId,
        ownerName,
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
    // without this, an update naming description or branchName would now be
    // accepted and quietly store nothing - worse than the error it used to throw
    rejectUnstorableFields(input);

    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (input.processName !== undefined) {
      setClauses.push("process_name = ?");
      params.push(input.processName.trim());
    }
    if (input.processType !== undefined) {
      setClauses.push("process_type = ?");
      params.push(input.processType ?? null);
    }
    if (input.activeStatus !== undefined) {
      setClauses.push("active_status = ?");
      params.push(input.activeStatus ? 1 : 0);
    }
    if (input.branchName !== undefined) {
      setClauses.push("branch_id = ?");
      params.push(input.branchName ? await resolveBranchId(input.branchName) : null);
    }
    if (input.processOwnerEmployeeId !== undefined) {
      setClauses.push("process_owner_name = ?");
      params.push(
        input.processOwnerEmployeeId ? await resolveOwnerName(input.processOwnerEmployeeId) : null
      );
    }

    // updated_by is not a column here, and it used to be appended
    // unconditionally, so every update failed regardless of what was in it.

    if (setClauses.length === 0) {
      // Nothing storable to update — just re-fetch
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
    // updated_by does not exist on process_master, so activating or deactivating
    // a process failed on the column rather than on anything to do with status.
    await db.execute(
      "UPDATE process_master SET active_status = ? WHERE id = ?",
      [activeStatus ? 1 : 0, id]
    );

    const updated = await this.getById(id);
    if (!updated) {
      throw new Error(`Process with id '${id}' not found`);
    }
    return updated;
  },
};
