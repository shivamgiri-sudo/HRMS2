/**
 * Business Action Signal Sync - Scheduled Jobs
 * PeopleOS Phase 2: Smart Work Inbox Enhancement
 *
 * Automatically syncs business signals into Business Action Queue:
 * - Payroll readiness (daily 7 AM IST)
 * - Attendance gaps (daily 6 AM IST)
 * - Onboarding stuck (every 6 hours)
 * - Roster shortages (daily 9 AM IST)
 */

import { businessActionSignalSync } from '../modules/business-actions/business-actions.signal-sync.js';

let payrollScheduler: NodeJS.Timeout | undefined;
let attendanceScheduler: NodeJS.Timeout | undefined;
let onboardingScheduler: NodeJS.Timeout | undefined;
let rosterScheduler: NodeJS.Timeout | undefined;

function millisecondsUntilNextRun(hour: number, now = new Date()): number {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function millisecondsUntilNext6Hours(): number {
  return 6 * 60 * 60 * 1000; // 6 hours
}

// Payroll Readiness Sync - Daily at 7 AM IST
function schedulePayrollReadiness(): void {
  if (payrollScheduler) return;

  payrollScheduler = setTimeout(async () => {
    console.log('[CRON] Running payroll readiness sync...');
    try {
      const result = await businessActionSignalSync.syncPayrollReadiness('system');
      console.log(`[CRON] Payroll readiness sync complete: ${result.created} actions created (${result.scanned} scanned, ${result.skipped} skipped)`);
    } catch (error) {
      console.error('[CRON] Payroll readiness sync error:', error);
    } finally {
      payrollScheduler = undefined;
      schedulePayrollReadiness(); // Reschedule for next day
    }
  }, millisecondsUntilNextRun(7));

  payrollScheduler.unref();
}

// Attendance Gaps Sync - Daily at 6 AM IST
function scheduleAttendanceGaps(): void {
  if (attendanceScheduler) return;

  attendanceScheduler = setTimeout(async () => {
    console.log('[CRON] Running attendance gap sync...');
    try {
      const result = await businessActionSignalSync.syncAttendanceGaps('system');
      console.log(`[CRON] Attendance gap sync complete: ${result.created} actions created (${result.scanned} scanned, ${result.skipped} skipped)`);
    } catch (error) {
      console.error('[CRON] Attendance gap sync error:', error);
    } finally {
      attendanceScheduler = undefined;
      scheduleAttendanceGaps(); // Reschedule for next day
    }
  }, millisecondsUntilNextRun(6));

  attendanceScheduler.unref();
}

// Onboarding Stuck Sync - Every 6 hours
function scheduleOnboardingStuck(): void {
  if (onboardingScheduler) return;

  onboardingScheduler = setTimeout(async () => {
    console.log('[CRON] Running onboarding stuck sync...');
    try {
      const result = await businessActionSignalSync.syncOnboardingStuck('system');
      console.log(`[CRON] Onboarding stuck sync complete: ${result.created} actions created (${result.scanned} scanned, ${result.skipped} skipped)`);
    } catch (error) {
      console.error('[CRON] Onboarding stuck sync error:', error);
    } finally {
      onboardingScheduler = undefined;
      scheduleOnboardingStuck(); // Reschedule for next 6 hours
    }
  }, millisecondsUntilNext6Hours());

  onboardingScheduler.unref();
}

// Roster Shortages Sync - Daily at 9 AM IST
function scheduleRosterShortages(): void {
  if (rosterScheduler) return;

  rosterScheduler = setTimeout(async () => {
    console.log('[CRON] Running roster shortage sync...');
    try {
      const result = await businessActionSignalSync.syncRosterShortages('system');
      console.log(`[CRON] Roster shortage sync complete: ${result.created} actions created (${result.scanned} scanned, ${result.skipped} skipped)`);
    } catch (error) {
      console.error('[CRON] Roster shortage sync error:', error);
    } finally {
      rosterScheduler = undefined;
      scheduleRosterShortages(); // Reschedule for next day
    }
  }, millisecondsUntilNextRun(9));

  rosterScheduler.unref();
}

export function initBusinessActionSyncJobs(): void {
  console.log('[CRON] Initializing business action sync jobs...');

  schedulePayrollReadiness();
  scheduleAttendanceGaps();
  scheduleOnboardingStuck();
  scheduleRosterShortages();

  console.log('[CRON] Business action sync jobs initialized');
  console.log('[CRON] - Payroll readiness: Daily 7 AM IST');
  console.log('[CRON] - Attendance gaps: Daily 6 AM IST');
  console.log('[CRON] - Onboarding stuck: Every 6 hours');
  console.log('[CRON] - Roster shortages: Daily 9 AM IST');
}

export function stopBusinessActionSyncJobs(): void {
  if (payrollScheduler) clearTimeout(payrollScheduler);
  if (attendanceScheduler) clearTimeout(attendanceScheduler);
  if (onboardingScheduler) clearTimeout(onboardingScheduler);
  if (rosterScheduler) clearTimeout(rosterScheduler);

  payrollScheduler = undefined;
  attendanceScheduler = undefined;
  onboardingScheduler = undefined;
  rosterScheduler = undefined;

  console.log('[CRON] Business action sync jobs stopped');
}
