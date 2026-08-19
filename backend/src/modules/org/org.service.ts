import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { getEffectiveConfig } from "../customization/customization-engine.js";

import { blankToNull } from "../../shared/sql-values.js";
import { syncCostCentreRelatedTables } from "../../shared/cost-centre-sync.js";
import { clearBranchLetterheadCache } from "./branchAddress.service.js";
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
  branch_id?: string;
  client_id?: string;
  lob_id?: string;
  process_id?: string;
  /**
   * Several master tables (branch_master above all — see 1115_reactivate_operational_branches.sql
   * and the job-requisition/statutory-executor/ceo-overview findings) hold live rows that share
   * the same name but are NOT duplicates: distinct physical locations, some with real employees
   * linked, some blank. The default name-based dedup below picks one survivor per name and hides
   * the rest, so an admin editing "the branch" from the deduped list can silently update a row no
   * employee is actually linked to, while the employee's real row never changes. Passing this flag
   * returns every row untouched so an admin UI can show and edit them individually. Nothing sends
   * this flag today except the Org Masters Branches tab — every other consumer (dropdowns,
   * filter-options, exports) is unaffected and keeps seeing the deduped list.
   */
  includeDuplicates?: boolean;
}

// Tables that actually carry a branch_id column — listActive() is generic across every
// whitelisted master table, and most of them (lob/designation/campaign/grade_band/policy/
// branch itself) have no such column. Applying the filter outside this set would 500 on an
// unknown-column error the moment a caller passed branch_id for one of those tabs.
const TABLES_WITH_BRANCH_ID = new Set([
  "department_master",
  "cost_centre_master",
  "process_master",
  "location_master",
]);

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

  // Branch filter — only for tables that have the column (see TABLES_WITH_BRANCH_ID above).
  // Silently ignored for tables that don't, rather than erroring: a tab with no branch
  // concept (LOBs, Designations, ...) simply never sends this param.
  if (options.branch_id && TABLES_WITH_BRANCH_ID.has(table)) {
    whereClauses.push("branch_id = ?");
    params.push(options.branch_id);
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

  let items: RowDataPacket[];
  if (options.includeDuplicates) {
    items = rows as RowDataPacket[];
  } else {
    const seen = new Set<string>();
    items = (rows as RowDataPacket[]).filter((item) => {
      if (!nameCol) return true;
      const normalized = String(item[nameCol] ?? "").trim().toLocaleLowerCase();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

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

async function setStatus(table: string, id: string, status: number, actor?: OrgActor): Promise<void> {
  assertMasterTable(table);
  const activeStatus = status === 1 ? 1 : 0;
  const before = table === "cost_centre_master" ? await getById(table, id) : null;
  // Reactivating a cost centre only flipped active_status, leaving behind whatever close_date
  // it carried from when it was actually closed. branch-budget-allocation.service.ts's
  // listActiveCostCentres additionally requires close_date IS NULL OR close_date > CURDATE(),
  // so a cost centre reactivated through this endpoint stayed permanently invisible to budget
  // allocation despite reading "active" everywhere else in the app. Clearing close_date on
  // reactivation only (never on deactivation, which should keep its historical close date)
  // makes the two flags agree again.
  if (table === "cost_centre_master" && activeStatus === 1) {
    await db.execute(
      `UPDATE ${table} SET active_status = ?, close_date = NULL, updated_at = NOW() WHERE id = ?`,
      [activeStatus, id]
    );
    await logCostCentreChange(id, "org_master_status", before, await getById(table, id), actor);
    return;
  }
  await db.execute(`UPDATE ${table} SET active_status = ?, updated_at = NOW() WHERE id = ?`, [activeStatus, id]);
  if (table === "cost_centre_master") {
    await logCostCentreChange(id, "org_master_status", before, await getById(table, id), actor);
  }
}

// ── Branch ────────────────────────────────────────────────────────────────────

export const branchService = {
  async list(options?: ListOptions) {
    const items = await listActive("branch_master", "branch_name", { entityType: "branch", ...options });
    // Only when the caller explicitly asked to see duplicate-named rows (see includeDuplicates
    // doc on ListOptions): attach how many employees are actually linked to each row, so an
    // admin picking among same-named branches can tell which one is the real, in-use row rather
    // than an empty twin. Skipped for the default dropdown/list path — cheap there, but no
    // consumer needs it and it shouldn't change the shape of the common case.
    if (options?.includeDuplicates && items.length > 0) {
      const [counts] = await db.execute<RowDataPacket[]>(
        `SELECT branch_id, COUNT(*) AS employee_count FROM employees WHERE branch_id IS NOT NULL GROUP BY branch_id`
      );
      const countMap = new Map<string, number>((counts as RowDataPacket[]).map((r) => [String(r.branch_id), Number(r.employee_count)]));
      for (const item of items) {
        (item as RowDataPacket).employee_count = countMap.get(String(item.id)) ?? 0;
      }
    }
    return items;
  },
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
    // branchAddress.service.ts caches resolved letterhead (incl. hr_contact) per branch id for
    // the life of the process and is never otherwise invalidated — without this, offer/appointment
    // letters and digital form-fill keep printing the pre-edit HR contact/address until a restart.
    clearBranchLetterheadCache();
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
    // The cap silently truncated. 439 of 928 cost centres are active today against a limit of
    // 500, so the callers that ask for limit=500 fit — with 61 rows of headroom. One bulk
    // reactivation crosses that line, and because the rows come back ORDER BY cost_centre_code
    // and are then filtered by branch in the browser, the branches whose codes sort last would
    // lose their cost centres from the picker entirely, with no error and no empty state. One
    // extra row is fetched purely to detect the edge and report it; it is never returned.
    let limitClause = "";
    let limitVal: number | null = null;
    if (limit && limit > 0) {
      limitVal = Math.min(limit, 500);
      const offset = page && page > 1 ? (page - 1) * limitVal : 0;
      limitClause = `LIMIT ${limitVal + 1} OFFSET ${offset}`;
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

/** Who performed an Org Masters write. Optional so existing callers keep compiling; when it is
 *  absent nothing is logged, which is the pre-existing behaviour rather than a silent fake actor. */
export interface OrgActor { id: string; role: string }

/**
 * Record a cost-centre change in cost_centre_approval_log.
 *
 * That table already existed, and finance/cost-centre-management.service.ts writes to it — but the
 * Org Masters CRUD path (which is what the Cost Centres tab actually calls) never did, so the table
 * held ZERO rows. The practical cost of that showed up on 2026-08-19: four cost centres had their
 * cost_centre_name overwritten with their own code and their branch re-pointed, and there was no
 * record anywhere of who did it or from which screen. This closes that hole for the fields worth
 * reconstructing later.
 *
 * Deliberately best-effort: a failure to write the audit row must not fail the user's edit, which
 * has already been committed by the time we get here. The error is logged instead of thrown.
 */
async function logCostCentreChange(
  costCentreId: string,
  action: string,
  before: RowDataPacket | null,
  after: RowDataPacket | null,
  actor?: OrgActor
): Promise<void> {
  if (!actor?.id) return;
  const WATCHED = ["cost_centre_code", "cost_centre_name", "branch_id", "client_id", "lob_id",
                   "process_id", "department_id", "active_status", "close_date", "go_live_date"];
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of WATCHED) {
    const from = before?.[key] ?? null;
    const to = after?.[key] ?? null;
    if (String(from ?? "") !== String(to ?? "")) changes[key] = { from, to };
  }
  if (Object.keys(changes).length === 0) return;
  const status = String(after?.status ?? before?.status ?? "n/a");
  try {
    await db.execute(
      `INSERT INTO cost_centre_approval_log
         (id, cost_centre_id, action, from_status, to_status, actor_user_id, actor_role, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), costCentreId, action, status, status, actor.id, actor.role || "unknown",
       JSON.stringify(changes)]
    );
  } catch (error) {
    console.warn(`cost_centre_approval_log write failed for ${costCentreId}:`, error);
  }
}

// ── Cost Centre ───────────────────────────────────────────────────────────────

export const costCentreService = {
  async list(options: ListOptions = {}) {
    const { q, active_status, page, limit, employeeId, branch_id, client_id, lob_id, process_id } = options;
    const whereClauses: string[] = [];
    const params: (string | number)[] = [];

    // Status filter
    if (active_status === "0" || active_status === 0) {
      whereClauses.push("cc.active_status = 0");
    } else if (active_status === "all") {
      // No filter
    } else {
      whereClauses.push("cc.active_status = 1"); // Default
    }

    // Search filter
    if (q && q.trim()) {
      whereClauses.push("(cc.cost_centre_name LIKE ? OR cc.cost_centre_code LIKE ? OR cl.client_name LIKE ? OR p.process_name LIKE ?)");
      params.push(`%${q.trim()}%`, `%${q.trim()}%`, `%${q.trim()}%`, `%${q.trim()}%`);
    }

    // Relationship filters — same axes the Add/Edit form already requires (client, LOB,
    // branch, process), now usable to narrow the list too.
    if (branch_id)  { whereClauses.push("cc.branch_id = ?");  params.push(branch_id); }
    if (client_id)  { whereClauses.push("cc.client_id = ?");  params.push(client_id); }
    if (lob_id)     { whereClauses.push("cc.lob_id = ?");     params.push(lob_id); }
    if (process_id) { whereClauses.push("cc.process_id = ?"); params.push(process_id); }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    // Pagination
    let limitClause = "";
    let limitVal: number | null = null;
    if (limit && limit > 0) {
      limitVal = Math.min(limit, 500);
      const offset = page && page > 1 ? (page - 1) * limitVal : 0;
      limitClause = `LIMIT ${limitVal} OFFSET ${offset}`;
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cc.*,
              COALESCE(cl.client_name, cc.client_name) AS client_name,
              cl.client_code,
              l.lob_name,
              l.lob_code,
              b.branch_name,
              b.branch_code,
              p.process_name,
              p.process_code,
              CASE
                WHEN cc.client_id IS NULL OR cc.lob_id IS NULL OR cc.branch_id IS NULL OR cc.process_id IS NULL
                THEN 1 ELSE 0
              END AS needs_migration
         FROM cost_centre_master cc
         LEFT JOIN client_master cl ON cl.id = cc.client_id
         LEFT JOIN lob_master l ON l.id = cc.lob_id
         LEFT JOIN branch_master b ON b.id = cc.branch_id
         LEFT JOIN process_master p ON p.id = cc.process_id
        ${whereClause}
        ORDER BY cc.cost_centre_code
        ${limitClause}`,
      params
    );

    // Drop the probe row and record that more exist, so the caller can say so instead of
    // presenting a short list as if it were complete.
    let truncated = false;
    if (limitVal !== null && rows.length > limitVal) {
      truncated = true;
      rows.length = limitVal;
    }

    if (employeeId) {
      for (const item of rows) {
        try {
          const result = await getEffectiveConfig(employeeId, "cost_centre", item.id, item);
          Object.assign(item, result.config);
        } catch (err) {
          console.warn(`Customization error for cost_centre ${item.id}:`, err);
        }
      }
    }
    if (truncated) {
      console.warn(
        `costCentreService.list truncated at ${limitVal} rows — the caller is seeing a partial `
        + `cost-centre list. Raise the limit or paginate.`
      );
    }
    return Object.assign(rows, { truncated });
  },

  getById: (id: string) => getById("cost_centre_master", id),
  setStatus: (id: string, status: number, actor?: OrgActor) => setStatus("cost_centre_master", id, status, actor),

  async countOrphanedRecords(): Promise<{ total: number; orphaned: number }> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN client_id IS NULL OR lob_id IS NULL OR branch_id IS NULL OR process_id IS NULL THEN 1 ELSE 0 END) AS orphaned
       FROM cost_centre_master
       WHERE active_status = 1`
    );
    const row = rows[0] ?? { total: 0, orphaned: 0 };
    return { total: Number(row.total), orphaned: Number(row.orphaned) };
  },

  async create(data: {
    cost_centre_code: string;
    cost_centre_name: string;
    client_id: string;
    lob_id: string;
    branch_id: string;
    process_id: string;
    department_id?: string;
  }) {
    // Check for orphaned records - block creation until all are migrated
    const { orphaned } = await this.countOrphanedRecords();
    if (orphaned > 0) {
      throw Object.assign(
        new Error(`Cannot create new cost centre: ${orphaned} existing cost centre(s) need migration. Please assign Client, LOB, Branch, and Process to all existing cost centres first.`),
        { statusCode: 400 }
      );
    }

    // Validate all required fields
    if (!data.client_id?.trim()) {
      throw Object.assign(new Error("Client is required for cost centre"), { statusCode: 400 });
    }
    if (!data.lob_id?.trim()) {
      throw Object.assign(new Error("LOB is required for cost centre"), { statusCode: 400 });
    }
    if (!data.branch_id?.trim()) {
      throw Object.assign(new Error("Branch is required for cost centre"), { statusCode: 400 });
    }
    if (!data.process_id?.trim()) {
      throw Object.assign(new Error("Process is required for cost centre"), { statusCode: 400 });
    }

    const id = randomUUID();
    await db.execute(
      `INSERT INTO cost_centre_master
         (id, cost_centre_code, cost_centre_name, client_id, lob_id, branch_id, process_id, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.cost_centre_code,
        data.cost_centre_name,
        data.client_id.trim(),
        data.lob_id.trim(),
        data.branch_id.trim(),
        data.process_id.trim(),
        data.department_id?.trim() || null,
      ]
    );
    await syncCostCentreRelatedTables({
      cost_centre_code: data.cost_centre_code,
      cost_centre_name: data.cost_centre_name,
      branch_id: data.branch_id.trim(),
      client_id: data.client_id.trim(),
      process_id: data.process_id.trim(),
    });
    return getById("cost_centre_master", id);
  },

  async update(id: string, data: {
    cost_centre_name?: string;
    client_id?: string;
    lob_id?: string;
    branch_id?: string;
    process_id?: string;
    department_id?: string;
  }, actor?: OrgActor) {
    // Snapshot before the write so the audit row can record what actually changed. This is the
    // path that silently renamed four cost centres on 2026-08-19 with no trace of who or where.
    const before = await getById("cost_centre_master", id);
    await db.execute(
      `UPDATE cost_centre_master SET
         cost_centre_name = COALESCE(?, cost_centre_name),
         client_id = COALESCE(NULLIF(?, ''), client_id),
         lob_id = COALESCE(NULLIF(?, ''), lob_id),
         branch_id = COALESCE(NULLIF(?, ''), branch_id),
         process_id = COALESCE(NULLIF(?, ''), process_id),
         department_id = COALESCE(NULLIF(?, ''), department_id),
         updated_at = NOW()
       WHERE id = ?`,
      [
        data.cost_centre_name ?? null,
        data.client_id ?? null,
        data.lob_id ?? null,
        data.branch_id ?? null,
        data.process_id ?? null,
        data.department_id ?? null,
        id,
      ]
    );
    const after = await getById("cost_centre_master", id);
    await logCostCentreChange(id, "org_master_update", before, after, actor);
    return after;
  },

  async migrate(id: string, data: {
    client_id: string;
    lob_id: string;
    branch_id: string;
    process_id: string;
  }) {
    // Validate all required fields for migration
    if (!data.client_id?.trim()) {
      throw Object.assign(new Error("Client is required"), { statusCode: 400 });
    }
    if (!data.lob_id?.trim()) {
      throw Object.assign(new Error("LOB is required"), { statusCode: 400 });
    }
    if (!data.branch_id?.trim()) {
      throw Object.assign(new Error("Branch is required"), { statusCode: 400 });
    }
    if (!data.process_id?.trim()) {
      throw Object.assign(new Error("Process is required"), { statusCode: 400 });
    }

    await db.execute(
      `UPDATE cost_centre_master SET
         client_id = ?,
         lob_id = ?,
         branch_id = ?,
         process_id = ?,
         updated_at = NOW()
       WHERE id = ?`,
      [
        data.client_id.trim(),
        data.lob_id.trim(),
        data.branch_id.trim(),
        data.process_id.trim(),
        id,
      ]
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
      // effective_date is a DATE column behind COALESCE; "" aborts the policy
      // update with ER_TRUNCATED_WRONG_VALUE instead of leaving the date alone.
      [blankToNull(data.policy_name), blankToNull(data.policy_code), blankToNull(data.description), blankToNull(data.effective_date), blankToNull(data.version), id]
    );
    return getById("policy_master", id);
  },
  delete: (id: string) => softDelete("policy_master", id),
};

// ── Process ───────────────────────────────────────────────────────────────────

export const processService = {
  async list(options: ListOptions = {}) {
    const { q, active_status, page, limit, employeeId } = options;
    const whereClauses: string[] = [];
    const params: (string | number)[] = [];

    // Status filter
    if (active_status === "0" || active_status === 0) {
      whereClauses.push("pm.active_status = 0");
    } else if (active_status === "all") {
      // No filter
    } else {
      whereClauses.push("pm.active_status = 1"); // Default
    }

    // Search filter
    if (q && q.trim()) {
      whereClauses.push("(pm.process_name LIKE ? OR pm.process_code LIKE ? OR cl.client_name LIKE ? OR bm.branch_name LIKE ?)");
      params.push(`%${q.trim()}%`, `%${q.trim()}%`, `%${q.trim()}%`, `%${q.trim()}%`);
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
      `SELECT pm.*,
              bm.branch_name,
              bm.branch_code,
              cl.client_name AS client_name_joined,
              cl.client_code,
              -- Cost centre codes mapped to this process (Req 18). Derived on read from
              -- cost_centre_master.process_id, which is the ONLY real link: client_id is empty
              -- on all 927 cost centres, so there is nothing else to derive from. The
              -- correlated subquery beats a JOIN + GROUP BY here because pm.* is selected
              -- whole and grouping it would mean naming all 78 columns.
              (SELECT GROUP_CONCAT(cc.cost_centre_code ORDER BY cc.cost_centre_code SEPARATOR ',')
                 FROM cost_centre_master cc
                WHERE cc.process_id = pm.id AND cc.active_status = 1) AS cost_centre_codes
         FROM process_master pm
         LEFT JOIN branch_master bm ON bm.id = pm.branch_id
         LEFT JOIN client_master cl ON cl.id = pm.client_id
        ${whereClause}
        ORDER BY pm.process_name
        ${limitClause}`,
      params
    );

    // Map client_name: prefer joined FK value, fall back to legacy text field
    for (const row of rows) {
      (row as any).client_name = (row as any).client_name_joined ?? (row as any).client_name ?? null;
    }

    if (employeeId) {
      for (const row of rows) {
        try {
          const result = await getEffectiveConfig(employeeId, "process", row.id, row);
          Object.assign(row, result.config);
        } catch (err) {
          console.warn(`Customization error for process ${row.id}:`, err);
        }
      }
    }
    return rows;
  },

  getById: (id: string) => getById("process_master", id),
  setStatus: (id: string, status: number) => setStatus("process_master", id, status),

  async create(data: {
    process_code: string;
    process_name: string;
    branch_id?: string;
    department_id?: string;
    business_lob?: string;
    client_id?: string;
    client_name?: string;
    workload_type?: string;
  }) {
    const id = randomUUID();
    await db.execute(
      // process_master has no department_id and never has: a process is scoped by
      // branch and client, and it is employees that carry a department. That one
      // column made every process create from the Org Masters page a 500. The UI
      // does not collect a department for a process either, so the field was only
      // ever passed through as null.
      `INSERT INTO process_master
         (id, process_code, process_name, branch_id, business_lob, client_id, client_name, workload_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.process_code,
        data.process_name,
        data.branch_id?.trim() || null,
        data.business_lob?.trim() || null,
        data.client_id?.trim() || null,
        data.client_name?.trim() || null, // Keep for backward compatibility
        data.workload_type?.trim() || null,
      ]
    );
    return getById("process_master", id);
  },

  async update(id: string, data: {
    process_name?: string;
    branch_id?: string;
    department_id?: string;
    business_lob?: string;
    client_id?: string;
    client_name?: string;
    workload_type?: string;
  }) {
    await db.execute(
      // department_id dropped here for the same reason as the insert above
      `UPDATE process_master SET
        process_name  = COALESCE(?, process_name),
        branch_id     = COALESCE(NULLIF(?, ''), branch_id),
        business_lob  = COALESCE(NULLIF(?, ''), business_lob),
        client_id     = COALESCE(NULLIF(?, ''), client_id),
        client_name   = COALESCE(NULLIF(?, ''), client_name),
        workload_type = COALESCE(NULLIF(?, ''), workload_type),
        updated_at    = NOW()
       WHERE id = ?`,
      [
        data.process_name?.trim() || null,
        data.branch_id?.trim() ?? null,
        data.business_lob?.trim() ?? null,
        data.client_id?.trim() ?? null,
        data.client_name?.trim() ?? null,
        data.workload_type?.trim() ?? null,
        id,
      ]
    );
    return getById("process_master", id);
  },

  delete: (id: string) => softDelete("process_master", id),
};
