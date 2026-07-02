import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// ─── Vendors ────────────────────────────────────────────────────────────────

export const vendorService = {
  async list(filters: { is_active?: string; vendor_type?: string }) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.is_active !== undefined) { conds.push("is_active = ?"); params.push(filters.is_active); }
    if (filters.vendor_type)             { conds.push("vendor_type = ?"); params.push(filters.vendor_type); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM vendor_master ${where} ORDER BY vendor_name`,
      params
    );
    return rows as RowDataPacket[];
  },

  async getById(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM vendor_master WHERE id = ? LIMIT 1",
      [id]
    );
    return (rows as RowDataPacket[])[0] ?? null;
  },

  async create(data: Record<string, unknown>) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO vendor_master
         (id, vendor_code, vendor_name, vendor_type, contact_name, contact_email,
          contact_phone, address, gst_number, pan_number, payment_terms, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.vendor_code,
        data.vendor_name,
        data.vendor_type ?? "supplier",
        data.contact_name ?? null,
        data.contact_email ?? null,
        data.contact_phone ?? null,
        data.address ?? null,
        data.gst_number ?? null,
        data.pan_number ?? null,
        data.payment_terms ?? null,
        data.is_active !== undefined ? data.is_active : 1,
      ]
    );
    return this.getById(id);
  },

  async update(id: string, data: Record<string, unknown>) {
    await db.execute(
      `UPDATE vendor_master SET
         vendor_name    = COALESCE(?, vendor_name),
         vendor_type    = COALESCE(?, vendor_type),
         contact_name   = COALESCE(?, contact_name),
         contact_email  = COALESCE(?, contact_email),
         contact_phone  = COALESCE(?, contact_phone),
         address        = COALESCE(?, address),
         gst_number     = COALESCE(?, gst_number),
         pan_number     = COALESCE(?, pan_number),
         payment_terms  = COALESCE(?, payment_terms),
         is_active      = COALESCE(?, is_active),
         updated_at     = NOW()
       WHERE id = ?`,
      [
        data.vendor_name ?? null,
        data.vendor_type ?? null,
        data.contact_name ?? null,
        data.contact_email ?? null,
        data.contact_phone ?? null,
        data.address ?? null,
        data.gst_number ?? null,
        data.pan_number ?? null,
        data.payment_terms ?? null,
        data.is_active ?? null,
        id,
      ]
    );
    return this.getById(id);
  },
};

// ─── Contracts ──────────────────────────────────────────────────────────────

export const contractService = {
  async list(filters: { status?: string; vendor_id?: string }) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.status)    { conds.push("c.status = ?");    params.push(filters.status); }
    if (filters.vendor_id) { conds.push("c.vendor_id = ?"); params.push(filters.vendor_id); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT c.*, v.vendor_name
       FROM contract_master c
       LEFT JOIN vendor_master v ON v.id = c.vendor_id
       ${where}
       ORDER BY c.start_date DESC`,
      params
    );
    return rows as RowDataPacket[];
  },

  async getById(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT c.*, v.vendor_name
       FROM contract_master c
       LEFT JOIN vendor_master v ON v.id = c.vendor_id
       WHERE c.id = ? LIMIT 1`,
      [id]
    );
    return (rows as RowDataPacket[])[0] ?? null;
  },

  async create(data: Record<string, unknown>, createdBy: string) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO contract_master
         (id, contract_code, title, vendor_id, client_id, contract_type,
          start_date, end_date, value, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.contract_code,
        data.title,
        data.vendor_id ?? null,
        data.client_id ?? null,
        data.contract_type ?? "sow",
        data.start_date,
        data.end_date ?? null,
        data.value ?? null,
        data.status ?? "draft",
        data.notes ?? null,
        createdBy,
      ]
    );
    return this.getById(id);
  },

  async updateStatus(id: string, status: string, notes?: string) {
    await db.execute(
      "UPDATE contract_master SET status = ?, notes = COALESCE(?, notes), updated_at = NOW() WHERE id = ?",
      [status, notes ?? null, id]
    );
    return this.getById(id);
  },
};

// ─── Expenses ────────────────────────────────────────────────────────────────

export const expenseService = {
  async list(filters: { employee_id?: string; status?: string }) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.employee_id) { conds.push("e.employee_id = ?"); params.push(filters.employee_id); }
    if (filters.status)      { conds.push("e.status = ?");      params.push(filters.status); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.*,
              CONCAT(emp.first_name, ' ', emp.last_name) AS employee_name,
              emp.employee_code
       FROM expense_claim e
       LEFT JOIN employees emp ON emp.id = e.employee_id
       ${where}
       ORDER BY e.expense_date DESC`,
      params
    );
    return rows as RowDataPacket[];
  },

  async getById(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.*,
              CONCAT(emp.first_name, ' ', emp.last_name) AS employee_name
       FROM expense_claim e
       LEFT JOIN employees emp ON emp.id = e.employee_id
       WHERE e.id = ? LIMIT 1`,
      [id]
    );
    return (rows as RowDataPacket[])[0] ?? null;
  },

  async create(data: Record<string, unknown>, employeeId: string) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO expense_claim
         (id, employee_id, expense_date, category, amount, currency,
          description, receipt_ref, project_code, cost_centre_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
      [
        id,
        employeeId,
        data.expense_date,
        data.category ?? "other",
        data.amount,
        data.currency ?? "INR",
        data.description ?? null,
        data.receipt_ref ?? null,
        data.project_code ?? null,
        data.cost_centre_id ?? null,
      ]
    );
    return this.getById(id);
  },

  async review(id: string, action: "approved" | "rejected", reviewedBy: string, remarks?: string) {
    // Load expense to check category for policy validation
    const claim = await this.getById(id);
    if (!claim) return null;

    const [policyRows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM expense_policy WHERE category = ? AND is_active = 1 LIMIT 1",
      [claim.category]
    );
    const policy = (policyRows as RowDataPacket[])[0] ?? null;

    let finalAction = action;
    let autoRemarks = remarks ?? null;

    if (policy) {
      const amount = Number(claim.amount);
      if (amount > Number(policy.max_amount)) {
        finalAction = "rejected";
        autoRemarks = `Exceeds policy limit of ₹${Number(policy.max_amount).toLocaleString("en-IN")}`;
      } else if (amount > Number(policy.requires_receipt_above) && !claim.receipt_ref) {
        // Flag for HR: add note but do not block the review
        autoRemarks = (remarks ? remarks + " | " : "") +
          `Receipt required for amounts above ₹${Number(policy.requires_receipt_above).toLocaleString("en-IN")}`;
      }
    }

    const status = finalAction === "approved" ? "approved" : "rejected";
    await db.execute(
      `UPDATE expense_claim
       SET status = ?, reviewed_by = ?, reviewed_at = NOW(),
           remarks = ?, updated_at = NOW()
       WHERE id = ?`,
      [status, reviewedBy, autoRemarks, id]
    );
    return this.getById(id);
  },
};

// ─── Expense Policies ────────────────────────────────────────────────────────

export const expensePolicyService = {
  async list() {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM expense_policy ORDER BY category"
    );
    return rows as RowDataPacket[];
  },

  async upsert(category: string, data: Record<string, unknown>) {
    await db.execute(
      `UPDATE expense_policy
       SET max_amount              = COALESCE(?, max_amount),
           requires_receipt_above  = COALESCE(?, requires_receipt_above),
           approval_required       = COALESCE(?, approval_required),
           notes                   = COALESCE(?, notes)
       WHERE category = ?`,
      [
        data.max_amount ?? null,
        data.requires_receipt_above ?? null,
        data.approval_required ?? null,
        data.notes ?? null,
        category,
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM expense_policy WHERE category = ? LIMIT 1",
      [category]
    );
    return (rows as RowDataPacket[])[0] ?? null;
  },
};

// ─── Billing Units ────────────────────────────────────────────────────────────

export const billingUnitService = {
  async list(filters: { process_id?: string }) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.process_id) { conds.push("bu.process_id = ?"); params.push(filters.process_id); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT bu.*, pm.process_code, pm.process_name
       FROM billing_unit bu
       LEFT JOIN process_master pm ON pm.id = bu.process_id
       ${where}
       ORDER BY bu.effective_from DESC`,
      params
    );
    return rows as RowDataPacket[];
  },

  async create(data: Record<string, unknown>) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO billing_unit
         (id, process_id, contract_id, billing_type, rate, currency,
          billing_period, effective_from, effective_to, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.process_id,
        data.contract_id ?? null,
        data.billing_type ?? "per_seat",
        data.rate ?? 0,
        data.currency ?? "INR",
        data.billing_period ?? "monthly",
        data.effective_from,
        data.effective_to ?? null,
        data.is_active !== undefined ? data.is_active : 1,
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM billing_unit WHERE id = ? LIMIT 1", [id]
    );
    return (rows as RowDataPacket[])[0] ?? null;
  },
};

// ─── Billing Invoices ─────────────────────────────────────────────────────────

export const billingInvoiceService = {
  async list(filters: { process_id?: string; status?: string }) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.process_id) { conds.push("i.process_id = ?"); params.push(filters.process_id); }
    if (filters.status)     { conds.push("i.status = ?");     params.push(filters.status); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT i.*, pm.process_code, pm.process_name
       FROM billing_invoice i
       LEFT JOIN process_master pm ON pm.id = i.process_id
       ${where}
       ORDER BY i.created_at DESC`,
      params
    );
    return rows as RowDataPacket[];
  },

  async generate(data: { process_id: string; period_from: string; period_to: string }, preparedBy: string) {
    // Resolve active billing unit for process
    const [buRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM billing_unit
       WHERE process_id = ? AND is_active = 1
         AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY effective_from DESC LIMIT 1`,
      [data.process_id, data.period_to, data.period_from]
    );
    const bu = (buRows as RowDataPacket[])[0] ?? null;
    const rate = bu ? Number(bu.rate) : 0;

    // Count active seats for the process in the period
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM employees
       WHERE process_id = ?
         AND (date_of_leaving IS NULL OR date_of_leaving >= ?)
         AND (date_of_joining IS NULL OR date_of_joining <= ?)`,
      [data.process_id, data.period_from, data.period_to]
    );
    const billableUnits = Number((empRows as RowDataPacket[])[0]?.cnt ?? 0);

    const grossAmount  = billableUnits * rate;
    const gstAmount    = +(grossAmount * 0.18).toFixed(2);
    const netAmount    = grossAmount; // adjustments applied on PATCH
    const totalAmount  = +(grossAmount + gstAmount).toFixed(2);

    // Build invoice_ref: INV-YYYYMM-PROCESSCODE-NNN
    const [pmRows] = await db.execute<RowDataPacket[]>(
      "SELECT process_code FROM process_master WHERE id = ? LIMIT 1",
      [data.process_id]
    );
    const processCode = (pmRows as RowDataPacket[])[0]?.process_code ?? "UNK";
    const yyyymm = data.period_from.slice(0, 7).replace("-", "");

    const [seqRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM billing_invoice
       WHERE process_id = ? AND invoice_ref LIKE ?`,
      [data.process_id, `INV-${yyyymm}-${processCode}-%`]
    );
    const seq = String(Number((seqRows as RowDataPacket[])[0]?.cnt ?? 0) + 1).padStart(3, "0");
    const invoiceRef = `INV-${yyyymm}-${processCode}-${seq}`;

    const id = randomUUID();
    await db.execute(
      `INSERT INTO billing_invoice
         (id, invoice_ref, process_id, billing_unit_id, period_from, period_to,
          billable_units, rate, gross_amount, adjustments, net_amount,
          gst_amount, total_amount, status, prepared_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'draft', ?)`,
      [
        id, invoiceRef, data.process_id, bu?.id ?? null,
        data.period_from, data.period_to,
        billableUnits, rate, grossAmount, netAmount, gstAmount, totalAmount, preparedBy,
      ]
    );
    const [inv] = await db.execute<RowDataPacket[]>(
      `SELECT i.*, pm.process_code, pm.process_name
       FROM billing_invoice i
       LEFT JOIN process_master pm ON pm.id = i.process_id
       WHERE i.id = ? LIMIT 1`,
      [id]
    );
    return (inv as RowDataPacket[])[0] ?? null;
  },

  async update(id: string, data: Record<string, unknown>) {
    // Recalculate net/total if adjustments change
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM billing_invoice WHERE id = ? LIMIT 1", [id]
    );
    const inv = (existing as RowDataPacket[])[0];
    if (!inv) return null;

    const adjustments = data.adjustments !== undefined ? Number(data.adjustments) : Number(inv.adjustments);
    const grossAmount  = Number(inv.gross_amount);
    const netAmount    = +(grossAmount - adjustments).toFixed(2);
    const gstAmount    = +(netAmount * 0.18).toFixed(2);
    const totalAmount  = +(netAmount + gstAmount).toFixed(2);

    await db.execute(
      `UPDATE billing_invoice
       SET status      = COALESCE(?, status),
           adjustments = ?,
           net_amount  = ?,
           gst_amount  = ?,
           total_amount= ?,
           notes       = COALESCE(?, notes),
           sent_at     = COALESCE(?, sent_at),
           paid_at     = COALESCE(?, paid_at)
       WHERE id = ?`,
      [
        data.status ?? null,
        adjustments, netAmount, gstAmount, totalAmount,
        data.notes ?? null,
        data.sent_at ?? null,
        data.paid_at ?? null,
        id,
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT i.*, pm.process_code, pm.process_name
       FROM billing_invoice i
       LEFT JOIN process_master pm ON pm.id = i.process_id
       WHERE i.id = ? LIMIT 1`,
      [id]
    );
    return (rows as RowDataPacket[])[0] ?? null;
  },
};

// ─── Procurement ─────────────────────────────────────────────────────────────

export const procurementService = {
  async list(filters: { requested_by?: string; status?: string; department_id?: string }) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.requested_by)  { conds.push("p.requested_by = ?");  params.push(filters.requested_by); }
    if (filters.status)        { conds.push("p.status = ?");        params.push(filters.status); }
    if (filters.department_id) { conds.push("p.department_id = ?"); params.push(filters.department_id); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT p.*,
              CONCAT(emp.first_name, ' ', emp.last_name) AS requester_name,
              v.vendor_name,
              d.department_name
       FROM procurement_request p
       LEFT JOIN employees emp ON emp.id = p.requested_by
       LEFT JOIN vendor_master v ON v.id = p.vendor_id
       LEFT JOIN department_master d ON d.id = p.department_id
       ${where}
       ORDER BY p.created_at DESC`,
      params
    );
    return rows as RowDataPacket[];
  },

  async getById(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM procurement_request WHERE id = ? LIMIT 1",
      [id]
    );
    return (rows as RowDataPacket[])[0] ?? null;
  },

  async create(data: Record<string, unknown>, requestedBy: string) {
    const id = randomUUID();
    const req_code = `PR-${Date.now()}`;
    await db.execute(
      `INSERT INTO procurement_request
         (id, req_code, requested_by, item_name, quantity, estimated_cost,
          vendor_id, department_id, required_by, justification, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
      [
        id,
        req_code,
        requestedBy,
        data.item_name,
        data.quantity ?? 1,
        data.estimated_cost ?? null,
        data.vendor_id ?? null,
        data.department_id ?? null,
        data.required_by ?? null,
        data.justification ?? null,
      ]
    );
    return this.getById(id);
  },

  async approve(id: string, action: "approved" | "rejected", approvedBy: string, remarks?: string) {
    const status = action === "approved" ? "approved" : "rejected";
    await db.execute(
      `UPDATE procurement_request
       SET status = ?, approved_by = ?, approved_at = NOW(),
           remarks = COALESCE(?, remarks), updated_at = NOW()
       WHERE id = ?`,
      [status, approvedBy, remarks ?? null, id]
    );
    return this.getById(id);
  },
};
