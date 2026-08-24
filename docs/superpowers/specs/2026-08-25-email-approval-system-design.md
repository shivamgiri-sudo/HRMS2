# Email-Based Approval System for HRMS

**Date:** 2026-08-25  
**Status:** Approved  
**Author:** Claude + Shivam Giri

---

## 1. Overview

Build an email-based approval system that enables HRMS users to approve/reject requests directly from their email without logging into the application. Every approval workflow triggers a detailed email with one-click action buttons, delivered alongside in-app Work Inbox notifications.

### Goals
- Enable one-click approve/reject from email (no login required)
- Cover all 27 notification types across approval, alert, and status categories
- Reduce approval turnaround time by meeting approvers where they are (inbox)
- Maintain security via cryptographically signed, time-limited tokens
- Support both instant notifications and batched digests to prevent inbox flooding

### Non-Goals
- Mobile push notifications (future phase)
- WhatsApp/SMS notifications (future phase)
- "Approve All" bulk action (intentionally excluded for compliance safety)

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Email Approval System Architecture               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │   Workflow   │───▶│  Notification │───▶│   Email Queue        │  │
│  │   Triggers   │    │   Gateway     │    │   (approval_email)   │  │
│  └──────────────┘    └──────────────┘    └──────────────────────┘  │
│        │                    │                       │               │
│        │                    ▼                       ▼               │
│        │             ┌──────────────┐    ┌──────────────────────┐  │
│        │             │  Work Inbox  │    │   Digest Scheduler   │  │
│        │             │  (in-app)    │    │   (8 AM / 6 PM IST)  │  │
│        │             └──────────────┘    └──────────────────────┘  │
│        │                                           │               │
│        ▼                                           ▼               │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Email Renderer                             │  │
│  │  • Template selection (approval/alert/info)                   │  │
│  │  • Token generation (HMAC-SHA256, 72h expiry)                │  │
│  │  • HTML rendering (MJML → HTML)                               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│                              ▼                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                 Approval Action API                           │  │
│  │  GET /api/email-actions/:token?action=approve|reject          │  │
│  │  • Validates token signature + expiry                         │  │
│  │  • Executes approval in target module                         │  │
│  │  • Returns confirmation page                                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Components

1. **Notification Gateway** — Central dispatcher that routes events to both Work Inbox (in-app) AND Email Queue simultaneously
2. **Email Queue Table** — Stores pending emails with priority flag (instant vs digest)
3. **Digest Scheduler** — Cron jobs at 8 AM IST (morning digest) and 6 PM IST (evening summary)
4. **Token Service** — Generates cryptographically signed action tokens with 72-hour expiry
5. **Approval Action API** — Stateless endpoint that validates tokens and executes actions
6. **Email Renderer** — MJML-based template engine for consistent cross-client rendering

---

## 3. Data Model

### 3.1 Email Queue Table

```sql
CREATE TABLE approval_email_queue (
  id              CHAR(36) PRIMARY KEY,
  recipient_email VARCHAR(255) NOT NULL,
  recipient_user_id CHAR(36),
  
  -- What this email is about
  item_type       VARCHAR(50) NOT NULL,     -- LEAVE_APPROVAL_PENDING, GRN_APPROVAL_PENDING, etc.
  entity_type     VARCHAR(50) NOT NULL,     -- leave_request, grn_request, etc.
  entity_id       CHAR(36) NOT NULL,
  
  -- Context data for email rendering (JSON)
  context_json    JSON,                     -- {employee_name, dates, amount, etc.}
  
  -- Grouping for digests
  priority        ENUM('critical','standard','info') DEFAULT 'standard',
  digest_batch    DATE,                     -- NULL = instant, date = batch for that day
  
  -- Action tokens (separate for approve vs reject)
  approve_token   VARCHAR(255) UNIQUE,
  reject_token    VARCHAR(255) UNIQUE,
  token_expires   DATETIME NOT NULL,        -- 72 hours from creation
  
  -- Lifecycle
  status          ENUM('pending','sent','acted','expired','cancelled') DEFAULT 'pending',
  sent_at         DATETIME,
  acted_at        DATETIME,
  action_taken    ENUM('approved','rejected'),
  
  -- Audit
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_recipient (recipient_user_id, status),
  INDEX idx_digest (status, priority, digest_batch),
  INDEX idx_approve_token (approve_token),
  INDEX idx_reject_token (reject_token),
  INDEX idx_entity (entity_type, entity_id)
);
```

### 3.2 Action Audit Log

```sql
CREATE TABLE approval_email_action_log (
  id              CHAR(36) PRIMARY KEY,
  email_queue_id  CHAR(36) NOT NULL,
  action          ENUM('approved','rejected') NOT NULL,
  executed_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  -- Forensic data
  client_ip       VARCHAR(45),
  user_agent      VARCHAR(500),
  
  -- Result
  success         TINYINT(1) NOT NULL,
  error_message   VARCHAR(500),
  
  FOREIGN KEY (email_queue_id) REFERENCES approval_email_queue(id)
);
```

### 3.3 User Preferences

```sql
CREATE TABLE notification_preference (
  user_id           CHAR(36) PRIMARY KEY,
  email_enabled     TINYINT(1) DEFAULT 1,
  digest_time_am    TIME DEFAULT '08:00:00',    -- IST
  digest_time_pm    TIME DEFAULT '18:00:00',    -- IST
  instant_override  JSON,                        -- Item types that should always be instant
  muted_types       JSON,                        -- Item types to skip email (inbox only)
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES auth_user(id)
);
```

### 3.4 Token Structure

```
Token = base64url(payload) + "." + HMAC-SHA256(payload, SECRET)

Payload (JSON):
{
  "qid": "email-queue-uuid",
  "eid": "entity-uuid",
  "typ": "leave_request",
  "act": "approve",           // or "reject"
  "exp": 1724600000,          // Unix timestamp (72h from now)
  "uid": "approver-user-uuid"
}
```

**Security properties:**
- Each action (approve/reject) gets a separate token
- Tokens are single-use: marked as acted after first use
- 72-hour expiry (configurable per item type)
- HMAC signature prevents tampering
- IP + User Agent logged for audit trail

---

## 4. Notification Types

### 4.1 Category A: Approval-Required (ACTION emails)

| # | Item Type | Recipient Role | Subject Template | Priority |
|---|-----------|----------------|------------------|----------|
| 1 | LEAVE_APPROVAL_PENDING | manager, hr | Leave Request: {{employee_name}} - {{dates}} | critical if <24h to start |
| 2 | GRN_APPROVAL_PENDING | branch_head, finance_head | GRN Approval: {{grn_no}} - {{amount}} | critical if >50k |
| 3 | REGULARIZATION_PENDING | manager, hr | Attendance Regularization: {{employee_name}} | standard |
| 4 | OFFER_APPROVAL_PENDING | branch_head | Offer Approval: {{candidate_name}} - {{position}} | critical |
| 5 | RESIGNATION_PENDING_REVIEW | hr | Resignation Review: {{employee_name}} | critical |
| 6 | RESIGNATION_MANAGER_DISCUSSION | branch_head | Exit Discussion Required: {{employee_name}} | critical |
| 7 | RESIGNATION_HR_DISCUSSION | hr | Exit Discussion Required: {{employee_name}} | critical |
| 8 | FF_CLEARANCE_PENDING | dept_head | F&F Clearance: {{employee_name}} - {{department}} | critical |
| 9 | PAYROLL_SIGN_OFF_PENDING | finance_head | Payroll Sign-off: {{branch}} - {{month}} | critical |
| 10 | PAYROLL_BRANCH_READINESS | branch_head | Payroll Readiness Check: {{branch}} | standard |
| 11 | INCENTIVE_APPROVAL | approver | Incentive Batch: {{batch_ref}} - {{amount}} | standard |
| 12 | IMPREST_ALLOCATION_PENDING | finance_head | Imprest Topup: {{holder_name}} - {{amount}} | standard |
| 13 | EXIT_PASS_APPROVAL | branch_head | Exit Pass: {{employee_name}} - {{asset_count}} assets | critical |
| 14 | DPDP_WITHDRAWAL_REVIEW | compliance | DPDP Withdrawal: {{requester_name}} | critical |

### 4.2 Category B: Attention-Required (ALERT emails)

| # | Item Type | Recipient Role | Subject Template |
|---|-----------|----------------|------------------|
| 15 | ONBOARDING_STUCK | hr, recruitment_hr | Onboarding Stuck: {{candidate_name}} - {{days}} days |
| 16 | BGV_PENDING | hr | BGV Pending: {{candidate_name}} - {{days}} days |
| 17 | JOINING_DOCS_INCOMPLETE | hr | Docs Incomplete: {{candidate_name}} |
| 18 | ATTENDANCE_MISMATCH | wfm, hr | Attendance Exceptions: {{branch}} - {{count}} employees |
| 19 | AWOL_SUSPECTED | hr, branch_head | AWOL Alert: {{employee_name}} - {{absent_days}} days |
| 20 | TAT_BREACH | admin | TAT Breach: {{task_type}} |
| 21 | NAME_MISMATCH | hr | Name Mismatch: {{candidate_name}} |
| 22 | ROSTER_PUBLISH_PENDING | wfm, process_manager | Roster Unpublished: {{process}} - Week of {{week_start}} |

**All Category B emails are sent instantly (no digest batching).**

### 4.3 Category C: Status Updates (INFO emails)

| # | Item Type | Recipient | Subject Template |
|---|-----------|-----------|------------------|
| 23 | LEAVE_APPROVED | employee | Leave Approved: {{dates}} |
| 24 | LEAVE_REJECTED | employee | Leave Rejected: {{dates}} |
| 25 | GRN_APPROVED | requester | GRN Approved: {{grn_no}} |
| 26 | GRN_REJECTED | requester | GRN Rejected: {{grn_no}} |
| 27 | RESIGNATION_ACCEPTED | employee | Resignation Accepted - Next Steps |

**All Category C emails are batched into the 6 PM IST evening summary.**

---

## 5. Email Templates

### 5.1 Visual Style

**Corporate Professional theme:**
- Background: White (#FFFFFF)
- Primary accent: Blue (#2563EB)
- Success/Approve: Green (#16A34A)
- Reject/Error: Red (#DC2626)
- Text: Dark gray (#1F2937)
- Border: Light gray (#E5E7EB)
- Font: System font stack (Arial, Helvetica, sans-serif for email compatibility)

**Branding:**
- Header: MAS Callnet logo (left-aligned)
- Footer: "MAS Callnet HRMS" with do-not-forward notice

### 5.2 Template Types

#### Instant Approval Email (Single Item)
```
┌─────────────────────────────────────────────────────────────────┐
│  [MAS Callnet Logo]                                             │
│                                                                 │
│  ACTION REQUIRED: Leave Request Pending Your Approval           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Hi {{approver_name}},                                          │
│                                                                 │
│  {{employee_name}} has requested leave that needs your          │
│  approval.                                                      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  LEAVE REQUEST DETAILS                                   │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │  Employee     {{employee_name}} ({{employee_code}})      │   │
│  │  Type         {{leave_type}}                             │   │
│  │  Dates        {{start_date}} → {{end_date}} ({{days}})  │   │
│  │  Reason       {{reason}}                                 │   │
│  │  Balance      {{leave_type}}: {{balance}} remaining      │   │
│  │  Applied      {{applied_date}}                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│        ┌──────────────────┐    ┌──────────────────┐            │
│        │    ✓ APPROVE     │    │    ✗ REJECT      │            │
│        └──────────────────┘    └──────────────────┘            │
│                                                                 │
│  Or review in HRMS: [View in HRMS →]                           │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  This link expires in 72 hours.                                 │
│  MAS Callnet HRMS • Do not forward this email                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Morning Digest Email (8 AM IST)
```
┌─────────────────────────────────────────────────────────────────┐
│  [MAS Callnet Logo]                                             │
│                                                                 │
│  Good morning {{approver_name}} — you have {{total}} items      │
│  pending approval                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LEAVE REQUESTS ({{leave_count}})                               │
│  ─────────────────────────────────────────────────────────────  │
│  │ {{name}}  │ {{type}} │ {{dates}}  │ [✓ Approve] [✗ Reject] │ │
│  │ {{name}}  │ {{type}} │ {{dates}}  │ [✓ Approve] [✗ Reject] │ │
│  ...                                                            │
│                                                                 │
│  GRN APPROVALS ({{grn_count}})                                  │
│  ─────────────────────────────────────────────────────────────  │
│  │ {{grn_no}} │ {{amount}} │ {{head}}  │ [✓ Approve] [✗ Reject]│ │
│  ...                                                            │
│                                                                 │
│  [View all in HRMS →]                                           │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Links expire in 72 hours • Do not forward                      │
│  MAS Callnet HRMS                                               │
└─────────────────────────────────────────────────────────────────┘
```

#### Evening Status Summary (6 PM IST)
```
┌─────────────────────────────────────────────────────────────────┐
│  [MAS Callnet Logo]                                             │
│                                                                 │
│  Today's Updates — {{date}}                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✓ APPROVED ({{approved_count}})                                │
│    • {{description}}                                            │
│    • {{description}}                                            │
│                                                                 │
│  ✗ REJECTED ({{rejected_count}})                                │
│    • {{description}} — {{reason}}                               │
│                                                                 │
│  ⏳ STILL PENDING ({{pending_count}})                            │
│    • {{description}}                                            │
│                                                                 │
│  [View details in HRMS →]                                       │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  MAS Callnet HRMS                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Action Flow

### 6.1 Token Validation Flow

```
User clicks [✓ APPROVE] in email
           │
           ▼
GET /api/email-actions/:token?action=approve
           │
           ▼
┌─────────────────────────────────┐
│  1. Decode token payload        │
│  2. Verify HMAC signature       │
│  3. Check expiry (72h)          │
│  4. Check status != 'acted'     │
│  5. Verify entity still exists  │
│  6. Verify user still has perm  │
└─────────────────────────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
  [Valid]    [Invalid]
     │           │
     ▼           ▼
Execute      Show error page
approval     with reason
     │
     ▼
Show success confirmation page
```

### 6.2 Error States

| Error | User Message |
|-------|--------------|
| Token expired | "This link has expired. Please log in to HRMS to take action." |
| Already acted | "This request was already {{action}} on {{date}} at {{time}}." |
| Entity not found | "This request no longer exists or was cancelled." |
| Permission denied | "You no longer have permission to approve this request." |
| Invalid signature | "Invalid or corrupted link. Please use the original email." |

### 6.3 Confirmation Page

```html
┌───────────────────────────────────────────────────┐
│                                                   │
│     ✓ Leave Request Approved                      │
│                                                   │
│     {{employee_name}}'s leave for {{dates}}       │
│     has been approved.                            │
│                                                   │
│     [Open HRMS →]    [Close Window]              │
│                                                   │
└───────────────────────────────────────────────────┘
```

---

## 7. Module Structure

### 7.1 New Files

```
backend/src/modules/notification-gateway/
├── notification-gateway.service.ts    # Central dispatcher
├── notification-gateway.routes.ts     # User preference API
├── email-queue.service.ts             # Queue CRUD + batching logic
├── email-token.service.ts             # HMAC token gen/validate
├── email-action.routes.ts             # GET /api/email-actions/:token
├── email-action.service.ts            # Execute approval logic
├── email-renderer.service.ts          # MJML → HTML
├── digest-scheduler.cron.ts           # 8 AM / 6 PM jobs
├── __tests__/
│   ├── email-token.test.ts
│   ├── email-action.test.ts
│   └── digest-scheduler.test.ts
└── templates/
    ├── instant-approval.mjml
    ├── instant-alert.mjml
    ├── digest-morning.mjml
    ├── digest-evening.mjml
    └── partials/
        ├── header.mjml
        ├── footer.mjml
        ├── approval-card.mjml
        ├── alert-card.mjml
        └── action-buttons.mjml
```

### 7.2 Integration Points

| Existing File | Change Required |
|---------------|-----------------|
| `work-inbox.triggers.ts` | Import and call `notificationGateway.dispatch()` instead of direct `createWorkItemIfNotExists()` |
| `leaves.service.ts` | Emit `LEAVE_APPROVED` / `LEAVE_REJECTED` via gateway after status change |
| `grn.service.ts` | Emit `GRN_APPROVED` / `GRN_REJECTED` via gateway |
| `grn-smart.service.ts` | Emit approval events for smart GRN flow |
| `exit.service.ts` | Emit resignation status events |
| `imprest.service.ts` | Emit allocation approval/rejection events |
| `exit-pass.service.ts` | Emit exit pass approval events |
| `branch-head-approval.service.ts` | Emit offer approval events |

---

## 8. Scheduling

### 8.1 Digest Schedule (IST)

| Time | Job | Content |
|------|-----|---------|
| 8:00 AM IST | Morning Digest | All pending approval items (priority: standard) batched since last digest |
| 6:00 PM IST | Evening Summary | Status updates (approved/rejected) from today |

### 8.2 Instant Triggers

Items with `priority: critical` bypass the digest queue and send immediately:
- All Category B (Alerts)
- Leave requests where start date is within 24 hours
- GRN amounts exceeding Rs 50,000
- All resignation/exit-related items
- Payroll sign-off requests

### 8.3 Token Expiry Cleanup

Daily job at 2:00 AM IST:
- Mark `status = 'expired'` for tokens past expiry
- Archive acted/expired records older than 90 days

---

## 9. Security Considerations

1. **Token Security**
   - HMAC-SHA256 with server-side secret (env: `EMAIL_ACTION_SECRET`)
   - 72-hour expiry (configurable)
   - Single-use enforcement
   - Separate tokens for approve vs reject actions

2. **Audit Trail**
   - All actions logged with IP + User Agent
   - Success/failure recorded
   - Linked to original email queue record

3. **Forwarding Risk Mitigation**
   - Footer warns "Do not forward this email"
   - Tokens tied to specific approver user ID
   - Consider: optional 4-digit PIN confirmation (V2)

4. **Rate Limiting**
   - Max 10 actions per minute per IP
   - Prevents automated abuse of valid tokens

---

## 10. Testing Strategy

### 10.1 Unit Tests
- Token generation and validation
- Expiry enforcement
- HMAC signature verification
- Queue batching logic

### 10.2 Integration Tests
- End-to-end approval flow (email → action → confirmation)
- Digest scheduler with mock clock
- Error handling for all invalid states

### 10.3 Manual QA
- Email rendering in Outlook, Gmail, mobile clients
- Button click behavior on iOS/Android mail apps
- Timezone handling for IST digest times

---

## 11. Rollout Plan

### Phase 1 (Week 1-2)
- Core infrastructure: queue table, token service, action API
- Leave approval emails (most common workflow)
- Basic instant template

### Phase 2 (Week 3-4)
- GRN approval emails
- Morning digest template
- Remaining Category A items

### Phase 3 (Week 5)
- Category B alert emails
- Category C status updates
- Evening summary template

### Phase 4 (Week 6)
- User preferences UI
- Monitoring dashboard
- Production rollout

---

## 12. Success Metrics

| Metric | Target |
|--------|--------|
| Email delivery rate | > 98% |
| Action completion rate (clicked → approved/rejected) | > 80% |
| Average approval turnaround time | Reduce by 40% |
| HRMS login requirement for approvals | Reduce by 60% |

---

## Appendix A: Environment Variables

```env
# Email Action Tokens
EMAIL_ACTION_SECRET=<32+ character random string>
EMAIL_ACTION_EXPIRY_HOURS=72

# Digest Scheduling (IST = UTC+5:30)
DIGEST_MORNING_HOUR=8
DIGEST_EVENING_HOUR=18
DIGEST_TIMEZONE=Asia/Kolkata

# Rate Limiting
EMAIL_ACTION_RATE_LIMIT=10
EMAIL_ACTION_RATE_WINDOW_SECONDS=60
```

---

## Appendix B: Sample Token

```
eyJxaWQiOiI1NTBkMzEyNC1hYjFjLTQwMjMtOWU4ZC0zYzg1ZmE2NzgwMjEiLCJlaWQiOiJhMWIyYzNkNC01Njc4LTkwYWItY2RlZi0xMjM0NTY3ODkwYWIiLCJ0eXAiOiJsZWF2ZV9yZXF1ZXN0IiwiYWN0IjoiYXBwcm92ZSIsImV4cCI6MTcyNDY4NjQwMCwidWlkIjoiOTg3NjU0MzItMTBmZS1kY2JhLTk4NzYtNTQzMjEwZmVkY2JhIn0.kH7gT2mN9pQrS5vX8yB1cD4eF6hI3jK0lM2nO7qR8sU
```

Decoded payload:
```json
{
  "qid": "550d3124-ab1c-4023-9e8d-3c85fa678021",
  "eid": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
  "typ": "leave_request",
  "act": "approve",
  "exp": 1724686400,
  "uid": "98765432-10fe-dcba-9876-543210fedcba"
}
```
