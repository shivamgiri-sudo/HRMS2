import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/**
 * Which Head / Sub-head a vendor may be booked against, and — more importantly — which of
 * those the branch can actually afford this period.
 *
 * Requirement 2 asks that selecting a vendor stop exposing every head in the master. But a
 * vendor mapping on its own would let someone book against a head with no approved budget,
 * so the selectable set is an INTERSECTION:
 *
 *     {mapped to this vendor}  ∩  {active approved budget line for this branch+period
 *                                  with headroom left}
 *
 * A vendor mapping must never be able to bypass budget governance, and the intersection is
 * computed here, server-side. The dropdown is a convenience; this is the authority.
 */

/** Sentinel meaning "every sub-head under this head". See migration 1088 for why not NULL. */
const ALL_SUB_HEADS = "*";

/**
 * Budget lines store head/sub_head as free text (finance_budget_line.head is VARCHAR(255)),
 * not as foreign keys, so resolving one to the master is a name match. This is deliberately
 * the SAME predicate migration 418 uses for the P&L bucket view: if the picker and the P&L
 * disagreed about which head a budget line belongs to, a GRN could be raised against a head
 * it then reports under a different one.
 */
const HEAD_MATCH = `(LOWER(h.head_code) = LOWER(l.head) OR LOWER(h.head_name) = LOWER(l.head))`;
const SUB_HEAD_MATCH = `(LOWER(s.sub_head_code) = LOWER(COALESCE(l.sub_head, ''))
                      OR LOWER(s.sub_head_name) = LOWER(COALESCE(l.sub_head, '')))`;

export type ExpenseClassification = {
  head_id: string;
  head_code: string;
  head_name: string;
  sub_head_id: string;
  sub_head_code: string;
  sub_head_name: string;
  available_amount: number;
};

export type SelectableResult = {
  enforced: boolean;
  vendorHasMappings: boolean;
  selectable: ExpenseClassification[];
  /** Populated only when `selectable` is empty, so the UI can say why instead of showing a blank list. */
  reason?: string;
  /** What the vendor is mapped to, regardless of budget. Lets the UI explain the gap. */
  mappedButUnbudgeted: Array<{ head_name: string; sub_head_name: string }>;
};

export const vendorExpenseMappingService = {
  /**
   * Enforcement ships OFF (migration 1088 seeds 0). Every vendor in the system starts with no
   * mapping rows, so enforcing on day one would make every head unselectable for every vendor
   * and brick GRN creation entirely.
   */
  async isEnforced(): Promise<boolean> {
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT config_value FROM finance_config WHERE config_key = 'vendor_expense_mapping_enforced' LIMIT 1`,
      );
      return String(rows[0]?.config_value ?? "0") === "1";
    } catch {
      // finance_config is created by migration 1088. Treat its absence as "not enforced" so a
      // partially-migrated environment stays usable rather than blocking every GRN.
      return false;
    }
  },

  async listForVendor(vendorId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT m.id, m.vendor_id, m.head_code, m.sub_head_code,
              m.active_status, m.effective_from, m.effective_to,
              m.created_by, m.created_at, m.updated_at,
              h.id AS head_id, h.head_name,
              s.id AS sub_head_id, s.sub_head_name
         FROM vendor_expense_mapping m
         LEFT JOIN finance_expense_head_master h ON h.head_code = m.head_code
         LEFT JOIN finance_expense_sub_head_master s
                ON s.head_id = h.id AND s.sub_head_code = m.sub_head_code
        WHERE m.vendor_id = ?
        ORDER BY h.head_name, s.sub_head_name`,
      [vendorId],
    );
    return rows;
  },

  /**
   * Replace-set save: whatever the caller sends becomes the vendor's complete mapping.
   *
   * Rows the caller drops are DEACTIVATED, never deleted. A mapping that has governed which
   * heads a vendor could be booked against is an access-control fact, and historical GRNs were
   * raised under it — deleting the row would erase why a booking was once allowed. Deactivated
   * rows also mean a re-add restores the original created_by rather than inventing a new one.
   */
  async saveForVendor(
    vendorId: string,
    mappings: Array<{ headCode: string; subHeadCode?: string | null; effectiveFrom?: string | null; effectiveTo?: string | null }>,
    actorUserId: string,
  ) {
    if (!vendorId) throw new Error("Vendor is required");

    const seen = new Set<string>();
    const normalised = mappings.map((m) => {
      const headCode = String(m.headCode ?? "").trim();
      const subHeadCode = String(m.subHeadCode ?? "").trim() || ALL_SUB_HEADS;
      if (!headCode) throw new Error("Every mapping needs a head");
      const key = `${headCode}::${subHeadCode}`;
      if (seen.has(key)) throw new Error(`Duplicate mapping for ${headCode} / ${subHeadCode}`);
      seen.add(key);
      return { headCode, subHeadCode, effectiveFrom: m.effectiveFrom ?? null, effectiveTo: m.effectiveTo ?? null };
    });

    // Reject codes the master does not know before writing anything, so a typo cannot create a
    // mapping that silently matches nothing forever.
    for (const m of normalised) {
      const [head] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM finance_expense_head_master WHERE head_code = ? LIMIT 1`,
        [m.headCode],
      );
      if (!head.length) throw new Error(`Unknown expense head: ${m.headCode}`);
      if (m.subHeadCode !== ALL_SUB_HEADS) {
        const [sub] = await db.execute<RowDataPacket[]>(
          `SELECT s.id FROM finance_expense_sub_head_master s
             JOIN finance_expense_head_master h ON h.id = s.head_id
            WHERE h.head_code = ? AND s.sub_head_code = ? LIMIT 1`,
          [m.headCode, m.subHeadCode],
        );
        if (!sub.length) throw new Error(`Sub-head ${m.subHeadCode} does not belong to head ${m.headCode}`);
      }
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `UPDATE vendor_expense_mapping SET active_status = 0, updated_by = ? WHERE vendor_id = ?`,
        [actorUserId, vendorId],
      );
      for (const m of normalised) {
        await connection.execute(
          `INSERT INTO vendor_expense_mapping
             (id, vendor_id, head_id, head_code, sub_head_id, sub_head_code,
              active_status, effective_from, effective_to, created_by, created_at)
           SELECT ?, ?, h.id, h.head_code, s.id, ?, 1, ?, ?, ?, NOW()
             FROM finance_expense_head_master h
             LEFT JOIN finance_expense_sub_head_master s
                    ON s.head_id = h.id AND s.sub_head_code = ?
            WHERE h.head_code = ?
           ON DUPLICATE KEY UPDATE
             active_status = 1,
             effective_from = VALUES(effective_from),
             effective_to = VALUES(effective_to),
             updated_by = VALUES(created_by)`,
          [randomUUID(), vendorId, m.subHeadCode, m.effectiveFrom, m.effectiveTo, actorUserId, m.subHeadCode, m.headCode],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: "VENDOR_EXPENSE_MAPPING_SAVED",
      module_key: "finance",
      entity_type: "vendor",
      entity_id: vendorId,
      change_summary: {
        mappings: normalised.map((m) => `${m.headCode}/${m.subHeadCode}`),
      },
    }).catch(() => undefined);

    return this.listForVendor(vendorId);
  },

  /**
   * The selectable Head / Sub-head set for a GRN.
   *
   * Budget is the floor and is applied unconditionally — even with enforcement off, and even
   * for a vendor with no mappings, you can only pick something the branch has approved budget
   * for. The vendor mapping narrows that set further, and only when it exists.
   */
  async selectableClassifications(input: {
    vendorId?: string | null;
    branchId: string;
    periodCode?: string | null;
    processId?: string | null;
    costCentreId?: string | null;
  }): Promise<SelectableResult> {
    if (!input.branchId) throw new Error("Branch is required");

    const enforced = await this.isEnforced();
    const vendorId = input.vendorId?.trim() || null;

    let vendorHasMappings = false;
    if (vendorId) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT 1 FROM vendor_expense_mapping
          WHERE vendor_id = ? AND active_status = 1
            AND (effective_from IS NULL OR effective_from <= CURDATE())
            AND (effective_to IS NULL OR effective_to >= CURDATE())
          LIMIT 1`,
        [vendorId],
      );
      vendorHasMappings = rows.length > 0;
    }

    const conditions = ["bh.branch_id = ?", "bh.status = 'active'", "h.active_status = 1", "s.active_status = 1"];
    const params: unknown[] = [input.branchId];
    if (input.periodCode) {
      conditions.push("bh.period_code = ?");
      params.push(input.periodCode);
    }
    if (input.processId) {
      conditions.push("(l.process_id = ? OR l.process_id IS NULL)");
      params.push(input.processId);
    }
    if (input.costCentreId) {
      conditions.push("(l.cost_centre_id = ? OR l.cost_centre_id IS NULL)");
      params.push(input.costCentreId);
    }

    // A vendor with NO mappings is UNRESTRICTED, not "nothing selectable". Every vendor starts
    // that way, and the opposite reading would block a GRN for every vendor Finance has not yet
    // got round to mapping.
    const applyVendorFilter = enforced && vendorHasMappings && vendorId;
    if (applyVendorFilter) {
      conditions.push(`EXISTS (
        SELECT 1 FROM vendor_expense_mapping m
         WHERE m.vendor_id = ?
           AND m.active_status = 1
           AND m.head_code = h.head_code
           AND (m.sub_head_code = s.sub_head_code OR m.sub_head_code = '${ALL_SUB_HEADS}')
           AND (m.effective_from IS NULL OR m.effective_from <= CURDATE())
           AND (m.effective_to IS NULL OR m.effective_to >= CURDATE()))`);
      params.push(vendorId);
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT h.id AS head_id, h.head_code, h.head_name,
              s.id AS sub_head_id, s.sub_head_code, s.sub_head_name,
              SUM(l.gross_amount - l.reserved_amount - l.consumed_amount) AS available_amount
         FROM finance_budget_line l
         JOIN finance_budget_header bh ON bh.id = l.budget_id
         JOIN finance_expense_head_master h ON ${HEAD_MATCH}
         JOIN finance_expense_sub_head_master s ON s.head_id = h.id AND ${SUB_HEAD_MATCH}
        WHERE ${conditions.join(" AND ")}
        GROUP BY h.id, h.head_code, h.head_name, s.id, s.sub_head_code, s.sub_head_name
       HAVING available_amount > 0
        ORDER BY h.head_name, s.sub_head_name`,
      params,
    );

    const selectable = rows as ExpenseClassification[];

    // Always return the full vendor mapping list alongside the budget-filtered selectable so the
    // frontend can show all vendor-approved sub-heads (not just the ones with live budget headroom).
    // Previously this was only populated when selectable was empty, which hid valid sub-heads
    // whenever even one other sub-head happened to have an active budget line.
    let reason: string | undefined;
    let mappedButUnbudgeted: SelectableResult["mappedButUnbudgeted"] = [];
    if (applyVendorFilter) {
      const [mapped] = await db.execute<RowDataPacket[]>(
        `SELECT h.head_name, COALESCE(s.sub_head_name, 'All sub-heads') AS sub_head_name
           FROM vendor_expense_mapping m
           JOIN finance_expense_head_master h ON h.head_code = m.head_code
           LEFT JOIN finance_expense_sub_head_master s
                  ON s.head_id = h.id AND s.sub_head_code = m.sub_head_code
          WHERE m.vendor_id = ? AND m.active_status = 1`,
        [vendorId],
      );
      mappedButUnbudgeted = mapped as SelectableResult["mappedButUnbudgeted"];
    }
    if (selectable.length === 0) {
      if (applyVendorFilter) {
        reason = mappedButUnbudgeted.length
          ? "This vendor is mapped to expense heads that have no approved budget with remaining balance for this branch and period."
          : "This vendor has no active expense mapping.";
      } else {
        reason = "This branch has no approved budget line with remaining balance for this period.";
      }
    }

    return { enforced, vendorHasMappings, selectable, reason, mappedButUnbudgeted };
  },
};
