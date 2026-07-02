# Notification System - Deployment Checklist

**Repository**: https://github.com/shivamgiri-sudo/HRMS1.git  
**Date**: 2026-06-11  
**Status**: READY TO DEPLOY

---

## Pre-Deployment Checklist

### ✅ Step 1: Verify Files (2 minutes)

```bash
# Check all notification files exist
ls -la backend/sql/132_email_sms_notification_system.sql
ls -la backend/src/services/notification.service.ts
ls -la backend/src/services/ats-notification.helper.ts
ls -la backend/src/workers/sla-breach-worker.ts
ls -la backend/scripts/test-email.ts
ls -la backend/scripts/test-sms.ts
ls -la backend/scripts/monitoring-queries.sql
ls -la docs/EMAIL_SMS_NOTIFICATION_INTEGRATION.md
ls -la docs/NOTIFICATION_INTEGRATION_EXAMPLE.md
ls -la docs/NOTIFICATION_DEPLOYMENT_CHECKLIST.md

# All files should exist
```

### ✅ Step 2: Verify Dependencies (1 minute)

```bash
cd backend
npm list nodemailer twilio handlebars

# Expected output:
# nodemailer@8.0.7
# twilio@6.0.2
# handlebars@4.7.9
```

---

## Deployment Steps

### ✅ Step 3: Run SQL Migration (3 minutes)

```bash
# Option A: From MySQL client
mysql -h 122.184.128.90 -u shuvam -p'MCN@1234$' mas_hrms < backend/sql/132_email_sms_notification_system.sql

# Option B: From MySQL console
mysql -h 122.184.128.90 -u shuvam -p'MCN@1234$' mas_hrms
source backend/sql/132_email_sms_notification_system.sql;
```

**Verify Tables Created**:
```sql
USE mas_hrms;
SHOW TABLES LIKE '%notification%';
SHOW TABLES LIKE '%_config';

-- Expected output:
-- notification_log
-- notification_template
-- smtp_config
-- sms_config
```

**Verify Templates Seeded**:
```sql
SELECT template_code, template_name, active_status 
FROM notification_template 
WHERE active_status = 1;

-- Expected: 6 rows (REG_CANDIDATE, REG_RECRUITER, STAGE_SELECTED, STAGE_REJECTED, FINAL_SELECTED, SLA_BREACH)
```

---

### ✅ Step 4: Configure SMTP (Gmail) (5 minutes)

**4.1. Get Gmail App Password**:
1. Go to: https://myaccount.google.com/security
2. Enable 2-Step Verification (if not already)
3. Go to: https://myaccount.google.com/apppasswords
4. Create app password:
   - App: Mail
   - Device: Other (Custom) → "HRMS Notifications"
5. Copy 16-character password (example: `abcd efgh ijkl mnop`)

**4.2. Insert SMTP Config**:
```sql
INSERT INTO smtp_config (
  config_key, 
  smtp_host, 
  smtp_port, 
  smtp_secure, 
  smtp_user, 
  smtp_pass, 
  from_email, 
  from_name, 
  active_status
)
VALUES (
  'default',
  'smtp.gmail.com',
  587,
  0,  -- 0=TLS (port 587), 1=SSL (port 465)
  'your-email@gmail.com',  -- ← REPLACE
  'abcd efgh ijkl mnop',    -- ← REPLACE with App Password
  'noreply@mascallnet.com', -- ← REPLACE if you have custom domain
  'MAS Callnet HRMS',
  1
);
```

**4.3. Verify Config**:
```sql
SELECT * FROM smtp_config WHERE active_status = 1;
```

---

### ✅ Step 5: Configure Twilio SMS (Optional) (5 minutes)

**5.1. Get Twilio Credentials** (skip if not using SMS):
1. Go to: https://www.twilio.com/console
2. Copy **Account SID** (starts with `AC...`)
3. Copy **Auth Token**
4. Copy **Phone Number** (e.g., `+12345678900`)

**5.2. Insert SMS Config**:
```sql
INSERT INTO sms_config (
  config_key,
  provider,
  account_sid,
  auth_token,
  from_number,
  active_status
)
VALUES (
  'default',
  'twilio',
  'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',  -- ← REPLACE
  'your-auth-token-here',                 -- ← REPLACE
  '+12345678900',                          -- ← REPLACE
  1
);
```

**5.3. Verify Config**:
```sql
SELECT * FROM sms_config WHERE active_status = 1;
```

---

### ✅ Step 6: Test Email (2 minutes)

```bash
cd backend

# Set your test email
export TEST_EMAIL="your-email@example.com"

# Run test
tsx scripts/test-email.ts
```

**Expected Output**:
```
=== Email Notification Test ===

Sending test email to: your-email@example.com
Template: REG_CANDIDATE

✅ Result: sent=1, failed=0

✅ SUCCESS! Check your email inbox.
   (If using Gmail, check spam folder too)
```

**If Failed**:
- Check SMTP config in database
- Verify Gmail App Password is correct
- Check `notification_log` table for error_message
- Try with different email address

---

### ✅ Step 7: Test SMS (Optional) (2 minutes)

```bash
# Set your test mobile (with country code)
export TEST_MOBILE="+919999999999"

# Run test
tsx scripts/test-sms.ts
```

**Expected Output**:
```
=== SMS Notification Test ===

Sending test SMS to: +919999999999
Template: REG_CANDIDATE (SMS version)

✅ Result: sent=1, failed=0

✅ SUCCESS! Check your mobile for SMS.
   (Delivery may take 1-2 minutes)
```

---

### ✅ Step 8: Test All Templates (3 minutes)

```bash
export TEST_EMAIL="your-email@example.com"
tsx scripts/test-all-templates.ts
```

**Expected Output**:
```
=== Testing All Email Templates ===
Recipient: your-email@example.com

📧 Testing REG_CANDIDATE...
   ✅ Sent successfully
📧 Testing REG_RECRUITER...
   ✅ Sent successfully
📧 Testing STAGE_SELECTED...
   ✅ Sent successfully
📧 Testing STAGE_REJECTED...
   ✅ Sent successfully
📧 Testing FINAL_SELECTED...
   ✅ Sent successfully
📧 Testing SLA_BREACH...
   ✅ Sent successfully

=== Test Summary ===
✅ Passed: 6/6
❌ Failed: 0/6

🎉 ALL TESTS PASSED! Notification system is working perfectly.
```

---

### ✅ Step 9: Start SLA Breach Worker (3 minutes)

**Option A: PM2 (Production - Recommended)**:
```bash
cd backend

# Start worker
pm2 start src/workers/sla-breach-worker.ts \
  --name sla-breach-worker \
  --interpreter tsx

# Save process list
pm2 save

# Set to auto-start on reboot
pm2 startup

# Check status
pm2 status
pm2 logs sla-breach-worker --lines 20
```

**Option B: Standalone (Development)**:
```bash
cd backend
tsx src/workers/sla-breach-worker.ts

# Press Ctrl+C to stop
```

**Option C: Docker Compose**:
```yaml
# Add to docker-compose.yml
services:
  sla-worker:
    build: ./backend
    command: tsx src/workers/sla-breach-worker.ts
    environment:
      - DATABASE_URL=mysql://...
    restart: always
```

**Verify Worker Running**:
```bash
pm2 list | grep sla-breach

# Or check logs
pm2 logs sla-breach-worker --lines 50
```

**Expected Log Output**:
```
[SLABreachWorker] Starting...
[SLABreachWorker] SLA threshold: 30 minutes
[SLABreachWorker] Check interval: 300 seconds
[SLABreachWorker] Checking for SLA breaches...
[SLABreachWorker] No SLA breaches found
```

---

### ✅ Step 10: Verify Notification Logs (2 minutes)

```sql
-- Check last 10 notifications
SELECT 
  id,
  template_code,
  recipient_email,
  channel,
  status,
  sent_at,
  created_at
FROM notification_log
ORDER BY created_at DESC
LIMIT 10;

-- Check success rate
SELECT
  template_code,
  COUNT(*) as total,
  SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
  ROUND(100.0 * SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM notification_log
GROUP BY template_code;
```

---

## Post-Deployment Verification

### ✅ Step 11: Integration Test (End-to-End) (10 minutes)

**11.1. Test Candidate Registration** (if integrated):
```bash
# Create test candidate via API
curl -X POST http://localhost:3000/api/ats-full-parity/intake \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Integration Test",
    "email": "test@example.com",
    "mobile": "+919999999999",
    "applied_for_process": "GPI",
    "applied_for_branch": "Mumbai"
  }'

# Check notification was sent
mysql> SELECT * FROM notification_log 
       WHERE recipient_email = 'test@example.com' 
       ORDER BY created_at DESC LIMIT 1;
```

**11.2. Test SLA Worker**:
```sql
-- Manually create a candidate waiting > 30 mins (for testing)
INSERT INTO ats_candidate (
  id, full_name, mobile, email, 
  status, recruiter_assigned_name,
  applied_for_branch, applied_for_process,
  created_date, created_time
) VALUES (
  UUID(), 
  'SLA Test Candidate', 
  '+919999999999', 
  'sla-test@example.com',
  'Waiting',
  'Test Recruiter',
  'Mumbai',
  'GPI',
  CURDATE(),
  DATE_SUB(NOW(), INTERVAL 45 MINUTE)  -- 45 minutes ago
);

-- Wait 5 minutes for worker to run, then check
SELECT * FROM notification_log 
WHERE template_code = 'SLA_BREACH' 
ORDER BY created_at DESC LIMIT 1;
```

---

### ✅ Step 12: Set Up Monitoring (5 minutes)

**12.1. Create Monitoring Dashboard User** (optional):
```sql
-- Create read-only user for monitoring dashboard
CREATE USER 'hrms_monitor'@'%' IDENTIFIED BY 'secure_password_here';
GRANT SELECT ON mas_hrms.notification_log TO 'hrms_monitor'@'%';
GRANT SELECT ON mas_hrms.notification_template TO 'hrms_monitor'@'%';
GRANT SELECT ON mas_hrms.smtp_config TO 'hrms_monitor'@'%';
GRANT SELECT ON mas_hrms.sms_config TO 'hrms_monitor'@'%';
FLUSH PRIVILEGES;
```

**12.2. Set Up Alerts** (optional):
```bash
# Create cron job to check for high failure rate
crontab -e

# Add line:
*/15 * * * * /usr/bin/mysql -h 122.184.128.90 -u shuvam -p'MCN@1234$' mas_hrms -e "SELECT COUNT(*) as failed FROM notification_log WHERE status='failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)" | awk 'NR==2 {if ($1 > 10) print "HIGH FAILURE RATE: " $1 " failed notifications in last hour"}' | mail -s "HRMS Notification Alert" admin@example.com
```

**12.3. Save Monitoring Queries**:
```bash
# Run monitoring queries from file
mysql -h 122.184.128.90 -u shuvam -p'MCN@1234$' mas_hrms < backend/scripts/monitoring-queries.sql
```

---

## Rollback Plan

### If Something Goes Wrong

**1. Disable Notifications Immediately**:
```sql
-- Disable all templates
UPDATE notification_template SET active_status = 0;

-- Or disable SMTP/SMS
UPDATE smtp_config SET active_status = 0;
UPDATE sms_config SET active_status = 0;
```

**2. Stop SLA Worker**:
```bash
pm2 stop sla-breach-worker
# Or
pm2 delete sla-breach-worker
```

**3. Rollback Code** (if integrated into recruiter workflow):
```bash
# Comment out notification calls
# OR
# Set environment variable
export NOTIFICATIONS_ENABLED=false
pm2 restart hrms-backend
```

**4. Investigate Issues**:
```sql
-- Check failed notifications
SELECT * FROM notification_log 
WHERE status = 'failed' 
ORDER BY created_at DESC 
LIMIT 20;

-- Check error patterns
SELECT 
  error_message, 
  COUNT(*) as count 
FROM notification_log 
WHERE status = 'failed' 
GROUP BY error_message 
ORDER BY count DESC;
```

---

## Production Optimization

### Performance Tuning

**1. Add Database Indexes** (if not auto-created):
```sql
CREATE INDEX idx_notification_created ON notification_log(created_at);
CREATE INDEX idx_notification_template_status ON notification_log(template_code, status);
CREATE INDEX idx_notification_recipient ON notification_log(recipient_id);
CREATE INDEX idx_notification_email ON notification_log(recipient_email);
```

**2. Set Up Log Archival** (run monthly):
```sql
-- Create archive table
CREATE TABLE notification_log_archive LIKE notification_log;

-- Move old logs (90+ days)
INSERT INTO notification_log_archive
SELECT * FROM notification_log
WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- Delete from main table (keep failed logs longer)
DELETE FROM notification_log
WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND status != 'failed';
```

**3. Increase Worker Frequency** (if needed):
```typescript
// Edit backend/src/workers/sla-breach-worker.ts
const CHECK_INTERVAL_MS = 3 * 60 * 1000; // Check every 3 minutes instead of 5

// Restart worker
pm2 restart sla-breach-worker
```

---

## Maintenance Schedule

### Daily
- ✅ Check notification success rate (monitoring query #2)
- ✅ Review failed notifications (monitoring query #3)

### Weekly
- ✅ Review SLA breach frequency (monitoring query #4)
- ✅ Check for missing notifications (monitoring query #8)
- ✅ Verify worker is running (pm2 status)

### Monthly
- ✅ Run log archival script
- ✅ Review template performance (monitoring query #1)
- ✅ Update templates if needed
- ✅ Rotate Twilio auth token (security)

### Quarterly
- ✅ Review and update email/SMS templates
- ✅ Analyze error patterns and fix root causes
- ✅ Optimize worker frequency based on usage

---

## Success Criteria

### ✅ Deployment is Successful When:

1. **Configuration**:
   - [ ] All 4 tables created (notification_template, notification_log, smtp_config, sms_config)
   - [ ] 6 templates seeded and active
   - [ ] SMTP config inserted and active
   - [ ] SMS config inserted (if using SMS)

2. **Testing**:
   - [ ] test-email.ts passes (sent=1, failed=0)
   - [ ] test-sms.ts passes (if using SMS)
   - [ ] test-all-templates.ts passes (6/6 sent)
   - [ ] notification_log table shows sent status

3. **Worker**:
   - [ ] SLA worker is running (pm2 status shows "online")
   - [ ] Worker logs show periodic checks (every 5 mins)
   - [ ] No error logs from worker

4. **Integration** (if completed):
   - [ ] REG_CANDIDATE sent on candidate registration
   - [ ] Interview result notifications working
   - [ ] SLA alerts triggered for waiting candidates

5. **Monitoring**:
   - [ ] Can query notification_log successfully
   - [ ] Success rate > 95%
   - [ ] No stuck "pending" notifications
   - [ ] Failed notifications have error_message

---

## Estimated Timeline

| Task | Time | Cumulative |
|------|------|------------|
| 1. Verify files | 2 min | 2 min |
| 2. Verify dependencies | 1 min | 3 min |
| 3. Run SQL migration | 3 min | 6 min |
| 4. Configure SMTP | 5 min | 11 min |
| 5. Configure Twilio (optional) | 5 min | 16 min |
| 6. Test email | 2 min | 18 min |
| 7. Test SMS (optional) | 2 min | 20 min |
| 8. Test all templates | 3 min | 23 min |
| 9. Start SLA worker | 3 min | 26 min |
| 10. Verify logs | 2 min | 28 min |
| 11. Integration test | 10 min | 38 min |
| 12. Set up monitoring | 5 min | 43 min |

**Total**: ~45 minutes (without SMS) or ~50 minutes (with SMS)

---

## Support & Troubleshooting

### Common Issues

**Issue**: "Authentication failed" email error  
**Solution**: Verify Gmail App Password, check smtp_user matches

**Issue**: SMS not sending  
**Solution**: Check Twilio account is active, verify from_number format (+country code)

**Issue**: Worker not running  
**Solution**: Check pm2 logs, verify database connection

**Issue**: High failure rate  
**Solution**: Run monitoring query #10 for error pattern analysis

### Getting Help

1. Check logs: `pm2 logs sla-breach-worker`
2. Check database: monitoring-queries.sql
3. Review docs: EMAIL_SMS_NOTIFICATION_INTEGRATION.md
4. Test scripts: backend/scripts/test-*.ts

---

## ✅ Final Checklist

Before marking deployment as complete:

- [ ] SQL migration executed successfully
- [ ] SMTP config verified (email test passed)
- [ ] SMS config verified (optional, SMS test passed)
- [ ] All 6 templates tested
- [ ] SLA worker running via PM2
- [ ] notification_log shows successful deliveries
- [ ] Monitoring queries work
- [ ] Rollback plan documented and understood
- [ ] Team trained on monitoring dashboard
- [ ] Scheduled maintenance tasks in calendar

---

**Deployment Date**: __________  
**Deployed By**: __________  
**Verified By**: __________  
**Status**: ✅ COMPLETE

---

**End of Deployment Checklist**  
**Next**: Monitor for 24 hours, then integrate into recruiter workflow
