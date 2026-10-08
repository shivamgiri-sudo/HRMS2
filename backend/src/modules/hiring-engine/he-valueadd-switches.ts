/**
 * Plan 5 switches. Environment only (a database read would add a statement to the legacy paths). On only when the value, trimmed and
 * lower-cased, is "true" ("true", "TRUE", " true "); anything else ("1", "yes", "on", empty, unset) is off.
 */
export const VALUE_ADD_ENV = {
  showrate_calibration: "HE_SHOWRATE_CALIBRATION",
  best_offer: "HE_BEST_OFFER",
  smart_slots: "HE_SMART_SLOTS",
  action_queue: "HE_ACTION_QUEUE",
  cost_per_source: "HE_COST_PER_SOURCE",
  outcome_reasons: "HE_OUTCOME_REASONS",
} as const;

export type ValueAdd = keyof typeof VALUE_ADD_ENV;

export function valueAddOn(name: ValueAdd, env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env[VALUE_ADD_ENV[name]] ?? "").trim().toLowerCase() === "true";
}
