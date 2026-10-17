// backend/src/modules/wfm/apr-cosec-cutover.ts
//
// Owner rollout decision 2026-10-17: "New days only". The APR vs COSEC reporting-manager decision
// (apr-cosec-manager-decision.service.ts) applies to attendance days ON OR AFTER this date. Earlier
// days keep the previous engine behaviour exactly: the 'apr_validated_by_cosec' COSEC auto-upgrade,
// and no manager item. Kept in its own module so the engine can import it statically without an
// import cycle through the decision service.

export const DEFAULT_APR_COSEC_MANAGER_DECISION_FROM = '2026-10-18';
const ENV_KEY = 'APR_COSEC_MANAGER_DECISION_FROM';
const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

let warned = false;

/** The cutover date (YYYY-MM-DD). A malformed env value is refused and the default applies. */
export function aprCosecManagerDecisionFrom(): string {
  const raw = String(process.env[ENV_KEY] ?? '').trim();
  if (!raw) return DEFAULT_APR_COSEC_MANAGER_DECISION_FROM;
  if (YMD.test(raw)) return raw;
  if (!warned) {
    warned = true;
    // console, not logger: this module stays dependency-free on purpose.
    console.warn(`[apr-cosec] ${ENV_KEY}="${raw}" is not YYYY-MM-DD; using ${DEFAULT_APR_COSEC_MANAGER_DECISION_FROM}`);
  }
  return DEFAULT_APR_COSEC_MANAGER_DECISION_FROM;
}

/** True when the manager-decision rule governs this attendance date (YYYY-MM-DD, or a longer ISO string). */
export function managerDecisionApplies(recordDate: string): boolean {
  return String(recordDate).slice(0, 10) >= aprCosecManagerDecisionFrom();
}
