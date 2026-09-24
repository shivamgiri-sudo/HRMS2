/**
 * HRMS shows MAS Callnet cost centres only (owner rule, 2026-09-24). cost_centre_master also holds
 * IDC and Pikquick cost centres synced from db_bill; they must not surface in any HRMS picker or
 * master list. The source spells the company several ways ("MAS Call Net India Pvt Ltd",
 * "Mas Callnet India Pvt. Ltd."), so it is matched on a normalised name, the same predicate the
 * P&L uses (OWN_COMPANY_SQL in process-pnl/pnl-actuals.service.ts).
 *
 * `alias` is the alias of cost_centre_master in the calling query.
 */
export function ownCompanyCostCentreSql(alias: string): string {
  return `REPLACE(REPLACE(REPLACE(LOWER(COALESCE(${alias}.company_name, '')), '.', ''), ' ', ''), ',', '') LIKE '%mascallnet%'`;
}

/**
 * DialDesk (branch NOIDA-DIALDESK, company "Ispark Dataconnect Pvt Ltd") is an IDC entity, not MAS
 * Callnet (owner rule, 2026-09-24). A branch is hidden when its company is recorded and is not
 * MAS Callnet; legacy branches with no company recorded stay visible.
 *
 * `alias` is the alias of branch_master in the calling query (empty when unaliased).
 */
export function ownCompanyBranchSql(alias: string): string {
  const col = alias ? `${alias}.company_name` : "company_name";
  return `(NULLIF(TRIM(COALESCE(${col}, '')), '') IS NULL OR REPLACE(REPLACE(REPLACE(LOWER(${col}), '.', ''), ' ', ''), ',', '') LIKE '%mascallnet%')`;
}

/**
 * A process belongs to DialDesk when its branch is a non-MAS company branch, or its own name says
 * so (several DialDesk processes carry no branch at all). `processAlias` is process_master,
 * `branchAlias` is the LEFT JOINed branch_master.
 */
export function notDialDeskProcessSql(processAlias: string, branchAlias: string): string {
  return `(${ownCompanyBranchSql(branchAlias)} AND REPLACE(LOWER(COALESCE(${processAlias}.process_name, '')), ' ', '') NOT LIKE '%dialdesk%')`;
}
