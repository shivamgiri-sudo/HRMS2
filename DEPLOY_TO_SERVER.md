# Deploy Phase 1 AI to Production Server

**Server:** 192.168.11.225  
**Username:** masadmin  
**Password:** Support#123  
**Date:** 2026-07-10

---

## Quick Deployment Steps

### Option 1: Automated Deployment (Recommended)

```bash
# From your local machine (Git Bash or WSL)
chmod +x DEPLOY_PHASE1_AI.sh
./DEPLOY_PHASE1_AI.sh
```

### Option 2: Manual Deployment

#### Step 1: Connect to Server

```bash
ssh masadmin@192.168.11.225
# Password: Support#123
```

#### Step 2: Backup Current Code

```bash
cd /home/masadmin/HRMS2/backend
tar -czf backup-backend-$(date +%Y%m%d-%H%M%S).tar.gz src/ sql/ package.json
```

#### Step 3: Upload Backend AI Module

From your **local machine**, open a new terminal:

```bash
cd C:/Users/ADMIN/Desktop/HRMS2-latest

# Upload AI module
scp -r backend/src/modules/ai masadmin@192.168.11.225:/home/masadmin/HRMS2/backend/src/modules/

# Upload SQL migration
scp backend/sql/500_ai_provider_foundation.sql masadmin@192.168.11.225:/home/masadmin/HRMS2/backend/sql/

# Upload updated package.json
scp backend/package.json masadmin@192.168.11.225:/home/masadmin/HRMS2/backend/
```

#### Step 4: Install Dependencies on Server

Back in the SSH session:

```bash
cd /home/masadmin/HRMS2/backend
npm install @google/generative-ai
```

#### Step 5: Add Environment Variables

```bash
nano .env
```

Add these lines at the end:

```env
# AI Provider Configuration (Phase 1)
GEMINI_API_KEY=your-gemini-api-key-here
GEMINI_DEFAULT_MODEL=gemini-flash
GEMINI_BASE_URL=https://generativelanguage.googleapis.com
AI_ENCRYPTION_KEY=peopleos-ai-production-encryption-key-secure-random-32-chars
AI_ENABLE_EXTERNAL_PROVIDERS=true
AI_DEFAULT_PROVIDER=rule-based
AI_MAX_TOKENS_PER_REQUEST=2000
```

Save and exit (Ctrl+X, Y, Enter)

#### Step 6: Build Backend

```bash
npm run build
```

#### Step 7: Restart Backend

```bash
pm2 restart mcn-hrms-backend
# Or if not using PM2:
# npm run start
```

#### Step 8: Verify Migration

Check if migration ran successfully:

```bash
pm2 logs mcn-hrms-backend --lines 100 | grep "Migration 500"
```

You should see: "Migration 500: AI Provider Foundation - Complete"

Or check database directly:

```bash
mysql -u your_user -p mas_hrms -e "SHOW TABLES LIKE 'ai_%';"
```

Should show 4 tables:
- ai_provider_config
- ai_provider_usage_log
- ai_prompt_audit_log
- ai_feedback

#### Step 9: Upload Frontend Files

From your **local machine**:

```bash
cd C:/Users/ADMIN/Desktop/HRMS2-latest

# Upload new pages
scp src/pages/AIProviderSettings.tsx masadmin@192.168.11.225:/home/masadmin/HRMS2/src/pages/
scp src/pages/PeopleOSCopilot.tsx masadmin@192.168.11.225:/home/masadmin/HRMS2/src/pages/

# Upload updated App.tsx
scp src/App.tsx masadmin@192.168.11.225:/home/masadmin/HRMS2/src/
```

#### Step 10: Build Frontend on Server

Back in SSH:

```bash
cd /home/masadmin/HRMS2
npm run build
```

#### Step 11: Restart Frontend (if using PM2/nginx)

```bash
# If using PM2 for frontend
pm2 restart hrms-frontend

# If using nginx, reload config
sudo nginx -t && sudo nginx -s reload
```

---

## Verification Steps

### 1. Test Backend API

```bash
# On the server
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:5055/api/ai/providers/active
```

Expected response:
```json
{
  "success": true,
  "data": {
    "providerKey": "rule-based",
    "providerName": "Rule-Based Provider (No External AI)"
  }
}
```

### 2. Test Frontend Pages

Open browser and navigate to:

**Super Admin Settings:**
- URL: `https://your-domain.com/settings/ai-providers`
- Access: super_admin only
- Should show provider list with rule-based active

**PeopleOS Copilot:**
- URL: `https://your-domain.com/peopleos/copilot`
- Access: All authenticated users
- Should show chat interface with suggested prompts

### 3. Test Gemini Provider

1. Go to `/settings/ai-providers` as super admin
2. Configure Gemini:
   - Enable: ON
   - Set as Default: ON
   - Test Connection
3. Expected: Test succeeds with latency displayed

### 4. Test AI Chat

1. Go to `/peopleos/copilot`
2. Ask: "What are my top risks today?"
3. Expected: Response from AI (Gemini or rule-based)

### 5. Check Logs

```bash
pm2 logs mcn-hrms-backend --lines 50
```

Look for:
- "Migration 500: AI Provider Foundation - Complete"
- "[AI Registry] Registered provider: ..."
- No errors related to AI module

---

## Rollback Procedure (If Issues Occur)

### Backend Rollback

```bash
cd /home/masadmin/HRMS2/backend

# Find your backup
ls -lh backup-backend-*.tar.gz

# Restore (replace with actual filename)
tar -xzf backup-backend-YYYYMMDD-HHMMSS.tar.gz

# Reinstall old dependencies
npm install

# Rebuild
npm run build

# Restart
pm2 restart mcn-hrms-backend
```

### Database Rollback

```bash
mysql -u your_user -p mas_hrms << EOF
DROP TABLE IF EXISTS ai_feedback;
DROP TABLE IF EXISTS ai_prompt_audit_log;
DROP TABLE IF EXISTS ai_provider_usage_log;
DROP TABLE IF EXISTS ai_provider_config;
EOF
```

### Frontend Rollback

```bash
cd /home/masadmin/HRMS2

# Restore from git
git checkout src/App.tsx
git clean -fd src/pages/AIProviderSettings.tsx src/pages/PeopleOSCopilot.tsx

# Rebuild
npm run build
```

---

## Troubleshooting

### Issue: "AI_ENCRYPTION_KEY not set" warning

**Solution:** Verify `.env` file has `AI_ENCRYPTION_KEY` set

### Issue: Gemini test connection fails

**Solution:** 
1. Check `GEMINI_API_KEY` in `.env`
2. Verify server has internet access
3. Test with: `curl https://generativelanguage.googleapis.com`

### Issue: 401 Unauthorized on `/api/ai/ask`

**Solution:** Check JWT token is valid and user is authenticated

### Issue: Tables not created

**Solution:** 
1. Check migration file exists: `ls sql/500_ai_provider_foundation.sql`
2. Run manually: `mysql -u user -p mas_hrms < sql/500_ai_provider_foundation.sql`
3. Check server logs for migration errors

### Issue: Frontend pages 404

**Solution:**
1. Verify files uploaded: `ls src/pages/AI*.tsx`
2. Verify App.tsx routes added
3. Clear browser cache
4. Check nginx config if using reverse proxy

---

## Post-Deployment Checklist

- [ ] Backend migration completed (4 tables created)
- [ ] Rule-based provider seeded in database
- [ ] Backend API `/api/ai/providers/active` returns rule-based
- [ ] Super Admin can access `/settings/ai-providers`
- [ ] Gemini test connection succeeds
- [ ] All users can access `/peopleos/copilot`
- [ ] AI responses working (try asking a question)
- [ ] Usage logs populating in database
- [ ] No errors in PM2 logs
- [ ] Frontend build successful
- [ ] No 404s or console errors in browser

---

## Support

If deployment issues occur:

1. Check backend logs: `pm2 logs mcn-hrms-backend`
2. Check database: `mysql -u user -p mas_hrms -e "SELECT * FROM ai_provider_config;"`
3. Check environment: `cat backend/.env | grep -i gemini`
4. Refer to: `PHASE1_AI_IMPLEMENTATION_COMPLETE.md`

**Deployment script created:** 2026-07-10  
**Phase:** PeopleOS AI Enhancement Phase 1  
**Status:** Ready for Production
