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
 * DialDesk and I-Spark are IDC entities, not MAS Callnet India Pvt Ltd (owner rule, 2026-09-24).
 * DialDesk is branch NOIDA-DIALDESK (company "Ispark Dataconnect Pvt Ltd"); I-Spark is
 * NOIDA-ISPARK / NOIDA ISPARK-2. A branch is hidden when its company is recorded and is not MAS
 * Callnet, or its own name says DialDesk / I-Spark; legacy branches with no company stay visible.
 *
 * `alias` is the alias of branch_master in the calling query (empty when unaliased).
 */
export function ownCompanyBranchSql(alias: string): string {
  const p = alias ? `${alias}.` : "";
  return `((NULLIF(TRIM(COALESCE(${p}company_name, '')), '') IS NULL OR REPLACE(REPLACE(REPLACE(LOWER(${p}company_name), '.', ''), ' ', ''), ',', '') LIKE '%mascallnet%')`
    + ` AND REPLACE(REPLACE(LOWER(COALESCE(${p}branch_name, '')), ' ', ''), '-', '') NOT LIKE '%dialdesk%'`
    + ` AND REPLACE(REPLACE(LOWER(COALESCE(${p}branch_name, '')), ' ', ''), '-', '') NOT LIKE '%ispark%')`;
}

/**
 * A process belongs to DialDesk / I-Spark when its branch is one of those, or its own name says so
 * (several carry no branch at all). `processAlias` is process_master, `branchAlias` is the LEFT
 * JOINed branch_master.
 */
export function notDialDeskProcessSql(processAlias: string, branchAlias: string): string {
  // Name, code and client together: a few DialDesk / I-Spark processes sit on a MAS branch and are
  // recognisable only by their code (BSS_BLD_NOI_ISPARK_563) or client ("Ispark dataconnect Pvt Ltd").
  const id = `REPLACE(REPLACE(LOWER(CONCAT_WS(' ', ${processAlias}.process_name, ${processAlias}.process_code, ${processAlias}.client_name)), ' ', ''), '-', '')`;
  return `(${ownCompanyBranchSql(branchAlias)} AND ${id} NOT LIKE '%dialdesk%' AND ${id} NOT LIKE '%ispark%' AND ${id} NOT LIKE '%dataconnect%')`;
}

/**
 * A GRN belongs to DialDesk / I-Spark / IDC when its branch is one of those, or its cost centre
 * belongs to another company. The hidden branch / cost-centre ids are uncorrelated subqueries, which
 * MySQL evaluates once instead of once per GRN row (85k rows), and the IS NULL arms keep GRNs that
 * have no branch or cost centre visible. `grnAlias` is grn_request.
 */
export function ownCompanyGrnSql(grnAlias: string): string {
  return `((${grnAlias}.branch_id IS NULL OR ${grnAlias}.branch_id NOT IN (SELECT hb.id FROM branch_master hb WHERE NOT ${ownCompanyBranchSql("hb")}))`
    + ` AND (${grnAlias}.cost_centre_id IS NULL OR ${grnAlias}.cost_centre_id NOT IN (SELECT hc.id FROM cost_centre_master hc WHERE NULLIF(TRIM(COALESCE(hc.company_name, '')), '') IS NOT NULL AND NOT (${ownCompanyCostCentreSql("hc")}))))`;
}
