/**
 * Utilities for handling work shifts, including cross-midnight shifts (e.g., 2pm-1am).
 */

/**
 * Calculate expected working hours from a shift schedule.
 * Handles cross-midnight shifts (e.g., 14:00 - 01:00 = 11 hours).
 */
export function getExpectedHours(workStart: string, workEnd: string): number {
  const [startHour, startMin] = workStart.split(':').map(Number);
  const [endHour, endMin] = workEnd.split(':').map(Number);

  const startMinutes = startHour * 60 + (startMin || 0);
  const endMinutes = endHour * 60 + (endMin || 0);

  if (endMinutes > startMinutes) {
    // Same-day shift (e.g., 09:00 - 18:00)
    return (endMinutes - startMinutes) / 60;
  }
  // Cross-midnight shift (e.g., 14:00 - 01:00)
  return (24 * 60 - startMinutes + endMinutes) / 60;
}

/**
 * Check if a shift crosses midnight.
 */
export function isCrossMidnightShift(workStart: string, workEnd: string): boolean {
  const [startHour, startMin] = workStart.split(':').map(Number);
  const [endHour, endMin] = workEnd.split(':').map(Number);

  const startMinutes = startHour * 60 + (startMin || 0);
  const endMinutes = endHour * 60 + (endMin || 0);

  return endMinutes <= startMinutes;
}

/**
 * Get the actual end time as a Date, accounting for cross-midnight shifts.
 * For a shift starting at 2pm ending at 1am, if clocked in today,
 * the end time is 1am tomorrow.
 */
export function getShiftEndTime(clockInTime: Date, workStart: string, workEnd: string): Date {
  const [endHour, endMin] = workEnd.split(':').map(Number);

  const endTime = new Date(clockInTime);
  endTime.setHours(endHour, endMin || 0, 0, 0);

  if (isCrossMidnightShift(workStart, workEnd)) {
    // End time is the next day
    endTime.setDate(endTime.getDate() + 1);
  }

  return endTime;
}
