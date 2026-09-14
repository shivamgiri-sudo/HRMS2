/**
 * The address a document should print: the branch that issued it.
 *
 * Four different company addresses were hardcoded across the renderers —
 * "B-24, Okhla Phase-II" in the joining-document letterhead, a Karampura
 * registered office on the experience letter, "Corporate Office: Mumbai, India"
 * on the offer letter, and nothing at all on the appointment letter and payslip.
 * None of them reflected where the employee actually works.
 *
 * Only the digital ID card ever resolved a real branch address
 * (employee.secure.routes.ts + EmployeeIDCard.tsx). This lifts that fallback
 * chain into one place so every document can use it.
 *
 * Note branch_master has a single free-text `address VARCHAR(500)` holding the
 * whole postal address newline-separated — there is no pincode or full_address
 * column — and roughly 41 of 45 branches have it NULL. Callers must handle
 * `hasAddress === false` rather than printing an empty letterhead.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export type BranchLetterhead = {
  branchId: string | null;
  branchName: string;
  /** Postal address, one line per element. Empty when the branch has none. */
  addressLines: string[];
  city: string;
  state: string;
  hrContact: string;
  /** False when branch_master.address is NULL/blank — do not print a letterhead. */
  hasAddress: boolean;
};

export const EMPTY_LETTERHEAD: BranchLetterhead = {
  branchId: null, branchName: "", addressLines: [], city: "", state: "", hrContact: "", hasAddress: false,
};

/** Per-process cache: branch addresses change at most a few times a year. */
const cache = new Map<string, BranchLetterhead>();

export function clearBranchLetterheadCache() { cache.clear(); }

export async function resolveBranchLetterhead(branchId: string | null | undefined): Promise<BranchLetterhead> {
  if (!branchId) return EMPTY_LETTERHEAD;
  const hit = cache.get(branchId);
  if (hit) return hit;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_name, COALESCE(address, '') AS address, COALESCE(city, '') AS city,
            COALESCE(state, '') AS state, COALESCE(hr_contact, '') AS hr_contact
       FROM branch_master WHERE id = ? LIMIT 1`,
    [branchId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const b = (rows as RowDataPacket[])[0];
  if (!b) return EMPTY_LETTERHEAD;

  const raw = String(b.address ?? "").trim();
  // Same chain the ID card uses: prefer the full postal address, which already
  // carries city/state/pincode; otherwise fall back to name + city/state.
  const addressLines = raw
    ? raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    : [String(b.city ?? ""), String(b.state ?? "")].filter(Boolean).join(", ")
      ? [[String(b.city ?? ""), String(b.state ?? "")].filter(Boolean).join(", ")]
      : [];

  const out: BranchLetterhead = {
    branchId: String(b.id),
    branchName: String(b.branch_name ?? ""),
    addressLines,
    city: String(b.city ?? ""),
    state: String(b.state ?? ""),
    hrContact: String(b.hr_contact ?? ""),
    hasAddress: Boolean(raw),
  };
  cache.set(branchId, out);
  return out;
}

/** Resolve straight from an employee, which is what every renderer actually has. */
export async function resolveEmployeeLetterhead(employeeId: string): Promise<BranchLetterhead> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  return resolveBranchLetterhead((rows as RowDataPacket[])[0]?.branch_id ?? null);
}

/**
 * Refuse to issue a document whose letterhead would be blank.
 *
 * employees.branch_id is nullable and its FK is ON DELETE SET NULL, and the
 * candidate->employee conversion deliberately stores NULL when applied_for_branch
 * matches neither a branch id nor a name. Combined with the ~41 branches that
 * have no address, silently printing an empty letterhead is a real outcome —
 * so make it a visible blocker instead.
 */
export function assertPrintableLetterhead(lh: BranchLetterhead): BranchLetterhead {
  if (!lh.branchId) {
    throw Object.assign(
      new Error("This employee has no branch assigned, so the issuing office cannot be printed on the letter."),
      { statusCode: 409, code: "branch_not_assigned" },
    );
  }
  if (!lh.hasAddress) {
    throw Object.assign(
      new Error(`Branch "${lh.branchName}" has no address on record. Add its Full Address in Organisation Masters before issuing letters from it.`),
      { statusCode: 409, code: "branch_address_missing" },
    );
  }
  return lh;
}

/** Single-line form for compact footers. */
export function letterheadOneLine(lh: BranchLetterhead): string {
  return lh.addressLines.join(", ");
}
