import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';

/**
 * Minimum-wage validation gate for salary packages and offers.
 *
 * minimum_wage_master (backend/sql/028_statutory_compliance.sql) has a working CRUD
 * API and admin UI tab, and today holds real data — but nothing anywhere reads it back
 * to validate a proposed salary package or CTC offer. This module is that read path.
 *
 * PATTERN: this follows the same shape already used elsewhere in payroll for "we cannot
 * be sure this figure is right" — TDS's `status: "pending_configuration"`
 * (payroll/payrollCalculate.service.ts calculateTds) and gratuity's `reason:
 * "not_configured"` (calculateGratuity) return a result object rather than throwing, so a
 * caller can tell "genuinely fine" from "nothing to check against" from "below the floor".
 * F&F's `is_ff_provisional` flag (exit/ff.service.ts) is the stored-row equivalent: a
 * package or offer that fails this check is marked provisional, not silently accepted and
 * not hard-blocked — same as the charter's existing TDS/gratuity/LWP rule ("provisional/
 * blocked without configured effective-dated config" — not silently allowed, not
 * hard-failed with no path forward).
 *
 * NO CATEGORY CONCEPT AT THE CALL SITES
 * minimum_wage_master keys on (state_code, category) where category is
 * unskilled/semi_skilled/skilled/highly_skilled. Neither salary_package_master
 * (band_code A..E, a pay-grade concept, not a skill category) nor the ATS offer flow
 * carries anything mapping to that enum. Comparing against MIN(monthly_rate) across all
 * active categories for the state — always the 'unskilled' rate, since categories are
 * monotonically increasing — is the most defensible floor available without inventing a
 * category no caller has: if a package is below even the lowest statutory rate for its
 * state, it needs review regardless of which grade it was meant to be.
 *
 * STATE RESOLUTION
 * minimum_wage_master.state_name is blank on every live row (verified 2026-08-19) — only
 * state_code (2-letter, e.g. DL/HR/KA/MH/TS/UP) is usable, unlike pt_slab_master, which
 * has both columns populated and can be matched on name or code. So a name -> code table
 * is required here. employees.state and branch_master.state store full names, inconsistent
 * case ("GUJARAT", "Gujarat", "TELANGANA" — the same fact professional-tax-states.ts
 * documents for PT). The map below normalises punctuation/case before lookup and also
 * accepts an input that is already a valid 2-letter code.
 */

// ── State name -> code normalisation ────────────────────────────────────────────

/**
 * Full state/UT name -> the 2-letter code minimum_wage_master and pt_slab_master key on.
 * Keys are pre-normalised through cleanKey() below; a few common alternate spellings and
 * legacy names are included (Orissa, Pondicherry, Uttaranchal) because they appear in
 * real free-text branch/employee data even though they are not the current legal name.
 */
const STATE_NAME_TO_CODE: Record<string, string> = {
  'ANDHRA PRADESH': 'AP',
  'ARUNACHAL PRADESH': 'AR',
  ASSAM: 'AS',
  BIHAR: 'BR',
  CHHATTISGARH: 'CG',
  GOA: 'GA',
  GUJARAT: 'GJ',
  HARYANA: 'HR',
  'HIMACHAL PRADESH': 'HP',
  JHARKHAND: 'JH',
  KARNATAKA: 'KA',
  KERALA: 'KL',
  'MADHYA PRADESH': 'MP',
  MAHARASHTRA: 'MH',
  MANIPUR: 'MN',
  MEGHALAYA: 'ML',
  MIZORAM: 'MZ',
  NAGALAND: 'NL',
  ODISHA: 'OD',
  ORISSA: 'OD',
  PUNJAB: 'PB',
  RAJASTHAN: 'RJ',
  SIKKIM: 'SK',
  'TAMIL NADU': 'TN',
  TELANGANA: 'TS',
  TRIPURA: 'TR',
  'UTTAR PRADESH': 'UP',
  UTTARAKHAND: 'UK',
  UTTARANCHAL: 'UK',
  'WEST BENGAL': 'WB',
  // Union territories
  'ANDAMAN AND NICOBAR ISLANDS': 'AN',
  CHANDIGARH: 'CH',
  'DADRA AND NAGAR HAVELI AND DAMAN AND DIU': 'DN',
  DELHI: 'DL',
  'NCT OF DELHI': 'DL',
  'NEW DELHI': 'DL',
  'JAMMU AND KASHMIR': 'JK',
  LADAKH: 'LA',
  LAKSHADWEEP: 'LD',
  PUDUCHERRY: 'PY',
  PONDICHERRY: 'PY',
};

/** Every code the map above (and minimum_wage_master's own convention) can produce. */
const KNOWN_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

/** Upper-case, punctuation-folded, whitespace-collapsed. "U.P." -> "UP", "Jammu & Kashmir" -> "JAMMU AND KASHMIR". */
function cleanKey(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a free-text state (full name, any case/punctuation) or an already-valid
 * 2-letter code to the code minimum_wage_master keys on. Returns null rather than
 * guessing when the input is empty or not recognised — an unrecognised state must fall
 * through to the "state_unresolved" gate result, not be silently skipped or matched to
 * the wrong state.
 */
export function normalizeStateToCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = cleanKey(raw);
  if (!cleaned) return null;
  const compact = cleaned.replace(/\s+/g, '');
  if (compact.length === 2 && KNOWN_CODES.has(compact)) return compact;
  return STATE_NAME_TO_CODE[cleaned] ?? null;
}

// ── State resolution for a given employee / branch ──────────────────────────────

function firstRow<T extends RowDataPacket>(rows: unknown): T | undefined {
  return Array.isArray(rows) ? (rows[0] as T | undefined) : undefined;
}

/**
 * Resolve the applicable state for an employee.
 * Primary source: employees.state (~79% direct coverage, measured 2026-08-19).
 * Fallback: branch_master.state via employees.branch_id — covers most of the remainder.
 * Returns the raw state string (not yet normalised to a code) or null if neither source
 * has one.
 */
export async function resolveStateForEmployee(employeeId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.state, bm.state AS branch_state
       FROM employees e
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
      WHERE e.id = ?
      LIMIT 1`,
    [employeeId],
  );
  const row = firstRow<RowDataPacket & { state: string | null; branch_state: string | null }>(rows);
  if (!row) return null;
  const direct = row.state && String(row.state).trim();
  if (direct) return direct;
  const viaBranch = row.branch_state && String(row.branch_state).trim();
  return viaBranch || null;
}

/** Resolve a branch's state directly by branch_id — the FK path, unambiguous by construction. */
export async function resolveStateForBranchId(branchId: string | null | undefined): Promise<string | null> {
  if (!branchId) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT state FROM branch_master WHERE id = ? LIMIT 1`,
    [branchId],
  );
  const row = firstRow<RowDataPacket & { state: string | null }>(rows);
  const state = row?.state && String(row.state).trim();
  return state || null;
}

/**
 * Resolve a branch's state by NAME — needed because salary_package_master is keyed on
 * branch_name text, not branch_id. Matched case/whitespace-insensitively against
 * branch_master.branch_name, same convention professional-tax-states.ts documents for
 * the same table.
 *
 * Deliberately returns null (unresolved) rather than a guess when the name matches more
 * than one branch_master row that disagree on state (e.g. "HEAD OFFICE" — verified live,
 * 2026-08-19, resolves to both Maharashtra and Uttar Pradesh across two rows). Picking
 * either arbitrarily would be exactly the silent-wrong-answer failure mode this gate
 * exists to avoid; an ambiguous name falls through to the "state could not be resolved"
 * path, which is honest.
 */
export async function resolveStateForBranchName(branchName: string | null | undefined): Promise<string | null> {
  if (!branchName || !branchName.trim()) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT state
       FROM branch_master
      WHERE LOWER(TRIM(branch_name)) = LOWER(TRIM(?))
        AND state IS NOT NULL AND state <> ''`,
    [branchName],
  );
  const list = Array.isArray(rows) ? (rows as Array<{ state: string }>) : [];
  if (list.length !== 1) return null;
  return list[0].state;
}

// ── The floor check itself ───────────────────────────────────────────────────────

export type MinimumWageGateStatus = 'ok' | 'below_floor' | 'not_configured' | 'state_unresolved';

export interface MinimumWageGateResult {
  status: MinimumWageGateStatus;
  /** True for every status except 'ok' — the caller's provisional/needs-review flag. */
  provisional: boolean;
  state_raw: string | null;
  state_code: string | null;
  amount_monthly: number;
  /** MIN(monthly_rate) across active categories for the resolved state, if any rows exist. */
  floor_monthly: number | null;
  shortfall: number | null;
  /** Short human-readable reason, written to *_min_wage_check_note columns. */
  note: string;
}

interface MinWageFloorRow extends RowDataPacket {
  floor_monthly: number | null;
  row_count: number;
}

/**
 * Compare a monthly amount against the minimum-wage floor for a (possibly unresolved)
 * state. Never throws — mirrors calculateTds/calculateGratuity's "return a status, don't
 * block the caller" shape. The caller decides what a non-'ok' status means for its own
 * write path (here: set *_min_wage_provisional = 1 and store the note).
 */
export async function evaluateMinimumWageFloor(
  stateRaw: string | null | undefined,
  amountMonthly: number,
): Promise<MinimumWageGateResult> {
  const code = normalizeStateToCode(stateRaw ?? null);
  if (!code) {
    return {
      status: 'state_unresolved',
      provisional: true,
      state_raw: stateRaw ?? null,
      state_code: null,
      amount_monthly: amountMonthly,
      floor_monthly: null,
      shortfall: null,
      note: stateRaw
        ? `State "${stateRaw}" could not be resolved to a minimum_wage_master state code.`
        : 'No state could be resolved for this record — minimum-wage floor not checked.',
    };
  }

  const [rows] = await db.execute<MinWageFloorRow[]>(
    `SELECT MIN(monthly_rate) AS floor_monthly, COUNT(*) AS row_count
       FROM minimum_wage_master
      WHERE state_code = ? AND is_active = 1`,
    [code],
  );
  const row = firstRow<MinWageFloorRow>(rows);
  const rowCount = Number(row?.row_count ?? 0);

  if (!row || rowCount === 0 || row.floor_monthly === null) {
    return {
      status: 'not_configured',
      provisional: true,
      state_raw: stateRaw ?? null,
      state_code: code,
      amount_monthly: amountMonthly,
      floor_monthly: null,
      shortfall: null,
      note: `No active minimum_wage_master rows configured for state "${code}" — floor not checked.`,
    };
  }

  const floor = Number(row.floor_monthly);
  if (amountMonthly < floor) {
    const shortfall = Math.round((floor - amountMonthly) * 100) / 100;
    return {
      status: 'below_floor',
      provisional: true,
      state_raw: stateRaw ?? null,
      state_code: code,
      amount_monthly: amountMonthly,
      floor_monthly: floor,
      shortfall,
      note: `₹${amountMonthly}/month is below the ${code} minimum-wage floor of ₹${floor}/month (shortfall ₹${shortfall}).`,
    };
  }

  return {
    status: 'ok',
    provisional: false,
    state_raw: stateRaw ?? null,
    state_code: code,
    amount_monthly: amountMonthly,
    floor_monthly: floor,
    shortfall: null,
    note: `₹${amountMonthly}/month clears the ${code} minimum-wage floor of ₹${floor}/month.`,
  };
}

// ── Convenience wrappers: resolve + evaluate in one call ────────────────────────

export async function evaluateMinimumWageForBranchName(
  branchName: string | null | undefined,
  amountMonthly: number,
): Promise<MinimumWageGateResult> {
  const state = await resolveStateForBranchName(branchName);
  return evaluateMinimumWageFloor(state, amountMonthly);
}

export async function evaluateMinimumWageForBranchId(
  branchId: string | null | undefined,
  amountMonthly: number,
): Promise<MinimumWageGateResult> {
  const state = await resolveStateForBranchId(branchId);
  return evaluateMinimumWageFloor(state, amountMonthly);
}

export async function evaluateMinimumWageForEmployee(
  employeeId: string,
  amountMonthly: number,
): Promise<MinimumWageGateResult> {
  const state = await resolveStateForEmployee(employeeId);
  return evaluateMinimumWageFloor(state, amountMonthly);
}
