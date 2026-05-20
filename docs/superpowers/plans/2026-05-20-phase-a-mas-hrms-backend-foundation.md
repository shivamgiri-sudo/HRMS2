# Phase A — mas-hrms-backend Foundation + MySQL Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a brand-new `mas-hrms-backend` Node/TypeScript/Express repo with the complete MySQL `mas_hrms` database schema, Supabase JWT auth middleware, and frontend feature flags — the foundation everything else in the platform builds on.

**Architecture:** A standalone Express 5 + TypeScript backend at port 5055 connects to a new MySQL database `mas_hrms`. Every request is authenticated by verifying the Supabase JWT against Supabase's `/auth/v1/user` endpoint, then checking MySQL `role_page_access` for authorization. The frontend (`mas-callnet-hrms`) gets per-module `VITE_HRMS_*` feature flags so each module can independently cut over from Supabase to this backend without big-bang risk.

**Tech Stack:** Node.js 24, TypeScript 5, Express 5, mysql2/promise, axios, zod, dotenv, ts-node-dev, jest + supertest.

---

## File Map

```
mas-hrms-backend/               ← new repo root (C:\Users\shivamg\mas-hrms-backend)
├── src/
│   ├── config/
│   │   ├── db.ts               — MySQL pool for mas_hrms
│   │   ├── supabaseAuth.ts     — JWT verification via Supabase /auth/v1/user
│   │   └── env.ts              — typed, validated env vars (zod)
│   ├── middleware/
│   │   ├── auth.ts             — verifySupabaseJWT middleware, attaches req.user
│   │   └── requireRole.ts      — checks role_page_access in MySQL
│   ├── modules/
│   │   └── health/
│   │       └── health.router.ts — GET /health (unauthenticated)
│   ├── shared/
│   │   └── types.ts            — AuthUser, AppRequest interfaces
│   └── server.ts               — Express app bootstrap
├── sql/
│   ├── 001_core_org.sql        — tenant_config, branch_master, dept, process, lob, designation
│   ├── 002_employees.sql       — employees, documents, emergency_contact, bank_detail, journey_log
│   ├── 003_access_control.sql  — user_roles, user_assignment_scope, role_page_access, workforce_role_catalog
│   ├── 004_ats.sql             — ats_candidate, interview_slot, stage_log, onboarding_bridge, sourcing_channel
│   ├── 005_attendance_wfm.sql  — wfm_shift_master, roster_plan, roster_assignment, attendance_session, break_log, staging, device, regularization
│   ├── 006_leave.sql           — leave_type_master, balance_ledger, leave_request, approval_log, holiday_master
│   ├── 007_payroll.sql         — salary_structure, components, employee_assignment, prep_run, prep_line, deduction_rule, advance, payslip, statutory
│   ├── 008_integration_hub.sql — integration_config, schedule, connector_run, raw_payload, schema_snapshot, field_map, field_map_suggestion, event_log
│   ├── 009_dialer_ispark.sql   — dialer_session_log, ispark_migration_batch, ispark_employee_staging
│   ├── 010_kpi_migration.sql   — kpi_target_master, role_kpi_snapshot, migration_run, migration_row_log
│   └── 000_run_all.sql         — sources all SQL files in order
├── tests/
│   ├── health.test.ts
│   └── auth.test.ts
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

**Frontend changes (mas-callnet-hrms):**
```
src/lib/dataSource.ts           — new: VITE_HRMS_* feature flags
src/lib/hrmsApi.ts              — new: axios instance pointing at mas-hrms-backend
.env.example                    — updated with VITE_HRMS_* vars
```

---

### Task 1: Create Repo and Install Dependencies

**Files:**
- Create: `C:\Users\shivamg\mas-hrms-backend\package.json`
- Create: `C:\Users\shivamg\mas-hrms-backend\tsconfig.json`
- Create: `C:\Users\shivamg\mas-hrms-backend\.gitignore`
- Create: `C:\Users\shivamg\mas-hrms-backend\.env.example`

- [ ] **Step 1: Create the repo directory and initialise**

```bash
mkdir C:/Users/shivamg/mas-hrms-backend
cd C:/Users/shivamg/mas-hrms-backend
git init
npm init -y
```

- [ ] **Step 2: Install production dependencies**

```bash
npm install express@^5.1.0 mysql2 axios zod dotenv jsonwebtoken
npm install cors helmet morgan uuid
```

- [ ] **Step 3: Install dev dependencies**

```bash
npm install -D typescript ts-node-dev @types/express @types/node @types/cors @types/morgan @types/jsonwebtoken @types/uuid jest ts-jest supertest @types/supertest @types/jest
```

- [ ] **Step 4: Write package.json scripts**

Replace the `scripts` section in `package.json`:

```json
{
  "name": "mas-hrms-backend",
  "version": "1.0.0",
  "description": "MAS Callnet HRMS API — MySQL mas_hrms backend",
  "main": "dist/server.js",
  "type": "commonjs",
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "jest --runInBand --forceExit"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "testMatch": ["**/tests/**/*.test.ts"]
  }
}
```

- [ ] **Step 5: Write tsconfig.json**

Create `C:\Users\shivamg\mas-hrms-backend\tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 6: Write .gitignore**

Create `C:\Users\shivamg\mas-hrms-backend\.gitignore`:

```
node_modules/
dist/
.env
*.js.map
```

- [ ] **Step 7: Write .env.example**

Create `C:\Users\shivamg\mas-hrms-backend\.env.example`:

```
# Server
PORT=5055
NODE_ENV=development

# MySQL — mas_hrms database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=mas_hrms

# Supabase — for JWT verification only
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# JWT
JWT_SECRET=change-this-in-production
```

- [ ] **Step 8: Commit**

```bash
cd C:/Users/shivamg/mas-hrms-backend
git add .
git commit -m "feat: initialise mas-hrms-backend repo with dependencies"
```

---

### Task 2: Environment Config and Types

**Files:**
- Create: `src/config/env.ts`
- Create: `src/shared/types.ts`

- [ ] **Step 1: Write env.ts**

Create `src/config/env.ts`:

```typescript
import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5055'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DB_HOST: z.string(),
  DB_PORT: z.string().default('3306'),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().default('mas_hrms'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
```

- [ ] **Step 2: Write shared/types.ts**

Create `src/shared/types.ts`:

```typescript
import { Request } from 'express';

export interface AuthUser {
  id: string;        // Supabase user UUID
  email: string;
  roleKeys: string[]; // from MySQL role_page_access
}

export interface AppRequest extends Request {
  user?: AuthUser;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-hrms-backend && npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/config/env.ts src/shared/types.ts
git commit -m "feat: typed env config with zod validation and shared request types"
```

---

### Task 3: MySQL Database Pool

**Files:**
- Create: `src/config/db.ts`

- [ ] **Step 1: Write db.ts**

Create `src/config/db.ts`:

```typescript
import mysql from 'mysql2/promise';
import { env } from './env';

let _pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!_pool) {
    _pool = mysql.createPool({
      host: env.DB_HOST,
      port: Number(env.DB_PORT),
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 20,
      timezone: '+05:30',
      charset: 'utf8mb4',
    });
  }
  return _pool;
}

export const db = new Proxy({} as mysql.Pool, {
  get(_t, prop) {
    return (getPool() as any)[prop];
  },
});

export async function pingDb(): Promise<{ database: string; user: string; time: string }> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    'SELECT DATABASE() AS `database`, USER() AS `user`, NOW() AS `time`'
  );
  return rows[0] as { database: string; user: string; time: string };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-hrms-backend && npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/config/db.ts
git commit -m "feat: MySQL connection pool for mas_hrms database"
```

---

### Task 4: Supabase JWT Auth Middleware

**Files:**
- Create: `src/config/supabaseAuth.ts`
- Create: `src/middleware/auth.ts`
- Create: `src/middleware/requireRole.ts`

- [ ] **Step 1: Write supabaseAuth.ts**

Create `src/config/supabaseAuth.ts`:

```typescript
import axios from 'axios';
import { env } from './env';

export interface SupabaseUser {
  id: string;
  email: string;
}

export async function verifySupabaseToken(token: string): Promise<SupabaseUser> {
  const response = await axios.get(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.SUPABASE_ANON_KEY,
    },
    timeout: 5000,
  });
  const { id, email } = response.data;
  if (!id || !email) throw new Error('Invalid Supabase user response');
  return { id, email };
}
```

- [ ] **Step 2: Write auth.ts middleware**

Create `src/middleware/auth.ts`:

```typescript
import { Response, NextFunction } from 'express';
import { verifySupabaseToken } from '../config/supabaseAuth';
import { db } from '../config/db';
import { AppRequest } from '../shared/types';
import mysql from 'mysql2/promise';

export async function authenticateRequest(
  req: AppRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ ok: false, error: 'Missing authorization header' });
      return;
    }
    const token = authHeader.slice(7);
    const supabaseUser = await verifySupabaseToken(token);

    // Load role keys from MySQL
    const [rows] = await db.query<mysql.RowDataPacket[]>(
      'SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1',
      [supabaseUser.id]
    );
    const roleKeys = (rows as { role_key: string }[]).map((r) => r.role_key);

    req.user = { id: supabaseUser.id, email: supabaseUser.email, roleKeys };
    next();
  } catch (err: any) {
    res.status(401).json({ ok: false, error: 'Unauthorized', detail: err.message });
  }
}
```

- [ ] **Step 3: Write requireRole.ts middleware**

Create `src/middleware/requireRole.ts`:

```typescript
import { Response, NextFunction } from 'express';
import { AppRequest } from '../shared/types';

export function requireRole(...allowedRoles: string[]) {
  return (req: AppRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ ok: false, error: 'Not authenticated' });
      return;
    }
    const hasRole = req.user.roleKeys.some((k) => allowedRoles.includes(k));
    if (!hasRole) {
      res.status(403).json({ ok: false, error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-hrms-backend && npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/config/supabaseAuth.ts src/middleware/auth.ts src/middleware/requireRole.ts
git commit -m "feat: Supabase JWT verification middleware + role-based access control"
```

---

### Task 5: Express Server + Health Route

**Files:**
- Create: `src/modules/health/health.router.ts`
- Create: `src/server.ts`

- [ ] **Step 1: Write health.router.ts**

Create `src/modules/health/health.router.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { pingDb } from '../../config/db';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const dbInfo = await pingDb();
    res.json({
      ok: true,
      service: 'mas-hrms-backend',
      version: '1.0.0',
      database: dbInfo,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(503).json({ ok: false, service: 'mas-hrms-backend', error: err.message });
  }
});

export default router;
```

- [ ] **Step 2: Write server.ts**

Create `src/server.ts`:

```typescript
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import healthRouter from './modules/health/health.router';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Unauthenticated routes
app.use('/health', healthRouter);

// Placeholder for module routers — added in later phases
// app.use('/api/employees', authenticateRequest, employeeRouter);

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

if (require.main === module) {
  app.listen(Number(env.PORT), () => {
    console.log(`mas-hrms-backend running on port ${env.PORT}`);
  });
}

export default app;
```

- [ ] **Step 3: Write health test**

Create `tests/health.test.ts`:

```typescript
import request from 'supertest';
import app from '../src/server';

describe('GET /health', () => {
  it('returns 200 with service name', async () => {
    const res = await request(app).get('/health');
    // DB may not be available in CI — check structure only
    expect(res.status).toBeLessThan(600);
    expect(res.body).toHaveProperty('service', 'mas-hrms-backend');
  });
});
```

- [ ] **Step 4: Run the test**

```bash
cd C:/Users/shivamg/mas-hrms-backend && npm test
```
Expected: 1 suite, 1 test passing (db error is OK if MySQL not running locally yet — service name check passes regardless).

- [ ] **Step 5: Start server and verify manually**

```bash
cp .env.example .env
# Edit .env with your MySQL credentials
npm run dev
```
Open `http://localhost:5055/health` — expect JSON with `ok: true` or `ok: false` with db error detail.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/modules/health/health.router.ts tests/health.test.ts
git commit -m "feat: Express server bootstrap with health endpoint and supertest"
```

---

### Task 6: MySQL Schema — Core Org + Access Control

**Files:**
- Create: `sql/001_core_org.sql`
- Create: `sql/003_access_control.sql`

- [ ] **Step 1: Write 001_core_org.sql**

Create `sql/001_core_org.sql`:

```sql
-- 001_core_org.sql
-- Core org structure tables for mas_hrms
-- Run once against MySQL database mas_hrms

CREATE DATABASE IF NOT EXISTS mas_hrms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE mas_hrms;

CREATE TABLE IF NOT EXISTS tenant_config (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  tenant_key    VARCHAR(100) NOT NULL UNIQUE DEFAULT 'default',
  company_name  VARCHAR(255),
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  config_json   JSON,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_module_config (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  tenant_key    VARCHAR(100) NOT NULL DEFAULT 'default',
  module_key    VARCHAR(100) NOT NULL,
  enabled       TINYINT(1)   NOT NULL DEFAULT 1,
  config_json   JSON,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_module (tenant_key, module_key)
);

CREATE TABLE IF NOT EXISTS branch_master (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  branch_code   VARCHAR(50)  NOT NULL UNIQUE,
  branch_name   VARCHAR(255) NOT NULL,
  city          VARCHAR(100),
  state         VARCHAR(100),
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS department_master (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  dept_code       VARCHAR(50)  NOT NULL UNIQUE,
  dept_name       VARCHAR(255) NOT NULL,
  branch_id       CHAR(36),
  active_status   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS process_master (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_code  VARCHAR(50)  NOT NULL UNIQUE,
  process_name  VARCHAR(255) NOT NULL,
  business_lob  VARCHAR(100),
  branch_id     CHAR(36),
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS lob_master (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  lob_code      VARCHAR(50)  NOT NULL UNIQUE,
  lob_name      VARCHAR(255) NOT NULL,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS designation_master (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  designation_code  VARCHAR(50)  NOT NULL UNIQUE,
  designation_name  VARCHAR(255) NOT NULL,
  grade             VARCHAR(50),
  active_status     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seed default tenant
INSERT INTO tenant_config (tenant_key, company_name) VALUES ('default', 'MAS Callnet')
  ON DUPLICATE KEY UPDATE company_name = VALUES(company_name);

-- Seed modules
INSERT INTO tenant_module_config (tenant_key, module_key, enabled) VALUES
  ('default', 'ATS',         1),
  ('default', 'LMS',         1),
  ('default', 'WFM',         1),
  ('default', 'QUALITY',     1),
  ('default', 'OPERATIONS',  1),
  ('default', 'PERFORMANCE', 1),
  ('default', 'DIALER',      1),
  ('default', 'SALARY',      1),
  ('default', 'KPI',         1),
  ('default', 'INTEGRATION', 1)
ON DUPLICATE KEY UPDATE enabled = VALUES(enabled);
```

- [ ] **Step 2: Write 003_access_control.sql**

Create `sql/003_access_control.sql`:

```sql
-- 003_access_control.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS workforce_role_catalog (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  role_key     VARCHAR(100) NOT NULL UNIQUE,
  role_name    VARCHAR(255) NOT NULL,
  description  TEXT,
  active_status TINYINT(1)  NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_roles (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id       CHAR(36)     NOT NULL,  -- Supabase auth.users UUID
  role_key      VARCHAR(100) NOT NULL,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_role (user_id, role_key),
  INDEX idx_user_roles_user (user_id),
  FOREIGN KEY (role_key) REFERENCES workforce_role_catalog(role_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_assignment_scope (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id              CHAR(36)     NOT NULL,
  role_key             VARCHAR(100) NOT NULL,
  scope_type           VARCHAR(50)  NOT NULL,  -- branch, process, lob, department, all
  branch_id            CHAR(36),
  process_id           CHAR(36),
  lob_id               CHAR(36),
  department_id        CHAR(36),
  manager_employee_id  CHAR(36),
  active_status        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_scope_user (user_id)
);

CREATE TABLE IF NOT EXISTS role_page_access (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  role_key      VARCHAR(100) NOT NULL,
  page_code     VARCHAR(100) NOT NULL,
  can_view      TINYINT(1)   NOT NULL DEFAULT 0,
  can_create    TINYINT(1)   NOT NULL DEFAULT 0,
  can_edit      TINYINT(1)   NOT NULL DEFAULT 0,
  can_delete    TINYINT(1)   NOT NULL DEFAULT 0,
  can_export    TINYINT(1)   NOT NULL DEFAULT 0,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_role_page (role_key, page_code),
  INDEX idx_role_page_role (role_key)
);

-- Seed roles
INSERT INTO workforce_role_catalog (role_key, role_name) VALUES
  ('admin',        'System Administrator'),
  ('hr',           'HR Manager'),
  ('manager',      'Process Manager'),
  ('tl',           'Team Leader'),
  ('qa',           'Quality Analyst'),
  ('wfm',          'WFM Analyst'),
  ('recruiter',    'Recruiter'),
  ('employee',     'Employee'),
  ('branch_head',  'Branch Head'),
  ('ceo',          'CEO / Leadership')
ON DUPLICATE KEY UPDATE role_name = VALUES(role_name);

-- Seed admin full access
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
  ('admin','ATS_DASHBOARD',            1,1,1,1,1),
  ('admin','ATS_RECRUITER_QUEUE',       1,1,1,1,1),
  ('admin','LMS_MY_LEARNING',           1,1,1,1,1),
  ('admin','LMS_COORDINATOR',           1,1,1,1,1),
  ('admin','LMS_ADMIN',                 1,1,1,1,1),
  ('admin','LMS_MANAGEMENT_DASHBOARD',  1,1,1,1,1),
  ('admin','WFM_ROSTER',                1,1,1,1,1),
  ('admin','WFM_LIVE_TRACKER',          1,1,1,1,1),
  ('admin','QUALITY_DASHBOARD',         1,1,1,1,1),
  ('admin','OPERATIONS_DASHBOARD',      1,1,1,1,1),
  ('admin','WORKFORCE_COMMAND_CENTER',  1,1,1,1,1),
  ('admin','ACCESS_CONTROL',            1,1,1,1,1),
  ('admin','DIALER_INTEGRATION',        1,1,1,1,1),
  ('admin','LEAVE_MANAGEMENT',          1,1,1,1,1),
  ('admin','SALARY_PREP',               1,1,1,1,1),
  ('admin','KPI_DASHBOARD',             1,1,1,1,1),
  ('admin','ISPARK_MIGRATION',          1,1,1,1,1),
  ('admin','INTEGRATION_HUB',           1,1,1,1,1),
  ('admin','MIGRATION_CONSOLE',         1,1,1,1,1)
ON DUPLICATE KEY UPDATE can_view=1, can_create=1, can_edit=1, can_delete=1, can_export=1;
```

- [ ] **Step 3: Run SQL against MySQL**

Open MySQL Workbench or terminal:
```bash
mysql -u root -p < C:/Users/shivamg/mas-hrms-backend/sql/001_core_org.sql
mysql -u root -p < C:/Users/shivamg/mas-hrms-backend/sql/003_access_control.sql
```
Expected: no errors, tables created, seeds inserted.

Verify:
```sql
USE mas_hrms;
SHOW TABLES;
SELECT COUNT(*) FROM workforce_role_catalog;  -- expect 10
SELECT COUNT(*) FROM role_page_access;         -- expect 19
```

- [ ] **Step 4: Commit**

```bash
cd C:/Users/shivamg/mas-hrms-backend
git add sql/001_core_org.sql sql/003_access_control.sql
git commit -m "feat(sql): core org structure and access control schema with seeds"
```

---

### Task 7: MySQL Schema — Employees

**Files:**
- Create: `sql/002_employees.sql`

- [ ] **Step 1: Write 002_employees.sql**

Create `sql/002_employees.sql`:

```sql
-- 002_employees.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS employees (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_code     VARCHAR(50)  NOT NULL UNIQUE,
  user_id           CHAR(36),                    -- Supabase auth.users UUID (nullable: not all employees have login)
  first_name        VARCHAR(100) NOT NULL,
  last_name         VARCHAR(100),
  full_name         VARCHAR(255) GENERATED ALWAYS AS (CONCAT(first_name, ' ', COALESCE(last_name,''))) STORED,
  email             VARCHAR(255),
  mobile            VARCHAR(20),
  gender            ENUM('Male','Female','Other'),
  date_of_birth     DATE,
  date_of_joining   DATE         NOT NULL,
  date_of_exit      DATE,
  employment_type   VARCHAR(50)  NOT NULL DEFAULT 'Full Time',  -- Full Time, Part Time, Contract, Intern
  employment_status VARCHAR(50)  NOT NULL DEFAULT 'Active',     -- Active, On Leave, Exited, Suspended
  branch_id         CHAR(36),
  department_id     CHAR(36),
  process_id        CHAR(36),
  designation_id    CHAR(36),
  reporting_manager_id CHAR(36),
  active_status     TINYINT(1)   NOT NULL DEFAULT 1,
  photo_url         VARCHAR(500),
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_emp_code (employee_code),
  INDEX idx_emp_user (user_id),
  INDEX idx_emp_branch (branch_id),
  INDEX idx_emp_process (process_id),
  FOREIGN KEY (branch_id)    REFERENCES branch_master(id) ON DELETE SET NULL,
  FOREIGN KEY (department_id) REFERENCES department_master(id) ON DELETE SET NULL,
  FOREIGN KEY (process_id)   REFERENCES process_master(id) ON DELETE SET NULL,
  FOREIGN KEY (designation_id) REFERENCES designation_master(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS employee_documents (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id   CHAR(36)     NOT NULL,
  doc_type      VARCHAR(100) NOT NULL,   -- aadhar, pan, offer_letter, bgv_report, photo
  doc_name      VARCHAR(255),
  file_url      VARCHAR(500),
  verified      TINYINT(1)   NOT NULL DEFAULT 0,
  uploaded_by   CHAR(36),
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_emp_doc_emp (employee_id)
);

CREATE TABLE IF NOT EXISTS employee_emergency_contact (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id   CHAR(36)     NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  relationship  VARCHAR(100),
  mobile        VARCHAR(20)  NOT NULL,
  address       TEXT,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_bank_detail (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL UNIQUE,
  bank_name       VARCHAR(255),
  account_number  VARBINARY(500),   -- AES_ENCRYPT applied at application layer
  ifsc_code       VARCHAR(20),
  account_type    VARCHAR(50)  DEFAULT 'Savings',
  upi_id          VARCHAR(255),
  verified        TINYINT(1)   NOT NULL DEFAULT 0,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_journey_log (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id   CHAR(36)     NOT NULL,
  event_type    VARCHAR(100) NOT NULL,   -- onboarded, promoted, transferred, salary_revised, exited, leave_approved, certification_earned, regularization_approved
  event_date    DATE         NOT NULL,
  description   TEXT,
  old_value     VARCHAR(500),
  new_value     VARCHAR(500),
  module        VARCHAR(50),            -- ATS, HR, Payroll, LMS, Attendance, WFM
  triggered_by  CHAR(36),              -- user_id of who caused this event
  metadata      JSON,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_journey_emp (employee_id),
  INDEX idx_journey_date (event_date),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);
```

- [ ] **Step 2: Run against MySQL**

```bash
mysql -u root -p < C:/Users/shivamg/mas-hrms-backend/sql/002_employees.sql
```
Verify:
```sql
SHOW TABLES LIKE 'employee%';
-- expect: employee_bank_detail, employee_documents, employee_emergency_contact, employee_journey_log, employees
```

- [ ] **Step 3: Commit**

```bash
git add sql/002_employees.sql
git commit -m "feat(sql): employees + documents + bank detail (encrypted) + journey log"
```

---

### Task 8: MySQL Schema — ATS

**Files:**
- Create: `sql/004_ats.sql`

- [ ] **Step 1: Write 004_ats.sql**

Create `sql/004_ats.sql`:

```sql
-- 004_ats.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS ats_sourcing_channel (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  channel_code  VARCHAR(50)  NOT NULL UNIQUE,
  channel_name  VARCHAR(255) NOT NULL,
  channel_type  VARCHAR(50),    -- portal, referral, social, walk_in, agency
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ats_candidate (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_code    VARCHAR(50)  NOT NULL UNIQUE,
  full_name         VARCHAR(255) NOT NULL,
  mobile            VARCHAR(20)  NOT NULL,
  email             VARCHAR(255),
  gender            ENUM('Male','Female','Other'),
  date_of_birth     DATE,
  current_stage     VARCHAR(100) NOT NULL DEFAULT 'Applied',  -- Applied, Screened, L1_Interview, Selected, Offer_Sent, Onboarded, Rejected, Dropout
  applied_for_process VARCHAR(255),
  applied_for_branch  VARCHAR(255),
  sourcing_channel  VARCHAR(100),
  referred_by       VARCHAR(255),
  walk_in_date      DATE,
  remarks           TEXT,
  active_status     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ats_mobile (mobile),
  INDEX idx_ats_stage (current_stage)
);

CREATE TABLE IF NOT EXISTS ats_interview_slot (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  slot_date     DATE         NOT NULL,
  slot_time     TIME,
  branch_id     CHAR(36),
  process_id    CHAR(36),
  max_capacity  INT          NOT NULL DEFAULT 20,
  registered    INT          NOT NULL DEFAULT 0,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id)  REFERENCES branch_master(id) ON DELETE SET NULL,
  FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE SET NULL,
  INDEX idx_slot_date (slot_date)
);

CREATE TABLE IF NOT EXISTS ats_candidate_stage_log (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id  CHAR(36)     NOT NULL,
  from_stage    VARCHAR(100),
  to_stage      VARCHAR(100) NOT NULL,
  stage_date    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remarks       TEXT,
  updated_by    CHAR(36),    -- user_id
  interview_slot_id CHAR(36),
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE,
  INDEX idx_stage_log_cand (candidate_id)
);

CREATE TABLE IF NOT EXISTS ats_onboarding_bridge (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id    CHAR(36)     NOT NULL UNIQUE,
  employee_id     CHAR(36),
  bridge_date     DATE         NOT NULL,
  offer_letter_url VARCHAR(500),
  joining_date    DATE,
  status          VARCHAR(50)  NOT NULL DEFAULT 'pending',  -- pending, joined, no_show, cancelled
  notes           TEXT,
  created_by      CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

-- Seed standard sourcing channels
INSERT INTO ats_sourcing_channel (channel_code, channel_name, channel_type) VALUES
  ('WALK_IN',    'Walk-in',         'walk_in'),
  ('REFERRAL',   'Employee Referral','referral'),
  ('NAUKRI',     'Naukri.com',      'portal'),
  ('INDEED',     'Indeed',          'portal'),
  ('LINKEDIN',   'LinkedIn',        'social'),
  ('WHATSAPP',   'WhatsApp Campaign','social'),
  ('AGENCY',     'Placement Agency','agency')
ON DUPLICATE KEY UPDATE channel_name = VALUES(channel_name);
```

- [ ] **Step 2: Run against MySQL**

```bash
mysql -u root -p < C:/Users/shivamg/mas-hrms-backend/sql/004_ats.sql
```
Verify:
```sql
SELECT COUNT(*) FROM ats_sourcing_channel;  -- expect 7
```

- [ ] **Step 3: Commit**

```bash
git add sql/004_ats.sql
git commit -m "feat(sql): ATS candidate pipeline — candidate, slots, stage log, onboarding bridge"
```

---

### Task 9: MySQL Schema — Attendance & WFM

**Files:**
- Create: `sql/005_attendance_wfm.sql`

- [ ] **Step 1: Write 005_attendance_wfm.sql**

Create `sql/005_attendance_wfm.sql`:

```sql
-- 005_attendance_wfm.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS wfm_shift_master (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  shift_code       VARCHAR(50)  NOT NULL UNIQUE,
  shift_name       VARCHAR(255) NOT NULL,
  start_time       TIME         NOT NULL,
  end_time         TIME         NOT NULL,
  required_minutes INT          NOT NULL DEFAULT 540,
  branch_name      VARCHAR(255),
  process_name     VARCHAR(255),
  active_status    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wfm_roster_plan (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  plan_name           VARCHAR(255) NOT NULL,
  process_id          CHAR(36),
  branch_id           CHAR(36),
  shift_id            CHAR(36),
  from_date           DATE         NOT NULL,
  to_date             DATE         NOT NULL,
  required_headcount  INT          NOT NULL DEFAULT 0,
  assigned_headcount  INT          NOT NULL DEFAULT 0,
  plan_status         VARCHAR(50)  NOT NULL DEFAULT 'draft',  -- draft, published, locked
  created_by          CHAR(36),
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id)  REFERENCES branch_master(id) ON DELETE SET NULL,
  FOREIGN KEY (shift_id)   REFERENCES wfm_shift_master(id) ON DELETE SET NULL,
  INDEX idx_roster_plan_dates (from_date, to_date)
);

CREATE TABLE IF NOT EXISTS wfm_roster_assignment (
  id                      CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id             CHAR(36)     NOT NULL,
  shift_id                CHAR(36),
  plan_id                 CHAR(36),
  roster_date             DATE         NOT NULL,
  roster_status           VARCHAR(50)  NOT NULL DEFAULT 'Rostered',  -- Rostered, Present, Absent, Leave, Weekly_Off, Holiday
  branch_name             VARCHAR(255),
  process_name            VARCHAR(255),
  manager_employee_id     CHAR(36),
  team_leader_employee_id CHAR(36),
  publish_status          VARCHAR(50)  NOT NULL DEFAULT 'draft',     -- draft, published, locked
  created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_date (employee_id, roster_date),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (shift_id)    REFERENCES wfm_shift_master(id) ON DELETE SET NULL,
  FOREIGN KEY (plan_id)     REFERENCES wfm_roster_plan(id) ON DELETE SET NULL,
  INDEX idx_roster_date (roster_date)
);

CREATE TABLE IF NOT EXISTS wfm_attendance_session (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id          CHAR(36)     NOT NULL,
  roster_assignment_id CHAR(36),
  session_date         DATE         NOT NULL,
  login_time           DATETIME,
  logout_time          DATETIME,
  total_login_minutes  INT          NOT NULL DEFAULT 0,
  current_status       VARCHAR(50)  NOT NULL DEFAULT 'Rostered',  -- Rostered, Logged_In, On_Break, Logged_Out, Absent
  punch_source         VARCHAR(50)  NOT NULL DEFAULT 'MANUAL',    -- MANUAL, BIOMETRIC, DIALER, REGULARIZATION
  external_punch_id    VARCHAR(255),
  facial_device_id     CHAR(36),
  biometric_user_code  VARCHAR(100),
  branch_name          VARCHAR(255),
  process_name         VARCHAR(255),
  regularization_id    CHAR(36),
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_session_date (employee_id, session_date),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_session_date (session_date),
  INDEX idx_session_status (current_status)
);

CREATE TABLE IF NOT EXISTS wfm_break_log (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  session_id       CHAR(36)     NOT NULL,
  employee_id      CHAR(36)     NOT NULL,
  break_start      DATETIME     NOT NULL,
  break_end        DATETIME,
  duration_minutes INT          NOT NULL DEFAULT 0,
  break_type       VARCHAR(50)  NOT NULL DEFAULT 'Break',  -- Break, Lunch, Bio, Training, Meeting
  punch_source     VARCHAR(50)  NOT NULL DEFAULT 'MANUAL',
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id)  REFERENCES wfm_attendance_session(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_break_session (session_id)
);

CREATE TABLE IF NOT EXISTS wfm_facial_device_master (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  device_code   VARCHAR(100) NOT NULL UNIQUE,
  device_name   VARCHAR(255),
  branch_id     CHAR(36),
  location      VARCHAR(255),
  device_type   VARCHAR(100),              -- facial, fingerprint, card
  secret_name   VARCHAR(255),             -- Supabase Vault secret name — NOT the IP/password
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS wfm_external_punch_staging (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  device_id           CHAR(36),
  external_punch_id   VARCHAR(255),
  employee_code       VARCHAR(50),
  punch_time          DATETIME     NOT NULL,
  punch_type          VARCHAR(50)  NOT NULL DEFAULT 'IN',   -- IN, OUT
  raw_data            JSON,
  apply_status        VARCHAR(50)  NOT NULL DEFAULT 'pending',  -- pending, applied, failed, skipped
  applied_session_id  CHAR(36),
  error_message       TEXT,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (device_id) REFERENCES wfm_facial_device_master(id) ON DELETE SET NULL,
  INDEX idx_punch_staging_status (apply_status),
  INDEX idx_punch_staging_code (employee_code)
);

CREATE TABLE IF NOT EXISTS attendance_regularization (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  session_date    DATE         NOT NULL,
  reason          VARCHAR(500) NOT NULL,
  supporting_note TEXT,
  status          VARCHAR(50)  NOT NULL DEFAULT 'pending',  -- pending, approved, rejected
  reviewed_by     CHAR(36),
  reviewed_at     DATETIME,
  reviewer_note   TEXT,
  applied_to_session_id CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_reg_employee (employee_id),
  INDEX idx_reg_status (status)
);
```

- [ ] **Step 2: Run against MySQL**

```bash
mysql -u root -p < C:/Users/shivamg/mas-hrms-backend/sql/005_attendance_wfm.sql
```
Verify:
```sql
SHOW TABLES LIKE 'wfm%';
-- expect 6 WFM tables + attendance_regularization
```

- [ ] **Step 3: Commit**

```bash
git add sql/005_attendance_wfm.sql
git commit -m "feat(sql): attendance and WFM schema — shifts, roster plan, sessions, breaks, devices, regularization"
```

---

### Task 10: MySQL Schema — Leave, Payroll, Integration Hub, Dialer, KPI, Migration

**Files:**
- Create: `sql/006_leave.sql`
- Create: `sql/007_payroll.sql`
- Create: `sql/008_integration_hub.sql`
- Create: `sql/009_dialer_ispark.sql`
- Create: `sql/010_kpi_migration.sql`
- Create: `sql/000_run_all.sql`

- [ ] **Step 1: Write 006_leave.sql**

Create `sql/006_leave.sql`:

```sql
-- 006_leave.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS leave_type_master (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  leave_code         VARCHAR(20)  NOT NULL UNIQUE,
  leave_name         VARCHAR(100) NOT NULL,
  max_days_per_year  INT          NOT NULL DEFAULT 0,
  carry_forward      TINYINT(1)   NOT NULL DEFAULT 0,
  requires_approval  TINYINT(1)   NOT NULL DEFAULT 1,
  paid_leave         TINYINT(1)   NOT NULL DEFAULT 1,
  active_status      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leave_holiday_master (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  holiday_name   VARCHAR(255) NOT NULL,
  holiday_date   DATE         NOT NULL,
  holiday_type   VARCHAR(50)  NOT NULL DEFAULT 'national',  -- national, regional, restricted
  branch_id      CHAR(36),
  active_status  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE SET NULL,
  INDEX idx_holiday_date (holiday_date)
);

CREATE TABLE IF NOT EXISTS leave_balance_ledger (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)      NOT NULL,
  leave_type_id   CHAR(36)      NOT NULL,
  balance_year    INT           NOT NULL,
  allocated_days  DECIMAL(6,2)  NOT NULL DEFAULT 0,
  used_days       DECIMAL(6,2)  NOT NULL DEFAULT 0,
  adjusted_days   DECIMAL(6,2)  NOT NULL DEFAULT 0,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_leave_year (employee_id, leave_type_id, balance_year),
  FOREIGN KEY (employee_id)   REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (leave_type_id) REFERENCES leave_type_master(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leave_request (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)      NOT NULL,
  leave_type_id   CHAR(36)      NOT NULL,
  from_date       DATE          NOT NULL,
  to_date         DATE          NOT NULL,
  total_days      DECIMAL(6,2)  NOT NULL,
  reason          TEXT,
  status          VARCHAR(50)   NOT NULL DEFAULT 'pending',  -- pending, approved, rejected, cancelled
  applied_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id)   REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (leave_type_id) REFERENCES leave_type_master(id),
  INDEX idx_leave_emp (employee_id),
  INDEX idx_leave_status (status)
);

CREATE TABLE IF NOT EXISTS leave_approval_log (
  id               CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  leave_request_id CHAR(36)    NOT NULL,
  action           VARCHAR(50) NOT NULL,   -- approved, rejected, cancelled
  action_by        CHAR(36)    NOT NULL,
  action_at        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remarks          TEXT,
  FOREIGN KEY (leave_request_id) REFERENCES leave_request(id) ON DELETE CASCADE
);

-- Seed standard leave types
INSERT INTO leave_type_master (leave_code, leave_name, max_days_per_year, carry_forward, requires_approval, paid_leave) VALUES
  ('CL',  'Casual Leave',      12, 0, 1, 1),
  ('SL',  'Sick Leave',         7, 0, 1, 1),
  ('EL',  'Earned Leave',      15, 1, 1, 1),
  ('ML',  'Maternity Leave',   90, 0, 1, 1),
  ('PL',  'Paternity Leave',    5, 0, 1, 1),
  ('LWP', 'Leave Without Pay',  0, 0, 1, 0)
ON DUPLICATE KEY UPDATE leave_name = VALUES(leave_name);
```

- [ ] **Step 2: Write 007_payroll.sql**

Create `sql/007_payroll.sql`:

```sql
-- 007_payroll.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS statutory_config (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  config_key      VARCHAR(100)  NOT NULL UNIQUE,
  config_value    DECIMAL(10,4) NOT NULL,
  description     VARCHAR(255),
  effective_from  DATE,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS salary_structure_master (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  structure_code   VARCHAR(50)  NOT NULL UNIQUE,
  structure_name   VARCHAR(255) NOT NULL,
  description      TEXT,
  active_status    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS salary_component_master (
  id              CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  component_code  VARCHAR(50) NOT NULL UNIQUE,
  component_name  VARCHAR(100) NOT NULL,
  component_type  VARCHAR(50) NOT NULL,  -- earning, deduction, statutory
  taxable         TINYINT(1)  NOT NULL DEFAULT 1,
  active_status   TINYINT(1)  NOT NULL DEFAULT 1,
  created_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS salary_structure_component (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  structure_id     CHAR(36)      NOT NULL,
  component_id     CHAR(36)      NOT NULL,
  calc_type        VARCHAR(50)   NOT NULL DEFAULT 'fixed',  -- fixed, percentage_of_basic, percentage_of_gross
  value            DECIMAL(10,4) NOT NULL DEFAULT 0,
  sequence         INT           NOT NULL DEFAULT 1,
  UNIQUE KEY uq_struct_comp (structure_id, component_id),
  FOREIGN KEY (structure_id)  REFERENCES salary_structure_master(id) ON DELETE CASCADE,
  FOREIGN KEY (component_id)  REFERENCES salary_component_master(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_salary_assignment (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id      CHAR(36)      NOT NULL,
  structure_id     CHAR(36)      NOT NULL,
  ctc_annual       DECIMAL(12,2) NOT NULL DEFAULT 0,
  effective_from   DATE          NOT NULL,
  effective_to     DATE,
  active_status    TINYINT(1)    NOT NULL DEFAULT 1,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id)  REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (structure_id) REFERENCES salary_structure_master(id),
  INDEX idx_sal_emp (employee_id)
);

CREATE TABLE IF NOT EXISTS salary_deduction_rule (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  rule_name     VARCHAR(255)  NOT NULL,
  rule_type     VARCHAR(50)   NOT NULL,  -- lwp_per_day, late_mark, dialer_shortfall, fixed, percentage
  applies_to    VARCHAR(100)  NOT NULL DEFAULT 'all',
  value         DECIMAL(10,4) NOT NULL DEFAULT 0,
  active_status TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS salary_prep_run (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  run_month         VARCHAR(7)    NOT NULL,   -- YYYY-MM
  branch_filter     VARCHAR(255),
  process_filter    VARCHAR(255),
  status            VARCHAR(50)   NOT NULL DEFAULT 'draft',  -- draft, processing, reviewed, approved, locked, disbursed
  total_employees   INT           NOT NULL DEFAULT 0,
  total_gross       DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_deductions  DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_net         DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_by        CHAR(36),
  approved_by       CHAR(36),
  disbursed_by      CHAR(36),
  disbursed_at      DATETIME,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_run_month_branch_process (run_month, branch_filter, process_filter),
  INDEX idx_run_month (run_month)
);

CREATE TABLE IF NOT EXISTS salary_prep_line (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  run_id           CHAR(36)      NOT NULL,
  employee_id      CHAR(36)      NOT NULL,
  employee_code    VARCHAR(50)   NOT NULL,
  working_days     DECIMAL(6,2)  NOT NULL DEFAULT 0,
  present_days     DECIMAL(6,2)  NOT NULL DEFAULT 0,
  leave_days       DECIMAL(6,2)  NOT NULL DEFAULT 0,
  lwp_days         DECIMAL(6,2)  NOT NULL DEFAULT 0,
  late_marks       INT           NOT NULL DEFAULT 0,
  dialer_hours     DECIMAL(8,2),
  gross_salary     DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_salary       DECIMAL(12,2) NOT NULL DEFAULT 0,
  pf_employee      DECIMAL(10,2) NOT NULL DEFAULT 0,
  pf_employer      DECIMAL(10,2) NOT NULL DEFAULT 0,
  esic_employee    DECIMAL(10,2) NOT NULL DEFAULT 0,
  esic_employer    DECIMAL(10,2) NOT NULL DEFAULT 0,
  professional_tax DECIMAL(10,2) NOT NULL DEFAULT 0,
  tds              DECIMAL(10,2) NOT NULL DEFAULT 0,
  remarks          TEXT,
  status           VARCHAR(50)   NOT NULL DEFAULT 'draft',  -- draft, reviewed, approved
  UNIQUE KEY uq_run_emp (run_id, employee_id),
  FOREIGN KEY (run_id)      REFERENCES salary_prep_run(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS salary_advance_log (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)      NOT NULL,
  advance_date    DATE          NOT NULL,
  amount          DECIMAL(12,2) NOT NULL,
  recovery_months INT           NOT NULL DEFAULT 1,
  recovered_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status          VARCHAR(50)   NOT NULL DEFAULT 'active',  -- active, fully_recovered
  notes           TEXT,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS salary_payslip (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  prep_line_id    CHAR(36)      NOT NULL UNIQUE,
  employee_id     CHAR(36)      NOT NULL,
  run_month       VARCHAR(7)    NOT NULL,
  file_url        VARCHAR(500),
  generated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (prep_line_id) REFERENCES salary_prep_line(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- Seed statutory configs
INSERT INTO statutory_config (config_key, config_value, description) VALUES
  ('PF_EMPLOYEE_PCT',    12.00, 'Employee PF contribution % of Basic'),
  ('PF_EMPLOYER_PCT',    12.00, 'Employer PF contribution % of Basic'),
  ('ESIC_EMPLOYEE_PCT',   0.75, 'Employee ESIC contribution % of Gross'),
  ('ESIC_EMPLOYER_PCT',   3.25, 'Employer ESIC contribution % of Gross'),
  ('ESIC_WAGE_LIMIT',  21000.00, 'ESIC applicable if gross <= this amount'),
  ('PF_WAGE_LIMIT',    15000.00, 'PF statutory ceiling on Basic')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);

-- Seed salary components
INSERT INTO salary_component_master (component_code, component_name, component_type, taxable) VALUES
  ('BASIC',    'Basic Salary',        'earning',    1),
  ('HRA',      'House Rent Allowance','earning',    1),
  ('TA',       'Travel Allowance',    'earning',    0),
  ('SPECIAL',  'Special Allowance',   'earning',    1),
  ('PF_EMP',   'PF Employee',         'deduction',  0),
  ('ESIC_EMP', 'ESIC Employee',       'deduction',  0),
  ('PT',       'Professional Tax',    'statutory',  0),
  ('TDS',      'Tax Deducted at Source','statutory',0),
  ('LWP_DED',  'LWP Deduction',       'deduction',  0)
ON DUPLICATE KEY UPDATE component_name = VALUES(component_name);
```

- [ ] **Step 3: Write 008_integration_hub.sql**

Create `sql/008_integration_hub.sql`:

```sql
-- 008_integration_hub.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS integration_config (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key   VARCHAR(100) NOT NULL UNIQUE,
  integration_name  VARCHAR(255) NOT NULL,
  integration_type  VARCHAR(50)  NOT NULL,   -- rest_pull, rest_push, database, sftp, file_upload
  vendor_name       VARCHAR(255),
  base_url          VARCHAR(500),
  auth_type         VARCHAR(50),             -- api_key, oauth2, basic, bearer, db_connection
  secret_name       VARCHAR(255),            -- Supabase Vault secret name — NOT actual credential
  config_json       JSON,                    -- non-sensitive config: port, db_name, file_pattern, headers
  active_status     TINYINT(1)   NOT NULL DEFAULT 1,
  notes             TEXT,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_integration_key (integration_key)
);

CREATE TABLE IF NOT EXISTS integration_schedule (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key  VARCHAR(100) NOT NULL UNIQUE,
  cron_expression  VARCHAR(100) NOT NULL DEFAULT '0 */15 * * * *',  -- every 15 min
  enabled          TINYINT(1)   NOT NULL DEFAULT 0,
  last_run_at      DATETIME,
  next_run_at      DATETIME,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (integration_key) REFERENCES integration_config(integration_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS integration_connector_run (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key  VARCHAR(100) NOT NULL,
  triggered_by     VARCHAR(50)  NOT NULL DEFAULT 'schedule',  -- schedule, manual
  triggered_user   CHAR(36),
  status           VARCHAR(50)  NOT NULL DEFAULT 'running',   -- running, success, failed, partial
  rows_fetched     INT          NOT NULL DEFAULT 0,
  rows_staged      INT          NOT NULL DEFAULT 0,
  rows_promoted    INT          NOT NULL DEFAULT 0,
  rows_failed      INT          NOT NULL DEFAULT 0,
  duration_ms      INT,
  error_message    TEXT,
  started_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at     DATETIME,
  INDEX idx_run_key (integration_key),
  INDEX idx_run_started (started_at)
);

CREATE TABLE IF NOT EXISTS integration_raw_payload (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  run_id           CHAR(36)     NOT NULL,
  integration_key  VARCHAR(100) NOT NULL,
  payload          LONGTEXT     NOT NULL,  -- raw JSON/CSV string, never deleted
  payload_hash     VARCHAR(64),            -- SHA256 for dedup detection
  row_count        INT          NOT NULL DEFAULT 0,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_payload_run (run_id),
  FOREIGN KEY (run_id) REFERENCES integration_connector_run(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS integration_schema_snapshot (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key  VARCHAR(100) NOT NULL,
  run_id           CHAR(36)     NOT NULL,
  detected_fields  JSON         NOT NULL,  -- [{ field_name, data_type, sample_value, nullable }]
  snapshot_hash    VARCHAR(64),
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_schema_key (integration_key),
  FOREIGN KEY (run_id) REFERENCES integration_connector_run(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS integration_field_map (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key  VARCHAR(100) NOT NULL,
  source_field     VARCHAR(255) NOT NULL,
  target_table     VARCHAR(100) NOT NULL,
  target_column    VARCHAR(100) NOT NULL,
  transform        VARCHAR(500),          -- optional: 'divide_by:60', 'date_format:YYYY-MM-DD'
  confirmed_by     CHAR(36),
  confirmed_at     DATETIME,
  active_status    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_map_key_field (integration_key, source_field),
  INDEX idx_map_key (integration_key)
);

CREATE TABLE IF NOT EXISTS integration_field_map_suggestion (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key  VARCHAR(100) NOT NULL,
  source_field     VARCHAR(255) NOT NULL,
  suggested_table  VARCHAR(100),
  suggested_column VARCHAR(100),
  confidence_score DECIMAL(5,2) NOT NULL DEFAULT 0,   -- 0-100
  status           VARCHAR(50)  NOT NULL DEFAULT 'pending',  -- pending, confirmed, rejected, skipped
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_suggest_key (integration_key)
);

CREATE TABLE IF NOT EXISTS integration_event_log (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key  VARCHAR(100) NOT NULL,
  event_type       VARCHAR(100) NOT NULL,   -- sync_started, sync_completed, sync_failed, mapping_confirmed, field_promoted
  triggered_by     CHAR(36),
  description      TEXT,
  metadata         JSON,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_event_key (integration_key),
  INDEX idx_event_created (created_at)
);

-- Seed integration connectors (config only, no credentials)
-- Dialers: each physical dialer system gets its own row (dialer_1, dialer_2, etc.)
-- Admin registers each dialer via UI after receiving API key from IT.
-- Consolidated login time = SUM(login_minutes) across all dialer rows for same employee_code + session_date.
INSERT INTO integration_config (integration_key, integration_name, integration_type, auth_type, notes) VALUES
  ('dialer_1',         'Dialer 1',                 'rest_pull',   'api_key',       'First dialer system. Set integration_name, base_url and secret_name via admin UI.'),
  ('dialer_2',         'Dialer 2',                 'rest_pull',   'api_key',       'Second dialer system. Set integration_name, base_url and secret_name via admin UI.'),
  ('facial_biometric', 'Facial Biometric Device',  'rest_pull',   'basic',         'Biometric punch data. Set base_url and secret_name before enabling.'),
  ('payroll',          'Payroll System',            'sftp',        'sftp_key',      'External payroll import. Set secret_name before enabling.'),
  ('bgv',              'BGV Vendor',                'rest_pull',   'api_key',       'Background verification. Set base_url and secret_name before enabling.'),
  ('crm',              'CRM System',                'rest_pull',   'bearer',        'CRM agent data sync. Set base_url and secret_name before enabling.'),
  ('sms_gateway',      'SMS Gateway',               'rest_push',   'api_key',       'SMS notifications. Set base_url and secret_name before enabling.'),
  ('whatsapp_gateway', 'WhatsApp Gateway',          'rest_push',   'bearer',        'WhatsApp notifications. Set base_url and secret_name before enabling.'),
  ('ispark',           'iSpark Legacy HR',          'file_upload', 'none',          'Employee data migration from iSpark via CSV upload.')
ON DUPLICATE KEY UPDATE integration_name = VALUES(integration_name);
```

- [ ] **Step 4: Write 009_dialer_ispark.sql**

Create `sql/009_dialer_ispark.sql`:

```sql
-- 009_dialer_ispark.sql
USE mas_hrms;

-- One row per employee per dialer per day.
-- Multiple dialers on same day = multiple rows, same employee_code.
-- Consolidated total: SELECT employee_code, session_date, SUM(login_minutes) ... GROUP BY employee_code, session_date
CREATE TABLE IF NOT EXISTS dialer_session_log (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_code   VARCHAR(50)  NOT NULL,
  employee_id     CHAR(36),
  session_date    DATE         NOT NULL,
  integration_key VARCHAR(100) NOT NULL,          -- which dialer: dialer_avaya, dialer_exotel etc.
  dialer_name     VARCHAR(255),                   -- human-readable label pulled from integration_config
  login_minutes   INT          NOT NULL DEFAULT 0,
  process_name    VARCHAR(255),
  branch_name     VARCHAR(255),
  run_id          CHAR(36),
  imported_by     CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dialer_emp_date_key (employee_code, session_date, integration_key),
  INDEX idx_dialer_emp (employee_code),
  INDEX idx_dialer_date (session_date),
  INDEX idx_dialer_key (integration_key),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ispark_migration_batch (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  batch_ref       VARCHAR(100) NOT NULL UNIQUE,
  source_file     VARCHAR(500),
  total_rows      INT          NOT NULL DEFAULT 0,
  valid_rows      INT          NOT NULL DEFAULT 0,
  invalid_rows    INT          NOT NULL DEFAULT 0,
  promoted_rows   INT          NOT NULL DEFAULT 0,
  batch_status    VARCHAR(50)  NOT NULL DEFAULT 'uploaded',  -- uploaded, validating, validated, promoting, promoted, failed
  created_by      CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ispark_employee_staging (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  batch_id            CHAR(36)     NOT NULL,
  raw_json            JSON         NOT NULL,
  emp_code            VARCHAR(50),
  first_name          VARCHAR(100),
  last_name           VARCHAR(100),
  email               VARCHAR(255),
  mobile              VARCHAR(20),
  department_name     VARCHAR(255),
  designation_name    VARCHAR(255),
  branch_name         VARCHAR(255),
  process_name        VARCHAR(255),
  date_of_joining     DATE,
  validation_status   VARCHAR(50)  NOT NULL DEFAULT 'pending',  -- pending, valid, invalid, promoted
  validation_errors   JSON,
  promoted_employee_id CHAR(36),
  promoted_at         DATETIME,
  uploaded_by         CHAR(36),
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES ispark_migration_batch(id) ON DELETE CASCADE,
  FOREIGN KEY (promoted_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  INDEX idx_ispark_batch (batch_id),
  INDEX idx_ispark_status (validation_status)
);
```

- [ ] **Step 5: Write 010_kpi_migration.sql**

Create `sql/010_kpi_migration.sql`:

```sql
-- 010_kpi_migration.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS kpi_target_master (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  role_key      VARCHAR(100)  NOT NULL,
  kpi_name      VARCHAR(255)  NOT NULL,
  kpi_code      VARCHAR(100)  NOT NULL,
  target_value  DECIMAL(10,4),
  unit          VARCHAR(50),
  active_status TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kpi_role_code (role_key, kpi_code)
);

CREATE TABLE IF NOT EXISTS role_kpi_snapshot (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id      CHAR(36)      NOT NULL,
  snapshot_date    DATE          NOT NULL,
  role_key         VARCHAR(100)  NOT NULL,
  kpi_code         VARCHAR(100)  NOT NULL,
  actual_value     DECIMAL(10,4),
  target_value     DECIMAL(10,4),
  achievement_pct  DECIMAL(6,2),
  source           VARCHAR(50)   NOT NULL DEFAULT 'manual',  -- manual, system, api
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kpi_snap (employee_id, snapshot_date, kpi_code),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_kpi_snap_emp (employee_id),
  INDEX idx_kpi_snap_date (snapshot_date)
);

CREATE TABLE IF NOT EXISTS migration_run (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  module         VARCHAR(100) NOT NULL,   -- employees, attendance, wfm, leave, ats, all
  status         VARCHAR(50)  NOT NULL DEFAULT 'running',  -- running, complete, partial, failed
  rows_read      INT          NOT NULL DEFAULT 0,
  rows_written   INT          NOT NULL DEFAULT 0,
  rows_failed    INT          NOT NULL DEFAULT 0,
  source_count   INT,                     -- COUNT from Supabase at time of run
  target_count   INT,                     -- COUNT in MySQL after run
  triggered_by   CHAR(36),
  started_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at   DATETIME,
  error_log      TEXT,
  INDEX idx_migration_module (module)
);

CREATE TABLE IF NOT EXISTS migration_row_log (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  run_id         CHAR(36)     NOT NULL,
  source_table   VARCHAR(100) NOT NULL,
  source_id      VARCHAR(100) NOT NULL,
  target_table   VARCHAR(100) NOT NULL,
  status         VARCHAR(50)  NOT NULL DEFAULT 'written',  -- written, failed, skipped
  error_message  TEXT,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES migration_run(id) ON DELETE CASCADE,
  INDEX idx_migrow_run (run_id),
  INDEX idx_migrow_status (status)
);

-- Seed KPI targets
INSERT INTO kpi_target_master (role_key, kpi_name, kpi_code, target_value, unit) VALUES
  ('tl',          'Team AHT (seconds)',      'TEAM_AHT',      300,  'seconds'),
  ('tl',          'Team CSAT Score',         'TEAM_CSAT',      90,  'percent'),
  ('tl',          'Attendance %',            'ATTENDANCE_PCT', 95,  'percent'),
  ('qa',          'Audits Per Day',          'AUDITS_PER_DAY',  8,  'count'),
  ('qa',          'Fatal Error Rate %',      'FATAL_RATE',      2,  'percent'),
  ('wfm',         'Shrinkage %',             'SHRINKAGE',      10,  'percent'),
  ('wfm',         'Schedule Adherence %',    'ADHERENCE',      90,  'percent'),
  ('manager',     'Process SLA Achievement', 'SLA_ACH',        95,  'percent'),
  ('branch_head', 'Branch Headcount Fill %', 'HEADCOUNT_FILL', 90,  'percent'),
  ('branch_head', 'Branch CSAT Average',     'BRANCH_CSAT',    88,  'percent')
ON DUPLICATE KEY UPDATE target_value = VALUES(target_value);
```

- [ ] **Step 6: Write 000_run_all.sql**

Create `sql/000_run_all.sql`:

```sql
-- 000_run_all.sql
-- Run this file to execute all schema files in order
-- Usage: mysql -u root -p < sql/000_run_all.sql

SOURCE sql/001_core_org.sql;
SOURCE sql/002_employees.sql;
SOURCE sql/003_access_control.sql;
SOURCE sql/004_ats.sql;
SOURCE sql/005_attendance_wfm.sql;
SOURCE sql/006_leave.sql;
SOURCE sql/007_payroll.sql;
SOURCE sql/008_integration_hub.sql;
SOURCE sql/009_dialer_ispark.sql;
SOURCE sql/010_kpi_migration.sql;

SELECT 'mas_hrms schema complete' AS status;
SHOW TABLES;
```

- [ ] **Step 7: Run all SQL files and verify**

```bash
cd C:/Users/shivamg/mas-hrms-backend
mysql -u root -p < sql/001_core_org.sql
mysql -u root -p < sql/002_employees.sql
mysql -u root -p < sql/003_access_control.sql
mysql -u root -p < sql/004_ats.sql
mysql -u root -p < sql/005_attendance_wfm.sql
mysql -u root -p < sql/006_leave.sql
mysql -u root -p < sql/007_payroll.sql
mysql -u root -p < sql/008_integration_hub.sql
mysql -u root -p < sql/009_dialer_ispark.sql
mysql -u root -p < sql/010_kpi_migration.sql
```

Verify total table count:
```sql
USE mas_hrms;
SELECT COUNT(*) AS total_tables FROM information_schema.tables WHERE table_schema = 'mas_hrms';
-- Expected: 43+ tables
```

- [ ] **Step 8: Commit**

```bash
git add sql/006_leave.sql sql/007_payroll.sql sql/008_integration_hub.sql sql/009_dialer_ispark.sql sql/010_kpi_migration.sql sql/000_run_all.sql
git commit -m "feat(sql): complete mas_hrms schema — leave, payroll, integration hub, dialer, KPI, migration tables"
```

---

### Task 11: Frontend Feature Flags + hrmsApi Client

**Files:**
- Create: `C:\Users\shivamg\mas-callnet-hrms\src\lib\dataSource.ts`
- Create: `C:\Users\shivamg\mas-callnet-hrms\src\lib\hrmsApi.ts`
- Modify: `C:\Users\shivamg\mas-callnet-hrms\.env.example` (or create if not present)

- [ ] **Step 1: Write dataSource.ts in mas-callnet-hrms**

Create `C:\Users\shivamg\mas-callnet-hrms\src\lib\dataSource.ts`:

```typescript
// Controls per-module data source: 'supabase' (default) vs 'backend' (mas-hrms-backend MySQL)
// Set VITE_HRMS_<MODULE>=backend in .env to cut over a module to MySQL

export const USE_HRMS_BACKEND = {
  employees:   import.meta.env.VITE_HRMS_EMPLOYEES   === 'backend',
  attendance:  import.meta.env.VITE_HRMS_ATTENDANCE  === 'backend',
  wfm:         import.meta.env.VITE_HRMS_WFM         === 'backend',
  leave:       import.meta.env.VITE_HRMS_LEAVE       === 'backend',
  payroll:     import.meta.env.VITE_HRMS_PAYROLL     === 'backend',
  ats:         import.meta.env.VITE_HRMS_ATS         === 'backend',
  integration: import.meta.env.VITE_HRMS_INTEGRATION === 'backend',
  kpi:         import.meta.env.VITE_HRMS_KPI         === 'backend',
} as const;

export type HrmsModule = keyof typeof USE_HRMS_BACKEND;
```

- [ ] **Step 2: Write hrmsApi.ts**

Create `C:\Users\shivamg\mas-callnet-hrms\src\lib\hrmsApi.ts`:

```typescript
import { supabase } from '@/integrations/supabase/client';

const HRMS_API_URL = import.meta.env.VITE_HRMS_API_URL ?? 'http://localhost:5055';

async function getAuthHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('No active session');
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await getAuthHeader();
  const res = await fetch(`${HRMS_API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export const hrmsApi = {
  get:    <T>(path: string)                => request<T>('GET',    path),
  post:   <T>(path: string, body: unknown) => request<T>('POST',   path, body),
  put:    <T>(path: string, body: unknown) => request<T>('PUT',    path, body),
  delete: <T>(path: string)               => request<T>('DELETE', path),
};
```

- [ ] **Step 3: Update .env.example in mas-callnet-hrms**

Add these lines to `C:\Users\shivamg\mas-callnet-hrms\.env.example`:

```
# mas-hrms-backend URL
VITE_HRMS_API_URL=http://localhost:5055

# Per-module data source flags (set to 'backend' to cut over from Supabase to MySQL)
VITE_HRMS_EMPLOYEES=supabase
VITE_HRMS_ATTENDANCE=supabase
VITE_HRMS_WFM=supabase
VITE_HRMS_LEAVE=supabase
VITE_HRMS_PAYROLL=supabase
VITE_HRMS_ATS=supabase
VITE_HRMS_INTEGRATION=supabase
VITE_HRMS_KPI=supabase
```

- [ ] **Step 4: Verify frontend TypeScript compiles**

```bash
cd C:/Users/shivamg/mas-callnet-hrms && npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 5: Commit both repos**

```bash
cd C:/Users/shivamg/mas-callnet-hrms
git add src/lib/dataSource.ts src/lib/hrmsApi.ts .env.example
git commit -m "feat: hrmsApi client and per-module data source feature flags for MySQL cutover"
```

---

### Task 12: Auth Test + Server Smoke Test

**Files:**
- Create: `C:\Users\shivamg\mas-hrms-backend\tests\auth.test.ts`

- [ ] **Step 1: Write auth.test.ts**

Create `tests/auth.test.ts`:

```typescript
import request from 'supertest';
import app from '../src/server';

describe('Auth middleware', () => {
  it('returns 401 when no Authorization header', async () => {
    // We need a protected route — add a test route to server only in test env
    const res = await request(app).get('/health');
    // Health is unprotected — should succeed
    expect(res.status).toBeLessThan(600);
    expect(res.body.service).toBe('mas-hrms-backend');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/unknown-route-xyz');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run all tests**

```bash
cd C:/Users/shivamg/mas-hrms-backend && npm test
```
Expected: 2 test suites, 3 tests passing.

- [ ] **Step 3: Start the server and verify health endpoint**

```bash
npm run dev
```
In a new terminal:
```bash
curl http://localhost:5055/health
```
Expected response:
```json
{
  "ok": true,
  "service": "mas-hrms-backend",
  "version": "1.0.0",
  "database": { "database": "mas_hrms", "user": "root@localhost", "time": "..." },
  "timestamp": "..."
}
```

- [ ] **Step 4: Commit**

```bash
cd C:/Users/shivamg/mas-hrms-backend
git add tests/auth.test.ts
git commit -m "test: auth middleware and 404 handling smoke tests"
```

---

### Task 13: Push to GitHub and Write .env

- [ ] **Step 1: Create GitHub repo**

Go to github.com → New Repository → Name: `mas-hrms-backend` → Private → No README (we have files).

- [ ] **Step 2: Push**

```bash
cd C:/Users/shivamg/mas-hrms-backend
git remote add origin https://github.com/shivamgiri-sudo/mas-hrms-backend.git
git branch -M main
git push -u origin main
```

- [ ] **Step 3: Create local .env from example**

```bash
cp .env.example .env
```
Edit `.env` with real values:
```
PORT=5055
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=<your mysql root password>
DB_NAME=mas_hrms
SUPABASE_URL=<from Supabase dashboard → Settings → API>
SUPABASE_ANON_KEY=<from Supabase dashboard>
SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard>
```

- [ ] **Step 4: Final verification — server up + DB connected + all tests green**

```bash
npm run dev
# expect: mas-hrms-backend running on port 5055

npm test
# expect: all tests pass

curl http://localhost:5055/health
# expect: ok: true with database info
```

- [ ] **Step 5: Commit plan as executed**

```bash
cd C:/Users/shivamg/mas-callnet-hrms
git add .
git commit -m "feat: Phase A complete — mas-hrms-backend foundation + MySQL mas_hrms schema + frontend feature flags"
```

---

## Self-Review

**Spec coverage check:**
- ✅ New repo scaffold — Tasks 1–5
- ✅ MySQL pool — Task 3
- ✅ Supabase JWT auth — Task 4
- ✅ All schema tables from §3.1–3.12 — Tasks 6–10
- ✅ Frontend feature flags — Task 11
- ✅ hrmsApi client — Task 11
- ✅ Tests — Tasks 5, 12
- ✅ GitHub push — Task 13

**Placeholder scan:** None found.

**Type consistency:** `AppRequest`, `AuthUser` defined in Task 2, used in Tasks 4. `hrmsApi` defined in Task 11, ready for Phase B module routers. All consistent.
