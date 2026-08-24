# Email Approval System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable one-click approve/reject from email for all HRMS approval workflows using signed tokens, with instant + digest batching.

**Architecture:** Central notification gateway dispatches events to both Work Inbox (in-app) and Email Queue. Token service generates HMAC-signed links (72h expiry). Digest scheduler batches non-critical items into 8 AM / 6 PM IST emails.

**Tech Stack:** TypeScript, Express, MySQL, MJML (email templates), node-cron, crypto (HMAC-SHA256)

## Global Constraints

- All times in IST (Asia/Kolkata timezone)
- Token expiry: 72 hours default
- HMAC algorithm: SHA256
- Email template format: MJML → HTML
- Branding: "MAS Callnet HRMS" (not PeopleOS)
- Rate limit: 10 actions/minute/IP
- Migration files: numbered sequentially after existing max

---

## File Structure

### New Files
```
backend/src/modules/notification-gateway/
├── index.ts                           # Module exports
├── notification-gateway.service.ts    # Central dispatcher
├── notification-gateway.routes.ts     # User preference API  
├── email-queue.service.ts             # Queue CRUD + batching
├── email-token.service.ts             # HMAC token gen/validate
├── email-action.routes.ts             # GET /api/email-actions/:token
├── email-action.service.ts            # Execute approval logic
├── email-renderer.service.ts          # MJML → HTML rendering
├── notification-types.ts              # Type registry (27 types)
├── digest-scheduler.cron.ts           # 8 AM / 6 PM jobs
├── __tests__/
│   ├── email-token.service.test.ts
│   ├── email-queue.service.test.ts
│   ├── email-action.service.test.ts
│   └── notification-gateway.service.test.ts
└── templates/
    ├── instant-approval.mjml
    ├── instant-alert.mjml
    ├── digest-morning.mjml
    ├── digest-evening.mjml
    └── partials/
        ├── header.mjml
        ├── footer.mjml
        └── action-buttons.mjml

backend/sql/
├── XXXX_approval_email_queue.sql
├── XXXX_approval_email_action_log.sql
└── XXXX_notification_preference.sql
```

### Files to Modify
- `backend/src/modules/work-inbox/work-inbox.triggers.ts` — route through gateway
- `backend/src/modules/leaves/leaves.service.ts` — emit status events
- `backend/src/modules/finance/grn.service.ts` — emit GRN events
- `backend/src/app.ts` — mount new routes

---

## Task 1: Database Migrations

**Files:**
- Create: `backend/sql/1700_approval_email_queue.sql`
- Create: `backend/sql/1701_approval_email_action_log.sql`
- Create: `backend/sql/1702_notification_preference.sql`

**Interfaces:**
- Produces: Three MySQL tables (`approval_email_queue`, `approval_email_action_log`, `notification_preference`)

- [ ] **Step 1: Create approval_email_queue migration**

```sql
-- backend/sql/1700_approval_email_queue.sql
-- Email queue for approval notifications with action tokens

CREATE TABLE IF NOT EXISTS approval_email_queue (
  id                CHAR(36) PRIMARY KEY,
  recipient_email   VARCHAR(255) NOT NULL,
  recipient_user_id CHAR(36),
  
  item_type         VARCHAR(50) NOT NULL,
  entity_type       VARCHAR(50) NOT NULL,
  entity_id         CHAR(36) NOT NULL,
  context_json      JSON,
  
  priority          ENUM('critical','standard','info') DEFAULT 'standard',
  digest_batch      DATE,
  
  approve_token     VARCHAR(500),
  reject_token      VARCHAR(500),
  token_expires     DATETIME NOT NULL,
  
  status            ENUM('pending','sent','acted','expired','cancelled') DEFAULT 'pending',
  sent_at           DATETIME,
  acted_at          DATETIME,
  action_taken      ENUM('approved','rejected'),
  
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_recipient (recipient_user_id, status),
  INDEX idx_digest (status, priority, digest_batch),
  INDEX idx_approve_token (approve_token(255)),
  INDEX idx_reject_token (reject_token(255)),
  INDEX idx_entity (entity_type, entity_id),
  INDEX idx_pending_instant (status, priority, digest_batch, created_at)
);
```

- [ ] **Step 2: Create action log migration**

```sql
-- backend/sql/1701_approval_email_action_log.sql
-- Audit log for email-based approval actions

CREATE TABLE IF NOT EXISTS approval_email_action_log (
  id              CHAR(36) PRIMARY KEY,
  email_queue_id  CHAR(36) NOT NULL,
  action          ENUM('approved','rejected') NOT NULL,
  executed_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  client_ip       VARCHAR(45),
  user_agent      VARCHAR(500),
  
  success         TINYINT(1) NOT NULL,
  error_message   VARCHAR(500),
  
  INDEX idx_queue (email_queue_id),
  INDEX idx_executed (executed_at)
);
```

- [ ] **Step 3: Create notification preference migration**

```sql
-- backend/sql/1702_notification_preference.sql
-- User preferences for email notifications

CREATE TABLE IF NOT EXISTS notification_preference (
  user_id           CHAR(36) PRIMARY KEY,
  email_enabled     TINYINT(1) DEFAULT 1,
  digest_time_am    TIME DEFAULT '08:00:00',
  digest_time_pm    TIME DEFAULT '18:00:00',
  instant_override  JSON,
  muted_types       JSON,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

- [ ] **Step 4: Register migrations in manifest**

Add to `backend/sql/MIGRATION_MANIFEST.md`:
```markdown
| 1700 | approval_email_queue | Email queue for approval notifications |
| 1701 | approval_email_action_log | Audit log for email actions |
| 1702 | notification_preference | User notification preferences |
```

- [ ] **Step 5: Verify migrations parse correctly**

Run: `cd backend && npx ts-node src/db/runPendingMigrations.ts --dry-run`
Expected: No SQL syntax errors

- [ ] **Step 6: Commit**

```bash
git add backend/sql/1700_approval_email_queue.sql \
        backend/sql/1701_approval_email_action_log.sql \
        backend/sql/1702_notification_preference.sql
git commit -m "feat(notifications): add email approval queue migrations (1700-1702)"
```

---

## Task 2: Notification Types Registry

**Files:**
- Create: `backend/src/modules/notification-gateway/notification-types.ts`
- Create: `backend/src/modules/notification-gateway/index.ts`

**Interfaces:**
- Produces: `NotificationType`, `NOTIFICATION_REGISTRY`, `getNotificationType(itemType: string)`

- [ ] **Step 1: Create notification types file**

```typescript
// backend/src/modules/notification-gateway/notification-types.ts

export type NotificationCategory = 'approval' | 'alert' | 'status';
export type NotificationPriority = 'critical' | 'standard' | 'info';

export interface NotificationType {
  itemType: string;
  category: NotificationCategory;
  displayName: string;
  subjectTemplate: string;
  recipientRoles: string[];
  defaultPriority: NotificationPriority;
  hasActions: boolean;  // true if approve/reject buttons needed
  entityType: string;
  deeplinkPattern: string;
}

export const NOTIFICATION_REGISTRY: NotificationType[] = [
  // Category A: Approval-Required
  {
    itemType: 'LEAVE_APPROVAL_PENDING',
    category: 'approval',
    displayName: 'Leave Request',
    subjectTemplate: 'Leave Request: {{employee_name}} - {{dates}}',
    recipientRoles: ['manager', 'hr'],
    defaultPriority: 'standard',
    hasActions: true,
    entityType: 'leave_request',
    deeplinkPattern: '/leaves/approvals?id={{entity_id}}',
  },
  {
    itemType: 'GRN_APPROVAL_PENDING',
    category: 'approval',
    displayName: 'GRN Approval',
    subjectTemplate: 'GRN Approval: {{grn_no}} - {{amount}}',
    recipientRoles: ['branch_head', 'finance_head'],
    defaultPriority: 'standard',
    hasActions: true,
    entityType: 'grn_request',
    deeplinkPattern: '/finance/grn?id={{entity_id}}',
  },
  {
    itemType: 'REGULARIZATION_PENDING',
    category: 'approval',
    displayName: 'Attendance Regularization',
    subjectTemplate: 'Attendance Regularization: {{employee_name}}',
    recipientRoles: ['manager', 'hr'],
    defaultPriority: 'standard',
    hasActions: true,
    entityType: 'regularization_request',
    deeplinkPattern: '/attendance-regularization?id={{entity_id}}',
  },
  {
    itemType: 'OFFER_APPROVAL_PENDING',
    category: 'approval',
    displayName: 'Offer Approval',
    subjectTemplate: 'Offer Approval: {{candidate_name}} - {{position}}',
    recipientRoles: ['branch_head'],
    defaultPriority: 'critical',
    hasActions: true,
    entityType: 'candidate',
    deeplinkPattern: '/ats/offer-approvals?candidateId={{entity_id}}',
  },
  {
    itemType: 'RESIGNATION_PENDING_REVIEW',
    category: 'approval',
    displayName: 'Resignation Review',
    subjectTemplate: 'Resignation Review: {{employee_name}}',
    recipientRoles: ['hr'],
    defaultPriority: 'critical',
    hasActions: true,
    entityType: 'exit_request',
    deeplinkPattern: '/exit/resignations?id={{entity_id}}',
  },
  {
    itemType: 'FF_CLEARANCE_PENDING',
    category: 'approval',
    displayName: 'F&F Clearance',
    subjectTemplate: 'F&F Clearance: {{employee_name}} - {{department}}',
    recipientRoles: ['dept_head'],
    defaultPriority: 'critical',
    hasActions: true,
    entityType: 'ff_clearance',
    deeplinkPattern: '/exit/ff-clearance?id={{entity_id}}',
  },
  {
    itemType: 'PAYROLL_SIGN_OFF_PENDING',
    category: 'approval',
    displayName: 'Payroll Sign-off',
    subjectTemplate: 'Payroll Sign-off: {{branch}} - {{month}}',
    recipientRoles: ['finance_head'],
    defaultPriority: 'critical',
    hasActions: true,
    entityType: 'payroll_run',
    deeplinkPattern: '/payroll/sign-off?runId={{entity_id}}',
  },
  {
    itemType: 'INCENTIVE_APPROVAL',
    category: 'approval',
    displayName: 'Incentive Approval',
    subjectTemplate: 'Incentive Batch: {{batch_ref}} - {{amount}}',
    recipientRoles: ['approver'],
    defaultPriority: 'standard',
    hasActions: true,
    entityType: 'incentive_batch',
    deeplinkPattern: '/payroll/incentives?batchId={{entity_id}}',
  },
  {
    itemType: 'IMPREST_ALLOCATION_PENDING',
    category: 'approval',
    displayName: 'Imprest Allocation',
    subjectTemplate: 'Imprest Topup: {{holder_name}} - {{amount}}',
    recipientRoles: ['finance_head'],
    defaultPriority: 'standard',
    hasActions: true,
    entityType: 'imprest_allocation',
    deeplinkPattern: '/finance/grn?tab=imprest&id={{entity_id}}',
  },
  {
    itemType: 'EXIT_PASS_APPROVAL',
    category: 'approval',
    displayName: 'Exit Pass',
    subjectTemplate: 'Exit Pass: {{employee_name}} - {{asset_count}} assets',
    recipientRoles: ['branch_head'],
    defaultPriority: 'critical',
    hasActions: true,
    entityType: 'exit_pass',
    deeplinkPattern: '/assets/exit-pass?id={{entity_id}}',
  },
  // Category B: Alerts (all instant, no actions)
  {
    itemType: 'ONBOARDING_STUCK',
    category: 'alert',
    displayName: 'Onboarding Stuck',
    subjectTemplate: 'Onboarding Stuck: {{candidate_name}} - {{days}} days',
    recipientRoles: ['hr', 'recruitment_hr'],
    defaultPriority: 'critical',
    hasActions: false,
    entityType: 'candidate',
    deeplinkPattern: '/ats/onboarding-requests?candidateId={{entity_id}}',
  },
  {
    itemType: 'AWOL_SUSPECTED',
    category: 'alert',
    displayName: 'AWOL Alert',
    subjectTemplate: 'AWOL Alert: {{employee_name}} - {{absent_days}} days',
    recipientRoles: ['hr', 'branch_head'],
    defaultPriority: 'critical',
    hasActions: false,
    entityType: 'employee',
    deeplinkPattern: '/employees/{{entity_id}}/360',
  },
  {
    itemType: 'TAT_BREACH',
    category: 'alert',
    displayName: 'TAT Breach',
    subjectTemplate: 'TAT Breach: {{task_type}}',
    recipientRoles: ['admin'],
    defaultPriority: 'critical',
    hasActions: false,
    entityType: 'tat_instance',
    deeplinkPattern: '/governance/tat?id={{entity_id}}',
  },
  // Category C: Status Updates (evening digest, no actions)
  {
    itemType: 'LEAVE_APPROVED',
    category: 'status',
    displayName: 'Leave Approved',
    subjectTemplate: 'Leave Approved: {{dates}}',
    recipientRoles: ['employee'],
    defaultPriority: 'info',
    hasActions: false,
    entityType: 'leave_request',
    deeplinkPattern: '/leaves/my-requests?id={{entity_id}}',
  },
  {
    itemType: 'LEAVE_REJECTED',
    category: 'status',
    displayName: 'Leave Rejected',
    subjectTemplate: 'Leave Rejected: {{dates}}',
    recipientRoles: ['employee'],
    defaultPriority: 'info',
    hasActions: false,
    entityType: 'leave_request',
    deeplinkPattern: '/leaves/my-requests?id={{entity_id}}',
  },
  {
    itemType: 'GRN_APPROVED',
    category: 'status',
    displayName: 'GRN Approved',
    subjectTemplate: 'GRN Approved: {{grn_no}}',
    recipientRoles: ['requester'],
    defaultPriority: 'info',
    hasActions: false,
    entityType: 'grn_request',
    deeplinkPattern: '/finance/grn?id={{entity_id}}',
  },
  {
    itemType: 'GRN_REJECTED',
    category: 'status',
    displayName: 'GRN Rejected',
    subjectTemplate: 'GRN Rejected: {{grn_no}}',
    recipientRoles: ['requester'],
    defaultPriority: 'info',
    hasActions: false,
    entityType: 'grn_request',
    deeplinkPattern: '/finance/grn?id={{entity_id}}',
  },
];

const REGISTRY_MAP = new Map(NOTIFICATION_REGISTRY.map(t => [t.itemType, t]));

export function getNotificationType(itemType: string): NotificationType | undefined {
  return REGISTRY_MAP.get(itemType);
}

export function isInstantPriority(type: NotificationType, context?: Record<string, unknown>): boolean {
  if (type.defaultPriority === 'critical') return true;
  if (type.category === 'alert') return true;
  
  // Leave within 24h → instant
  if (type.itemType === 'LEAVE_APPROVAL_PENDING' && context?.start_date) {
    const start = new Date(context.start_date as string);
    const now = new Date();
    const hoursUntilStart = (start.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursUntilStart < 24) return true;
  }
  
  // GRN > 50k → instant
  if (type.itemType === 'GRN_APPROVAL_PENDING' && context?.amount) {
    if (Number(context.amount) > 50000) return true;
  }
  
  return false;
}
```

- [ ] **Step 2: Create module index**

```typescript
// backend/src/modules/notification-gateway/index.ts

export * from './notification-types.js';
export * from './email-token.service.js';
export * from './email-queue.service.js';
export * from './notification-gateway.service.js';
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/notification-gateway/notification-types.ts \
        backend/src/modules/notification-gateway/index.ts
git commit -m "feat(notifications): add notification type registry with 17 types"
```

---

## Task 3: Email Token Service

**Files:**
- Create: `backend/src/modules/notification-gateway/email-token.service.ts`
- Create: `backend/src/modules/notification-gateway/__tests__/email-token.service.test.ts`

**Interfaces:**
- Produces: `generateToken(payload)`, `validateToken(token)`, `TokenPayload` type

- [ ] **Step 1: Write failing test for token generation**

```typescript
// backend/src/modules/notification-gateway/__tests__/email-token.service.test.ts

import { describe, it, expect, beforeAll } from 'vitest';
import { generateToken, validateToken, TokenPayload } from '../email-token.service.js';

describe('email-token.service', () => {
  const testPayload: TokenPayload = {
    qid: '550d3124-ab1c-4023-9e8d-3c85fa678021',
    eid: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
    typ: 'leave_request',
    act: 'approve',
    uid: '98765432-10fe-dcba-9876-543210fedcba',
  };

  describe('generateToken', () => {
    it('generates a token with payload and signature', () => {
      const token = generateToken(testPayload, 72);
      expect(token).toBeDefined();
      expect(token.split('.').length).toBe(2);
    });

    it('includes expiry timestamp in generated token', () => {
      const token = generateToken(testPayload, 72);
      const result = validateToken(token);
      expect(result.valid).toBe(true);
      expect(result.payload?.exp).toBeGreaterThan(Date.now() / 1000);
    });
  });

  describe('validateToken', () => {
    it('validates a correctly signed token', () => {
      const token = generateToken(testPayload, 72);
      const result = validateToken(token);
      expect(result.valid).toBe(true);
      expect(result.payload?.qid).toBe(testPayload.qid);
      expect(result.payload?.act).toBe('approve');
    });

    it('rejects expired token', () => {
      const token = generateToken(testPayload, -1); // already expired
      const result = validateToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('TOKEN_EXPIRED');
    });

    it('rejects tampered token', () => {
      const token = generateToken(testPayload, 72);
      const tampered = token.slice(0, -5) + 'XXXXX';
      const result = validateToken(tampered);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_SIGNATURE');
    });

    it('rejects malformed token', () => {
      const result = validateToken('not-a-valid-token');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('MALFORMED_TOKEN');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/notification-gateway/__tests__/email-token.service.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement token service**

```typescript
// backend/src/modules/notification-gateway/email-token.service.ts

import { createHmac } from 'crypto';

const SECRET = process.env.EMAIL_ACTION_SECRET || 'dev-secret-change-in-production';

export interface TokenPayload {
  qid: string;  // email queue id
  eid: string;  // entity id
  typ: string;  // entity type
  act: 'approve' | 'reject';
  uid: string;  // approver user id
  exp?: number; // expiry timestamp (added during generation)
}

export interface TokenValidationResult {
  valid: boolean;
  payload?: TokenPayload;
  error?: 'TOKEN_EXPIRED' | 'INVALID_SIGNATURE' | 'MALFORMED_TOKEN';
}

function base64urlEncode(data: string): string {
  return Buffer.from(data, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(data: string): string {
  const padded = data + '==='.slice(0, (4 - (data.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

export function generateToken(payload: TokenPayload, expiryHours: number): string {
  const exp = Math.floor(Date.now() / 1000) + expiryHours * 60 * 60;
  const fullPayload = { ...payload, exp };
  const payloadStr = base64urlEncode(JSON.stringify(fullPayload));
  const signature = sign(payloadStr);
  return `${payloadStr}.${signature}`;
}

export function validateToken(token: string): TokenValidationResult {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'MALFORMED_TOKEN' };
  }

  const [payloadStr, signature] = parts;

  // Verify signature
  const expectedSig = sign(payloadStr);
  if (signature !== expectedSig) {
    return { valid: false, error: 'INVALID_SIGNATURE' };
  }

  // Decode payload
  let payload: TokenPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadStr));
  } catch {
    return { valid: false, error: 'MALFORMED_TOKEN' };
  }

  // Check expiry
  if (!payload.exp || payload.exp < Date.now() / 1000) {
    return { valid: false, error: 'TOKEN_EXPIRED' };
  }

  return { valid: true, payload };
}

export function getTokenExpiry(expiryHours: number): Date {
  return new Date(Date.now() + expiryHours * 60 * 60 * 1000);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/notification-gateway/__tests__/email-token.service.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/notification-gateway/email-token.service.ts \
        backend/src/modules/notification-gateway/__tests__/email-token.service.test.ts
git commit -m "feat(notifications): add HMAC token service for email actions"
```

---

## Task 4: Email Queue Service

**Files:**
- Create: `backend/src/modules/notification-gateway/email-queue.service.ts`
- Create: `backend/src/modules/notification-gateway/__tests__/email-queue.service.test.ts`

**Interfaces:**
- Consumes: `generateToken()` from Task 3
- Produces: `enqueue(params)`, `markSent(id)`, `markActed(id, action)`, `getPendingInstant()`, `getPendingDigest(date)`

- [ ] **Step 1: Write failing test**

```typescript
// backend/src/modules/notification-gateway/__tests__/email-queue.service.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the database
vi.mock('../../../db/mysql.js', () => ({
  db: {
    execute: vi.fn(),
    query: vi.fn(),
  },
}));

import { emailQueueService } from '../email-queue.service.js';
import { db } from '../../../db/mysql.js';

describe('email-queue.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('enqueue', () => {
    it('creates queue entry with tokens for approval items', async () => {
      const mockExecute = vi.mocked(db.execute);
      mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const result = await emailQueueService.enqueue({
        recipientEmail: 'approver@test.com',
        recipientUserId: 'user-123',
        itemType: 'LEAVE_APPROVAL_PENDING',
        entityType: 'leave_request',
        entityId: 'leave-456',
        context: { employee_name: 'John Doe', dates: '26-27 Aug' },
        priority: 'standard',
      });

      expect(result.id).toBeDefined();
      expect(result.approveToken).toBeDefined();
      expect(result.rejectToken).toBeDefined();
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('sets digest_batch to NULL for critical priority', async () => {
      const mockExecute = vi.mocked(db.execute);
      mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      await emailQueueService.enqueue({
        recipientEmail: 'approver@test.com',
        recipientUserId: 'user-123',
        itemType: 'AWOL_SUSPECTED',
        entityType: 'employee',
        entityId: 'emp-789',
        context: {},
        priority: 'critical',
      });

      const callArgs = mockExecute.mock.calls[0];
      expect(callArgs[1]).toContain(null); // digest_batch should be null
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/notification-gateway/__tests__/email-queue.service.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement email queue service**

```typescript
// backend/src/modules/notification-gateway/email-queue.service.ts

import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../../db/mysql.js';
import { generateToken, getTokenExpiry } from './email-token.service.js';
import { getNotificationType } from './notification-types.js';

const DEFAULT_EXPIRY_HOURS = Number(process.env.EMAIL_ACTION_EXPIRY_HOURS) || 72;

export interface EnqueueParams {
  recipientEmail: string;
  recipientUserId: string;
  itemType: string;
  entityType: string;
  entityId: string;
  context: Record<string, unknown>;
  priority: 'critical' | 'standard' | 'info';
  digestBatch?: Date | null;
}

export interface QueueEntry {
  id: string;
  approveToken: string | null;
  rejectToken: string | null;
  tokenExpires: Date;
}

export interface PendingEmail {
  id: string;
  recipient_email: string;
  recipient_user_id: string;
  item_type: string;
  entity_type: string;
  entity_id: string;
  context_json: string;
  priority: string;
  approve_token: string | null;
  reject_token: string | null;
  token_expires: Date;
  created_at: Date;
}

export const emailQueueService = {
  async enqueue(params: EnqueueParams): Promise<QueueEntry> {
    const id = randomUUID();
    const tokenExpires = getTokenExpiry(DEFAULT_EXPIRY_HOURS);
    
    const notifType = getNotificationType(params.itemType);
    const hasActions = notifType?.hasActions ?? false;

    let approveToken: string | null = null;
    let rejectToken: string | null = null;

    if (hasActions) {
      approveToken = generateToken({
        qid: id,
        eid: params.entityId,
        typ: params.entityType,
        act: 'approve',
        uid: params.recipientUserId,
      }, DEFAULT_EXPIRY_HOURS);

      rejectToken = generateToken({
        qid: id,
        eid: params.entityId,
        typ: params.entityType,
        act: 'reject',
        uid: params.recipientUserId,
      }, DEFAULT_EXPIRY_HOURS);
    }

    // Critical and alert items have NULL digest_batch (instant send)
    const digestBatch = params.priority === 'critical' ? null : 
                        params.digestBatch ?? new Date();

    await db.execute(
      `INSERT INTO approval_email_queue 
       (id, recipient_email, recipient_user_id, item_type, entity_type, entity_id,
        context_json, priority, digest_batch, approve_token, reject_token, 
        token_expires, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [
        id,
        params.recipientEmail,
        params.recipientUserId,
        params.itemType,
        params.entityType,
        params.entityId,
        JSON.stringify(params.context),
        params.priority,
        digestBatch,
        approveToken,
        rejectToken,
        tokenExpires,
      ]
    );

    return { id, approveToken, rejectToken, tokenExpires };
  },

  async getPendingInstant(): Promise<PendingEmail[]> {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM approval_email_queue 
       WHERE status = 'pending' 
         AND digest_batch IS NULL
       ORDER BY created_at ASC
       LIMIT 100`
    );
    return rows as PendingEmail[];
  },

  async getPendingDigest(batchDate: Date, priority: 'standard' | 'info'): Promise<PendingEmail[]> {
    const dateStr = batchDate.toISOString().slice(0, 10);
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM approval_email_queue 
       WHERE status = 'pending' 
         AND digest_batch = ?
         AND priority = ?
       ORDER BY item_type, created_at ASC`,
      [dateStr, priority]
    );
    return rows as PendingEmail[];
  },

  async markSent(id: string): Promise<void> {
    await db.execute(
      `UPDATE approval_email_queue SET status = 'sent', sent_at = NOW() WHERE id = ?`,
      [id]
    );
  },

  async markActed(id: string, action: 'approved' | 'rejected'): Promise<void> {
    await db.execute(
      `UPDATE approval_email_queue 
       SET status = 'acted', acted_at = NOW(), action_taken = ? 
       WHERE id = ?`,
      [action, id]
    );
  },

  async markExpired(): Promise<number> {
    const [result] = await db.execute(
      `UPDATE approval_email_queue 
       SET status = 'expired' 
       WHERE status IN ('pending', 'sent') 
         AND token_expires < NOW()`
    );
    return (result as any).affectedRows;
  },

  async getByToken(token: string): Promise<PendingEmail | null> {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM approval_email_queue 
       WHERE (approve_token = ? OR reject_token = ?)
       LIMIT 1`,
      [token, token]
    );
    return (rows[0] as PendingEmail) ?? null;
  },

  async cancelForEntity(entityType: string, entityId: string): Promise<void> {
    await db.execute(
      `UPDATE approval_email_queue 
       SET status = 'cancelled' 
       WHERE entity_type = ? AND entity_id = ? AND status = 'pending'`,
      [entityType, entityId]
    );
  },
};
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx vitest run src/modules/notification-gateway/__tests__/email-queue.service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/notification-gateway/email-queue.service.ts \
        backend/src/modules/notification-gateway/__tests__/email-queue.service.test.ts
git commit -m "feat(notifications): add email queue service with token generation"
```

---

## Task 5: MJML Email Templates

**Files:**
- Create: `backend/src/modules/notification-gateway/templates/partials/header.mjml`
- Create: `backend/src/modules/notification-gateway/templates/partials/footer.mjml`
- Create: `backend/src/modules/notification-gateway/templates/partials/action-buttons.mjml`
- Create: `backend/src/modules/notification-gateway/templates/instant-approval.mjml`
- Create: `backend/src/modules/notification-gateway/templates/instant-alert.mjml`
- Create: `backend/src/modules/notification-gateway/templates/digest-morning.mjml`

**Interfaces:**
- Produces: MJML template files for email rendering

- [ ] **Step 1: Create header partial**

```xml
<!-- backend/src/modules/notification-gateway/templates/partials/header.mjml -->
<mj-section background-color="#FFFFFF" padding="20px 30px">
  <mj-column>
    <mj-image 
      src="https://mcnhrms.teammas.in/logo.png" 
      alt="MAS Callnet" 
      width="150px"
      align="left"
    />
  </mj-column>
</mj-section>
<mj-section background-color="#2563EB" padding="15px 30px">
  <mj-column>
    <mj-text 
      color="#FFFFFF" 
      font-size="18px" 
      font-weight="600"
      font-family="Arial, Helvetica, sans-serif"
    >
      {{subject}}
    </mj-text>
  </mj-column>
</mj-section>
```

- [ ] **Step 2: Create footer partial**

```xml
<!-- backend/src/modules/notification-gateway/templates/partials/footer.mjml -->
<mj-section background-color="#F3F4F6" padding="20px 30px">
  <mj-column>
    <mj-text 
      color="#6B7280" 
      font-size="12px"
      font-family="Arial, Helvetica, sans-serif"
      align="center"
    >
      {{#if token_expires}}
      This link expires in 72 hours.<br/>
      {{/if}}
      <strong>Do not forward this email</strong> — action links are personalized to you.
    </mj-text>
    <mj-divider border-color="#E5E7EB" padding="10px 0" />
    <mj-text 
      color="#9CA3AF" 
      font-size="11px"
      font-family="Arial, Helvetica, sans-serif"
      align="center"
    >
      MAS Callnet HRMS<br/>
      This is an automated notification. Please do not reply to this email.
    </mj-text>
  </mj-column>
</mj-section>
```

- [ ] **Step 3: Create action buttons partial**

```xml
<!-- backend/src/modules/notification-gateway/templates/partials/action-buttons.mjml -->
<mj-section padding="20px 30px">
  <mj-column width="50%">
    <mj-button 
      href="{{approve_url}}"
      background-color="#16A34A"
      color="#FFFFFF"
      font-size="14px"
      font-weight="600"
      border-radius="6px"
      padding="12px 24px"
      font-family="Arial, Helvetica, sans-serif"
    >
      ✓ APPROVE
    </mj-button>
  </mj-column>
  <mj-column width="50%">
    <mj-button 
      href="{{reject_url}}"
      background-color="#DC2626"
      color="#FFFFFF"
      font-size="14px"
      font-weight="600"
      border-radius="6px"
      padding="12px 24px"
      font-family="Arial, Helvetica, sans-serif"
    >
      ✗ REJECT
    </mj-button>
  </mj-column>
</mj-section>
```

- [ ] **Step 4: Create instant approval template**

```xml
<!-- backend/src/modules/notification-gateway/templates/instant-approval.mjml -->
<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Arial, Helvetica, sans-serif" />
      <mj-text font-size="14px" color="#1F2937" line-height="1.5" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#F9FAFB">
    <mj-include path="./partials/header.mjml" />
    
    <mj-section background-color="#FFFFFF" padding="30px">
      <mj-column>
        <mj-text font-size="16px">
          Hi {{approver_name}},
        </mj-text>
        <mj-text padding-top="10px">
          {{intro_text}}
        </mj-text>
      </mj-column>
    </mj-section>

    <mj-section background-color="#FFFFFF" padding="0 30px 20px">
      <mj-column background-color="#F9FAFB" border-radius="8px" padding="20px">
        <mj-text font-weight="600" font-size="12px" color="#6B7280" text-transform="uppercase">
          {{detail_title}}
        </mj-text>
        <mj-divider border-color="#E5E7EB" padding="10px 0" />
        {{#each details}}
        <mj-text padding="5px 0">
          <span style="color: #6B7280; min-width: 120px; display: inline-block;">{{this.label}}</span>
          <strong>{{this.value}}</strong>
        </mj-text>
        {{/each}}
      </mj-column>
    </mj-section>

    {{#if has_actions}}
    <mj-include path="./partials/action-buttons.mjml" />
    {{/if}}

    <mj-section background-color="#FFFFFF" padding="10px 30px 30px">
      <mj-column>
        <mj-text align="center" color="#6B7280" font-size="13px">
          Or review in HRMS: 
          <a href="{{deeplink_url}}" style="color: #2563EB;">View in HRMS →</a>
        </mj-text>
      </mj-column>
    </mj-section>

    <mj-include path="./partials/footer.mjml" />
  </mj-body>
</mjml>
```

- [ ] **Step 5: Create instant alert template**

```xml
<!-- backend/src/modules/notification-gateway/templates/instant-alert.mjml -->
<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Arial, Helvetica, sans-serif" />
      <mj-text font-size="14px" color="#1F2937" line-height="1.5" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#F9FAFB">
    <mj-section background-color="#FFFFFF" padding="20px 30px">
      <mj-column>
        <mj-image 
          src="https://mcnhrms.teammas.in/logo.png" 
          alt="MAS Callnet" 
          width="150px"
          align="left"
        />
      </mj-column>
    </mj-section>
    <mj-section background-color="#DC2626" padding="15px 30px">
      <mj-column>
        <mj-text 
          color="#FFFFFF" 
          font-size="18px" 
          font-weight="600"
        >
          ⚠️ {{subject}}
        </mj-text>
      </mj-column>
    </mj-section>
    
    <mj-section background-color="#FFFFFF" padding="30px">
      <mj-column>
        <mj-text font-size="16px">
          Hi {{recipient_name}},
        </mj-text>
        <mj-text padding-top="10px">
          {{alert_message}}
        </mj-text>
      </mj-column>
    </mj-section>

    <mj-section background-color="#FFFFFF" padding="0 30px 20px">
      <mj-column background-color="#FEF2F2" border="1px solid #FECACA" border-radius="8px" padding="20px">
        {{#each details}}
        <mj-text padding="5px 0">
          <span style="color: #6B7280;">{{this.label}}:</span>
          <strong>{{this.value}}</strong>
        </mj-text>
        {{/each}}
      </mj-column>
    </mj-section>

    <mj-section background-color="#FFFFFF" padding="20px 30px">
      <mj-column>
        <mj-button 
          href="{{deeplink_url}}"
          background-color="#2563EB"
          color="#FFFFFF"
          font-size="14px"
          font-weight="600"
          border-radius="6px"
          padding="12px 24px"
        >
          View in HRMS →
        </mj-button>
      </mj-column>
    </mj-section>

    <mj-section background-color="#F3F4F6" padding="20px 30px">
      <mj-column>
        <mj-text color="#9CA3AF" font-size="11px" align="center">
          MAS Callnet HRMS • This is an automated alert
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
```

- [ ] **Step 6: Commit templates**

```bash
git add backend/src/modules/notification-gateway/templates/
git commit -m "feat(notifications): add MJML email templates (approval, alert)"
```

---

## Task 6: Email Renderer Service

**Files:**
- Create: `backend/src/modules/notification-gateway/email-renderer.service.ts`

**Interfaces:**
- Consumes: MJML templates from Task 5
- Produces: `renderInstantApproval(context)`, `renderInstantAlert(context)`, `renderDigest(items)`

- [ ] **Step 1: Install MJML dependency**

Run: `cd backend && npm install mjml handlebars`

- [ ] **Step 2: Create email renderer service**

```typescript
// backend/src/modules/notification-gateway/email-renderer.service.ts

import mjml2html from 'mjml';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getNotificationType } from './notification-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, 'templates');
const BASE_URL = process.env.FRONTEND_URL || 'https://mcnhrms.teammas.in';
const ACTION_URL = process.env.BACKEND_URL || 'https://mcnhrms.teammas.in/api';

function loadTemplate(name: string): string {
  return readFileSync(join(TEMPLATES_DIR, name), 'utf-8');
}

function compileTemplate(mjmlContent: string): (context: any) => string {
  // First compile MJML to HTML
  const { html } = mjml2html(mjmlContent, {
    filePath: TEMPLATES_DIR,
    mjmlConfigPath: undefined,
  });
  // Then compile HTML with Handlebars
  return Handlebars.compile(html);
}

// Pre-compile templates
const templates = {
  instantApproval: compileTemplate(loadTemplate('instant-approval.mjml')),
  instantAlert: compileTemplate(loadTemplate('instant-alert.mjml')),
};

export interface ApprovalEmailContext {
  approverName: string;
  subject: string;
  introText: string;
  detailTitle: string;
  details: Array<{ label: string; value: string }>;
  approveToken: string | null;
  rejectToken: string | null;
  deeplinkUrl: string;
  hasActions: boolean;
}

export interface AlertEmailContext {
  recipientName: string;
  subject: string;
  alertMessage: string;
  details: Array<{ label: string; value: string }>;
  deeplinkUrl: string;
}

function buildApproveUrl(token: string): string {
  return `${ACTION_URL}/email-actions/${encodeURIComponent(token)}?action=approve`;
}

function buildRejectUrl(token: string): string {
  return `${ACTION_URL}/email-actions/${encodeURIComponent(token)}?action=reject`;
}

function buildDeeplinkUrl(pattern: string, entityId: string): string {
  return BASE_URL + pattern.replace('{{entity_id}}', entityId);
}

export const emailRendererService = {
  renderInstantApproval(ctx: ApprovalEmailContext): string {
    return templates.instantApproval({
      approver_name: ctx.approverName,
      subject: ctx.subject,
      intro_text: ctx.introText,
      detail_title: ctx.detailTitle,
      details: ctx.details,
      has_actions: ctx.hasActions,
      approve_url: ctx.approveToken ? buildApproveUrl(ctx.approveToken) : null,
      reject_url: ctx.rejectToken ? buildRejectUrl(ctx.rejectToken) : null,
      deeplink_url: ctx.deeplinkUrl,
      token_expires: ctx.hasActions,
    });
  },

  renderInstantAlert(ctx: AlertEmailContext): string {
    return templates.instantAlert({
      recipient_name: ctx.recipientName,
      subject: ctx.subject,
      alert_message: ctx.alertMessage,
      details: ctx.details,
      deeplink_url: ctx.deeplinkUrl,
    });
  },

  buildEmailContext(
    itemType: string,
    entityId: string,
    rawContext: Record<string, unknown>,
    approverName: string,
    approveToken: string | null,
    rejectToken: string | null
  ): ApprovalEmailContext | AlertEmailContext {
    const notifType = getNotificationType(itemType);
    if (!notifType) {
      throw new Error(`Unknown notification type: ${itemType}`);
    }

    const deeplinkUrl = buildDeeplinkUrl(notifType.deeplinkPattern, entityId);

    // Render subject with context
    const subject = notifType.subjectTemplate.replace(
      /\{\{(\w+)\}\}/g,
      (_, key) => String(rawContext[key] ?? '')
    );

    if (notifType.category === 'alert') {
      return {
        recipientName: approverName,
        subject,
        alertMessage: `This requires your immediate attention.`,
        details: Object.entries(rawContext)
          .filter(([k]) => !k.startsWith('_'))
          .map(([label, value]) => ({
            label: label.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            value: String(value),
          })),
        deeplinkUrl,
      } as AlertEmailContext;
    }

    return {
      approverName,
      subject,
      introText: `A ${notifType.displayName.toLowerCase()} needs your approval.`,
      detailTitle: `${notifType.displayName.toUpperCase()} DETAILS`,
      details: Object.entries(rawContext)
        .filter(([k]) => !k.startsWith('_'))
        .map(([label, value]) => ({
          label: label.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          value: String(value),
        })),
      approveToken,
      rejectToken,
      deeplinkUrl,
      hasActions: notifType.hasActions,
    } as ApprovalEmailContext;
  },
};
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/notification-gateway/email-renderer.service.ts
git commit -m "feat(notifications): add MJML email renderer service"
```

---

## Task 7: Email Action Routes

**Files:**
- Create: `backend/src/modules/notification-gateway/email-action.service.ts`
- Create: `backend/src/modules/notification-gateway/email-action.routes.ts`

**Interfaces:**
- Consumes: `validateToken()` from Task 3, `emailQueueService` from Task 4
- Produces: `GET /api/email-actions/:token` route

- [ ] **Step 1: Create action service**

```typescript
// backend/src/modules/notification-gateway/email-action.service.ts

import { db } from '../../db/mysql.js';
import { randomUUID } from 'crypto';
import { validateToken } from './email-token.service.js';
import { emailQueueService } from './email-queue.service.js';

export type ActionResult = 
  | { success: true; message: string; entityType: string; entityId: string }
  | { success: false; error: string; code: string };

export const emailActionService = {
  async executeAction(
    token: string,
    clientIp: string,
    userAgent: string
  ): Promise<ActionResult> {
    // 1. Validate token
    const validation = validateToken(token);
    if (!validation.valid || !validation.payload) {
      return {
        success: false,
        error: this.getErrorMessage(validation.error!),
        code: validation.error!,
      };
    }

    const { qid, eid, typ, act, uid } = validation.payload;

    // 2. Get queue entry
    const queueEntry = await emailQueueService.getByToken(token);
    if (!queueEntry) {
      return {
        success: false,
        error: 'This request no longer exists or was cancelled.',
        code: 'NOT_FOUND',
      };
    }

    // 3. Check if already acted
    if (queueEntry.status === 'acted') {
      const actionDate = queueEntry.acted_at 
        ? new Date(queueEntry.acted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        : 'earlier';
      return {
        success: false,
        error: `This request was already ${queueEntry.action_taken} on ${actionDate}.`,
        code: 'ALREADY_ACTED',
      };
    }

    // 4. Execute the actual approval/rejection in the target module
    const action = act as 'approve' | 'reject';
    try {
      await this.executeInTargetModule(typ, eid, action, uid);
    } catch (err: any) {
      // Log failure
      await this.logAction(qid, action, clientIp, userAgent, false, err.message);
      return {
        success: false,
        error: err.message || 'Failed to execute action.',
        code: 'EXECUTION_FAILED',
      };
    }

    // 5. Mark as acted
    await emailQueueService.markActed(qid, action === 'approve' ? 'approved' : 'rejected');

    // 6. Log success
    await this.logAction(qid, action === 'approve' ? 'approved' : 'rejected', clientIp, userAgent, true, null);

    return {
      success: true,
      message: `Request ${action}d successfully.`,
      entityType: typ,
      entityId: eid,
    };
  },

  async executeInTargetModule(
    entityType: string,
    entityId: string,
    action: 'approve' | 'reject',
    userId: string
  ): Promise<void> {
    // This will be expanded per entity type
    // For now, delegate to existing approval services
    switch (entityType) {
      case 'leave_request':
        await this.approveLeave(entityId, action, userId);
        break;
      case 'grn_request':
        await this.approveGrn(entityId, action, userId);
        break;
      case 'regularization_request':
        await this.approveRegularization(entityId, action, userId);
        break;
      default:
        throw new Error(`Unsupported entity type: ${entityType}`);
    }
  },

  async approveLeave(leaveId: string, action: 'approve' | 'reject', userId: string): Promise<void> {
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await db.execute(
      `UPDATE leave_request 
       SET status = ?, reviewed_by = ?, reviewed_at = NOW() 
       WHERE id = ? AND status = 'pending'`,
      [newStatus, userId, leaveId]
    );
  },

  async approveGrn(grnId: string, action: 'approve' | 'reject', userId: string): Promise<void> {
    // GRN has multi-stage approval - this is simplified
    const newStatus = action === 'approve' ? 'branch_head_approved' : 'rejected';
    await db.execute(
      `UPDATE grn_request 
       SET current_status = ?, branch_head_action_by = ?, branch_head_action_at = NOW() 
       WHERE id = ? AND current_status = 'pending_branch_head'`,
      [newStatus, userId, grnId]
    );
  },

  async approveRegularization(regId: string, action: 'approve' | 'reject', userId: string): Promise<void> {
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await db.execute(
      `UPDATE regularization_request 
       SET status = ?, reviewed_by = ?, reviewed_at = NOW() 
       WHERE id = ? AND status = 'pending'`,
      [newStatus, userId, regId]
    );
  },

  async logAction(
    queueId: string,
    action: 'approved' | 'rejected',
    clientIp: string,
    userAgent: string,
    success: boolean,
    errorMessage: string | null
  ): Promise<void> {
    await db.execute(
      `INSERT INTO approval_email_action_log 
       (id, email_queue_id, action, executed_at, client_ip, user_agent, success, error_message)
       VALUES (?, ?, ?, NOW(), ?, ?, ?, ?)`,
      [randomUUID(), queueId, action, clientIp, userAgent, success ? 1 : 0, errorMessage]
    );
  },

  getErrorMessage(code: string): string {
    const messages: Record<string, string> = {
      TOKEN_EXPIRED: 'This link has expired. Please review the request in HRMS.',
      INVALID_SIGNATURE: 'This link is invalid or has been tampered with.',
      MALFORMED_TOKEN: 'This link is invalid.',
    };
    return messages[code] || 'An error occurred processing your request.';
  },
};
```

- [ ] **Step 2: Create action routes**

```typescript
// backend/src/modules/notification-gateway/email-action.routes.ts

import { Router, Request, Response } from 'express';
import { emailActionService } from './email-action.service.js';

const router = Router();

// HTML response pages
const successHtml = (message: string, entityType: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Action Complete - MAS Callnet HRMS</title>
  <style>
    body { font-family: Arial, sans-serif; background: #F9FAFB; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: white; padding: 48px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
    .icon { width: 64px; height: 64px; background: #16A34A; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
    .icon svg { width: 32px; height: 32px; color: white; }
    h1 { color: #1F2937; font-size: 24px; margin: 0 0 12px; }
    p { color: #6B7280; font-size: 16px; margin: 0 0 24px; }
    a { display: inline-block; background: #2563EB; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; }
    a:hover { background: #1D4ED8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
    </div>
    <h1>Success!</h1>
    <p>${message}</p>
    <a href="https://mcnhrms.teammas.in">Open HRMS</a>
  </div>
</body>
</html>
`;

const errorHtml = (message: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Action Failed - MAS Callnet HRMS</title>
  <style>
    body { font-family: Arial, sans-serif; background: #F9FAFB; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: white; padding: 48px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
    .icon { width: 64px; height: 64px; background: #DC2626; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
    .icon svg { width: 32px; height: 32px; color: white; }
    h1 { color: #1F2937; font-size: 24px; margin: 0 0 12px; }
    p { color: #6B7280; font-size: 16px; margin: 0 0 24px; }
    a { display: inline-block; background: #2563EB; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; }
    a:hover { background: #1D4ED8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
    </div>
    <h1>Action Failed</h1>
    <p>${message}</p>
    <a href="https://mcnhrms.teammas.in">Open HRMS</a>
  </div>
</body>
</html>
`;

// GET /api/email-actions/:token - execute action from email link
router.get('/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  const clientIp = req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  const result = await emailActionService.executeAction(token, clientIp, userAgent);

  if (result.success) {
    res.status(200).send(successHtml(result.message, result.entityType));
  } else {
    res.status(400).send(errorHtml(result.error));
  }
});

export default router;
```

- [ ] **Step 3: Mount routes in app.ts**

In `backend/src/app.ts`, add:
```typescript
import emailActionRoutes from './modules/notification-gateway/email-action.routes.js';

// ... after other routes
app.use('/api/email-actions', emailActionRoutes);
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/notification-gateway/email-action.service.ts \
        backend/src/modules/notification-gateway/email-action.routes.ts \
        backend/src/app.ts
git commit -m "feat(notifications): add email action execution routes"
```

---

## Task 8: Notification Gateway Service

**Files:**
- Create: `backend/src/modules/notification-gateway/notification-gateway.service.ts`

**Interfaces:**
- Consumes: `emailQueueService` from Task 4, work-inbox triggers
- Produces: `notifyApprovers(event)`, `notifyUser(event)`, central dispatch for all notifications

- [ ] **Step 1: Create notification gateway service**

```typescript
// backend/src/modules/notification-gateway/notification-gateway.service.ts

import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../../db/mysql.js';
import { emailQueueService } from './email-queue.service.js';
import { getNotificationType, isInstantPriority } from './notification-types.js';
import { workInboxService } from '../work-inbox/work-inbox.service.js';

export interface NotificationEvent {
  itemType: string;
  entityType: string;
  entityId: string;
  context: Record<string, unknown>;
  targetUserId?: string;
  targetRoleKey?: string;
  branchId?: string;
}

export const notificationGatewayService = {
  async dispatch(event: NotificationEvent): Promise<void> {
    const notifType = getNotificationType(event.itemType);
    if (!notifType) {
      console.warn(`Unknown notification type: ${event.itemType}`);
      return;
    }

    // Resolve recipients
    const recipients = await this.resolveRecipients(event);
    if (recipients.length === 0) {
      console.warn(`No recipients found for ${event.itemType} on ${event.entityId}`);
      return;
    }

    // Dispatch to both channels
    await Promise.all(
      recipients.map(async (recipient) => {
        // 1. Work Inbox (in-app)
        await workInboxService.createItem({
          user_id: recipient.userId,
          item_type: event.itemType,
          entity_type: event.entityType,
          entity_id: event.entityId,
          title: this.renderTitle(notifType.subjectTemplate, event.context),
          context_json: event.context,
          priority: notifType.defaultPriority,
        });

        // 2. Email Queue
        if (recipient.email && recipient.emailEnabled) {
          const priority = isInstantPriority(notifType, event.context) 
            ? 'critical' 
            : notifType.defaultPriority;

          await emailQueueService.enqueue({
            recipientEmail: recipient.email,
            recipientUserId: recipient.userId,
            itemType: event.itemType,
            entityType: event.entityType,
            entityId: event.entityId,
            context: event.context,
            priority,
            digestBatch: priority === 'critical' ? null : new Date(),
          });
        }
      })
    );
  },

  async resolveRecipients(event: NotificationEvent): Promise<Array<{
    userId: string;
    email: string | null;
    emailEnabled: boolean;
  }>> {
    // If specific user targeted
    if (event.targetUserId) {
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT au.id as userId, au.email, 
                COALESCE(np.email_enabled, 1) as emailEnabled
         FROM auth_user au
         LEFT JOIN notification_preference np ON np.user_id = au.id
         WHERE au.id = ?`,
        [event.targetUserId]
      );
      return rows.map(r => ({
        userId: r.userId,
        email: r.email,
        emailEnabled: Boolean(r.emailEnabled),
      }));
    }

    // If role-based targeting
    if (event.targetRoleKey) {
      const branchFilter = event.branchId 
        ? 'AND (ur.branch_id = ? OR ur.branch_id IS NULL)' 
        : '';
      const params = event.branchId 
        ? [event.targetRoleKey, event.branchId] 
        : [event.targetRoleKey];

      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT DISTINCT au.id as userId, au.email,
                COALESCE(np.email_enabled, 1) as emailEnabled
         FROM auth_user au
         JOIN user_roles ur ON ur.user_id = au.id
         LEFT JOIN notification_preference np ON np.user_id = au.id
         WHERE ur.role_key = ? ${branchFilter}
           AND au.status = 'active'`,
        params
      );
      return rows.map(r => ({
        userId: r.userId,
        email: r.email,
        emailEnabled: Boolean(r.emailEnabled),
      }));
    }

    return [];
  },

  renderTitle(template: string, context: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(context[key] ?? ''));
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/notification-gateway/notification-gateway.service.ts
git commit -m "feat(notifications): add central notification gateway dispatcher"
```

---

## Task 9: Digest Scheduler (Cron Jobs)

**Files:**
- Create: `backend/src/modules/notification-gateway/digest-scheduler.cron.ts`

**Interfaces:**
- Consumes: `emailQueueService`, `emailRendererService`
- Produces: 8 AM morning digest, 6 PM evening summary cron jobs

- [ ] **Step 1: Install node-cron**

Run: `cd backend && npm install node-cron && npm install -D @types/node-cron`

- [ ] **Step 2: Create digest scheduler**

```typescript
// backend/src/modules/notification-gateway/digest-scheduler.cron.ts

import cron from 'node-cron';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../../db/mysql.js';
import { emailQueueService, PendingEmail } from './email-queue.service.js';
import { emailRendererService } from './email-renderer.service.js';
import { sendEmail } from '../../services/email.service.js';

const IST_OFFSET = '+05:30';

interface DigestItem {
  id: string;
  itemType: string;
  entityType: string;
  entityId: string;
  context: Record<string, unknown>;
  approveToken: string | null;
  rejectToken: string | null;
  createdAt: Date;
}

async function processInstantQueue(): Promise<void> {
  console.log('[Digest] Processing instant queue...');
  
  const pending = await emailQueueService.getPendingInstant();
  if (pending.length === 0) return;

  for (const item of pending) {
    try {
      const context = JSON.parse(item.context_json || '{}');
      
      // Get approver name
      const [users] = await db.query<RowDataPacket[]>(
        `SELECT COALESCE(e.first_name, au.username) as name 
         FROM auth_user au 
         LEFT JOIN employees e ON e.user_id = au.id 
         WHERE au.id = ?`,
        [item.recipient_user_id]
      );
      const approverName = users[0]?.name || 'User';

      const emailContext = emailRendererService.buildEmailContext(
        item.item_type,
        item.entity_id,
        context,
        approverName,
        item.approve_token,
        item.reject_token
      );

      const html = 'alertMessage' in emailContext
        ? emailRendererService.renderInstantAlert(emailContext as any)
        : emailRendererService.renderInstantApproval(emailContext as any);

      await sendEmail({
        to: item.recipient_email,
        subject: `[HRMS] ${emailContext.subject}`,
        html,
      });

      await emailQueueService.markSent(item.id);
      console.log(`[Digest] Sent instant email to ${item.recipient_email}`);
    } catch (err) {
      console.error(`[Digest] Failed to send to ${item.recipient_email}:`, err);
    }
  }
}

async function processMorningDigest(): Promise<void> {
  console.log('[Digest] Processing 8 AM morning digest...');
  
  const today = new Date();
  const pending = await emailQueueService.getPendingDigest(today, 'standard');
  
  if (pending.length === 0) {
    console.log('[Digest] No pending standard items for digest.');
    return;
  }

  // Group by recipient
  const byRecipient = new Map<string, PendingEmail[]>();
  for (const item of pending) {
    const key = item.recipient_user_id;
    if (!byRecipient.has(key)) byRecipient.set(key, []);
    byRecipient.get(key)!.push(item);
  }

  for (const [userId, items] of byRecipient) {
    try {
      // Get user info
      const [users] = await db.query<RowDataPacket[]>(
        `SELECT au.email, COALESCE(e.first_name, au.username) as name 
         FROM auth_user au 
         LEFT JOIN employees e ON e.user_id = au.id 
         WHERE au.id = ?`,
        [userId]
      );
      if (!users[0]?.email) continue;

      const digestItems: DigestItem[] = items.map(i => ({
        id: i.id,
        itemType: i.item_type,
        entityType: i.entity_type,
        entityId: i.entity_id,
        context: JSON.parse(i.context_json || '{}'),
        approveToken: i.approve_token,
        rejectToken: i.reject_token,
        createdAt: i.created_at,
      }));

      // Render digest email (template to be created)
      const html = renderMorningDigest(users[0].name, digestItems);

      await sendEmail({
        to: users[0].email,
        subject: `[HRMS] Morning Digest: ${items.length} items awaiting action`,
        html,
      });

      // Mark all as sent
      for (const item of items) {
        await emailQueueService.markSent(item.id);
      }

      console.log(`[Digest] Sent morning digest to ${users[0].email} with ${items.length} items`);
    } catch (err) {
      console.error(`[Digest] Failed morning digest for user ${userId}:`, err);
    }
  }
}

async function processEveningSummary(): Promise<void> {
  console.log('[Digest] Processing 6 PM evening summary...');
  
  const today = new Date();
  const pending = await emailQueueService.getPendingDigest(today, 'info');
  
  if (pending.length === 0) {
    console.log('[Digest] No pending info items for summary.');
    return;
  }

  // Similar grouping and sending logic as morning digest
  // ... (implementation similar to processMorningDigest)
}

function renderMorningDigest(userName: string, items: DigestItem[]): string {
  const BASE_URL = process.env.FRONTEND_URL || 'https://mcnhrms.teammas.in';
  const ACTION_URL = process.env.BACKEND_URL || 'https://mcnhrms.teammas.in/api';

  const itemRows = items.map(item => {
    const ctx = item.context;
    const approveUrl = item.approveToken 
      ? `${ACTION_URL}/email-actions/${encodeURIComponent(item.approveToken)}` 
      : null;
    const rejectUrl = item.rejectToken
      ? `${ACTION_URL}/email-actions/${encodeURIComponent(item.rejectToken)}`
      : null;

    return `
      <tr style="border-bottom: 1px solid #E5E7EB;">
        <td style="padding: 16px; font-size: 14px; color: #1F2937;">
          <strong>${item.itemType.replace(/_/g, ' ')}</strong><br/>
          <span style="color: #6B7280; font-size: 12px;">${Object.entries(ctx).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(' | ')}</span>
        </td>
        <td style="padding: 16px; text-align: right;">
          ${approveUrl ? `<a href="${approveUrl}" style="display: inline-block; background: #16A34A; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 12px; margin-right: 8px;">Approve</a>` : ''}
          ${rejectUrl ? `<a href="${rejectUrl}" style="display: inline-block; background: #DC2626; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 12px;">Reject</a>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="font-family: Arial, sans-serif; background: #F9FAFB; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        <div style="background: #2563EB; padding: 24px; color: white;">
          <h1 style="margin: 0; font-size: 20px;">Good Morning, ${userName}!</h1>
          <p style="margin: 8px 0 0; opacity: 0.9;">You have ${items.length} item(s) awaiting your action.</p>
        </div>
        <table style="width: 100%; border-collapse: collapse;">
          ${itemRows}
        </table>
        <div style="padding: 24px; text-align: center;">
          <a href="${BASE_URL}/work-inbox" style="display: inline-block; background: #2563EB; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">View All in HRMS</a>
        </div>
        <div style="padding: 16px; background: #F3F4F6; text-align: center; font-size: 12px; color: #6B7280;">
          MAS Callnet HRMS • Action links expire in 72 hours
        </div>
      </div>
    </body>
    </html>
  `;
}

export function startDigestScheduler(): void {
  // Process instant queue every minute
  cron.schedule('* * * * *', processInstantQueue, {
    timezone: 'Asia/Kolkata',
  });

  // Morning digest at 8:00 AM IST
  cron.schedule('0 8 * * *', processMorningDigest, {
    timezone: 'Asia/Kolkata',
  });

  // Evening summary at 6:00 PM IST
  cron.schedule('0 18 * * *', processEveningSummary, {
    timezone: 'Asia/Kolkata',
  });

  // Expire old tokens daily at 1:00 AM IST
  cron.schedule('0 1 * * *', async () => {
    const expired = await emailQueueService.markExpired();
    console.log(`[Digest] Marked ${expired} expired email queue entries.`);
  }, {
    timezone: 'Asia/Kolkata',
  });

  console.log('[Digest] Scheduler started (IST timezone)');
}
```

- [ ] **Step 3: Initialize scheduler in app startup**

In `backend/src/app.ts`, add after server starts:
```typescript
import { startDigestScheduler } from './modules/notification-gateway/digest-scheduler.cron.js';

// ... after app.listen()
startDigestScheduler();
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/notification-gateway/digest-scheduler.cron.ts \
        backend/src/app.ts
git commit -m "feat(notifications): add digest scheduler cron jobs (8 AM / 6 PM IST)"
```

---

## Task 10: Integration with Leave Service

**Files:**
- Modify: `backend/src/modules/leaves/leaves.service.ts`

**Interfaces:**
- Consumes: `notificationGatewayService.dispatch()`
- Produces: Notifications for leave requests

- [ ] **Step 1: Add notification dispatch to leave creation**

In `backend/src/modules/leaves/leaves.service.ts`, find the leave creation function and add:

```typescript
import { notificationGatewayService } from '../notification-gateway/notification-gateway.service.js';

// After successfully creating a leave request
await notificationGatewayService.dispatch({
  itemType: 'LEAVE_APPROVAL_PENDING',
  entityType: 'leave_request',
  entityId: leaveId,
  context: {
    employee_name: `${employee.first_name} ${employee.last_name}`,
    dates: `${formatDate(startDate)} - ${formatDate(endDate)}`,
    leave_type: leaveType,
    days: numberOfDays,
  },
  targetUserId: employee.manager_id,
  branchId: employee.branch_id,
});
```

- [ ] **Step 2: Add notification for leave approval/rejection**

```typescript
// After approving or rejecting a leave
await notificationGatewayService.dispatch({
  itemType: status === 'approved' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
  entityType: 'leave_request',
  entityId: leaveId,
  context: {
    dates: `${formatDate(leave.start_date)} - ${formatDate(leave.end_date)}`,
    leave_type: leave.leave_type,
    approver_name: approverName,
    remarks: remarks || '',
  },
  targetUserId: leave.employee_user_id,
});

// Cancel pending email queue entries for this leave
await emailQueueService.cancelForEntity('leave_request', leaveId);
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/leaves/leaves.service.ts
git commit -m "feat(leaves): integrate with notification gateway for email approvals"
```

---

## Task 11: Integration with GRN Service

**Files:**
- Modify: `backend/src/modules/finance/grn.service.ts`

**Interfaces:**
- Consumes: `notificationGatewayService.dispatch()`
- Produces: Notifications for GRN approval workflow

- [ ] **Step 1: Add notification dispatch to GRN submission**

In `backend/src/modules/finance/grn.service.ts`, after GRN is submitted for approval:

```typescript
import { notificationGatewayService } from '../notification-gateway/notification-gateway.service.js';

// After GRN submitted for branch head approval
await notificationGatewayService.dispatch({
  itemType: 'GRN_APPROVAL_PENDING',
  entityType: 'grn_request',
  entityId: grnId,
  context: {
    grn_no: grnNumber,
    amount: formatCurrency(totalAmount),
    requester_name: requesterName,
    expense_head: expenseHead,
    vendor: vendorName,
  },
  targetRoleKey: 'branch_head',
  branchId: branchId,
});
```

- [ ] **Step 2: Add notification for GRN status changes**

```typescript
// After GRN approved/rejected
await notificationGatewayService.dispatch({
  itemType: status === 'approved' ? 'GRN_APPROVED' : 'GRN_REJECTED',
  entityType: 'grn_request',
  entityId: grnId,
  context: {
    grn_no: grnNumber,
    amount: formatCurrency(totalAmount),
    approver_name: approverName,
    remarks: remarks || '',
  },
  targetUserId: requesterUserId,
});

await emailQueueService.cancelForEntity('grn_request', grnId);
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/finance/grn.service.ts
git commit -m "feat(grn): integrate with notification gateway for email approvals"
```

---

## Task 12: User Notification Preferences API

**Files:**
- Create: `backend/src/modules/notification-gateway/notification-gateway.routes.ts`

**Interfaces:**
- Produces: `GET /api/notifications/preferences`, `PUT /api/notifications/preferences`

- [ ] **Step 1: Create preferences routes**

```typescript
// backend/src/modules/notification-gateway/notification-gateway.routes.ts

import { Router, Request, Response } from 'express';
import { db } from '../../db/mysql.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import type { RowDataPacket } from 'mysql2/promise';

const router = Router();

router.use(requireAuth);

// GET /api/notifications/preferences - get user's notification preferences
router.get('/preferences', async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT * FROM notification_preference WHERE user_id = ?`,
    [userId]
  );

  if (rows.length === 0) {
    // Return defaults
    return res.json({
      email_enabled: true,
      digest_time_am: '08:00',
      digest_time_pm: '18:00',
      instant_override: {},
      muted_types: [],
    });
  }

  res.json({
    email_enabled: Boolean(rows[0].email_enabled),
    digest_time_am: rows[0].digest_time_am?.slice(0, 5) || '08:00',
    digest_time_pm: rows[0].digest_time_pm?.slice(0, 5) || '18:00',
    instant_override: JSON.parse(rows[0].instant_override || '{}'),
    muted_types: JSON.parse(rows[0].muted_types || '[]'),
  });
});

// PUT /api/notifications/preferences - update user's notification preferences
router.put('/preferences', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { email_enabled, digest_time_am, digest_time_pm, instant_override, muted_types } = req.body;

  await db.execute(
    `INSERT INTO notification_preference 
     (user_id, email_enabled, digest_time_am, digest_time_pm, instant_override, muted_types)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       email_enabled = VALUES(email_enabled),
       digest_time_am = VALUES(digest_time_am),
       digest_time_pm = VALUES(digest_time_pm),
       instant_override = VALUES(instant_override),
       muted_types = VALUES(muted_types),
       updated_at = NOW()`,
    [
      userId,
      email_enabled ? 1 : 0,
      digest_time_am || '08:00:00',
      digest_time_pm || '18:00:00',
      JSON.stringify(instant_override || {}),
      JSON.stringify(muted_types || []),
    ]
  );

  res.json({ success: true });
});

export default router;
```

- [ ] **Step 2: Mount in app.ts**

```typescript
import notificationRoutes from './modules/notification-gateway/notification-gateway.routes.js';

app.use('/api/notifications', notificationRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/notification-gateway/notification-gateway.routes.ts \
        backend/src/app.ts
git commit -m "feat(notifications): add user preferences API"
```

---

## Summary

This plan implements a complete email-based approval system with:

| Task | Component | Status |
|------|-----------|--------|
| 1 | Database migrations (3 tables) | - [ ] |
| 2 | Notification types registry | - [ ] |
| 3 | Email token service (HMAC) | - [ ] |
| 4 | Email queue service | - [ ] |
| 5 | MJML email templates | - [ ] |
| 6 | Email renderer service | - [ ] |
| 7 | Email action routes | - [ ] |
| 8 | Notification gateway service | - [ ] |
| 9 | Digest scheduler (cron) | - [ ] |
| 10 | Leave service integration | - [ ] |
| 11 | GRN service integration | - [ ] |
| 12 | User preferences API | - [ ] |

**Estimated effort:** 4-6 hours for full implementation
**Dependencies:** MJML, node-cron, existing email service
**Risk:** Email deliverability depends on existing SMTP configuration 