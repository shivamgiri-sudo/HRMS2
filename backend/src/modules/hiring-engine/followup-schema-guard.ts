/**
 * Deploy window guard for the follow-up method's schema (migration 2138: qualified_followup.journey_state, followup_person). A statement
 * built with the new rule that fails because a column or table is not there yet is run again with the legacy rule (the old skip, no 7-day
 * hold), so the engine keeps inviting. One clear error is logged per process until the new rule works again. Any other error is thrown.
 */
import { isMissingSchemaError } from "../../db/db-error-classification.js";
import { logger } from "../../logger.js";

let logged = false;

export async function withFollowupSchema<T>(what: string, run: (legacy: boolean) => Promise<T>): Promise<T> {
  let out: T;
  try {
    out = await run(false);
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
    if (!logged) {
      logged = true;
      logger.error({ code: (err as { code?: unknown }).code ?? null, what },
        "[followup] migration 2138 is not applied (qualified_followup.journey_state / followup_person missing): engine statements run with the legacy skip until it is");
    }
    return run(true);
  }
  logged = false;
  return out;
}

/** Test hook. */
export const _resetFollowupSchemaLog = (): void => { logged = false; };
