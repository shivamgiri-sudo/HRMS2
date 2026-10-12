/**
 * NOC auto-clearance profile: the flag and the stage geometry that goes with it.
 *
 * Kept free of imports from noc-case.service.ts on purpose. The case service reads this to decide
 * stage ordering, and the auto-clear engine imports the case service to record decisions, so
 * putting these here keeps the dependency one-directional instead of a cycle ESM resolves as a
 * partially-initialised module.
 *
 * WHAT THE PROFILE CHANGES (only while the flag is on)
 *
 * - Stage order collapses from five serial tiers to two: every clearance stage opens together
 *   (tier 1) and HR is the single closing stage (tier 2).
 * - The employee form no longer blocks signatories; the form link still goes out, and the form
 *   only declares assets.
 * - Of Team Leader / Process Manager / Branch Manager, one accepted decision covers the other two
 *   (a single reporting-chain approval).
 * - HR cannot close the case before the Last Working Day.
 *
 * DEFAULT OFF. A gate that changes who must sign what needs an explicit switch-on after live
 * verification, and off must mean today's behaviour exactly. Unlike the salary release gate this
 * fails CLOSED to "off": an unreadable flag must not silently re-route a clearance chain.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export const NOC_AUTO_FLAG_KEY = "noc_auto_clearance_enabled";

/** Actor identity stamped on every decision the engine records. Never a real user id. */
export const NOC_SYSTEM_ACTOR_ID = "system:noc-auto-clear";
export const NOC_SYSTEM_ACTOR_NAME = "NOC auto-clearance";

export async function isNocAutoClearanceEnabled(): Promise<boolean> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT config_value FROM payroll_config_flags
        WHERE branch_id IS NULL AND process_id IS NULL AND config_key = ? LIMIT 1`,
      [NOC_AUTO_FLAG_KEY],
    );
    if (!rows.length) return false;
    return String(rows[0].config_value).trim().toLowerCase() === "true";
  } catch (err) {
    console.error(
      "[noc-auto] could not read the auto-clearance flag; treating it as OFF:",
      (err as Error).message,
    );
    return false;
  }
}

/** The reporting chain: one human decision among these covers the rest. */
export const CHAIN_STAGE_KEYS = [
  "team_leader",
  "process_manager",
  "branch_manager",
] as const;

const AUTO_TIER: Record<string, number> = {
  team_leader: 1,
  process_manager: 1,
  branch_manager: 1,
  it: 1,
  admin: 1,
  accounts: 1,
  finance: 1,
  hr: 2,
};

/** Effective tier under the profile. A stage the profile does not know keeps its stored tier. */
export function autoTierOf(stageKey: string, storedTier: number): number {
  return AUTO_TIER[stageKey] ?? storedTier;
}

export function isChainStage(stageKey: string): boolean {
  return (CHAIN_STAGE_KEYS as readonly string[]).includes(stageKey);
}

/** Hours of silence on the reporting chain before it is deemed covered (after escalation). */
export const CHAIN_DEEMED_AFTER_HOURS = 72;

/** How many days before the LWD the case may open under the profile. Matches the trigger window. */
export const NOC_OPEN_AHEAD_DAYS = 7;
