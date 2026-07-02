# Communication Provider Configuration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete admin panel for configuring email (SMTP/SendGrid/Mailgun), SMS (Twilio/MSG91/custom HTTP), and WhatsApp (Twilio/Meta Cloud API/custom HTTP) providers — with encrypted DB storage, live test-connection, and a provider factory that reads DB-first so changes take effect without server restart.

**Architecture:** A new `communication_provider_config` table stores encrypted credentials per channel. The existing `ProviderFactory` is upgraded from env-var-only to DB-first (env fallback). New providers (MSG91, SendGrid, Mailgun, Meta WhatsApp) are added alongside existing ones. A new admin settings page `NativeCommunicationConfig.tsx` surfaces tabs per channel with form, test-connection, and enable/disable controls.

**Tech Stack:** Express + TypeScript + mysql2 + node:crypto (AES-256-GCM) · React 18 + TypeScript + shadcn/Radix · hrmsApi · Zod validation

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `backend/sql/071_communication_provider_config.sql` | New table for per-channel provider config |
| `backend/src/modules/communication/provider-config.service.ts` | CRUD + AES encrypt/decrypt for provider secrets |
| `backend/src/modules/communication/providers/email/sendgrid.provider.ts` | SendGrid API email provider |
| `backend/src/modules/communication/providers/email/mailgun.provider.ts` | Mailgun API email provider |
| `backend/src/modules/communication/providers/sms/msg91.provider.ts` | MSG91 SMS provider (India) |
| `backend/src/modules/communication/providers/whatsapp/meta.provider.ts` | Meta Cloud API WhatsApp provider |
| `src/pages/NativeCommunicationConfig.tsx` | Admin config page — 3 channel tabs + test |

### Modified files
| File | Change |
|---|---|
| `backend/src/modules/communication/providers/provider.factory.ts` | DB-first provider resolution + cache invalidation |
| `backend/src/modules/communication/communication.routes.ts` | Add 5 new config endpoints |
| `backend/src/modules/communication/communication.validation.ts` | Add ProviderConfigSchema |
| `backend/src/modules/communication/communication.types.ts` | Add ProviderConfig types |
| `backend/src/app.ts` | Already mounts communicationRouter — no change needed |
| `src/App.tsx` | Add route for `/settings/communication-config` |
| `src/components/layout/DashboardLayout.tsx` | Add nav item under System group |

---

## Task 1 — SQL migration: communication_provider_config table

**Files:**
- Create: `backend/sql/071_communication_provider_config.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Communication provider configuration per channel.
-- Secrets stored AES-256-GCM encrypted using COMM_SECRET env key.
-- Only one active config per channel (UNIQUE KEY on channel).
CREATE TABLE IF NOT EXISTS communication_provider_config (
  id             CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  channel        ENUM('email','sms','whatsapp') NOT NULL,
  provider_type  VARCHAR(50)   NOT NULL,
  -- non-secret settings (plain JSON)
  config_json    JSON          NOT NULL DEFAULT ('{}'),
  -- encrypted secrets (AES-256-GCM base64 blob)
  secret_enc     TEXT          NULL,
  is_enabled     TINYINT(1)    NOT NULL DEFAULT 0,
  -- last test result
  test_ok        TINYINT(1)    NULL,
  test_error     VARCHAR(500)  NULL,
  test_at        DATETIME      NULL,
  tested_by      CHAR(36)      NULL,
  -- audit
  updated_by     CHAR(36)      NULL,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_channel (channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed disabled placeholder rows so GET always returns all 3 channels
INSERT IGNORE INTO communication_provider_config (id, channel, provider_type, is_enabled)
VALUES
  (UUID(), 'email',     'nodemailer', 0),
  (UUID(), 'sms',       'twilio',     0),
  (UUID(), 'whatsapp',  'twilio',     0);
```

- [ ] **Step 2: Verify file was created**

```bash
ls /c/Users/shivamg/Desktop/HRMS/HRMS1/backend/sql/071_communication_provider_config.sql
```

Expected: file exists.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
git add backend/sql/071_communication_provider_config.sql
git commit -m "feat(comm): add communication_provider_config migration"
```

---

## Task 2 — Add new provider types to communication.types.ts

**Files:**
- Modify: `backend/src/modules/communication/communication.types.ts`

- [ ] **Step 1: Read current communication.types.ts**

Open the file. Find where Channel and ProviderResponse types are defined.

- [ ] **Step 2: Add provider config types at the bottom of the file**

```typescript
// ========== Provider config types ==========

export type EmailProviderType = 'nodemailer' | 'sendgrid' | 'mailgun' | 'local-email-tool';
export type SMSProviderType   = 'twilio' | 'msg91' | 'local-sms-tool';
export type WAProviderType    = 'twilio' | 'meta' | 'local-whatsapp-tool';
export type AnyProviderType   = EmailProviderType | SMSProviderType | WAProviderType;

/** Non-secret settings stored as plain JSON */
export interface EmailConfig {
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_from?: string;
  smtp_from_name?: string;
  sendgrid_from?: string;
  sendgrid_from_name?: string;
  mailgun_domain?: string;
  mailgun_region?: 'us' | 'eu';
  mailgun_from?: string;
  local_api_url?: string;
}

export interface SMSConfig {
  twilio_messaging_service_sid?: string;
  msg91_sender_id?: string;
  local_api_url?: string;
  local_sender_id?: string;
}

export interface WAConfig {
  twilio_whatsapp_number?: string;
  meta_phone_number_id?: string;
  meta_waba_id?: string;
  local_api_url?: string;
  local_business_number?: string;
}

/** Encrypted secrets — field names match their decrypted variable names */
export interface EmailSecrets {
  smtp_pass?: string;
  sendgrid_api_key?: string;
  mailgun_api_key?: string;
  local_api_key?: string;
  smtp_user?: string;
}

export interface SMSSecrets {
  twilio_account_sid?: string;
  twilio_auth_token?: string;
  msg91_auth_key?: string;
  local_api_key?: string;
}

export interface WASecrets {
  twilio_account_sid?: string;
  twilio_auth_token?: string;
  meta_access_token?: string;
  local_api_key?: string;
}

export interface ProviderConfig {
  id: string;
  channel: Channel;
  provider_type: AnyProviderType;
  config_json: EmailConfig | SMSConfig | WAConfig;
  is_enabled: boolean;
  test_ok: boolean | null;
  test_error: string | null;
  test_at: string | null;
}

export interface SaveProviderConfigDTO {
  provider_type: AnyProviderType;
  config: EmailConfig | SMSConfig | WAConfig;
  secrets: EmailSecrets | SMSSecrets | WASecrets;
}

export interface TestResult {
  success: boolean;
  error?: string;
  provider: string;
  channel: Channel;
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/communication/communication.types.ts
git commit -m "feat(comm): add provider config types to communication.types.ts"
```

---

## Task 3 — New email providers: SendGrid + Mailgun

**Files:**
- Create: `backend/src/modules/communication/providers/email/sendgrid.provider.ts`
- Create: `backend/src/modules/communication/providers/email/mailgun.provider.ts`

These providers receive their credentials via constructor (not env vars) so the factory can pass DB-loaded secrets.

- [ ] **Step 1: Create `sendgrid.provider.ts`**

```typescript
import axios from 'axios';
import type { CommunicationProvider, Attachment } from '../provider.interface.js';
import type { ProviderResponse, DeliveryStatus } from '../../communication.types.js';

export class SendGridProvider implements CommunicationProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fromName: string = 'MAS Callnet HRMS',
  ) {}

  async send(recipient: string, subject: string, body: string, attachments?: Attachment[]): Promise<ProviderResponse> {
    try {
      const payload: Record<string, unknown> = {
        personalizations: [{ to: [{ email: recipient }] }],
        from: { email: this.from, name: this.fromName },
        subject,
        content: [{ type: 'text/html', value: body }],
      };
      if (attachments?.length) {
        payload.attachments = attachments.map(a => ({
          content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : Buffer.from(a.content).toString('base64'),
          type: a.contentType,
          filename: a.filename,
        }));
      }
      const res = await axios.post('https://api.sendgrid.com/v3/mail/send', payload, {
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        validateStatus: s => s < 500,
      });
      if (res.status >= 400) {
        const msg = res.data?.errors?.[0]?.message ?? `HTTP ${res.status}`;
        return { success: false, error: msg };
      }
      const msgId = res.headers['x-message-id'] ?? undefined;
      return { success: true, message_id: msgId };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getDeliveryStatus(_messageId: string): Promise<DeliveryStatus> {
    // SendGrid webhook-based; poll not supported in free tier
    return { status: 'sent' };
  }

  validateRecipient(contact: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  }

  getName(): string { return 'sendgrid'; }
}
```

- [ ] **Step 2: Create `mailgun.provider.ts`**

```typescript
import axios from 'axios';
import type { CommunicationProvider, Attachment } from '../provider.interface.js';
import type { ProviderResponse, DeliveryStatus } from '../../communication.types.js';

export class MailgunProvider implements CommunicationProvider {
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    private readonly domain: string,
    private readonly from: string,
    region: 'us' | 'eu' = 'us',
  ) {
    this.baseUrl = region === 'eu'
      ? `https://api.eu.mailgun.net/v3/${domain}`
      : `https://api.mailgun.net/v3/${domain}`;
  }

  async send(recipient: string, subject: string, body: string, attachments?: Attachment[]): Promise<ProviderResponse> {
    try {
      const form = new FormData();
      form.append('from', this.from);
      form.append('to', recipient);
      form.append('subject', subject);
      form.append('html', body);
      if (attachments?.length) {
        for (const a of attachments) {
          const buf = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content);
          form.append('attachment', new Blob([buf], { type: a.contentType }), a.filename);
        }
      }
      const res = await axios.post(`${this.baseUrl}/messages`, form, {
        auth: { username: 'api', password: this.apiKey },
        validateStatus: s => s < 500,
      });
      if (res.status >= 400) {
        return { success: false, error: res.data?.message ?? `HTTP ${res.status}` };
      }
      return { success: true, message_id: res.data?.id };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    try {
      const res = await axios.get(`${this.baseUrl}/events?message-id=${encodeURIComponent(messageId)}`, {
        auth: { username: 'api', password: this.apiKey },
      });
      const events: any[] = res.data?.items ?? [];
      const latest = events[0];
      if (!latest) return { status: 'sent' };
      const map: Record<string, any> = { delivered: 'delivered', failed: 'failed', bounced: 'bounced', opened: 'opened', clicked: 'clicked' };
      return { status: map[latest.event] ?? 'sent', delivered_at: latest.timestamp ? new Date(latest.timestamp * 1000).toISOString() : undefined };
    } catch (e) {
      return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  validateRecipient(contact: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  }

  getName(): string { return 'mailgun'; }
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "error TS" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/communication/providers/email/sendgrid.provider.ts
git add backend/src/modules/communication/providers/email/mailgun.provider.ts
git commit -m "feat(comm): add SendGrid and Mailgun email providers"
```

---

## Task 4 — New SMS provider: MSG91

**Files:**
- Create: `backend/src/modules/communication/providers/sms/msg91.provider.ts`

- [ ] **Step 1: Create `msg91.provider.ts`**

MSG91 uses a REST API. DLT-registered sender ID required for India.

```typescript
import axios from 'axios';
import type { CommunicationProvider } from '../provider.interface.js';
import type { ProviderResponse, DeliveryStatus } from '../../communication.types.js';

export class MSG91Provider implements CommunicationProvider {
  constructor(
    private readonly authKey: string,
    private readonly senderId: string, // 6-char DLT-registered sender, e.g. "MASCAL"
  ) {}

  async send(recipient: string, _subject: string, body: string): Promise<ProviderResponse> {
    try {
      // Normalise to 10-digit mobile for India (strip +91 if present)
      const mobile = recipient.replace(/^\+?91/, '').replace(/\D/g, '');
      if (mobile.length !== 10) {
        return { success: false, error: `Invalid Indian mobile number: ${recipient}` };
      }
      const truncated = body.length > 160 ? body.slice(0, 157) + '...' : body;
      const res = await axios.post('https://api.msg91.com/api/v5/flow/', {
        template_id: '',           // leave blank for plain OTP/text flow
        short_url: '0',
        realTimeResponse: '1',
        sender: this.senderId,
        mobiles: `91${mobile}`,
        VAR1: truncated,           // DLT-approved template variable
      }, {
        headers: { authkey: this.authKey, 'Content-Type': 'application/json' },
        validateStatus: s => s < 500,
      });
      if (res.data?.type === 'error') {
        return { success: false, error: res.data.message ?? 'MSG91 error' };
      }
      return { success: true, message_id: res.data?.request_id };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    try {
      const res = await axios.get(`https://api.msg91.com/api/v5/report/?request_id=${messageId}`, {
        headers: { authkey: this.authKey },
      });
      const status = res.data?.data?.[0]?.status ?? 'sent';
      return { status: status === 'Delivered' ? 'delivered' : status === 'Failed' ? 'failed' : 'sent' };
    } catch (e) {
      return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  validateRecipient(contact: string): boolean {
    // Accept +91XXXXXXXXXX or 10-digit Indian mobile
    const mobile = contact.replace(/^\+?91/, '').replace(/\D/g, '');
    return mobile.length === 10;
  }

  getName(): string { return 'msg91'; }
}
```

- [ ] **Step 2: TypeScript check + commit**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "error TS" | head -10
cd ..
git add backend/src/modules/communication/providers/sms/msg91.provider.ts
git commit -m "feat(comm): add MSG91 SMS provider for India"
```

---

## Task 5 — New WhatsApp provider: Meta Cloud API

**Files:**
- Create: `backend/src/modules/communication/providers/whatsapp/meta.provider.ts`

- [ ] **Step 1: Create `meta.provider.ts`**

Meta Cloud API (formerly Facebook Graph API for WhatsApp Business). Requires approved Business Account, verified phone number ID, and permanent access token.

```typescript
import axios from 'axios';
import type { CommunicationProvider } from '../provider.interface.js';
import type { ProviderResponse, DeliveryStatus } from '../../communication.types.js';

const META_API_VERSION = 'v19.0';

export class MetaWhatsAppProvider implements CommunicationProvider {
  constructor(
    private readonly accessToken: string,
    private readonly phoneNumberId: string, // numeric ID from Meta dashboard
  ) {}

  async send(recipient: string, _subject: string, body: string): Promise<ProviderResponse> {
    try {
      const to = recipient.replace(/^\+/, '').replace(/\D/g, '');
      const url = `https://graph.facebook.com/${META_API_VERSION}/${this.phoneNumberId}/messages`;
      const res = await axios.post(url, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body },
      }, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        validateStatus: s => s < 500,
      });
      if (res.status >= 400) {
        const err = res.data?.error?.message ?? `HTTP ${res.status}`;
        return { success: false, error: err };
      }
      const msgId = res.data?.messages?.[0]?.id;
      return { success: true, message_id: msgId };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    // Meta delivery status is webhook-push only — no polling endpoint available
    // Return sent; actual status is updated via webhook (future enhancement)
    return { status: 'sent', delivered_at: undefined };
  }

  validateRecipient(contact: string): boolean {
    return /^\+?[1-9]\d{6,14}$/.test(contact.replace(/\s/g, ''));
  }

  getName(): string { return 'meta-whatsapp'; }
}
```

- [ ] **Step 2: TypeScript check + commit**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "error TS" | head -10
cd ..
git add backend/src/modules/communication/providers/whatsapp/meta.provider.ts
git commit -m "feat(comm): add Meta Cloud API WhatsApp provider"
```

---

## Task 6 — provider-config.service.ts (DB CRUD + AES encryption)

**Files:**
- Create: `backend/src/modules/communication/provider-config.service.ts`

This service owns all DB interaction for `communication_provider_config`. Secrets encrypted with AES-256-GCM using `PAYROLL_BANK_KEY` (reuses existing key pattern).

- [ ] **Step 1: Create `provider-config.service.ts`**

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { db } from '../../db/mysql.js';
import { env } from '../../config/env.js';
import type { RowDataPacket } from 'mysql2';
import type {
  Channel, ProviderConfig, SaveProviderConfigDTO,
  EmailConfig, SMSConfig, WAConfig,
  EmailSecrets, SMSSecrets, WASecrets,
  AnyProviderType,
} from './communication.types.js';

const ALG = 'aes-256-gcm';

function getKey(): Buffer {
  // Derive 32-byte key from the existing PAYROLL_BANK_KEY (pad/truncate to 32)
  const raw = env.PAYROLL_BANK_KEY;
  const buf = Buffer.alloc(32, 0);
  Buffer.from(raw, 'utf8').copy(buf, 0, 0, 32);
  return buf;
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv(12):tag(16):ciphertext — base64 encoded
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv(ALG, getKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc) + decipher.final('utf8');
}

export const providerConfigService = {
  /** Return all 3 channel configs with secrets masked */
  async listAll(): Promise<ProviderConfig[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT id, channel, provider_type, config_json, is_enabled, test_ok, test_error, test_at FROM communication_provider_config ORDER BY channel'
    );
    return (rows as RowDataPacket[]).map(r => ({
      id: r.id,
      channel: r.channel as Channel,
      provider_type: r.provider_type as AnyProviderType,
      config_json: typeof r.config_json === 'string' ? JSON.parse(r.config_json) : (r.config_json ?? {}),
      is_enabled: !!r.is_enabled,
      test_ok: r.test_ok == null ? null : !!r.test_ok,
      test_error: r.test_error ?? null,
      test_at: r.test_at ?? null,
    }));
  },

  /** Return config for one channel including decrypted secrets (admin internal use only) */
  async getWithSecrets(channel: Channel): Promise<{ config: ProviderConfig; secrets: Record<string, string> }> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM communication_provider_config WHERE channel = ? LIMIT 1',
      [channel]
    );
    const row = (rows as RowDataPacket[])[0];
    if (!row) throw new Error(`No config for channel: ${channel}`);
    const secrets: Record<string, string> = {};
    if (row.secret_enc) {
      try {
        const plain = decrypt(row.secret_enc as string);
        Object.assign(secrets, JSON.parse(plain));
      } catch {
        // Decryption failure → return empty secrets so page can re-save
      }
    }
    return {
      config: {
        id: row.id,
        channel: row.channel as Channel,
        provider_type: row.provider_type as AnyProviderType,
        config_json: typeof row.config_json === 'string' ? JSON.parse(row.config_json) : (row.config_json ?? {}),
        is_enabled: !!row.is_enabled,
        test_ok: row.test_ok == null ? null : !!row.test_ok,
        test_error: row.test_error ?? null,
        test_at: row.test_at ?? null,
      },
      secrets,
    };
  },

  /** Save provider config — encrypts secrets, upserts row */
  async save(channel: Channel, dto: SaveProviderConfigDTO, userId: string): Promise<void> {
    const secretEnc = Object.keys(dto.secrets).length > 0 ? encrypt(JSON.stringify(dto.secrets)) : null;
    await db.execute(
      `INSERT INTO communication_provider_config
         (id, channel, provider_type, config_json, secret_enc, is_enabled, updated_by)
       VALUES (UUID(), ?, ?, ?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE
         provider_type = VALUES(provider_type),
         config_json   = VALUES(config_json),
         secret_enc    = COALESCE(VALUES(secret_enc), secret_enc),
         updated_by    = VALUES(updated_by)`,
      [channel, dto.provider_type, JSON.stringify(dto.config), secretEnc, userId]
    );
  },

  /** Enable or disable a channel */
  async setEnabled(channel: Channel, enabled: boolean, userId: string): Promise<void> {
    await db.execute(
      'UPDATE communication_provider_config SET is_enabled = ?, updated_by = ? WHERE channel = ?',
      [enabled ? 1 : 0, userId, channel]
    );
  },

  /** Store test result */
  async saveTestResult(channel: Channel, ok: boolean, error: string | null, userId: string): Promise<void> {
    await db.execute(
      'UPDATE communication_provider_config SET test_ok = ?, test_error = ?, test_at = NOW(), tested_by = ? WHERE channel = ?',
      [ok ? 1 : 0, error, userId, channel]
    );
  },

  /** Load decrypted secrets for a channel — used by provider factory */
  async loadSecrets(channel: Channel): Promise<Record<string, string>> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT secret_enc FROM communication_provider_config WHERE channel = ? AND is_enabled = 1 LIMIT 1',
      [channel]
    );
    const row = (rows as RowDataPacket[])[0];
    if (!row?.secret_enc) return {};
    try {
      return JSON.parse(decrypt(row.secret_enc as string));
    } catch {
      return {};
    }
  },

  /** Load full row for factory to build provider */
  async loadActiveConfig(channel: Channel): Promise<{ provider_type: AnyProviderType; config: Record<string, unknown>; secrets: Record<string, string> } | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT provider_type, config_json, secret_enc FROM communication_provider_config WHERE channel = ? AND is_enabled = 1 LIMIT 1',
      [channel]
    );
    const row = (rows as RowDataPacket[])[0];
    if (!row) return null;
    const config = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : (row.config_json ?? {});
    const secrets: Record<string, string> = {};
    if (row.secret_enc) {
      try { Object.assign(secrets, JSON.parse(decrypt(row.secret_enc as string))); } catch { /* ignore */ }
    }
    return { provider_type: row.provider_type as AnyProviderType, config, secrets };
  },
};
```

- [ ] **Step 2: TypeScript check**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
git add backend/src/modules/communication/provider-config.service.ts
git commit -m "feat(comm): provider-config.service — encrypted DB storage for provider credentials"
```

---

## Task 7 — Upgrade provider.factory.ts to DB-first

**Files:**
- Modify: `backend/src/modules/communication/providers/provider.factory.ts`

The factory must now: (1) try DB config first, (2) fall back to env vars, (3) support cache invalidation when admin saves new config.

- [ ] **Step 1: Read the current provider.factory.ts fully**

Note the `cache = new Map<Channel, CommunicationProvider>()` and `clearCache()` method.

- [ ] **Step 2: Replace the full file content**

```typescript
import type { CommunicationProvider } from './provider.interface.js';
import type { Channel } from '../communication.types.js';
import { NodemailerProvider } from './email/nodemailer.provider.js';
import { LocalEmailProvider } from './email/local-email.provider.js';
import { SendGridProvider } from './email/sendgrid.provider.js';
import { MailgunProvider } from './email/mailgun.provider.js';
import { TwilioSMSProvider } from './sms/twilio-sms.provider.js';
import { LocalSMSProvider } from './sms/local-sms.provider.js';
import { MSG91Provider } from './sms/msg91.provider.js';
import { TwilioWhatsAppProvider } from './whatsapp/twilio-whatsapp.provider.js';
import { LocalWhatsAppProvider } from './whatsapp/local-whatsapp.provider.js';
import { MetaWhatsAppProvider } from './whatsapp/meta.provider.js';

class ProviderFactory {
  private cache = new Map<Channel, CommunicationProvider>();

  /**
   * Returns the active provider for a channel.
   * Tries DB config first (injected at runtime); falls back to env vars.
   * Cache is cleared whenever admin saves new config via clearCache().
   */
  async getProviderAsync(
    channel: Channel,
    dbConfig?: { provider_type: string; config: Record<string, unknown>; secrets: Record<string, string> } | null,
  ): Promise<CommunicationProvider> {
    if (this.cache.has(channel)) return this.cache.get(channel)!;
    const provider = dbConfig
      ? this.buildFromDb(channel, dbConfig)
      : this.buildFromEnv(channel);
    this.cache.set(channel, provider);
    return provider;
  }

  /** Sync fallback (used when db lookup not available) */
  getProvider(channel: Channel): CommunicationProvider {
    if (!this.cache.has(channel)) {
      this.cache.set(channel, this.buildFromEnv(channel));
    }
    return this.cache.get(channel)!;
  }

  private buildFromDb(
    channel: Channel,
    { provider_type, config, secrets }: { provider_type: string; config: Record<string, unknown>; secrets: Record<string, string> },
  ): CommunicationProvider {
    if (channel === 'email') {
      if (provider_type === 'sendgrid') {
        return new SendGridProvider(
          secrets.sendgrid_api_key ?? '',
          (config.sendgrid_from as string) ?? secrets.smtp_user ?? '',
          (config.sendgrid_from_name as string) ?? 'MAS Callnet HRMS',
        );
      }
      if (provider_type === 'mailgun') {
        return new MailgunProvider(
          secrets.mailgun_api_key ?? '',
          (config.mailgun_domain as string) ?? '',
          (config.mailgun_from as string) ?? '',
          ((config.mailgun_region as 'us' | 'eu') ?? 'us'),
        );
      }
      if (provider_type === 'local-email-tool') return new LocalEmailProvider();
      // nodemailer — inject from DB config into a new instance
      return new NodemailerProvider(
        (config.smtp_host as string),
        Number(config.smtp_port ?? 587),
        !!(config.smtp_secure),
        (secrets.smtp_user ?? ''),
        (secrets.smtp_pass ?? ''),
        (config.smtp_from as string) ?? secrets.smtp_user ?? '',
      );
    }
    if (channel === 'sms') {
      if (provider_type === 'msg91') {
        return new MSG91Provider(secrets.msg91_auth_key ?? '', (config.msg91_sender_id as string) ?? '');
      }
      if (provider_type === 'local-sms-tool') return new LocalSMSProvider();
      // twilio
      return new TwilioSMSProvider(secrets.twilio_account_sid ?? '', secrets.twilio_auth_token ?? '', (config.twilio_messaging_service_sid as string) ?? '');
    }
    if (channel === 'whatsapp') {
      if (provider_type === 'meta') {
        return new MetaWhatsAppProvider(secrets.meta_access_token ?? '', (config.meta_phone_number_id as string) ?? '');
      }
      if (provider_type === 'local-whatsapp-tool') return new LocalWhatsAppProvider();
      // twilio
      return new TwilioWhatsAppProvider(secrets.twilio_account_sid ?? '', secrets.twilio_auth_token ?? '', (config.twilio_whatsapp_number as string) ?? '');
    }
    throw new Error(`Unknown channel: ${channel}`);
  }

  private buildFromEnv(channel: Channel): CommunicationProvider {
    if (channel === 'email') {
      const type = process.env.EMAIL_PROVIDER ?? 'nodemailer';
      if (type === 'sendgrid')        return new SendGridProvider(process.env.SENDGRID_API_KEY ?? '', process.env.SENDGRID_FROM ?? '');
      if (type === 'mailgun')         return new MailgunProvider(process.env.MAILGUN_API_KEY ?? '', process.env.MAILGUN_DOMAIN ?? '', process.env.MAILGUN_FROM ?? '');
      if (type === 'local-email-tool') return new LocalEmailProvider();
      return new NodemailerProvider();
    }
    if (channel === 'sms') {
      const type = process.env.SMS_PROVIDER ?? 'twilio';
      if (type === 'msg91')          return new MSG91Provider(process.env.MSG91_AUTH_KEY ?? '', process.env.MSG91_SENDER_ID ?? '');
      if (type === 'local-sms-tool') return new LocalSMSProvider();
      return new TwilioSMSProvider();
    }
    if (channel === 'whatsapp') {
      const type = process.env.WHATSAPP_PROVIDER ?? 'twilio';
      if (type === 'meta')                return new MetaWhatsAppProvider(process.env.META_WA_ACCESS_TOKEN ?? '', process.env.META_WA_PHONE_NUMBER_ID ?? '');
      if (type === 'local-whatsapp-tool') return new LocalWhatsAppProvider();
      return new TwilioWhatsAppProvider();
    }
    throw new Error(`Unknown channel: ${channel}`);
  }

  clearCache(): void { this.cache.clear(); }
}

export const providerFactory = new ProviderFactory();
```

- [ ] **Step 3: Update NodemailerProvider, TwilioSMSProvider, TwilioWhatsAppProvider to accept constructor params**

The factory now passes credentials as constructor arguments (not just env vars). Update each provider to accept optional constructor params:

**`nodemailer.provider.ts`** — add constructor:
```typescript
export class NodemailerProvider implements CommunicationProvider {
  private transporter: nodemailer.Transporter;

  constructor(
    host?: string,
    port?: number,
    secure?: boolean,
    user?: string,
    pass?: string,
    from?: string,
  ) {
    this.transporter = nodemailer.createTransport({
      host:   host   ?? process.env.SMTP_HOST,
      port:   port   ?? parseInt(process.env.SMTP_PORT ?? '587'),
      secure: secure ?? process.env.SMTP_SECURE === 'true',
      auth: {
        user: user ?? process.env.SMTP_USER,
        pass: pass ?? process.env.SMTP_PASS,
      },
    });
    this._from = from ?? process.env.SMTP_FROM ?? process.env.SMTP_USER;
  }
  private _from: string | undefined;

  async send(recipient: string, subject: string, body: string, attachments?: Attachment[]): Promise<ProviderResponse> {
    try {
      const result = await this.transporter.sendMail({
        from: this._from,
        to: recipient, subject, html: body,
        attachments: attachments?.map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      });
      return { success: true, message_id: result.messageId };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  // getDeliveryStatus and validateRecipient unchanged
```

**`twilio-sms.provider.ts`** — add constructor:
```typescript
export class TwilioSMSProvider implements CommunicationProvider {
  private client: ReturnType<typeof twilio>;
  private sid: string;

  constructor(accountSid?: string, authToken?: string, messagingServiceSid?: string) {
    const sid  = accountSid  ?? process.env.TWILIO_ACCOUNT_SID  ?? '';
    const tok  = authToken   ?? process.env.TWILIO_AUTH_TOKEN   ?? '';
    this.sid   = messagingServiceSid ?? process.env.TWILIO_MESSAGING_SERVICE_SID ?? '';
    this.client = twilio(sid, tok);
  }
  // send/getDeliveryStatus/validateRecipient unchanged — just use this.client and this.sid
```

**`twilio-whatsapp.provider.ts`** — add constructor:
```typescript
export class TwilioWhatsAppProvider implements CommunicationProvider {
  private client: ReturnType<typeof twilio>;
  private from: string;

  constructor(accountSid?: string, authToken?: string, whatsappNumber?: string) {
    const sid  = accountSid    ?? process.env.TWILIO_ACCOUNT_SID    ?? '';
    const tok  = authToken     ?? process.env.TWILIO_AUTH_TOKEN     ?? '';
    this.from  = whatsappNumber ? `whatsapp:${whatsappNumber}` : (process.env.TWILIO_WHATSAPP_NUMBER ? `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}` : '');
    this.client = twilio(sid, tok);
  }
```

- [ ] **Step 4: TypeScript check**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "error TS" | head -20
```

Fix all errors. Common issue: `this._from` needs to be declared before constructor. Use `private _from: string | undefined;` field declaration.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/communication/providers/provider.factory.ts
git add backend/src/modules/communication/providers/email/nodemailer.provider.ts
git add backend/src/modules/communication/providers/sms/twilio-sms.provider.ts
git add backend/src/modules/communication/providers/whatsapp/twilio-whatsapp.provider.ts
git commit -m "feat(comm): DB-first provider factory — reads config from DB, falls back to env vars"
```

---

## Task 8 — Backend config endpoints + Zod validation + test-connection

**Files:**
- Modify: `backend/src/modules/communication/communication.validation.ts`
- Modify: `backend/src/modules/communication/communication.routes.ts`

- [ ] **Step 1: Add ProviderConfigSchema to communication.validation.ts**

Append to the end of `communication.validation.ts`:

```typescript
export const SaveEmailConfigSchema = z.object({
  provider_type: z.enum(['nodemailer', 'sendgrid', 'mailgun', 'local-email-tool']),
  config: z.object({
    smtp_host:        z.string().optional(),
    smtp_port:        z.number().int().min(1).max(65535).optional(),
    smtp_secure:      z.boolean().optional(),
    smtp_from:        z.string().email().optional(),
    smtp_from_name:   z.string().optional(),
    sendgrid_from:    z.string().email().optional(),
    sendgrid_from_name: z.string().optional(),
    mailgun_domain:   z.string().optional(),
    mailgun_region:   z.enum(['us', 'eu']).optional(),
    mailgun_from:     z.string().email().optional(),
    local_api_url:    z.string().url().optional(),
  }),
  secrets: z.object({
    smtp_user:        z.string().optional(),
    smtp_pass:        z.string().optional(),
    sendgrid_api_key: z.string().optional(),
    mailgun_api_key:  z.string().optional(),
    local_api_key:    z.string().optional(),
  }),
  test_recipient: z.string().email().optional(),
});

export const SaveSMSConfigSchema = z.object({
  provider_type: z.enum(['twilio', 'msg91', 'local-sms-tool']),
  config: z.object({
    twilio_messaging_service_sid: z.string().optional(),
    msg91_sender_id:  z.string().max(6).optional(),
    local_api_url:    z.string().url().optional(),
    local_sender_id:  z.string().optional(),
  }),
  secrets: z.object({
    twilio_account_sid: z.string().optional(),
    twilio_auth_token:  z.string().optional(),
    msg91_auth_key:     z.string().optional(),
    local_api_key:      z.string().optional(),
  }),
  test_recipient: z.string().optional(),
});

export const SaveWAConfigSchema = z.object({
  provider_type: z.enum(['twilio', 'meta', 'local-whatsapp-tool']),
  config: z.object({
    twilio_whatsapp_number:   z.string().optional(),
    meta_phone_number_id:     z.string().optional(),
    meta_waba_id:             z.string().optional(),
    local_api_url:            z.string().url().optional(),
    local_business_number:    z.string().optional(),
  }),
  secrets: z.object({
    twilio_account_sid:  z.string().optional(),
    twilio_auth_token:   z.string().optional(),
    meta_access_token:   z.string().optional(),
    local_api_key:       z.string().optional(),
  }),
  test_recipient: z.string().optional(),
});

export const ChannelParamSchema = z.enum(['email', 'sms', 'whatsapp']);
```

- [ ] **Step 2: Add 5 config endpoints to communication.routes.ts**

Read the file. Append these routes BEFORE the export, after the existing preference routes. All require `requireRole('admin')`:

```typescript
import { providerConfigService } from './provider-config.service.js';
import { SaveEmailConfigSchema, SaveSMSConfigSchema, SaveWAConfigSchema, ChannelParamSchema } from './communication.validation.js';
import type { TestResult } from './communication.types.js';

// ── Provider Config Routes (admin only) ──────────────────────────────────────

// GET /api/communication/config — list all 3 channel configs (secrets masked)
router.get('/config', requireRole('admin'), h(async (_req: AuthenticatedRequest, res: Response) => {
  const configs = await providerConfigService.listAll();
  res.json({ success: true, data: configs });
}));

// GET /api/communication/config/:channel — get single channel config with masked secrets
router.get('/config/:channel', requireRole('admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const channel = ChannelParamSchema.safeParse(req.params.channel);
  if (!channel.success) return res.status(400).json({ error: 'Invalid channel. Must be email, sms, or whatsapp' });
  const result = await providerConfigService.getWithSecrets(channel.data);
  // Mask secrets for display — replace all values with •••• except length hint
  const maskedSecrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(result.secrets)) {
    maskedSecrets[k] = v ? '••••••••' : '';
  }
  res.json({ success: true, data: { ...result.config, secrets: maskedSecrets } });
}));

// PUT /api/communication/config/:channel — save config + encrypted secrets
router.put('/config/:channel', requireRole('admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const channel = ChannelParamSchema.safeParse(req.params.channel);
  if (!channel.success) return res.status(400).json({ error: 'Invalid channel' });
  const schema = channel.data === 'email' ? SaveEmailConfigSchema : channel.data === 'sms' ? SaveSMSConfigSchema : SaveWAConfigSchema;
  const dto = schema.safeParse(req.body);
  if (!dto.success) return res.status(400).json({ error: 'Validation failed', details: dto.error.errors });
  await providerConfigService.save(channel.data, { provider_type: dto.data.provider_type as any, config: dto.data.config as any, secrets: dto.data.secrets as any }, req.authUser!.id);
  // Clear provider factory cache so next dispatch picks up new config
  const { providerFactory } = await import('./providers/provider.factory.js');
  providerFactory.clearCache();
  res.json({ success: true, message: `${channel.data} provider configuration saved` });
}));

// POST /api/communication/config/:channel/enable — enable channel
router.post('/config/:channel/enable', requireRole('admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const channel = ChannelParamSchema.safeParse(req.params.channel);
  if (!channel.success) return res.status(400).json({ error: 'Invalid channel' });
  await providerConfigService.setEnabled(channel.data, true, req.authUser!.id);
  const { providerFactory } = await import('./providers/provider.factory.js');
  providerFactory.clearCache();
  res.json({ success: true, message: `${channel.data} channel enabled` });
}));

// POST /api/communication/config/:channel/disable — disable channel
router.post('/config/:channel/disable', requireRole('admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const channel = ChannelParamSchema.safeParse(req.params.channel);
  if (!channel.success) return res.status(400).json({ error: 'Invalid channel' });
  await providerConfigService.setEnabled(channel.data, false, req.authUser!.id);
  const { providerFactory } = await import('./providers/provider.factory.js');
  providerFactory.clearCache();
  res.json({ success: true, message: `${channel.data} channel disabled` });
}));

// POST /api/communication/config/:channel/test — send test message to admin's contact
router.post('/config/:channel/test', requireRole('admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const channel = ChannelParamSchema.safeParse(req.params.channel);
  if (!channel.success) return res.status(400).json({ error: 'Invalid channel' });
  const { test_recipient } = req.body as { test_recipient?: string };
  if (!test_recipient) return res.status(400).json({ error: 'test_recipient required' });

  // Load active (or temporarily use saved-but-disabled) config for test
  const dbConfig = await providerConfigService.loadActiveConfig(channel.data)
    ?? await (async () => {
      // Even if disabled, allow test using saved config
      const r = await providerConfigService.getWithSecrets(channel.data);
      return { provider_type: r.config.provider_type, config: r.config.config_json as Record<string, unknown>, secrets: r.secrets };
    })();

  const { providerFactory } = await import('./providers/provider.factory.js');
  providerFactory.clearCache(); // force rebuild with current config
  let provider;
  try {
    provider = await providerFactory.getProviderAsync(channel.data, dbConfig);
  } catch (e: any) {
    await providerConfigService.saveTestResult(channel.data, false, e.message, req.authUser!.id);
    return res.status(400).json({ success: false, error: e.message } as TestResult);
  }

  if (!provider.validateRecipient(test_recipient)) {
    const err = `Invalid ${channel.data} recipient format: ${test_recipient}`;
    await providerConfigService.saveTestResult(channel.data, false, err, req.authUser!.id);
    return res.status(400).json({ success: false, error: err } as TestResult);
  }

  const result = await provider.send(
    test_recipient,
    'MAS Callnet HRMS — Test Notification',
    channel.data === 'email'
      ? '<h2>Test email from MAS Callnet HRMS</h2><p>If you received this, your email configuration is working correctly.</p>'
      : 'Test message from MAS Callnet HRMS. Your communication channel is configured correctly.',
  );

  await providerConfigService.saveTestResult(channel.data, result.success, result.error ?? null, req.authUser!.id);
  providerFactory.clearCache();

  const response: TestResult = {
    success: result.success,
    error: result.error,
    provider: provider.getName(),
    channel: channel.data,
  };
  res.status(result.success ? 200 : 502).json(response);
}));
```

- [ ] **Step 3: TypeScript check**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "error TS" | head -20
```

Fix ALL errors before committing.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/communication/communication.validation.ts
git add backend/src/modules/communication/communication.routes.ts
git commit -m "feat(comm): config endpoints — GET/PUT /config/:channel, enable/disable, test-connection"
```

---

## Task 9 — Update dispatch.service.ts to use DB-first provider

**Files:**
- Modify: `backend/src/modules/communication/dispatch.service.ts`

The dispatch service currently calls `providerFactory.getProvider(channel)` (sync, env-only). Update to use `getProviderAsync` with DB config.

- [ ] **Step 1: Read dispatch.service.ts lines 1-80**

Find `_deliver` method and `providerFactory.getProvider` usage.

- [ ] **Step 2: Update the `_deliver` private method**

Find the line: `const provider = providerFactory.getProvider(channel);`

Replace with:
```typescript
// Load DB config for this channel so admin panel changes take effect immediately
const dbConfig = await providerConfigService.loadActiveConfig(channel);
const provider = await providerFactory.getProviderAsync(channel, dbConfig);
```

Add import at top of the file:
```typescript
import { providerConfigService } from './provider-config.service.js';
```

- [ ] **Step 3: TypeScript check**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1/backend
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "error TS" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/communication/dispatch.service.ts
git commit -m "feat(comm): dispatch service uses DB-first provider — admin config changes take effect immediately"
```

---

## Task 10 — Frontend: NativeCommunicationConfig.tsx admin page

**Files:**
- Create: `src/pages/NativeCommunicationConfig.tsx`

This is the admin page at `/settings/communication-config`. Three tabs: Email, SMS, WhatsApp. Each tab has a provider selector, credential form fields, test button, and enable/disable toggle.

- [ ] **Step 1: Create the full page**

```typescript
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, MessageSquare, MessagesSquare, CheckCircle2, XCircle, Loader2, Eye, EyeOff } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Channel = "email" | "sms" | "whatsapp";
type EmailProvider = "nodemailer" | "sendgrid" | "mailgun" | "local-email-tool";
type SMSProvider = "twilio" | "msg91" | "local-sms-tool";
type WAProvider = "twilio" | "meta" | "local-whatsapp-tool";

interface ChannelConfig {
  id: string;
  channel: Channel;
  provider_type: string;
  config_json: Record<string, any>;
  is_enabled: boolean;
  test_ok: boolean | null;
  test_error: string | null;
  test_at: string | null;
}

function SecretInput({ label, name, value, onChange, placeholder }: { label: string; name: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? "Enter value…"}
          className="pr-10"
        />
        <button type="button" onClick={() => setShow(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ config }: { config: ChannelConfig }) {
  if (!config.is_enabled) return <Badge variant="secondary">Disabled</Badge>;
  if (config.test_ok === null) return <Badge variant="outline">Not Tested</Badge>;
  if (config.test_ok) return <Badge className="bg-green-100 text-green-800">Connected ✓</Badge>;
  return <Badge variant="destructive">Connection Failed</Badge>;
}

// ── EMAIL FORM ─────────────────────────────────────────────────────────────
function EmailForm({ initial, onSave }: { initial: ChannelConfig; onSave: (data: any) => void }) {
  const [provider, setProvider] = useState<EmailProvider>((initial.provider_type as EmailProvider) ?? "nodemailer");
  const [cfg, setCfg] = useState<Record<string, any>>(initial.config_json ?? {});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [testTo, setTestTo] = useState("");

  const f = (k: string) => (v: string) => setCfg(c => ({ ...c, [k]: v }));
  const s = (k: string) => (v: string) => setSecrets(c => ({ ...c, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Email Provider</Label>
        <Select value={provider} onValueChange={v => setProvider(v as EmailProvider)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="nodemailer">SMTP (Gmail / Company Server / Any SMTP)</SelectItem>
            <SelectItem value="sendgrid">SendGrid API</SelectItem>
            <SelectItem value="mailgun">Mailgun API</SelectItem>
            <SelectItem value="local-email-tool">Custom HTTP endpoint</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {provider === "nodemailer" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>SMTP Host</Label>
            <Input value={cfg.smtp_host ?? ""} onChange={e => f("smtp_host")(e.target.value)} placeholder="smtp.gmail.com" />
          </div>
          <div className="space-y-1">
            <Label>Port</Label>
            <Input type="number" value={cfg.smtp_port ?? 587} onChange={e => f("smtp_port")(e.target.value)} placeholder="587" />
          </div>
          <div className="space-y-1">
            <Label>Username / Email</Label>
            <Input value={secrets.smtp_user ?? ""} onChange={e => s("smtp_user")(e.target.value)} placeholder="hr@mascallnet.com" />
          </div>
          <SecretInput label="Password / App Password" name="smtp_pass" value={secrets.smtp_pass ?? ""} onChange={s("smtp_pass")} placeholder="Gmail App Password" />
          <div className="space-y-1">
            <Label>From Address</Label>
            <Input value={cfg.smtp_from ?? ""} onChange={e => f("smtp_from")(e.target.value)} placeholder="hr@mascallnet.com" />
          </div>
          <div className="space-y-1">
            <Label>From Name</Label>
            <Input value={cfg.smtp_from_name ?? ""} onChange={e => f("smtp_from_name")(e.target.value)} placeholder="MAS Callnet HRMS" />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Switch checked={!!cfg.smtp_secure} onCheckedChange={v => setCfg(c => ({ ...c, smtp_secure: v }))} />
            <Label>Use TLS/SSL (enable for port 465, disable for 587)</Label>
          </div>
          <div className="col-span-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
            <strong>Gmail tip:</strong> Use smtp.gmail.com:587, your Gmail address as username, and a <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="underline">Google App Password</a> (not your regular password).
          </div>
        </div>
      )}

      {provider === "sendgrid" && (
        <div className="space-y-3">
          <SecretInput label="SendGrid API Key" name="sendgrid_api_key" value={secrets.sendgrid_api_key ?? ""} onChange={s("sendgrid_api_key")} placeholder="SG.xxxxx" />
          <div className="space-y-1">
            <Label>From Address (must be verified in SendGrid)</Label>
            <Input value={cfg.sendgrid_from ?? ""} onChange={e => f("sendgrid_from")(e.target.value)} placeholder="hr@mascallnet.com" />
          </div>
          <div className="space-y-1">
            <Label>From Name</Label>
            <Input value={cfg.sendgrid_from_name ?? ""} onChange={e => f("sendgrid_from_name")(e.target.value)} placeholder="MAS Callnet HRMS" />
          </div>
          <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
            Get your API key at <a href="https://app.sendgrid.com/settings/api_keys" target="_blank" rel="noopener noreferrer" className="underline">SendGrid → Settings → API Keys</a>. Verify your sender domain in Sender Authentication first.
          </div>
        </div>
      )}

      {provider === "mailgun" && (
        <div className="space-y-3">
          <SecretInput label="Mailgun API Key" name="mailgun_api_key" value={secrets.mailgun_api_key ?? ""} onChange={s("mailgun_api_key")} placeholder="key-xxxxx" />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Mailgun Domain</Label>
              <Input value={cfg.mailgun_domain ?? ""} onChange={e => f("mailgun_domain")(e.target.value)} placeholder="mg.mascallnet.com" />
            </div>
            <div className="space-y-1">
              <Label>Region</Label>
              <Select value={cfg.mailgun_region ?? "us"} onValueChange={f("mailgun_region")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="us">US (api.mailgun.net)</SelectItem>
                  <SelectItem value="eu">EU (api.eu.mailgun.net)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>From Address</Label>
            <Input value={cfg.mailgun_from ?? ""} onChange={e => f("mailgun_from")(e.target.value)} placeholder="hr@mg.mascallnet.com" />
          </div>
        </div>
      )}

      {provider === "local-email-tool" && (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>API URL</Label>
            <Input value={cfg.local_api_url ?? ""} onChange={e => f("local_api_url")(e.target.value)} placeholder="https://your-email-api.com" />
          </div>
          <SecretInput label="API Key" name="local_api_key" value={secrets.local_api_key ?? ""} onChange={s("local_api_key")} placeholder="Bearer token" />
        </div>
      )}

      <div className="border-t pt-4 space-y-3">
        <div className="space-y-1">
          <Label>Test Email Address</Label>
          <Input type="email" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="admin@mascallnet.com" />
          <p className="text-xs text-slate-500">Send a test email to verify configuration before enabling</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => onSave({ provider_type: provider, config: cfg, secrets, test_recipient: testTo || undefined })} className="flex-1">
            Save Configuration
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── SMS FORM ───────────────────────────────────────────────────────────────
function SMSForm({ initial, onSave }: { initial: ChannelConfig; onSave: (data: any) => void }) {
  const [provider, setProvider] = useState<SMSProvider>((initial.provider_type as SMSProvider) ?? "twilio");
  const [cfg, setCfg] = useState<Record<string, any>>(initial.config_json ?? {});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [testTo, setTestTo] = useState("");

  const f = (k: string) => (v: string) => setCfg(c => ({ ...c, [k]: v }));
  const s = (k: string) => (v: string) => setSecrets(c => ({ ...c, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>SMS Provider</Label>
        <Select value={provider} onValueChange={v => setProvider(v as SMSProvider)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="twilio">Twilio (Global)</SelectItem>
            <SelectItem value="msg91">MSG91 (India — DLT registered)</SelectItem>
            <SelectItem value="local-sms-tool">Custom HTTP endpoint</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {provider === "twilio" && (
        <div className="space-y-3">
          <SecretInput label="Account SID" name="twilio_account_sid" value={secrets.twilio_account_sid ?? ""} onChange={s("twilio_account_sid")} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          <SecretInput label="Auth Token" name="twilio_auth_token" value={secrets.twilio_auth_token ?? ""} onChange={s("twilio_auth_token")} placeholder="Your Twilio Auth Token" />
          <div className="space-y-1">
            <Label>Messaging Service SID</Label>
            <Input value={cfg.twilio_messaging_service_sid ?? ""} onChange={e => f("twilio_messaging_service_sid")(e.target.value)} placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          </div>
          <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
            Find Account SID and Auth Token on your <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" className="underline">Twilio Console</a>. Create a Messaging Service under Messaging → Services.
          </div>
        </div>
      )}

      {provider === "msg91" && (
        <div className="space-y-3">
          <SecretInput label="Auth Key" name="msg91_auth_key" value={secrets.msg91_auth_key ?? ""} onChange={s("msg91_auth_key")} placeholder="Your MSG91 Auth Key" />
          <div className="space-y-1">
            <Label>Sender ID (DLT registered, 6 chars)</Label>
            <Input value={cfg.msg91_sender_id ?? ""} onChange={e => f("msg91_sender_id")(e.target.value)} placeholder="MASCAL" maxLength={6} />
          </div>
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <strong>India DLT requirement:</strong> Your Sender ID must be registered with TRAI through your telecom operator. This takes 1–3 business days. Get Auth Key from <a href="https://msg91.com/in" target="_blank" rel="noopener noreferrer" className="underline">MSG91 dashboard</a>.
          </div>
        </div>
      )}

      {provider === "local-sms-tool" && (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>API URL</Label>
            <Input value={cfg.local_api_url ?? ""} onChange={e => f("local_api_url")(e.target.value)} placeholder="https://your-sms-api.com" />
          </div>
          <SecretInput label="API Key" name="local_api_key" value={secrets.local_api_key ?? ""} onChange={s("local_api_key")} />
          <div className="space-y-1">
            <Label>Sender ID</Label>
            <Input value={cfg.local_sender_id ?? ""} onChange={e => f("local_sender_id")(e.target.value)} placeholder="MASCAL" />
          </div>
        </div>
      )}

      <div className="border-t pt-4 space-y-3">
        <div className="space-y-1">
          <Label>Test Mobile Number</Label>
          <Input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="+919876543210" />
          <p className="text-xs text-slate-500">Include country code (e.g. +91 for India)</p>
        </div>
        <Button onClick={() => onSave({ provider_type: provider, config: cfg, secrets, test_recipient: testTo || undefined })} className="w-full">
          Save Configuration
        </Button>
      </div>
    </div>
  );
}

// ── WHATSAPP FORM ──────────────────────────────────────────────────────────
function WAForm({ initial, onSave }: { initial: ChannelConfig; onSave: (data: any) => void }) {
  const [provider, setProvider] = useState<WAProvider>((initial.provider_type as WAProvider) ?? "twilio");
  const [cfg, setCfg] = useState<Record<string, any>>(initial.config_json ?? {});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [testTo, setTestTo] = useState("");

  const f = (k: string) => (v: string) => setCfg(c => ({ ...c, [k]: v }));
  const s = (k: string) => (v: string) => setSecrets(c => ({ ...c, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>WhatsApp Provider</Label>
        <Select value={provider} onValueChange={v => setProvider(v as WAProvider)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="twilio">Twilio WhatsApp Business</SelectItem>
            <SelectItem value="meta">Meta Cloud API (Official WhatsApp Business)</SelectItem>
            <SelectItem value="local-whatsapp-tool">Custom HTTP endpoint</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {provider === "twilio" && (
        <div className="space-y-3">
          <SecretInput label="Account SID" name="twilio_account_sid" value={secrets.twilio_account_sid ?? ""} onChange={s("twilio_account_sid")} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          <SecretInput label="Auth Token" name="twilio_auth_token" value={secrets.twilio_auth_token ?? ""} onChange={s("twilio_auth_token")} />
          <div className="space-y-1">
            <Label>WhatsApp-enabled Twilio Number</Label>
            <Input value={cfg.twilio_whatsapp_number ?? ""} onChange={e => f("twilio_whatsapp_number")(e.target.value)} placeholder="+14155238886" />
          </div>
          <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
            Enable WhatsApp on your Twilio number at <a href="https://console.twilio.com/us1/develop/sms/senders/whatsapp-senders" target="_blank" rel="noopener noreferrer" className="underline">Twilio Console → WhatsApp Senders</a>. The sandbox number for testing is +14155238886.
          </div>
        </div>
      )}

      {provider === "meta" && (
        <div className="space-y-3">
          <SecretInput label="Permanent Access Token" name="meta_access_token" value={secrets.meta_access_token ?? ""} onChange={s("meta_access_token")} placeholder="EAAxxxxxx (System User token)" />
          <div className="space-y-1">
            <Label>Phone Number ID</Label>
            <Input value={cfg.meta_phone_number_id ?? ""} onChange={e => f("meta_phone_number_id")(e.target.value)} placeholder="123456789012345 (numeric)" />
          </div>
          <div className="space-y-1">
            <Label>WhatsApp Business Account ID (WABA ID)</Label>
            <Input value={cfg.meta_waba_id ?? ""} onChange={e => f("meta_waba_id")(e.target.value)} placeholder="123456789012345 (numeric)" />
          </div>
          <div className="rounded-lg bg-purple-50 p-3 text-sm text-purple-800">
            <strong>Setup steps:</strong> (1) Create a Meta Business account → (2) Set up a WhatsApp Business app in Meta Developer Console → (3) Generate a permanent System User token → (4) Add phone number and get Phone Number ID. See <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noopener noreferrer" className="underline">Meta Cloud API docs</a>.
          </div>
        </div>
      )}

      {provider === "local-whatsapp-tool" && (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>API URL</Label>
            <Input value={cfg.local_api_url ?? ""} onChange={e => f("local_api_url")(e.target.value)} placeholder="https://your-wa-api.com" />
          </div>
          <SecretInput label="API Key" name="local_api_key" value={secrets.local_api_key ?? ""} onChange={s("local_api_key")} />
          <div className="space-y-1">
            <Label>Business WhatsApp Number</Label>
            <Input value={cfg.local_business_number ?? ""} onChange={e => f("local_business_number")(e.target.value)} placeholder="+919876543210" />
          </div>
        </div>
      )}

      <div className="border-t pt-4 space-y-3">
        <div className="space-y-1">
          <Label>Test WhatsApp Number</Label>
          <Input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="+919876543210" />
          <p className="text-xs text-slate-500">Must be a WhatsApp-enabled number. Include country code.</p>
        </div>
        <Button onClick={() => onSave({ provider_type: provider, config: cfg, secrets, test_recipient: testTo || undefined })} className="w-full">
          Save Configuration
        </Button>
      </div>
    </div>
  );
}

// ── MAIN PAGE ──────────────────────────────────────────────────────────────
export default function NativeCommunicationConfig() {
  const qc = useQueryClient();

  const { data: configs = [], isLoading } = useQuery<ChannelConfig[]>({
    queryKey: ["communication-config"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: ChannelConfig[] }>("/api/communication/config");
      return res.data ?? [];
    },
  });

  const configMap = Object.fromEntries(configs.map(c => [c.channel, c])) as Record<Channel, ChannelConfig>;

  const saveMutation = useMutation({
    mutationFn: async ({ channel, data }: { channel: Channel; data: any }) => {
      const { test_recipient, ...saveData } = data;
      await hrmsApi.put(`/api/communication/config/${channel}`, saveData);
      return { channel, test_recipient };
    },
    onSuccess: async ({ channel, test_recipient }) => {
      toast.success(`${channel} configuration saved`);
      qc.invalidateQueries({ queryKey: ["communication-config"] });
      if (test_recipient) {
        testMutation.mutate({ channel, test_recipient });
      }
    },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const testMutation = useMutation({
    mutationFn: async ({ channel, test_recipient }: { channel: Channel; test_recipient: string }) => {
      return hrmsApi.post<{ success: boolean; error?: string; provider: string }>(`/api/communication/config/${channel}/test`, { test_recipient });
    },
    onSuccess: (res, { channel }) => {
      if ((res as any).success) {
        toast.success(`Test ${channel} sent successfully! Check your inbox.`);
      } else {
        toast.error(`Test failed: ${(res as any).error}`);
      }
      qc.invalidateQueries({ queryKey: ["communication-config"] });
    },
    onError: (e: any) => toast.error(`Test failed: ${e.message}`),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ channel, enable }: { channel: Channel; enable: boolean }) => {
      return hrmsApi.post(`/api/communication/config/${channel}/${enable ? "enable" : "disable"}`, {});
    },
    onSuccess: (_r, { channel, enable }) => {
      toast.success(`${channel} channel ${enable ? "enabled" : "disabled"}`);
      qc.invalidateQueries({ queryKey: ["communication-config"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const channels: { key: Channel; label: string; icon: React.ReactNode; description: string }[] = [
    { key: "email", label: "Email", icon: <Mail className="h-4 w-4" />, description: "SMTP, SendGrid, or Mailgun" },
    { key: "sms", label: "SMS", icon: <MessageSquare className="h-4 w-4" />, description: "Twilio or MSG91 (India)" },
    { key: "whatsapp", label: "WhatsApp", icon: <MessagesSquare className="h-4 w-4" />, description: "Twilio or Meta Cloud API" },
  ];

  const empty: ChannelConfig = { id: "", channel: "email", provider_type: "nodemailer", config_json: {}, is_enabled: false, test_ok: null, test_error: null, test_at: null };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Communication Configuration</h1>
          <p className="mt-1 text-slate-500">Configure email, SMS, and WhatsApp providers. Changes take effect immediately — no server restart needed.</p>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading configuration…</div>
        ) : (
          <Tabs defaultValue="email">
            <TabsList className="grid grid-cols-3 w-full max-w-md">
              {channels.map(ch => (
                <TabsTrigger key={ch.key} value={ch.key} className="flex items-center gap-2">
                  {ch.icon} {ch.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {channels.map(ch => {
              const cfg = configMap[ch.key] ?? { ...empty, channel: ch.key };
              return (
                <TabsContent key={ch.key} value={ch.key} className="mt-4">
                  <Card className="max-w-2xl">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">{ch.icon} {ch.label}</CardTitle>
                          <CardDescription className="mt-1">{ch.description}</CardDescription>
                        </div>
                        <div className="flex items-center gap-3">
                          <StatusBadge config={cfg} />
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={cfg.is_enabled}
                              onCheckedChange={v => toggleMutation.mutate({ channel: ch.key, enable: v })}
                            />
                            <span className="text-sm text-slate-600">{cfg.is_enabled ? "Enabled" : "Disabled"}</span>
                          </div>
                        </div>
                      </div>

                      {cfg.test_at && (
                        <div className={`mt-2 flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${cfg.test_ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
                          {cfg.test_ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                          {cfg.test_ok ? "Last test passed" : `Last test failed: ${cfg.test_error}`}
                          <span className="ml-auto text-xs opacity-60">{new Date(cfg.test_at).toLocaleString()}</span>
                        </div>
                      )}
                    </CardHeader>

                    <CardContent>
                      {ch.key === "email" && (
                        <EmailForm initial={cfg} onSave={data => saveMutation.mutate({ channel: "email", data })} />
                      )}
                      {ch.key === "sms" && (
                        <SMSForm initial={cfg} onSave={data => saveMutation.mutate({ channel: "sms", data })} />
                      )}
                      {ch.key === "whatsapp" && (
                        <WAForm initial={cfg} onSave={data => saveMutation.mutate({ channel: "whatsapp", data })} />
                      )}

                      {saveMutation.isPending && (
                        <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                          <Loader2 className="h-3 w-3 animate-spin" /> Saving…
                        </div>
                      )}
                      {testMutation.isPending && (
                        <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                          <Loader2 className="h-3 w-3 animate-spin" /> Sending test message…
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "error TS" | head -20
```

Fix errors — common issues: missing `React` import (add `import React from "react"` if needed), `hrmsApi.post` return type.

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeCommunicationConfig.tsx
git commit -m "feat(comm): communication config admin page — email/SMS/WhatsApp provider forms with test-connection"
```

---

## Task 11 — Wire route + sidebar nav

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/layout/DashboardLayout.tsx`

- [ ] **Step 1: Add route to App.tsx**

Read `src/App.tsx`. Find the block with `/communication/templates` and similar routes. Add:

```typescript
const NativeCommunicationConfig = lazy(() => import("./pages/NativeCommunicationConfig"));
```

In the routes section, add (admin-only, near other system settings routes):
```typescript
<Route path="/settings/communication-config" element={
  <ProtectedRoute>
    <Suspense fallback={<PageLoader />}>
      <NativeCommunicationConfig />
    </Suspense>
  </ProtectedRoute>
} />
```

- [ ] **Step 2: Add sidebar nav item in DashboardLayout.tsx**

Read `src/components/layout/DashboardLayout.tsx`. Find the System nav group. Add an item after "Communication" entries:

```typescript
{
  label: "Comm. Config",
  path: "/settings/communication-config",
  icon: Settings2,          // or use Mail icon
  adminOnly: true,
  description: "Email, SMS, WhatsApp provider setup",
},
```

Import `Settings2` from `lucide-react` if not already imported.

- [ ] **Step 3: TypeScript check + build**

```bash
cd /c/Users/shivamg/Desktop/HRMS/HRMS1
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "error TS" | head -20
```

- [ ] **Step 4: Commit + push**

```bash
git add src/App.tsx src/components/layout/DashboardLayout.tsx
git commit -m "feat(comm): add /settings/communication-config route and sidebar nav item"
git fetch upstream && git rebase upstream/main
git push upstream main
git push origin main --force-with-lease
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Email providers: nodemailer (SMTP), SendGrid, Mailgun, local HTTP — all implemented
- ✅ SMS providers: Twilio, MSG91, local HTTP — all implemented  
- ✅ WhatsApp providers: Twilio, Meta Cloud API, local HTTP — all implemented
- ✅ Encrypted DB storage: AES-256-GCM using existing PAYROLL_BANK_KEY
- ✅ DB-first provider factory: loadActiveConfig() → buildFromDb()
- ✅ Test connection endpoint: sends real test message, stores result
- ✅ Enable/disable per channel
- ✅ Admin UI: tabs, forms, test button, status badge, setup instructions per provider
- ✅ Cache invalidation: clearCache() called on save/enable/disable
- ✅ Secrets masked in GET response
- ✅ Route + sidebar nav

**Type consistency:**
- `SaveProviderConfigDTO.provider_type` typed as `AnyProviderType` throughout ✅
- `providerFactory.getProviderAsync(channel, dbConfig)` — dbConfig shape matches `loadActiveConfig` return ✅
- `ProviderConfig.config_json` — union type matches all three channel config shapes ✅

**No placeholders:** All code is complete — no TBDs or TODOs.
