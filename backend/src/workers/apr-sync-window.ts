// Which dates apr-vicidial-sync pulls on a run, and which employees' APR a run changed. Pure, so it is tested
// without a dialler or a database.

// Each hourly run pulls today AND yesterday: logins after the last run before midnight, or an hour the
// dialler server was unreachable, are picked up on the next run instead of being lost. Once a day (first run
// after DEEP_SWEEP_HOUR IST) it re-pulls DEEP_SWEEP_DAYS, so a server that was down for whole days heals by
// itself. Before this, only "today" was pulled and yesterday only on a process restart: 21-29 Sep 2026 sync
// carried ~14-37 agents a day instead of ~195 and 2 Oct 2026 had no APR row at all, which put those days in
// HRMS against I-spark.
export const HOURLY_DAYS_BACK = 1;
export const DEEP_SWEEP_DAYS = 7;
export const DEEP_SWEEP_HOUR = 6;

/** Employee codes whose stored APR minutes differ between two snapshots of the same date. */
export function changedAprUsers(before: Map<string, number>, after: Map<string, number>): Set<string> {
  const changed = new Set<string>();
  for (const [user, secs] of after) if ((before.get(user) ?? 0) !== secs) changed.add(user);
  return changed;
}

/** IST calendar dates from `daysBack` days ago up to today, oldest first. */
export function aprSyncDates(nowMs: number, daysBack: number): string[] {
  const nowIST = new Date(nowMs + 5.5 * 60 * 60 * 1000);
  const dates: string[] = [];
  for (let i = daysBack; i >= 0; i--) {
    const d = new Date(nowIST);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/** How many days back this run should pull: the deep sweep once per IST day after DEEP_SWEEP_HOUR. */
export function aprSyncDaysBack(nowMs: number, lastDeep: string | null): { daysBack: number; deep: boolean; today: string } {
  const nowIST = new Date(nowMs + 5.5 * 60 * 60 * 1000);
  const today = nowIST.toISOString().slice(0, 10);
  const deep = nowIST.getUTCHours() >= DEEP_SWEEP_HOUR && lastDeep !== today;
  return { daysBack: deep ? DEEP_SWEEP_DAYS : HOURLY_DAYS_BACK, deep, today };
}

