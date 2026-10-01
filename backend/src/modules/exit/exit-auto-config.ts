import { getPolicyValue } from "../policy-engine/policy-engine.cache.js";

/** Actor recorded in exit_approval_log for transitions made by the system, not a person. */
export const AUTO_ACTOR = "system";

/**
 * Company policy for hands-off exit progression (owner ruling 2026-10-01: "auto movement, no
 * human dependency to move the bucket"). Every switch is read through business_policy_config so
 * it can be changed without a deploy; the fallbacks below are what applies when nothing is seeded.
 */
const flag = async (key: string, fallback: string) =>
  (await getPolicyValue("exit", "auto", key, fallback)).trim() !== "0";

/** Master switch. Set exit/auto/enabled to 0 to stop every automatic move. */
export const isExitAutoEnabled = () => flag("enabled", "1");
/** manager_review -> accepted after this many hours with no manager action. 0 = immediately. */
export const autoAcceptAfterHours = async () =>
  Math.max(0, Number(await getPolicyValue("exit", "auto", "accept_after_hours", "48")) || 0);
/** accepted -> notice_serving, confirming the employee's proposed last working day if HR set none. */
export const isAutoStartNotice = () => flag("start_notice", "1");
/** notice_serving -> exited the day after the confirmed last working day. */
export const isAutoExitAtLwd = () => flag("exit_at_lwd", "1");
