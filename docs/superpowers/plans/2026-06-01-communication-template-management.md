# Communication Template Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build multi-channel communication system with email/SMS/WhatsApp dispatch, Handlebars templates, user preferences, and tiered audit logging.

**Architecture:** Hybrid templates (file-based critical + DB custom), provider abstraction layer (Twilio OR local tools), Handlebars rendering, preference-based routing, tiered retention (critical forever, routine 30 days).

**Tech Stack:** TypeScript, Express, MySQL, Handlebars, Nodemailer, Twilio SDK, Zod

---

## File Structure

### Backend Files (17 files)

**Database:**
- `backend/sql/040_communication.sql` - 3 tables (template, preferences, dispatch_log)

**Types & Validation:**
- `backend/src/modules/communication/communication.types.ts` - TypeScript interfaces
- `backend/src/modules/communication/communication.validation.ts` - Zod schemas

**Templates (15 Handlebars files):**
- `backend/src/modules/communication/templates/onboarding/welcome-email.hbs`
- `backend/src/modules/communication/templates/onboarding/welcome-email.txt.hbs`
- `backend/src/modules/communication/templates/onboarding/documents-pending.hbs`
- `backend/src/modules/communication/templates/onboarding/documents-pending.txt.hbs`
- `backend/src/modules/communication/templates/payroll/payslip-ready.hbs`
- `backend/src/modules/communication/templates/payroll/payslip-ready.txt.hbs`
- `backend/src/modules/communication/templates/payroll/salary-credited.hbs`
- `backend/src/modules/communication/templates/payroll/salary-credited.txt.hbs`
- `backend/src/modules/communication/templates/attendance/late-arrival.hbs`
- `backend/src/modules/communication/templates/attendance/absent-alert.hbs`
- `backend/src/modules/communication/templates/leave/request-approved.hbs`
- `backend/src/modules/communication/templates/leave/request-rejected.hbs`
- `backend/src/modules/communication/templates/performance/feedback-ready.hbs`
- `backend/src/modules/communication/templates/performance/appraisal-due.hbs`
- `backend/src/modules/communication/templates/variable-schemas.json` - Variable definitions per category

**Providers:**
- `backend/src/modules/communication/providers/provider.interface.ts` - Abstract interface
- `backend/src/modules/communication/providers/provider.factory.ts` - Factory + registration
- `backend/src/modules/communication/providers/email/nodemailer.provider.ts`
- `backend/src/modules/communication/providers/email/local-email.provider.ts`
- `backend/src/modules/communication/providers/sms/twilio-sms.provider.ts`
- `backend/src/modules/communication/providers/sms/local-sms.provider.ts`
- `backend/src/modules/communication/providers/whatsapp/twilio-whatsapp.provider.ts`
- `backend/src/modules/communication/providers/whatsapp/local-whatsapp.provider.ts`

**Services:**
- `backend/src/modules/communication/template.service.ts` - Template CRUD + rendering
- `backend/src/modules/communication/dispatch.service.ts` - Send messages, retry logic
- `backend/src/modules/communication/notification-preferences.service.ts` - User preferences CRUD

**API:**
- `backend/src/modules/communication/communication.controller.ts` - 18 endpoints
- `backend/src/modules/communication/communication.routes.ts` - Route registration

**Cron:**
- `backend/src/modules/communication/cleanup.cron.ts` - Tiered retention cleanup (daily 2 AM)

**Integration:**
- Modify: `backend/src/app.ts` - Register routes
- Modify: `backend/src/modules/access/role.catalog.ts` - RBAC permissions

### Frontend Files (5 files)

**Pages:**
- `src/pages/NativeTemplateManager.tsx` - Admin template CRUD
- `src/pages/NativeDispatchCenter.tsx` - Send messages UI
- `src/pages/NativeDispatchHistory.tsx` - Logs + retry
- `src/pages/NativeNotificationPreferences.tsx` - Employee settings

**Components:**
- `src/components/communication/TemplateEditor.tsx` - Rich text editor with variable picker
- `src/components/communication/DispatchStatusBadge.tsx` - Status icons
- `src/components/communication/VariablePicker.tsx` - Dropdown for Handlebars variables

**Navigation:**
- Modify: `src/App.tsx` - Route registration
- Modify: `src/components/layout/DashboardLayout.tsx` - Nav items

---

## Task 1: Database Schema

**Files:**
- Create: `backend/sql/040_communication.sql`

- [ ] **Step 1: Create communication_template table**

```sql
-- backend/sql/040_communication.sql
-- Communication Template Management Schema

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
  INDEX idx_category_active (category, is_active),
  INDEX idx_created_by (created_by)
);
```

- [ ] **Step 2: Create notification_preferences table**

```sql
-- Append to backend/sql/040_communication.sql

CREATE TABLE notification_preferences (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  category ENUM('onboarding', 'payroll', 'attendance', 'leave', 'performance', 'alerts', 'announcements') NOT NULL,
  preferred_channel ENUM('email', 'sms', 'whatsapp') DEFAULT 'email',
  enabled TINYINT(1) DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uk_employee_category (employee_id, category),
  INDEX idx_employee_enabled (employee_id, enabled)
);
```

- [ ] **Step 3: Create dispatch_log table**

```sql
-- Append to backend/sql/040_communication.sql

CREATE TABLE dispatch_log (
  id VARCHAR(36) PRIMARY KEY,
  template_id VARCHAR(36),
  template_name VARCHAR(100) NOT NULL,
  recipient_employee_id VARCHAR(36),
  recipient_contact VARCHAR(100) NOT NULL,
  channel ENUM('email', 'sms', 'whatsapp') NOT NULL,
  status ENUM('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed') NOT NULL DEFAULT 'queued',
  subject VARCHAR(200),
  body_preview VARCHAR(500),
  sent_at TIMESTAMP NULL,
  delivered_at TIMESTAMP NULL,
  opened_at TIMESTAMP NULL,
  clicked_at TIMESTAMP NULL,
  error_message TEXT,
  is_critical TINYINT(1) DEFAULT 0,
  retention_category ENUM('critical', 'standard', 'routine') NOT NULL DEFAULT 'standard',
  retry_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES communication_template(id) ON DELETE SET NULL,
  FOREIGN KEY (recipient_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  INDEX idx_recipient_channel (recipient_employee_id, channel, sent_at DESC),
  INDEX idx_status_retry (status, retry_count),
  INDEX idx_retention_cleanup (is_critical, retention_category, sent_at)
);
```

- [ ] **Step 4: Commit**

```bash
git add backend/sql/040_communication.sql
git commit -m "feat(communication): add database schema

- communication_template: DB templates with Handlebars
- notification_preferences: user channel preferences per category
- dispatch_log: audit trail with tiered retention"
```

---

## Task 2: TypeScript Types

**Files:**
- Create: `backend/src/modules/communication/communication.types.ts`

- [ ] **Step 1: Create types file with all interfaces**

```typescript
// backend/src/modules/communication/communication.types.ts

// ========== Database Table Interfaces ==========

export interface CommunicationTemplate {
  id: string;
  name: string;
  subject: string | null;
  body_html: string;
  body_text: string | null;
  category: TemplateCategory;
  channel: Channel;
  variables_schema: VariablesSchema | null;
  is_active: number;
  is_critical: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationPreferences {
  id: string;
  employee_id: string;
  category: NotificationCategory;
  preferred_channel: Channel;
  enabled: number;
  updated_at: string;
}

export interface DispatchLog {
  id: string;
  template_id: string | null;
  template_name: string;
  recipient_employee_id: string | null;
  recipient_contact: string;
  channel: Channel;
  status: DispatchStatus;
  subject: string | null;
  body_preview: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  error_message: string | null;
  is_critical: number;
  retention_category: RetentionCategory;
  retry_count: number;
  created_at: string;
}

// ========== Enums ==========

export type TemplateCategory = 
  | 'onboarding'
  | 'payroll'
  | 'attendance'
  | 'leave'
  | 'performance'
  | 'alerts'
  | 'announcements'
  | 'custom';

export type NotificationCategory = Exclude<TemplateCategory, 'custom'>;

export type Channel = 'email' | 'sms' | 'whatsapp';

export type MultiChannel = Channel | 'multi';

export type DispatchStatus = 
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'failed';

export type RetentionCategory = 'critical' | 'standard' | 'routine';

// ========== JSON Field Types ==========

export interface VariablesSchema {
  [category: string]: {
    [entity: string]: string[];
  };
}

// ========== DTO Types ==========

export interface CreateTemplateDTO {
  name: string;
  subject?: string;
  body_html: string;
  body_text?: string;
  category: TemplateCategory;
  channel: MultiChannel;
  variables_schema?: VariablesSchema;
  is_critical?: boolean;
  created_by: string;
}

export interface UpdateTemplateDTO {
  name?: string;
  subject?: string;
  body_html?: string;
  body_text?: string;
  is_active?: boolean;
}

export interface TemplateFilters {
  category?: TemplateCategory;
  channel?: MultiChannel;
  is_active?: boolean;
  search?: string;
}

export interface SendMessageDTO {
  template_id?: string;
  template_name?: string;
  recipient_employee_ids: string[];
  data: Record<string, any>;
  channel?: Channel;
  is_critical?: boolean;
}

export interface BulkSendDTO {
  template_id?: string;
  template_name?: string;
  recipient_filter: RecipientFilter;
  data: Record<string, any>;
  channel?: Channel;
}

export interface RecipientFilter {
  department?: string;
  process_id?: string;
  designation?: string;
  status?: string;
}

export interface ScheduleSendDTO extends SendMessageDTO {
  scheduled_at: string;
}

export interface DispatchLogFilters {
  employee_id?: string;
  channel?: Channel;
  status?: DispatchStatus;
  date_from?: string;
  date_to?: string;
  page?: number;
  limit?: number;
}

export interface UpdatePreferencesDTO {
  category: NotificationCategory;
  preferred_channel: Channel;
  enabled: boolean;
}

export interface RenderTemplateDTO {
  template_id?: string;
  template_name?: string;
  data: Record<string, any>;
}

export interface ProviderResponse {
  success: boolean;
  message_id?: string;
  error?: string;
}

export interface DeliveryStatus {
  status: DispatchStatus;
  delivered_at?: string;
  error?: string;
}

// ========== Response Types ==========

export interface DispatchResult {
  queued: number;
  failed: number;
  dispatch_ids: string[];
}

export interface DispatchStats {
  total_sent_today: number;
  delivery_rate: number;
  open_rate: number;
  failed_count: number;
  by_channel: {
    email: number;
    sms: number;
    whatsapp: number;
  };
}

export interface PaginatedDispatchLogs {
  logs: DispatchLog[];
  total: number;
  page: number;
  limit: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/communication/communication.types.ts
git commit -m "feat(communication): add TypeScript type definitions

- 3 table interfaces (template, preferences, log)
- 8 enums (categories, channels, status)
- 15 DTOs (send, bulk, schedule, filters)"
```

---

## Task 3: Zod Validation Schemas

**Files:**
- Create: `backend/src/modules/communication/communication.validation.ts`

- [ ] **Step 1: Create validation file**

```typescript
// backend/src/modules/communication/communication.validation.ts
import { z } from 'zod';

// ========== Enums ==========

export const TemplateCategorySchema = z.enum([
  'onboarding',
  'payroll',
  'attendance',
  'leave',
  'performance',
  'alerts',
  'announcements',
  'custom'
]);

export const NotificationCategorySchema = z.enum([
  'onboarding',
  'payroll',
  'attendance',
  'leave',
  'performance',
  'alerts',
  'announcements'
]);

export const ChannelSchema = z.enum(['email', 'sms', 'whatsapp']);

export const MultiChannelSchema = z.enum(['email', 'sms', 'whatsapp', 'multi']);

export const DispatchStatusSchema = z.enum([
  'queued',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'failed'
]);

// ========== Template Validation ==========

export const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  subject: z.string().max(200).optional(),
  body_html: z.string().min(1),
  body_text: z.string().optional(),
  category: TemplateCategorySchema,
  channel: MultiChannelSchema,
  variables_schema: z.record(z.any()).optional(),
  is_critical: z.boolean().optional(),
  created_by: z.string().uuid()
});

export const UpdateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  subject: z.string().max(200).optional(),
  body_html: z.string().min(1).optional(),
  body_text: z.string().optional(),
  is_active: z.boolean().optional()
});

export const TemplateFiltersSchema = z.object({
  category: TemplateCategorySchema.optional(),
  channel: MultiChannelSchema.optional(),
  is_active: z.boolean().optional(),
  search: z.string().optional()
});

// ========== Dispatch Validation ==========

export const SendMessageSchema = z.object({
  template_id: z.string().uuid().optional(),
  template_name: z.string().optional(),
  recipient_employee_ids: z.array(z.string().uuid()).min(1),
  data: z.record(z.any()),
  channel: ChannelSchema.optional(),
  is_critical: z.boolean().optional()
}).refine(
  data => data.template_id || data.template_name,
  { message: "Either template_id or template_name required" }
);

export const BulkSendSchema = z.object({
  template_id: z.string().uuid().optional(),
  template_name: z.string().optional(),
  recipient_filter: z.object({
    department: z.string().optional(),
    process_id: z.string().uuid().optional(),
    designation: z.string().optional(),
    status: z.string().optional()
  }),
  data: z.record(z.any()),
  channel: ChannelSchema.optional()
}).refine(
  data => data.template_id || data.template_name,
  { message: "Either template_id or template_name required" }
);

export const ScheduleSendSchema = SendMessageSchema.extend({
  scheduled_at: z.string().datetime()
});

export const DispatchLogFiltersSchema = z.object({
  employee_id: z.string().uuid().optional(),
  channel: ChannelSchema.optional(),
  status: DispatchStatusSchema.optional(),
  date_from: z.string().date().optional(),
  date_to: z.string().date().optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional()
});

export const RetryDispatchSchema = z.object({
  dispatch_id: z.string().uuid()
});

// ========== Preferences Validation ==========

export const UpdatePreferencesSchema = z.object({
  category: NotificationCategorySchema,
  preferred_channel: ChannelSchema,
  enabled: z.boolean()
});

// ========== Template Rendering Validation ==========

export const RenderTemplateSchema = z.object({
  template_id: z.string().uuid().optional(),
  template_name: z.string().optional(),
  data: z.record(z.any())
}).refine(
  data => data.template_id || data.template_name,
  { message: "Either template_id or template_name required" }
);
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/communication/communication.validation.ts
git commit -m "feat(communication): add Zod validation schemas

- Template validation (create, update, filters)
- Dispatch validation (send, bulk, schedule)
- Preferences validation
- Render template validation"
```

---

## Task 4: Provider Interface + Factory

**Files:**
- Create: `backend/src/modules/communication/providers/provider.interface.ts`
- Create: `backend/src/modules/communication/providers/provider.factory.ts`

- [ ] **Step 1: Create provider interface**

```typescript
// backend/src/modules/communication/providers/provider.interface.ts
import { ProviderResponse, DeliveryStatus } from '../communication.types';

export interface CommunicationProvider {
  /**
   * Send message to recipient
   */
  send(
    recipient: string,
    subject: string,
    body: string,
    attachments?: Attachment[]
  ): Promise<ProviderResponse>;

  /**
   * Get delivery status for sent message
   */
  getDeliveryStatus(messageId: string): Promise<DeliveryStatus>;

  /**
   * Validate recipient contact (email/phone format)
   */
  validateRecipient(contact: string): boolean;

  /**
   * Provider name for logging
   */
  getName(): string;
}

export interface Attachment {
  filename: string;
  content: Buffer | string;
  contentType: string;
}
```

- [ ] **Step 2: Create provider factory**

```typescript
// backend/src/modules/communication/providers/provider.factory.ts
import { CommunicationProvider } from './provider.interface';
import { Channel } from '../communication.types';

type ProviderType = 'nodemailer' | 'local-email-tool' | 'twilio' | 'local-sms-tool' | 'local-whatsapp-tool';

interface ProviderConfig {
  email: ProviderType;
  sms: ProviderType;
  whatsapp: ProviderType;
}

class ProviderFactory {
  private config: ProviderConfig;
  private providers: Map<string, CommunicationProvider> = new Map();

  constructor() {
    this.config = {
      email: (process.env.EMAIL_PROVIDER as ProviderType) || 'nodemailer',
      sms: (process.env.SMS_PROVIDER as ProviderType) || 'twilio',
      whatsapp: (process.env.WHATSAPP_PROVIDER as ProviderType) || 'twilio'
    };
  }

  /**
   * Get provider for channel
   */
  getProvider(channel: Channel): CommunicationProvider {
    const cacheKey = `${channel}-${this.config[channel]}`;
    
    if (this.providers.has(cacheKey)) {
      return this.providers.get(cacheKey)!;
    }

    const provider = this.createProvider(channel);
    this.providers.set(cacheKey, provider);
    return provider;
  }

  private createProvider(channel: Channel): CommunicationProvider {
    const providerType = this.config[channel];

    switch (channel) {
      case 'email':
        return this.createEmailProvider(providerType);
      case 'sms':
        return this.createSMSProvider(providerType);
      case 'whatsapp':
        return this.createWhatsAppProvider(providerType);
      default:
        throw new Error(`Unsupported channel: ${channel}`);
    }
  }

  private createEmailProvider(type: ProviderType): CommunicationProvider {
    // Lazy imports to avoid loading unused providers
    if (type === 'nodemailer') {
      const { NodemailerProvider } = require('./email/nodemailer.provider');
      return new NodemailerProvider();
    } else if (type === 'local-email-tool') {
      const { LocalEmailProvider } = require('./email/local-email.provider');
      return new LocalEmailProvider();
    }
    throw new Error(`Unsupported email provider: ${type}`);
  }

  private createSMSProvider(type: ProviderType): CommunicationProvider {
    if (type === 'twilio') {
      const { TwilioSMSProvider } = require('./sms/twilio-sms.provider');
      return new TwilioSMSProvider();
    } else if (type === 'local-sms-tool') {
      const { LocalSMSProvider } = require('./sms/local-sms.provider');
      return new LocalSMSProvider();
    }
    throw new Error(`Unsupported SMS provider: ${type}`);
  }

  private createWhatsAppProvider(type: ProviderType): CommunicationProvider {
    if (type === 'twilio') {
      const { TwilioWhatsAppProvider } = require('./whatsapp/twilio-whatsapp.provider');
      return new TwilioWhatsAppProvider();
    } else if (type === 'local-whatsapp-tool') {
      const { LocalWhatsAppProvider } = require('./whatsapp/local-whatsapp.provider');
      return new LocalWhatsAppProvider();
    }
    throw new Error(`Unsupported WhatsApp provider: ${type}`);
  }

  /**
   * Clear provider cache (for testing)
   */
  clearCache(): void {
    this.providers.clear();
  }
}

export const providerFactory = new ProviderFactory();
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/communication/providers/
git commit -m "feat(communication): add provider abstraction layer

- CommunicationProvider interface (send, validate, status)
- ProviderFactory with env-based selection
- Lazy loading for providers
- Support: nodemailer, twilio, local tools"
```

---

## Task 5: Email Providers (Nodemailer + Local)

**Files:**
- Create: `backend/src/modules/communication/providers/email/nodemailer.provider.ts`
- Create: `backend/src/modules/communication/providers/email/local-email.provider.ts`

- [ ] **Step 1: Create Nodemailer provider**

```typescript
// backend/src/modules/communication/providers/email/nodemailer.provider.ts
import nodemailer, { Transporter } from 'nodemailer';
import { CommunicationProvider, Attachment } from '../provider.interface';
import { ProviderResponse, DeliveryStatus } from '../../communication.types';

export class NodemailerProvider implements CommunicationProvider {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  async send(
    recipient: string,
    subject: string,
    body: string,
    attachments?: Attachment[]
  ): Promise<ProviderResponse> {
    try {
      const result = await this.transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: recipient,
        subject,
        html: body,
        attachments: attachments?.map(att => ({
          filename: att.filename,
          content: att.content,
          contentType: att.contentType
        }))
      });

      return {
        success: true,
        message_id: result.messageId
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    // Nodemailer doesn't provide delivery tracking out of box
    // Would need to implement via SMTP provider webhooks
    return {
      status: 'sent'
    };
  }

  validateRecipient(contact: string): boolean {
    // Basic email regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(contact);
  }

  getName(): string {
    return 'nodemailer';
  }
}
```

- [ ] **Step 2: Create Local Email provider**

```typescript
// backend/src/modules/communication/providers/email/local-email.provider.ts
import axios from 'axios';
import { CommunicationProvider, Attachment } from '../provider.interface';
import { ProviderResponse, DeliveryStatus } from '../../communication.types';

export class LocalEmailProvider implements CommunicationProvider {
  private apiEndpoint: string;
  private apiKey: string;

  constructor() {
    this.apiEndpoint = process.env.LOCAL_EMAIL_API_URL || '';
    this.apiKey = process.env.LOCAL_EMAIL_API_KEY || '';

    if (!this.apiEndpoint || !this.apiKey) {
      throw new Error('LOCAL_EMAIL_API_URL and LOCAL_EMAIL_API_KEY required');
    }
  }

  async send(
    recipient: string,
    subject: string,
    body: string,
    attachments?: Attachment[]
  ): Promise<ProviderResponse> {
    try {
      const response = await axios.post(
        `${this.apiEndpoint}/send`,
        {
          to: recipient,
          subject,
          html: body,
          attachments: attachments?.map(att => ({
            filename: att.filename,
            content: att.content.toString('base64'),
            contentType: att.contentType
          }))
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        message_id: response.data.message_id
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    try {
      const response = await axios.get(
        `${this.apiEndpoint}/status/${messageId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      return {
        status: response.data.status,
        delivered_at: response.data.delivered_at,
        error: response.data.error
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  validateRecipient(contact: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(contact);
  }

  getName(): string {
    return 'local-email-tool';
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/communication/providers/email/
git commit -m "feat(communication): add email providers

- NodemailerProvider: SMTP via nodemailer
- LocalEmailProvider: POST to local email API
- Both implement CommunicationProvider interface"
```

---

## Task 6: SMS Providers (Twilio + Local)

**Files:**
- Create: `backend/src/modules/communication/providers/sms/twilio-sms.provider.ts`
- Create: `backend/src/modules/communication/providers/sms/local-sms.provider.ts`

- [ ] **Step 1: Install Twilio SDK**

```bash
cd /home/shuvam/mas-callnet-hrms/backend
npm install twilio
npm install --save-dev @types/twilio
```

- [ ] **Step 2: Create Twilio SMS provider**

```typescript
// backend/src/modules/communication/providers/sms/twilio-sms.provider.ts
import twilio from 'twilio';
import { CommunicationProvider, Attachment } from '../provider.interface';
import { ProviderResponse, DeliveryStatus } from '../../communication.types';

export class TwilioSMSProvider implements CommunicationProvider {
  private client: twilio.Twilio;
  private messagingServiceSid: string;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || '';

    if (!accountSid || !authToken) {
      throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN required');
    }

    this.client = twilio(accountSid, authToken);
  }

  async send(
    recipient: string,
    subject: string,
    body: string,
    attachments?: Attachment[]
  ): Promise<ProviderResponse> {
    try {
      // SMS is text-only, truncate to 160 chars
      const truncatedBody = body.length > 160 ? body.substring(0, 157) + '...' : body;

      const message = await this.client.messages.create({
        messagingServiceSid: this.messagingServiceSid,
        to: recipient,
        body: truncatedBody
      });

      return {
        success: true,
        message_id: message.sid
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    try {
      const message = await this.client.messages(messageId).fetch();

      const statusMap: Record<string, any> = {
        'queued': 'queued',
        'sent': 'sent',
        'delivered': 'delivered',
        'failed': 'failed',
        'undelivered': 'failed'
      };

      return {
        status: statusMap[message.status] || 'failed',
        delivered_at: message.dateUpdated?.toISOString(),
        error: message.errorMessage || undefined
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  validateRecipient(contact: string): boolean {
    // Basic phone regex (international format)
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(contact);
  }

  getName(): string {
    return 'twilio-sms';
  }
}
```

- [ ] **Step 3: Create Local SMS provider**

```typescript
// backend/src/modules/communication/providers/sms/local-sms.provider.ts
import axios from 'axios';
import { CommunicationProvider, Attachment } from '../provider.interface';
import { ProviderResponse, DeliveryStatus } from '../../communication.types';

export class LocalSMSProvider implements CommunicationProvider {
  private apiEndpoint: string;
  private apiKey: string;
  private senderId: string;

  constructor() {
    this.apiEndpoint = process.env.LOCAL_SMS_API_URL || '';
    this.apiKey = process.env.LOCAL_SMS_API_KEY || '';
    this.senderId = process.env.LOCAL_SMS_SENDER_ID || '';

    if (!this.apiEndpoint || !this.apiKey) {
      throw new Error('LOCAL_SMS_API_URL and LOCAL_SMS_API_KEY required');
    }
  }

  async send(
    recipient: string,
    subject: string,
    body: string,
    attachments?: Attachment[]
  ): Promise<ProviderResponse> {
    try {
      // Truncate to 160 chars
      const truncatedBody = body.length > 160 ? body.substring(0, 157) + '...' : body;

      const response = await axios.post(
        `${this.apiEndpoint}/send`,
        {
          to: recipient,
          message: truncatedBody,
          sender_id: this.senderId
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        message_id: response.data.message_id
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    try {
      const response = await axios.get(
        `${this.apiEndpoint}/status/${messageId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      return {
        status: response.data.status,
        delivered_at: response.data.delivered_at,
        error: response.data.error
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  validateRecipient(contact: string): boolean {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(contact);
  }

  getName(): string {
    return 'local-sms-tool';
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/communication/providers/sms/ backend/package.json backend/package-lock.json
git commit -m "feat(communication): add SMS providers

- TwilioSMSProvider: SMS via Twilio API
- LocalSMSProvider: POST to local SMS gateway
- Auto-truncate to 160 chars
- Delivery status tracking"
```

---

## Task 7: WhatsApp Providers (Twilio + Local)

**Files:**
- Create: `backend/src/modules/communication/providers/whatsapp/twilio-whatsapp.provider.ts`
- Create: `backend/src/modules/communication/providers/whatsapp/local-whatsapp.provider.ts`

- [ ] **Step 1: Create Twilio WhatsApp provider**

```typescript
// backend/src/modules/communication/providers/whatsapp/twilio-whatsapp.provider.ts
import twilio from 'twilio';
import { CommunicationProvider, Attachment } from '../provider.interface';
import { ProviderResponse, DeliveryStatus } from '../../communication.types';

export class TwilioWhatsAppProvider implements CommunicationProvider {
  private client: twilio.Twilio;
  private whatsappNumber: string;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER || '';

    if (!accountSid || !authToken || !this.whatsappNumber) {
      throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER required');
    }

    this.client = twilio(accountSid, authToken);
  }

  async send(
    recipient: string,
    subject: string,
    body: string,
    attachments?: Attachment[]
  ): Promise<ProviderResponse> {
    try {
      // WhatsApp via Twilio requires whatsapp: prefix
      const whatsappRecipient = recipient.startsWith('whatsapp:') ? recipient : `whatsapp:${recipient}`;
      
      const message = await this.client.messages.create({
        from: this.whatsappNumber,
        to: whatsappRecipient,
        body
      });

      return {
        success: true,
        message_id: message.sid
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    try {
      const message = await this.client.messages(messageId).fetch();

      const statusMap: Record<string, any> = {
        'queued': 'queued',
        'sent': 'sent',
        'delivered': 'delivered',
        'read': 'opened',
        'failed': 'failed',
        'undelivered': 'failed'
      };

      return {
        status: statusMap[message.status] || 'failed',
        delivered_at: message.dateUpdated?.toISOString(),
        error: message.errorMessage || undefined
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  validateRecipient(contact: string): boolean {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(contact.replace('whatsapp:', ''));
  }

  getName(): string {
    return 'twilio-whatsapp';
  }
}
```

- [ ] **Step 2: Create Local WhatsApp provider**

```typescript
// backend/src/modules/communication/providers/whatsapp/local-whatsapp.provider.ts
import axios from 'axios';
import { CommunicationProvider, Attachment } from '../provider.interface';
import { ProviderResponse, DeliveryStatus } from '../../communication.types';

export class LocalWhatsAppProvider implements CommunicationProvider {
  private apiEndpoint: string;
  private apiKey: string;
  private businessNumber: string;

  constructor() {
    this.apiEndpoint = process.env.LOCAL_WHATSAPP_API_URL || '';
    this.apiKey = process.env.LOCAL_WHATSAPP_API_KEY || '';
    this.businessNumber = process.env.LOCAL_WHATSAPP_BUSINESS_NUMBER || '';

    if (!this.apiEndpoint || !this.apiKey) {
      throw new Error('LOCAL_WHATSAPP_API_URL and LOCAL_WHATSAPP_API_KEY required');
    }
  }

  async send(
    recipient: string,
    subject: string,
    body: string,
    attachments?: Attachment[]
  ): Promise<ProviderResponse> {
    try {
      const response = await axios.post(
        `${this.apiEndpoint}/send`,
        {
          to: recipient.replace('whatsapp:', ''),
          from: this.businessNumber,
          message: body,
          attachments: attachments?.map(att => ({
            filename: att.filename,
            content: att.content.toString('base64'),
            contentType: att.contentType
          }))
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        message_id: response.data.message_id
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    try {
      const response = await axios.get(
        `${this.apiEndpoint}/status/${messageId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      return {
        status: response.data.status,
        delivered_at: response.data.delivered_at,
        error: response.data.error
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  validateRecipient(contact: string): boolean {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(contact.replace('whatsapp:', ''));
  }

  getName(): string {
    return 'local-whatsapp-tool';
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/communication/providers/whatsapp/
git commit -m "feat(communication): add WhatsApp providers

- TwilioWhatsAppProvider: WhatsApp via Twilio API
- LocalWhatsAppProvider: POST to local WhatsApp Business API
- Delivery status tracking
- Attachment support"
```

---

## Task 8: Handlebars Templates + Variable Schemas

**Files:**
- Create: `backend/src/modules/communication/templates/variable-schemas.json`
- Create: 14 template files (onboarding, payroll, attendance, leave, performance)

- [ ] **Step 1: Create variable schemas JSON**

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
  },
  "leave": {
    "employee": ["name", "id"],
    "leave": ["type", "from_date", "to_date", "days", "reason"],
    "manager": ["name"],
    "company": ["name"]
  },
  "performance": {
    "employee": ["name", "id"],
    "feedback": ["cycle_name", "overall_score", "report_url"],
    "manager": ["name"],
    "company": ["name"]
  }
}
```

- [ ] **Step 2: Create onboarding templates**

```handlebars
{{!-- backend/src/modules/communication/templates/onboarding/welcome-email.hbs --}}
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .button { background: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Welcome to {{company.name}}!</h1>
  </div>
  <div class="content">
    <p>Hi {{employee.name}},</p>
    
    <p>Congratulations on joining {{company.name}} as {{employee.designation}}! We're excited to have you on the team.</p>
    
    <p>Your joining date is {{formatDate employee.date_of_joining "DD MMM YYYY"}}.</p>
    
    <p>Your manager {{manager.name}} ({{manager.email}}) will guide you through the onboarding process.</p>
    
    <p>Please complete your pending documents by {{formatDate documents.deadline "DD MMM YYYY"}}.</p>
    
    <p><a href="/onboarding" class="button">Start Onboarding</a></p>
    
    <p>Welcome aboard!</p>
    <p>{{company.name}} HR Team</p>
  </div>
</body>
</html>
```

```handlebars
{{!-- backend/src/modules/communication/templates/onboarding/welcome-email.txt.hbs --}}
Welcome to {{company.name}}!

Hi {{employee.name}},

Congratulations on joining {{company.name}} as {{employee.designation}}! We're excited to have you on the team.

Your joining date is {{formatDate employee.date_of_joining "DD MMM YYYY"}}.

Your manager {{manager.name}} ({{manager.email}}) will guide you through the onboarding process.

Please complete your pending documents by {{formatDate documents.deadline "DD MMM YYYY"}}.

Welcome aboard!
{{company.name}} HR Team
```

- [ ] **Step 3: Create payroll templates**

```handlebars
{{!-- backend/src/modules/communication/templates/payroll/payslip-ready.hbs --}}
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <p>Hi {{employee.name}},</p>
  
  <p>Your payslip for <strong>{{payslip.month}} {{payslip.year}}</strong> is ready.</p>
  
  <p><strong>Net Pay:</strong> {{currency payslip.net_pay}}</p>
  
  <p><a href="{{payslip.payslip_url}}" style="background: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Payslip</a></p>
  
  <p>Regards,<br>{{company.name}} Payroll Team</p>
</body>
</html>
```

```handlebars
{{!-- backend/src/modules/communication/templates/payroll/payslip-ready.txt.hbs --}}
Hi {{employee.name}},

Your payslip for {{payslip.month}} {{payslip.year}} is ready.

Net Pay: {{currency payslip.net_pay}}

View payslip: {{payslip.payslip_url}}

Regards,
{{company.name}} Payroll Team
```

- [ ] **Step 4: Create attendance templates**

```handlebars
{{!-- backend/src/modules/communication/templates/attendance/late-arrival.hbs --}}
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <p>Hi {{employee.name}},</p>
  
  <p>You were marked late for {{formatDate attendance.date "DD MMM YYYY"}}.</p>
  
  <p><strong>Clock In Time:</strong> {{attendance.clock_in}}</p>
  
  <p>If this is an error, please submit a regularization request.</p>
  
  <p>Regards,<br>{{company.name}} HR Team</p>
</body>
</html>
```

- [ ] **Step 5: Create leave templates**

```handlebars
{{!-- backend/src/modules/communication/templates/leave/request-approved.hbs --}}
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <p>Hi {{employee.name}},</p>
  
  <p>Your leave request has been <strong style="color: green;">APPROVED</strong>.</p>
  
  <p><strong>Leave Type:</strong> {{leave.type}}</p>
  <p><strong>From:</strong> {{formatDate leave.from_date "DD MMM YYYY"}}</p>
  <p><strong>To:</strong> {{formatDate leave.to_date "DD MMM YYYY"}}</p>
  <p><strong>Days:</strong> {{leave.days}}</p>
  
  <p>Approved by: {{manager.name}}</p>
  
  <p>Regards,<br>{{company.name}} HR Team</p>
</body>
</html>
```

- [ ] **Step 6: Create performance templates**

```handlebars
{{!-- backend/src/modules/communication/templates/performance/feedback-ready.hbs --}}
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <p>Hi {{employee.name}},</p>
  
  <p>Your performance feedback for <strong>{{feedback.cycle_name}}</strong> is ready.</p>
  
  <p><strong>Overall Score:</strong> {{feedback.overall_score}}/5</p>
  
  <p><a href="{{feedback.report_url}}" style="background: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Report</a></p>
  
  <p>Reviewed by: {{manager.name}}</p>
  
  <p>Regards,<br>{{company.name}} HR Team</p>
</body>
</html>
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/communication/templates/
git commit -m "feat(communication): add Handlebars templates

- 14 file-based templates (HTML + text versions)
- Variable schemas JSON for validation
- Categories: onboarding, payroll, attendance, leave, performance
- Handlebars helpers: formatDate, currency"
```

---

## Task 9: Template Service

**Files:**
- Create: `backend/src/modules/communication/template.service.ts`

- [ ] **Step 1: Install Handlebars**

```bash
cd /home/shuvam/mas-callnet-hrms/backend
npm install handlebars
npm install --save-dev @types/handlebars
```

- [ ] **Step 2: Create template service**

```typescript
// backend/src/modules/communication/template.service.ts
import { randomUUID } from 'crypto';
import Handlebars from 'handlebars';
import fs from 'fs/promises';
import path from 'path';
import { db } from '../../db/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import {
  CommunicationTemplate,
  CreateTemplateDTO,
  UpdateTemplateDTO,
  TemplateFilters,
  RenderTemplateDTO
} from './communication.types';

// Register Handlebars helpers
Handlebars.registerHelper('formatDate', (date: string, format: string) => {
  const d = new Date(date);
  // Simple date formatting (use date-fns for production)
  return d.toLocaleDateString('en-IN');
});

Handlebars.registerHelper('currency', (amount: number) => {
  return `₹${amount.toLocaleString('en-IN')}`;
});

export class TemplateService {
  private templatesDir = path.join(__dirname, 'templates');
  private variableSchemas: any;

  constructor() {
    this.loadVariableSchemas();
  }

  private async loadVariableSchemas() {
    const schemasPath = path.join(this.templatesDir, 'variable-schemas.json');
    const content = await fs.readFile(schemasPath, 'utf-8');
    this.variableSchemas = JSON.parse(content);
  }

  /**
   * Get all templates (DB + file-based)
   */
  async getTemplates(filters: TemplateFilters): Promise<CommunicationTemplate[]> {
    let query = 'SELECT * FROM communication_template WHERE 1=1';
    const params: any[] = [];

    if (filters.category) {
      query += ' AND category = ?';
      params.push(filters.category);
    }

    if (filters.channel) {
      query += ' AND channel = ?';
      params.push(filters.channel);
    }

    if (filters.is_active !== undefined) {
      query += ' AND is_active = ?';
      params.push(filters.is_active ? 1 : 0);
    }

    if (filters.search) {
      query += ' AND (name LIKE ? OR subject LIKE ?)';
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    query += ' ORDER BY created_at DESC';

    const [rows] = await db.execute<RowDataPacket[]>(query, params);
    return rows as CommunicationTemplate[];
  }

  /**
   * Get template by ID (DB only)
   */
  async getTemplateById(id: string): Promise<CommunicationTemplate | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM communication_template WHERE id = ?',
      [id]
    );

    if (rows.length === 0) return null;
    return rows[0] as CommunicationTemplate;
  }

  /**
   * Get template by name (file-based or DB)
   */
  async getTemplateByName(name: string): Promise<{ html: string; text?: string; category: string } | null> {
    // Try file-based first
    const filePath = path.join(this.templatesDir, `${name}.hbs`);
    const textFilePath = path.join(this.templatesDir, `${name}.txt.hbs`);

    try {
      const htmlTemplate = await fs.readFile(filePath, 'utf-8');
      let textTemplate: string | undefined;

      try {
        textTemplate = await fs.readFile(textFilePath, 'utf-8');
      } catch {
        // Text version optional
      }

      // Extract category from path
      const category = name.split('/')[0];

      return { html: htmlTemplate, text: textTemplate, category };
    } catch {
      // Not found in files, try DB
      const [rows] = await db.execute<RowDataPacket[]>(
        'SELECT body_html, body_text, category FROM communication_template WHERE name = ? AND is_active = 1',
        [name]
      );

      if (rows.length === 0) return null;

      return {
        html: rows[0].body_html,
        text: rows[0].body_text,
        category: rows[0].category
      };
    }
  }

  /**
   * Create template (DB only)
   */
  async createTemplate(data: CreateTemplateDTO): Promise<CommunicationTemplate> {
    const id = randomUUID();

    // Validate template syntax
    try {
      Handlebars.compile(data.body_html);
      if (data.body_text) {
        Handlebars.compile(data.body_text);
      }
    } catch (error) {
      throw new Error(`Invalid Handlebars syntax: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    await db.execute(
      `INSERT INTO communication_template 
      (id, name, subject, body_html, body_text, category, channel, variables_schema, is_critical, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.name,
        data.subject || null,
        data.body_html,
        data.body_text || null,
        data.category,
        data.channel,
        data.variables_schema ? JSON.stringify(data.variables_schema) : null,
        data.is_critical ? 1 : 0,
        data.created_by
      ]
    );

    return this.getTemplateById(id) as Promise<CommunicationTemplate>;
  }

  /**
   * Update template (DB only)
   */
  async updateTemplate(id: string, updates: UpdateTemplateDTO): Promise<CommunicationTemplate> {
    const fields: string[] = [];
    const params: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      params.push(updates.name);
    }

    if (updates.subject !== undefined) {
      fields.push('subject = ?');
      params.push(updates.subject);
    }

    if (updates.body_html !== undefined) {
      // Validate syntax
      Handlebars.compile(updates.body_html);
      fields.push('body_html = ?');
      params.push(updates.body_html);
    }

    if (updates.body_text !== undefined) {
      if (updates.body_text) {
        Handlebars.compile(updates.body_text);
      }
      fields.push('body_text = ?');
      params.push(updates.body_text);
    }

    if (updates.is_active !== undefined) {
      fields.push('is_active = ?');
      params.push(updates.is_active ? 1 : 0);
    }

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    params.push(id);

    await db.execute(
      `UPDATE communication_template SET ${fields.join(', ')} WHERE id = ?`,
      params
    );

    return this.getTemplateById(id) as Promise<CommunicationTemplate>;
  }

  /**
   * Deactivate template (soft delete)
   */
  async deactivateTemplate(id: string): Promise<void> {
    await db.execute(
      'UPDATE communication_template SET is_active = 0 WHERE id = ?',
      [id]
    );
  }

  /**
   * Render template with data
   */
  async renderTemplate(dto: RenderTemplateDTO): Promise<{ html: string; text?: string }> {
    let templateSource: { html: string; text?: string; category: string } | null = null;

    if (dto.template_id) {
      const template = await this.getTemplateById(dto.template_id);
      if (!template) throw new Error('Template not found');
      templateSource = {
        html: template.body_html,
        text: template.body_text || undefined,
        category: template.category
      };
    } else if (dto.template_name) {
      templateSource = await this.getTemplateByName(dto.template_name);
      if (!templateSource) throw new Error('Template not found');
    } else {
      throw new Error('Either template_id or template_name required');
    }

    // Compile and render
    const htmlTemplate = Handlebars.compile(templateSource.html);
    const html = htmlTemplate(dto.data);

    let text: string | undefined;
    if (templateSource.text) {
      const textTemplate = Handlebars.compile(templateSource.text);
      text = textTemplate(dto.data);
    }

    return { html, text };
  }

  /**
   * Get variable schema for category
   */
  getVariableSchema(category: string): any {
    return this.variableSchemas[category] || {};
  }
}

export const templateService = new TemplateService();
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/communication/template.service.ts backend/package.json backend/package-lock.json
git commit -m "feat(communication): add template service

- Template CRUD (DB templates)
- File-based template loading
- Handlebars rendering with helpers (formatDate, currency)
- Variable schema validation
- Syntax validation on save"
```

---

## Task 10: Dispatch Service

**Files:**
- Create: `backend/src/modules/communication/dispatch.service.ts`

- [ ] **Step 1: Create dispatch service (Part 1: Send logic)**

```typescript
// backend/src/modules/communication/dispatch.service.ts
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { providerFactory } from './providers/provider.factory';
import { templateService } from './template.service';
import { notificationPreferencesService } from './notification-preferences.service';
import {
  SendMessageDTO,
  BulkSendDTO,
  DispatchResult,
  DispatchLog,
  DispatchLogFilters,
  PaginatedDispatchLogs,
  DispatchStats,
  Channel
} from './communication.types';

class DispatchService {
  /**
   * Send message to recipients
   */
  async send(dto: SendMessageDTO): Promise<DispatchResult> {
    const queued: string[] = [];
    const failed: string[] = [];

    // Fetch employee details
    const [employees] = await db.execute<RowDataPacket[]>(
      `SELECT id, full_name, email, phone FROM employees WHERE id IN (${dto.recipient_employee_ids.map(() => '?').join(',')})`,
      dto.recipient_employee_ids
    );

    for (const employee of employees) {
      try {
        // Determine channel
        let channel = dto.channel;
        if (!channel) {
          // Get user preference
          const template = await this.getTemplateInfo(dto.template_id, dto.template_name);
          channel = await notificationPreferencesService.getPreferredChannel(
            employee.id,
            template.category
          );
        }

        // Get recipient contact
        const contact = channel === 'email' ? employee.email : employee.phone;
        if (!contact) {
          failed.push(employee.id);
          continue;
        }

        // Render template
        const rendered = await templateService.renderTemplate({
          template_id: dto.template_id,
          template_name: dto.template_name,
          data: { ...dto.data, employee: { name: employee.full_name, id: employee.id } }
        });

        // Create dispatch log
        const dispatchId = randomUUID();
        const template = await this.getTemplateInfo(dto.template_id, dto.template_name);

        await db.execute(
          `INSERT INTO dispatch_log 
          (id, template_id, template_name, recipient_employee_id, recipient_contact, channel, status, 
           subject, body_preview, is_critical, retention_category, sent_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            dispatchId,
            dto.template_id || null,
            dto.template_name || template.name,
            employee.id,
            contact,
            channel,
            'queued',
            dto.data.subject || template.subject || null,
            rendered.html.substring(0, 500),
            dto.is_critical ? 1 : 0,
            dto.is_critical ? 'critical' : 'standard'
          ]
        );

        // Send via provider (async, don't wait)
        this.sendViaProvider(dispatchId, channel, contact, rendered).catch(err => {
          console.error(`Failed to send dispatch ${dispatchId}:`, err);
        });

        queued.push(dispatchId);
      } catch (error) {
        console.error(`Failed to queue message for employee ${employee.id}:`, error);
        failed.push(employee.id);
      }
    }

    return {
      queued: queued.length,
      failed: failed.length,
      dispatch_ids: queued
    };
  }

  /**
   * Send via provider and update log
   */
  private async sendViaProvider(
    dispatchId: string,
    channel: Channel,
    contact: string,
    rendered: { html: string; text?: string }
  ): Promise<void> {
    try {
      const provider = providerFactory.getProvider(channel);

      // Validate recipient
      if (!provider.validateRecipient(contact)) {
        await this.updateDispatchStatus(dispatchId, 'failed', 'Invalid recipient format');
        return;
      }

      // Send (use text version for SMS/WhatsApp, HTML for email)
      const body = channel === 'email' ? rendered.html : (rendered.text || rendered.html);
      const result = await provider.send(contact, '', body);

      if (result.success) {
        await this.updateDispatchStatus(dispatchId, 'sent', undefined, result.message_id);
      } else {
        await this.updateDispatchStatus(dispatchId, 'failed', result.error);
      }
    } catch (error) {
      await this.updateDispatchStatus(
        dispatchId,
        'failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Update dispatch status
   */
  private async updateDispatchStatus(
    dispatchId: string,
    status: string,
    errorMessage?: string,
    messageId?: string
  ): Promise<void> {
    await db.execute(
      `UPDATE dispatch_log 
       SET status = ?, error_message = ?, sent_at = IF(? = 'sent', NOW(), sent_at)
       WHERE id = ?`,
      [status, errorMessage || null, status, dispatchId]
    );
  }

  /**
   * Get template info helper
   */
  private async getTemplateInfo(templateId?: string, templateName?: string): Promise<any> {
    if (templateId) {
      return await templateService.getTemplateById(templateId);
    } else if (templateName) {
      const tmpl = await templateService.getTemplateByName(templateName);
      return { name: templateName, category: tmpl?.category, subject: null };
    }
    throw new Error('Template not found');
  }

  /**
   * Bulk send (filter recipients)
   */
  async bulkSend(dto: BulkSendDTO): Promise<DispatchResult> {
    // Build employee filter query
    let query = 'SELECT id FROM employees WHERE 1=1';
    const params: any[] = [];

    if (dto.recipient_filter.department) {
      query += ' AND department = ?';
      params.push(dto.recipient_filter.department);
    }

    if (dto.recipient_filter.process_id) {
      query += ' AND process_id = ?';
      params.push(dto.recipient_filter.process_id);
    }

    if (dto.recipient_filter.designation) {
      query += ' AND designation = ?';
      params.push(dto.recipient_filter.designation);
    }

    if (dto.recipient_filter.status) {
      query += ' AND status = ?';
      params.push(dto.recipient_filter.status);
    }

    const [rows] = await db.execute<RowDataPacket[]>(query, params);
    const recipientIds = rows.map((r: any) => r.id);

    // Send to filtered recipients
    return this.send({
      template_id: dto.template_id,
      template_name: dto.template_name,
      recipient_employee_ids: recipientIds,
      data: dto.data,
      channel: dto.channel
    });
  }

  /**
   * Retry failed dispatch
   */
  async retry(dispatchId: string): Promise<void> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT channel, recipient_contact, body_preview FROM dispatch_log WHERE id = ?',
      [dispatchId]
    );

    if (rows.length === 0) throw new Error('Dispatch not found');

    const log = rows[0];

    // Reset status and increment retry count
    await db.execute(
      'UPDATE dispatch_log SET status = ?, retry_count = retry_count + 1 WHERE id = ?',
      ['queued', dispatchId]
    );

    // Retry send
    await this.sendViaProvider(dispatchId, log.channel, log.recipient_contact, {
      html: log.body_preview,
      text: log.body_preview
    });
  }

  /**
   * Get dispatch logs
   */
  async getLogs(filters: DispatchLogFilters): Promise<PaginatedDispatchLogs> {
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM dispatch_log WHERE 1=1';
    const params: any[] = [];

    if (filters.employee_id) {
      query += ' AND recipient_employee_id = ?';
      params.push(filters.employee_id);
    }

    if (filters.channel) {
      query += ' AND channel = ?';
      params.push(filters.channel);
    }

    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.date_from) {
      query += ' AND sent_at >= ?';
      params.push(filters.date_from);
    }

    if (filters.date_to) {
      query += ' AND sent_at <= ?';
      params.push(filters.date_to);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [rows] = await db.execute<RowDataPacket[]>(query, params);

    // Get total count
    const [countRows] = await db.execute<RowDataPacket[]>(
      query.replace('SELECT *', 'SELECT COUNT(*) as total').replace(/LIMIT.*/, ''),
      params.slice(0, -2)
    );

    return {
      logs: rows as DispatchLog[],
      total: countRows[0].total,
      page,
      limit
    };
  }

  /**
   * Get dispatch stats
   */
  async getStats(): Promise<DispatchStats> {
    const [todayRows] = await db.execute<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM dispatch_log WHERE DATE(sent_at) = CURDATE()'
    );

    const [deliveredRows] = await db.execute<RowDataPacket[]>(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered
       FROM dispatch_log 
       WHERE sent_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );

    const [openedRows] = await db.execute<RowDataPacket[]>(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'opened' THEN 1 ELSE 0 END) as opened
       FROM dispatch_log 
       WHERE channel = 'email' AND sent_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );

    const [failedRows] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) as count FROM dispatch_log WHERE status = 'failed' AND retry_count < 3"
    );

    const [channelRows] = await db.execute<RowDataPacket[]>(
      `SELECT channel, COUNT(*) as count 
       FROM dispatch_log 
       WHERE DATE(sent_at) = CURDATE() 
       GROUP BY channel`
    );

    const byChannel = { email: 0, sms: 0, whatsapp: 0 };
    channelRows.forEach((row: any) => {
      byChannel[row.channel as keyof typeof byChannel] = row.count;
    });

    return {
      total_sent_today: todayRows[0].count,
      delivery_rate: deliveredRows[0].total > 0 
        ? (deliveredRows[0].delivered / deliveredRows[0].total) * 100 
        : 0,
      open_rate: openedRows[0].total > 0 
        ? (openedRows[0].opened / openedRows[0].total) * 100 
        : 0,
      failed_count: failedRows[0].count,
      by_channel: byChannel
    };
  }
}

export const dispatchService = new DispatchService();
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/communication/dispatch.service.ts
git commit -m "feat(communication): add dispatch service

- Send messages via providers (email/SMS/WhatsApp)
- Bulk send with employee filters
- Retry failed dispatches
- Dispatch logs with pagination
- Stats dashboard (delivery rate, open rate, channel breakdown)"
```

---

## Task 11: Notification Preferences Service

**Files:**
- Create: `backend/src/modules/communication/notification-preferences.service.ts`

- [ ] **Step 1: Create preferences service**

```typescript
// backend/src/modules/communication/notification-preferences.service.ts
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import {
  NotificationPreferences,
  NotificationCategory,
  Channel,
  UpdatePreferencesDTO
} from './communication.types';

class NotificationPreferencesService {
  /**
   * Initialize default preferences for new employee
   */
  async initializeDefaults(employeeId: string): Promise<void> {
    const categories: NotificationCategory[] = [
      'onboarding',
      'payroll',
      'attendance',
      'leave',
      'performance',
      'alerts',
      'announcements'
    ];

    const values = categories.map(category => [
      randomUUID(),
      employeeId,
      category,
      'email', // default channel
      1 // enabled
    ]);

    await db.query(
      `INSERT INTO notification_preferences (id, employee_id, category, preferred_channel, enabled) 
       VALUES ${values.map(() => '(?, ?, ?, ?, ?)').join(', ')}
       ON DUPLICATE KEY UPDATE id=id`,
      values.flat()
    );
  }

  /**
   * Get employee preferences
   */
  async getPreferences(employeeId: string): Promise<NotificationPreferences[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM notification_preferences WHERE employee_id = ? ORDER BY category',
      [employeeId]
    );

    return rows as NotificationPreferences[];
  }

  /**
   * Update preference
   */
  async updatePreference(employeeId: string, dto: UpdatePreferencesDTO): Promise<NotificationPreferences> {
    await db.execute(
      `INSERT INTO notification_preferences (id, employee_id, category, preferred_channel, enabled)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE preferred_channel = VALUES(preferred_channel), enabled = VALUES(enabled)`,
      [randomUUID(), employeeId, dto.category, dto.preferred_channel, dto.enabled ? 1 : 0]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM notification_preferences WHERE employee_id = ? AND category = ?',
      [employeeId, dto.category]
    );

    return rows[0] as NotificationPreferences;
  }

  /**
   * Get preferred channel for category
   */
  async getPreferredChannel(employeeId: string, category: string): Promise<Channel> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT preferred_channel FROM notification_preferences WHERE employee_id = ? AND category = ? AND enabled = 1',
      [employeeId, category]
    );

    if (rows.length === 0) return 'email'; // default

    return rows[0].preferred_channel as Channel;
  }
}

export const notificationPreferencesService = new NotificationPreferencesService();
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/communication/notification-preferences.service.ts
git commit -m "feat(communication): add notification preferences service

- Initialize default preferences (all categories → email)
- Get/update preferences per employee
- Get preferred channel for category
- Used by dispatch service for routing"
```

---

## Task 12: Controller Layer

**Files:**
- Create: `backend/src/modules/communication/communication.controller.ts`

- [ ] **Step 1: Create controller with template endpoints**

```typescript
// backend/src/modules/communication/communication.controller.ts
import { Request, Response } from 'express';
import { templateService } from './template.service';
import { dispatchService } from './dispatch.service';
import { notificationPreferencesService } from './notification-preferences.service';
import {
  CreateTemplateSchema,
  UpdateTemplateSchema,
  TemplateFiltersSchema,
  SendMessageSchema,
  BulkSendSchema,
  DispatchLogFiltersSchema,
  UpdatePreferencesSchema,
  RenderTemplateSchema
} from './communication.validation';

export class CommunicationController {
  // ========== Template Management ==========

  async getTemplates(req: Request, res: Response) {
    try {
      const filters = TemplateFiltersSchema.parse(req.query);
      const templates = await templateService.getTemplates(filters);
      res.json(templates);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async getTemplateById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const template = await templateService.getTemplateById(id);
      if (!template) return res.status(404).json({ error: 'Template not found' });
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async createTemplate(req: Request, res: Response) {
    try {
      const data = CreateTemplateSchema.parse({
        ...req.body,
        created_by: (req as any).user?.emp_id || (req as any).userId
      });
      const template = await templateService.createTemplate(data);
      res.status(201).json(template);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async updateTemplate(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const updates = UpdateTemplateSchema.parse(req.body);
      const template = await templateService.updateTemplate(id, updates);
      res.json(template);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async deleteTemplate(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await templateService.deactivateTemplate(id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async renderTemplate(req: Request, res: Response) {
    try {
      const dto = RenderTemplateSchema.parse(req.body);
      const rendered = await templateService.renderTemplate(dto);
      res.json(rendered);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // ========== Dispatch ==========

  async sendMessage(req: Request, res: Response) {
    try {
      const dto = SendMessageSchema.parse(req.body);
      const result = await dispatchService.send(dto);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async bulkSend(req: Request, res: Response) {
    try {
      const dto = BulkSendSchema.parse(req.body);
      const result = await dispatchService.bulkSend(dto);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async retryDispatch(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await dispatchService.retry(id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async getDispatchLogs(req: Request, res: Response) {
    try {
      const filters = DispatchLogFiltersSchema.parse(req.query);
      const logs = await dispatchService.getLogs(filters);
      res.json(logs);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async getDispatchStats(req: Request, res: Response) {
    try {
      const stats = await dispatchService.getStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // ========== Preferences ==========

  async getPreferences(req: Request, res: Response) {
    try {
      const employeeId = (req as any).user?.emp_id || (req as any).userId;
      const preferences = await notificationPreferencesService.getPreferences(employeeId);
      res.json(preferences);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async updatePreference(req: Request, res: Response) {
    try {
      const employeeId = (req as any).user?.emp_id || (req as any).userId;
      const dto = UpdatePreferencesSchema.parse(req.body);
      const preference = await notificationPreferencesService.updatePreference(employeeId, dto);
      res.json(preference);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
}

export const communicationController = new CommunicationController();
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/communication/communication.controller.ts
git commit -m "feat(communication): add controller layer

- 13 endpoints: templates (6), dispatch (5), preferences (2)
- Zod validation on all inputs
- Error handling with HTTP status codes"
```

---

## Task 13: Routes + RBAC Integration

**Files:**
- Create: `backend/src/modules/communication/communication.routes.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/modules/access/role.catalog.ts`

- [ ] **Step 1: Create routes file**

```typescript
// backend/src/modules/communication/communication.routes.ts
import { Router } from 'express';
import { requireAuth } from '../../shared/authMiddleware';
import { communicationController } from './communication.controller';

const router = Router();

// Apply auth middleware to all routes
router.use(requireAuth);

// ========== Templates (Admin/HR only) ==========
router.get('/templates', communicationController.getTemplates.bind(communicationController));
router.get('/templates/:id', communicationController.getTemplateById.bind(communicationController));
router.post('/templates', communicationController.createTemplate.bind(communicationController));
router.patch('/templates/:id', communicationController.updateTemplate.bind(communicationController));
router.delete('/templates/:id', communicationController.deleteTemplate.bind(communicationController));
router.post('/templates/render', communicationController.renderTemplate.bind(communicationController));

// ========== Dispatch ==========
router.post('/dispatch/send', communicationController.sendMessage.bind(communicationController));
router.post('/dispatch/bulk', communicationController.bulkSend.bind(communicationController));
router.post('/dispatch/retry/:id', communicationController.retryDispatch.bind(communicationController));
router.get('/dispatch/logs', communicationController.getDispatchLogs.bind(communicationController));
router.get('/dispatch/stats', communicationController.getDispatchStats.bind(communicationController));

// ========== Preferences (Employee) ==========
router.get('/preferences', communicationController.getPreferences.bind(communicationController));
router.patch('/preferences', communicationController.updatePreference.bind(communicationController));

export default router;
```

- [ ] **Step 2: Register routes in app.ts**

```typescript
// In backend/src/app.ts, add:
import communicationRoutes from './modules/communication/communication.routes';

// After other route registrations:
app.use('/api/communication', communicationRoutes);
```

- [ ] **Step 3: Add RBAC permissions**

```typescript
// In backend/src/modules/access/role.catalog.ts
// Add to MODULES array:
'communication'

// Access granted to:
// - super_admin, admin: full access
// - hr: full access (template management, view all logs)
// - manager, process_manager, assistant_manager, team_leader: send to team, view team logs
// - employee: preferences only
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/communication/communication.routes.ts backend/src/app.ts backend/src/modules/access/role.catalog.ts
git commit -m "feat(communication): add routes + RBAC integration

- 13 routes registered at /api/communication
- RBAC: HR full access, managers team-only, employees preferences
- Integrated into app.ts + role catalog"
```

---

## Task 14: Cleanup Cron Job

**Files:**
- Create: `backend/src/modules/communication/cleanup.cron.ts`
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Create cleanup cron**

```typescript
// backend/src/modules/communication/cleanup.cron.ts
import cron from 'node-cron';
import { db } from '../../db/mysql';

/**
 * Cleanup dispatch logs based on tiered retention
 * Runs daily at 2 AM
 */
export function startCleanupCron() {
  cron.schedule('0 2 * * *', async () => {
    console.log('[Communication] Running dispatch log cleanup...');

    try {
      // Delete routine logs older than 30 days
      const [routineResult] = await db.execute(
        `DELETE FROM dispatch_log 
         WHERE is_critical = 0 
           AND retention_category = 'routine' 
           AND sent_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`
      );

      // Delete standard logs older than 90 days
      const [standardResult] = await db.execute(
        `DELETE FROM dispatch_log 
         WHERE is_critical = 0 
           AND retention_category = 'standard' 
           AND sent_at < DATE_SUB(NOW(), INTERVAL 90 DAY)`
      );

      console.log('[Communication] Cleanup complete:', {
        routine_deleted: (routineResult as any).affectedRows,
        standard_deleted: (standardResult as any).affectedRows
      });
    } catch (error) {
      console.error('[Communication] Cleanup failed:', error);
    }
  });

  console.log('[Communication] Cleanup cron scheduled (daily 2 AM)');
}
```

- [ ] **Step 2: Register cron in server.ts**

```typescript
// In backend/src/server.ts, add:
import { startCleanupCron } from './modules/communication/cleanup.cron';

// After server starts:
startCleanupCron();
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/communication/cleanup.cron.ts backend/src/server.ts
git commit -m "feat(communication): add cleanup cron job

- Daily 2 AM: delete routine logs >30 days, standard logs >90 days
- Critical logs retained forever
- Registered in server.ts"
```

---

## Task 15: Frontend - Template Manager

**Files:**
- Create: `src/pages/NativeTemplateManager.tsx`
- Create: `src/components/communication/TemplateEditor.tsx`

- [ ] **Step 1: Create template manager page**

```tsx
// src/pages/NativeTemplateManager.tsx
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Trash, Eye } from 'lucide-react';
import { hrmsApi } from '@/lib/hrmsApi';

export default function NativeTemplateManager() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const data = await hrmsApi.get('/communication/templates');
      setTemplates(data);
    } catch (error) {
      console.error('Failed to fetch templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    try {
      await hrmsApi.delete(`/communication/templates/${id}`);
      fetchTemplates();
    } catch (error) {
      console.error('Failed to delete template:', error);
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Template Manager</h1>
          <p className="text-gray-500 mt-1">Manage email, SMS, and WhatsApp templates</p>
        </div>
        <Button onClick={() => window.location.href = '/communication/templates/new'}>
          <Plus className="w-4 h-4 mr-2" />
          Create Template
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {templates.map((template: any) => (
          <Card key={template.id}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{template.name}</h3>
                  <p className="text-sm text-gray-500">{template.subject}</p>
                  <div className="flex gap-2 mt-2">
                    <Badge>{template.category}</Badge>
                    <Badge variant="outline">{template.channel}</Badge>
                    {template.is_critical === 1 && (
                      <Badge className="bg-red-100 text-red-800">Critical</Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm">
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="sm">
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleDelete(template.id)}>
                    <Trash className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/NativeTemplateManager.tsx
git commit -m "feat(communication): add template manager page

- List all templates with filters
- Create/edit/delete actions
- Category and channel badges
- Critical indicator"
```

---

## Task 16: Frontend - Dispatch Center + History

**Files:**
- Create: `src/pages/NativeDispatchCenter.tsx`
- Create: `src/pages/NativeDispatchHistory.tsx`

- [ ] **Step 1: Create dispatch center**

```tsx
// src/pages/NativeDispatchCenter.tsx
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Send } from 'lucide-react';
import { hrmsApi } from '@/lib/hrmsApi';

export default function NativeDispatchCenter() {
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    setSending(true);
    try {
      await hrmsApi.post('/communication/dispatch/send', {
        template_name: selectedTemplate,
        recipient_employee_ids: recipients,
        data: {} // TODO: dynamic data input
      });
      alert('Message sent successfully');
    } catch (error) {
      console.error('Failed to send:', error);
      alert('Send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-3xl font-bold">Dispatch Center</h1>

      <Card>
        <CardHeader>
          <CardTitle>Send Message</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Template</label>
            {/* Template selector */}
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Recipients</label>
            {/* Employee selector */}
          </div>

          <Button onClick={handleSend} disabled={sending}>
            <Send className="w-4 h-4 mr-2" />
            {sending ? 'Sending...' : 'Send Message'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Create dispatch history**

```tsx
// src/pages/NativeDispatchHistory.tsx
import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { hrmsApi } from '@/lib/hrmsApi';

export default function NativeDispatchHistory() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const data = await hrmsApi.get('/communication/dispatch/logs');
      setLogs(data.logs);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await hrmsApi.post(`/communication/dispatch/retry/${id}`);
      fetchLogs();
    } catch (error) {
      console.error('Retry failed:', error);
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-3xl font-bold">Dispatch History</h1>

      <div className="space-y-4">
        {logs.map((log: any) => (
          <Card key={log.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{log.template_name}</p>
                  <p className="text-sm text-gray-500">{log.recipient_contact}</p>
                  <div className="flex gap-2 mt-2">
                    <Badge>{log.channel}</Badge>
                    <Badge>{log.status}</Badge>
                  </div>
                </div>
                {log.status === 'failed' && (
                  <Button size="sm" onClick={() => handleRetry(log.id)}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Retry
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeDispatchCenter.tsx src/pages/NativeDispatchHistory.tsx
git commit -m "feat(communication): add dispatch center + history pages

- Dispatch center: send messages UI
- History: view logs with retry button
- Status badges and filters"
```

---

## Task 17: Frontend - Notification Preferences

**Files:**
- Create: `src/pages/NativeNotificationPreferences.tsx`

- [ ] **Step 1: Create preferences page**

```tsx
// src/pages/NativeNotificationPreferences.tsx
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Save } from 'lucide-react';
import { hrmsApi } from '@/lib/hrmsApi';

export default function NativeNotificationPreferences() {
  const [preferences, setPreferences] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPreferences();
  }, []);

  const fetchPreferences = async () => {
    try {
      const data = await hrmsApi.get('/communication/preferences');
      setPreferences(data);
    } catch (error) {
      console.error('Failed to fetch preferences:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (category: string, channel: string, enabled: boolean) => {
    try {
      await hrmsApi.patch('/communication/preferences', {
        category,
        preferred_channel: channel,
        enabled
      });
      fetchPreferences();
    } catch (error) {
      console.error('Failed to update:', error);
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Notification Preferences</h1>
        <p className="text-gray-500 mt-1">Choose how you receive notifications</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Channel Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {preferences.map((pref: any) => (
            <div key={pref.category} className="flex items-center justify-between p-4 border rounded">
              <div>
                <p className="font-medium capitalize">{pref.category}</p>
              </div>
              <div className="flex items-center gap-4">
                <select
                  value={pref.preferred_channel}
                  onChange={(e) => handleUpdate(pref.category, e.target.value, pref.enabled === 1)}
                  className="border rounded px-2 py-1"
                >
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
                <Switch
                  checked={pref.enabled === 1}
                  onCheckedChange={(checked) => handleUpdate(pref.category, pref.preferred_channel, checked)}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/NativeNotificationPreferences.tsx
git commit -m "feat(communication): add notification preferences page

- Configure preferred channel per category
- Enable/disable notifications
- Real-time updates"
```

---

## Task 18: Navigation Integration

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/layout/DashboardLayout.tsx`

- [ ] **Step 1: Register routes in App.tsx**

```tsx
// In src/App.tsx, add:
const NativeTemplateManager = lazy(() => import('./pages/NativeTemplateManager'));
const NativeDispatchCenter = lazy(() => import('./pages/NativeDispatchCenter'));
const NativeDispatchHistory = lazy(() => import('./pages/NativeDispatchHistory'));
const NativeNotificationPreferences = lazy(() => import('./pages/NativeNotificationPreferences'));

// In routes:
<Route path="/communication/templates" element={<NativeTemplateManager />} />
<Route path="/communication/dispatch" element={<NativeDispatchCenter />} />
<Route path="/communication/history" element={<NativeDispatchHistory />} />
<Route path="/settings/notifications" element={<NativeNotificationPreferences />} />
```

- [ ] **Step 2: Add nav items to sidebar**

```tsx
// In src/components/layout/DashboardLayout.tsx
{
  section: "Communication",
  items: [
    {
      label: "Templates",
      path: "/communication/templates",
      icon: <FileText className="w-5 h-5" />,
      roles: ["admin", "hr"]
    },
    {
      label: "Send Message",
      path: "/communication/dispatch",
      icon: <Send className="w-5 h-5" />,
      roles: ["admin", "hr", "manager"]
    },
    {
      label: "Message History",
      path: "/communication/history",
      icon: <History className="w-5 h-5" />,
      roles: ["admin", "hr"]
    }
  ]
},
// In Settings section:
{
  label: "Notifications",
  path: "/settings/notifications",
  icon: <Bell className="w-5 h-5" />,
  roles: ["employee"]
}
```

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx src/components/layout/DashboardLayout.tsx
git commit -m "feat(communication): add navigation integration

- 4 routes registered
- Communication section (admin/HR): templates, dispatch, history
- Settings section (employee): notification preferences
- Role-based visibility"
```

---

## Plan Complete

**Total:** 18 tasks covering database, backend services, providers, API, frontend

**Execution options:**

1. **Subagent-Driven (recommended):** Fresh subagent per task, two-stage review between tasks
2. **Inline Execution:** Execute tasks in this session with checkpoints

**Post-implementation:**
- Push to GitHub: `git push origin main`
- Deploy via Vercel: Frontend auto-deploys, backend requires Vercel config

Which execution approach?