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
