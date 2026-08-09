

## Pause/Resume Capability for Attendance

### Overview
Add the ability for employees to pause and resume their work session during a clock-in period. This handles scenarios like starting at the office, taking a long break, then resuming from home. The system will track all break periods and subtract break time from total working hours.

### How It Works
- When clocked in, employees see a **Pause** button alongside Clock Out
- When paused, the button changes to **Resume** (with location capture)
- Multiple pauses per day are supported
- Total hours are calculated as: (clock_out - clock_in) minus total break duration
- Break history is visible in attendance details

### Technical Details

**1. New Database Table: `attendance_breaks`**

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Auto-generated |
| attendance_record_id | uuid (FK) | Links to attendance_records |
| pause_time | timestamptz | When break started |
| resume_time | timestamptz (nullable) | When break ended |
| pause_latitude/longitude | numeric | Location at pause |
| pause_location_name | text | Reverse-geocoded pause location |
| resume_latitude/longitude | numeric | Location at resume |
| resume_location_name | text | Reverse-geocoded resume location |
| created_at | timestamptz | Auto timestamp |

RLS policies will mirror attendance_records: employees manage their own, admin/HR manage all, managers view team.

**2. Hook Changes (`useAttendance.ts`)**
- Add `usePause()` mutation: inserts a new break record with pause_time and location
- Add `useResume()` mutation: updates the open break record with resume_time and location
- Add `useActiveBreak(attendanceRecordId)` query: checks if there's an open (un-resumed) break
- Update `useClockOut()`: auto-resume any open break before clocking out, and recalculate total_hours by subtracting total break duration

**3. UI Changes (`Attendance.tsx`)**
- When clocked in and NOT paused: show **Pause** and **Clock Out** buttons
- When paused: show **Resume** button (Clock Out hidden or disabled while paused)
- Display current break duration with a timer when paused
- Show total break time taken today

**4. Total Hours Calculation**
- On clock out: query all breaks for that record, sum (resume_time - pause_time) for each, subtract from (clock_out - clock_in)
- On resume: no total_hours update needed (only calculated at clock out)

**5. History Display Updates**
- Add a "Breaks" column or expandable row in attendance history showing break count and total break duration
- Update `MyAttendanceHistory.tsx` to show break info

**6. Report Updates**
- Update `useAttendanceReport.ts` to account for break time in overtime and working hours calculations (breaks are already excluded since total_hours will be net of breaks)

### Files to Create/Modify
- **New migration**: Create `attendance_breaks` table with RLS policies
- **`src/hooks/useAttendance.ts`**: Add `usePause`, `useResume`, `useActiveBreak` hooks; update clock-out logic
- **`src/pages/Attendance.tsx`**: Add Pause/Resume buttons, break timer display, break status indicators
- **`src/components/profile/MyAttendanceHistory.tsx`**: Show break info in history

