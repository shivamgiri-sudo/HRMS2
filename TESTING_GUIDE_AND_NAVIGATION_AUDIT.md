# Testing Guide & Navigation Audit

**Date**: 2026-06-11  
**Status**: Ready for Manual Testing  
**Servers**: Backend (5055) + Frontend (8080)

---

## 🚀 Quick Start Testing

### Step 1: Verify Servers Running

```bash
# Check backend
curl http://localhost:5055/health
# Expected: {"status":"ok"}

# Check frontend
curl http://localhost:8080
# Expected: HTML response
```

### Step 2: Login with Demo Credentials

**URL**: http://localhost:8080

**Test Account 1 - Admin**:
```
Email: admin@mascallnet.com
Password: Admin@123
```

**Test Account 2 - Employee**:
```
Email: employee@mascallnet.com
Password: Employee@1
```

**Test Account 3 - Real Employee**:
```
Email: naresh.chauhan@teammas.in
Password: Admin@123
```

---

## 📋 Complete Testing Checklist

### ✅ Authentication Testing

| Test | Steps | Expected Result | Status |
|------|-------|-----------------|--------|
| **Login - Demo Admin** | Enter admin@mascallnet.com / Admin@123 | Redirects to /dashboard | ⏳ |
| **Login - Demo Employee** | Enter employee@mascallnet.com / Employee@1 | Redirects to /dashboard | ⏳ |
| **Login - Real Employee** | Enter naresh.chauhan@teammas.in / Admin@123 | Redirects to /dashboard | ⏳ |
| **Invalid Credentials** | Enter wrong password | Shows error message | ⏳ |
| **Role Detection** | Login as different roles | Correct menu items visible | ⏳ |
| **Logout** | Click logout | Returns to /auth page | ⏳ |

---

### ✅ Dashboard Testing

| Test | Expected Result | Status |
|------|-----------------|--------|
| **Dashboard Loads** | Shows metrics cards | ⏳ |
| **Employee Count** | Shows actual number from DB | ⏳ |
| **Leave Stats** | Shows pending/approved counts | ⏳ |
| **Attendance Today** | Shows current attendance | ⏳ |
| **Department Count** | Shows actual departments | ⏳ |
| **No Errors** | Console clean, no red errors | ⏳ |
| **User Greeting** | Shows "Good [time], [name]" | ⏳ |

---

### ✅ Profile & Payslips Testing (CRITICAL - Our Fixes)

| Test | Expected Result | Status |
|------|-----------------|--------|
| **Profile Page Opens** | /profile loads without errors | ⏳ |
| **Personal Info Tab** | Shows employee details | ⏳ |
| **Payslips Tab** | Shows salary structure + history | ⏳ |
| **Salary Structure Card** | Shows ALL earning components by name | ⏳ |
| **Component Names** | Shows "Basic Salary", "HRA", "Travel Allowance", etc. | ⏳ |
| **No ₹0 Values** | All components show actual amounts | ⏳ |
| **Deductions Breakdown** | Shows PF, ESIC, PT, TDS by name | ⏳ |
| **Gross Salary** | Matches sum of all earnings | ⏳ |
| **Net Salary** | Gross - Deductions = Net | ⏳ |
| **History Table** | Shows last 12 months | ⏳ |
| **Expandable Rows** | Click row shows full breakdown | ⏳ |
| **All Components in Expansion** | ALL earnings/deductions visible | ⏳ |
| **PDF Download Button** | Button clickable, not disabled | ⏳ |
| **PDF Downloads** | File downloads to browser | ⏳ |
| **PDF Contains Data** | Open PDF, verify all sections | ⏳ |
| **PDF Employee Details** | Shows correct designation/dept/location | ⏳ |
| **PDF Component Breakdown** | All salary components in PDF | ⏳ |
| **Multiple Months** | Test 3+ different months | ⏳ |
| **Year Selector** | Change year, data updates | ⏳ |

---

### ✅ Attendance Testing

| Test | Expected Result | Status |
|------|-----------------|--------|
| **Attendance Page Opens** | /attendance loads | ⏳ |
| **Calendar View** | Month calendar visible | ⏳ |
| **Color-coded Dates** | Green (present), Red (absent), etc. | ⏳ |
| **Click Date** | Popup shows clock in/out details | ⏳ |
| **Month Navigation** | Previous/Next buttons work | ⏳ |
| **History Table** | Shows last 30 days | ⏳ |
| **Break Information** | Shows break count and duration | ⏳ |

---

### ✅ Leave Management Testing

| Test | Expected Result | Status |
|------|-----------------|--------|
| **Leaves Page Opens** | /leaves loads | ⏳ |
| **Leave Balance Card** | Shows available leaves | ⏳ |
| **Leave Types** | CL, SL, PL, etc. visible | ⏳ |
| **Apply Leave Button** | Opens apply dialog | ⏳ |
| **Leave History** | Shows past leave requests | ⏳ |
| **Status Badges** | Pending/Approved/Rejected | ⏳ |

---

### ✅ Navigation Testing (All Menu Items)

#### Overview Section
| Menu Item | Route | Expected | Status |
|-----------|-------|----------|--------|
| Dashboard | /dashboard | Loads with metrics | ⏳ |
| My Modules | /modules | Shows allowed modules | ⏳ |
| Work Inbox | /work-inbox | Shows pending tasks | ⏳ |
| Reports | /reports | Admin/HR/Manager only | ⏳ |

#### My Space Section
| Menu Item | Route | Expected | Status |
|-----------|-------|----------|--------|
| Profile | /profile | Shows employee profile | ⏳ |
| Attendance | /attendance | Calendar + history | ⏳ |
| Leaves | /leaves | Leave balance + history | ⏳ |
| My Roster | /my-roster | Roster schedule | ⏳ |
| Payslips | /payroll/payslips | Salary structure + PDF | ⏳ |
| Tax Declaration | /payroll/tax-declaration | Tax forms | ⏳ |
| Engagement | /engagement | Kudos/badges | ⏳ |

#### People & Hiring Section
| Menu Item | Route | Expected | Status |
|-----------|-------|----------|--------|
| Employees | /employees | Employee directory | ⏳ |
| Departments | /departments | Department list | ⏳ |
| Onboarding | /onboarding | HR only | ⏳ |
| Document Verification | /document-verification | HR only | ⏳ |
| Employee Journey | /employee-stat-card | Journey timeline | ⏳ |
| ATS Command | /ats/command-center | ATS dashboard | ⏳ |
| Walk-in Queue | /ats/walkin-queue | Candidate queue | ⏳ |
| My Candidates | /ats/recruiter/my-candidates | Recruiter only | ⏳ |
| Jobs Portal | /jobs | Job listings | ⏳ |

#### Workforce Section
| Menu Item | Route | Expected | Status |
|-----------|-------|----------|--------|
| My Learning | /lms/my-learning | LMS courses | ⏳ |
| LMS Coordinator | /lms/coordinator | LMS management | ⏳ |
| LMS Admin | /lms/admin | LMS admin panel | ⏳ |
| Roster Planning | /wfm/roster | Roster management | ⏳ |
| Auto Roster | /wfm/auto-roster | Auto scheduling | ⏳ |
| RTA Board | /rta-board | Real-time adherence | ⏳ |
| WFM Tracker | /wfm/live-tracker | Live tracking | ⏳ |

#### Operations Section
| Menu Item | Route | Expected | Status |
|-----------|-------|----------|--------|
| Performance | /performance | Performance metrics | ⏳ |
| Goals & Appraisal | /goals | Goal management | ⏳ |
| Payroll | /payroll | Payroll runs (admin) | ⏳ |
| Full & Final | /payroll/full-final | F&F settlement | ⏳ |
| KPI Config | /kpi-config | KPI setup | ⏳ |
| Operations KPI | /operations-kpi | Ops KPI dashboard | ⏳ |
| Management | /management/dashboard | Management view | ⏳ |
| Control Tower | /control-tower | Operations control | ⏳ |

#### Engage & Support Section
| Menu Item | Route | Expected | Status |
|-----------|-------|----------|--------|
| Kudos Wall | /engagement/kudos | Recognition wall | ⏳ |
| Badges | /engagement/badges | Badge collection | ⏳ |
| Surveys | /engagement/surveys | Survey forms | ⏳ |
| Helpdesk | /helpdesk | Support tickets | ⏳ |
| Benefits & Claims | /benefits | Benefits management | ⏳ |
| Feedback | /performance-feedback/my-reports | Feedback reports | ⏳ |

#### Admin Section
| Menu Item | Route | Expected | Status |
|-----------|-------|----------|--------|
| Access Control | /settings/access-control | User permissions | ⏳ |
| Page Access | /super-admin/page-access | Page permissions | ⏳ |
| Comm. Config | /settings/communication-config | Email/SMS config | ⏳ |
| Org Masters | /org-masters | Master data | ⏳ |
| Process Config | /process-config | Process setup | ⏳ |
| Leave Types | /leave-types | Leave config | ⏳ |
| Statutory Config | /payroll/statutory-config | PF/ESIC setup | ⏳ |
| Compliance | /compliance/statutory | Compliance reports | ⏳ |
| DPDP / Privacy | /compliance/dpdp | Privacy compliance | ⏳ |
| Client Master | /client-master | Client management | ⏳ |
| Integration Hub | /integration-hub | API integrations | ⏳ |
| Exit Management | /exit-management | Exit process | ⏳ |

---

## 🐛 Common Issues to Check

### Issue 1: Pages Not Loading
**Symptoms**: Blank page, infinite spinner, console errors  
**Check**:
- Browser console for errors
- Network tab for failed API calls
- Backend logs for server errors

### Issue 2: Menu Items Not Visible
**Symptoms**: Expected menu item missing  
**Check**:
- User role in database
- `user_roles` table has correct role_key
- Role has access in `ROLE_MODULE_ACCESS` (role.catalog.ts)

### Issue 3: Data Not Displaying
**Symptoms**: Tables empty, cards show 0  
**Check**:
- Database has data for that employee
- API endpoint returns data (check Network tab)
- Frontend query not failing silently

### Issue 4: PDF Download Not Working
**Symptoms**: Button disabled, no download, PDF empty  
**Check**:
- Component breakdown data exists
- Employee profile data (designation, dept, location) loaded
- jsPDF library loaded correctly
- Browser allows downloads

---

## 🔍 Debugging Checklist

### Backend Issues
```bash
# Check backend logs
tail -f /tmp/backend.log

# Test API directly
curl http://localhost:5055/api/employees/me \
  -H "Authorization: Bearer mock-token-employee"

# Check database connection
mysql --host=122.184.128.90 --port=3306 --user=shivam_user \
  --password='qwersdfg!@#hjk' --database=mas_hrms \
  --execute="SELECT COUNT(*) FROM employees;"
```

### Frontend Issues
```bash
# Check frontend logs
tail -f /tmp/frontend.log

# Check build errors
cd /home/shuvam/hrms-audit && npm run build

# Clear browser cache
# Open DevTools → Application → Clear Storage
```

### Database Issues
```sql
-- Check employee has auth_user
SELECT au.email, e.employee_code, e.first_name 
FROM auth_user au
JOIN employees e ON e.user_id = au.id
WHERE au.email = 'naresh.chauhan@teammas.in';

-- Check payroll data exists
SELECT COUNT(*) FROM salary_prep_line
WHERE employee_code = 'MAS00175';

-- Check components exist
SELECT COUNT(*) FROM salary_prep_line_component
WHERE employee_id IN (SELECT id FROM employees WHERE employee_code = 'MAS00175');
```

---

## 📊 Expected Data Verification

### For Employee MAS00175 (Naresh Kumar Chauhan)

**Profile Data**:
- Name: NARESH KUMAR CHAUHAN
- Designation: DY. MANAGER
- Department: FINANCE & ACCOUNTS
- Branch: HEAD OFFICE
- Email: NARESH.CHAUHAN@TEAMMAS.IN

**Payroll Data** (March 2026):
- Basic: ₹10,400.00
- HRA: ₹5,200.00
- Special Allowance: ₹9,949.68
- Travel Allowance: ₹1,664.00
- Gross Salary: ₹38,480.00
- PF Employee: ₹1,200.00
- Professional Tax: ₹200.00
- Total Deductions: ₹1,400.00
- Net Salary: ₹37,080.00

**Component Count**:
- Earnings: 4 components
- Deductions: 1 component

---

## ✅ Success Criteria

### Critical (Must Pass)
- [ ] Login works for all test accounts
- [ ] Dashboard loads without errors
- [ ] Profile page shows correct employee data
- [ ] Payslips tab displays ALL salary components
- [ ] PDF downloads with correct employee details
- [ ] No ₹0 or NULL values in component breakdown
- [ ] Navigation menu shows correct items per role

### Important (Should Pass)
- [ ] All 91 menu items open correctly
- [ ] Data loads from actual database
- [ ] Role-based access control working
- [ ] No console errors on major pages
- [ ] Responsive design works on mobile

### Nice to Have (Future)
- [ ] Performance under 2 seconds per page
- [ ] Offline mode works
- [ ] PWA installable
- [ ] Dark mode available

---

## 📝 Issue Reporting Template

When you find an issue, document it:

```markdown
### Issue #X: [Short Title]

**Severity**: Critical / High / Medium / Low
**Page**: /path/to/page
**User Role**: admin / employee / etc.
**Browser**: Chrome 120 / Firefox 121 / etc.

**Steps to Reproduce**:
1. Login as X
2. Navigate to Y
3. Click Z
4. Observe error

**Expected Behavior**:
Should show ABC

**Actual Behavior**:
Shows XYZ error

**Console Errors**:
```
[Error message from console]
```

**Screenshots**: [Attach if relevant]

**Database Check**:
```sql
-- SQL query showing data exists
SELECT * FROM table WHERE ...
```

**Fix Applied**: [If you fixed it]
**Status**: Open / In Progress / Fixed / Verified
```

---

## 🚀 Next Steps After Testing

### If All Tests Pass:
1. Document successful test results
2. Update COMPREHENSIVE_AUDIT_FINAL_REPORT.md
3. Mark all tasks as completed
4. Prepare for staging deployment
5. Create user acceptance testing (UAT) plan

### If Issues Found:
1. Document each issue using template above
2. Prioritize: Critical → High → Medium → Low
3. Fix critical issues first
4. Re-test after each fix
5. Update documentation

### Production Readiness:
1. All critical tests pass
2. All major pages load correctly
3. No console errors on happy path
4. Role-based access working
5. Data accuracy verified
6. PDF generation tested with 10+ employees

---

## 📞 Support

**If Servers Won't Start**:
```bash
# Kill existing processes
pkill -f "npm run dev"
pkill -f "vite"
pkill -f "node"

# Restart
cd /home/shuvam/hrms-audit/backend && npm run dev &
cd /home/shuvam/hrms-audit && npm run dev &
```

**If Database Connection Fails**:
```bash
# Test connection
mysql --host=122.184.128.90 --port=3306 \
  --user=shivam_user --password='qwersdfg!@#hjk' \
  --execute="SELECT 1;"
```

**If Build Fails**:
```bash
# Clear node_modules and rebuild
rm -rf node_modules package-lock.json
npm install
npm run build
```

---

## 🎯 Testing Priority Order

1. **CRITICAL** (Test First):
   - Login authentication
   - Dashboard loading
   - Profile & Payslips (our fixes)
   - PDF download

2. **HIGH** (Test Next):
   - Attendance page
   - Leave management
   - Employee directory
   - Navigation menu

3. **MEDIUM** (Test After):
   - ATS pages
   - LMS pages
   - WFM pages
   - Reports

4. **LOW** (Test Last):
   - Engagement features
   - Admin settings
   - Advanced features

---

**Testing Window**: 2-4 hours for comprehensive testing  
**Priority**: Focus on payslip/salary component fixes (our main deliverables)  
**Goal**: Verify all 6 critical issues we fixed are resolved  

**Start Testing Now**: http://localhost:8080

---

**Generated**: 2026-06-11  
**For**: MCN HRMS Post-Audit Manual Testing  
**Status**: Ready for Execution
