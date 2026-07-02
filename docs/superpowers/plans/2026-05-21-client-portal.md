# Client Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a client-facing portal where BPO clients log in via email OTP and view live KPI scorecards, glide path commitments, action plans, governance checklists, attrition data, and management commentary for their process(es).

**Architecture:** Magic-link OTP auth issues a separate JWT (signed with `PORTAL_JWT_SECRET`) scoped to a `client_user` record. All portal API routes live under `/api/portal/*` with a dedicated `requireClientAuth` middleware. Four build phases: Foundation (auth + overview) → KPIs + Glide Paths → Action Plans + Governance → Attrition + Commentary.

**Tech Stack:** Express 4 + TypeScript + MySQL2 (backend), React 18 + TanStack Query + Tailwind + Radix UI (frontend), Vitest + Supertest (tests), Zod (validation), `jsonwebtoken` + `bcryptjs` (portal auth), `nodemailer` (email OTP)

---

## File Map

**New backend files:**
- `backend/src/modules/portal/portal.types.ts` — TypeScript interfaces
- `backend/src/modules/portal/portal.validation.ts` — Zod schemas
- `backend/src/modules/portal/portal.auth.service.ts` — OTP generation, JWT issue/verify
- `backend/src/modules/portal/portal.overview.service.ts` — account overview query
- `backend/src/modules/portal/portal.kpi.service.ts` — KPI scorecard + sparkline data
- `backend/src/modules/portal/portal.glide.service.ts` — glide path data
- `backend/src/modules/portal/portal.actions.service.ts` — action plan CRUD
- `backend/src/modules/portal/portal.governance.service.ts` — governance checklist
- `backend/src/modules/portal/portal.attrition.service.ts` — attrition aggregation
- `backend/src/modules/portal/portal.commentary.service.ts` — commentary + replies
- `backend/src/modules/portal/portal.controller.ts` — all route handlers
- `backend/src/modules/portal/portal.routes.ts` — Express router
- `backend/src/middleware/requireClientAuth.ts` — portal JWT middleware
- `backend/src/config/env.ts` — add `PORTAL_JWT_SECRET`, `SMTP_*` vars
- `backend/sql/012_client_portal.sql` — all new tables

**Modified backend files:**
- `backend/src/app.ts` — mount `/api/portal` and `/api/internal` routers

**New frontend files:**
- `src/pages/portal/PortalLogin.tsx` — OTP login page
- `src/pages/portal/PortalOverview.tsx` — account overview (process cards)
- `src/pages/portal/PortalProcessDashboard.tsx` — 6-tab process dashboard
- `src/components/portal/PortalRoute.tsx` — auth guard (reads `portal_token` from localStorage)
- `src/components/portal/KpiScorecardGrid.tsx` — scorecard cards with sparklines
- `src/components/portal/GlidePathChart.tsx` — SVG 3-line chart
- `src/components/portal/ActionPlanTable.tsx` — accordion by metric
- `src/components/portal/GovernanceChecklist.tsx` — 4-column grid
- `src/components/portal/AttritionPanel.tsx` — bar charts + headcount stats
- `src/components/portal/CommentaryCard.tsx` — commentary + acknowledge + reply
- `src/lib/portalApi.ts` — portal API client (reads `portal_token`, no Supabase)

**Modified frontend files:**
- `src/App.tsx` — add `/portal/*` routes

**New test files:**
- `backend/tests/portal.auth.service.test.ts`
- `backend/tests/portal.routes.test.ts`
- `backend/tests/portal.kpi.service.test.ts`

---

## Phase 1: Foundation

### Task 1: Install missing backend dependencies

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install deps**

```bash
cd backend && npm install jsonwebtoken bcryptjs nodemailer
npm install --save-dev @types/jsonwebtoken @types/bcryptjs @types/nodemailer
```

Expected: `added N packages` with no errors.

- [ ] **Step 2: Verify build still passes**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "feat(portal): install jsonwebtoken, bcryptjs, nodemailer"
```

---

### Task 2: SQL migration — all portal tables

**Files:**
- Create: `backend/sql/012_client_portal.sql`

- [ ] **Step 1: Write the SQL file**

```sql
-- 012_client_portal.sql
USE mas_hrms;

-- Client companies
CREATE TABLE IF NOT EXISTS client_master (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  client_code  VARCHAR(50)  NOT NULL UNIQUE,
  client_name  VARCHAR(255) NOT NULL,
  active_status TINYINT(1)  NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Link processes to clients
ALTER TABLE process_master
  ADD COLUMN IF NOT EXISTS client_id CHAR(36) NULL,
  ADD CONSTRAINT fk_process_client FOREIGN KEY (client_id) REFERENCES client_master(id) ON DELETE SET NULL;

-- Portal users (one per contact at the client company)
CREATE TABLE IF NOT EXISTS client_user (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  client_id    CHAR(36)     NOT NULL,
  email        VARCHAR(255) NOT NULL UNIQUE,
  name         VARCHAR(255) NOT NULL,
  designation  VARCHAR(255),
  process_ids  JSON         NOT NULL,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES client_master(id) ON DELETE CASCADE
);

-- OTP store (6-digit, bcrypt-hashed, 10-min TTL, single-use)
CREATE TABLE IF NOT EXISTS portal_otp (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  email      VARCHAR(255) NOT NULL,
  otp_hash   VARCHAR(255) NOT NULL,
  expires_at DATETIME     NOT NULL,
  used       TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_portal_otp_email (email)
);

-- Access log (90-day retention)
CREATE TABLE IF NOT EXISTS portal_access_log (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  client_user_id CHAR(36)     NOT NULL,
  page           VARCHAR(255) NOT NULL,
  ip_address     VARCHAR(45),
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pal_user (client_user_id),
  INDEX idx_pal_time (created_at)
);

-- Glide path commitments (ops team commits to improvement trajectory)
CREATE TABLE IF NOT EXISTS glide_path_commitment (
  id              CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id      CHAR(36)       NOT NULL,
  metric_id       CHAR(36)       NOT NULL,
  month           CHAR(7)        NOT NULL,
  committed_value DECIMAL(12,4)  NOT NULL,
  committed_by    CHAR(36)       NOT NULL,
  is_locked       TINYINT(1)     NOT NULL DEFAULT 0,
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_glide (process_id, metric_id, month),
  INDEX idx_glide_process (process_id),
  FOREIGN KEY (metric_id) REFERENCES kpi_metric_master(id) ON DELETE CASCADE
);

-- Action plans (one per off-track metric)
CREATE TABLE IF NOT EXISTS action_plan (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id  CHAR(36)     NOT NULL,
  metric_id   CHAR(36)     NOT NULL,
  action_text TEXT         NOT NULL,
  owner_level ENUM('analyst','tl','process_manager','branch_head') NOT NULL,
  owner_name  VARCHAR(255) NOT NULL,
  due_date    DATE         NOT NULL,
  status      ENUM('planned','in_progress','done','delayed') NOT NULL DEFAULT 'planned',
  created_by  CHAR(36)     NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ap_process (process_id),
  FOREIGN KEY (metric_id) REFERENCES kpi_metric_master(id) ON DELETE CASCADE
);

-- Governance activity master (seed data defines the activities)
CREATE TABLE IF NOT EXISTS governance_activity_master (
  id             CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  activity_name  VARCHAR(255) NOT NULL,
  level          ENUM('analyst','tl','process_manager','branch_head') NOT NULL,
  frequency      ENUM('daily','weekly','monthly') NOT NULL,
  required_count INT          NOT NULL DEFAULT 1,
  active_status  TINYINT(1)   NOT NULL DEFAULT 1
);

-- Governance log (how many times activity was completed per period)
CREATE TABLE IF NOT EXISTS governance_checklist_log (
  id              CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id      CHAR(36)  NOT NULL,
  period          CHAR(7)   NOT NULL,
  activity_id     CHAR(36)  NOT NULL,
  completed_count INT       NOT NULL DEFAULT 0,
  updated_by      CHAR(36)  NOT NULL,
  updated_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gov_log (process_id, period, activity_id),
  FOREIGN KEY (activity_id) REFERENCES governance_activity_master(id) ON DELETE CASCADE
);

-- Management commentary (one per process per month)
CREATE TABLE IF NOT EXISTS management_commentary (
  id                          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id                  CHAR(36)     NOT NULL,
  period                      CHAR(7)      NOT NULL,
  author_id                   CHAR(36)     NOT NULL,
  author_name                 VARCHAR(255) NOT NULL,
  author_designation          VARCHAR(255) NOT NULL,
  body                        TEXT         NOT NULL,
  published_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at             DATETIME     NULL,
  acknowledged_by_client_user_id CHAR(36)  NULL,
  UNIQUE KEY uq_commentary (process_id, period),
  INDEX idx_commentary_process (process_id)
);

-- Commentary replies from client users
CREATE TABLE IF NOT EXISTS management_commentary_reply (
  id                     CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  commentary_id          CHAR(36)      NOT NULL,
  replied_by_client_user_id CHAR(36)   NOT NULL,
  reply_text             VARCHAR(1000) NOT NULL,
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (commentary_id) REFERENCES management_commentary(id) ON DELETE CASCADE
);

-- Seed governance activities
INSERT IGNORE INTO governance_activity_master (id, activity_name, level, frequency, required_count) VALUES
  (UUID(), 'Adherence Check', 'analyst', 'daily', 20),
  (UUID(), 'QA Calibration Attendance', 'analyst', 'monthly', 2),
  (UUID(), 'Floor Walk', 'tl', 'weekly', 4),
  (UUID(), 'Team Briefing', 'tl', 'weekly', 4),
  (UUID(), 'Coaching Session', 'tl', 'monthly', 4),
  (UUID(), 'MIS Review', 'process_manager', 'weekly', 4),
  (UUID(), 'Escalation Review', 'process_manager', 'weekly', 2),
  (UUID(), 'SIP Review', 'process_manager', 'monthly', 1),
  (UUID(), 'Client Review Meeting', 'branch_head', 'monthly', 1),
  (UUID(), 'P&L Review', 'branch_head', 'monthly', 1),
  (UUID(), 'Headcount Review', 'branch_head', 'monthly', 1);
```

- [ ] **Step 2: Verify SQL parses**

```bash
mysql -u root -p mas_hrms < backend/sql/012_client_portal.sql
```

Expected: no errors. If `ALTER TABLE` fails because column already exists, wrap in a stored procedure or run manually and skip.

- [ ] **Step 3: Commit**

```bash
git add backend/sql/012_client_portal.sql
git commit -m "feat(portal): SQL migration — all client portal tables"
```

---

### Task 3: Env config — add PORTAL_JWT_SECRET and SMTP vars

**Files:**
- Modify: `backend/src/config/env.ts`

- [ ] **Step 1: Read current env.ts** (already read above)

- [ ] **Step 2: Add portal env vars**

In `backend/src/config/env.ts`, add to the `envSchema` object after `DB_POOL_MAX`:

```typescript
  PORTAL_JWT_SECRET: z.string().min(32).default("change-me-in-production-portal-secret"),
  SMTP_HOST:   z.string().default("smtp.gmail.com"),
  SMTP_PORT:   z.coerce.number().default(587),
  SMTP_USER:   z.string().default(""),
  SMTP_PASS:   z.string().default(""),
  SMTP_FROM:   z.string().default("noreply@mascallnet.com"),
```

- [ ] **Step 3: Typecheck**

```bash
cd backend && npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/config/env.ts
git commit -m "feat(portal): add PORTAL_JWT_SECRET and SMTP env vars"
```

---

### Task 4: Portal types and validation

**Files:**
- Create: `backend/src/modules/portal/portal.types.ts`
- Create: `backend/src/modules/portal/portal.validation.ts`

- [ ] **Step 1: Write failing test**

Create `backend/tests/portal.auth.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn() } }));

import { portalAuthService } from "../src/modules/portal/portal.auth.service.js";

describe("portalAuthService.generateOtp", () => {
  it("returns a 6-digit numeric string", () => {
    const otp = portalAuthService.generateOtp();
    expect(otp).toMatch(/^\d{6}$/);
  });
});

describe("portalAuthService.issueToken", () => {
  it("returns a string token containing 3 JWT segments", () => {
    const token = portalAuthService.issueToken({
      clientUserId: "u-1",
      clientId: "c-1",
      processIds: ["p-1"],
    });
    expect(token.split(".")).toHaveLength(3);
  });
});

describe("portalAuthService.verifyToken", () => {
  it("round-trips a valid token", () => {
    const payload = { clientUserId: "u-1", clientId: "c-1", processIds: ["p-1"] };
    const token = portalAuthService.issueToken(payload);
    const decoded = portalAuthService.verifyToken(token);
    expect(decoded.clientUserId).toBe("u-1");
    expect(decoded.processIds).toEqual(["p-1"]);
  });

  it("throws on invalid token", () => {
    expect(() => portalAuthService.verifyToken("bad.token.here")).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npm test -- tests/portal.auth.service.test.ts
```

Expected: FAIL — `portalAuthService` not found.

- [ ] **Step 3: Write types**

Create `backend/src/modules/portal/portal.types.ts`:

```typescript
export interface ClientUser {
  id: string;
  client_id: string;
  email: string;
  name: string;
  designation: string | null;
  process_ids: string[];
  is_active: number;
  created_at: string;
}

export interface PortalTokenPayload {
  clientUserId: string;
  clientId: string;
  processIds: string[];
  role: "client";
}

export interface ProcessCard {
  process_id: string;
  process_name: string;
  client_name: string;
  rag: "green" | "amber" | "red";
  headline_metrics: HeadlineMetric[];
  last_updated: string | null;
}

export interface HeadlineMetric {
  metric_code: string;
  metric_name: string;
  unit: string;
  actual: number | null;
  target: number;
  achievement_pct: number;
  rag: "green" | "amber" | "red";
}

export interface KpiScorecard {
  metric_id: string;
  metric_code: string;
  metric_name: string;
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
  target: number;
  actual: number | null;
  achievement_pct: number;
  rag: "green" | "amber" | "red";
  sparkline: Array<{ period: string; value: number }>;
}

export interface GlidePoint {
  month: string;
  actual: number | null;
  committed: number | null;
  target: number;
}

export interface GlidePath {
  metric_id: string;
  metric_code: string;
  metric_name: string;
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
  target: number;
  points: GlidePoint[];
  behind_commitment: boolean;
}

export interface ActionPlanItem {
  id: string;
  process_id: string;
  metric_id: string;
  metric_code: string;
  metric_name: string;
  action_text: string;
  owner_level: "analyst" | "tl" | "process_manager" | "branch_head";
  owner_name: string;
  due_date: string;
  status: "planned" | "in_progress" | "done" | "delayed";
}

export interface GovernanceActivity {
  activity_id: string;
  activity_name: string;
  level: "analyst" | "tl" | "process_manager" | "branch_head";
  frequency: "daily" | "weekly" | "monthly";
  required_count: number;
  completed_count: number;
  completion_pct: number;
  rag: "green" | "amber" | "red";
}

export interface AttritionData {
  period: string;
  attrition_pct: number;
  voluntary_count: number;
  involuntary_count: number;
  headcount: number;
  sanctioned_strength: number;
  open_positions: number;
  avg_tenure_months: number;
  top_exit_reasons: Array<{ reason: string; count: number }>;
}

export interface Commentary {
  id: string;
  process_id: string;
  period: string;
  author_name: string;
  author_designation: string;
  body: string;
  published_at: string;
  acknowledged_at: string | null;
  acknowledged_by_client_user_id: string | null;
  replies: CommentaryReply[];
}

export interface CommentaryReply {
  id: string;
  replied_by_client_user_id: string;
  reply_text: string;
  created_at: string;
}
```

- [ ] **Step 4: Write validation schemas**

Create `backend/src/modules/portal/portal.validation.ts`:

```typescript
import { z } from "zod";

export const requestOtpSchema = z.object({
  email: z.string().email(),
});

export const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6).regex(/^\d{6}$/),
});

export const periodSchema = z.string().regex(/^\d{4}-\d{2}$/, "Period must be YYYY-MM");

export const processParamSchema = z.object({
  id: z.string().uuid(),
});

export const actionPlanFilterSchema = z.object({
  metricId: z.string().uuid().optional(),
  status: z.enum(["planned", "in_progress", "done", "delayed"]).optional(),
});

export const createActionPlanSchema = z.object({
  processId: z.string().uuid(),
  metricId: z.string().uuid(),
  actionText: z.string().min(1).max(1000),
  ownerLevel: z.enum(["analyst", "tl", "process_manager", "branch_head"]),
  ownerName: z.string().min(1).max(255),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["planned", "in_progress", "done", "delayed"]).default("planned"),
});

export const updateActionPlanSchema = createActionPlanSchema.partial().omit({ processId: true, metricId: true });

export const setGlideSchema = z.object({
  processId: z.string().uuid(),
  metricId: z.string().uuid(),
  month: periodSchema,
  committedValue: z.number().positive(),
});

export const updateGovernanceSchema = z.object({
  processId: z.string().uuid(),
  period: periodSchema,
  activityId: z.string().uuid(),
  completedCount: z.number().int().min(0),
});

export const createCommentarySchema = z.object({
  processId: z.string().uuid(),
  period: periodSchema,
  authorName: z.string().min(1).max(255),
  authorDesignation: z.string().min(1).max(255),
  body: z.string().min(1),
});

export const replyCommentarySchema = z.object({
  text: z.string().min(1).max(1000),
});

export const createClientUserSchema = z.object({
  clientId: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(255),
  designation: z.string().max(255).optional(),
  processIds: z.array(z.string().uuid()).min(1),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type CreateActionPlanInput = z.infer<typeof createActionPlanSchema>;
export type UpdateActionPlanInput = z.infer<typeof updateActionPlanSchema>;
export type SetGlideInput = z.infer<typeof setGlideSchema>;
export type UpdateGovernanceInput = z.infer<typeof updateGovernanceSchema>;
export type CreateCommentaryInput = z.infer<typeof createCommentarySchema>;
export type CreateClientUserInput = z.infer<typeof createClientUserSchema>;
```

- [ ] **Step 5: Write auth service**

Create `backend/src/modules/portal/portal.auth.service.ts`:

```typescript
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import type { PortalTokenPayload, ClientUser } from "./portal.types.js";

export const portalAuthService = {
  generateOtp(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  },

  issueToken(payload: Omit<PortalTokenPayload, "role">): string {
    return jwt.sign({ ...payload, role: "client" }, env.PORTAL_JWT_SECRET, { expiresIn: "7d" });
  },

  verifyToken(token: string): PortalTokenPayload {
    return jwt.verify(token, env.PORTAL_JWT_SECRET) as PortalTokenPayload;
  },

  async requestOtp(email: string): Promise<void> {
    const [users] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM client_user WHERE email = ? AND is_active = 1 LIMIT 1",
      [email]
    );
    if ((users as RowDataPacket[]).length === 0) return; // silent — don't reveal if email exists

    // Rate limit: max 3 OTPs per email per 15 minutes
    const [recent] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM portal_otp WHERE email = ? AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)",
      [email]
    );
    if ((recent as RowDataPacket[])[0].cnt >= 3) throw new Error("Too many OTP requests. Try again in 15 minutes.");

    const otp = portalAuthService.generateOtp();
    const hash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.execute(
      "INSERT INTO portal_otp (id, email, otp_hash, expires_at) VALUES (?, ?, ?, ?)",
      [randomUUID(), email, hash, expiresAt.toISOString().slice(0, 19).replace("T", " ")]
    );

    await portalAuthService.sendOtpEmail(email, otp);
  },

  async verifyOtp(email: string, otp: string): Promise<string> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, otp_hash FROM portal_otp
       WHERE email = ? AND used = 0 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    const record = (rows as RowDataPacket[])[0];
    if (!record) throw new Error("Invalid or expired OTP");

    const valid = await bcrypt.compare(otp, record.otp_hash);
    if (!valid) throw new Error("Invalid or expired OTP");

    await db.execute("UPDATE portal_otp SET used = 1 WHERE id = ?", [record.id]);

    const [userRows] = await db.execute<RowDataPacket[]>(
      "SELECT id, client_id, process_ids FROM client_user WHERE email = ? AND is_active = 1 LIMIT 1",
      [email]
    );
    const user = (userRows as RowDataPacket[])[0] as ClientUser & RowDataPacket;
    if (!user) throw new Error("User not found");

    const processIds: string[] = typeof user.process_ids === "string"
      ? JSON.parse(user.process_ids)
      : user.process_ids;

    return portalAuthService.issueToken({
      clientUserId: user.id,
      clientId: user.client_id,
      processIds,
    });
  },

  async sendOtpEmail(to: string, otp: string): Promise<void> {
    if (!env.SMTP_USER) return; // skip in local dev if SMTP not configured
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
    await transport.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: "Your MAS Callnet Portal OTP",
      text: `Your one-time password is: ${otp}\n\nValid for 10 minutes. Do not share this code.`,
    });
  },
};
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
cd backend && npm test -- tests/portal.auth.service.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/portal/ backend/tests/portal.auth.service.test.ts
git commit -m "feat(portal): types, validation, auth service (OTP + JWT)"
```

---

### Task 5: requireClientAuth middleware

**Files:**
- Create: `backend/src/middleware/requireClientAuth.ts`

- [ ] **Step 1: Write the middleware**

```typescript
import type { Request, Response, NextFunction } from "express";
import { portalAuthService } from "../modules/portal/portal.auth.service.js";
import type { PortalTokenPayload } from "../modules/portal/portal.types.js";

export interface ClientAuthRequest extends Request {
  portalUser?: PortalTokenPayload;
}

export function requireClientAuth(req: ClientAuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing portal token" });
  }
  const token = header.slice(7);
  try {
    const payload = portalAuthService.verifyToken(token);
    if (payload.role !== "client") return res.status(403).json({ error: "Forbidden" });
    req.portalUser = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired portal token" });
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd backend && npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/middleware/requireClientAuth.ts
git commit -m "feat(portal): requireClientAuth middleware"
```

---

### Task 6: Portal overview service

**Files:**
- Create: `backend/src/modules/portal/portal.overview.service.ts`

- [ ] **Step 1: Write the service**

```typescript
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { ProcessCard, HeadlineMetric } from "./portal.types.js";

const HEADLINE_METRICS = ["CSAT", "AHT", "FCR"];

function computeRag(achievementPct: number): "green" | "amber" | "red" {
  if (achievementPct >= 100) return "green";
  if (achievementPct >= 85) return "amber";
  return "red";
}

function computeAchievement(actual: number, target: number, direction: string): number {
  if (target === 0) return 0;
  const raw = direction === "higher_is_better" ? (actual / target) * 100 : (target / actual) * 100;
  return Math.min(Math.round(raw * 100) / 100, 120);
}

export const portalOverviewService = {
  async getOverview(processIds: string[]): Promise<ProcessCard[]> {
    if (processIds.length === 0) return [];

    const placeholders = processIds.map(() => "?").join(",");
    const currentPeriod = new Date().toISOString().slice(0, 7);

    // Fetch all metric scores for these processes in one query
    const [scoreRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         p.id AS process_id,
         p.process_name,
         cm.client_name,
         m.metric_code,
         m.metric_name,
         m.unit,
         m.direction,
         tm.target_value,
         ks.actual_value,
         ks.created_at AS last_updated
       FROM process_master p
       JOIN client_master cm ON cm.id = p.client_id
       JOIN kpi_assignment ka ON (
         ka.designation_id IS NULL AND ka.department_id IS NULL AND ka.employee_id IS NULL
       ) -- process-level template lookup (future: add process_id to kpi_assignment)
       JOIN kpi_template_metric tm ON tm.template_id = ka.template_id
       JOIN kpi_metric_master m ON m.id = tm.metric_id
       LEFT JOIN kpi_score ks ON ks.metric_id = m.id AND ks.period = ?
       WHERE p.id IN (${placeholders}) AND p.active_status = 1
       ORDER BY p.id, m.metric_code`,
      [currentPeriod, ...processIds]
    );

    // Group by process
    const processMap = new Map<string, ProcessCard>();
    for (const row of scoreRows as RowDataPacket[]) {
      if (!processMap.has(row.process_id)) {
        processMap.set(row.process_id, {
          process_id: row.process_id,
          process_name: row.process_name,
          client_name: row.client_name,
          rag: "green",
          headline_metrics: [],
          last_updated: null,
        });
      }
      const card = processMap.get(row.process_id)!;
      if (row.last_updated && (!card.last_updated || row.last_updated > card.last_updated)) {
        card.last_updated = row.last_updated;
      }
      if (HEADLINE_METRICS.includes(row.metric_code)) {
        const ach = row.actual_value != null
          ? computeAchievement(row.actual_value, row.target_value, row.direction)
          : 0;
        const rag = computeRag(ach);
        card.headline_metrics.push({
          metric_code: row.metric_code,
          metric_name: row.metric_name,
          unit: row.unit,
          actual: row.actual_value,
          target: row.target_value,
          achievement_pct: ach,
          rag,
        });
        // Process RAG = worst of all metrics
        if (rag === "red") card.rag = "red";
        else if (rag === "amber" && card.rag !== "red") card.rag = "amber";
      }
    }

    const cards = Array.from(processMap.values());
    // Sort: red → amber → green
    const order = { red: 0, amber: 1, green: 2 };
    return cards.sort((a, b) => order[a.rag] - order[b.rag]);
  },
};
```

- [ ] **Step 2: Typecheck**

```bash
cd backend && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/portal/portal.overview.service.ts
git commit -m "feat(portal): overview service — process cards with RAG"
```

---

### Task 7: Portal KPI service

**Files:**
- Create: `backend/src/modules/portal/portal.kpi.service.ts`

- [ ] **Step 1: Write failing test**

Add to `backend/tests/portal.kpi.service.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn() } }));

import { db } from "../src/db/mysql.js";
import { portalKpiService } from "../src/modules/portal/portal.kpi.service.js";

const mockDb = db as { execute: ReturnType<typeof vi.fn> };

describe("portalKpiService.computeAchievement", () => {
  it("higher_is_better: actual/target * 100", () => {
    expect(portalKpiService.computeAchievement(90, 100, "higher_is_better")).toBe(90);
  });
  it("lower_is_better: target/actual * 100", () => {
    expect(portalKpiService.computeAchievement(200, 250, "lower_is_better")).toBe(125); // capped at 120
  });
  it("caps at 120%", () => {
    expect(portalKpiService.computeAchievement(150, 100, "higher_is_better")).toBe(120);
  });
});

describe("portalKpiService.ragFromAchievement", () => {
  it("green at 100%", () => expect(portalKpiService.ragFromAchievement(100)).toBe("green"));
  it("amber at 85%", () => expect(portalKpiService.ragFromAchievement(85)).toBe("amber"));
  it("red at 84%", () => expect(portalKpiService.ragFromAchievement(84)).toBe("red"));
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npm test -- tests/portal.kpi.service.test.ts
```

- [ ] **Step 3: Write KPI service**

Create `backend/src/modules/portal/portal.kpi.service.ts`:

```typescript
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { KpiScorecard } from "./portal.types.js";

export const portalKpiService = {
  computeAchievement(actual: number, target: number, direction: string): number {
    if (target === 0) return 0;
    const raw = direction === "higher_is_better" ? (actual / target) * 100 : (target / actual) * 100;
    return Math.min(Math.round(raw * 100) / 100, 120);
  },

  ragFromAchievement(pct: number): "green" | "amber" | "red" {
    if (pct >= 100) return "green";
    if (pct >= 85) return "amber";
    return "red";
  },

  async getScorecards(processId: string, period: string): Promise<KpiScorecard[]> {
    // Get template metrics for this process via process_master → kpi_assignment
    // For now queries via process_id stored on kpi_assignment (add process_id col in future);
    // uses direct template lookup seeded per process
    const [metricRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         m.id AS metric_id, m.metric_code, m.metric_name, m.unit, m.direction,
         tm.target_value,
         ks.actual_value
       FROM process_master p
       JOIN kpi_template kt ON kt.template_name LIKE CONCAT('%', p.process_name, '%')
       JOIN kpi_template_metric tm ON tm.template_id = kt.id
       JOIN kpi_metric_master m ON m.id = tm.metric_id
       LEFT JOIN kpi_score ks ON ks.metric_id = m.id AND ks.period = ?
       WHERE p.id = ?
       ORDER BY m.category, m.metric_name`,
      [period, processId]
    );

    // Fetch sparkline: last 6 months per metric
    const sixMonthsAgo = getSixMonthsAgo(period);
    const metricIds = (metricRows as RowDataPacket[]).map(r => r.metric_id);
    let sparkMap: Map<string, Array<{ period: string; value: number }>> = new Map();

    if (metricIds.length > 0) {
      const placeholders = metricIds.map(() => "?").join(",");
      const [sparkRows] = await db.execute<RowDataPacket[]>(
        `SELECT metric_id, period, actual_value
         FROM kpi_score
         WHERE metric_id IN (${placeholders}) AND period >= ? AND period <= ?
         ORDER BY metric_id, period`,
        [...metricIds, sixMonthsAgo, period]
      );
      for (const row of sparkRows as RowDataPacket[]) {
        if (!sparkMap.has(row.metric_id)) sparkMap.set(row.metric_id, []);
        sparkMap.get(row.metric_id)!.push({ period: row.period, value: row.actual_value });
      }
    }

    return (metricRows as RowDataPacket[]).map(row => {
      const ach = row.actual_value != null
        ? portalKpiService.computeAchievement(row.actual_value, row.target_value, row.direction)
        : 0;
      return {
        metric_id: row.metric_id,
        metric_code: row.metric_code,
        metric_name: row.metric_name,
        unit: row.unit,
        direction: row.direction,
        target: row.target_value,
        actual: row.actual_value ?? null,
        achievement_pct: ach,
        rag: portalKpiService.ragFromAchievement(ach),
        sparkline: sparkMap.get(row.metric_id) ?? [],
      };
    });
  },
};

function getSixMonthsAgo(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 7, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && npm test -- tests/portal.kpi.service.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/portal/portal.kpi.service.ts backend/tests/portal.kpi.service.test.ts
git commit -m "feat(portal): KPI scorecard service with sparklines and RAG"
```

---

### Task 8: Remaining portal services (glide, actions, governance, attrition, commentary)

**Files:**
- Create: `backend/src/modules/portal/portal.glide.service.ts`
- Create: `backend/src/modules/portal/portal.actions.service.ts`
- Create: `backend/src/modules/portal/portal.governance.service.ts`
- Create: `backend/src/modules/portal/portal.attrition.service.ts`
- Create: `backend/src/modules/portal/portal.commentary.service.ts`

- [ ] **Step 1: Write glide path service**

Create `backend/src/modules/portal/portal.glide.service.ts`:

```typescript
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { GlidePath, GlidePoint } from "./portal.types.js";
import type { SetGlideInput } from "./portal.validation.js";

export const portalGlideService = {
  async getGlidePaths(processId: string, period: string): Promise<GlidePath[]> {
    // Only off-track metrics (achievement < 100%)
    const [metricRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         m.id AS metric_id, m.metric_code, m.metric_name, m.unit, m.direction,
         tm.target_value
       FROM process_master p
       JOIN kpi_template kt ON kt.template_name LIKE CONCAT('%', p.process_name, '%')
       JOIN kpi_template_metric tm ON tm.template_id = kt.id
       JOIN kpi_metric_master m ON m.id = tm.metric_id
       LEFT JOIN kpi_score ks ON ks.metric_id = m.id AND ks.period = ?
       WHERE p.id = ?
       AND (
         ks.actual_value IS NULL
         OR (m.direction = 'higher_is_better' AND ks.actual_value < tm.target_value)
         OR (m.direction = 'lower_is_better'  AND ks.actual_value > tm.target_value)
       )`,
      [period, processId]
    );

    if ((metricRows as RowDataPacket[]).length === 0) return [];

    const metricIds = (metricRows as RowDataPacket[]).map(r => r.metric_id);
    const placeholders = metricIds.map(() => "?").join(",");

    // Last 3 months actual
    const threeMonthsAgo = offsetMonth(period, -3);
    const [actualRows] = await db.execute<RowDataPacket[]>(
      `SELECT metric_id, period, actual_value FROM kpi_score
       WHERE metric_id IN (${placeholders}) AND period >= ? AND period <= ?
       ORDER BY metric_id, period`,
      [...metricIds, threeMonthsAgo, period]
    );

    // Next 3 months committed
    const threeMonthsAhead = offsetMonth(period, 3);
    const [commitRows] = await db.execute<RowDataPacket[]>(
      `SELECT metric_id, month, committed_value FROM glide_path_commitment
       WHERE process_id = ? AND metric_id IN (${placeholders})
         AND month > ? AND month <= ?
       ORDER BY metric_id, month`,
      [processId, period, threeMonthsAhead, ...metricIds]
    );

    return (metricRows as RowDataPacket[]).map(metric => {
      const actuals = (actualRows as RowDataPacket[]).filter(r => r.metric_id === metric.metric_id);
      const commits = (commitRows as RowDataPacket[]).filter(r => r.metric_id === metric.metric_id);

      const months = buildMonthRange(threeMonthsAgo, threeMonthsAhead);
      const points: GlidePoint[] = months.map(m => ({
        month: m,
        actual: actuals.find(a => a.period === m)?.actual_value ?? null,
        committed: commits.find(c => c.month === m)?.committed_value ?? null,
        target: metric.target_value,
      }));

      // Behind commitment: current month actual < committed by > 5%
      const currentActual = actuals.find(a => a.period === period)?.actual_value ?? null;
      const currentCommit = commits.find(c => c.month === period)?.committed_value ?? null;
      const behind = currentActual != null && currentCommit != null
        && Math.abs(currentActual - currentCommit) / currentCommit > 0.05
        && (metric.direction === "higher_is_better" ? currentActual < currentCommit : currentActual > currentCommit);

      return {
        metric_id: metric.metric_id,
        metric_code: metric.metric_code,
        metric_name: metric.metric_name,
        unit: metric.unit,
        direction: metric.direction,
        target: metric.target_value,
        points,
        behind_commitment: behind,
      };
    });
  },

  async setCommitment(input: SetGlideInput, userId: string): Promise<void> {
    await db.execute(
      `INSERT INTO glide_path_commitment (id, process_id, metric_id, month, committed_value, committed_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE committed_value = VALUES(committed_value), committed_by = VALUES(committed_by)`,
      [randomUUID(), input.processId, input.metricId, input.month, input.committedValue, userId]
    );
  },
};

function offsetMonth(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildMonthRange(from: string, to: string): string[] {
  const months: string[] = [];
  let cur = from;
  while (cur <= to) {
    months.push(cur);
    cur = offsetMonth(cur, 1);
  }
  return months;
}
```

- [ ] **Step 2: Write action plan service**

Create `backend/src/modules/portal/portal.actions.service.ts`:

```typescript
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { ActionPlanItem } from "./portal.types.js";
import type { CreateActionPlanInput, UpdateActionPlanInput } from "./portal.validation.js";

export const portalActionsService = {
  async list(processId: string, metricId?: string, status?: string): Promise<ActionPlanItem[]> {
    let sql = `SELECT ap.*, m.metric_code, m.metric_name
               FROM action_plan ap
               JOIN kpi_metric_master m ON m.id = ap.metric_id
               WHERE ap.process_id = ?`;
    const params: unknown[] = [processId];
    if (metricId) { sql += " AND ap.metric_id = ?"; params.push(metricId); }
    if (status)   { sql += " AND ap.status = ?"; params.push(status); }
    sql += " ORDER BY ap.due_date ASC";

    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return (rows as RowDataPacket[]).map(r => ({
      id: r.id,
      process_id: r.process_id,
      metric_id: r.metric_id,
      metric_code: r.metric_code,
      metric_name: r.metric_name,
      action_text: r.action_text,
      owner_level: r.owner_level,
      owner_name: r.owner_name,
      due_date: r.due_date,
      status: r.status,
    }));
  },

  async create(input: CreateActionPlanInput, userId: string): Promise<ActionPlanItem> {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO action_plan (id, process_id, metric_id, action_text, owner_level, owner_name, due_date, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.processId, input.metricId, input.actionText, input.ownerLevel, input.ownerName, input.dueDate, input.status, userId]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ap.*, m.metric_code, m.metric_name FROM action_plan ap
       JOIN kpi_metric_master m ON m.id = ap.metric_id WHERE ap.id = ?`,
      [id]
    );
    const r = (rows as RowDataPacket[])[0];
    return { id: r.id, process_id: r.process_id, metric_id: r.metric_id, metric_code: r.metric_code, metric_name: r.metric_name, action_text: r.action_text, owner_level: r.owner_level, owner_name: r.owner_name, due_date: r.due_date, status: r.status };
  },

  async update(id: string, input: UpdateActionPlanInput): Promise<void> {
    const fields = Object.entries(input)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => {
        const col = k.replace(/([A-Z])/g, "_$1").toLowerCase();
        return `${col} = ?`;
      });
    if (fields.length === 0) return;
    const values = Object.values(input).filter(v => v !== undefined);
    await db.execute(`UPDATE action_plan SET ${fields.join(", ")} WHERE id = ?`, [...values, id]);
  },
};
```

- [ ] **Step 3: Write governance service**

Create `backend/src/modules/portal/portal.governance.service.ts`:

```typescript
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { GovernanceActivity } from "./portal.types.js";
import type { UpdateGovernanceInput } from "./portal.validation.js";

export const portalGovernanceService = {
  async getChecklist(processId: string, period: string): Promise<GovernanceActivity[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         a.id AS activity_id, a.activity_name, a.level, a.frequency, a.required_count,
         COALESCE(l.completed_count, 0) AS completed_count
       FROM governance_activity_master a
       LEFT JOIN governance_checklist_log l
         ON l.activity_id = a.id AND l.process_id = ? AND l.period = ?
       WHERE a.active_status = 1
       ORDER BY FIELD(a.level,'analyst','tl','process_manager','branch_head'), a.activity_name`,
      [processId, period]
    );
    return (rows as RowDataPacket[]).map(r => {
      const pct = r.required_count > 0 ? Math.round((r.completed_count / r.required_count) * 100) : 0;
      return {
        activity_id: r.activity_id,
        activity_name: r.activity_name,
        level: r.level,
        frequency: r.frequency,
        required_count: r.required_count,
        completed_count: r.completed_count,
        completion_pct: pct,
        rag: pct >= 100 ? "green" : pct >= 70 ? "amber" : "red",
      };
    });
  },

  async updateLog(input: UpdateGovernanceInput, userId: string): Promise<void> {
    await db.execute(
      `INSERT INTO governance_checklist_log (id, process_id, period, activity_id, completed_count, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE completed_count = VALUES(completed_count), updated_by = VALUES(updated_by)`,
      [randomUUID(), input.processId, input.period, input.activityId, input.completedCount, userId]
    );
  },
};
```

- [ ] **Step 4: Write attrition service**

Create `backend/src/modules/portal/portal.attrition.service.ts`:

```typescript
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { AttritionData } from "./portal.types.js";

export const portalAttritionService = {
  async getAttrition(processId: string, period: string): Promise<AttritionData> {
    // Active headcount for process
    const [hcRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS headcount,
              AVG(TIMESTAMPDIFF(MONTH, date_of_joining, CURDATE())) AS avg_tenure
       FROM employees WHERE process_id = ? AND employment_status = 'Active'`,
      [processId]
    );
    const hc = (hcRows as RowDataPacket[])[0];

    // Attrition for period (from exit_management if available, else fallback)
    const [exitRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total_exits,
         SUM(CASE WHEN exit_type = 'voluntary'   THEN 1 ELSE 0 END) AS voluntary_count,
         SUM(CASE WHEN exit_type = 'involuntary' THEN 1 ELSE 0 END) AS involuntary_count
       FROM exit_records
       WHERE process_id = ? AND DATE_FORMAT(exit_date, '%Y-%m') = ?`,
      [processId, period]
    ).catch(() => [[{ total_exits: 0, voluntary_count: 0, involuntary_count: 0 }]]);
    const exits = (exitRows as RowDataPacket[])[0];

    const [reasonRows] = await db.execute<RowDataPacket[]>(
      `SELECT exit_reason AS reason, COUNT(*) AS cnt
       FROM exit_records
       WHERE process_id = ? AND DATE_FORMAT(exit_date, '%Y-%m') = ?
       GROUP BY exit_reason ORDER BY cnt DESC LIMIT 3`,
      [processId, period]
    ).catch(() => [[]]);

    const headcount = hc.headcount ?? 0;
    const attrition_pct = headcount > 0
      ? Math.round((exits.total_exits / headcount) * 100 * 100) / 100
      : 0;

    return {
      period,
      attrition_pct,
      voluntary_count: exits.voluntary_count ?? 0,
      involuntary_count: exits.involuntary_count ?? 0,
      headcount,
      sanctioned_strength: headcount, // fallback; update when strength table exists
      open_positions: 0,
      avg_tenure_months: Math.round(hc.avg_tenure ?? 0),
      top_exit_reasons: (reasonRows as RowDataPacket[]).map(r => ({ reason: r.reason, count: r.cnt })),
    };
  },
};
```

- [ ] **Step 5: Write commentary service**

Create `backend/src/modules/portal/portal.commentary.service.ts`:

```typescript
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { Commentary } from "./portal.types.js";
import type { CreateCommentaryInput } from "./portal.validation.js";

export const portalCommentaryService = {
  async get(processId: string, period: string): Promise<Commentary | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM management_commentary WHERE process_id = ? AND period = ? LIMIT 1",
      [processId, period]
    );
    const row = (rows as RowDataPacket[])[0];
    if (!row) return null;

    const [replyRows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM management_commentary_reply WHERE commentary_id = ? ORDER BY created_at ASC",
      [row.id]
    );

    return {
      id: row.id,
      process_id: row.process_id,
      period: row.period,
      author_name: row.author_name,
      author_designation: row.author_designation,
      body: row.body,
      published_at: row.published_at,
      acknowledged_at: row.acknowledged_at ?? null,
      acknowledged_by_client_user_id: row.acknowledged_by_client_user_id ?? null,
      replies: (replyRows as RowDataPacket[]).map(r => ({
        id: r.id,
        replied_by_client_user_id: r.replied_by_client_user_id,
        reply_text: r.reply_text,
        created_at: r.created_at,
      })),
    };
  },

  async create(input: CreateCommentaryInput, authorId: string): Promise<Commentary> {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO management_commentary (id, process_id, period, author_id, author_name, author_designation, body)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.processId, input.period, authorId, input.authorName, input.authorDesignation, input.body]
    );
    return (await portalCommentaryService.get(input.processId, input.period))!;
  },

  async acknowledge(commentaryId: string, clientUserId: string): Promise<void> {
    await db.execute(
      "UPDATE management_commentary SET acknowledged_at = NOW(), acknowledged_by_client_user_id = ? WHERE id = ? AND acknowledged_at IS NULL",
      [clientUserId, commentaryId]
    );
  },

  async addReply(commentaryId: string, clientUserId: string, text: string): Promise<void> {
    await db.execute(
      "INSERT INTO management_commentary_reply (id, commentary_id, replied_by_client_user_id, reply_text) VALUES (?, ?, ?, ?)",
      [randomUUID(), commentaryId, clientUserId, text]
    );
  },
};
```

- [ ] **Step 6: Typecheck all new services**

```bash
cd backend && npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/portal/
git commit -m "feat(portal): glide, actions, governance, attrition, commentary services"
```

---

### Task 9: Portal controller + routes

**Files:**
- Create: `backend/src/modules/portal/portal.controller.ts`
- Create: `backend/src/modules/portal/portal.routes.ts`

- [ ] **Step 1: Write failing route test**

Create `backend/tests/portal.routes.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn() }, pingDb: vi.fn() }));
vi.mock("../src/modules/portal/portal.auth.service.js", () => ({
  portalAuthService: {
    generateOtp: vi.fn(() => "123456"),
    issueToken: vi.fn(() => "mock.jwt.token"),
    verifyToken: vi.fn(() => ({ clientUserId: "u-1", clientId: "c-1", processIds: ["p-1"], role: "client" })),
    requestOtp: vi.fn(),
    verifyOtp: vi.fn(() => "mock.jwt.token"),
    sendOtpEmail: vi.fn(),
  },
}));
vi.mock("../src/modules/portal/portal.overview.service.js", () => ({
  portalOverviewService: { getOverview: vi.fn(() => []) },
}));
vi.mock("../src/modules/portal/portal.kpi.service.js", () => ({
  portalKpiService: { getScorecards: vi.fn(() => []) },
}));

import { app } from "../src/app.js";
import { portalAuthService } from "../src/modules/portal/portal.auth.service.js";

const svcAuth = portalAuthService as { [K: string]: ReturnType<typeof vi.fn> };
const PORTAL_AUTH = { Authorization: "Bearer mock.jwt.token" };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/portal/auth/request-otp", () => {
  it("returns 200 for valid email", async () => {
    svcAuth.requestOtp.mockResolvedValueOnce(undefined);
    const r = await request(app).post("/api/portal/auth/request-otp").send({ email: "client@airtel.com" });
    expect(r.status).toBe(200);
  });
  it("returns 400 for invalid email", async () => {
    const r = await request(app).post("/api/portal/auth/request-otp").send({ email: "notanemail" });
    expect(r.status).toBe(400);
  });
});

describe("POST /api/portal/auth/verify-otp", () => {
  it("returns token on valid OTP", async () => {
    svcAuth.verifyOtp.mockResolvedValueOnce("a.b.c");
    const r = await request(app).post("/api/portal/auth/verify-otp").send({ email: "client@airtel.com", otp: "123456" });
    expect(r.status).toBe(200);
    expect(r.body.token).toBeTruthy();
  });
  it("returns 400 for non-6-digit OTP", async () => {
    const r = await request(app).post("/api/portal/auth/verify-otp").send({ email: "client@airtel.com", otp: "abc" });
    expect(r.status).toBe(400);
  });
});

describe("GET /api/portal/overview", () => {
  it("returns 200 with portal token", async () => {
    const r = await request(app).get("/api/portal/overview").set(PORTAL_AUTH);
    expect(r.status).toBe(200);
  });
  it("returns 401 without token", async () => {
    const r = await request(app).get("/api/portal/overview");
    expect(r.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npm test -- tests/portal.routes.test.ts
```

Expected: FAIL — `/api/portal` route not mounted.

- [ ] **Step 3: Write controller**

Create `backend/src/modules/portal/portal.controller.ts`:

```typescript
import type { Request, Response } from "express";
import { portalAuthService } from "./portal.auth.service.js";
import { portalOverviewService } from "./portal.overview.service.js";
import { portalKpiService } from "./portal.kpi.service.js";
import { portalGlideService } from "./portal.glide.service.js";
import { portalActionsService } from "./portal.actions.service.js";
import { portalGovernanceService } from "./portal.governance.service.js";
import { portalAttritionService } from "./portal.attrition.service.js";
import { portalCommentaryService } from "./portal.commentary.service.js";
import {
  requestOtpSchema, verifyOtpSchema, actionPlanFilterSchema,
  createActionPlanSchema, updateActionPlanSchema, setGlideSchema,
  updateGovernanceSchema, createCommentarySchema, replyCommentarySchema,
  createClientUserSchema,
} from "./portal.validation.js";
import type { ClientAuthRequest } from "../../middleware/requireClientAuth.js";
import { db } from "../../db/mysql.js";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

export const portalController = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  async requestOtp(req: Request, res: Response) {
    const parsed = requestOtpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    await portalAuthService.requestOtp(parsed.data.email);
    res.json({ ok: true });
  },

  async verifyOtp(req: Request, res: Response) {
    const parsed = verifyOtpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const token = await portalAuthService.verifyOtp(parsed.data.email, parsed.data.otp);
    res.json({ token });
  },

  // ── Overview ──────────────────────────────────────────────────────────────
  async getOverview(req: ClientAuthRequest, res: Response) {
    const processes = await portalOverviewService.getOverview(req.portalUser!.processIds);
    await logAccess(req, "/portal/overview");
    res.json({ data: processes });
  },

  // ── Process KPIs ──────────────────────────────────────────────────────────
  async getKpis(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const period = (req.query.period as string) || currentPeriod();
    const scorecards = await portalKpiService.getScorecards(req.params.id, period);
    await logAccess(req, `/portal/processes/${req.params.id}/kpis`);
    res.json({ data: scorecards });
  },

  // ── Glide Paths ───────────────────────────────────────────────────────────
  async getGlidePaths(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const period = (req.query.period as string) || currentPeriod();
    const paths = await portalGlideService.getGlidePaths(req.params.id, period);
    res.json({ data: paths });
  },

  // ── Action Plans ──────────────────────────────────────────────────────────
  async getActionPlans(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const parsed = actionPlanFilterSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const items = await portalActionsService.list(req.params.id, parsed.data.metricId, parsed.data.status);
    res.json({ data: items });
  },

  // ── Governance ────────────────────────────────────────────────────────────
  async getGovernance(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const period = (req.query.period as string) || currentPeriod();
    const data = await portalGovernanceService.getChecklist(req.params.id, period);
    res.json({ data });
  },

  // ── Attrition ─────────────────────────────────────────────────────────────
  async getAttrition(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const period = (req.query.period as string) || currentPeriod();
    const data = await portalAttritionService.getAttrition(req.params.id, period);
    res.json({ data });
  },

  // ── Commentary ────────────────────────────────────────────────────────────
  async getCommentary(req: ClientAuthRequest, res: Response) {
    assertProcessAccess(req);
    const period = (req.query.period as string) || currentPeriod();
    const data = await portalCommentaryService.get(req.params.id, period);
    res.json({ data: data ?? null });
  },

  async acknowledgeCommentary(req: ClientAuthRequest, res: Response) {
    await portalCommentaryService.acknowledge(req.params.id, req.portalUser!.clientUserId);
    res.json({ ok: true });
  },

  async replyCommentary(req: ClientAuthRequest, res: Response) {
    const parsed = replyCommentarySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    await portalCommentaryService.addReply(req.params.id, req.portalUser!.clientUserId, parsed.data.text);
    res.json({ ok: true });
  },

  // ── Internal: Glide Path management ──────────────────────────────────────
  async setGlideCommitment(req: Request, res: Response) {
    const parsed = setGlideSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    await portalGlideService.setCommitment(parsed.data, (req as any).authUser?.id ?? "system");
    res.json({ ok: true });
  },

  // ── Internal: Action plan management ─────────────────────────────────────
  async createActionPlan(req: Request, res: Response) {
    const parsed = createActionPlanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const item = await portalActionsService.create(parsed.data, (req as any).authUser?.id ?? "system");
    res.status(201).json({ data: item });
  },

  async updateActionPlan(req: Request, res: Response) {
    const parsed = updateActionPlanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    await portalActionsService.update(req.params.id, parsed.data);
    res.json({ ok: true });
  },

  // ── Internal: Governance log ──────────────────────────────────────────────
  async updateGovernance(req: Request, res: Response) {
    const parsed = updateGovernanceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    await portalGovernanceService.updateLog(parsed.data, (req as any).authUser?.id ?? "system");
    res.json({ ok: true });
  },

  // ── Internal: Commentary ──────────────────────────────────────────────────
  async createCommentary(req: Request, res: Response) {
    const parsed = createCommentarySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await portalCommentaryService.create(parsed.data, (req as any).authUser?.id ?? "system");
    res.status(201).json({ data });
  },

  // ── Internal: Client user management ─────────────────────────────────────
  async createClientUser(req: Request, res: Response) {
    const parsed = createClientUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const id = randomUUID();
    await db.execute(
      "INSERT INTO client_user (id, client_id, email, name, designation, process_ids) VALUES (?, ?, ?, ?, ?, ?)",
      [id, parsed.data.clientId, parsed.data.email, parsed.data.name, parsed.data.designation ?? null, JSON.stringify(parsed.data.processIds)]
    );
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM client_user WHERE id = ? LIMIT 1", [id]);
    res.status(201).json({ data: (rows as RowDataPacket[])[0] });
  },

  async listClientUsers(_req: Request, res: Response) {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT id, client_id, email, name, designation, is_active, created_at FROM client_user ORDER BY created_at DESC");
    res.json({ data: rows });
  },
};

function assertProcessAccess(req: ClientAuthRequest) {
  if (!req.portalUser!.processIds.includes(req.params.id)) {
    throw Object.assign(new Error("Process not in your access list"), { statusCode: 403 });
  }
}

async function logAccess(req: ClientAuthRequest, page: string) {
  await db.execute(
    "INSERT INTO portal_access_log (id, client_user_id, page, ip_address) VALUES (?, ?, ?, ?)",
    [randomUUID(), req.portalUser!.clientUserId, page, req.ip ?? null]
  ).catch(() => {}); // non-fatal
}
```

- [ ] **Step 4: Write routes**

Create `backend/src/modules/portal/portal.routes.ts`:

```typescript
import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireClientAuth } from "../../middleware/requireClientAuth.js";
import { portalController as c } from "./portal.controller.js";

const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const router = Router();

// ── Public auth (no middleware) ───────────────────────────────────────────
router.post("/auth/request-otp", h(c.requestOtp));
router.post("/auth/verify-otp",  h(c.verifyOtp));

// ── Client portal (portal JWT) ────────────────────────────────────────────
router.use("/overview",              requireClientAuth);
router.use("/processes",             requireClientAuth);
router.use("/commentary",            requireClientAuth);

router.get ("/overview",                                 h(c.getOverview));
router.get ("/processes/:id/kpis",                       h(c.getKpis));
router.get ("/processes/:id/glide-paths",                h(c.getGlidePaths));
router.get ("/processes/:id/action-plans",               h(c.getActionPlans));
router.get ("/processes/:id/governance",                 h(c.getGovernance));
router.get ("/processes/:id/attrition",                  h(c.getAttrition));
router.get ("/processes/:id/commentary",                 h(c.getCommentary));
router.post("/commentary/:id/acknowledge",               h(c.acknowledgeCommentary));
router.post("/commentary/:id/reply",                     h(c.replyCommentary));

// ── Internal ops (internal staff JWT) ────────────────────────────────────
router.use("/internal", requireAuth);
router.post("/internal/glide-paths",          h(c.setGlideCommitment));
router.post("/internal/action-plans",         h(c.createActionPlan));
router.put ("/internal/action-plans/:id",     h(c.updateActionPlan));
router.post("/internal/governance",           h(c.updateGovernance));
router.post("/internal/commentary",           h(c.createCommentary));
router.get ("/internal/client-users",         h(c.listClientUsers));
router.post("/internal/client-users",         h(c.createClientUser));

export { router as portalRouter };
```

- [ ] **Step 5: Mount in app.ts**

In `backend/src/app.ts`, add:

```typescript
import { portalRouter } from "./modules/portal/portal.routes.js";
```

And add after the existing routes:

```typescript
app.use("/api/portal", portalRouter);
```

- [ ] **Step 6: Run route tests — expect PASS**

```bash
cd backend && npm test -- tests/portal.routes.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Full test suite**

```bash
cd backend && npm test
```

Expected: all existing tests still PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/portal/portal.controller.ts \
        backend/src/modules/portal/portal.routes.ts \
        backend/src/app.ts \
        backend/tests/portal.routes.test.ts
git commit -m "feat(portal): controller, routes, mount /api/portal"
```

---

## Phase 2: Frontend

### Task 10: Portal API client + auth context

**Files:**
- Create: `src/lib/portalApi.ts`
- Create: `src/components/portal/PortalRoute.tsx`

- [ ] **Step 1: Write portal API client**

Create `src/lib/portalApi.ts`:

```typescript
const HRMS_API_URL = import.meta.env.VITE_HRMS_API_URL || 'http://localhost:5055';

function getPortalToken(): string | null {
  return localStorage.getItem("portal_token");
}

export function savePortalToken(token: string) {
  localStorage.setItem("portal_token", token);
}

export function clearPortalToken() {
  localStorage.removeItem("portal_token");
}

async function portalRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getPortalToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${HRMS_API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export const portalApi = {
  requestOtp: (email: string) =>
    portalRequest<{ ok: boolean }>("POST", "/api/portal/auth/request-otp", { email }),
  verifyOtp: (email: string, otp: string) =>
    portalRequest<{ token: string }>("POST", "/api/portal/auth/verify-otp", { email, otp }),
  getOverview: () =>
    portalRequest<{ data: any[] }>("GET", "/api/portal/overview"),
  getKpis: (processId: string, period?: string) =>
    portalRequest<{ data: any[] }>("GET", `/api/portal/processes/${processId}/kpis${period ? `?period=${period}` : ""}`),
  getGlidePaths: (processId: string, period?: string) =>
    portalRequest<{ data: any[] }>("GET", `/api/portal/processes/${processId}/glide-paths${period ? `?period=${period}` : ""}`),
  getActionPlans: (processId: string, params?: { metricId?: string; status?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return portalRequest<{ data: any[] }>("GET", `/api/portal/processes/${processId}/action-plans${q ? `?${q}` : ""}`);
  },
  getGovernance: (processId: string, period?: string) =>
    portalRequest<{ data: any[] }>("GET", `/api/portal/processes/${processId}/governance${period ? `?period=${period}` : ""}`),
  getAttrition: (processId: string, period?: string) =>
    portalRequest<{ data: any }>("GET", `/api/portal/processes/${processId}/attrition${period ? `?period=${period}` : ""}`),
  getCommentary: (processId: string, period?: string) =>
    portalRequest<{ data: any }>("GET", `/api/portal/processes/${processId}/commentary${period ? `?period=${period}` : ""}`),
  acknowledgeCommentary: (commentaryId: string) =>
    portalRequest<{ ok: boolean }>("POST", `/api/portal/commentary/${commentaryId}/acknowledge`),
  replyCommentary: (commentaryId: string, text: string) =>
    portalRequest<{ ok: boolean }>("POST", `/api/portal/commentary/${commentaryId}/reply`, { text }),
};
```

- [ ] **Step 2: Write PortalRoute guard**

Create `src/components/portal/PortalRoute.tsx`:

```tsx
import { Navigate } from "react-router-dom";

function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000 > Date.now() && payload.role === "client";
  } catch {
    return false;
  }
}

export function PortalRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("portal_token");
  if (!isTokenValid(token)) return <Navigate to="/portal/login" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/portalApi.ts src/components/portal/PortalRoute.tsx
git commit -m "feat(portal): portalApi client + PortalRoute auth guard"
```

---

### Task 11: Portal login page

**Files:**
- Create: `src/pages/portal/PortalLogin.tsx`

- [ ] **Step 1: Write login page**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { portalApi, savePortalToken } from "@/lib/portalApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function PortalLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await portalApi.requestOtp(email);
      setStep("otp");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token } = await portalApi.verifyOtp(email, otp);
      savePortalToken(token);
      navigate("/portal");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <Card className="w-full max-w-sm bg-slate-900 border-slate-700">
        <CardHeader className="text-center">
          <CardTitle className="text-white text-2xl">Client Portal</CardTitle>
          <CardDescription className="text-slate-400">
            {step === "email"
              ? "Enter your email to receive a one-time password"
              : `Enter the 6-digit code sent to ${email}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "email" ? (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300">Email address</Label>
                <Input
                  id="email" type="email" value={email} autoFocus
                  onChange={e => setEmail(e.target.value)}
                  className="bg-slate-800 border-slate-600 text-white"
                  placeholder="you@company.com"
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || !email}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Send OTP
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="otp" className="text-slate-300">One-time password</Label>
                <Input
                  id="otp" type="text" value={otp} autoFocus maxLength={6}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, ""))}
                  className="bg-slate-800 border-slate-600 text-white text-center text-2xl tracking-widest"
                  placeholder="000000"
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || otp.length !== 6}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Sign in
              </Button>
              <Button type="button" variant="ghost" className="w-full text-slate-400"
                onClick={() => { setStep("email"); setOtp(""); setError(null); }}>
                Use a different email
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/portal/PortalLogin.tsx
git commit -m "feat(portal): login page with email OTP flow"
```

---

### Task 12: Portal overview page

**Files:**
- Create: `src/pages/portal/PortalOverview.tsx`

- [ ] **Step 1: Write overview page**

```tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { portalApi } from "@/lib/portalApi";
import { Loader2 } from "lucide-react";

const RAG_COLORS = { green: "border-green-500 text-green-400", amber: "border-amber-500 text-amber-400", red: "border-red-500 text-red-400" };
const RAG_DOT = { green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-500" };

export default function PortalOverview() {
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-overview"],
    queryFn: () => portalApi.getOverview(),
  });

  useEffect(() => {
    if (data?.data?.length === 1) {
      navigate(`/portal/processes/${data.data[0].process_id}`, { replace: true });
    }
  }, [data, navigate]);

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-red-400">
      Failed to load: {(error as Error).message}
    </div>
  );

  const processes = data?.data ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Account Overview</h1>
          <p className="text-slate-400 mt-1">{processes.length} active process{processes.length !== 1 ? "es" : ""}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {processes.map((p: any) => (
            <div
              key={p.process_id}
              onClick={() => navigate(`/portal/processes/${p.process_id}`)}
              className={`bg-slate-900 border-l-4 ${RAG_COLORS[p.rag as keyof typeof RAG_COLORS]} rounded-lg p-6 cursor-pointer hover:bg-slate-800 transition-colors`}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">{p.process_name}</h2>
                  <p className="text-slate-400 text-sm">{p.client_name}</p>
                </div>
                <div className={`h-3 w-3 rounded-full ${RAG_DOT[p.rag as keyof typeof RAG_DOT]}`} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {p.headline_metrics.map((m: any) => (
                  <div key={m.metric_code} className="text-center">
                    <p className="text-xs text-slate-500 mb-1">{m.metric_code}</p>
                    <p className={`text-lg font-bold ${RAG_COLORS[m.rag as keyof typeof RAG_COLORS]}`}>
                      {m.actual != null ? `${m.actual}${m.unit === "percent" ? "%" : ""}` : "—"}
                    </p>
                    <p className="text-xs text-slate-600">vs {m.target}{m.unit === "percent" ? "%" : ""}</p>
                  </div>
                ))}
              </div>
              {p.last_updated && (
                <p className="text-xs text-slate-600 mt-4">Updated {new Date(p.last_updated).toLocaleDateString()}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/portal/PortalOverview.tsx
git commit -m "feat(portal): account overview page with process cards"
```

---

### Task 13: Process dashboard — KPI + Glide Path tabs

**Files:**
- Create: `src/components/portal/KpiScorecardGrid.tsx`
- Create: `src/components/portal/GlidePathChart.tsx`
- Create: `src/pages/portal/PortalProcessDashboard.tsx`

- [ ] **Step 1: Write KPI scorecard grid**

Create `src/components/portal/KpiScorecardGrid.tsx`:

```tsx
const RAG_BORDER = { green: "border-green-500", amber: "border-amber-500", red: "border-red-500" };
const RAG_VALUE = { green: "text-green-400", amber: "text-amber-400", red: "text-red-400" };

function Sparkline({ points }: { points: Array<{ value: number }> }) {
  if (points.length < 2) return <div className="h-8" />;
  const vals = points.map(p => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const w = 80, h = 32;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="opacity-60">
      <polyline points={pts} fill="none" stroke="#60a5fa" strokeWidth="1.5" />
    </svg>
  );
}

export function KpiScorecardGrid({ scorecards }: { scorecards: any[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {scorecards.map(m => (
        <div key={m.metric_id} className={`bg-slate-800 rounded-lg p-4 border-l-4 ${RAG_BORDER[m.rag as keyof typeof RAG_BORDER]}`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider">{m.metric_code}</p>
              <p className="text-sm text-slate-300 mt-0.5">{m.metric_name}</p>
            </div>
            <div className={`text-xs font-semibold px-2 py-0.5 rounded ${
              m.rag === "green" ? "bg-green-900 text-green-300" :
              m.rag === "amber" ? "bg-amber-900 text-amber-300" :
              "bg-red-900 text-red-300"}`}>
              {m.achievement_pct.toFixed(1)}%
            </div>
          </div>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className={`text-2xl font-bold ${RAG_VALUE[m.rag as keyof typeof RAG_VALUE]}`}>
                {m.actual != null ? m.actual : "—"}{m.unit === "percent" ? "%" : m.unit === "seconds" ? "s" : ""}
              </p>
              <p className="text-xs text-slate-500">Target: {m.target}{m.unit === "percent" ? "%" : ""}</p>
            </div>
            <Sparkline points={m.sparkline} />
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write glide path chart**

Create `src/components/portal/GlidePathChart.tsx`:

```tsx
export function GlidePathChart({ path }: { path: any }) {
  const points = path.points as Array<{ month: string; actual: number | null; committed: number | null; target: number }>;
  if (points.length === 0) return null;

  const allVals = points.flatMap(p => [p.actual, p.committed, p.target].filter(v => v != null) as number[]);
  const minV = Math.min(...allVals), maxV = Math.max(...allVals);
  const range = maxV - minV || 1;
  const W = 480, H = 160, PAD = 40;
  const iW = W - PAD * 2, iH = H - PAD * 2;

  const x = (i: number) => PAD + (i / (points.length - 1)) * iW;
  const y = (v: number) => PAD + iH - ((v - minV) / range) * iH;

  const linePts = (getter: (p: typeof points[0]) => number | null) =>
    points.reduce<string[]>((acc, p, i) => {
      const v = getter(p);
      if (v != null) acc.push(`${x(i)},${y(v)}`);
      return acc;
    }, []).join(" ");

  const todayIdx = (() => {
    const today = new Date().toISOString().slice(0, 7);
    const i = points.findIndex(p => p.month >= today);
    return i === -1 ? points.length - 1 : i;
  })();

  return (
    <div className="bg-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-white">{path.metric_name}</p>
          <p className="text-xs text-slate-500">{path.unit}</p>
        </div>
        {path.behind_commitment && (
          <span className="text-xs bg-amber-900 text-amber-300 px-2 py-0.5 rounded">Tracking Behind Commitment</span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 160 }}>
        {/* Today marker */}
        <line x1={x(todayIdx)} y1={PAD} x2={x(todayIdx)} y2={H - PAD} stroke="#475569" strokeDasharray="4,4" strokeWidth="1" />
        {/* Target line */}
        <polyline points={linePts(p => p.target)} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeDasharray="4,4" />
        {/* Committed line */}
        <polyline points={linePts(p => p.committed)} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="8,4" />
        {/* Actual line */}
        <polyline points={linePts(p => p.actual)} fill="none" stroke="#3b82f6" strokeWidth="2" />
        {/* X-axis labels */}
        {points.map((p, i) => (
          <text key={p.month} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#64748b">
            {p.month.slice(5)}
          </text>
        ))}
      </svg>
      <div className="flex gap-4 mt-2 text-xs">
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-blue-500 inline-block" /> Actual</span>
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-amber-500 inline-block border-dashed" /> Committed</span>
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-green-500 inline-block" /> Target</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write process dashboard shell**

Create `src/pages/portal/PortalProcessDashboard.tsx`:

```tsx
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { portalApi } from "@/lib/portalApi";
import { KpiScorecardGrid } from "@/components/portal/KpiScorecardGrid";
import { GlidePathChart } from "@/components/portal/GlidePathChart";
import { Loader2 } from "lucide-react";

const TABS = ["Performance", "Glide Paths", "Action Plans", "Governance", "Attrition", "Commentary"] as const;
type Tab = typeof TABS[number];

function currentPeriod() { return new Date().toISOString().slice(0, 7); }

export default function PortalProcessDashboard() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("Performance");
  const period = currentPeriod();

  const kpis = useQuery({ queryKey: ["portal-kpis", id, period], queryFn: () => portalApi.getKpis(id!, period), enabled: tab === "Performance" });
  const glide = useQuery({ queryKey: ["portal-glide", id, period], queryFn: () => portalApi.getGlidePaths(id!, period), enabled: tab === "Glide Paths" });
  const actions = useQuery({ queryKey: ["portal-actions", id], queryFn: () => portalApi.getActionPlans(id!), enabled: tab === "Action Plans" });
  const governance = useQuery({ queryKey: ["portal-gov", id, period], queryFn: () => portalApi.getGovernance(id!, period), enabled: tab === "Governance" });
  const attrition = useQuery({ queryKey: ["portal-attrition", id, period], queryFn: () => portalApi.getAttrition(id!, period), enabled: tab === "Attrition" });
  const commentary = useQuery({ queryKey: ["portal-commentary", id, period], queryFn: () => portalApi.getCommentary(id!, period), enabled: tab === "Commentary" });

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Tab bar */}
      <div className="border-b border-slate-800 sticky top-0 bg-slate-950 z-10">
        <div className="max-w-6xl mx-auto px-8 flex gap-1 overflow-x-auto">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-4 text-sm whitespace-nowrap border-b-2 transition-colors ${
                tab === t ? "border-blue-500 text-blue-400" : "border-transparent text-slate-500 hover:text-slate-300"
              }`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-6xl mx-auto px-8 py-8">
        {tab === "Performance" && (
          kpis.isLoading ? <Loader2 className="h-6 w-6 animate-spin text-blue-400" /> :
          <KpiScorecardGrid scorecards={kpis.data?.data ?? []} />
        )}
        {tab === "Glide Paths" && (
          glide.isLoading ? <Loader2 className="h-6 w-6 animate-spin text-blue-400" /> :
          (glide.data?.data ?? []).length === 0
            ? <p className="text-slate-400">All metrics are on track — no glide paths to show.</p>
            : <div className="grid gap-6">{(glide.data?.data ?? []).map((p: any) => <GlidePathChart key={p.metric_id} path={p} />)}</div>
        )}
        {tab === "Action Plans" && <ActionPlansTab data={actions.data?.data ?? []} loading={actions.isLoading} />}
        {tab === "Governance" && <GovernanceTab data={governance.data?.data ?? []} loading={governance.isLoading} />}
        {tab === "Attrition" && <AttritionTab data={attrition.data?.data} loading={attrition.isLoading} />}
        {tab === "Commentary" && <CommentaryTab data={commentary.data?.data} loading={commentary.isLoading} processId={id!} period={period} />}
      </div>
    </div>
  );
}

function ActionPlansTab({ data, loading }: { data: any[]; loading: boolean }) {
  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-blue-400" />;
  const byMetric = data.reduce((acc, item) => {
    const key = item.metric_code;
    if (!acc[key]) acc[key] = { name: item.metric_name, items: [] };
    acc[key].items.push(item);
    return acc;
  }, {} as Record<string, { name: string; items: any[] }>);

  const STATUS_COLOR: Record<string, string> = { planned: "text-slate-400", in_progress: "text-blue-400", done: "text-green-400", delayed: "text-red-400" };
  const LEVEL_LABEL: Record<string, string> = { analyst: "Analyst", tl: "TL", process_manager: "PM", branch_head: "BH" };

  return (
    <div className="space-y-6">
      {Object.entries(byMetric).map(([code, { name, items }]: any) => (
        <div key={code} className="bg-slate-900 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-slate-800 border-b border-slate-700">
            <p className="text-sm font-semibold text-white">{name} <span className="text-slate-500 font-normal">({code})</span></p>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500 text-xs">
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Owner</th>
              <th className="px-4 py-2">Due</th>
              <th className="px-4 py-2">Status</th>
            </tr></thead>
            <tbody>
              {items.map((item: any) => (
                <tr key={item.id} className="border-t border-slate-800">
                  <td className="px-4 py-3 text-slate-300">{item.action_text}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded mr-1">{LEVEL_LABEL[item.owner_level]}</span>
                    <span className="text-slate-400">{item.owner_name}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{item.due_date}</td>
                  <td className={`px-4 py-3 capitalize font-medium ${STATUS_COLOR[item.status]}`}>{item.status.replace("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {data.length === 0 && <p className="text-slate-400">No action plans found.</p>}
    </div>
  );
}

function GovernanceTab({ data, loading }: { data: any[]; loading: boolean }) {
  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-blue-400" />;
  const LEVELS = ["analyst", "tl", "process_manager", "branch_head"] as const;
  const LEVEL_LABEL: Record<string, string> = { analyst: "Analyst", tl: "Team Leader", process_manager: "Process Manager", branch_head: "Branch Head" };
  const byLevel = LEVELS.reduce((acc, l) => { acc[l] = data.filter((a: any) => a.level === l); return acc; }, {} as Record<string, any[]>);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {LEVELS.map(level => {
        const activities = byLevel[level];
        const overall = activities.length ? Math.round(activities.reduce((s: number, a: any) => s + a.completion_pct, 0) / activities.length) : 0;
        return (
          <div key={level} className="bg-slate-900 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
              <p className="text-sm font-semibold text-white">{LEVEL_LABEL[level]}</p>
              <span className={`text-xs font-semibold ${overall >= 100 ? "text-green-400" : overall >= 70 ? "text-amber-400" : "text-red-400"}`}>{overall}%</span>
            </div>
            <div className="divide-y divide-slate-800">
              {activities.map((a: any) => (
                <div key={a.activity_id} className="px-4 py-3">
                  <p className="text-xs text-slate-300 mb-1">{a.activity_name}</p>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{a.completed_count}/{a.required_count}</span>
                    <span className={a.rag === "green" ? "text-green-400" : a.rag === "amber" ? "text-amber-400" : "text-red-400"}>{a.completion_pct}%</span>
                  </div>
                  <div className="mt-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${a.rag === "green" ? "bg-green-500" : a.rag === "amber" ? "bg-amber-500" : "bg-red-500"}`}
                      style={{ width: `${Math.min(a.completion_pct, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AttritionTab({ data, loading }: { data: any; loading: boolean }) {
  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-blue-400" />;
  if (!data) return <p className="text-slate-400">No attrition data available for this period.</p>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Attrition", value: `${data.attrition_pct}%`, sub: `${data.voluntary_count} voluntary / ${data.involuntary_count} involuntary` },
          { label: "Headcount", value: data.headcount, sub: `of ${data.sanctioned_strength} sanctioned` },
          { label: "Open Positions", value: data.open_positions },
          { label: "Avg Tenure", value: `${data.avg_tenure_months}m` },
        ].map(card => (
          <div key={card.label} className="bg-slate-900 rounded-lg p-4">
            <p className="text-xs text-slate-500 mb-1">{card.label}</p>
            <p className="text-2xl font-bold text-white">{card.value}</p>
            {card.sub && <p className="text-xs text-slate-500 mt-1">{card.sub}</p>}
          </div>
        ))}
      </div>
      {data.top_exit_reasons.length > 0 && (
        <div className="bg-slate-900 rounded-lg p-4">
          <p className="text-sm font-semibold text-white mb-3">Top Exit Reasons</p>
          {data.top_exit_reasons.map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-3 mb-2">
              <span className="text-xs text-slate-400 w-32 truncate">{r.reason}</span>
              <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(r.count / data.top_exit_reasons[0].count) * 100}%` }} />
              </div>
              <span className="text-xs text-slate-400 w-6 text-right">{r.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommentaryTab({ data, loading, processId, period }: { data: any; loading: boolean; processId: string; period: string }) {
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-blue-400" />;
  if (!data) return <p className="text-slate-400">No management commentary published for this period.</p>;

  async function handleAcknowledge() {
    setBusy(true);
    try { await portalApi.acknowledgeCommentary(data.id); window.location.reload(); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await portalApi.replyCommentary(data.id, replyText); setReplyText(""); window.location.reload(); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-slate-900 rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="font-semibold text-white">{data.author_name}</p>
            <p className="text-xs text-slate-500">{data.author_designation} · {new Date(data.published_at).toLocaleDateString()}</p>
          </div>
          {data.acknowledged_at
            ? <span className="text-xs bg-green-900 text-green-300 px-3 py-1 rounded-full">Acknowledged</span>
            : <span className="text-xs bg-amber-900 text-amber-300 px-3 py-1 rounded-full">Awaiting Acknowledgement</span>
          }
        </div>
        <div className="text-slate-300 text-sm whitespace-pre-line leading-relaxed">{data.body}</div>
        {!data.acknowledged_at && (
          <button onClick={handleAcknowledge} disabled={busy}
            className="mt-4 px-4 py-2 bg-green-700 hover:bg-green-600 text-white text-sm rounded-lg disabled:opacity-50">
            {busy ? "Processing..." : "Acknowledge & Accept"}
          </button>
        )}
      </div>

      {data.replies.length > 0 && (
        <div className="space-y-3">
          {data.replies.map((r: any) => (
            <div key={r.id} className="bg-slate-800 rounded-lg p-4 ml-8">
              <p className="text-xs text-slate-500 mb-2">Your team · {new Date(r.created_at).toLocaleDateString()}</p>
              <p className="text-sm text-slate-300">{r.reply_text}</p>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleReply} className="space-y-3">
        <textarea value={replyText} onChange={e => setReplyText(e.target.value)} maxLength={1000}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-white placeholder-slate-500 resize-none"
          rows={3} placeholder="Add a comment (visible to operations team)…" />
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">{replyText.length}/1000</span>
          <button type="submit" disabled={busy || !replyText.trim()}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50">
            {busy ? "Sending…" : "Send Comment"}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/portal/ src/pages/portal/PortalProcessDashboard.tsx
git commit -m "feat(portal): process dashboard — all 6 tabs"
```

---

### Task 14: Wire routes into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports and routes**

In `src/App.tsx`, add imports after existing imports:

```tsx
import PortalLogin from "./pages/portal/PortalLogin";
import PortalOverview from "./pages/portal/PortalOverview";
import PortalProcessDashboard from "./pages/portal/PortalProcessDashboard";
import { PortalRoute } from "./components/portal/PortalRoute";
```

Add routes before the `<Route path="*"` catch-all:

```tsx
<Route path="/portal/login" element={<PortalLogin />} />
<Route path="/portal" element={<PortalRoute><PortalOverview /></PortalRoute>} />
<Route path="/portal/processes/:id" element={<PortalRoute><PortalProcessDashboard /></PortalRoute>} />
```

- [ ] **Step 2: Typecheck frontend**

```bash
cd /home/shuvam/mas-callnet-hrms && npx tsc --noEmit
```

Expected: no errors. Fix any import/type issues before proceeding.

- [ ] **Step 3: Full backend test suite**

```bash
cd backend && npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(portal): wire /portal/* routes into App.tsx"
```

---

## Post-build Checklist

- [ ] SQL migration run on dev database
- [ ] `PORTAL_JWT_SECRET` set in `.env` (min 32 chars)
- [ ] SMTP credentials set in `.env` (or left blank for local dev — OTP logged to console instead)
- [ ] Create a test `client_master` row and a `client_user` row pointing to a process
- [ ] Hit `POST /api/portal/auth/request-otp` with that email → check server logs for OTP (if no SMTP)
- [ ] Hit `POST /api/portal/auth/verify-otp` → get token
- [ ] Hit `GET /api/portal/overview` with `Authorization: Bearer <token>` → confirm process cards return
- [ ] Open `/portal/login` in browser → complete OTP flow → land on overview

---

## Known Limitations (v1)

- `portal.overview.service.ts` uses a loose template JOIN (`LIKE CONCAT('%', process_name, '%')`). A proper `process_template_assignment` table (linking `process_master` to `kpi_template`) should replace this in v2.
- `portal.attrition.service.ts` uses `.catch(() => ...)` fallbacks because `exit_records` table schema is not yet confirmed. Verify against `011_exit_management.sql` and update the column names if needed.
- No real-time notifications. When client acknowledges/replies, ops team must refresh their internal view manually.
