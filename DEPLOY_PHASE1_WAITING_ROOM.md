# Phase 1 Deployment: Recruiter Name Display for Waiting Room

**Date:** 2026-07-14  
**Commit:** 01669cef - "Add recruiter name display to ATS waiting room display"  
**Environment:** Production (https://mcnhrms.teammas.in)

---

## ✅ Pre-Deployment Checklist

- [x] Code committed to Git
- [x] Pushed to GitHub repository
- [x] Frontend production build completed
- [x] Backend changes are backward-compatible (no migration needed)
- [x] Local testing completed successfully
- [ ] Backend deployment
- [ ] Frontend deployment
- [ ] Production verification

---

## Deployment Package

**Location:** `dist-phase1-deploy.tar.gz` (4.2 MB)  
**Contains:** Production-optimized frontend build with Phase 1 changes

---

## Backend Deployment Steps

### 1. Connect to Production Server
```bash
ssh masadmin@115.241.59.220
# Password: Support#123
```

### 2. Navigate to Backend Directory
```bash
cd /var/www/HRMS2/backend
```

### 3. Pull Latest Code
```bash
git pull origin main
```

### 4. Build and Restart Backend Service
```bash
npm run build
# Wait for build to complete (takes ~2 min)
pm2 restart hrms2-backend --update-env
# If process not found:
# pm2 delete hrms2-backend && pm2 start /var/www/HRMS2/backend/dist/src/server.js --name hrms2-backend
pm2 logs hrms2-backend --lines 50
```

### 5. Verify Backend is Running
```bash
pm2 status
curl http://localhost:5055/api/ats/queue/branches
```

**Expected Response:**
```json
{"success":true,"data":["AHMEDABAD-JALDARSHAN","NOIDA","NOIDA-2"]}
```

---

## Frontend Deployment Steps

### Option A: Using Deployment Package (Recommended)

#### 1. Upload Deployment Package
From your local machine:
```bash
scp dist-phase1-deploy.tar.gz masadmin@115.241.59.220:/tmp/
```

#### 2. Extract to Frontend Directory
On production server:
```bash
cd /var/www/HRMS2
# Backup current dist
sudo cp -r dist dist-backup-$(date +%Y%m%d-%H%M%S)
# Deploy new build
sudo rm -rf dist/*
sudo tar -xzf /tmp/dist-phase1-deploy.tar.gz -C dist/
sudo chown -R www-data:www-data dist/
rm /tmp/dist-phase1-deploy.tar.gz
```

#### 3. Reload Nginx
```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Option B: Build on Server (Alternative)

#### 1. Navigate to Project Root
```bash
cd /var/www/HRMS2
git pull origin main
```

#### 2. Build Frontend
```bash
npm install
npm run build
```

#### 3. Build files are already in dist/ directory (no copy needed)
```bash
sudo chown -R www-data:www-data dist/
```

#### 4. Reload Nginx
```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## Post-Deployment Verification

### 1. Check Frontend is Accessible
```bash
curl -I https://mcnhrms.teammas.in/
```

**Expected:** HTTP 200 OK

### 2. Check Waiting Room Page
Open in browser:
```
https://mcnhrms.teammas.in/display/waiting-room?branch=NOIDA
```

**Verify:**
- ✅ Page loads without errors
- ✅ Branch dropdown appears (if no ?branch= parameter)
- ✅ Queue data displays correctly
- ✅ Recruiter names are visible in queue rows
- ✅ "Currently in Interview" shows recruiter on right side
- ✅ Token numbers, candidate names, and recruiter names all display
- ✅ Header elements (logo, company name, clock) are larger
- ✅ Real-time updates work (SSE connection)

### 3. Check Backend API
```bash
curl https://mcnhrms.teammas.in/api/ats/queue/public-display?branch=NOIDA | jq
```

**Verify JSON includes:**
```json
{
  "queue": [
    {
      "token_number": "...",
      "candidate_name": "...",
      "recruiter_name": "...",
      ...
    }
  ]
}
```

### 4. Test Audio Announcements
- Wait for a candidate to be called
- Verify audio announcement includes recruiter name
- Format: "Token 123, [Candidate Name], please meet [Recruiter Name] for your [Role] interview"

### 5. Browser Console Check
- Open browser DevTools (F12)
- Check Console tab for errors
- Verify no 404 errors for assets
- Confirm SSE connection established

---

## Changes Deployed

### Backend (`backend/src/modules/ats/queue.routes.ts`)
- Added `recruiter_name` field to `PublicQueueEntry` interface
- Modified `mapPublicQueueEntry()` to include recruiter name (defaults to 'Unassigned')

### Frontend (`src/pages/WaitingRoomDisplay.tsx`)
1. **Header Enhancements:**
   - Logo size: 44px → 56px
   - Company name: 19px → 24px
   - Tagline: 9px → 11px
   - Clock: 28px → 32px
   - Date: 10px → 12px
   - Header height: 70px → 80px

2. **Waiting Queue Layout:**
   - Added recruiter column between candidate info and wait time
   - Column structure: Position | Token/Candidate/Role | Recruiter | Wait Time
   - Recruiter font size: 14px
   - Vertical separator line between columns

3. **Currently in Interview:**
   - Recruiter name moved to right side next to "In Progress" badge
   - Reduced row width by horizontal layout
   - Token/Candidate on left, Recruiter/Badge on right

4. **Now Calling Card:**
   - Added recruiter name display with user icon
   - Shows below role information

5. **Audio Announcements:**
   - Enhanced to include recruiter name
   - Format: "Token [X], [Name], please meet [Recruiter] for your [Role] interview"

### Dev Config (`vite.config.ts`)
- Added proxy configuration for local development
- Forwards `/api` requests to `http://localhost:5055`
- **Note:** This only affects local development, not production

---

## Rollback Plan

If issues occur, revert to previous version:

### Quick Rollback
```bash
cd /var/www/HRMS2
git checkout 22d5155e  # Previous commit
npm run build
sudo chown -R www-data:www-data dist/
sudo systemctl reload nginx
```

### Backend Rollback
```bash
cd /var/www/HRMS2/backend
git checkout 22d5155e
npm run build
pm2 restart hrms2-backend --update-env
```

---

## Known Issues & Notes

### 1. Unassigned Recruiters
- When `recruiter_name` is null or 'Unassigned', waiting queue shows "Awaiting Assignment" in gray italics
- This is expected behavior for candidates not yet assigned to a recruiter

### 2. Branch Locking
- If URL contains `?branch=NOIDA`, the branch dropdown is hidden and replaced with a locked branch badge
- This is by design for kiosk displays
- To see dropdown: remove the `?branch=` parameter

### 3. Real-Time Updates
- SSE connection automatically reconnects if interrupted
- Falls back to polling if SSE fails
- 5-second update interval

### 4. Audio Announcements
- Requires user interaction to unlock audio (browser security)
- Uses Microsoft Neural voices (Neerja/Prabhat) if available
- Falls back to system default voice

---

## Production Server Details

**Server IP:** 115.241.59.220  
**Username:** masadmin  
**Password:** Support#123

**Application Paths:**
- Frontend: `/var/www/HRMS2/dist/` (served by nginx)
- Backend: `/var/www/HRMS2/backend/`
- Project Root: `/var/www/HRMS2/`

**Services:**
- Backend: PM2 process `hrms2-backend` on port 5055
- Frontend: Nginx serving static files from `dist/`
- URL: https://mcnhrms.teammas.in
- Nginx Config: `/etc/nginx/sites-enabled/mcnhrms.teammas.in`

---

## Deployment Timeline

**Start Time:** [To be filled during deployment]  
**Backend Deployed:** [Time]  
**Frontend Deployed:** [Time]  
**Verification Complete:** [Time]  
**Total Duration:** [Duration]

---

## Support Contact

If issues arise during deployment:
1. Check PM2 logs: `pm2 logs mcnhrms-backend`
2. Check Nginx error log: `sudo tail -f /var/log/nginx/error.log`
3. Verify all services running: `pm2 status && sudo systemctl status nginx`
4. Review browser console for frontend errors

---

## Sign-off

**Deployed By:** ___________________  
**Date & Time:** ___________________  
**Verified By:** ___________________  
**Status:** [ ] Success [ ] Issues Noted

**Notes:**
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________
