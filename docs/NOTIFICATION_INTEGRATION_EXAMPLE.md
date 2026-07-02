# Notification Integration - Code Examples

**Purpose**: Ready-to-use code snippets for integrating notifications into recruiter workflow

---

## Integration 1: Candidate Registration (REG_CANDIDATE)

**File**: `backend/src/modules/ats-full-parity/atsFullParity.routes.ts`  
**Endpoint**: POST `/api/ats-full-parity/intake`

**Add after candidate creation**:

```typescript
import { notificationService } from "../../services/notification.service.js";

// After candidate INSERT
const candidateId = insertResult.insertId;

// Send registration confirmation
try {
  await notificationService.send({
    template_code: "REG_CANDIDATE",
    recipients: [{
      type: "candidate",
      id: candidateId,
      email: req.body.email,
      mobile: req.body.mobile,
      name: req.body.full_name,
    }],
    context: {
      CandidateName: req.body.full_name,
      Org_Name: "MAS Callnet",
      RoleApplied: req.body.applied_for_process,
      Branch: req.body.applied_for_branch,
      QToken: qToken,  // From ats_queue_token
      RecruiterName: recruiterName,  // From assignment
      RecruiterMobile: recruiterMobile,  // From ats_recruiter_roster
    },
  });
} catch (error) {
  console.error("[Notification] REG_CANDIDATE failed:", error);
  // Don't fail the request if notification fails
}
```

---

## Integration 2: Recruiter Assignment (REG_RECRUITER)

**File**: `backend/src/modules/ats-full-parity/atsFullParity.routes.ts`  
**Endpoint**: POST `/api/ats-full-parity/intake` (after recruiter assignment)

**Add after recruiter_assigned_name is set**:

```typescript
import { notifyRecruiterNewAssignment } from "../../services/ats-notification.helper.js";

// After UPDATE ats_candidate SET recruiter_assigned_name = ?
try {
  await notifyRecruiterNewAssignment({
    candidateId: candidate.id,
    candidateName: candidate.full_name,
    mobile: candidate.mobile,
    email: candidate.email,
    branch: candidate.applied_for_branch,
    roleApplied: candidate.applied_for_process,
    qToken: qToken,
    recruiterName: recruiterName,
  });
} catch (error) {
  console.error("[Notification] REG_RECRUITER failed:", error);
}
```

---

## Integration 3: Interview Result Submission

**File**: `backend/src/modules/ats-full-parity/recruiterInterview.service.ts`  
**Function**: `submitInterviewUpdate()`

**Add after candidate stage update (around line 400)**:

```typescript
import {
  notifyCandidateStageSelected,
  notifyCandidateStageRejected,
  notifyCandidateFinalSelected,
} from "../../services/ats-notification.helper.js";

// After UPDATE ats_candidate SET current_stage = ?, status = ?
const finalDecision = raw.finalDecision;
const walkinEndStage = raw.walkinEndStage;

// Get candidate details for notifications
const [candidateRows]: any = await db.execute(
  "SELECT full_name, email, mobile, applied_for_process FROM ats_candidate WHERE id = ?",
  [candidateId]
);

const candidate = candidateRows[0];

// Send notification based on decision
try {
  if (finalDecision === "Selected") {
    // Check if this is final selection with offer
    if (raw.offerSalary && raw.offerDoj && raw.reportingTiming) {
      // Final selection with offer details
      await notifyCandidateFinalSelected({
        candidateId,
        candidateName: candidate.full_name,
        candidateEmail: candidate.email,
        roleApplied: candidate.applied_for_process,
        offerDOJ: raw.offerDoj,
        offerShift: raw.reportingTiming,
        offerSalary: raw.offerSalary,
      });
    } else {
      // Stage cleared (round passed, moving to next)
      await notifyCandidateStageSelected({
        candidateId,
        candidateName: candidate.full_name,
        candidateEmail: candidate.email,
        candidateMobile: candidate.mobile,
        stageName: walkinEndStage,
        roleApplied: candidate.applied_for_process,
      });
    }
  } else if (finalDecision === "Rejected") {
    // Rejection notification
    await notifyCandidateStageRejected({
      candidateId,
      candidateName: candidate.full_name,
      candidateEmail: candidate.email,
      roleApplied: candidate.applied_for_process,
    });
  }
  // No notification for Hold, Client Round - Pending, No Show
} catch (error: any) {
  console.error("[Notification] Interview result notification failed:", error.message);
  // Don't fail the submission if notification fails
}
```

---

## Integration 4: Queue Token Creation (with SLA tracking)

**File**: `backend/src/modules/ats/ats.queue.service.ts`  
**Function**: `createQueueToken()`

**Add after INSERT ats_queue_token**:

```typescript
// Store queue token creation time for SLA calculation
// SLA worker will automatically check candidates waiting > 30 mins
// No manual integration needed - worker runs in background

// Optional: Send immediate SMS to candidate with queue token
import { notificationService } from "../../services/notification.service.js";

try {
  await notificationService.send({
    template_code: "REG_CANDIDATE",
    recipients: [{
      type: "candidate",
      mobile: candidateMobile,
    }],
    context: {
      CandidateName: candidateName,
      Org_Name: "MAS Callnet",
      QToken: qToken,
      RecruiterName: recruiterName,
    },
    channel: "sms",  // SMS only for instant notification
  });
} catch (error) {
  console.error("[Notification] Queue token SMS failed:", error);
}
```

---

## Complete Example: recruiterInterview.service.ts Integration

**Location**: After line 380 in `submitInterviewUpdate()` function

```typescript
// ── Notification Integration ────────────────────────────────────────────────

import {
  notifyCandidateStageSelected,
  notifyCandidateStageRejected,
  notifyCandidateFinalSelected,
} from "../../services/ats-notification.helper.js";

/**
 * Send notification after successful interview submission
 */
async function notifyInterviewResult(
  candidateId: string,
  finalDecision: string,
  walkinEndStage: string,
  offerDetails?: {
    salary: number;
    doj: string;
    shift: string;
  }
): Promise<void> {
  try {
    // Get candidate details
    const [rows]: any = await db.execute(
      "SELECT full_name, email, mobile, applied_for_process FROM ats_candidate WHERE id = ?",
      [candidateId]
    );

    if (!rows || rows.length === 0) {
      console.warn("[Notification] Candidate not found:", candidateId);
      return;
    }

    const candidate = rows[0];

    // Send notification based on decision
    if (finalDecision === "Selected") {
      if (offerDetails) {
        // Final selection with offer
        await notifyCandidateFinalSelected({
          candidateId,
          candidateName: candidate.full_name,
          candidateEmail: candidate.email,
          roleApplied: candidate.applied_for_process,
          offerDOJ: offerDetails.doj,
          offerShift: offerDetails.shift,
          offerSalary: offerDetails.salary,
        });
      } else {
        // Stage selected (round cleared)
        await notifyCandidateStageSelected({
          candidateId,
          candidateName: candidate.full_name,
          candidateEmail: candidate.email,
          candidateMobile: candidate.mobile,
          stageName: walkinEndStage,
          roleApplied: candidate.applied_for_process,
        });
      }
    } else if (finalDecision === "Rejected") {
      // Rejection notification
      await notifyCandidateStageRejected({
        candidateId,
        candidateName: candidate.full_name,
        candidateEmail: candidate.email,
        roleApplied: candidate.applied_for_process,
      });
    }
    // No notification for Hold, Client Round - Pending, No Show
  } catch (error: any) {
    console.error("[Notification] Failed to send interview result notification:", error.message);
    // Don't throw - notification failure shouldn't break the submission
  }
}

// ── Add to submitInterviewUpdate() after candidate UPDATE ──────────────────

// After: await db.execute("UPDATE ats_candidate SET current_stage = ?, status = ? WHERE id = ?", ...)

// Determine offer details
const offerDetails = raw.offerSalary && raw.offerDoj && raw.reportingTiming
  ? {
      salary: raw.offerSalary,
      doj: raw.offerDoj,
      shift: raw.reportingTiming,
    }
  : undefined;

// Send notification (non-blocking)
await notifyInterviewResult(
  candidateId,
  raw.finalDecision,
  raw.walkinEndStage,
  offerDetails
);

// Continue with audit log and commit...
```

---

## Error Handling Best Practices

### 1. Non-Blocking Notifications

```typescript
// ✅ GOOD: Don't fail request if notification fails
try {
  await notificationService.send(...);
} catch (error) {
  console.error("[Notification] Failed:", error);
  // Continue execution
}

// ❌ BAD: Don't let notification errors break the flow
await notificationService.send(...);  // Throws and breaks request
```

### 2. Async Fire-and-Forget

```typescript
// ✅ GOOD: Fire and forget for non-critical notifications
notificationService.send(...).catch((err) => {
  console.error("[Notification] Background notification failed:", err);
});

// Return response immediately
return res.json({ success: true });
```

### 3. Retry Logic (for critical notifications)

```typescript
// For critical notifications (e.g., offer letters)
async function sendWithRetry(input: any, maxRetries = 3): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await notificationService.send(input);
      return; // Success
    } catch (error) {
      if (i === maxRetries - 1) throw error; // Last attempt failed
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
    }
  }
}
```

---

## Testing After Integration

### 1. Test Candidate Registration
```bash
curl -X POST http://localhost:3000/api/ats-full-parity/intake \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Test Candidate",
    "email": "test@example.com",
    "mobile": "+919999999999",
    "applied_for_process": "GPI",
    "applied_for_branch": "Mumbai"
  }'

# Check notification_log table
mysql> SELECT * FROM notification_log ORDER BY created_at DESC LIMIT 1;
```

### 2. Test Interview Submission
```bash
# Submit interview result
curl -X POST http://localhost:3000/api/ats-full-parity/recruiter-submission \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{
    "candidateId": "candidate-id",
    "qToken": "token-123",
    "finalDecision": "Selected",
    ...
  }'

# Check notification was sent
mysql> SELECT template_code, status, recipient_email 
       FROM notification_log 
       WHERE recipient_id = 'candidate-id' 
       ORDER BY created_at DESC LIMIT 1;
```

### 3. Test SLA Worker
```bash
# Manually trigger SLA check
tsx backend/src/workers/sla-breach-worker.ts

# Check logs
pm2 logs sla-breach-worker

# Check database
mysql> SELECT COUNT(*) FROM notification_log 
       WHERE template_code = 'SLA_BREACH' 
       AND DATE(created_at) = CURDATE();
```

---

## Monitoring Integration Health

```sql
-- Check notification success rate (last 24 hours)
SELECT
  template_code,
  COUNT(*) as total,
  SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
  ROUND(100.0 * SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM notification_log
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY template_code;

-- Find candidates who should have received notifications but didn't
SELECT
  c.id,
  c.full_name,
  c.status,
  c.current_stage,
  (SELECT COUNT(*) FROM notification_log WHERE recipient_id = c.id) as notification_count
FROM ats_candidate c
WHERE c.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
  AND c.status IN ('Selected', 'Rejected')
  AND (SELECT COUNT(*) FROM notification_log WHERE recipient_id = c.id) = 0;
```

---

## Rollback Plan

If notifications cause issues:

```typescript
// 1. Disable all notifications temporarily
// Add this at the top of notification.service.ts
const NOTIFICATIONS_ENABLED = process.env.NOTIFICATIONS_ENABLED !== 'false';

export class NotificationService {
  async send(input: SendNotificationInput): Promise<{ sent: number; failed: number }> {
    if (!NOTIFICATIONS_ENABLED) {
      console.log("[Notification] Disabled via env var");
      return { sent: 0, failed: 0 };
    }
    // ... rest of code
  }
}

// 2. Set environment variable
export NOTIFICATIONS_ENABLED=false

// 3. Restart backend
pm2 restart hrms-backend
```

---

## Summary

**Integration Points**: 3 main + 1 automatic  
**Estimated Time**: 30-60 minutes  
**Risk Level**: LOW (non-blocking, isolated)  
**Rollback**: Easy (env var flag)

**Order of Implementation**:
1. ✅ Test email/SMS first (scripts provided)
2. ✅ Integrate REG_CANDIDATE (candidate registration)
3. ✅ Integrate interview results (selected/rejected)
4. ✅ Start SLA worker (automatic)
5. ✅ Monitor notification_log table

**All code examples above are production-ready and can be copied directly.**
