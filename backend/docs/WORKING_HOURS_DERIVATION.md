# Working Hours Derivation Strategy

**Status**: Profile form no longer accepts user-entered working_hours_start/end. Working hours now derived from source system data per employee classification.

## Classification Logic

### 1. **APR Employees** (Operations + Executive)
- **Detection**: `department LIKE '%operation%' AND designation LIKE '%executive%'`
- **Source**: `Shivamgiri.APR` table (external DB)
- **Derivation**: Query APR for employee's configured work hours
- **Fallback**: Standard 9:00–18:00 (9 hours) if APR record missing
- **Update Frequency**: Daily sync from Shivamgiri
- **Service**: `ats-sync-worker` or APR integration scheduler

```sql
-- Query APR for working hours
SELECT working_hours_start, working_hours_end
FROM Shivamgiri.APR
WHERE employee_id = ? AND date = CURDATE()
```

### 2. **Biometric Employees** (Office-based, non-APR)
- **Detection**: Has `biometric_enrollment` + not APR
- **Source**: `biometric_attendance_log` + `attendance_rule_config`
- **Derivation**: 
  - Query last N days of biometric punches
  - Calculate average clock-in and clock-out times
  - Configurable via `attendance_rule_config` (e.g., "use 5-day average", "use mode")
- **Update Frequency**: Real-time (recalc on each punch sync)
- **Service**: `attendance-engine.service.ts`

```sql
-- Derive from recent punches
SELECT 
  AVG(HOUR(first_punch_in)) as avg_clock_in_hour,
  AVG(HOUR(last_punch_out)) as avg_clock_out_hour
FROM biometric_attendance_log
WHERE employee_id = ? AND punch_date >= DATE_SUB(CURDATE(), INTERVAL 5 DAY)
```

### 3. **Dialer Employees** (Call Center)
- **Detection**: Has `vicidial_agent_log` record + not APR/biometric
- **Source**: `vicidial_agent_log` (first login / last logout)
- **Derivation**: 
  - Query dialer logs for last N days
  - Calculate average first-login and last-logout times
  - Apply grace windows (e.g., ±30 min) to smooth outliers
- **Update Frequency**: Daily batch sync
- **Service**: `dialer-to-mas_hrms-attendance-sync.js`

```sql
-- Derive from dialer logs
SELECT 
  AVG(TIME_FORMAT(login_time, '%H:%i')) as avg_login_time,
  AVG(TIME_FORMAT(logout_time, '%H:%i')) as avg_logout_time
FROM vicidial_agent_log
WHERE employee_id = ? AND log_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
```

### 4. **Fallback** (No source system data)
- **Default**: 09:00–18:00 (9-hour day)
- **Configurable**: via `org_settings` table
- **Override**: HR can manually set via batch admin API (not via profile form)

## Implementation

### API Endpoint: GET /api/employees/{id}/working-hours
Returns derived working hours + source system + last updated timestamp.

```typescript
interface WorkingHoursResponse {
  employee_id: string;
  working_hours_start: string; // HH:MM
  working_hours_end: string;   // HH:MM
  total_hours: number;         // 9.5
  source: 'APR' | 'biometric' | 'dialer' | 'manual' | 'default';
  confidence: number;          // 0-100 (how stable the average is)
  last_updated: string;        // ISO timestamp
  note?: string;               // "APR sync pending", "Only 2 days of biometric data"
}
```

### Service Layer: `working-hours-derivation.service.ts` (TO CREATE)
```typescript
export async function getWorkingHours(employeeId: string): Promise<WorkingHoursResponse> {
  const emp = await getEmployee(employeeId);
  
  // Step 1: Classify employee
  const classification = classifyEmployee(emp);
  
  // Step 2: Derive based on classification
  switch (classification) {
    case 'APR':
      return deriveFromAPR(emp);
    case 'BIOMETRIC':
      return deriveFromBiometric(emp);
    case 'DIALER':
      return deriveFromDialer(emp);
    default:
      return getDefault();
  }
}
```

## Payroll Integration
- Payroll engine uses derived working_hours for:
  - Shift allowance calculation
  - Overtime eligibility
  - Daily wage computation
  - Biometric attendance validation
- Source: Call `GET /api/employees/{id}/working-hours` at salary_prep_run start
- Caching: Cache result for 24 hours per run to avoid mid-run changes

## Rollout Plan
1. **Phase 1**: Remove working_hours_start/end from profile form (DONE)
2. **Phase 2**: Create `working-hours-derivation.service.ts` with all 3 classifiers
3. **Phase 3**: Wire into `attendance-engine.service.ts` for validation
4. **Phase 4**: Wire into `payrollCalculate.service.ts` for salary computation
5. **Phase 5**: Add admin override endpoint for edge cases (maternity, sabbatical, etc.)

## Notes
- **No manual entry**: Users cannot set working hours in profile. HR/Admin uses batch API only.
- **Live data only**: Derived on-demand; no static storage (reduces maintenance).
- **Audit trail**: All derivations logged with source + timestamp for compliance.
- **Edge cases**: Handle shift changes mid-month, biometric downtime, dialer gaps gracefully with fallback.
