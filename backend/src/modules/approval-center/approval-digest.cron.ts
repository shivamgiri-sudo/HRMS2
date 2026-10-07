import { runApprovalDigest } from "./approval-email.service.js";

const RUN_HOUR_IST = 9;
let timer: NodeJS.Timeout | undefined;

function msUntilNextRun(now = new Date()): number {
  // IST = UTC+5:30
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  const next = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), RUN_HOUR_IST, 0, 0));
  if (next.getTime() <= ist.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - ist.getTime();
}

/** Daily 09:00 IST "approvals waiting for you" mail with one-click buttons. Off unless APPROVAL_DIGEST_EMAIL_ENABLED=true. */
export function startApprovalDigestScheduler(): void {
  if (process.env.APPROVAL_DIGEST_EMAIL_ENABLED !== "true") return;
  const arm = () => {
    timer = setTimeout(async () => {
      try {
        const r = await runApprovalDigest();
        console.log(`[approval-digest] ${r.emailed}/${r.users} approvers emailed, ${r.items} items`);
      } catch (e) {
        console.error("[approval-digest] run failed:", (e as Error).message);
      }
      arm();
    }, msUntilNextRun());
    timer.unref?.();
  };
  arm();
}
