type MigratedAttendanceSnapshot = {
  clock_in?: string | null;
  clock_in_time?: string | null;
  clock_out?: string | null;
  clock_out_time?: string | null;
  total_hours?: number | null;
};

type LiveAttendanceSnapshot = {
  first_punch_in?: string | null;
  last_punch_out?: string | null;
  raw_minutes?: number | null;
};

export function canFetchPersonalAttendance(employeeId?: string): boolean {
  return Boolean(employeeId?.trim());
}

export function resolveAttendanceDisplay(
  migrated: MigratedAttendanceSnapshot | null | undefined,
  live: LiveAttendanceSnapshot | null | undefined,
) {
  const hasLivePunch = Boolean(live?.first_punch_in || live?.last_punch_out);
  const liveMinutes = Number(live?.raw_minutes);
  const migratedHours = Number(migrated?.total_hours);
  const hasLiveMinutes = live?.raw_minutes != null && Number.isFinite(liveMinutes);
  const hasMigratedHours =
    migrated?.total_hours != null && Number.isFinite(migratedHours);

  return {
    clockIn: hasLivePunch
      ? live?.first_punch_in ?? null
      : migrated?.clock_in ?? migrated?.clock_in_time ?? null,
    clockOut: hasLivePunch
      ? live?.last_punch_out ?? null
      : migrated?.clock_out ?? migrated?.clock_out_time ?? null,
    hours: hasLivePunch
      ? hasLiveMinutes
        ? Math.round((liveMinutes / 60) * 100) / 100
        : null
      : hasMigratedHours
        ? migratedHours
        : null,
    hasLivePunch,
  };
}
