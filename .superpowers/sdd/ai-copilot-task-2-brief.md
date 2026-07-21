# Task 2: Wire intent enrichment into /api/ai/ask + extend rule-based formatter

## Context
Task 2 of 4. Task 1 is complete: `backend/src/modules/ai/ai-intent.service.ts` exists and exports:
- `detectAndEnrich(question: string, userId: string, db: Pool): Promise<{ intent: IntentKey; data: Record<string, unknown> }>`
- `detectIntent(question: string): IntentKey`
- `IntentKey` type

This task modifies TWO existing files to make the AI answer real questions.

---

## Change 1: `backend/src/modules/ai/ai-insights.routes.ts`

### 1a — Add import at the top of the file

The file already imports from several `./` modules. After the last import (around line 18), add:
```typescript
import { detectAndEnrich } from './ai-intent.service.js';
```

Also check if `db` is available. The file currently uses `await import('../../db/mysql.js')` in some places dynamically. For the POST /ask handler, add a static import at the top:
```typescript
import { db } from '../../db/mysql.js';
```
(Only add this if `db` is not already statically imported — grep the file to check first.)

### 1b — Inject enrichment into the POST /ask handler

The current rawContext block (lines 237–241) is:
```typescript
  const rawContext: Record<string, unknown> = {
    user_id: userId,
    user_role: roleKeys[0],
    context_type: safeContextType,
    entity_id: safeEntityId,
    timestamp: new Date().toISOString(),
  };

  // Sanitize context
  const sanitizationResult = await aiSafetyService.sanitizeContext(rawContext, roleKeys);
```

Insert the enrichment block BETWEEN `rawContext` assignment and `sanitizeContext` call:
```typescript
  const rawContext: Record<string, unknown> = {
    user_id: userId,
    user_role: roleKeys[0],
    context_type: safeContextType,
    entity_id: safeEntityId,
    timestamp: new Date().toISOString(),
  };

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

  // Sanitize context
  const sanitizationResult = await aiSafetyService.sanitizeContext(rawContext, roleKeys);
```

---

## Change 2: `backend/src/modules/ai/ai-safety.service.ts`

### 2a — Add intent-aware branches to `generateRuleBasedInsights`

The function currently starts with:
```typescript
  generateRuleBasedInsights(
    context: Record<string, unknown>,
    roleKeys: string[]
  ): string {
    const role = roleKeys[0] || 'employee';

    // Extract common metrics
    const blockedCount = this.extractNumber(context, [...]);
```

Add these branches at the VERY START of the function body, BEFORE `const role = roleKeys[0]`:
```typescript
  generateRuleBasedInsights(
    context: Record<string, unknown>,
    roleKeys: string[]
  ): string {
    // Intent-enriched answers take priority for any role
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

    const role = roleKeys[0] || 'employee';
    // [existing code continues unchanged from here]
```

### 2b — Add three private formatter methods to `AiSafetyService`

Add these three private methods to the class (before the closing `}` of the class, after the existing private methods like `generatePayrollBlockerInsight`, `generateAttendanceRiskInsight`):

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
    const balances = ctx.leave_balances as Array<{
      name: string; allocated: number; used: number; available: number
    }> ?? [];
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

### 2c — Update system prompt

In `ai-safety.service.ts`, find the `buildSystemInstruction(roleKeys, contextType)` method. Prepend this string to whatever it currently returns:

```typescript
const peopleOSPrefix = `You are PeopleOS Copilot, an AI assistant for MAS Callnet's HR platform. ` +
  `Answer employee questions about their salary, attendance, leave, and HR data ` +
  `using the provided context. Be concise, specific, and friendly. ` +
  `Always use ₹ (Indian Rupee) for currency. ` +
  `If the data isn't in the context, say so honestly — never fabricate figures. ` +
  `\n\n`;
```

Then return `peopleOSPrefix + <existing return value>`.

---

## Global Constraints
- Only modify the two specified files (plus import additions)
- The enrichment try/catch is non-blocking — if it throws, the original rawContext (without enrichment) proceeds to sanitizeContext
- The 6 new intent branches must come BEFORE `const role = roleKeys[0]` in `generateRuleBasedInsights`
- The 3 formatter methods are private (not exported)
- No `any` in new code
- All existing behavior is preserved — the new branches are additive

## Steps
1. Add import `detectAndEnrich` (and `db` if not already static) to `ai-insights.routes.ts`
2. Insert the enrichment try/catch block in `ai-insights.routes.ts`
3. Add 6 intent branches at start of `generateRuleBasedInsights` in `ai-safety.service.ts`
4. Add 3 private formatter methods to `AiSafetyService`
5. Update `buildSystemInstruction` to prepend PeopleOS prefix
6. Run `cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit` — 0 errors
7. Commit: `git add backend/src/modules/ai/ai-insights.routes.ts backend/src/modules/ai/ai-safety.service.ts && git commit -m "feat(ai): wire intent enrichment into /ask — real salary, leave, attendance answers"`

## Report file
`c:\Users\ADMIN\Desktop\HRMS2-latest\.superpowers\sdd\ai-copilot-task-2-report.md`

Return: status, commit hash, TypeScript result, concerns.
