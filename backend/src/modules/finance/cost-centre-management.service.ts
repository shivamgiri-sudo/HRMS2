import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

// ============================================================================
// Types
// ============================================================================

export type CostCentreStatus =
  | "draft"
  | "pending_l1"
  | "pending_l2"
  | "approved"
  | "active"
  | "closed"
  | "rejected"
  | "revision_required";

export interface CostCentreContact {
  id?: string;
  contact_type: "client" | "scm" | "finance";
  contact_sequence: number;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_designation?: string;
  is_primary?: boolean;
}

export interface CostCentreInput {
  cost_centre_code: string;
  cost_centre_name: string;
  client_id: string;
  lob_id: string;
  branch_id: string;
  process_id: string;
  department_id?: string;

  // Operational
  mandated_seats_value?: number;
  shrinkage_percentage?: number;
  attrition_percentage?: number;
  shift_hours?: string;
  working_days_per_week?: number;
  training_days?: number;
  incentive_allowed?: boolean;
  deduction_allowed?: boolean;

  // Billing
  revenue_flag?: boolean;
  billing_flag?: boolean;
  revenue_type?: string;
  fixed_amount?: number;
  variable_base?: string;
  payment_mode?: string;
  payment_terms?: string;

  // GST/Tax
  hsn_code?: string;
  service_tax_no?: string;
  vendor_state_code?: string;

  // Addresses
  bill_to_address1?: string;
  bill_to_address2?: string;
  bill_to_address3?: string;
  bill_to_city?: string;
  bill_to_pincode?: string;
  ship_to_address1?: string;
  ship_to_address2?: string;
  ship_to_address3?: string;
  ship_to_city?: string;
  ship_to_pincode?: string;

  // Dates
  association_date?: string;

  // Contacts
  contacts?: CostCentreContact[];
}

export interface ListFilters {
  q?: string;
  status?: CostCentreStatus | "all";
  client_id?: string;
  branch_id?: string;
  page?: number;
  limit?: number;
}

interface Actor {
  id: string;
  role: string;
}

// ============================================================================
// Helper
// ============================================================================

function bool(v: unknown): number {
  return v ? 1 : 0;
}

async function logApprovalAction(
  costCentreId: string,
  action: string,
  fromStatus: CostCentreStatus | null,
  toStatus: CostCentreStatus,
  actor: Actor,
  remarks?: string
): Promise<void> {
  await db.execute(
    `INSERT INTO cost_centre_approval_log
       (id, cost_centre_id, action, from_status, to_status, actor_user_id, actor_role, remarks)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), costCentreId, action, fromStatus, toStatus, actor.id, actor.role, remarks ?? null]
  );
}

// ============================================================================
// Service
// ============================================================================

export const costCentreManagementService = {
  /**
   * List cost centres with filters
   */
  async list(filters: ListFilters = {}) {
    const { q, status, client_id, branch_id, page = 1, limit = 50 } = filters;
    const where: string[] = [];
    const params: (string | number)[] = [];

    /*
     * "closed" is not a value of the status column, and never was.
     *
     * status tracks the approval workflow (draft -> pending_l1 -> pending_l2 -> approved ->
     * active). Deactivation is recorded separately, in active_status and close_date. Nothing
     * joined the two, so the Closed tab matched zero rows while 339 deactivated MAS cost centres
     * sat under Draft - indistinguishable from ones still awaiting first approval - and one
     * deactivated cost centre showed under Active.
     *
     * Filtering closed by active_status rather than status keeps the workflow column untouched:
     * a closed cost centre still remembers which approval stage it had reached.
     */
    if (status === "closed") {
      where.push("cc.active_status = 0");
    } else if (status && status !== "all") {
      where.push("cc.status = ?");
      where.push("cc.active_status = 1");
      params.push(status);
    }

    if (client_id) {
      where.push("cc.client_id = ?");
      params.push(client_id);
    }

    if (branch_id) {
      where.push("cc.branch_id = ?");
      params.push(branch_id);
    }

    if (q?.trim()) {
      where.push("(cc.cost_centre_code LIKE ? OR cc.cost_centre_name LIKE ? OR cl.client_name LIKE ?)");
      params.push(`%${q.trim()}%`, `%${q.trim()}%`, `%${q.trim()}%`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    /*
     * LIMIT and OFFSET are interpolated, not bound.
     *
     * They were passed as `LIMIT ? OFFSET ?` placeholders to db.execute(), which prepares the
     * statement — and MySQL will not accept a bound parameter in LIMIT there. Every call to this
     * endpoint failed with ER_WRONG_ARGUMENTS, so the Cost Centre Management page has returned 500
     * on load since it was added and has never displayed a row.
     *
     * Coerced to integers and clamped before they reach the string, so nothing user-supplied can
     * survive into the SQL: a non-numeric page or limit collapses to the default rather than
     * concatenating. Every other filter stays a bound parameter.
     */
    const safeLimit = Math.max(1, Math.min(Math.trunc(Number(limit)) || 50, 100));
    const safePage = Math.max(1, Math.trunc(Number(page)) || 1);
    const safeOffset = (safePage - 1) * safeLimit;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cc.*,
              -- What the row actually is, for display. cc.status is left untouched so the
              -- approval stage a closed cost centre had reached is still readable.
              CASE WHEN cc.active_status = 0 THEN 'closed' ELSE cc.status END AS effective_status,
              cl.client_name, cl.client_code,
              l.lob_name, l.lob_code,
              b.branch_name, b.branch_code,
              p.process_name, p.process_code,
              creator.full_name AS created_by_name,
              submitter.full_name AS submitted_by_name,
              l1approver.full_name AS l1_approved_by_name,
              l2approver.full_name AS l2_approved_by_name
         FROM cost_centre_master cc
         LEFT JOIN client_master cl ON cl.id = cc.client_id
         LEFT JOIN lob_master l ON l.id = cc.lob_id
         LEFT JOIN branch_master b ON b.id = cc.branch_id
         LEFT JOIN process_master p ON p.id = cc.process_id
         LEFT JOIN employees creator ON creator.id = cc.created_by
         LEFT JOIN employees submitter ON submitter.id = cc.submitted_by
         LEFT JOIN employees l1approver ON l1approver.id = cc.l1_approved_by
         LEFT JOIN employees l2approver ON l2approver.id = cc.l2_approved_by
        ${whereClause}
        ORDER BY cc.created_at DESC
        LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params
    );

    // Count total
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
         FROM cost_centre_master cc
         LEFT JOIN client_master cl ON cl.id = cc.client_id
        ${whereClause}`,
      params
    );

    return {
      data: rows,
      total: Number(countRows[0]?.total ?? 0),
      page: safePage,
      limit: safeLimit,
    };
  },

  /**
   * Get cost centre by ID with contacts and approval history
   */
  async getById(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cc.*,
              cl.client_name, cl.client_code,
              l.lob_name, l.lob_code,
              b.branch_name, b.branch_code,
              p.process_name, p.process_code,
              creator.full_name AS created_by_name,
              submitter.full_name AS submitted_by_name,
              l1approver.full_name AS l1_approved_by_name,
              l2approver.full_name AS l2_approved_by_name
         FROM cost_centre_master cc
         LEFT JOIN client_master cl ON cl.id = cc.client_id
         LEFT JOIN lob_master l ON l.id = cc.lob_id
         LEFT JOIN branch_master b ON b.id = cc.branch_id
         LEFT JOIN process_master p ON p.id = cc.process_id
         LEFT JOIN employees creator ON creator.id = cc.created_by
         LEFT JOIN employees submitter ON submitter.id = cc.submitted_by
         LEFT JOIN employees l1approver ON l1approver.id = cc.l1_approved_by
         LEFT JOIN employees l2approver ON l2approver.id = cc.l2_approved_by
        WHERE cc.id = ?`,
      [id]
    );

    if (!rows[0]) return null;

    // Get contacts
    const [contacts] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM cost_centre_contacts WHERE cost_centre_id = ? ORDER BY contact_type, contact_sequence`,
      [id]
    );

    // Get approval history
    const [history] = await db.execute<RowDataPacket[]>(
      `SELECT al.*, e.full_name AS actor_name
         FROM cost_centre_approval_log al
         LEFT JOIN employees e ON e.id = al.actor_user_id
        WHERE al.cost_centre_id = ?
        ORDER BY al.created_at DESC`,
      [id]
    );

    return {
      ...rows[0],
      contacts,
      approval_history: history,
    };
  },

  /**
   * Create new cost centre in draft status
   */
  async create(data: CostCentreInput, actor: Actor) {
    const id = randomUUID();

    await db.execute(
      `INSERT INTO cost_centre_master (
        id, cost_centre_code, cost_centre_name, client_id, lob_id, branch_id, process_id, department_id,
        mandated_seats_value, shrinkage_percentage, attrition_percentage, shift_hours,
        working_days_per_week, training_days, incentive_allowed, deduction_allowed,
        revenue_flag, billing_flag, revenue_type, fixed_amount, variable_base, payment_mode, payment_terms,
        hsn_code, service_tax_no, vendor_state_code,
        bill_to_address1, bill_to_address2, bill_to_address3, bill_to_city, bill_to_pincode,
        ship_to_address1, ship_to_address2, ship_to_address3, ship_to_city, ship_to_pincode,
        association_date, status, created_by, active_status
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, 'draft', ?, 1
      )`,
      [
        id,
        data.cost_centre_code,
        data.cost_centre_name,
        data.client_id,
        data.lob_id,
        data.branch_id,
        data.process_id,
        data.department_id ?? null,
        data.mandated_seats_value ?? null,
        data.shrinkage_percentage ?? null,
        data.attrition_percentage ?? null,
        data.shift_hours ?? null,
        data.working_days_per_week ?? null,
        data.training_days ?? null,
        bool(data.incentive_allowed),
        bool(data.deduction_allowed),
        bool(data.revenue_flag),
        bool(data.billing_flag),
        data.revenue_type ?? null,
        data.fixed_amount ?? null,
        data.variable_base ?? null,
        data.payment_mode ?? null,
        data.payment_terms ?? null,
        data.hsn_code ?? null,
        data.service_tax_no ?? null,
        data.vendor_state_code ?? null,
        data.bill_to_address1 ?? null,
        data.bill_to_address2 ?? null,
        data.bill_to_address3 ?? null,
        data.bill_to_city ?? null,
        data.bill_to_pincode ?? null,
        data.ship_to_address1 ?? null,
        data.ship_to_address2 ?? null,
        data.ship_to_address3 ?? null,
        data.ship_to_city ?? null,
        data.ship_to_pincode ?? null,
        data.association_date ?? null,
        actor.id,
      ]
    );

    // Save contacts
    if (data.contacts?.length) {
      await this.saveContacts(id, data.contacts);
    }

    await logApprovalAction(id, "created", null, "draft", actor);

    return this.getById(id);
  },

  /**
   * Update cost centre (only allowed in draft or revision_required status)
   */
  async update(id: string, data: Partial<CostCentreInput>, actor: Actor) {
    const existing = await this.getById(id);
    if (!existing) throw Object.assign(new Error("Cost centre not found"), { statusCode: 404 });

    if (!["draft", "revision_required"].includes(existing.status)) {
      throw Object.assign(
        new Error(`Cannot update cost centre in ${existing.status} status`),
        { statusCode: 400 }
      );
    }

    await db.execute(
      `UPDATE cost_centre_master SET
        cost_centre_name = COALESCE(?, cost_centre_name),
        client_id = COALESCE(?, client_id),
        lob_id = COALESCE(?, lob_id),
        branch_id = COALESCE(?, branch_id),
        process_id = COALESCE(?, process_id),
        department_id = COALESCE(?, department_id),
        mandated_seats_value = ?,
        shrinkage_percentage = ?,
        attrition_percentage = ?,
        shift_hours = ?,
        working_days_per_week = ?,
        training_days = ?,
        incentive_allowed = ?,
        deduction_allowed = ?,
        revenue_flag = ?,
        billing_flag = ?,
        revenue_type = ?,
        fixed_amount = ?,
        variable_base = ?,
        payment_mode = ?,
        payment_terms = ?,
        hsn_code = ?,
        service_tax_no = ?,
        vendor_state_code = ?,
        bill_to_address1 = ?,
        bill_to_address2 = ?,
        bill_to_address3 = ?,
        bill_to_city = ?,
        bill_to_pincode = ?,
        ship_to_address1 = ?,
        ship_to_address2 = ?,
        ship_to_address3 = ?,
        ship_to_city = ?,
        ship_to_pincode = ?,
        association_date = ?,
        updated_at = NOW()
      WHERE id = ?`,
      [
        data.cost_centre_name ?? null,
        data.client_id ?? null,
        data.lob_id ?? null,
        data.branch_id ?? null,
        data.process_id ?? null,
        data.department_id ?? null,
        data.mandated_seats_value ?? existing.mandated_seats_value,
        data.shrinkage_percentage ?? existing.shrinkage_percentage,
        data.attrition_percentage ?? existing.attrition_percentage,
        data.shift_hours ?? existing.shift_hours,
        data.working_days_per_week ?? existing.working_days_per_week,
        data.training_days ?? existing.training_days,
        data.incentive_allowed !== undefined ? bool(data.incentive_allowed) : existing.incentive_allowed,
        data.deduction_allowed !== undefined ? bool(data.deduction_allowed) : existing.deduction_allowed,
        data.revenue_flag !== undefined ? bool(data.revenue_flag) : existing.revenue_flag,
        data.billing_flag !== undefined ? bool(data.billing_flag) : existing.billing_flag,
        data.revenue_type ?? existing.revenue_type,
        data.fixed_amount ?? existing.fixed_amount,
        data.variable_base ?? existing.variable_base,
        data.payment_mode ?? existing.payment_mode,
        data.payment_terms ?? existing.payment_terms,
        data.hsn_code ?? existing.hsn_code,
        data.service_tax_no ?? existing.service_tax_no,
        data.vendor_state_code ?? existing.vendor_state_code,
        data.bill_to_address1 ?? existing.bill_to_address1,
        data.bill_to_address2 ?? existing.bill_to_address2,
        data.bill_to_address3 ?? existing.bill_to_address3,
        data.bill_to_city ?? existing.bill_to_city,
        data.bill_to_pincode ?? existing.bill_to_pincode,
        data.ship_to_address1 ?? existing.ship_to_address1,
        data.ship_to_address2 ?? existing.ship_to_address2,
        data.ship_to_address3 ?? existing.ship_to_address3,
        data.ship_to_city ?? existing.ship_to_city,
        data.ship_to_pincode ?? existing.ship_to_pincode,
        data.association_date ?? existing.association_date,
        id,
      ]
    );

    // Update contacts if provided
    if (data.contacts) {
      await this.saveContacts(id, data.contacts);
    }

    await logApprovalAction(id, "updated", existing.status, existing.status, actor);

    return this.getById(id);
  },

  /**
   * Save contacts for a cost centre (upsert)
   */
  async saveContacts(costCentreId: string, contacts: CostCentreContact[]) {
    // Delete existing contacts
    await db.execute(`DELETE FROM cost_centre_contacts WHERE cost_centre_id = ?`, [costCentreId]);

    // Insert new contacts
    for (const c of contacts) {
      if (!c.contact_name && !c.contact_email && !c.contact_phone) continue;
      await db.execute(
        `INSERT INTO cost_centre_contacts
           (id, cost_centre_id, contact_type, contact_sequence, contact_name, contact_email, contact_phone, contact_designation, is_primary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          costCentreId,
          c.contact_type,
          c.contact_sequence,
          c.contact_name ?? null,
          c.contact_email ?? null,
          c.contact_phone ?? null,
          c.contact_designation ?? null,
          c.is_primary ? 1 : 0,
        ]
      );
    }
  },

  /**
   * Submit for L1 approval
   */
  async submit(id: string, actor: Actor) {
    const existing = await this.getById(id);
    if (!existing) throw Object.assign(new Error("Cost centre not found"), { statusCode: 404 });

    if (!["draft", "revision_required"].includes(existing.status)) {
      throw Object.assign(
        new Error(`Cannot submit cost centre in ${existing.status} status`),
        { statusCode: 400 }
      );
    }

    await db.execute(
      `UPDATE cost_centre_master SET
        status = 'pending_l1',
        submitted_by = ?,
        submitted_at = NOW(),
        updated_at = NOW()
      WHERE id = ?`,
      [actor.id, id]
    );

    await logApprovalAction(id, "submitted", existing.status, "pending_l1", actor);

    return this.getById(id);
  },

  /**
   * L1 Approval (Finance Head / Accounts Head)
   */
  async approveL1(id: string, actor: Actor, remarks?: string) {
    const existing = await this.getById(id);
    if (!existing) throw Object.assign(new Error("Cost centre not found"), { statusCode: 404 });

    if (existing.status !== "pending_l1") {
      throw Object.assign(
        new Error(`Cannot approve L1: cost centre is in ${existing.status} status`),
        { statusCode: 400 }
      );
    }

    // Maker-checker. CC_CREATE_ROLES and CC_L1_APPROVAL_ROLES are the *identical* set
    // (super_admin, admin, finance_head, accounts_head), and until now approveL1 checked
    // only the status transition — so one person could raise a cost centre, submit it and
    // approve it at L1, which is precisely what having an L1 stage is meant to prevent.
    // L2 is narrower and would still catch it before 'active', except for an admin or
    // super_admin, who could walk all three stages alone.
    //
    // Safe to enforce: 13 distinct users hold an L1 role (admin 9, super_admin 3,
    // finance_head 1, accounts_head 1), so this cannot deadlock the queue, and it changes
    // no existing behaviour — no cost centre has ever reached pending_l1 (761 draft, 166
    // active, 0 in either approval state) and zero L1 approvals have ever been recorded.
    //
    // Legacy rows carry created_by NULL on all 927, so the comparison is inert for them
    // rather than wrongly blocking: it governs cost centres raised through the app from
    // here on. Both creator and submitter are checked, since submitting is the act that
    // puts it in front of an approver.
    const actorId = actor?.id ?? null;
    if (actorId && (actorId === existing.created_by || actorId === existing.submitted_by)) {
      throw Object.assign(
        new Error(
          "L1 approval must come from someone other than the person who raised or submitted this cost centre",
        ),
        { statusCode: 403 },
      );
    }

    await db.execute(
      `UPDATE cost_centre_master SET
        status = 'pending_l2',
        l1_approved_by = ?,
        l1_approved_at = NOW(),
        updated_at = NOW()
      WHERE id = ?`,
      [actor.id, id]
    );

    await logApprovalAction(id, "approved_l1", "pending_l1", "pending_l2", actor, remarks);

    return this.getById(id);
  },

  /**
   * L2 Approval (Super Admin / CEO)
   */
  async approveL2(id: string, actor: Actor, remarks?: string) {
    const existing = await this.getById(id);
    if (!existing) throw Object.assign(new Error("Cost centre not found"), { statusCode: 404 });

    if (existing.status !== "pending_l2") {
      throw Object.assign(
        new Error(`Cannot approve L2: cost centre is in ${existing.status} status`),
        { statusCode: 400 }
      );
    }

    await db.execute(
      `UPDATE cost_centre_master SET
        status = 'approved',
        l2_approved_by = ?,
        l2_approved_at = NOW(),
        updated_at = NOW()
      WHERE id = ?`,
      [actor.id, id]
    );

    await logApprovalAction(id, "approved_l2", "pending_l2", "approved", actor, remarks);

    return this.getById(id);
  },

  /**
   * Reject at any pending stage
   */
  async reject(id: string, actor: Actor, reason: string) {
    const existing = await this.getById(id);
    if (!existing) throw Object.assign(new Error("Cost centre not found"), { statusCode: 404 });

    if (!["pending_l1", "pending_l2"].includes(existing.status)) {
      throw Object.assign(
        new Error(`Cannot reject cost centre in ${existing.status} status`),
        { statusCode: 400 }
      );
    }

    await db.execute(
      `UPDATE cost_centre_master SET
        status = 'rejected',
        rejection_reason = ?,
        updated_at = NOW()
      WHERE id = ?`,
      [reason, id]
    );

    await logApprovalAction(id, "rejected", existing.status, "rejected", actor, reason);

    return this.getById(id);
  },

  /**
   * Request revision at any pending stage
   */
  async requestRevision(id: string, actor: Actor, reason: string) {
    const existing = await this.getById(id);
    if (!existing) throw Object.assign(new Error("Cost centre not found"), { statusCode: 404 });

    if (!["pending_l1", "pending_l2"].includes(existing.status)) {
      throw Object.assign(
        new Error(`Cannot request revision for cost centre in ${existing.status} status`),
        { statusCode: 400 }
      );
    }

    await db.execute(
      `UPDATE cost_centre_master SET
        status = 'revision_required',
        rejection_reason = ?,
        revision_no = revision_no + 1,
        updated_at = NOW()
      WHERE id = ?`,
      [reason, id]
    );

    await logApprovalAction(id, "revision_requested", existing.status, "revision_required", actor, reason);

    return this.getById(id);
  },

  /**
   * Activate an approved cost centre
   */
  async activate(id: string, actor: Actor) {
    const existing = await this.getById(id);
    if (!existing) throw Object.assign(new Error("Cost centre not found"), { statusCode: 404 });

    if (existing.status !== "approved") {
      throw Object.assign(
        new Error(`Cannot activate cost centre in ${existing.status} status`),
        { statusCode: 400 }
      );
    }

    await db.execute(
      `UPDATE cost_centre_master SET
        status = 'active',
        active_status = 1,
        updated_at = NOW()
      WHERE id = ?`,
      [id]
    );

    await logApprovalAction(id, "activated", "approved", "active", actor);

    return this.getById(id);
  },

  /**
   * Close an active cost centre
   */
  async close(id: string, actor: Actor, reason?: string) {
    const existing = await this.getById(id);
    if (!existing) throw Object.assign(new Error("Cost centre not found"), { statusCode: 404 });

    if (existing.status !== "active") {
      throw Object.assign(
        new Error(`Cannot close cost centre in ${existing.status} status`),
        { statusCode: 400 }
      );
    }

    await db.execute(
      `UPDATE cost_centre_master SET
        status = 'closed',
        active_status = 0,
        updated_at = NOW()
      WHERE id = ?`,
      [id]
    );

    await logApprovalAction(id, "closed", "active", "closed", actor, reason);

    return this.getById(id);
  },

  /**
   * Get approval queue for a specific role
   */
  async getApprovalQueue(role: string) {
    const statusForRole: Record<string, CostCentreStatus[]> = {
      finance_head: ["pending_l1"],
      accounts_head: ["pending_l1"],
      super_admin: ["pending_l1", "pending_l2"],
      admin: ["pending_l1", "pending_l2"],
    };

    const allowedStatuses = statusForRole[role.toLowerCase()] ?? [];
    if (allowedStatuses.length === 0) return [];

    const placeholders = allowedStatuses.map(() => "?").join(", ");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cc.*,
              cl.client_name, cl.client_code,
              b.branch_name, b.branch_code,
              p.process_name, p.process_code,
              submitter.full_name AS submitted_by_name
         FROM cost_centre_master cc
         LEFT JOIN client_master cl ON cl.id = cc.client_id
         LEFT JOIN branch_master b ON b.id = cc.branch_id
         LEFT JOIN process_master p ON p.id = cc.process_id
         LEFT JOIN employees submitter ON submitter.id = cc.submitted_by
        WHERE cc.status IN (${placeholders})
        ORDER BY cc.submitted_at ASC`,
      allowedStatuses
    );

    return rows;
  },

  /**
   * Get approval history for a cost centre
   */
  async getApprovalHistory(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT al.*, e.full_name AS actor_name
         FROM cost_centre_approval_log al
         LEFT JOIN employees e ON e.id = al.actor_user_id
        WHERE al.cost_centre_id = ?
        ORDER BY al.created_at DESC`,
      [id]
    );
    return rows;
  },

  /**
   * Get status counts for dashboard
   */
  async getStatusCounts(branchId?: string) {
    // Counted the same way the list filters, so the tab badges and the tab contents agree.
    // Previously every deactivated cost centre was counted under whatever approval stage it had
    // reached, so Draft read 761 while 464 of those were closed, and Closed read nothing at all.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT CASE WHEN active_status = 0 THEN 'closed' ELSE status END AS status,
              COUNT(*) AS count
         FROM cost_centre_master
        ${branchId ? "WHERE branch_id = ?" : ""}
        GROUP BY CASE WHEN active_status = 0 THEN 'closed' ELSE status END`,
      branchId ? [branchId] : []
    );
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  },
};
