import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";

/**
 * Vendor applicability — which legal entities and which branches may transact with a vendor.
 *
 * THREE SEPARATE CONCEPTS, NEVER MERGED
 * Vendor identity lives in vendor_master. Legal-entity applicability and branch applicability
 * live in their own tables, one row per pair. They are not columns on the vendor, not a
 * comma-separated list, and not — as the legacy system did it — encoded by duplicating the
 * vendor row per branch. db_bill.tbl_vendormaster holds 1,829 rows for 1,552 distinct names
 * because of exactly that: "Unicel Technologies Pvt. Ltd." exists six times across five
 * branches, each copy with its own PAN, GST number and payment history.
 *
 * NO ROWS MEANS UNRESTRICTED
 * A vendor nobody has restricted is available to every company and every branch. This is the
 * same rule vendor_expense_mapping uses, and it is what makes the feature safe to ship against
 * 1,821 live vendors: restriction is opt-in, so an empty table behaves exactly like today.
 * Read that sentence as a security property too — this is an ALLOW-list only once populated,
 * so callers must not treat "no rows" as "deny".
 */

export type VendorApplicability = {
  companies: { company_code: string; company_name?: string | null }[];
  branches: {
    branch_id: string;
    branch_name?: string | null;
    ship_to_name?: string | null;
    ship_to_address1?: string | null;
    ship_to_address2?: string | null;
    ship_to_address3?: string | null;
    ship_to_city?: string | null;
    ship_to_state?: string | null;
    ship_to_state_code?: string | null;
    ship_to_pincode?: string | null;
  }[];
};

const SHIP_TO_FIELDS = [
  "ship_to_name", "ship_to_address1", "ship_to_address2", "ship_to_address3",
  "ship_to_city", "ship_to_state", "ship_to_state_code", "ship_to_pincode",
] as const;

const trimOrNull = (value: unknown) => {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
};

export const vendorApplicabilityService = {
  async getForVendor(vendorId: string): Promise<VendorApplicability> {
    const [companies] = await db.execute<RowDataPacket[]>(
      `SELECT a.company_code, c.company_name
         FROM vendor_company_applicability a
         LEFT JOIN finance_company c ON c.company_code = a.company_code
        WHERE a.vendor_id = ? AND a.active_status = 1
        ORDER BY a.company_code`,
      [vendorId],
    );
    const [branches] = await db.execute<RowDataPacket[]>(
      `SELECT a.branch_id, b.branch_name, ${SHIP_TO_FIELDS.map((f) => `a.${f}`).join(", ")}
         FROM vendor_branch_applicability a
         LEFT JOIN branch_master b ON b.id = a.branch_id
        WHERE a.vendor_id = ? AND a.active_status = 1
        ORDER BY b.branch_name`,
      [vendorId],
    );
    return {
      companies: companies as VendorApplicability["companies"],
      branches: branches as VendorApplicability["branches"],
    };
  },

  /**
   * Replaces a vendor's applicability wholesale.
   *
   * Delete-then-insert inside one transaction, rather than a diff: the set is small, the UI
   * sends the whole picture, and a partial update that leaves a stale row behind would silently
   * keep a vendor available somewhere it was just removed from.
   */
  async replaceForVendor(
    vendorId: string,
    input: {
      companyCodes?: string[];
      branches?: Array<{ branchId: string } & Partial<Record<(typeof SHIP_TO_FIELDS)[number], string | null>>>;
    },
    actorUserId: string,
    existingConnection?: PoolConnection,
  ) {
    const connection = existingConnection ?? (await db.getConnection());
    const owned = !existingConnection;
    try {
      if (owned) await connection.beginTransaction();

      // Only what the caller actually sent is touched. Sending companies but not branches must
      // not wipe the branch list — the two are independent concepts and the UI edits them on
      // separate tabs.
      if (Array.isArray(input.companyCodes)) {
        await connection.execute(
          "DELETE FROM vendor_company_applicability WHERE vendor_id = ?",
          [vendorId],
        );
        const codes = [...new Set(input.companyCodes.map((c) => String(c).trim()).filter(Boolean))];
        for (const code of codes) {
          await connection.execute(
            `INSERT INTO vendor_company_applicability
               (id, vendor_id, company_code, active_status, created_by, created_at)
             VALUES (?, ?, ?, 1, ?, NOW())`,
            [randomUUID(), vendorId, code, actorUserId],
          );
        }
      }

      if (Array.isArray(input.branches)) {
        await connection.execute(
          "DELETE FROM vendor_branch_applicability WHERE vendor_id = ?",
          [vendorId],
        );
        const seen = new Set<string>();
        for (const row of input.branches) {
          const branchId = String(row?.branchId ?? "").trim();
          if (!branchId || seen.has(branchId)) continue;
          seen.add(branchId);
          await connection.execute(
            `INSERT INTO vendor_branch_applicability
               (id, vendor_id, branch_id, ${SHIP_TO_FIELDS.join(", ")},
                active_status, created_by, created_at)
             VALUES (?, ?, ?, ${SHIP_TO_FIELDS.map(() => "?").join(", ")}, 1, ?, NOW())`,
            [
              randomUUID(), vendorId, branchId,
              // NULL means "use the branch's own address". Copying the branch address in by
              // default would guarantee the two drift apart the first time a branch moves.
              ...SHIP_TO_FIELDS.map((field) => trimOrNull(row[field])),
              actorUserId,
            ],
          );
        }
      }

      if (owned) await connection.commit();
      return this.getForVendor(vendorId);
    } catch (error) {
      if (owned) await connection.rollback();
      throw error;
    } finally {
      if (owned) connection.release();
    }
  },

  /**
   * Whether a vendor may be used by this company/branch.
   *
   * Returns true when the vendor has no rows of that kind — unrestricted. Callers wanting to
   * FILTER a vendor list should use vendorFilterClause() below instead, so the restriction is
   * applied in SQL rather than by fetching every vendor and discarding most of them.
   */
  async isAvailable(vendorId: string, scope: { companyCode?: string; branchId?: string }) {
    const { companies, branches } = await this.getForVendor(vendorId);
    if (scope.companyCode && companies.length) {
      if (!companies.some((c) => c.company_code === scope.companyCode)) return false;
    }
    if (scope.branchId && branches.length) {
      if (!branches.some((b) => b.branch_id === scope.branchId)) return false;
    }
    return true;
  },

  /**
   * SQL predicate selecting vendors usable by a company/branch.
   *
   * The NOT EXISTS half is the "no rows means unrestricted" rule expressed in SQL: a vendor
   * with no applicability rows passes, and one with rows passes only if a matching row exists.
   * Written as a predicate rather than a JOIN so it can be dropped into the existing vendor
   * list query without changing its shape or its row count.
   */
  vendorFilterClause(
    alias: string,
    scope: { companyCode?: string | null; branchId?: string | null },
  ): { sql: string; params: string[] } {
    const clauses: string[] = [];
    const params: string[] = [];
    if (scope.companyCode) {
      clauses.push(
        `(NOT EXISTS (SELECT 1 FROM vendor_company_applicability vca
                       WHERE vca.vendor_id = ${alias}.id AND vca.active_status = 1)
          OR EXISTS (SELECT 1 FROM vendor_company_applicability vca
                      WHERE vca.vendor_id = ${alias}.id AND vca.active_status = 1
                        AND vca.company_code = ?))`,
      );
      params.push(scope.companyCode);
    }
    if (scope.branchId) {
      clauses.push(
        `(NOT EXISTS (SELECT 1 FROM vendor_branch_applicability vba
                       WHERE vba.vendor_id = ${alias}.id AND vba.active_status = 1)
          OR EXISTS (SELECT 1 FROM vendor_branch_applicability vba
                      WHERE vba.vendor_id = ${alias}.id AND vba.active_status = 1
                        AND vba.branch_id = ?))`,
      );
      params.push(scope.branchId);
    }
    return { sql: clauses.length ? clauses.join(" AND ") : "1=1", params };
  },

  /**
   * The Ship-To address for a vendor at a branch.
   *
   * The override if one is set, otherwise the branch's own address. Ship-To is where WE want
   * goods delivered, so the branch address is the correct default and the override exists only
   * for the vendor that delivers to a warehouse or a site office instead.
   */
  async resolveShipTo(vendorId: string, branchId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ${SHIP_TO_FIELDS.map((f) => `a.${f}`).join(", ")},
              b.branch_name, b.address AS branch_address, b.city AS branch_city,
              b.pincode AS branch_pincode, b.gst_state_code AS branch_state_code
         FROM branch_master b
         LEFT JOIN vendor_branch_applicability a
                ON a.branch_id = b.id AND a.vendor_id = ? AND a.active_status = 1
        WHERE b.id = ? LIMIT 1`,
      [vendorId, branchId],
    );
    const row = rows[0];
    if (!row) return null;
    const overridden = Boolean(trimOrNull(row.ship_to_address1));
    return {
      source: overridden ? ("vendor_branch_override" as const) : ("branch_master" as const),
      name: trimOrNull(row.ship_to_name) ?? row.branch_name ?? null,
      address1: overridden ? row.ship_to_address1 : (row.branch_address ?? null),
      address2: overridden ? row.ship_to_address2 : null,
      address3: overridden ? row.ship_to_address3 : null,
      city: overridden ? row.ship_to_city : (row.branch_city ?? null),
      state: overridden ? row.ship_to_state : null,
      state_code: overridden ? row.ship_to_state_code : (row.branch_state_code ?? null),
      pincode: overridden ? row.ship_to_pincode : (row.branch_pincode ?? null),
    };
  },
};
