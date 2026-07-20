# AI Copilot Real Data + Gemini Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PeopleOS Copilot return real, data-backed answers instead of "Context analyzed. No immediate action items detected." — and activate Google Gemini as the AI provider.

**Architecture:** Two independent tracks. Track A adds an intent-detection + data-enrichment layer that fetches real HRMS data (salary, attendance, leave) before the AI call. Track B wires Gemini via env var. Both tracks use the same enriched context.

**Tech Stack:** Node.js + Express + TypeScript + MySQL (`mas_hrms`), existing `aiSafetyService`, `aiProviderRegistry`, `getEmployeeForUser` from `shared/accessGuard.ts`.

## Global Constraints

- `GEMINI_API_KEY` must NEVER be committed to git — only set in `.env` on the server
- The injection point for enriched data is AFTER `getEmployeeForUser(userId)` and BEFORE `aiSafetyService.sanitizeContext(rawContext, roleKeys)` in `ai-insights.routes.ts` line ~246
- Field names for salary data must use safe aliases to avoid PII redaction: `earnings_total` (not `gross_salary`), `take_home_amount` (not `net_salary`), `deductions_total` (not `total_deductions`), `basic_component` (not `basic`), `hra_component` (not `hra`)
- `getEmployeeForUser` is in `backend/src/shared/accessGuard.ts` — already imported in many routes, use `import { getEmployeeForUser } from '../../shared/accessGuard.js'`
- All DB queries in the intent service use `db` (the main pool from `../../db/mysql.js`)
- Intent enrichment must be non-blocking: wrap in try/catch and silently skip if data unavailable
- No new backend routes — all changes are inside existing `ai-insights.routes.ts` and supporting files
- TypeScript: no `any` in new files; use `RowDataPacket` from `mysql2` for DB query results

---

## Track A: Task 1 — Create `ai-intent.service.ts`

**Files:**
- Create: `backend/src/modules/ai/ai-intent.service.ts`

**Interfaces:**
- Produces: `export type IntentKey = 'salary_breakup' | 'leave_balance' | 'attendance_summary' | 'pending_actions' | 'unknown'`
- Produces: `export async function detectAndEnrich(question: string, userId: string, db: Pool): Promise<{ intent: IntentKey; data: Record<string, unknown> }>`

The function detects intent from the question string (keyword matching), resolves the employee from `userId`, fetches the relevant data, and returns it with safe field aliases.

- [ ] **Step 1: Write the file**

```typescript
import type { Pool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { getEmployeeForUser } from '../../shared/accessGuard.js';

export type IntentKey =
  | 'salary_breakup'
  | 'leave_balance'
  | 'attendance_summary'
  | 'pending_actions'
  | 'unknown';

const INTENT_PATTERNS: Array<{ intent: IntentKey; keywords: string[] }> = [
  {
    intent: 'salary_breakup',
    keywords: ['salary', 'payslip', 'breakup', 'ctc', 'pay slip', 'earnings',
               'deduction', 'take home', 'net pay', 'gross', 'in hand',
               'salary slip', 'my pay', 'how much i earn'],
  },
  {
    intent: 'leave_balance',
    keywords: ['leave balance', 'leave remaining', 'how many leaves', 'leave left',
               'pl balance', 'el balance', 'cl balance', 'sick leave', 'casual leave',
               'privilege leave', 'annual leave', 'my leaves', 'leave available'],
  },
  {
    intent: 'attendance_summary',
    keywords: ['attendance', 'present', 'absent', 'late', 'punch', 'clocked',
               'how many days', 'attendance percentage', 'late marks', 'lwp',
               'leave without pay', 'attendance this month', 'my attendance'],
  },
  {
    intent: 'pending_actions',
    keywords: ['pending', 'pending approval', 'pending requests', 'action',
               'my inbox', 'work inbox', 'approvals', 'what is pending'],
  },
];

export function detectIntent(question: string): IntentKey {
  const q = question.toLowerCase();
  for (const { intent, keywords } of INTENT_PATTERNS) {
    if (keywords.some((kw) => q.includes(kw))) return intent;
  }
  return 'unknown';
}

async function fetchSalaryBreakup(
  employeeId: string,
  db: Pool
): Promise<Record<string, unknown>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       spl.gross_salary, spl.total_deductions, spl.net_salary,
       spl.basic, spl.hra, spl.special_allowance,
       spl.pf_employee, spl.esic_employee, spl.professional_tax, spl.tds,
       spl.lwp_deduction, spl.advance_recovery,
       spl.present_days, spl.working_days, spl.lwp_days,
       spr.run_month
     FROM salary_prep_line spl
     JOIN salary_prep_run spr ON spr.id = spl.run_id
     WHERE spl.employee_id = ?
       AND spr.status != 'draft'
     ORDER BY spr.run_month DESC
     LIMIT 1`,
    [employeeId]
  );
  if (!rows.length) return { salary_data_available: false };
  const r = rows[0];
  return {
    salary_data_available: true,
    salary_month: r.run_month,
    earnings_total: Number(r.gross_salary ?? 0),
    deductions_total: Number(r.total_deductions ?? 0),
    take_home_amount: Number(r.net_salary ?? 0),
    basic_component: Number(r.basic ?? 0),
    hra_component: Number(r.hra ?? 0),
    special_allowance_component: Number(r.special_allowance ?? 0),
    pf_deduction: Number(r.pf_employee ?? 0),
    esic_deduction: Number(r.esic_employee ?? 0),
    professional_tax_deduction: Number(r.professional_tax ?? 0),
    tds_deduction: Number(r.tds ?? 0),
    lwp_deduction: Number(r.lwp_deduction ?? 0),
    advance_recovery: Number(r.advance_recovery ?? 0),
    present_days_count: Number(r.present_days ?? 0),
    working_days_count: Number(r.working_days ?? 0),
    lwp_days_count: Number(r.lwp_days ?? 0),
  };
}

async function fetchLeaveBalance(
  employeeId: string,
  db: Pool
): Promise<Record<string, unknown>> {
  const year = new Date().getFullYear();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT lbl.allocated_days, lbl.used_days, lbl.adjusted_days,
            lt.leave_name, lt.leave_code
     FROM leave_balance_ledger lbl
     JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
     WHERE lbl.employee_id = ? AND lbl.balance_year = ?
     ORDER BY lt.leave_name ASC`,
    [employeeId, year]
  );
  if (!rows.length) return { leave_data_available: false };
  const balances = rows.map((r) => ({
    name: r.leave_name as string,
    code: r.leave_code as string,
    allocated: Number(r.allocated_days ?? 0),
    used: Number(r.used_days ?? 0),
    available: Math.max(0, Number(r.allocated_days ?? 0) + Number(r.adjusted_days ?? 0) - Number(r.used_days ?? 0)),
  }));
  return {
    leave_data_available: true,
    leave_year: year,
    leave_balances: balances,
    total_available_leaves: balances.reduce((s, b) => s + b.available, 0),
  };
}

async function fetchAttendanceSummary(
  employeeId: string,
  db: Pool
): Promise<Record<string, unknown>> {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       SUM(status = 'present') AS present_days,
       SUM(status = 'half_day') AS half_days,
       SUM(status = 'absent') AS absent_days,
       SUM(status = 'late') AS late_days,
       SUM(status = 'leave_approved') AS leave_days,
       SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END) AS late_marks,
       SUM(COALESCE(lwp_value, 0)) AS total_lwp,
       ROUND(SUM(COALESCE(raw_minutes, 0)) / 60, 2) AS total_hours,
       COUNT(CASE WHEN status NOT IN ('holiday','week_off') THEN 1 END) AS working_days
     FROM attendance_daily_record
     WHERE employee_id = ?
       AND DATE_FORMAT(record_date, '%Y-%m') = ?
       AND record_date <= CURDATE()`,
    [employeeId, currentMonth]
  );
  if (!rows.length) return { attendance_data_available: false };
  const r = rows[0];
  const presentDays = Number(r.present_days ?? 0);
  const workingDays = Number(r.working_days ?? 1);
  const attPct = workingDays > 0 ? Math.round((presentDays / workingDays) * 1000) / 10 : 0;
  return {
    attendance_data_available: true,
    attendance_month: currentMonth,
    present_days_att: presentDays,
    absent_days_att: Number(r.absent_days ?? 0),
    half_days_att: Number(r.half_days ?? 0),
    late_days_att: Number(r.late_days ?? 0),
    late_marks_count: Number(r.late_marks ?? 0),
    lwp_total: Number(r.total_lwp ?? 0),
    working_days_att: workingDays,
    attendance_percentage: attPct,
    total_hours_logged: Number(r.total_hours ?? 0),
  };
}

export async function detectAndEnrich(
  question: string,
  userId: string,
  db: Pool
): Promise<{ intent: IntentKey; data: Record<string, unknown> }> {
  const intent = detectIntent(question);
  if (intent === 'unknown') return { intent, data: {} };

  const emp = await getEmployeeForUser(userId);
  if (!emp) return { intent, data: { employee_not_found: true } };

  let data: Record<string, unknown> = {};
  try {
    switch (intent) {
      case 'salary_breakup':
        data = await fetchSalaryBreakup(emp.id, db);
        break;
      case 'leave_balance':
        data = await fetchLeaveBalance(emp.id, db);
        break;
      case 'attendance_summary':
        data = await fetchAttendanceSummary(emp.id, db);
        break;
      case 'pending_actions':
        data = { pending_actions_hint: true };
        break;
    }
  } catch {
    data = { data_fetch_error: true };
  }

  return { intent, data };
}
```

- [ ] **Step 2: TypeScript check**

Run: `cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/ai/ai-intent.service.ts
git commit -m "feat(ai): add intent detection + HRMS data enrichment service"
```

---

## Track A: Task 2 — Wire intent enrichment into `/api/ai/ask` + extend rule-based formatter

**Files:**
- Modify: `backend/src/modules/ai/ai-insights.routes.ts`
- Modify: `backend/src/modules/ai/ai-safety.service.ts`

**Interfaces:**
- Consumes: `detectAndEnrich` from `./ai-intent.service.js`
- The import path uses `.js` extension (ESM convention used throughout the backend)

### Part A: `ai-insights.routes.ts` — inject enriched context

Find the `POST /ask` handler. After the `rawContext` object is built (the block with `user_id`, `user_role`, `context_type`, `entity_id`, `timestamp`) and BEFORE the `aiSafetyService.sanitizeContext(rawContext, roleKeys)` call, insert:

```typescript
// Intent enrichment — fetch real HRMS data for employee self-service questions
try {
  const { intent, data } = await detectAndEnrich(safeQuestion, userId, db);
  if (intent !== 'unknown') {
    rawContext.intent = intent;
    Object.assign(rawContext, data);
  }
} catch {
  // non-blocking — continue without enrichment
}
```

Also add the import at the top of the file:
```typescript
import { detectAndEnrich } from './ai-intent.service.js';
```

Verify `db` is available in the handler — check if it's imported at the top of the routes file. If not, add: `import { db } from '../../db/mysql.js';`

### Part B: `ai-safety.service.ts` — add intent-aware answer formatters

In `generateRuleBasedInsights(context, roleKeys)`, add new branches BEFORE the existing role checks. These run regardless of role when the relevant intent + data fields are present:

```typescript
// Check for intent-enriched data first (works for any role)
const intent = context.intent as string | undefined;

if (intent === 'salary_breakup' && context.salary_data_available === true) {
  return this.formatSalaryBreakup(context);
}
if (intent === 'leave_balance' && context.leave_data_available === true) {
  return this.formatLeaveBalance(context);
}
if (intent === 'attendance_summary' && context.attendance_data_available === true) {
  return this.formatAttendanceSummary(context);
}
if (intent === 'salary_breakup' && context.salary_data_available === false) {
  return 'No payslip records found yet. Your salary summary will appear here once your first payroll is processed. Contact HR if you believe this is an error.';
}
if (intent === 'leave_balance' && context.leave_data_available === false) {
  return 'No leave balance records found for this year. Leave balances are set up by HR at the start of each year. Please contact HR to check your allocation.';
}
if (intent === 'attendance_summary' && context.attendance_data_available === false) {
  return 'No attendance records found for this month yet. Attendance is recorded daily — check back after your first punch-in.';
}
```

Add these three private formatter methods to `AiSafetyService`:

```typescript
private formatSalaryBreakup(ctx: Record<string, unknown>): string {
  const month = String(ctx.salary_month ?? 'latest period');
  const earnings = Number(ctx.earnings_total ?? 0);
  const deductions = Number(ctx.deductions_total ?? 0);
  const takeHome = Number(ctx.take_home_amount ?? 0);
  const basic = Number(ctx.basic_component ?? 0);
  const hra = Number(ctx.hra_component ?? 0);
  const special = Number(ctx.special_allowance_component ?? 0);
  const pf = Number(ctx.pf_deduction ?? 0);
  const tds = Number(ctx.tds_deduction ?? 0);
  const pt = Number(ctx.professional_tax_deduction ?? 0);
  const lwp = Number(ctx.lwp_deduction ?? 0);
  const presentDays = Number(ctx.present_days_count ?? 0);
  const workingDays = Number(ctx.working_days_count ?? 0);

  const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;

  const lines: string[] = [
    `Your salary for ${month}:`,
    ``,
    `Earnings: ${fmt(earnings)}`,
    basic > 0 ? `  • Basic: ${fmt(basic)}` : '',
    hra > 0 ? `  • HRA: ${fmt(hra)}` : '',
    special > 0 ? `  • Special Allowance: ${fmt(special)}` : '',
    ``,
    `Deductions: ${fmt(deductions)}`,
    pf > 0 ? `  • PF: ${fmt(pf)}` : '',
    tds > 0 ? `  • TDS: ${fmt(tds)}` : '',
    pt > 0 ? `  • Professional Tax: ${fmt(pt)}` : '',
    lwp > 0 ? `  • LWP Deduction: ${fmt(lwp)}` : '',
    ``,
    `Take-home: ${fmt(takeHome)}`,
    workingDays > 0 ? `Present: ${presentDays}/${workingDays} days` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

private formatLeaveBalance(ctx: Record<string, unknown>): string {
  const year = Number(ctx.leave_year ?? new Date().getFullYear());
  const balances = ctx.leave_balances as Array<{ name: string; allocated: number; used: number; available: number }> ?? [];
  if (!balances.length) return `No leave balance data available for ${year}.`;

  const lines = [`Your leave balances for ${year}:`, ``];
  for (const b of balances) {
    lines.push(`${b.name}: ${b.available} days available (${b.used}/${b.allocated} used)`);
  }
  const totalAvail = Number(ctx.total_available_leaves ?? 0);
  lines.push(``, `Total available: ${totalAvail} days`);
  return lines.join('\n');
}

private formatAttendanceSummary(ctx: Record<string, unknown>): string {
  const month = String(ctx.attendance_month ?? 'this month');
  const present = Number(ctx.present_days_att ?? 0);
  const absent = Number(ctx.absent_days_att ?? 0);
  const late = Number(ctx.late_days_att ?? 0);
  const lateMarks = Number(ctx.late_marks_count ?? 0);
  const lwp = Number(ctx.lwp_total ?? 0);
  const workingDays = Number(ctx.working_days_att ?? 0);
  const attPct = Number(ctx.attendance_percentage ?? 0);
  const hours = Number(ctx.total_hours_logged ?? 0);

  const lines = [
    `Your attendance for ${month}:`,
    ``,
    `Present: ${present} days | Absent: ${absent} days | Late: ${late} days`,
    `Attendance: ${attPct}% (${present}/${workingDays} working days)`,
    lateMarks > 0 ? `Late marks: ${lateMarks}` : '',
    lwp > 0 ? `LWP (Leave Without Pay): ${lwp} day(s)` : '',
    hours > 0 ? `Total hours logged: ${hours}h` : '',
  ];
  return lines.filter(Boolean).join('\n');
}
```

- [ ] **Step 1: Add import to `ai-insights.routes.ts`**

Find the imports at the top of the file. Add after the existing AI module imports:
```typescript
import { detectAndEnrich } from './ai-intent.service.js';
```
Also verify `db` import exists (`import { db } from '../../db/mysql.js'`).

- [ ] **Step 2: Inject enrichment into the POST /ask handler**

Find rawContext build block. Insert the enrichment try/catch block immediately after `rawContext` is assigned, before `aiSafetyService.sanitizeContext`.

- [ ] **Step 3: Add intent-aware branches to `generateRuleBasedInsights`**

In `ai-safety.service.ts`, find `generateRuleBasedInsights` function. Insert the 9 new if-branches at the very top of the function body, before the existing `const role = roleKeys[0]` check.

- [ ] **Step 4: Add 3 private formatter methods to `AiSafetyService`**

Add `formatSalaryBreakup`, `formatLeaveBalance`, `formatAttendanceSummary` as private methods.

- [ ] **Step 5: TypeScript check**

Run: `cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Manual smoke test (optional but recommended)**

```bash
# Start backend if running locally
curl -s -X POST http://localhost:5055/api/ai/ask \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <employee_token>" \
  -d '{"question":"my salary breakup","context_type":"generic"}' | jq .data.answer
```
Expected: Multi-line salary summary with real figures, NOT "Context analyzed..."

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/ai/ai-insights.routes.ts \
        backend/src/modules/ai/ai-safety.service.ts
git commit -m "feat(ai): wire intent enrichment into /ask — real salary, leave, attendance answers"
```

---

## Track B: Task 3 — Activate Gemini via env var

**Files:**
- Modify: `backend/src/config/env.ts`
- Modify: `backend/src/modules/ai/ai-provider.registry.ts`
- Modify: `backend/src/modules/ai/providers/gemini.provider.ts`

**Goal:** When `GEMINI_API_KEY` is set in the environment, Gemini becomes the default provider automatically — no DB row needed.

### Part A: `env.ts` — add optional `GEMINI_API_KEY`

Add to the Zod schema:
```typescript
GEMINI_API_KEY: z.string().default(""),
```
Pattern for default-empty optional string is already used throughout the file (e.g. `LMS_BRIDGE_SECRET`).

### Part B: `gemini.provider.ts` — env var fallback

The current `generateText` method receives `request.sanitizedContext` and calls `initSdk(config?.apiKey)`. Modify `generateText` to also check `env.GEMINI_API_KEY` when `config?.apiKey` is falsy:

Find where `apiKey` is resolved from config and add the fallback:
```typescript
const apiKey = (config?.apiKey ?? '') || env.GEMINI_API_KEY;
if (!apiKey) throw new Error('Gemini API key not configured');
```

Do the same in `testConnection`.

### Part C: `ai-provider.registry.ts` — auto-activate Gemini on startup

Add a new async method `autoActivateFromEnv()` that runs on startup:

```typescript
async autoActivateFromEnv(): Promise<void> {
  if (!env.GEMINI_API_KEY) return;
  try {
    // Check if there's already an active Gemini config in DB
    const existing = await aiProviderConfigService.getByKey('gemini', false);
    if (existing?.activeStatus === 'active') return; // already active via DB
    // No DB config — activate Gemini from env var by storing it
    await aiProviderConfigService.upsertFromEnv('gemini', env.GEMINI_API_KEY);
  } catch {
    // Non-fatal — log and continue with rule-based
    console.warn('[AI] Could not auto-activate Gemini from env var');
  }
}
```

And add `upsertFromEnv` to `ai-provider-config.service.ts`:

```typescript
async upsertFromEnv(providerKey: string, apiKey: string): Promise<void> {
  const encrypted = this.encryptKey(apiKey);
  await db.execute(
    `INSERT INTO ai_provider_config
       (id, provider_key, provider_name, encrypted_api_key, model_name,
        active_status, is_default, created_at, updated_at)
     VALUES (UUID(), ?, ?, ?, 'gemini-2.0-flash', 'active', 1, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       encrypted_api_key = VALUES(encrypted_api_key),
       active_status = 'active',
       is_default = 1,
       updated_at = NOW()`,
    [providerKey, 'Google Gemini AI', encrypted]
  );
}
```

Call `autoActivateFromEnv()` during app startup — in `backend/src/server.ts` or `backend/src/app.ts` after the registry is initialized.

### Part D: System prompt

In `ai-safety.service.ts`, find `buildSystemInstruction(roleKeys, contextType)`. Update the returned string to include PeopleOS identity:

```typescript
const base = `You are PeopleOS Copilot, an AI assistant for MAS Callnet's HR platform. ` +
  `Answer employee questions about their salary, attendance, leave, and HR data ` +
  `using the provided context. Be concise, specific, and friendly. ` +
  `Always use ₹ (Indian Rupee) for currency. ` +
  `If the data isn't in the context, say so honestly — never fabricate figures.`;
```

Prepend this to whatever the existing method returns.

- [ ] **Step 1: Add `GEMINI_API_KEY` to `env.ts`**

- [ ] **Step 2: Update `gemini.provider.ts`** — add env fallback for `generateText` and `testConnection`

- [ ] **Step 3: Add `upsertFromEnv` to `ai-provider-config.service.ts`**

- [ ] **Step 4: Add `autoActivateFromEnv` to `ai-provider.registry.ts`**

- [ ] **Step 5: Call `autoActivateFromEnv` in app startup**

Find where the app initializes in `backend/src/app.ts` or `backend/src/server.ts` — add:
```typescript
void aiProviderRegistry.autoActivateFromEnv();
```

- [ ] **Step 6: Update system prompt in `ai-safety.service.ts`**

- [ ] **Step 7: TypeScript check**

Run: `cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add backend/src/config/env.ts \
        backend/src/modules/ai/providers/gemini.provider.ts \
        backend/src/modules/ai/ai-provider-config.service.ts \
        backend/src/modules/ai/ai-provider.registry.ts \
        backend/src/modules/ai/ai-safety.service.ts \
        backend/src/app.ts   # or server.ts
git commit -m "feat(ai): activate Gemini via GEMINI_API_KEY env var with auto-upsert on startup"
```

---

## Task 4: Final verification + production env update

- [ ] **Step 1: Frontend TypeScript check**
```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 2: Backend TypeScript check**
```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Push to main**
```bash
git push origin main
```
GitHub Actions deploys to mcnhrms.teammas.in.

- [ ] **Step 4: Set GEMINI_API_KEY on production server**

On the production server at `/var/www/HRMS2/backend/.env`, add:
```
GEMINI_API_KEY=<your-gemini-api-key>
```
Then restart: `pm2 restart hrms2-backend`

- [ ] **Step 5: Verify Gemini activation**
```bash
curl -s http://127.0.0.1:5055/api/ai/providers/active \
  -H "Authorization: Bearer <any_valid_token>" | jq .
```
Expected: `{ "data": { "providerKey": "gemini", "providerName": "Google Gemini AI" } }`

- [ ] **Step 6: Test salary question**
Ask the Copilot: "my salary breakup"
Expected: Real salary figures with earnings/deductions/take-home breakdown

---

## Files Changed Summary

| File | Change |
|------|--------|
| `backend/src/modules/ai/ai-intent.service.ts` | NEW — 5 intents, 3 DB fetchers, detectAndEnrich() |
| `backend/src/modules/ai/ai-insights.routes.ts` | Add detectAndEnrich call + import |
| `backend/src/modules/ai/ai-safety.service.ts` | 9 intent branches + 3 formatters + system prompt update |
| `backend/src/modules/ai/providers/gemini.provider.ts` | Add env var fallback for API key |
| `backend/src/modules/ai/ai-provider-config.service.ts` | Add upsertFromEnv method |
| `backend/src/modules/ai/ai-provider.registry.ts` | Add autoActivateFromEnv method |
| `backend/src/config/env.ts` | Add GEMINI_API_KEY optional field |
| `backend/src/app.ts` or `server.ts` | Call autoActivateFromEnv on startup |
