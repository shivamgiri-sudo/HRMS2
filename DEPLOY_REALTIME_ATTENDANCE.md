# Deploy Real-Time NCOSEC Attendance - Server Instructions

## Server Details
- **IP**: 192.168.11.225
- **User**: masadmin
- **Path**: /home/masadmin/HRMS1/backend

## Deployment Steps

### 1. Connect to Server
```bash
ssh masadmin@192.168.11.225
# Password: Support#123
```

### 2. Navigate to Backend
```bash
cd /home/masadmin/HRMS1/backend
```

### 3. Pull Latest Changes
```bash
git status
git pull origin main
```

### 4. Run SQL Migration
```bash
# Check if migration file exists
ls -la sql/260_employee_external_mappings.sql

# Run migration
mysql -u root -p mas_hrms < sql/260_employee_external_mappings.sql

# When prompted, enter MySQL password
```

### 5. Verify Migration
```bash
mysql -u root -p mas_hrms -e "
SELECT COUNT(*) as total_mappings 
FROM employee_external_mapping 
WHERE system_name = 'ncosec';
"

# Should show 1500+ mappings
```

### 6. Check PM2 Status
```bash
pm2 list

# Look for hrms-backend or similar process
```

### 7. Restart Backend
```bash
pm2 restart hrms-backend

# OR if not using PM2:
pm2 start ecosystem.config.js

# Wait 10 seconds for startup
sleep 10
```

### 8. Check Logs
```bash
pm2 logs hrms-backend --lines 50 | grep -E "(ncosec|realtime|cosec)"

# Look for:
# [cosec-sync] automatic schedule active
# No errors about missing tables or modules
```

### 9. Test Real-Time Endpoint

Create test script:
```bash
cat > test-realtime.sh << 'TESTEOF'
#!/bin/bash

# Get backend port (check .env or PM2 config)
PORT=5056

echo "Testing real-time attendance endpoint..."

# Test with curl (should get 401 without auth)
curl -s http://localhost:$PORT/api/wfm/attendance/today-live | head -5

echo ""
echo "If you see 'No authentication token' or 401, endpoint exists!"
echo "If you see 'Route not found', there's an issue."
TESTEOF

chmod +x test-realtime.sh
./test-realtime.sh
```

### 10. Full Integration Test (With Auth)

```bash
cat > test-with-login.sh << 'TESTEOF'
#!/bin/bash

PORT=5056

# Login (use actual admin credentials)
echo "Logging in..."
TOKEN=$(curl -s -X POST http://localhost:$PORT/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@mascallnet.com","password":"YOUR_ADMIN_PASSWORD"}' \
  | jq -r '.accessToken')

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "Login failed! Check credentials in .env"
  exit 1
fi

echo "✓ Login successful"
echo ""

# Test today-live endpoint
echo "Testing /api/wfm/attendance/today-live..."
RESPONSE=$(curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:$PORT/api/wfm/attendance/today-live)

echo "$RESPONSE" | jq '.'

# Check source
SOURCE=$(echo "$RESPONSE" | jq -r '.data.source // empty')

if [ "$SOURCE" = "ncosec_realtime" ]; then
  echo ""
  echo "✓✓✓ SUCCESS: Real-time NCOSEC data working!"
elif [ "$SOURCE" = "biometric_synced" ]; then
  echo ""
  echo "⚠ Using fallback synced data (NCOSEC may be unavailable)"
else
  echo ""
  echo "ℹ No attendance data or error"
fi
TESTEOF

chmod +x test-with-login.sh

# Edit the script to add actual admin password
nano test-with-login.sh
# Change YOUR_ADMIN_PASSWORD to actual password

# Run test
./test-with-login.sh
```

## Verification Checklist

- [ ] SQL migration ran successfully (1500+ mappings created)
- [ ] Backend restarted without errors
- [ ] PM2 logs show `[cosec-sync] automatic schedule active`
- [ ] `/api/wfm/attendance/today-live` endpoint exists (returns 401 without auth)
- [ ] With valid JWT token, endpoint returns data with `source` field
- [ ] Frontend attendance page shows real-time punches (check browser DevTools)

## Troubleshooting

### Issue: "Cannot find module attendance-realtime-ncosec.service"
**Solution**: Files not on server yet. Run `git pull` to get latest code.

### Issue: "Table employee_external_mapping doesn't exist"
**Solution**: SQL migration didn't run. Execute step 4 again.

### Issue: "NCOSEC connection failed"
**Solution**: Check `.env` has correct NCOSEC credentials:
```bash
grep NCOSEC_ .env

# Should show:
# NCOSEC_DB_HOST=172.10.10.146
# NCOSEC_DB_PORT=1433
# NCOSEC_DB_NAME=NCOSEC
# etc.
```

### Issue: Always returns "biometric_synced", never "ncosec_realtime"
**Solution**: Check NCOSEC connectivity:
```bash
# From server, test NCOSEC connection
telnet 172.10.10.146 1433

# Should connect (Ctrl+C to exit)
# If connection refused, firewall or NCOSEC server issue
```

### Issue: "No employee record" or 403 error
**Solution**: Test user doesn't have employee record. Try with actual employee account.

## Rollback (If Needed)

If issues occur:
```bash
# Revert code changes
git checkout HEAD~1 src/modules/wfm/attendance-daily-scoped.routes.ts
pm2 restart hrms-backend

# Table can stay (doesn't break anything)
# OR drop it:
# mysql -u root -p mas_hrms -e "DROP TABLE IF EXISTS employee_external_mapping;"
```

## Files Changed on Server

After `git pull`, these files should be new/modified:

**New**:
- `src/modules/wfm/attendance-realtime-ncosec.service.ts`
- `sql/260_employee_external_mappings.sql`
- `docs/REALTIME_ATTENDANCE_DIRECT_NCOSEC.md`

**Modified**:
- `src/modules/wfm/attendance-daily-scoped.routes.ts`

Verify:
```bash
git status
git log -1 --stat

# Should show the files above
```

---

**Next Steps After Deployment**:
1. Test with employee account on frontend
2. Monitor PM2 logs for any errors
3. Check attendance page shows real-time updates (60s polling interval)
4. Verify `source` badge shows "ncosec_realtime" vs "biometric_synced"
