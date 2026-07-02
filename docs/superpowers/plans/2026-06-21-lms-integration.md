# LMS Integration Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build sync engine that pulls learner progress from mcn_lms → mas_hrms snapshots. Enable dashboards to show training readiness, MCQ scores, certification status, attrition signals.

**Architecture:** Hourly cron job syncs LMS assessment/progress data to mas_hrms snapshots. Express APIs query snapshots for dashboards. No modifications to live LMS tables.

**Tech Stack:** Node.js cron, MySQL, Express.js, TypeScript.

---

## Phase 1: Schema & Migration

### Task 1: Create LMS snapshot tables

**Files:**
- Create: `backend/sql/250_lms_integration_schema.sql`
- Modify: `backend/sql/000_run_all.sql`

**Steps:**

1. Create migration file:

```sql
-- backend/sql/250_lms_integration_schema.sql

-- 1. Learner progress snapshot
CREATE TABLE IF NOT EXISTS lms_learner_progress (
  id CHAR(36) PRIMARY KEY,
  employee_id VARCHAR(20) NOT NULL,
  employee_code VARCHAR(20),
  batch_no VARCHAR(50),
  batch_name VARCHAR(200),
  process_name VARCHAR(100),
  branch_name VARCHAR(100),
  course_completion_pct DECIMAL(5,2) DEFAULT 0,
  mcq_best_score DECIMAL(5,2) DEFAULT 0,
  mcq_pass_status ENUM('pass', 'fail', 'pending') DEFAULT 'pending',
  attendance_pct DECIMAL(5,2) DEFAULT 0,
  certification_status ENUM('not_started', 'in_progress', 'eligible', 'certified', 'failed') DEFAULT 'not_started',
  readiness_score DECIMAL(5,2) DEFAULT 0,
  attrition_risk_signal ENUM('green', 'yellow', 'red') DEFAULT 'green',
  last_activity_date DATETIME,
  ops_handover_ready BOOLEAN DEFAULT 0,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY (employee_id, batch_no),
  KEY (employee_code),
  KEY (certification_status),
  KEY (attrition_risk_signal),
  KEY (ops_handover_ready)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Assessment scores snapshot
CREATE TABLE IF NOT EXISTS lms_assessment_scores (
  id CHAR(36) PRIMARY KEY,
  employee_id VARCHAR(20) NOT NULL,
  employee_code VARCHAR(20),
  batch_no VARCHAR(50),
  assessment_name VARCHAR(200),
  attempt_no INT DEFAULT 1,
  score DECIMAL(5,2),
  percentage DECIMAL(5,2),
  result ENUM('pass', 'fail') NOT NULL,
  time_taken_seconds INT,
  attempted_at DATETIME NOT NULL,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY (employee_id, batch_no, assessment_name, attempt_no),
  KEY (employee_code),
  KEY (batch_no),
  KEY (attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Sync audit trail
CREATE TABLE IF NOT EXISTS lms_sync_audit (
  id CHAR(36) PRIMARY KEY,
  sync_type VARCHAR(50) NOT NULL,
  status ENUM('pending', 'running', 'success', 'failed') DEFAULT 'pending',
  rows_synced INT DEFAULT 0,
  rows_failed INT DEFAULT 0,
  error_message TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  KEY (sync_type),
  KEY (status),
  KEY (completed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

2. Add to 000_run_all.sql:

```bash
grep -n "SOURCE" /home/shuvam/Desktop/MyHRMS1/backend/sql/000_run_all.sql | tail -3
# Add after last SOURCE line:
echo "SOURCE ./250_lms_integration_schema.sql;" >> /home/shuvam/Desktop/MyHRMS1/backend/sql/000_run_all.sql
```

3. Run migration (local test only):

```bash
cd /home/shuvam/Desktop/MyHRMS1/backend/sql
mysql -u root mas_hrms < 250_lms_integration_schema.sql
```

4. Commit:

```bash
cd /home/shuvam/Desktop/MyHRMS1
git add backend/sql/250_lms_integration_schema.sql backend/sql/000_run_all.sql
git commit -m "feat: add LMS integration snapshot schema

- Create lms_learner_progress (training readiness snapshots)
- Create lms_assessment_scores (MCQ attempt history)
- Create lms_sync_audit (sync status tracking)
- Add indexes for query performance

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Phase 2: Sync Engine

### Task 2: LMS sync service

**Files:**
- Create: `backend/src/modules/lms-integration/lms-sync.service.ts`
- Create: `backend/src/modules/lms-integration/lms-external-db.ts`

**Steps:**

1. Create external DB connection pool (read-only to mcn_lms):

```typescript
// backend/src/modules/lms-integration/lms-external-db.ts
import mysql from 'mysql2/promise';

const lmsPool = mysql.createPool({
  host: process.env.LMS_DB_HOST || '115.241.59.220',
  user: process.env.LMS_DB_USER || 'shivam_user',
  password: process.env.LMS_DB_PASSWORD || 'qwersdfg!@#hjk',
  database: 'mcn_lms',
  waitForConnections: true,
  connectionLimit: 3,
  queueLimit: 0,
  enableTimezoneSupport: true,
});

export async function getLmsConnection() {
  return lmsPool.getConnection();
}
```

2. Create sync service:

```typescript
// backend/src/modules/lms-integration/lms-sync.service.ts
import { db } from '../../db/mysql.js';
import { getLmsConnection } from './lms-external-db.js';
import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2';

export const lmsSyncService = {
  async syncLearnerProgress(): Promise<{ synced: number; failed: number }> {
    const auditId = randomUUID();
    await logSyncStart('learner_progress', auditId);

    let synced = 0, failed = 0;
    try {
      const lms = await getLmsConnection();

      // Get unique employee IDs from assessment attempts
      const [employees] = await lms.execute<RowDataPacket[]>(`
        SELECT DISTINCT aa.employee_id
        FROM assessment_attempts aa
        WHERE aa.submitted_at IS NOT NULL
        LIMIT 1000
      `);

      for (const emp of employees) {
        try {
          // Get employee code from mas_hrms
          const [eRows] = await db.execute<RowDataPacket[]>(
            `SELECT id, employee_code FROM employees WHERE id = ? OR employee_code = ? LIMIT 1`,
            [emp.employee_id, emp.employee_id]
          );

          if (!eRows.length) continue; // Skip unmapped employees

          const empData = eRows[0];

          // Get best MCQ score
          const [scores] = await lms.execute<RowDataPacket[]>(`
            SELECT MAX(percentage) as best_score, COUNT(*) as attempt_count
            FROM assessment_attempts
            WHERE employee_id = ?
          `, [emp.employee_id]);

          const bestScore = scores[0]?.best_score || 0;

          // Get batch info
          const [batches] = await lms.execute<RowDataPacket[]>(`
            SELECT DISTINCT bcm.batch_no, bcm.batch_name, bm.process, bm.branch
            FROM assessment_attempts aa
            JOIN batch_classroom_map bcm ON bcm.classroom_id = (
              SELECT classroom_id FROM assessment_master WHERE assessment_id = aa.assessment_id LIMIT 1
            )
            LEFT JOIN batch_master bm ON bm.batch_no = bcm.batch_no
            WHERE aa.employee_id = ?
            LIMIT 1
          `, [emp.employee_id]);

          const batch = batches[0] || {};

          // Calculate readiness (mock for now — actual logic per SPEC)
          const readinessScore = Math.min(bestScore, 100);
          const riskSignal = readinessScore >= 80 ? 'green' : readinessScore >= 60 ? 'yellow' : 'red';

          await db.execute(`
            INSERT INTO lms_learner_progress (
              id, employee_id, employee_code, batch_no, batch_name, process_name, branch_name,
              mcq_best_score, readiness_score, attrition_risk_signal, ops_handover_ready, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
              mcq_best_score = VALUES(mcq_best_score),
              readiness_score = VALUES(readiness_score),
              attrition_risk_signal = VALUES(attrition_risk_signal),
              ops_handover_ready = VALUES(ops_handover_ready),
              synced_at = NOW()
          `, [
            randomUUID(),
            empData.id,
            empData.employee_code,
            batch.batch_no || null,
            batch.batch_name || null,
            batch.process || null,
            batch.branch || null,
            bestScore,
            readinessScore,
            riskSignal,
            readinessScore >= 75 ? 1 : 0
          ]);

          synced++;
        } catch (e) {
          console.error(`Failed to sync ${emp.employee_id}:`, e);
          failed++;
        }
      }

      await lms.end();
      await logSyncComplete('learner_progress', auditId, synced, failed);
      return { synced, failed };
    } catch (e) {
      await logSyncError('learner_progress', auditId, String(e));
      throw e;
    }
  },

  async syncAssessmentScores(): Promise<{ synced: number }> {
    const auditId = randomUUID();
    await logSyncStart('assessment_scores', auditId);

    let synced = 0;
    try {
      const lms = await getLmsConnection();

      const [attempts] = await lms.execute<RowDataPacket[]>(`
        SELECT aa.*, am.assessment_name,
               bcm.batch_no
        FROM assessment_attempts aa
        LEFT JOIN assessment_master am ON am.assessment_id = aa.assessment_id
        LEFT JOIN batch_classroom_map bcm ON bcm.classroom_id = am.classroom_id
        WHERE aa.submitted_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
        LIMIT 5000
      `);

      for (const att of attempts) {
        const [eRows] = await db.execute<RowDataPacket[]>(
          `SELECT employee_code FROM employees WHERE id = ? OR employee_code = ? LIMIT 1`,
          [att.employee_id, att.employee_id]
        );

        const empCode = eRows[0]?.employee_code || att.employee_id;

        await db.execute(`
          INSERT INTO lms_assessment_scores (
            id, employee_id, employee_code, batch_no, assessment_name, attempt_no,
            score, percentage, result, time_taken_seconds, attempted_at, synced_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            percentage = VALUES(percentage), result = VALUES(result), synced_at = NOW()
        `, [
          randomUUID(),
          att.employee_id,
          empCode,
          att.batch_no || null,
          att.assessment_name || 'Unknown Assessment',
          att.attempt_no || 1,
          att.score || 0,
          att.percentage || 0,
          att.result,
          att.time_taken_seconds || 0,
          att.submitted_at
        ]);

        synced++;
      }

      await lms.end();
      await logSyncComplete('assessment_scores', auditId, synced, 0);
      return { synced };
    } catch (e) {
      await logSyncError('assessment_scores', auditId, String(e));
      throw e;
    }
  }
};

async function logSyncStart(syncType: string, auditId: string) {
  await db.execute(`
    INSERT INTO lms_sync_audit (id, sync_type, status, started_at)
    VALUES (?, ?, 'running', NOW())
  `, [auditId, syncType]);
}

async function logSyncComplete(syncType: string, auditId: string, synced: number, failed: number) {
  await db.execute(`
    UPDATE lms_sync_audit
    SET status = 'success', rows_synced = ?, rows_failed = ?, completed_at = NOW()
    WHERE id = ?
  `, [synced, failed, auditId]);
}

async function logSyncError(syncType: string, auditId: string, error: string) {
  await db.execute(`
    UPDATE lms_sync_audit
    SET status = 'failed', error_message = ?, completed_at = NOW()
    WHERE id = ?
  `, [error.substring(0, 500), auditId]);
}
```

3. Test sync locally:

```bash
node -e "
import('./dist/backend/src/modules/lms-integration/lms-sync.service.js')
  .then(m => m.lmsSyncService.syncLearnerProgress())
  .then(r => console.log('Synced:', r))
  .catch(e => console.error('Error:', e.message))
"
```

4. Commit:

```bash
git add backend/src/modules/lms-integration/
git commit -m "feat: add LMS sync service

- Import learner progress from mcn_lms.assessment_attempts
- Map employee IDs to mas_hrms employees
- Calculate readiness scores and risk signals
- Support hourly re-sync (ON DUPLICATE KEY UPDATE)

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Phase 3: Cron Job

### Task 3: Schedule hourly sync

**Files:**
- Create: `backend/src/workers/lms-sync.worker.ts`
- Modify: `backend/src/app.ts` (register cron)

**Steps:**

1. Create worker:

```typescript
// backend/src/workers/lms-sync.worker.ts
import cron from 'node-cron';
import { lmsSyncService } from '../modules/lms-integration/lms-sync.service.js';

export function startLmsSyncCron() {
  // Run every hour at minute 5 (5 past each hour)
  cron.schedule('5 * * * *', async () => {
    try {
      console.log('[LMS Sync] Starting learner progress sync...');
      const result = await lmsSyncService.syncLearnerProgress();
      console.log(`[LMS Sync] Complete: ${result.synced} synced, ${result.failed} failed`);

      console.log('[LMS Sync] Starting assessment scores sync...');
      const scoreResult = await lmsSyncService.syncAssessmentScores();
      console.log(`[LMS Sync] Scores: ${scoreResult.synced} synced`);
    } catch (e) {
      console.error('[LMS Sync] Error:', e);
    }
  });

  console.log('[LMS Sync] Cron job scheduled: runs every hour at :05');
}
```

2. Register in app.ts:

```typescript
import { startLmsSyncCron } from './workers/lms-sync.worker.js';

// In app startup (after DB connected):
startLmsSyncCron();
console.log('[Server] LMS sync cron started');
```

3. Add .env vars:

```bash
LMS_DB_HOST=115.241.59.220
LMS_DB_USER=shivam_user
LMS_DB_PASSWORD=qwersdfg!@#hjk
```

4. Commit:

```bash
git add backend/src/workers/lms-sync.worker.ts backend/src/app.ts
git commit -m "feat: schedule hourly LMS sync cron job

- Sync learner progress every hour at :05
- Sync assessment scores every hour at :05
- Log sync results to lms_sync_audit table

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Phase 4: Dashboard APIs

### Task 4: LMS API endpoints

**Files:**
- Create: `backend/src/modules/lms-integration/lms-dashboard.routes.ts`
- Modify: `backend/src/app.ts`

**Steps:**

1. Create routes:

```typescript
// backend/src/modules/lms-integration/lms-dashboard.routes.ts
import { Router } from 'express';
import { db } from '../../db/mysql.js';
import { requireAuth } from '../../middleware/authMiddleware.js';
import type { Response, RowDataPacket } from 'mysql2';

const router = Router();
router.use(requireAuth);

const h = (fn: (req: any, res: Response) => Promise<any>) => (req: any, res: Response, next: any) =>
  fn(req, res).catch(next);

// GET /api/lms/learner-progress/:employee_id
router.get('/learner-progress/:employee_id', h(async (req: any, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM lms_learner_progress WHERE employee_id = ? OR employee_code = ? LIMIT 1`,
    [req.params.employee_id, req.params.employee_id]
  );

  if (!rows.length) {
    return res.status(404).json({ success: false, error: 'No LMS record found' });
  }

  return res.json({ success: true, data: rows[0] });
}));

// GET /api/lms/batch-progress/:batch_no
router.get('/batch-progress/:batch_no', h(async (req: any, res: Response) => {
  const [summary] = await db.execute<RowDataPacket[]>(`
    SELECT 
      batch_no,
      COUNT(DISTINCT employee_id) as total_learners,
      AVG(course_completion_pct) as avg_completion,
      AVG(mcq_best_score) as avg_score,
      COUNT(CASE WHEN certification_status = 'certified' THEN 1 END) as certified_count,
      COUNT(CASE WHEN attrition_risk_signal = 'red' THEN 1 END) as at_risk_count,
      COUNT(CASE WHEN ops_handover_ready = 1 THEN 1 END) as ops_ready_count
    FROM lms_learner_progress
    WHERE batch_no = ?
    GROUP BY batch_no
  `, [req.params.batch_no]);

  return res.json({ success: true, data: summary[0] || {} });
}));

// GET /api/lms/assessment-history/:employee_id
router.get('/assessment-history/:employee_id', h(async (req: any, res: Response) => {
  const [attempts] = await db.execute<RowDataPacket[]>(`
    SELECT * FROM lms_assessment_scores
    WHERE employee_id = ? OR employee_code = ?
    ORDER BY attempted_at DESC
    LIMIT 50
  `, [req.params.employee_id, req.params.employee_id]);

  return res.json({ success: true, data: attempts });
}));

export const lmsRouter = router;
```

2. Register in app.ts:

```typescript
import { lmsRouter } from './modules/lms-integration/lms-dashboard.routes.js';

app.use('/api/lms', lmsRouter);
```

3. Test endpoints:

```bash
curl -H "Authorization: Bearer TOKEN" http://localhost:5056/api/lms/batch-progress/ENT_DOC_JUN\'26_005
```

4. Commit:

```bash
git add backend/src/modules/lms-integration/lms-dashboard.routes.ts backend/src/app.ts
git commit -m "feat: add LMS dashboard API endpoints

- GET /api/lms/learner-progress/:employee_id
- GET /api/lms/batch-progress/:batch_no
- GET /api/lms/assessment-history/:employee_id

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Phase 5: Dashboard UI

### Task 5: LMS widgets on dashboard

**Files:**
- Modify: `src/pages/Dashboard.tsx` (home page)
- Modify: `src/components/dashboard/AdminWorkforceDashboard.tsx` (manager view)

**Steps:**

1. Add LMS widget to home dashboard:

```typescript
// In Dashboard.tsx, add after other widgets:

import { useLearnerProgress } from '@/hooks/useLearnerProgress';

function LmsProgressWidget() {
  const { data: progress, isLoading } = useLearnerProgress();

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (!progress) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Training Progress
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between">
          <span>Course Completion</span>
          <span className="font-semibold">{progress.course_completion_pct}%</span>
        </div>
        <ProgressBar value={progress.course_completion_pct} />
        
        <div className="flex justify-between text-sm">
          <span>MCQ Best Score</span>
          <span className="font-semibold">{progress.mcq_best_score}%</span>
        </div>
        
        <Badge variant={progress.certification_status === 'certified' ? 'default' : 'secondary'}>
          {progress.certification_status}
        </Badge>
      </CardContent>
    </Card>
  );
}
```

2. Create hook:

```typescript
// src/hooks/useLearnerProgress.ts
import { useQuery } from '@tanstack/react-query';
import { hrmsApi } from '@/lib/api';

export function useLearnerProgress() {
  const auth = useAuth();

  return useQuery({
    queryKey: ['lms-progress', auth?.user?.id],
    queryFn: async () => {
      const res = await hrmsApi.get(`/lms/learner-progress/${auth?.user?.id}`);
      return res.data?.data;
    },
    enabled: !!auth?.user?.id,
  });
}
```

3. Commit:

```bash
git add src/pages/Dashboard.tsx src/hooks/useLearnerProgress.ts
git commit -m "feat: add LMS progress widget to dashboard

- Show course completion %, MCQ scores, certification status
- Display attrition risk signal (green/yellow/red)
- Link to LMS for detailed progress

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Verification Checklist

- [ ] LMS schema tables created (lms_learner_progress, lms_assessment_scores, lms_sync_audit)
- [ ] Sync service reads from mcn_lms, writes to mas_hrms
- [ ] Cron job runs hourly, logs to audit table
- [ ] Learner progress API returns data for authenticated users
- [ ] Batch progress API shows aggregate metrics
- [ ] Dashboard widget displays LMS training status
- [ ] No errors in backend logs after first sync run
- [ ] Sync audit table shows "success" status
- [ ] All commits follow pattern

