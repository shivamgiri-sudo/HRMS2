// Selection switches. All OFF by default.
//  - policy.shortlist.enrol (he_model_param, DB): approved shortlists may be handed to the follow-up enrolment.
//  - SELECTION_CRITERIA_LINEUP (env): the drive line-up reads HR's saved criteria (selection_rules) through a separate
//    read: "off" (default), "all", or a comma list of requisition ids. Env, not DB, so the pinned line-up issues no extra
//    statement while it is off (the he-drive value-add switches work the same way).
//  - SELECTION_FOLLOWUP_GUARD (env): the follow-up stop checks honour criteria verdicts (S14) and a criteria version
//    re-checks enrolled people. Off = the pinned stop checks, byte for byte.
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export const ENROL_KEY = "policy.shortlist.enrol";

export async function shortlistEnrolOn(): Promise<boolean> {
  try {
    const [r] = await db.execute<RowDataPacket[]>("SELECT value FROM he_model_param WHERE param_key = ? LIMIT 1", [ENROL_KEY]);
    return r[0] ? Number(r[0].value) === 1 : false;
  } catch { return false; }
}

export function lineupReadsCriteria(requisitionId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.SELECTION_CRITERIA_LINEUP ?? "").trim();
  if (!v || v === "off" || v === "0" || v === "false") return false;
  if (v === "all" || v === "1" || v === "true") return true;
  return v.split(",").map((s) => s.trim()).includes(requisitionId);
}

export function followupGuardOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|on)$/i.test(String(env.SELECTION_FOLLOWUP_GUARD ?? "").trim());
}
