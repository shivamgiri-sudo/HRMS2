import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { getEffectiveConfig } from "../customization/customization-engine.js";

// ── Whitelisted master tables to prevent SQL injection ────────────────────────
const MASTER_TABLE_WHITELIST = new Set([
  "branch_master",
  "department_master",
  "lob_master",
  "designation_master",
  "campaign_master",
  "cost_centre_master",
  "grade_band_master",
  "location_master",
  "policy_master",
  "process_master", // Added for consistency
]);

// ── Generic list/get helpers ──────────────────────────────────────────────────

function assertMasterTable(table: string): void {
  if (!MASTER_TABLE_WHITELIST.has(table)) {
    throw new Error(`Invalid master table: ${table}`);
  }
}

interface ListOptions {
  q?: string;
  active_status?: string | number;
  page?: number;
  limit?: number;
  entityType?: string;
  employeeId?: string;
}

async function listActive(table: string, orderCol = "created_at", options: ListOptions = {}): Promise<RowDataPacket[]> {
  assertMasterTable(table);
  // orderCol must be a valid MySQL identifier (letters, digits, underscore)
  if (!/^[A-Za-z0-9_]+$/.test(orderCol)) {
    throw new Error(`Invalid orderCol: ${orderCol}`);
  }

  const nameColumns: Record<string, string> = {
    branch_master: "branch_name",
    department_master: "dept_name",
    lob_master: "lob_name",
    designation_master: "designation_name",
    campaign_master: "campaign_name",
    cost_centre_master: "cost_centre_name",
    grade_band_master: "grade_name",
    location_master: "location_name",
    policy_master: "policy_name",
    process_master: "process_name",
  };
  const codeColumns: Record<string, string> = {
    branch_master: "branch_code",
    department_master: "dept_code",
    lob_master: "lob_code",
    designation_master: "designation_code",
    campaign_master: "campaign_code",
    cost_centre_master: "cost_centre_code",
    grade_band_master: "grade_code",
    location_master: "location_code",
    policy_master: "policy_code",
    process_master: "process_code",
  };

  const nameCol = nameColumns[table];
  const codeCol = codeColumns[table];

  const whereClauses: string[] = [];
  const params: any[] = [];

  // Active status filter
  if (options.active_status === "0" || options.active_status === 0) {
    whereClauses.push("active_status = 0");
  } else if (options.active_status === "all") {
    // No active_status filter
  } else {
    whereClauses.push("active_status = 1"); // Default: active only
  }

  // Search filter
  if (options.q && options.q.trim()) {
    const searchTerms: string[] = [];
    if (nameCol) {
      searchTerms.push(`${nameCol} LIKE ?`);
      params.push(`%${options.q.trim()}%`);
    }
    if (codeCol) {
      searchTerms.push(`${codeCol} LIKE ?`);
      params.push(`%${options.q.trim()}%`);
    }
    if (searchTerms.length > 0) {
      whereClauses.push(`(${searchTerms.join(" OR ")})`);
    }
  }

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  // Pagination
  let limitClause = "";
  if (options.limit && options.limit > 0) {
    const limit = Math.min(options.limit, 500); // Cap at 500
    const offset = options.page && options.page > 1 ? (options.page - 1) * limit : 0;
    limitClause = `LIMIT ${limit} OFFSET ${offset}`;
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT * FROM ${table} ${whereClause} ORDER BY ${orderCol} ${limitClause}`,
    params
  );

  const seen = new Set<string>();
  let items = (rows as RowDataPacket[]).filter((item) => {
    if (!nameCol) return true;
    const normalized = String(item[nameCol] ?? "").trim().toLocaleLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  // Apply customization if entityType + employeeId provided
  if (options.entityType && options.employeeId) {
    for (const item of items) {
      try {
        const result = await getEffectiveConfig(options.employeeId, options.entityType, item.id, item);
        Object.assign(item, result.config);
      } catch (err) {
        // Skip customization on error
        console.warn(`Customization error for ${options.entityType} ${item.id}:`, err);
      }
    }
  }

  return items;
}

async function getById(table: string, id: string): Promise<RowDataPacket | null> {
  assertMasterTable(table);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM ${table} WHERE id = ? LIMIT 1`,
    [id]
  );
  return (rows as RowDataPacket[])[0] ?? null;
}

async function softDelete(table: string, id: string): Promise<void> {
  assertMasterTable(table);
  await db.execute(`UPDATE ${table} SET active_status = 0 WHERE id = ?`, [id]);
}

async function setStatus(table: string, id: string, status: number): Promise<void> {
  assertMasterTable(table);
  const activeStatus = status === 1 ? 1 : 0;
  await db.execute(`UPDATE ${table} SET active_status = ?, updated_at = NOW() WHERE id = ?`, [activeStatus, id]);
}

// ── Branch ────────────────────────────────────────────────────────────────────

export const branchService = {
  list: (options?: ListOptions) => listActive("branch_master", "branch_name", { entityType: "branch", ...options }),
  getById: (id: string) => getById("branch_master", id),
  setStatus: (id: string, status: number) => setStatus("branch_master", id, status),
  async create(data: { branch_code: string; branch_name: string; city?: string; state?: string; address?: string; hr_contact?: string; latitude?: number | string; longitude?: number | string }) {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO branch_master (id, branch_code, branch_name, city, state, address, hr_contact, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, data.branch_code, data.branch_name, data.city ?? null, data.state ?? null, data.address ?? null, data.hr_contact ?? null, data.latitude ? Number(data.latitude) : null, data.longitude ? Number(data.longitude) : null]
    );
    return getById("branch_master", id);
  },
  async update(id: string, data: { branch_name?: string; city?: string; state?: string; address?: string; hr_contact?: string; latitude?: number | string; longitude?: number | string }) {
    await db.execute(
      "UPDATE branch_master SET branch_name = COALESCE(?, branch_name), city = COALESCE(?, city), state = COALESCE(?, state), address = COALESCE(?, address), hr_contact = COALESCE(?, hr_contact), latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude), updated_at = NOW() WHERE id = ?",
      [data.branch_name ?? null, data.city ?? null, data.state ?? null, data.address ?? null, data.hr_contact ?? null, data.latitude ? Number(data.latitude) : null, data.longitude ? Number(data.longitude) : null, id]
    );
    return getById("branch_master", id);
  },
  delete: (id: string) => softDelete("branch_master", id),

  async updateCallCentreCode(id: string, ccCode: string): Promise<void> {
    await db.execute(
      "UPDATE branch_master SET call_centre_code = ?, updated_at = NOW() WHERE id = ?",
      [ccCode, id]
    );
  },

  async getCallCentreCodeMap(): Promise<Array<{ id: string; branch_name: string; branch_code: string; call_centre_code: string | null; process_count: number; employee_count: number }>> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT b.id, b.branch_name, b.branch_code, b.call_centre_code,
              COUNT(DISTINCT p.id) AS process_count,
              COUNT(DISTINCT e.id) AS employee_count
         FROM branch_master b
         LEFT JOIN process_master p ON p.branch_id = b.id AND p.active_status = 1
         LEFT JOIN employees e ON e.branch_id = b.id AND e.active_status = 1
        WHERE b.active_status = 1
        GROUP BY b.id
        ORDER BY b.branch_name`
    );
    return rows as any[];
  },
};

// ── Department ────────────────────────────────────────────────────────────────

export const departmentService = {
  async list(options: ListOptions = {}) {
    const { q, active_status, page, limit, employeeId } = options;
    const whereClauses: string[] = [];
    const params: (string | number)[] = [];

    // Status filter
    if (active_status === "0" || active_status === 0) {
      whereClauses.push("dm.active_status = 0");
    } else if (active_status === "all") {
      // No filter
    } else {
      whereClauses.push("dm.active_status = 1"); // Default
    }

    // Search filter
    if (q && q.trim()) {
      whereClauses.push("(dm.dept_name LIKE ? OR dm.dept_code LIKE ?)");
      params.push(`%${q.trim()}%`, `%${q.trim()}%`);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    // Pagination
    let limitClause = "";
    if (limit && limit > 0) {
      const limitVal = Math.min(limit, 500);
      const offset = page && page > 1 ? (page - 1) * limitVal : 0;
      limitClause = `LIMIT ${limitVal} OFFSET ${offset}`;
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT dm.*,
              dm.dept_head_employee_id AS manager_id,
              CONCAT(head.first_name, ' ', COALESCE(head.last_name, '')) AS manager_name,
              COUNT(DISTINCT e.id) AS employee_count
         FROM department_master dm
         LEFT JOIN employees head
           ON head.id = dm.dept_head_employee_id
          AND head.active_status = 1
         LEFT JOIN employees e
           ON e.department_id = dm.id
          AND e.active_status = 1
        ${whereClause}
        GROUP BY dm.id
        ORDER BY dm.dept_name
        ${limitClause}`,
      params
    );
    const seen = new Set<string>();
    const items = rows.filter((item) => {
      const normalized = String(item.dept_name ?? "").trim().toLocaleLowerCase();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
    if (employeeId) {
      for (const item of items) {
        try {
          const result = await getEffectiveConfig(employeeId, "department", item.id, item);
          Object.assign(item, result.config);
        } catch (err) {
          console.warn(`Customization error for department ${item.id}:`, err);
        }
      }
    }
    return items;
  },
  setStatus: (id: string, status: number) => setStatus("department_master", id, status),
  getById: (id: string) => getById("department_master", id),
  async create(data: {
    dept_code?: string;
    dept_name?: string;
    name?: string;
    branch_id?: string;
    description?: string;
    manager_id?: string | null;
  }) {
    const deptName = String(data.dept_name ?? data.name ?? "").trim();
    if (!deptName) throw Object.assign(new Error("Department name is required"), { statusCode: 400 });
    const deptCode = String(data.dept_code ?? deptName)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .slice(0, 40);
    const id = randomUUID();
    try {
      await db.execute(
        `INSERT INTO department_master
           (id, dept_code, dept_name, branch_id, description, dept_head_employee_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, deptCode, deptName, data.branch_id ?? null, data.description ?? null, data.manager_id ?? null]
      );
    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY' && err.message?.includes('dept_code')) {
        throw Object.assign(new Error('A department with a similar name already exists. Please use a unique name or code.'), { statusCode: 400 });
      }
      throw err;
    }
    return getById("department_master", id);
  },
  async update(id: string, data: {
    dept_name?: string;
    name?: string;
    branch_id?: string;
    description?: string;
    manager_id?: string | null;
  }) {
    const deptName = data.dept_name ?? data.name ?? null;
    await db.execute(
      `UPDATE department_master
          SET dept_name = COALESCE(?, dept_name),
              branch_id = COALESCE(?, branch_id),
              description = COALESCE(?, description),
              dept_head_employee_id = ?,
              updated_at = NOW()
        WHERE id = ?`,
      [deptName, data.branch_id ?? null, data.description ?? null, data.manager_id ?? null, id]
    );
    return getById("department_master", id);
  },
  delete: (id: string) => softDelete("department_master", id),
};

// ── LOB ───────────────────────────────────────────────────────────────────────

export const lobService = {
  list: (options?: ListOptions) => listActive("lob_master", "lob_name", { entityType: "lob", ...options }),
  getById: (id: string) => getById("lob_master", id),
  setStatus: (id: string, status: number) => setStatus("lob_master", id, status),
  async create(data: { lob_code: string; lob_name: string }) {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO lob_master (id, lob_code, lob_name) VALUES (?, ?, ?)",
      [id, data.lob_code, data.lob_name]
    );
    return getById("lob_master", id);
  },
  async update(id: string, data: { lob_name?: string }) {
    await db.execute(
      "UPDATE lob_master SET lob_name = COALESCE(?, lob_name), updated_at = NOW() WHERE id = ?",
      [data.lob_name ?? null, id]
    );
    return getById("lob_master", id);
  },
  delete: (id: string) => softDelete("lob_master", id),
};

// ── Designation ───────────────────────────────────────────────────────────────

export const designationService = {
  list: (options?: ListOptions) => listActive("designation_master", "designation_name", { entityType: "designation", ...options }),
  getById: (id: string) => getById("designation_master", id),
  setStatus: (id: string, status: number) => setStatus("designation_master", id, status),
  async create(data: { designation_code: string; designation_name: string; grade?: string; grade_id?: string }) {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO designation_master (id, designation_code, designation_name, grade, grade_id) VALUES (?, ?, ?, ?, ?)",
      [id, data.designation_code, data.designation_name, data.grade ?? null, data.grade_id ?? null]
    );
    return getById("designation_master", id);
  },
  async update(id: string, data: { designation_name?: string; grade?: string; grade_id?: string }) {
    await db.execute(
      "UPDATE designation_master SET designation_name = COALESCE(?, designation_name), grade = COALESCE(?, grade), grade_id = COALESCE(?, grade_id), updated_at = NOW() WHERE id = ?",
      [data.designation_name ?? null, data.grade ?? null, data.grade_id ?? null, id]
    );
    return getById("designation_master", id);
  },
  delete: (id: string) => softDelete("designation_master", id),
};

// ── Campaign ─────────────────────────────────────────────────────────────────

export const campaignService = {
  list: (options?: ListOptions) => listActive("campaign_master", "campaign_name", { entityType: "campaign", ...options }),
  getById: (id: string) => getById("campaign_master", id),
  setStatus: (id: string, status: number) => setStatus("campaign_master", id, status),
  async create(data: { campaign_code: string; campaign_name: string; process_id?: string; lob_id?: string }) {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO campaign_master (id, campaign_code, campaign_name, process_id, lob_id) VALUES (?, ?, ?, ?, ?)",
      [id, data.campaign_code, data.campaign_name, data.process_id ?? null, data.lob_id ?? null]
    );
    return getById("campaign_master", id);
  },
  async update(id: string, data: { campaign_name?: string; process_id?: string; lob_id?: string }) {
    await db.execute(
      "UPDATE campaign_master SET campaign_name = COALESCE(?, campaign_name), process_id = COALESCE(?, process_id), lob_id = COALESCE(?, lob_id), updated_at = NOW() WHERE id = ?",
      [data.campaign_name ?? null, data.process_id ?? null, data.lob_id ?? null, id]
    );
    return getById("campaign_master", id);
  },
  delete: (id: string) => softDelete("campaign_master", id),
};

// ── Cost Centre ───────────────────────────────────────────────────────────────

export const costCentreService = {
  list: (options?: ListOptions) => listActive("cost_centre_master", "cost_centre_code", { entityType: "cost_centre", ...options }),
  getById: (id: string) => getById("cost_centre_master", id),
  setStatus: (id: string, status: number) => setStatus("cost_centre_master", id, status),
  async create(data: { cost_centre_code: string; cost_centre_name: string; branch_id?: string; department_id?: string }) {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO cost_centre_master (id, cost_centre_code, cost_centre_name, branch_id, department_id) VALUES (?, ?, ?, ?, ?)",
      [id, data.cost_centre_code, data.cost_centre_name, data.branch_id ?? null, data.department_id ?? null]
    );
    return getById("cost_centre_master", id);
  },
  async update(id: string, data: { cost_centre_name?: string; branch_id?: string; department_id?: string }) {
    await db.execute(
      "UPDATE cost_centre_master SET cost_centre_name = COALESCE(?, cost_centre_name), branch_id = COALESCE(?, branch_id), department_id = COALESCE(?, department_id), updated_at = NOW() WHERE id = ?",
      [data.cost_centre_name ?? null, data.branch_id ?? null, data.department_id ?? null, id]
    );
    return getById("cost_centre_master", id);
  },
  delete: (id: string) => softDelete("cost_centre_master", id),
};

// ── Grade / Band ──────────────────────────────────────────────────────────────

export const gradeBandService = {
  list: (options?: ListOptions) => listActive("grade_band_master", "grade_name", { entityType: "grade_band", ...options }),
  getById: (id: string) => getById("grade_band_master", id),
  setStatus: (id: string, status: number) => setStatus("grade_band_master", id, status),
  async create(data: { grade_code: string; grade_name: string; band?: string; min_ctc?: number; max_ctc?: number }) {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO grade_band_master (id, grade_code, grade_name, band, min_ctc, max_ctc) VALUES (?, ?, ?, ?, ?, ?)",
      [id, data.grade_code, data.grade_name, data.band ?? null, data.min_ctc ?? null, data.max_ctc ?? null]
    );
    return getById("grade_band_master", id);
  },
  async update(id: string, data: { grade_name?: string; band?: string; min_ctc?: number; max_ctc?: number }) {
    await db.execute(
      "UPDATE grade_band_master SET grade_name = COALESCE(?, grade_name), band = COALESCE(?, band), min_ctc = COALESCE(?, min_ctc), max_ctc = COALESCE(?, max_ctc), updated_at = NOW() WHERE id = ?",
      [data.grade_name ?? null, data.band ?? null, data.min_ctc ?? null, data.max_ctc ?? null, id]
    );
    return getById("grade_band_master", id);
  },
  delete: (id: string) => softDelete("grade_band_master", id),
};

// ── Location ──────────────────────────────────────────────────────────────────

export const locationService = {
  list: (options?: ListOptions) => listActive("location_master", "location_name", { entityType: "location", ...options }),
  getById: (id: string) => getById("location_master", id),
  setStatus: (id: string, status: number) => setStatus("location_master", id, status),
  async create(data: Record<string, unknown>) {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO location_master (id, location_name, location_code, address, city, state, pincode, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, data.location_name, data.location_code ?? null, data.address ?? null, data.city ?? null, data.state ?? null, data.pincode ?? null, data.branch_id ?? null]
    );
    return getById("location_master", id);
  },
  async update(id: string, data: Record<string, unknown>) {
    await db.execute(
      "UPDATE location_master SET location_name = COALESCE(?, location_name), city = COALESCE(?, city), state = COALESCE(?, state), updated_at = NOW() WHERE id = ?",
      [data.location_name ?? null, data.city ?? null, data.state ?? null, id]
    );
    return getById("location_master", id);
  },
  delete: (id: string) => softDelete("location_master", id),
};

// ── Policy ────────────────────────────────────────────────────────────────────

export const policyService = {
  list: (options?: ListOptions) => listActive("policy_master", "policy_name", { entityType: "policy", ...options }),
  getById: (id: string) => getById("policy_master", id),
  setStatus: (id: string, status: number) => setStatus("policy_master", id, status),
  async create(data: Record<string, unknown>) {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO policy_master (id, policy_name, policy_code, description, effective_date, version) VALUES (?, ?, ?, ?, ?, ?)",
      [id, data.policy_name, data.policy_code ?? null, data.description ?? null, data.effective_date ?? null, data.version ?? null]
    );
    return getById("policy_master", id);
  },
  async update(id: string, data: Record<string, unknown>) {
    await db.execute(
      "UPDATE policy_master SET policy_name = COALESCE(?, policy_name), policy_code = COALESCE(?, policy_code), description = COALESCE(?, description), effective_date = COALESCE(?, effective_date), version = COALESCE(?, version), updated_at = NOW() WHERE id = ?",
      [data.policy_name ?? null, data.policy_code ?? null, data.description ?? null, data.effective_date ?? null, data.version ?? null, id]
    );
    return getById("policy_master", id);
  },
  delete: (id: string) => softDelete("policy_master", id),
};

// ── Process ───────────────────────────────────────────────────────────────────

export const processService = {
  list: (options?: ListOptions) => listActive("process_master", "process_name", { entityType: "process", ...options }),
  getById: (id: string) => getById("process_master", id),
  setStatus: (id: string, status: number) => setStatus("process_master", id, status),
  async create(data: { process_code: string; process_name: string; branch_id?: string; department_id?: string; business_lob?: string }) {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO process_master (id, process_code, process_name, branch_id, department_id, business_lob) VALUES (?, ?, ?, ?, ?, ?)",
      [id, data.process_code, data.process_name, data.branch_id ?? null, data.department_id ?? null, data.business_lob ?? null]
    );
    return getById("process_master", id);
  },
  async update(id: string, data: { process_name?: string; branch_id?: string; department_id?: string; business_lob?: string }) {
    await db.execute(
      "UPDATE process_master SET process_name = COALESCE(?, process_name), branch_id = COALESCE(?, branch_id), department_id = COALESCE(?, department_id), business_lob = COALESCE(?, business_lob), updated_at = NOW() WHERE id = ?",
      [data.process_name ?? null, data.branch_id ?? null, data.department_id ?? null, data.business_lob ?? null, id]
    );
    return getById("process_master", id);
  },
  delete: (id: string) => softDelete("process_master", id),
};
