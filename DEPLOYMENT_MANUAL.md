# HRMS2 Production Deployment Manual
**Date:** 2026-07-09  
**Commit:** aa77a2d7  
**Server:** 192.168.11.225  
**Changes:** 6 critical bug fixes in auth, device sessions, auto-logout

---

## Summary of Changes

| Bug | File | Fix |
|-----|------|-----|
| Migration path | `backend/backend/sql/` → `backend/sql/` | Moved `371_user_device_sessions.sql` to correct location |
| Org settings routing | `org_settings.routes.ts` | Public endpoint now accessible; moved before `requireAuth` middleware |
| GET /sessions reads body | `auth.routes.ts` | Changed to read from `x-refresh-token` header or `token` query param |
| Duplicated logout logic | `AuthContext.tsx` | Now calls `signOut()` directly instead of inline cleanup |
| Indentation clarity | `auth.service.ts` | Fixed scope visibility (4-space → 8-space indent) |

---

## Deployment Steps

### 1. SSH to Server
```bash
ssh masadmin@192.168.11.225
# Password: Support#123
```

### 2. Navigate to Repository
```bash
cd /home/masadmin/hrms-repo
```

### 3. Verify Current State
```bash
git status
git log --oneline -5
```

### 4. Fetch and Checkout Fix Commit
```bash
git fetch origin main
git checkout aa77a2d7
```

Verify you're on the right commit:
```bash
git log -1 --oneline
# Should show: aa77a2d7 fix(auth): resolve 6 critical bugs in device sessions and auto-logout
```

### 5. Verify Migration File Exists
```bash
ls -la backend/sql/371_user_device_sessions.sql
# Should exist and be 1963 bytes
```

### 6. Check Migration Status in Database
```bash
mysql -h localhost -u hrms_user -p
# Password: (ask admin)

USE mas_hrms;
SHOW TABLES LIKE 'user_device_sessions';
```

If the table doesn't exist, apply the migration:
```bash
mysql -h localhost -u hrms_user -p mas_hrms < /home/masadmin/hrms-repo/backend/sql/371_user_device_sessions.sql
```

Verify migration succeeded:
```bash
DESCRIBE user_device_sessions;
# Should show 15 columns including user_device_sessions table structure
```

### 7. Deploy Backend
```bash
cd /home/masadmin/hrms-repo/backend

# Install dependencies (if needed)
npm install --production

# Build TypeScript
npm run build

# Verify build
ls -la dist/ | head -10
```

### 8. Deploy Frontend
```bash
cd /home/masadmin/hrms-repo

# Install dependencies (if needed)
npm install --production

# Build frontend
npm run build

# Verify build
ls -la dist/ | head -10
```

### 9. Restart Services (Using PM2)
```bash
# List current processes
pm2 list

# Restart backend and frontend
pm2 restart hrms-backend hrms-frontend --update-env

# Wait 5 seconds for services to start
sleep 5

# Check status
pm2 status

# View logs (last 30 lines)
pm2 logs hrms-backend --lines 30
pm2 logs hrms-frontend --lines 30
```

### 10. Alternative: Manual Service Restart (If Not Using PM2)
```bash
# Stop services
sudo systemctl stop hrms-backend hrms-frontend

# Wait
sleep 3

# Start services
sudo systemctl start hrms-backend hrms-frontend

# Check status
sudo systemctl status hrms-backend hrms-frontend
```

### 11. Verify Deployment

#### Test Backend Health
```bash
curl -s http://localhost:3001/api/health | jq
# Should return success response
```

#### Test Auto-Logout Setting Endpoint (Now Public)
```bash
curl -s http://localhost:3001/api/org/settings/public/auto-logout-minutes | jq
# Should return: { "success": true, "minutes": 0 }
# (Will be 0 if not configured; should NOT return 401)
```

#### Test Sessions Endpoint (Uses header/query, not body)
```bash
# First, get a valid token from login
TOKEN="your-access-token-here"
REFRESH_TOKEN="your-refresh-token-here"

# Test with header (correct way)
curl -s -H "Authorization: Bearer $TOKEN" \
     -H "x-refresh-token: $REFRESH_TOKEN" \
     http://localhost:3001/api/auth/sessions | jq

# Should return active sessions with isCurrent flags
```

#### Test Frontend
```bash
curl -s http://localhost:3000 | head -20
# Should return HTML content (200 OK)
```

---

## Verification Checklist

- [ ] Backend service running (`pm2 list` shows "online")
- [ ] Frontend service running (`pm2 list` shows "online")
- [ ] Backend health check passes (HTTP 200)
- [ ] Migration table exists (`SHOW TABLES LIKE 'user_device_sessions'` returns result)
- [ ] Migration table has 15 columns (`DESCRIBE user_device_sessions`)
- [ ] Public endpoint is accessible (`/api/org/settings/public/auto-logout-minutes` returns 200, not 401)
- [ ] Sessions endpoint works with headers (returns sessions list with isCurrent flags)
- [ ] Frontend loads (HTTP 200)
- [ ] No error messages in PM2 logs

---

## Rollback Plan (If Issues Arise)

### Quick Rollback (Last Working Commit)
```bash
cd /home/masadmin/hrms-repo

# See previous commit
git log --oneline -3

# Checkout previous commit
git checkout 5a15652d  # or whatever the previous stable commit was

# Rebuild and restart
cd backend && npm run build && cd ..
npm run build

pm2 restart hrms-backend hrms-frontend --update-env
```

### Full Database Rollback (If Migration Broke Something)
```bash
# Drop the new table (CAUTION: loses any data)
mysql -h localhost -u hrms_user -p mas_hrms -e "DROP TABLE IF EXISTS user_device_sessions;"

# Verify
mysql -h localhost -u hrms_user -p mas_hrms -e "SHOW TABLES LIKE 'user_device_sessions';"
# Should return empty
```

---

## Logs Location

- Backend logs: `pm2 logs hrms-backend` or `/home/masadmin/.pm2/logs/hrms-backend-*.log`
- Frontend logs: `pm2 logs hrms-frontend` or `/home/masadmin/.pm2/logs/hrms-frontend-*.log`
- MySQL error log: `/var/log/mysql/error.log` (if issues with migration)

---

## Post-Deployment Testing

### Test Auto-Logout Configuration
1. Login to HRMS
2. Check browser console for auto-logout setting fetch:
   ```
   [AuthContext] Failed to fetch auto-logout setting: 404
   ```
   Should NOT appear anymore. Fetch should succeed silently.

3. Set auto-logout in org settings (if admin):
   ```bash
   curl -X PUT http://localhost:3001/api/org/settings/auto_logout_minutes \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"setting_value": "15"}'
   ```

4. Verify it's now returned by public endpoint:
   ```bash
   curl -s http://localhost:3001/api/org/settings/public/auto-logout-minutes | jq
   # Should now show: { "success": true, "minutes": 15 }
   ```

### Test Device Session Tracking
1. Login from different devices/browsers
2. Go to account settings → Active Sessions
3. Should see multiple sessions listed
4. Verify "Current Device" is marked correctly on each device

### Test Session Logout on Another Device
1. Login from Device A
2. Login from Device B (in single-device mode, Device A's session should be revoked)
3. Go back to Device A and try to refresh page
4. Should be logged out automatically

---

## Contact & Support

- **Production Server:** 192.168.11.225
- **SSH User:** masadmin
- **Database User:** hrms_user
- **PM2 Commands:** `pm2 [list|logs|restart|stop|start]`
- **Commit:** aa77a2d7 (view at https://github.com/shivamgiri-sudo/HRMS2/commit/aa77a2d7)

---

**Deployment completed by:** Claude Opus (Fable 5 thinking mode)  
**Date deployed:** 2026-07-09  
**Status:** [Ready for deployment]
