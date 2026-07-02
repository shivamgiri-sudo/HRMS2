# Performance Feedback System - Deployment Guide

## Overview

This guide covers the deployment of the Performance Feedback System (Parts 1 & 2) including backend API, frontend UI, database migrations, and monitoring setup.

---

## Pre-Deployment Checks

### 1. Code Review & Testing
- [ ] All 19 tasks completed (13 backend + 6 frontend)
- [ ] Unit tests passing (backend)
- [ ] Frontend component tests passing
- [ ] Integration tests verified
- [ ] Manual QA completed
- [ ] Security review completed
- [ ] Performance benchmarks met

### 2. Environment Verification
- [ ] Database connection verified (122.184.128.90:3306)
- [ ] MySQL credentials confirmed (mas_hrms database)
- [ ] Backend environment variables set
- [ ] Frontend environment variables configured
- [ ] API endpoints accessible
- [ ] CORS settings validated

### 3. Dependencies
- [ ] Backend: Node.js dependencies installed (`npm install`)
- [ ] Frontend: React dependencies installed (`npm install`)
- [ ] Database client libraries verified
- [ ] All peer dependencies resolved

### 4. Backup
- [ ] Current database backed up
- [ ] Configuration files saved
- [ ] Rollback plan documented
- [ ] Emergency contacts notified

---

## Database Migration Procedure

### Phase 1: Schema Updates

```bash
# Connect to MySQL
mysql -h 122.184.128.90 -u root -p mas_hrms

# Execute schema migrations
source backend/migrations/001_performance_feedback_tables.sql
source backend/migrations/002_performance_feedback_indexes.sql
source backend/migrations/003_performance_feedback_triggers.sql
```

### Phase 2: Verify Schema

```sql
-- Check tables created
SHOW TABLES LIKE 'performance_%';

-- Expected tables:
-- performance_feedback_forms
-- performance_feedback_submissions
-- performance_feedback_questions
-- performance_feedback_answers
-- performance_feedback_analytics
-- performance_feedback_reminders

-- Verify indexes
SHOW INDEX FROM performance_feedback_submissions;

-- Verify foreign keys
SELECT 
  TABLE_NAME, 
  COLUMN_NAME, 
  REFERENCED_TABLE_NAME, 
  REFERENCED_COLUMN_NAME
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'mas_hrms'
  AND TABLE_NAME LIKE 'performance_%'
  AND REFERENCED_TABLE_NAME IS NOT NULL;
```

### Phase 3: Seed Initial Data (Optional)

```sql
-- Insert default form templates if needed
-- Review backend/seeds/performance_feedback_seed.sql
```

---

## Backend Deployment Steps

### 1. Stop Existing Service

```bash
cd /home/shuvam/mas-callnet-hrms/backend

# Stop backend service (adjust based on deployment method)
pm2 stop hrms-backend
# OR
systemctl stop hrms-backend
```

### 2. Deploy New Code

```bash
# Pull latest changes
git pull origin main

# Install dependencies
npm install --production

# Build if needed
npm run build
```

### 3. Environment Configuration

```bash
# Verify .env file contains:
cat .env

# Required variables:
# DB_HOST=122.184.128.90
# DB_PORT=3306
# DB_USER=root
# DB_PASSWORD=<password>
# DB_NAME=mas_hrms
# PORT=3002
# NODE_ENV=production
# JWT_SECRET=<secret>
# CORS_ORIGIN=http://your-frontend-domain
```

### 4. Start Service

```bash
# Start backend
pm2 start ecosystem.config.js --env production
# OR
systemctl start hrms-backend

# Verify service is running
pm2 status
# OR
systemctl status hrms-backend

# Check logs
pm2 logs hrms-backend --lines 50
```

### 5. API Health Check

```bash
# Test health endpoint
curl http://localhost:3002/api/health

# Expected response:
# {"status":"ok","timestamp":"...","database":"connected"}

# Test performance feedback endpoint
curl http://localhost:3002/api/performance-feedback/forms

# Expected: 200 OK with JSON array
```

---

## Frontend Deployment Steps

### 1. Build Production Assets

```bash
cd /home/shuvam/mas-callnet-hrms/frontend

# Install dependencies
npm install

# Build for production
npm run build

# Output directory: dist/
```

### 2. Configure Environment

```bash
# Create/verify .env.production file
cat .env.production

# Required variables:
# VITE_API_URL=http://your-backend-domain:3002
# VITE_APP_NAME=MAS HRMS
# VITE_ENVIRONMENT=production
```

### 3. Deploy Static Assets

```bash
# Option A: Deploy to existing web server
cp -r dist/* /var/www/html/hrms/

# Option B: Deploy to CDN/S3
aws s3 sync dist/ s3://your-bucket/hrms/

# Option C: Serve with nginx
# Update nginx config to serve from dist/
sudo systemctl reload nginx
```

### 4. Nginx Configuration (if applicable)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /var/www/html/hrms;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Test nginx config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

---

## Post-Deployment Verification

### 1. Database Connectivity
```bash
# From backend server
mysql -h 122.184.128.90 -u root -p mas_hrms -e "SELECT COUNT(*) FROM performance_feedback_forms;"

# Expected: Query successful (count may be 0 initially)
```

### 2. Backend API Endpoints
```bash
# Health check
curl http://your-backend:3002/api/health

# Performance feedback endpoints
curl http://your-backend:3002/api/performance-feedback/forms
curl http://your-backend:3002/api/performance-feedback/forms/1
curl http://your-backend:3002/api/performance-feedback/submissions?employeeId=1
curl http://your-backend:3002/api/performance-feedback/analytics/1

# Expected: All return 200 OK with valid JSON
```

### 3. Frontend Accessibility
```bash
# Homepage
curl -I http://your-frontend-domain/

# Performance feedback routes
curl -I http://your-frontend-domain/performance-feedback
curl -I http://your-frontend-domain/performance-feedback/new

# Expected: 200 OK for all routes
```

### 4. End-to-End Test
- [ ] Login as employee
- [ ] Navigate to Performance Feedback
- [ ] View feedback forms list
- [ ] Open form details
- [ ] Submit feedback
- [ ] Verify submission appears in database
- [ ] Check analytics dashboard

### 5. Role-Based Access
- [ ] Employee can view/submit own feedback
- [ ] Manager can view team feedback
- [ ] HR can access all feedback
- [ ] Unauthorized users blocked

### 6. Performance Metrics
- [ ] API response time < 500ms (avg)
- [ ] Page load time < 2s
- [ ] Database query time < 100ms
- [ ] No console errors

### 7. Error Handling
- [ ] 404 pages display correctly
- [ ] 500 errors logged properly
- [ ] Validation errors show user-friendly messages
- [ ] Network failures handled gracefully

---

## Rollback Plan

### If Critical Issues Detected

#### 1. Stop New Services
```bash
# Backend
pm2 stop hrms-backend
# Frontend
sudo systemctl stop nginx
```

#### 2. Restore Previous Version
```bash
# Rollback code
git revert <deployment-commit-hash>
git push origin main

# OR restore from backup
cp -r /backup/hrms-backend-<timestamp>/* /home/shuvam/mas-callnet-hrms/backend/
```

#### 3. Rollback Database (if needed)
```bash
# Restore from backup
mysql -h 122.184.128.90 -u root -p mas_hrms < backup_<timestamp>.sql

# OR drop new tables (only if no production data)
mysql -h 122.184.128.90 -u root -p mas_hrms -e "DROP TABLE IF EXISTS performance_feedback_answers;"
mysql -h 122.184.128.90 -u root -p mas_hrms -e "DROP TABLE IF EXISTS performance_feedback_questions;"
# ... (drop all new tables in reverse dependency order)
```

#### 4. Restart Old Services
```bash
pm2 start hrms-backend
sudo systemctl start nginx
```

#### 5. Verify Rollback
```bash
# Check services running
pm2 status
systemctl status nginx

# Test endpoints
curl http://localhost:3002/api/health
curl http://your-frontend-domain/
```

---

## Monitoring Checklist

### 1. Application Monitoring
- [ ] Set up error logging (Sentry/LogRocket)
- [ ] Configure performance monitoring (New Relic/DataDog)
- [ ] Enable uptime monitoring (Pingdom/UptimeRobot)
- [ ] Set up alert notifications

### 2. Database Monitoring
- [ ] Monitor query performance
- [ ] Track slow queries (> 1s)
- [ ] Monitor connection pool usage
- [ ] Set up disk space alerts

### 3. Server Monitoring
- [ ] CPU usage < 80%
- [ ] Memory usage < 80%
- [ ] Disk usage < 90%
- [ ] Network latency monitoring

### 4. Business Metrics
- [ ] Track form submission rates
- [ ] Monitor completion times
- [ ] Measure user engagement
- [ ] Track error rates

---

## Communication Plan

### Pre-Deployment
- [ ] Notify stakeholders 48h before deployment
- [ ] Send maintenance window notification
- [ ] Update status page
- [ ] Brief support team

### During Deployment
- [ ] Post "Deployment in Progress" message
- [ ] Keep stakeholders updated (every 30min)
- [ ] Monitor support channels
- [ ] Document any issues

### Post-Deployment
- [ ] Send "Deployment Complete" notification
- [ ] Share release notes
- [ ] Update documentation links
- [ ] Schedule post-deployment review

---

## Success Criteria

### Technical Success
- [ ] All services running without errors
- [ ] All API endpoints responding correctly
- [ ] Database migrations completed successfully
- [ ] Frontend accessible from all supported browsers
- [ ] Performance benchmarks met

### Business Success
- [ ] Users can submit feedback successfully
- [ ] Managers can view team feedback
- [ ] HR can access analytics
- [ ] No critical bugs reported in first 24h
- [ ] User satisfaction > 80%

### Operational Success
- [ ] Monitoring dashboards active
- [ ] Alerts configured and tested
- [ ] Support team trained
- [ ] Documentation updated
- [ ] Rollback plan tested

---

## Emergency Contacts

- **Tech Lead**: [Name] - [Phone/Email]
- **DevOps**: [Name] - [Phone/Email]
- **DBA**: [Name] - [Phone/Email]
- **Product Manager**: [Name] - [Phone/Email]
- **Support Lead**: [Name] - [Phone/Email]

---

## Post-Deployment Tasks

### Immediate (Day 1)
- [ ] Monitor error logs every hour
- [ ] Review performance metrics
- [ ] Check user feedback
- [ ] Address any critical issues

### Short-term (Week 1)
- [ ] Analyze usage patterns
- [ ] Optimize slow queries
- [ ] Fix minor bugs
- [ ] Gather user feedback

### Medium-term (Month 1)
- [ ] Review business metrics
- [ ] Plan enhancements
- [ ] Update documentation
- [ ] Conduct retrospective

---

## Notes

- **Deployment Date**: [To be scheduled]
- **Deployment Team**: [Names]
- **Maintenance Window**: [Time range]
- **Estimated Downtime**: [Duration]

---

## Appendix

### Related Documentation
- Backend API Documentation: `docs/api/performance-feedback.md`
- Frontend Component Guide: `docs/frontend/performance-feedback-components.md`
- Database Schema: `docs/database/performance-feedback-schema.md`
- Testing Guide: `docs/testing/performance-feedback-tests.md`

### Version Information
- Backend Version: 1.0.0
- Frontend Version: 1.0.0
- Database Schema Version: 1.0.0
- Deployment Date: [TBD]

---

**Last Updated**: 2026-05-31  
**Document Owner**: Tech Lead  
**Review Cycle**: After each deployment
