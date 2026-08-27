import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { vendorApplicabilityService } from "../finance/vendor-applicability.service.js";

// ─── Vendors ────────────────────────────────────────────────────────────────

export interface VendorListFilters {
  is_active?: string;
  vendor_type?: string;
  q?: string;
  limit?: string | number;
  offset?: string | number;
  /** Legal entity and branch the vendor must be applicable to. Both optional. */
  companyCode?: string | null;
  branchId?: string | null;
}

/**
 * Shared WHERE builder for `vendorService.list` and `vendorService.count`, so the page of
 * rows and the total that describes it can never disagree — the same reasoning as
 * client-billing.routes.ts's buildInvoiceListQuery. A count computed from a different
 * predicate than the list is worse than no count at all: it looks authoritative and is wrong.
 */
function buildVendorWhere(filters: VendorListFilters): { where: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filters.is_active !== undefined) { conds.push("is_active = ?"); params.push(filters.is_active); }
  if (filters.vendor_type)             { conds.push("vendor_type = ?"); params.push(filters.vendor_type); }

  /*
   * Vendor applicability, ENFORCED — legal entity and branch (Vendor Master, three concepts).
   *
   * This predicate existed, was tested and was called by nothing: a vendor could be restricted
   * to IDC or to one branch in the UI and would still appear for everyone, which is a
   * restriction feature that silently does not restrict.
   *
   * "No rows means unrestricted" is expressed as NOT EXISTS inside the clause, so all vendors
   * with no applicability rows keep appearing exactly as before, and the query only narrows
   * once somebody opts a vendor in.
   */
  if (filters.companyCode || filters.branchId) {
    // Aliased "v", not "vendor_master": the de-dup subquery aliases the table as v, and once a
    // table is aliased, MySQL requires every reference inside that query to use the alias — a
    // bare "vendor_master.id" here would throw "Unknown table 'vendor_master'".
    const applicability = vendorApplicabilityService.vendorFilterClause("v", {
      companyCode: filters.companyCode,
      branchId: filters.branchId,
    });
    if (applicability.sql !== "1=1") {
      conds.push(applicability.sql);
      params.push(...applicability.params);
    }
  }

  // Type-ahead search. Without this the whole vendor_master is returned and the
  // caller has to filter client-side.
  const term = String(filters.q ?? "").trim();
  if (term) {
    conds.push("(vendor_name LIKE ? OR vendor_code LIKE ? OR gst_number LIKE ?)");
    const like = `%${term.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
    params.push(like, like, like);
  }

  return { where: conds.length ? `WHERE ${conds.join(" AND ")}` : "", params };
}

export const vendorService = {
  async list(filters: VendorListFilters) {
    const { where, params } = buildVendorWhere(filters);

    // Paging is opt-in. Several existing callers (NativeERP, NativeVendorManagement,
    // NativeProcurementPage) request no limit and rely on the full list, so the
    // unbounded default is preserved deliberately.
    // LIMIT/OFFSET are interpolated rather than bound: mysql2 prepared statements
    // reject placeholders in these positions. Both are coerced to integers first.
    let paging = "";
    if (filters.limit !== undefined && String(filters.limit).trim() !== "") {
      const limit = Math.min(Math.max(Math.trunc(Number(filters.limit)) || 0, 1), 500);
      const offset = Math.max(Math.trunc(Number(filters.offset)) || 0, 0);
      paging = ` LIMIT ${limit} OFFSET ${offset}`;
    }

    // De-duplicated at the API layer (defense in depth): vendor_master carries
    // duplicate vendor_name rows from historical db_bill syncs. ROW_NUMBER()
    // picks one canonical row per normalized name (most recently updated,
    // then lowest id for determinism), so callers never see raw duplicates
    // even before the sync-time root cause (a separate ticket) is fixed.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM (
         SELECT v.*, ROW_NUMBER() OVER (
           PARTITION BY UPPER(TRIM(v.vendor_name))
           ORDER BY v.updated_at DESC, v.id ASC
         ) AS rn
         FROM vendor_master v
         ${where}
       ) ranked
       WHERE rn = 1
       ORDER BY vendor_name${paging}`,
      params
    );
    return rows as RowDataPacket[];
  },

  /**
   * How many vendors the caller's filters actually match, ignoring `limit`/`offset`.
   *
   * Added 2026-08-27. Without it `GET /api/erp/vendors` returned only a `data` array, so the
   * Vendor Management page had nothing to report but `vendorsData.length` — and since it
   * requests `limit=200`, the header read "200 active / 200 total" against 1,530 live active
   * vendors. 1,330 of them (87%) were unreachable, and nothing on screen said so: the count
   * was not merely missing, it asserted a wrong number confidently.
   *
   * Counts `rn = 1` rows so the total matches what `list` actually yields — that query
   * de-duplicates by normalised vendor_name (vendor_master carries duplicate names from
   * historical db_bill syncs), so a plain COUNT(*) over vendor_master would overstate the
   * list by the 22 rows dedup removes and the "showing X of Y" would never reach Y.
   */
  async count(filters: VendorListFilters): Promise<number> {
    const { where, params } = buildVendorWhere(filters);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM (
         SELECT ROW_NUMBER() OVER (
           PARTITION BY UPPER(TRIM(v.vendor_name))
           ORDER BY v.updated_at DESC, v.id ASC
         ) AS rn
         FROM vendor_master v
         ${where}
       ) ranked
       WHERE rn = 1`,
      params
    );
    return Number(rows[0]?.total ?? 0);
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
    const enriched = withDerivedGstStateCode(data);
    const columns = ["id", "vendor_code", "vendor_name", "vendor_type", "contact_name",
      "contact_email", "contact_phone", "address", "gst_number", "pan_number",
      "payment_terms", "is_active"];
    const values: unknown[] = [
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
    ];
    // Enrichment columns (migration 1086) are appended only when supplied, so a caller that
    // knows nothing about them still inserts exactly the row it always did.
    for (const column of VENDOR_ENRICHMENT_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(enriched, column)) {
        columns.push(column);
        values.push(normaliseEnrichmentValue(column, enriched[column]));
      }
    }
    await db.execute(
      `INSERT INTO vendor_master (${columns.join(", ")})
       VALUES (${columns.map(() => "?").join(", ")})`,
      values
    );
    return this.getById(id);
  },

  async generateNextCode(): Promise<string> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(CAST(SUBSTRING(vendor_code, 2) AS UNSIGNED)) AS max_seq
         FROM vendor_master
        WHERE vendor_code REGEXP '^V[0-9]+$'`
    );
    const seq = (Number(rows[0]?.max_seq ?? 0) || 0) + 1;
    return `V${String(seq).padStart(5, "0")}`;
  },

  async findByName(name: string, excludeId?: string): Promise<{ id: string; vendor_code: string } | null> {
    const trimmed = name?.trim();
    if (!trimmed) return null;
    if (excludeId) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT id, vendor_code FROM vendor_master WHERE LOWER(vendor_name) = LOWER(?) AND id <> ? LIMIT 1`,
        [trimmed, excludeId]
      );
      return (rows[0] as { id: string; vendor_code: string } | undefined) ?? null;
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, vendor_code FROM vendor_master WHERE LOWER(vendor_name) = LOWER(?) LIMIT 1`,
      [trimmed]
    );
    return (rows[0] as { id: string; vendor_code: string } | undefined) ?? null;
  },

  async update(id: string, data: Record<string, unknown>) {
    const enriched = withDerivedGstStateCode(data);

    // The original ten columns keep COALESCE semantics — "omitted means preserved". Callers
    // have always relied on that for partial updates from VendorSheet, and flipping them to
    // "omitted means NULL" would blank data on every save that did not send every field.
    const sets = [
      "vendor_name    = COALESCE(?, vendor_name)",
      "vendor_type    = COALESCE(?, vendor_type)",
      "contact_name   = COALESCE(?, contact_name)",
      "contact_email  = COALESCE(?, contact_email)",
      "contact_phone  = COALESCE(?, contact_phone)",
      "address        = COALESCE(?, address)",
      "gst_number     = COALESCE(?, gst_number)",
      "pan_number     = COALESCE(?, pan_number)",
      "payment_terms  = COALESCE(?, payment_terms)",
      "is_active      = COALESCE(?, is_active)",
    ];
    const params: unknown[] = [
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
    ];

    // The enrichment columns use presence semantics instead: a key present in the payload is
    // written even when its value is null. Without this there is no way to clear one, and
    // tds_section in particular MUST be clearable — leaving a stale section behind after
    // tds_enabled flips to 0 would mean deducting under a section the vendor no longer has.
    for (const column of VENDOR_ENRICHMENT_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(enriched, column)) {
        sets.push(`${column} = ?`);
        params.push(normaliseEnrichmentValue(column, enriched[column]));
      }
    }

    sets.push("updated_at = NOW()");
    params.push(id);
    await db.execute(`UPDATE vendor_master SET ${sets.join(", ")} WHERE id = ?`, params);
    return this.getById(id);
  },
};

/** Columns added by migration 1086. Written only when the caller mentions them. */
const VENDOR_ENRICHMENT_COLUMNS = [
  "tally_name",
  "address_line1", "address_line2", "address_line3", "city", "state", "pin_code",
  "gst_enabled", "gst_state_code",
  "tds_enabled", "tds_section", "tds_rate",
] as const;

const BOOLEAN_COLUMNS = new Set(["gst_enabled", "tds_enabled"]);

function normaliseEnrichmentValue(column: string, value: unknown) {
  if (value === undefined || value === null || value === "") {
    // NOT NULL DEFAULT 0 on the two flags, so an empty value means "off", not NULL.
    return BOOLEAN_COLUMNS.has(column) ? 0 : null;
  }
  if (BOOLEAN_COLUMNS.has(column)) return value === true || value === 1 || value === "1" ? 1 : 0;
  if (column === "tds_rate") {
    const rate = Number(value);
    return Number.isFinite(rate) ? rate : null;
  }
  return typeof value === "string" ? value.trim() : value;
}

/**
 * Keeps gst_state_code consistent with the GSTIN.
 *
 * The first two characters of a GSTIN are the state code by definition, so deriving it means
 * the two can never disagree. Only fills a blank — an explicitly supplied code always wins,
 * and a malformed GSTIN derives nothing rather than producing a bogus state. Same rule the
 * 1086 backfill applied to existing rows, so new rows match migrated ones.
 */
function withDerivedGstStateCode(data: Record<string, unknown>): Record<string, unknown> {
  const supplied = data.gst_state_code;
  if (supplied !== undefined && String(supplied ?? "").trim() !== "") return data;
  const gstin = String(data.gst_number ?? "").trim();
  if (gstin.length !== 15 || !/^\d{2}/.test(gstin)) return data;
  return { ...data, gst_state_code: gstin.slice(0, 2) };
}

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
  /**
   * expense_claim is a mixed ledger. As of 31-Jul-2026 it holds 5,634 rows:
   * 2,955 vendor_bill (~₹11.85 Cr), 2,579 imprest and 100 employee_claim, migrated
   * from the db_bill finance system. This endpoint backs the ERP "Expenses" tab,
   * which is an employee-expense screen — it previously applied NO expense_type
   * filter and NO limit, so it returned the entire vendor-bill ledger into that
   * screen, and its Approve/Reject buttons acted on migrated vendor bills. Those
   * buttons run expense_policy checks keyed on `category`, and every migrated row
   * carries category 'other' whose policy cap is ₹5,000 — so approving a ₹-crore
   * vendor bill through this screen would auto-REJECT it.
   *
   * expense_type is therefore explicit. Callers wanting the vendor/imprest ledger
   * must ask for it; the default is the employee-claim view the UI presents.
   */
  async list(filters: { employee_id?: string; status?: string; expense_type?: string | string[] }) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.employee_id) { conds.push("e.employee_id = ?"); params.push(filters.employee_id); }
    if (filters.status)      { conds.push("e.status = ?");      params.push(filters.status); }

    // expense_type reaches here straight off req.query on the privileged path, so
    // validate against the ENUM rather than trusting the caller — qs can hand us
    // arrays or objects, and an unrecognised value must not silently widen the
    // result set back to the whole ledger.
    const VALID_EXPENSE_TYPES = ["employee_claim", "vendor_bill", "imprest", "salary_advance"];
    const requested = filters.expense_type
      ? (Array.isArray(filters.expense_type) ? filters.expense_type : [filters.expense_type])
      : [];
    const types = requested.filter((t): t is string => typeof t === "string" && VALID_EXPENSE_TYPES.includes(t));
    const effectiveTypes = types.length > 0 ? types : ["employee_claim"];
    conds.push(`e.expense_type IN (${effectiveTypes.map(() => "?").join(", ")})`);
    params.push(...effectiveTypes);

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.*,
              CONCAT(emp.first_name, ' ', emp.last_name) AS employee_name,
              emp.employee_code
       FROM expense_claim e
       LEFT JOIN employees emp ON emp.id = e.employee_id
       ${where}
       ORDER BY e.expense_date DESC
       LIMIT 500`,
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

    // Refuse to review anything that is not an employee claim. The policy engine
    // below keys on `category`, and all 5,534 migrated vendor_bill/imprest rows
    // carry category 'other' — whose policy cap is ₹5,000 — so putting a ₹-crore
    // vendor bill through here would silently auto-reject it and stamp the row.
    // Vendor bills are settled through the GRN → vendor_payment_tracking flow,
    // not through this screen.
    if (claim.expense_type && claim.expense_type !== "employee_claim") {
      throw Object.assign(
        new Error(
          `Expense ${id} is a ${claim.expense_type} and cannot be reviewed here. ` +
          `Vendor bills and imprest are settled through the GRN and vendor payment flow.`,
        ),
        { statusCode: 409 },
      );
    }

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
      /*
       * The COLLATE is required, not defensive. billing_unit was created with the MySQL 8 server
       * default utf8mb4_0900_ai_ci while process_master.id is utf8mb4_unicode_ci, and comparing
       * two char(36) columns across that boundary raises ER_CANT_AGGREGATE_2COLLATIONS, so this
       * endpoint returned 500 rather than a list. The table is empty today, which is the only
       * reason no data was being hidden.
       *
       * 44 of the 915 base tables in mas_hrms carry the 0900 collation against 871 on
       * utf8mb4_unicode_ci, so the same join breaks anywhere else the two meet.
       */
      `SELECT bu.*, pm.process_code, pm.process_name
       FROM billing_unit bu
       LEFT JOIN process_master pm ON pm.id = bu.process_id COLLATE utf8mb4_unicode_ci
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
      // Same collation boundary as billing_unit above: billing_invoice is utf8mb4_0900_ai_ci,
      // process_master.id is utf8mb4_unicode_ci.
      `SELECT i.*, pm.process_code, pm.process_name
       FROM billing_invoice i
       LEFT JOIN process_master pm ON pm.id = i.process_id COLLATE utf8mb4_unicode_ci
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
              d.dept_name AS department_name
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
