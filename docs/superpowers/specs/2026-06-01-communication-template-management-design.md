# Communication Template Management System - Design Specification

**Date:** 2026-06-01
**Status:** Approved
**System:** MAS-CallNet HRMS
**Module:** Communication

## Overview

Multi-channel communication system with template management, dispatch orchestration, and audit logging. Supports email, SMS, and WhatsApp with Handlebars templating, user preference-based routing, and tiered retention.

## Goals

1. **Template Management:** Hybrid approach with file-based critical templates + DB custom templates
2. **Multi-Channel Dispatch:** Route messages via email/SMS/WhatsApp based on user preferences
3. **Audit Trail:** Tiered logging (critical forever, routine 30 days) with delivery tracking
4. **Admin Control:** Template CRUD, test send, dispatch history, retry failed messages
5. **Employee Control:** Notification preferences per category

## User Roles

### Admin/HR
- Create/edit custom templates
- Test templates with sample data
- View dispatch history + logs
- Retry failed messages
- Configure critical alert categories

### Manager
- Send ad-hoc notifications to team
- View team notification history (filtered)

### Employee
- Set notification preferences (channel per category)
- View own notification history
- Unsubscribe from non-critical categories

## System Architecture

### Module Structure

```
/backend/src/modules/communication/
├── templates/                    # File-based critical templates
│   ├── onboarding/
│   │   ├── welcome-email.hbs
│   │   ├── welcome-email.txt.hbs
│   │   ├── documents-pending.hbs
│   │   ├── documents-pending.txt.hbs
│   ├── payroll/
│   │   ├── payslip-ready.hbs
│   │   ├── payslip-ready.txt.hbs
│   │   ├── salary-credited.hbs
│   │   ├── salary-credited.txt.hbs
│   ├── attendance/
│   │   ├── late-arrival.hbs
│   │   ├── absent-alert.hbs
│   ├── leave/
│   │   ├── request-approved.hbs
│   │   ├── request-rejected.hbs
│   ├── performance/
│   │   ├── feedback-ready.hbs
│   │   ├── appraisal-due.hbs
├── communication.types.ts
├── communication.validation.ts
├── template.service.ts           # Template CRUD + rendering
├── dispatch.service.ts           # Multi-channel sending
├── notification-preferences.service.ts
├── communication.controller.ts
├── communication.routes.ts
└── providers/
    ├── provider.interface.ts     # Abstract provider interface
    ├── provider.factory.ts       # Provider registration + selection
    ├── email/
    │   ├── nodemailer.provider.ts
    │   └── local-email.provider.ts
    ├── sms/
    │   ├── twilio-sms.provider.ts
    │   └── local-sms.provider.ts
    └── whatsapp/
        ├── twilio-whatsapp.provider.ts
        └── local-whatsapp.provider.ts
```

### Database Schema

#### Table 1: communication_template

Admin-created custom templates stored in database.

```sql
CREATE TABLE communication_template (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  subject VARCHAR(200),
  body_html TEXT NOT NULL,
  body_text TEXT,
  category ENUM('onboarding', 'payroll', 'attendance', 'leave', 'performance', 'alerts', 'announcements', 'custom') NOT NULL,
  channel ENUM('email', 'sms', 'whatsapp', 'multi') NOT NULL,
  variables_schema JSON,
  is_active TINYINT(1) DEFAULT 1,
  is_critical TINYINT(1) DEFAULT 0,
  created_by VARCHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category_active (category, is_active)
);
```

**variables_schema example:**
```json
{
  "employee": ["name", "id", "email", "phone", "designation"],
  "payslip": ["month", "year", "net_pay", "gross_pay", "deductions"],
  "manager": ["name", "email"]
}
```

#### Table 2: notification_preferences

Employee preferences for notification channels per category.

```sql
CREATE TABLE notification_preferences (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  category ENUM('onboarding', 'payroll', 'attendance', 'leave', 'performance', 'alerts', 'announcements') NOT NULL,
  preferred_channel ENUM('email', 'sms', 'whatsapp') DEFAULT 'email',
  enabled TINYINT(1) DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  UNIQUE KEY uk_employee_category (employee_id, category),
  INDEX idx_employee_enabled (employee_id, enabled)
);
```

**Defaults on employee creation:**
- All categories → email, enabled=1

#### Table 3: dispatch_log

Audit trail for all sent messages with tiered retention.

```sql
CREATE TABLE dispatch_log (
  id VARCHAR(36) PRIMARY KEY,
  template_id VARCHAR(36),
  template_name VARCHAR(100) NOT NULL,
  recipient_employee_id VARCHAR(36),
  recipient_contact VARCHAR(100) NOT NULL,
  channel ENUM('email', 'sms', 'whatsapp') NOT NULL,
  status ENUM('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed') NOT NULL,
  subject VARCHAR(200),
  body_preview VARCHAR(500),
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  opened_at TIMESTAMP,
  clicked_at TIMESTAMP,
  error_message TEXT,
  is_critical TINYINT(1) DEFAULT 0,
  retention_category ENUM('critical', 'standard', 'routine') NOT NULL,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES communication_template(id),
  FOREIGN KEY (recipient_employee_id) REFERENCES employees(id),
  INDEX idx_recipient_channel (recipient_employee_id, channel, sent_at DESC),
  INDEX idx_status_retry (status, retry_count),
  INDEX idx_retention_cleanup (is_critical, retention_category, sent_at)
);
```

## Template System

### Hybrid Approach

**File-based templates (critical, developer-controlled):**
- Location: `backend/src/modules/communication/templates/`
- Format: Handlebars `.hbs` files
- Both HTML and plain text versions (`welcome-email.hbs` + `welcome-email.txt.hbs`)
- Cannot be edited via UI
- Version controlled with code
- Validated at build time
- Seeded templates (15-20):
  - Onboarding: welcome, documents pending, first day checklist
  - Payroll: payslip ready, salary credited, payroll error
  - Attendance: late arrival, absent alert, regularization approved
  - Leave: request approved, request rejected, balance reminder
  - Performance: feedback ready, appraisal due, report generated

**DB templates (custom, admin-editable):**
- Stored in `communication_template` table
- Rich text editor UI (TinyMCE or Quill)
- Variable picker dropdown (validated against schema)
- Preview with sample data
- Test send to own email/phone
- Activation toggle (is_active)

### Handlebars Templating

**Variable syntax:**
```handlebars
Hello {{employee.name}},

Your payslip for {{payslip.month}} {{payslip.year}} is ready.
Net Pay: {{currency payslip.net_pay}}

View payslip: {{link.payslip_url}}

Regards,
{{company.name}}
```

**Built-in helpers:**
- `{{formatDate date "DD MMM YYYY"}}` - date formatting
- `{{currency amount}}` - currency with symbol (₹1,234.56)
- `{{userName employee}}` - employee full name
- `{{#if condition}}...{{/if}}` - conditional blocks
- `{{#each items}}...{{/each}}` - loops

**Variable validation:**
- Each template has `variables_schema` (JSON)
- On save: parse template, extract variables, check all exist in schema
- Invalid variables → error, cannot save
- Missing variables → warning (OK if optional)

**Variable schema per category:**
```json
{
  "onboarding": {
    "employee": ["name", "id", "email", "designation", "date_of_joining"],
    "manager": ["name", "email"],
    "documents": ["pending_count", "deadline"],
    "company": ["name", "address", "logo_url"]
  },
  "payroll": {
    "employee": ["name", "id", "employee_code"],
    "payslip": ["month", "year", "net_pay", "gross_pay", "deductions", "payslip_url"],
    "company": ["name"]
  },
  "attendance": {
    "employee": ["name", "id"],
    "attendance": ["date", "status", "clock_in", "clock_out"],
    "manager": ["name"],
    "company": ["name"]
  }
}
```

## Multi-Channel Dispatch

### Channel Routing Logic

**Priority order:**
1. Check if template is critical alert → send to ALL channels (bypass preferences)
2. If not critical → fetch employee `notification_preferences` for category
3. Route to `preferred_channel`
4. If channel unavailable (no email/phone) → fallback to email
5. Log dispatch attempt

**Critical alert categories (always all channels):**
- Payroll errors (salary not credited, calculation errors)
- Compliance violations (PF mismatch, ESI issues)
- Security alerts (unauthorized access, password reset)
- System outages (HRMS down, attendance system failure)
- Emergency attendance issues (no-show for critical shift)

### Provider Abstraction Layer

**Design pattern:** Provider interface + multiple implementations

```typescript
interface CommunicationProvider {
  send(recipient: string, subject: string, body: string, attachments?: any[]): Promise<ProviderResponse>;
  getDeliveryStatus(messageId: string): Promise<DeliveryStatus>;
  validateRecipient(contact: string): boolean;
}
```

**Supported providers (pluggable):**
1. **Email:** Nodemailer (external SMTP) OR Local Email Tool (custom API)
2. **SMS:** Twilio (external) OR Local SMS Tool (custom gateway)
3. **WhatsApp:** Twilio (external) OR Local WhatsApp Tool (custom Business API)

**Provider selection (env config):**
```bash
EMAIL_PROVIDER=nodemailer  # or 'local-email-tool'
SMS_PROVIDER=twilio        # or 'local-sms-tool'
WHATSAPP_PROVIDER=twilio   # or 'local-whatsapp-tool'
```

**Provider registration (factory pattern):**
```typescript
const providerFactory = {
  email: {
    'nodemailer': () => new NodemailerProvider(),
    'local-email-tool': () => new LocalEmailProvider()
  },
  sms: {
    'twilio': () => new TwilioSMSProvider(),
    'local-sms-tool': () => new LocalSMSProvider()
  },
  whatsapp: {
    'twilio': () => new TwilioWhatsAppProvider(),
    'local-whatsapp-tool': () => new LocalWhatsAppProvider()
  }
};
```

Dispatch service calls provider via interface, never directly. Swap providers via config without code changes.

### Provider Implementations

#### Email Provider (Nodemailer)

**Configuration:**
```typescript
{
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
}
```

**Features:**
- HTML + plain text versions (multipart/alternative)
- Attachment support (PDFs, images)
- Delivery confirmation via SMTP response
- Bounce detection via webhook (if supported by provider)
- Open tracking via 1x1 pixel (optional, privacy-configurable)
- Click tracking via wrapped URLs (optional)

**Limits:**
- Max 10 MB attachment size
- Max 50 recipients per email (for bulk sends, use queue)

#### Email Provider (Local Email Tool)

**Configuration:**
```typescript
{
  apiEndpoint: process.env.LOCAL_EMAIL_API_URL,
  apiKey: process.env.LOCAL_EMAIL_API_KEY
}
```

**Implementation:** POST request to local API with standardized payload. Local tool handles SMTP/delivery internally.

**Benefits:**
- Full control over delivery infrastructure
- Custom rate limiting
- Integration with internal monitoring
- No external dependencies

#### SMS Provider (Twilio)

**Configuration:**
```typescript
{
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID
}
```

**Features:**
- Text-only (no HTML)
- 160 character limit (auto-truncate with "..." if longer)
- Country code validation (+91 for India)
- Delivery status webhook
- Retry on network errors

**Limits:**
- 160 chars per SMS
- No attachments
- India: promotional SMS restricted to 9 AM - 9 PM

#### SMS Provider (Local SMS Tool)

**Configuration:**
```typescript
{
  apiEndpoint: process.env.LOCAL_SMS_API_URL,
  apiKey: process.env.LOCAL_SMS_API_KEY,
  senderId: process.env.LOCAL_SMS_SENDER_ID
}
```

**Implementation:** POST to local SMS gateway API. Local tool interfaces with telecom provider (Airtel, Jio, etc.) directly.

**Benefits:**
- Negotiated bulk rates with telecom
- DLT registration managed internally
- Custom delivery reports

#### WhatsApp Provider (Twilio)

**Configuration:**
```typescript
{
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER // e.g., whatsapp:+14155238886
}
```

**Features:**
- Rich formatting (bold: *text*, lists, links)
- Media attachments (images, PDFs up to 16 MB)
- Template-based (pre-approved with Twilio)
- Read receipts via webhook
- Delivery status tracking

**Template approval process:**
1. Create template in Twilio console
2. Submit for approval (1-2 business days)
3. Once approved, reference template SID in code
4. Cannot send free-form messages (WhatsApp Business API restriction)

**Limits:**
- Must use pre-approved templates
- Max 5 MB media attachments
- 24-hour session window (after user replies, can send free-form for 24h)

#### WhatsApp Provider (Local WhatsApp Tool)

**Configuration:**
```typescript
{
  apiEndpoint: process.env.LOCAL_WHATSAPP_API_URL,
  apiKey: process.env.LOCAL_WHATSAPP_API_KEY,
  businessNumber: process.env.LOCAL_WHATSAPP_BUSINESS_NUMBER
}
```

**Implementation:** POST to local WhatsApp API. Local tool manages Meta Business API integration, template approval, webhooks.

**Benefits:**
- Centralized template management
- Shared rate limits across applications
- Custom analytics dashboard
- Direct Meta relationship

### Bulk Dispatch

For large recipient lists (> 100):
1. Queue messages (Redis or DB queue table)
2. Process in batches (10 per second for email, 1 per second for SMS/WhatsApp to avoid rate limits)
3. Update dispatch_log for each message
4. Admin dashboard shows progress (sent/pending/failed counts)

## Logging & Audit Trail

### Tiered Retention

**Critical (retain forever):**
- is_critical=1
- Categories: payroll errors, compliance, security
- Stores: full message body, all delivery events, recipient details

**Standard (90 days):**
- Categories: leave, performance, attendance
- Stores: subject, body preview (500 chars), delivery status

**Routine (30 days):**
- Categories: announcements, surveys, reminders
- Stores: subject, recipient, status only

### Cleanup Cron Job

**Schedule:** Daily at 2 AM

**Logic:**
```sql
-- Delete routine logs older than 30 days
DELETE FROM dispatch_log 
WHERE is_critical=0 
  AND retention_category='routine' 
  AND sent_at < NOW() - INTERVAL 30 DAY;

-- Delete standard logs older than 90 days
DELETE FROM dispatch_log 
WHERE is_critical=0 
  AND retention_category='standard' 
  AND sent_at < NOW() - INTERVAL 90 DAY;
```

### Tracked Events

**Status flow:**
1. **queued** - Message queued for sending
2. **sent** - Message accepted by provider (email sent via SMTP, SMS/WhatsApp accepted by Twilio)
3. **delivered** - Provider confirmed delivery
4. **opened** - Email opened (pixel tracking)
5. **clicked** - Link clicked (tracked URLs)
6. **bounced** - Email bounce (hard or soft)
7. **failed** - Provider error (invalid recipient, network failure)

**Event timestamps:**
- sent_at: when message sent
- delivered_at: when provider confirmed delivery
- opened_at: when email opened (first open only)
- clicked_at: when link clicked (first click only)

### Retry Logic

**Auto-retry (3 attempts):**
- Failed sends retry with exponential backoff: 5min, 30min, 2hr
- Retry on: SMTP errors (timeout, connection refused), SMS network errors
- No retry on: invalid email, invalid phone number, unsubscribed recipient

**After 3 failures:**
- Mark as permanently failed
- Alert admin (create notification + email to admin)
- Admin can manually retry from dispatch log UI

### Admin UI Features

**Dispatch History Table:**
- Columns: timestamp, recipient, channel, template, status, delivered_at, error
- Filters: date range, channel, status, recipient, template category
- Search: recipient name/email/phone
- Export: CSV for audit (respects retention rules, critical logs only)

**Real-time Delivery Status:**
- Auto-refresh every 30s for recent messages (last 24h)
- Color-coded status badges (green=delivered, yellow=sent, red=failed)

**Retry Failed Messages:**
- Bulk select failed messages
- "Retry Selected" button
- Confirmation dialog with failure reason
- New dispatch_log entry created on retry

## API Endpoints

### Template Management (Admin)

**GET /api/communication/templates**
- Query params: category, channel, is_active
- Returns: list of templates (DB + file-based)

**GET /api/communication/templates/:id**
- Returns: single template with variables_schema

**POST /api/communication/templates**
- Body: name, subject, body_html, body_text, category, channel, variables_schema, is_critical
- Validates: template syntax, variable references
- Returns: created template

**PATCH /api/communication/templates/:id**
- Body: partial update
- Returns: updated template

**DELETE /api/communication/templates/:id**
- Soft delete (is_active=0)

**POST /api/communication/templates/:id/preview**
- Body: sample_data (JSON)
- Returns: rendered HTML + text

**POST /api/communication/templates/:id/test-send**
- Body: recipient_email or recipient_phone
- Sends test message using sample data
- Returns: dispatch_log entry

### Dispatch (HR/Manager)

**POST /api/communication/dispatch/send**
- Body: template_id, recipient_employee_ids[], data (variables), channel (optional, uses preference if null)
- Validates: recipients exist, data matches schema
- Creates dispatch_log entries
- Queues messages for sending
- Returns: {queued: count, failed: count}

**POST /api/communication/dispatch/bulk**
- Body: template_id, recipient_filter (JSON), data
- Filters employees (e.g., {department: "Sales", status: "active"})
- Queues messages in batches
- Returns: {total_recipients: count, queued: count}

**POST /api/communication/dispatch/schedule**
- Body: template_id, recipients, data, scheduled_at
- Schedules message for future send
- Returns: scheduled job ID

**GET /api/communication/dispatch/logs**
- Query params: employee_id, channel, status, date_from, date_to, page, limit
- Returns: paginated dispatch logs

**POST /api/communication/dispatch/retry/:id**
- Retries failed dispatch
- Returns: new dispatch_log entry

### Notification Preferences (Employee)

**GET /api/communication/preferences**
- Returns: employee's preferences for all categories

**PATCH /api/communication/preferences**
- Body: category, preferred_channel, enabled
- Updates preference
- Returns: updated preferences

**GET /api/communication/history**
- Employee's own dispatch history (last 90 days)
- Returns: list of messages sent to employee

### Admin/Analytics

**GET /api/communication/stats**
- Returns: {
    total_sent_today: count,
    delivery_rate: percentage,
    open_rate: percentage (email only),
    failed_count: count,
    by_channel: {email: count, sms: count, whatsapp: count}
  }

**GET /api/communication/failed-messages**
- Returns: list of failed dispatches awaiting retry
- Used for admin dashboard alert

## Frontend Components

### Admin Pages

**1. Template Manager (`/communication/templates`)**
- List view: table with name, category, channel, status, actions
- Create/Edit modal: rich text editor, variable picker, preview pane
- Test send dialog: enter email/phone, send sample
- Delete confirmation

**2. Dispatch Center (`/communication/dispatch`)**
- Template selector dropdown
- Recipient selection: individual, bulk (department/process filter), CSV upload
- Variable data input form (dynamic based on template schema)
- Send now / Schedule later toggle
- Confirmation with estimated cost (for SMS/WhatsApp)

**3. Dispatch History (`/communication/history`)**
- Table with filters: date range, channel, status, recipient search
- Status badges with tooltips (hover for error message)
- Retry button for failed messages
- Export button (CSV download)

### Employee Pages

**1. Notification Preferences (`/settings/notifications`)**
- Category list (onboarding, payroll, attendance, etc.)
- Channel selector per category: email / SMS / WhatsApp
- Enable/disable toggle per category
- Save button with confirmation toast

**2. Message History (`/notifications/history`)**
- Employee's received messages (last 90 days)
- Filter by channel, date
- View message body (if stored)
- Unsubscribe link for non-critical categories

## Integration Points

### Existing Modules

**Payroll:**
- On payslip generated → send "Payslip Ready" notification
- On salary credited → send "Salary Credited" confirmation
- On payroll error → send critical alert

**Attendance:**
- On late arrival → send "Late Arrival" alert to employee + manager
- On absent → send "Absent Alert" to manager
- On regularization approved → send confirmation to employee

**Leave:**
- On request submitted → send confirmation to employee
- On request approved/rejected → send notification to employee
- On balance low → send reminder

**Performance:**
- On feedback ready → send notification to employee
- On appraisal due → send reminder to employee + manager

**Onboarding:**
- On candidate converted → send "Welcome" email with document checklist
- On documents pending → send reminder

**Engagement:**
- On badge earned → send congratulations
- On kudos received → send notification
- On survey available → send invitation

### Hook Pattern

Each module calls dispatch service:

```typescript
import { dispatchService } from '../communication/dispatch.service';

// In payslip.service.ts
async generatePayslip(employeeId: string, runId: string) {
  const payslip = await this.createPayslip(employeeId, runId);
  
  await dispatchService.send({
    template_name: 'payslip-ready',
    category: 'payroll',
    recipient_employee_id: employeeId,
    data: {
      employee: { name: payslip.employee_name },
      payslip: {
        month: payslip.month,
        year: payslip.year,
        net_pay: payslip.net_pay,
        payslip_url: `/payroll/payslip/${payslip.id}`
      }
    }
  });
  
  return payslip;
}
```

## Security & Privacy

**PII Protection:**
- dispatch_log stores hashed recipient_contact for routine/standard retention
- Full contact details only for critical logs
- Body preview limited to 500 chars (no sensitive data in preview)

**Access Control:**
- Admins: full template CRUD, view all logs, retry failed
- Managers: send to team only, view team logs only
- Employees: view own preferences + history only

**Rate Limiting:**
- API: 100 requests/min per user for dispatch endpoints
- Email: 100/hour per user for ad-hoc sends
- SMS/WhatsApp: 50/hour per user (cost protection)

**Unsubscribe:**
- All non-critical emails include unsubscribe link
- Unsubscribe updates notification_preferences (enabled=0 for category)
- Critical alerts cannot be unsubscribed

## Cost Estimation

**Assumptions:**
- 500 employees
- Average 10 notifications/employee/month = 5,000 messages/month

**Email (Nodemailer + SMTP provider):**
- Free if using own SMTP server
- SendGrid: $15/month for 50,000 emails → ~$1.50/month

**SMS (Twilio):**
- India: ₹0.50 per SMS
- 5,000 SMS/month → ₹2,500/month (~$30)

**WhatsApp (Twilio):**
- India: ₹0.25 per message
- 5,000 WhatsApp/month → ₹1,250/month (~$15)

**Total estimated cost:** $45-50/month for 5,000 messages

**Cost optimization:**
- Default to email (free)
- SMS/WhatsApp only for critical or user-preferred
- Bulk sends use queue to avoid rate limit charges

## Success Metrics

**Delivery Rate:**
- Target: >95% for email, >90% for SMS/WhatsApp
- Track: delivered_count / sent_count

**Open Rate (email only):**
- Target: >40% for critical, >20% for routine
- Track: opened_count / delivered_count

**Response Time:**
- Target: <30s from trigger to sent
- Track: sent_at - created_at

**User Satisfaction:**
- Survey employees: notification frequency, relevance, channel preference
- Target: >80% satisfaction

**Cost per Message:**
- Track: monthly spend / total messages sent
- Target: <$0.01 per message

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)
- Database schema + migrations
- Template service with Handlebars rendering
- Email provider (nodemailer)
- Basic dispatch service (email only)
- Admin template manager UI

### Phase 2: Multi-Channel (Week 3)
- Twilio integration (SMS + WhatsApp)
- Notification preferences table + service
- Channel routing logic
- Employee preferences UI

### Phase 3: Logging & Retry (Week 4)
- Dispatch log table
- Retry logic with exponential backoff
- Admin dispatch history UI
- Cleanup cron job

### Phase 4: Integration (Week 5)
- Hook payroll, attendance, leave, performance modules
- Seed 15-20 file-based templates
- Test end-to-end workflows
- Production deployment

### Phase 5: Enhancements (Future)
- Scheduled sends
- Template analytics (open rate by template)
- A/B testing (send variant A to 50%, B to 50%)
- Push notifications (PWA)

## Open Questions

None - design complete and approved.

## Approval

Design approved by user on 2026-06-01.

Next step: Create implementation plan using writing-plans skill.
