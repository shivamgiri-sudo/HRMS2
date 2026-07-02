# HRMS Security & Functionality Fixes - Testing Checklist

## Phase 1: RBAC Security

### Backend Role Guards
Test that routes now require proper roles:

```bash
# Test ATS routes (should require recruiter/hr/admin)
curl -X GET http://localhost:3001/api/ats/candidates \
  -H "Authorization: Bearer <employee-token>" \
  # Expected: 403 Forbidden

curl -X GET http://localhost:3001/api/ats/candidates \
  -H "Authorization: Bearer <recruiter-token>" \
  # Expected: 200 OK with candidates list

# Test Payroll routes (should require admin/finance/payroll)
curl -X GET http://localhost:3001/api/payroll/runs \
  -H "Authorization: Bearer <employee-token>" \
  # Expected: 403 Forbidden

curl -X GET http://localhost:3001/api/payroll/runs \
  -H "Authorization: Bearer <payroll-token>" \
  # Expected: 200 OK with payroll runs

# Test Employee CRUD (should require admin/hr)
curl -X POST http://localhost:3001/api/employees \
  -H "Authorization: Bearer <employee-token>" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Test User"}' \
  # Expected: 403 Forbidden

curl -X POST http://localhost:3001/api/employees \
  -H "Authorization: Bearer <hr-token>" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Test User"}' \
  # Expected: 201 Created

# Test Integration Hub (should be admin-only)
curl -X GET http://localhost:3001/api/integration-hub \
  -H "Authorization: Bearer <hr-token>" \
  # Expected: 403 Forbidden

curl -X GET http://localhost:3001/api/integration-hub \
  -H "Authorization: Bearer <admin-token>" \
  # Expected: 200 OK
```

### Verification Steps
- [ ] ATS routes block non-recruiter users
- [ ] Payroll routes block non-payroll users
- [ ] Employee CRUD blocks non-HR users
- [ ] Integration Hub is admin-only
- [ ] Management dashboard accessible to manager/qa/ceo
- [ ] LMS mapping accessible to trainer role

---

## Phase 2: Candidate File Upload

### Test Upload Endpoint
```bash
# Step 1: Create candidate (public)
CANDIDATE_RESPONSE=$(curl -X POST http://localhost:3001/api/ats/candidates \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Test Candidate",
    "mobile": "9999999999",
    "email": "test@test.com",
    "sourcingChannel": "walk-in",
    "walkInDate": "2026-06-03"
  }')

CANDIDATE_ID=$(echo $CANDIDATE_RESPONSE | jq -r '.data.id')

# Step 2: Upload resume (within 1 hour - PUBLIC)
curl -X POST http://localhost:3001/api/ats/candidates/$CANDIDATE_ID/upload \
  -F "file=@/path/to/resume.pdf" \
  -F "type=resume"
  # Expected: 200 OK with file URL

# Step 3: Upload selfie (within 1 hour - PUBLIC)
curl -X POST http://localhost:3001/api/ats/candidates/$CANDIDATE_ID/upload \
  -F "file=@/path/to/photo.jpg" \
  -F "type=selfie"
  # Expected: 200 OK with file URL

# Step 4: Verify upload after 1 hour (should fail)
# Wait or manually set created_at to > 1 hour ago
curl -X POST http://localhost:3001/api/ats/candidates/$CANDIDATE_ID/upload \
  -F "file=@/path/to/resume.pdf" \
  -F "type=resume"
  # Expected: 403 Upload window expired
```

### Database Verification
```bash
cd /home/shuvam/hrms-audit/backend
# Run migration
mysql -u root -p mas_hrms < sql/099_ats_candidate_uploads.sql

# Verify columns exist
mysql -u root -p -e "DESC mas_hrms.ats_candidate" | grep -E "resume_url|selfie_url"
# Expected: resume_url and selfie_url columns present
```

### Verification Steps
- [ ] Migration file exists: `backend/sql/099_ats_candidate_uploads.sql`
- [ ] Database has `resume_url` and `selfie_url` columns
- [ ] Upload endpoint accepts PDF/JPG/PNG files
- [ ] Upload fails after 1 hour window
- [ ] Upload fails with invalid file types
- [ ] Uploaded files appear in `/uploads/candidates/` directory
- [ ] Candidate record stores file URLs correctly

---

## Phase 3: Sourcing Channel Normalization

### Test Normalization
```bash
# Test case-insensitive matching
curl -X POST http://localhost:3001/api/ats/candidates \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Walk-in Test 1",
    "mobile": "8888888881",
    "sourcingChannel": "walk-in"
  }'
# Expected: Saved as "Walk-In" in DB

curl -X POST http://localhost:3001/api/ats/candidates \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Walk-in Test 2",
    "mobile": "8888888882",
    "sourcingChannel": "Walk-In"
  }'
# Expected: Saved as "Walk-In" in DB

curl -X POST http://localhost:3001/api/ats/candidates \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Walk-in Test 3",
    "mobile": "8888888883",
    "sourcingChannel": "WALK_IN"
  }'
# Expected: Saved as "Walk-In" in DB

# Verify walk-in queue shows all candidates
curl -X GET http://localhost:3001/api/ats/walkin-queue \
  -H "Authorization: Bearer <recruiter-token>"
# Expected: All 3 candidates appear in queue
```

### Database Verification
```bash
mysql -u root -p -e "
  SELECT id, full_name, sourcing_channel 
  FROM mas_hrms.ats_candidate 
  WHERE mobile IN ('8888888881', '8888888882', '8888888883')
"
# Expected: All have sourcing_channel = "Walk-In" (normalized)
```

### Verification Steps
- [ ] `walk-in` normalizes to `Walk-In`
- [ ] `WALK_IN` normalizes to `Walk-In`
- [ ] `walkin` normalizes to `Walk-In`
- [ ] All normalized candidates appear in walk-in queue
- [ ] Other channels normalize correctly (Employee Referral, Job Portal, etc.)

---

## Phase 4: LMS Runtime Fixes

### Frontend Pages Load Without Errors
```bash
# Start frontend dev server
cd /home/shuvam/hrms-audit
npm run dev
```

### Browser Testing
1. Navigate to: `http://localhost:5173/lms/my-learning`
   - [ ] Page loads without `ReferenceError: error is not defined`
   - [ ] Page shows error handling UI if API fails
   - [ ] No console errors

2. Navigate to: `http://localhost:5173/lms/admin`
   - [ ] Shows LMSIntegrationAdmin component (not broken NativeLMSAdmin)
   - [ ] External LMS links visible
   - [ ] Mapping form works
   - [ ] No `db.from()` errors

3. Navigate to: `http://localhost:5173/lms/management-dashboard`
   - [ ] Shows LMSProgressDashboard component
   - [ ] Read-only progress view renders
   - [ ] No runtime errors

### Verification Steps
- [ ] NativeLMSMyLearning no longer references undefined `error`/`data`
- [ ] LMSIntegrationAdmin replaces NativeLMSAdmin
- [ ] LMSProgressDashboard replaces NativeLMSManagementDashboard
- [ ] No `db.from()` calls in frontend code
- [ ] NativePlaceholderPage imports updated correctly

---

## Phase 5: Role Assignment API

### Test Role Assignment Endpoints
```bash
# Get all roles
curl -X GET http://localhost:3001/api/admin/roles \
  -H "Authorization: Bearer <admin-token>"
# Expected: 200 OK with roles list

# Get user's roles
curl -X GET http://localhost:3001/api/admin/users/<user-id>/roles \
  -H "Authorization: Bearer <admin-token>"
# Expected: 200 OK with user's current roles

# Assign recruiter role
curl -X POST http://localhost:3001/api/admin/users/<user-id>/roles \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"roleKey": "recruiter"}'
# Expected: 201 Created

# Verify user can now access ATS
curl -X GET http://localhost:3001/api/ats/candidates \
  -H "Authorization: Bearer <user-token>"
# Expected: 200 OK (was 403 before)

# Revoke role
curl -X DELETE http://localhost:3001/api/admin/users/<user-id>/roles/recruiter \
  -H "Authorization: Bearer <admin-token>"
# Expected: 200 OK

# Get audit log
curl -X GET "http://localhost:3001/api/admin/role-audit?limit=100" \
  -H "Authorization: Bearer <admin-token>"
# Expected: 200 OK with audit entries

# Bulk assign
curl -X POST http://localhost:3001/api/admin/users/bulk-assign \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "assignments": [
      {"userId": "<user1-id>", "roleKey": "wfm"},
      {"userId": "<user2-id>", "roleKey": "qa"}
    ]
  }'
# Expected: 200 OK with success/failed counts

# Test non-admin access (should fail)
curl -X GET http://localhost:3001/api/admin/roles \
  -H "Authorization: Bearer <hr-token>"
# Expected: 403 Forbidden
```

### Verification Steps
- [ ] `/api/admin/roles` endpoint exists and returns roles
- [ ] `/api/admin/users/:userId/roles` GET works
- [ ] `/api/admin/users/:userId/roles` POST assigns roles
- [ ] `/api/admin/users/:userId/roles/:roleKey` DELETE revokes roles
- [ ] `/api/admin/role-audit` shows assignment history
- [ ] `/api/admin/users/bulk-assign` bulk assigns
- [ ] All endpoints require admin role
- [ ] Role assignment routes mounted in app.ts

---

## Phase 6: Sidebar Navigation

### Test Role-Based Visibility
```bash
# Start frontend
cd /home/shuvam/hrms-audit
npm run dev
```

### Browser Testing - Different Roles

#### Test as Employee
- Login as employee role
- [ ] Payroll link NOT visible in sidebar
- [ ] Finance link NOT visible
- [ ] Employee workspace IS visible

#### Test as HR
- Login as HR role
- [ ] Payroll link visible
- [ ] Employee management visible
- [ ] Advanced reports visible

#### Test as Finance/Payroll
- Login as finance or payroll role
- [ ] Payroll link visible in sidebar
- [ ] Payslips visible
- [ ] Full & Final visible
- [ ] Can access `/payroll` routes

#### Test as WFM
- Login as WFM role
- [ ] WFM roster visible
- [ ] Live tracker visible
- [ ] Can access WFM routes

#### Test as Manager/CEO
- Login as manager or CEO role
- [ ] Management dashboard visible
- [ ] Advanced reports visible
- [ ] Team KPI visible

### Verification Steps
- [ ] `getPrimaryRole()` recognizes all 14 roles
- [ ] `hasAnyRole()` function works correctly
- [ ] Payroll nav items use `roles: ["admin", "hr", "finance", "payroll"]`
- [ ] ERP nav item includes finance role
- [ ] Advanced Reports include manager/ceo roles
- [ ] Navigation filtering uses `hasAnyRole(...item.roles)`

---

## Build & Deployment Testing

### Backend Build
```bash
cd /home/shuvam/hrms-audit/backend
npm run build
# Expected: No TypeScript errors

# Check for imports
grep -r "requireRole" dist/modules/*/
# Expected: Multiple matches showing role guards in compiled code
```

### Frontend Build
```bash
cd /home/shuvam/hrms-audit
npm run build
# Expected: No TypeScript/build errors

# Check bundle
grep -r "LMSIntegrationAdmin" dist/
# Expected: Component exists in bundle
```

### Verification Steps
- [ ] Backend builds without errors
- [ ] Frontend builds without errors
- [ ] No TypeScript compilation errors
- [ ] All imports resolve correctly
- [ ] New components bundled

---

## Integration Testing

### End-to-End Scenarios

#### Scenario 1: Walk-in Candidate Registration + Upload
1. Open public form: `/interview-registration`
2. Fill candidate details with `sourcingChannel: walk-in`
3. Submit form → get candidate ID
4. Upload resume PDF
5. Upload selfie JPG
6. Login as recruiter
7. Navigate to walk-in queue
8. **Verify**: Candidate appears in queue with files

#### Scenario 2: Role-Based Access Control
1. Login as employee
2. Try to access `/payroll`
3. **Verify**: 403 or redirect
4. Login as admin
5. Go to Access Control (new feature)
6. Assign "payroll" role to employee
7. Re-login as employee
8. Try to access `/payroll` again
9. **Verify**: Now accessible

#### Scenario 3: LMS Integration
1. Login as trainer
2. Navigate to LMS Admin
3. **Verify**: Integration UI loads (not broken curriculum editor)
4. View learner mappings
5. Create new mapping
6. **Verify**: API call succeeds
7. Check sync log
8. **Verify**: Data displays correctly

---

## Regression Testing

### Existing Features Still Work
- [ ] Employee login/logout
- [ ] Dashboard loads
- [ ] Leave request submission
- [ ] Attendance clock-in/out
- [ ] KPI scorecard view
- [ ] Helpdesk ticket creation
- [ ] Document upload (non-ATS)

---

## Performance Testing

### Load Testing
```bash
# Test candidate upload under load
for i in {1..10}; do
  curl -X POST http://localhost:3001/api/ats/candidates \
    -H "Content-Type: application/json" \
    -d "{\"fullName\":\"Test$i\",\"mobile\":\"888888$i\",\"sourcingChannel\":\"walk-in\"}" &
done
wait
# Expected: All requests succeed
```

### Verification Steps
- [ ] Concurrent uploads work
- [ ] No race conditions in normalization
- [ ] Role checks don't cause performance issues

---

## Security Testing

### Attempt Authorization Bypasses
```bash
# Try to access admin API without admin role
curl -X POST http://localhost:3001/api/admin/users/<user-id>/roles \
  -H "Authorization: Bearer <employee-token>" \
  -H "Content-Type: application/json" \
  -d '{"roleKey": "admin"}'
# Expected: 403 Forbidden

# Try to escalate own privileges
curl -X POST http://localhost:3001/api/admin/users/<own-id>/roles \
  -H "Authorization: Bearer <employee-token>" \
  -H "Content-Type: application/json" \
  -d '{"roleKey": "admin"}'
# Expected: 403 Forbidden

# Try SQL injection in candidate upload
curl -X POST http://localhost:3001/api/ats/candidates/<id>/upload \
  -F "file=@test.pdf" \
  -F "type=resume' OR '1'='1"
# Expected: Validation error or 400, not SQL error
```

### Verification Steps
- [ ] Non-admin cannot assign roles
- [ ] Non-admin cannot access integration hub
- [ ] Employees cannot modify payroll
- [ ] Role guards prevent escalation
- [ ] Input validation prevents injection

---

## Final Checklist

### Code Quality
- [ ] No console.log statements in production code
- [ ] All TypeScript errors resolved
- [ ] ESLint warnings addressed
- [ ] No unused imports

### Documentation
- [ ] API endpoints documented
- [ ] Role requirements clear
- [ ] Testing checklist complete
- [ ] Deployment notes updated

### Deployment Readiness
- [ ] Database migrations tested
- [ ] Environment variables documented
- [ ] Backward compatibility verified
- [ ] Rollback plan prepared
