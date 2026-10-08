// Scheduler for the missing-roster-upload escalation sweep.
//
// Off by default. Both switches are read straight from process.env, like the daily-brief cron:
//   ROSTER_UPLOAD_ESCALATION_ENABLED=true   register the timer (otherwise a no-op)
//   ROSTER_UPLOAD_ESCALATION_DRY_RUN=false  actually create Work Inbox items; any other value only
//                                           logs who would have been notified
// The sweep is idempotent (every alert is claimed in wfm_roster_upload_alert first), so a short
// interval is safe: stages fire within ~15 minutes of their trigger time (Fri 10:00, Sun 12:00,
// Sun 18:00, Mon 10:00 IST).
import { logger } from '../../logger.js';
import { runRosterUploadEscalation } from './roster-upload-escalation.service.js';

const INTERVAL_MS = 15 * 60 * 1000;

let timer: NodeJS.Timeout | undefined;

const isEnabled = (): boolean => process.env.ROSTER_UPLOAD_ESCALATION_ENABLED === 'true';
const isDryRun = (): boolean => process.env.ROSTER_UPLOAD_ESCALATION_DRY_RUN !== 'false';

async function sweep(): Promise<void> {
  try {
    const result = await runRosterUploadEscalation({ dryRun: isDryRun() });
    if (result.actions.length > 0) {
      logger.info(
        { dryRun: result.dryRun, planned: result.actions.length, delivered: result.delivered },
        '[roster-upload-escalation] sweep finished',
      );
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[roster-upload-escalation] sweep failed');
  }
}

export function startRosterUploadEscalationScheduler(): void {
  if (!isEnabled() || timer) return;
  timer = setInterval(() => void sweep(), INTERVAL_MS);
  timer.unref();
  logger.info({ dryRun: isDryRun() }, '[roster-upload-escalation] scheduler started');
}

export function stopRosterUploadEscalationScheduler(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
