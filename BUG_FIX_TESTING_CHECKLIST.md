# Bug Fix & Testing Checklist - All Roles

## 🎯 **Testing Strategy**

Test with 3 different users:
1. **Admin** - Full access
2. **HR** - HR permissions
3. **Employee** - Basic user

---

## 🐛 **Priority 1: Critical Bugs (MUST FIX)**

### **1. Payslip PDF Download** 
**Status**: Debug logging added  
**Test Steps**:
1. Login as admin/HR
2. Go to Payroll page
3. Click Download icon (PDF) on any record
4. **Expected**: PDF downloads automatically
5. **Check Console**: Look for errors in F12 → Console

**Debug Added**:
- Logs "Starting payslip download for: {name}"
- Logs salary structure data
- Logs payslip data object
- Logs completion or error

**Possible Issues**:
- API `/api/payroll/structures` might be failing
- jsPDF library not loaded
- Browser blocking download
- CORS issues

---

### **2. Attendance Page**
**Status**: Debug logging added  
**Test Steps**:
1. Login as employee
2. Go to Attendance page
3. **Check**:
   - Does page load?
   - Does "My Attendance History" section show at bottom?
   - Does it have data or show "No records"?
4. **Check Console**: Look for errors

**Debug Added**:
- Logs: recordsLoading, recordsError, attendanceRecords
- Logs targetDate and employeeId

**Possible Issues**:
- API `/api/wfm/attendance/daily` failing
- Employee ID not found
- Date range issue
- Permission denied

---

## 📋 **Priority 2: Feature Testing by Role**

### **ADMIN Role Testing**

#### **Dashboard**
- [ ] Page loads without errors
- [ ] All metrics show correct numbers
- [ ] Charts render properly
- [ ] "Add Employee" button works
- [ ] "View Reports" button works

#### **Employees**
- [ ] List loads
- [ ] Can add new employee
- [ ] Can edit employee
- [ ] Can view employee details
- [ ] Search works
- [ ] Filter works

#### **Departments**
- [ ] List loads
- [ ] Can add department
- [ ] Can edit department
- [ ] Can delete department (if no employees)
- [ ] Manager dropdown works

#### **Attendance**
- [ ] Can see all employees attendance
- [ ] Can filter by date/employee
- [ ] Can export data
- [ ] History section shows data

#### **Leaves**
- [ ] Can see all leave requests
- [ ] Can approve/reject leaves
- [ ] Status badges show correctly
- [ ] Calendar view works

#### **Payroll**
- [ ] List of all payroll records loads
- [ ] Can mark as processed
- [ ] Can mark as paid
- [ ] **PDF download works** ⚠️
- [ ] Bulk actions work
- [ ] Status badges correct

#### **Onboarding**
- [ ] List of candidates loads
- [ ] Can add new candidate
- [ ] Can update status
- [ ] Status badges show correctly

#### **Settings**
- [ ] Page loads
- [ ] Can modify settings
- [ ] Changes save correctly

---

### **HR Role Testing**

#### **Dashboard**
- [ ] Page loads
- [ ] HR-relevant metrics show
- [ ] Can access HR functions

#### **Employees**
- [ ] Can view all employees
- [ ] Can add/edit employees
- [ ] Search and filter work

#### **Leaves**
- [ ] Can see team leave requests
- [ ] Can approve/reject
- [ ] Status updates work

#### **Attendance**
- [ ] Can view team attendance
- [ ] Can generate reports
- [ ] **History section works** ⚠️

#### **Payroll** (if has access)
- [ ] Can view payroll
- [ ] **PDF download works** ⚠️

---

### **Employee Role Testing**

#### **Dashboard**
- [ ] Page loads
- [ ] Shows personal metrics
- [ ] "Apply Leave" button works
- [ ] "Mark Attendance" button works

#### **My Profile**
- [ ] Can view profile
- [ ] Can edit personal info
- [ ] Changes save

#### **Attendance**
- [ ] Can clock in
- [ ] Can clock out
- [ ] Can take break
- [ ] Can resume from break
- [ ] **"My Attendance History" shows data** ⚠️
- [ ] Can see own records only

#### **Leaves**
- [ ] Can apply for leave
- [ ] Can see own requests
- [ ] Can cancel pending requests
- [ ] Status shows correctly

#### **Payroll** (My Payslips)
- [ ] Can see own payslips
- [ ] **Can download own payslip** ⚠️
- [ ] Data shows correctly

---

## 🔍 **How to Debug in Browser**

### **Step 1: Open Developer Console**
1. Press `F12`
2. Click "Console" tab
3. Keep it open while testing

### **Step 2: Test Each Feature**
As you click buttons/links:
- Watch for red errors in console
- Note exact error messages
- Check "Network" tab for failed API calls

### **Step 3: Common Issues to Check**

#### **Red Errors in Console:**
```
❌ TypeError: Cannot read property 'X' of undefined
   → Variable is not defined or null

❌ Failed to fetch
   → API endpoint not responding

❌ 401 Unauthorized
   → Not logged in or session expired

❌ 403 Forbidden
   → User doesn't have permission

❌ 404 Not Found
   → API endpoint doesn't exist

❌ 500 Internal Server Error
   → Backend error (check backend logs)
```

#### **Network Tab Issues:**
```
❌ Request shows red (failed)
   → Click on it, check Response tab for error

❌ Status 401/403
   → Authentication/permission issue

❌ Status 404
   → Wrong API endpoint

❌ Status 500
   → Backend error
```

---

## 📝 **Bug Report Template**

For each bug found, document:

```markdown
## Bug: [Short Description]

**Role**: Admin / HR / Employee  
**Page**: [Page Name]  
**Action**: [What you did]  

**Expected**: [What should happen]  
**Actual**: [What actually happened]  

**Console Errors**:
```
[Paste error from console]
```

**Network Errors**:
- API: [endpoint]
- Status: [code]
- Response: [error message]

**Screenshots**: [If relevant]
```

---

## ✅ **After All Bugs Fixed**

### **Final Verification Checklist**

#### **All Roles**
- [ ] Login works
- [ ] Dashboard loads
- [ ] Navigation works
- [ ] Logout works

#### **Core Features**
- [ ] Employee management works
- [ ] Attendance tracking works
- [ ] Leave management works
- [ ] Payroll processing works
- [ ] **PDF downloads work** ⚠️

#### **Data Integrity**
- [ ] Data saves correctly
- [ ] Data loads correctly
- [ ] Updates reflect immediately
- [ ] No data loss

#### **Performance**
- [ ] Pages load fast (<3s)
- [ ] No laggy interactions
- [ ] Charts render smoothly
- [ ] Tables scroll well

---

## 🚀 **Next: UI Redesign**

Once all bugs are fixed and tested:

### **Phase 1: Study SmartHR** (3-4 days)
- Analyze SmartHR.jp UI screenshots
- Note space utilization patterns
- Study chart designs
- Document layout principles

### **Phase 2: Redesign Plan** (2-3 days)
- Create mockups for key pages
- Get approval on design direction
- Plan implementation order

### **Phase 3: Implementation** (2-3 weeks)
- Redesign page by page
- Test after each page
- Get feedback at each milestone

---

## 📞 **Testing Instructions**

1. **Start Server**: `npm run dev`
2. **Open Browser**: http://localhost:8082/
3. **Open Console**: Press F12
4. **Test Each Role**:
   - Admin: `admin@shivu.ai` / `admin123`
   - HR: [HR credentials]
   - Employee: [Employee credentials]
5. **Document Issues**: Use bug report template
6. **Share Results**: Console errors + screenshots

---

**Current Status**: Debug logging added for payslip & attendance bugs  
**Next Step**: Test in browser and identify actual errors  
**Goal**: Fix all bugs before starting UI redesign
