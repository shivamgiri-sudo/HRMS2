# HRMS1 Email Template Enhancement Audit

## Current communication capability

The project already has a communication module with:

- `communication_template`
- `notification_preferences`
- `dispatch_log`
- template render API
- dispatch APIs
- provider configuration
- delivery logs and stats

## Current issues

1. Email templates need a premium, consistent layout.
2. Leave approval/rejection email currently sends minimal data from page code.
3. Payroll, payslip, attendance exception, increment, RM change, onboarding, and compliance templates need standardized subjects and layouts.
4. Templates need clear variables and preview support.
5. Critical templates should be marked `is_critical = 1`.
6. Dispatch logs should be visible in an admin communication dashboard.
7. Failed dispatches should be retryable with clear error messages.

## Required premium email layout

Every email should use this structure:

```text
Header / module label
Clear headline
Short summary paragraph
Detail card grid
Action instruction
Footer note
```

Design style:

```text
White card
Soft blue/grey background
Rounded container
Strong module banner
Readable typography
Status pill
No dense paragraphs
No unformatted plain text
```

## Critical templates to build

### Leave

- `leave_request_submitted`
- `leave_status`
- `leave_cancelled`
- `leave_balance_low`

### Attendance

- `attendance_exception`
- `attendance_regularization_submitted`
- `attendance_regularization_status`
- `biometric_mapping_missing`
- `attendance_freeze_completed`

### Payroll

- `payroll_readiness_blocker`
- `payroll_calculated`
- `payroll_approved`
- `payslip_released`
- `payslip_acknowledgement_reminder`
- `bank_payment_failed`

### Salary Increment

- `increment_request_submitted`
- `increment_hr_validated`
- `increment_finance_validated`
- `increment_approved`
- `increment_rejected`
- `increment_implemented`
- `increment_letter_released`

### Reporting Manager Change

- `rm_change_request_submitted`
- `rm_change_approved`
- `rm_change_rejected`

### Onboarding / ATS

- `candidate_shortlisted`
- `interview_scheduled`
- `offer_released`
- `onboarding_documents_pending`
- `joining_reminder`

### Compliance

- `document_expiring`
- `missing_pan`
- `missing_uan`
- `missing_bank_verification`
- `statutory_exception`

## Next build steps

1. Add SQL seed migration for premium templates in small batches.
2. Add template preview UI in Communication module.
3. Add test-send action per template.
4. Add variable validation before dispatch.
5. Add module-wise default templates in communication settings.
6. Add audit log for template create/update/delete.
7. Replace hardcoded leave status notification body with template event dispatch.

## UI page to build

```text
/communication/templates
```

Tabs:

```text
Template Library
Preview
Variables
Dispatch Logs
Failed Sends
Provider Health
```

## Governance

- HR/Admin can edit templates.
- All users can receive notifications according to preference.
- Critical payroll/attendance/compliance messages bypass disabled preferences where legally/operationally required.
- Secrets must never be visible in provider settings.
