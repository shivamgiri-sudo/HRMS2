/**
 * The process a cost centre serves, for display beside its code on every P&L screen
 * (owner request 2026-09-15: "Cost Center should have the process name also in P&L all pages").
 *
 * Two sources, in order:
 *   1. process_master.process_name through cost_centre_master.process_id — the mapped process the
 *      Process Matrix uses, maintained by cost-centre-process-resolver.service.ts.
 *   2. cost_centre_master.process_name_bill — the billing process (campaign) name from db_bill,
 *      e.g. "Onfido LTD". Populated on most cost centres where process_id is still empty.
 *   3. cost_centre_master.billing_client_name — the invoiced client (migration 1227), for the
 *      few that carry nothing else, e.g. BSS/OB/NOIDA-2/984 → "Raritiq Designs Private Limited".
 * Checked on live 2026-09-15: 576 → "Onfido", 474 → "Godfrey Philips India Ltd", 647 → "IDAM
 * Natural Wellness" (all mapped); 302 → "DCPL" (billing name). None → null, code shown alone. Nothing is inferred from employees: a cost
 * centre spans several HR processes (see memory note "cost centre is not process"), so a guess
 * would print the wrong name.
 *
 * Usage: add ccProcessJoin() to the FROM clause and ccProcessNameSql() to the SELECT list.
 * Both take the cost_centre_master alias, so they fit whichever alias a query already uses.
 */
export const ccProcessJoin = (cc = "ccm", pm = "ccpm") =>
  `LEFT JOIN process_master ${pm} ON ${pm}.id = ${cc}.process_id`;

export const ccProcessNameSql = (cc = "ccm", pm = "ccpm") =>
  `COALESCE(NULLIF(TRIM(${pm}.process_name), ''), NULLIF(TRIM(${cc}.process_name_bill), ''), NULLIF(TRIM(${cc}.billing_client_name), ''))`;

/** "BSS/OB/Noida/647 · Vodafone CS" — or the code alone when no process is known. */
export function costCentreLabel(code: string, processName?: string | null): string {
  const p = processName?.trim();
  return p ? `${code} · ${p}` : code;
}
