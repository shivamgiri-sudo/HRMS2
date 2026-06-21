# LMS Integration Layer — MyHRMS1

**Goal:** Sync learner progress, MCQ scores, certification status from mcn_lms to mas_hrms. Enable dashboards to display training readiness, risk signals, operations handover status.

**Data Flow:** mcn_lms (source of truth) → mas_hrms (snapshots via sync job) → dashboards

---

## LMS Schema (mcn_lms @ 115.241.59.220)

| Table | Rows | Key Fields | Purpose |
|-------|------|-----------|---------|
| assessment_attempts | 108 | employee_id, assessment_id, percentage, result, submitted_at | MCQ scores per attempt |
| assessment_master | 5 | assessment_id, classroom_id, assessment_name, passing_pct, attempt_limit | Assessment definitions |
| batch_master | 9 | batch_no, batch_name, process, branch, start_date, end_date, classroom_id | Training batches |
| batch_classroom_map | N/A | batch_no, classroom_id, classroom_name | Batch ↔ Classroom link |
| classroom_master | N/A | classroom_id, classroom_name, process, lob | Classrooms (content containers) |
| content_master | 104 | content_id, module_id, content_type, content_title | Course modules/content |
| certification_evidence | 0 | employee_id, batch_no, evidence_type, result, score_pct | Certification milestones |
| certification_rule_master | N/A | process, lob, course_completion_min, mcq_pass_pct_min, attendance_pct_min | Cert eligibility rules |
| assigned_modules | N/A | module_id, assigned_to, assignment_type, due_date | Direct learning assignments |
| content_progress | ? | employee_id, module_id, progress_pct, completed_at | Learner module progress |
| course_completion_report | ? | employee_id, batch_no, completion_pct, completed_at | Overall batch progress |
| attendance_inference | N/A | employee_id, batch_no, date, course_activity, mcq_activity, final_attendance | Training attendance inference |

---

## Integration Schema (mas_hrms)

Create snapshots of LMS state for dashboard queries. Sync runs hourly (configurable).

### New Tables

**1. lms_learner_progress** (snapshot of learner readiness)
```sql
CREATE TABLE lms_learner_progress (
  id CHAR(36) PRIMARY KEY,
  employee_id VARCHAR(20) NOT NULL,
  employee_code VARCHAR(20),
  batch_no VARCHAR(50),
  batch_name VARCHAR(200),
  process_name VARCHAR(100),
  branch_name VARCHAR(100),
  course_completion_pct DECIMAL(5,2),
  mcq_best_score DECIMAL(5,2),
  mcq_pass_status ENUM('pass', 'fail', 'pending'),
  attendance_pct DECIMAL(5,2),
  certification_status ENUM('not_started', 'in_progress', 'eligible', 'certified', 'failed'),
  readiness_score DECIMAL(5,2),
  attrition_risk_signal ENUM('green', 'yellow', 'red'),
  last_activity_date DATETIME,
  ops_handover_ready BOOLEAN,
  synced_at DATETIME,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  INDEX (employee_code, batch_no, certification_status, attrition_risk_signal)
);
```

**2. lms_assessment_scores** (MCQ attempts snapshot)
```sql
CREATE TABLE lms_assessment_scores (
  id CHAR(36) PRIMARY KEY,
  employee_id VARCHAR(20) NOT NULL,
  employee_code VARCHAR(20),
  batch_no VARCHAR(50),
  assessment_name VARCHAR(200),
  attempt_no INT,
  score DECIMAL(5,2),
  percentage DECIMAL(5,2),
  result ENUM('pass', 'fail'),
  time_taken_seconds INT,
  attempted_at DATETIME,
  synced_at DATETIME,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  INDEX (employee_code, batch_no, attempted_at)
);
```

**3. lms_sync_audit** (Sync status tracking)
```sql
CREATE TABLE lms_sync_audit (
  id CHAR(36) PRIMARY KEY,
  sync_type VARCHAR(50),
  status ENUM('pending', 'running', 'success', 'failed'),
  rows_synced INT,
  error_message TEXT,
  started_at DATETIME,
  completed_at DATETIME,
  INDEX (sync_type, status, completed_at)
);
```

---

## Sync Logic

### Job 1: Learner Progress Snapshot
Runs hourly. Denormalize LMS assessment + batch + certification rules → lms_learner_progress.

```
FOR EACH (employee_id IN assessment_attempts):
  - Get batch_no, batch_name FROM batch_classroom_map
  - Get best MCQ score FROM assessment_attempts GROUP BY employee_id
  - Get course_completion_pct FROM course_completion_report
  - Get attendance_pct FROM attendance_inference
  - Apply certification_rule_master rules
  → Calculate readiness_score (weighted: course 30%, MCQ 40%, attendance 20%, behavior 10%)
  → Flag attrition_risk (declining scores, gaps, low attendance)
  → Set ops_handover_ready (if readiness_score >= 75%)
  INSERT OR UPDATE lms_learner_progress
```

### Job 2: Assessment Scores Snapshot
Runs hourly. Copy assessment_attempts → lms_assessment_scores with employee mappings.

```
INSERT INTO lms_assessment_scores (employee_id, employee_code, batch_no, assessment_name, ...)
SELECT aa.employee_id, e.employee_code, bcm.batch_no, am.assessment_name, ...
FROM mcn_lms.assessment_attempts aa
LEFT JOIN mas_hrms.employees e ON e.id = aa.employee_id OR e.employee_code = aa.employee_id
LEFT JOIN mcn_lms.batch_classroom_map bcm ON bcm.classroom_id = am.classroom_id
LEFT JOIN mcn_lms.assessment_master am ON am.assessment_id = aa.assessment_id
ON DUPLICATE KEY UPDATE percentage = VALUES(percentage), result = VALUES(result), synced_at = NOW()
```

### Job 3: Certification Readiness
Runs every 6 hours. Evaluate certification eligibility per certification_rule_master.

```
FOR EACH (employee_id, process, lob):
  - Get cert_rule FROM certification_rule_master
  - Check: course_completion_pct >= rule.course_completion_min
  - Check: best_mcq_pct >= rule.mcq_pass_pct_min
  - Check: attendance_pct >= rule.attendance_pct_min
  - If all pass: certification_status = 'eligible'
  - If eligible + certification_evidence exists: certification_status = 'certified'
  UPDATE lms_learner_progress
```

---

## API Endpoints (MyHRMS1 Backend)

### GET /api/lms/learner-progress/:employee_id
Returns current training readiness snapshot for dashboard.
```json
{
  "employee_code": "MAS62817",
  "batch_no": "ENT_DOC_JUN'26_005",
  "course_completion_pct": 85.5,
  "mcq_best_score": 92,
  "certification_status": "eligible",
  "readiness_score": 88,
  "attrition_risk_signal": "green",
  "ops_handover_ready": true,
  "last_activity_date": "2026-06-18T16:49:42Z"
}
```

### GET /api/lms/batch-progress/:batch_no
Aggregate progress for entire batch (manager/ops view).
```json
{
  "batch_no": "ENT_DOC_JUN'26_005",
  "total_learners": 12,
  "avg_course_completion": 82,
  "avg_mcq_score": 88,
  "passed_certification": 5,
  "at_risk": 2,
  "ops_ready": 8
}
```

### GET /api/lms/assessment-scores/:employee_id
Assessment attempt history.
```json
{
  "employee_code": "MAS62817",
  "attempts": [
    {
      "assessment_name": "Classification Quiz",
      "score": 100,
      "result": "pass",
      "attempted_at": "2026-06-18T16:49:42Z"
    }
  ]
}
```

---

## Dashboard Integration Points

**LMS Progress Widget (Employee Dashboard)**
- Display current batch, course completion %, certification status
- Show attrition risk (red flag if declining scores)
- Link: "Go to LMS" (SSO if available)

**Manager Quality Dashboard**
- Show batch readiness (% eligible for certification)
- Highlight at-risk learners (MCQ failures, low attendance)
- Ops handover readiness (which batches ready for ops deployment)

**CEO/CFO Dashboard**
- Training ROI: course_completion % vs payroll cost
- Certification velocity (per batch, per process)
- Attrition correlation (training completers vs stayers)

**Operations Handover Queue**
- Filter lms_learner_progress WHERE ops_handover_ready=1
- Show certification_status, readiness_score
- Auto-trigger OJT assignment when ready

---

## Sync Schedule

| Job | Frequency | Timeout | Retry |
|-----|-----------|---------|-------|
| Learner Progress | Every 1h | 5m | 3× on failure |
| Assessment Scores | Every 1h | 3m | 3× on failure |
| Certification Rules | Every 6h | 5m | 2× on failure |

---

## Security

- LMS DB credentials stored in backend .env (NEVER in code)
- Read-only user `shivam_user` on mcn_lms
- All queries parameterized (no SQL injection)
- Sync audit logged (who/when/what synced)
- No PII exported to dashboards (aggregate only, or employee_code masking if needed)

---

## Testing

1. **Connectivity:** Backend can reach LMS DB
2. **Data Mapping:** employee_id from LMS matches mas_hrms.employees.id or .employee_code
3. **Sync Dry-run:** Run sync logic, verify mas_hrms tables populated
4. **Dashboard Query:** Verify LMS data surfaces in API responses
5. **Edge Cases:** Empty batch, null dates, missing assessments

---

## Known Constraints

- **employee_id format:** LMS uses employee_code (e.g., "mas62817"). MyHRMS1 uses UUID (id). Mapping needed on sync.
- **Certification evidence empty:** No certs recorded yet. Rules are defined but no evidence table data. Sync will track eligibility, actual certifications TBD.
- **Course completion:** No explicit `course_completion_report` data seen. Will infer from content_progress or attendance_inference.
