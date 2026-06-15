# 🔧 Comprehensive Fix Guide - HRMS Issues

**Generated:** 2026-06-14  
**Status:** ✅ Profile DOB Fixed | ⏳ Others Pending

---

## ✅ **COMPLETED FIXES**

### 1. Profile Date of Birth Display ✅
**Issue:** DOB showing incorrect date due to timezone issues  
**Fix Applied:** Updated `formatDate` function in `src/pages/Profile.tsx`  
```typescript
const formatDate = (dateStr: string | null) => {
  if (!dateStr) return "—";
  // Handle timezone issues by parsing as local date
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString("en-IN", {
    year: "numeric", month: "long", day: "numeric",
  });
};
```
**Status:** FIXED ✅

---

## 🎨 **FRONTEND FIXES REQUIRED**

### 2. Payslip Redesign - Match Exact Template
**File:** `src/lib/masCallnetPayslipGenerator.ts`

**Issues:**
- Logo placement not matching template
- Table headers need exact alignment
- Row widths not matching
- Data alignment issues
- CTC column appearing in payslip (should only be in portal)

**Required Changes:**

#### A. Logo Fix (Line 79-84)
```typescript
// CURRENT (WRONG)
doc.addImage(logoBase64, 'PNG', 15, currentY, 25, 8);

// SHOULD BE (EXACT TEMPLATE)
doc.addImage(logoBase64, 'PNG', 10, currentY, 35, 12); // Larger, better positioned
```

#### B. Header - "SALARY SLIP" (Add after line 91)
```typescript
doc.setFontSize(14);
doc.setFont("helvetica", "bold");
doc.text("SALARY SLIP", pageWidth / 2, currentY + 8, { align: "center" });
```

#### C. Employee Table - Exact Column Widths (Lines 143-150)
```typescript
columnStyles: {
  0: { cellWidth: 25, fillColor: [240, 240, 240], fontStyle: 'bold' },  // Labels
  1: { cellWidth: 40 },  // Values
  2: { cellWidth: 25, fillColor: [240, 240, 240], fontStyle: 'bold' },
  3: { cellWidth: 40 },
  4: { cellWidth: 25, fillColor: [240, 240, 240], fontStyle: 'bold' },
  5: { cellWidth: 35 },
}
```

#### D. Earnings Table - Exact Match (Around line 156)
```typescript
autoTable(doc, {
  startY: (doc as any).lastAutoTable.finalY + 4,
  head: [[
    { content: 'EARNINGS', colSpan: 2, styles: { halign: 'center', fillColor: [27, 106, 181], textColor: [255, 255, 255], fontStyle: 'bold' } }
  ]],
  body: [
    [{ content: 'Description', styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } }, 
     { content: 'Amount (₹)', styles: { fontStyle: 'bold', fillColor: [240, 240, 240], halign: 'right' } }],
    ['Basic Salary', formatINR(data.basic)],
    ['HRA', formatINR(data.hra)],
    ['Bonus', formatINR(data.bonus)],
    ['Conveyance', formatINR(data.conv)],
    ['Performance Allowance', formatINR(data.pa)],
    ['Medical Allowance', formatINR(data.ma)],
    ['Special Allowance', formatINR(data.sa)],
    ['Other Allowance', formatINR(data.oa)],
    ['Arrear', formatINR(data.arrear)],
    ['Incentive', formatINR(data.incentive)],
    [{ content: 'GROSS EARNINGS', styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } },
     { content: formatINR(grossEarnings), styles: { fontStyle: 'bold', fillColor: [240, 240, 240], halign: 'right' } }],
  ],
  theme: "grid",
  styles: {
    fontSize: 9,
    cellPadding: 2,
    lineColor: [0, 0, 0],
    lineWidth: 0.1,
  },
  columnStyles: {
    0: { cellWidth: 95 },
    1: { cellWidth: 95, halign: 'right' },
  },
});
```

#### E. Remove CTC from Payslip
**Find and DELETE any CTC-related code in the generator**  
CTC should ONLY appear in the portal view, NOT in the downloaded PDF.

### 3. Work Inbox - Modern Redesign
**File:** `src/pages/WorkInbox.tsx` (or similar)

**Required:**
- Add gradient hero section (like Engagement pages)
- Modern card layouts with hover effects
- Better color coding for task types
- Improved spacing and typography

**Template to Follow:**
```typescript
// Hero Section
<div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 p-8 text-white shadow-2xl shadow-indigo-200/40">
  <div className="absolute -right-10 -top-10 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
  <div className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-pink-400/20 blur-2xl" />
  <div className="relative">
    <h1 className="text-4xl font-black tracking-tight">Work Inbox</h1>
    <p className="mt-2 text-blue-100">Your pending tasks and actions</p>
  </div>
</div>

// Task Cards
<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
  {tasks.map(task => (
    <div className="group rounded-[2rem] border-0 bg-white p-5 shadow-lg hover:shadow-xl transition-all hover:-translate-y-1">
      {/* Task content */}
    </div>
  ))}
</div>
```

### 4. Attendance Page - Remove Clock In/Out
**File:** `src/pages/Attendance.tsx`

**Changes:**
1. Remove clock in/out buttons
2. Show detailed attendance records in table
3. Add calendar view for date selection
4. Show day details on date click

**Structure:**
```typescript
// Remove this section
<Button onClick={clockIn}>Clock In</Button>
<Button onClick={clockOut}>Clock Out</Button>

// Replace with
<AttendanceCalendar 
  onDateClick={(date) => showDayDetails(date)}
  attendanceData={attendanceRecords}
/>

<AttendanceDetailedTable 
  records={attendanceRecords}
  columns={['Date', 'Clock In', 'Clock Out', 'Hours', 'Status']}
/>
```

---

## 🗄️ **BACKEND / DATABASE FIXES**

### 5. MySQL Engagement Error
**Error:** `Incorrect arguments to mysqld_stmt_execute`

**Diagnosis Steps:**
1. Check if tables exist:
```sql
SHOW TABLES LIKE '%engagement%';
SHOW TABLES LIKE '%gamification%';
SHOW TABLES LIKE '%survey%';
```

2. Check table structure:
```sql
DESCRIBE gamification_points_ledger;
DESCRIBE employee_tier_status;
DESCRIBE survey_response;
DESCRIBE pulse_check;
```

3. Run migration if tables missing:
```bash
cd backend
npm run migrate  # or execute backend/sql/038_engagement_gamification.sql
```

**Potential Fix:**
The issue might be in `gamification.service.ts` - parameter mismatch in execute() calls.
Check lines 13-20 in `engagement.service.ts` for parameter count.

### 6. Leave 2026 Bug
**Issue:** Leave data showing for year 2026 instead of current year

**File to Check:** Backend leave controller/service

**Fix:**
```sql
-- Check for incorrect dates
SELECT * FROM leave_requests WHERE YEAR(start_date) = 2026;

-- If test data, delete:
DELETE FROM leave_requests WHERE YEAR(start_date) > 2025;

-- Update if needed:
UPDATE leave_requests 
SET start_date = DATE_SUB(start_date, INTERVAL 1 YEAR),
    end_date = DATE_SUB(end_date, INTERVAL 1 YEAR)
WHERE YEAR(start_date) = 2026;
```

**Backend Fix (if date parsing issue):**
Check `backend/src/modules/leave/*.ts` for date parsing logic.
Ensure using `new Date().getFullYear()` not hardcoded 2026.

### 7. Reports & Analytics Blank Data
**Files to Check:**
- `backend/src/modules/reports/*.ts`
- `src/pages/Reports.tsx`

**Debug Steps:**
1. Check API endpoint response:
```bash
curl -X GET http://localhost:3002/api/reports/analytics \
  -H "Authorization: Bearer YOUR_TOKEN"
```

2. Check database queries return data:
```sql
SELECT COUNT(*) FROM employees;
SELECT COUNT(*) FROM attendance_logs;
SELECT COUNT(*) FROM leave_requests;
```

3. Common Issues:
   - Missing JOIN conditions
   - Empty filter conditions returning no rows
   - Date range issues

**Likely Fix:**
```typescript
// In reports service, check for:
const filters = {
  startDate: req.query.startDate || getDefaultStartDate(),  // ADD DEFAULT
  endDate: req.query.endDate || new Date(),  // ADD DEFAULT
};
```

### 8. Employee Report Filter Not Showing All Names
**File:** `src/pages/EmployeeReport.tsx` (or similar)

**Issue:** Filter dropdown not populated or routing broken

**Frontend Fix:**
```typescript
// Check useQuery for employees list
const { data: employees } = useQuery({
  queryKey: ['all-employees'],
  queryFn: async () => {
    const response = await hrmsApi.get('/api/employees');  // Check this endpoint
    return response.data;
  },
});

// Ensure Select is populated:
<Select onValueChange={(value) => navigate(`/employee-report/${value}`)}>
  {employees?.map(emp => (
    <SelectItem key={emp.id} value={emp.id}>
      {emp.first_name} {emp.last_name}
    </SelectItem>
  ))}
</Select>
```

**Backend Fix (if employees not returned):**
```typescript
// In employee controller:
export async function getAllEmployees(req, res) {
  const employees = await db.query(`
    SELECT id, first_name, last_name, employee_code, email, designation
    FROM employees
    WHERE status = 'active'  // Check this condition
    ORDER BY first_name
  `);
  res.json({ success: true, data: employees });
}
```

### 9. Super Admin Dashboard Graphs Not Aligned
**File:** `src/pages/SuperAdminDashboard.tsx` or similar

**Fix:** Apply responsive grid and proper sizing

```typescript
// Replace existing graph grid with:
<div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
  <Card className="md:col-span-2 xl:col-span-2">
    {/* Large graph - Employee Growth */}
    <ResponsiveContainer width="100%" height={350}>
      <LineChart data={growthData}>
        {/* ... */}
      </LineChart>
    </ResponsiveContainer>
  </Card>
  
  <Card>
    {/* Smaller graph - Department Distribution */}
    <ResponsiveContainer width="100%" height={350}>
      <PieChart data={deptData}>
        {/* ... */}
      </LineChart>
    </ResponsiveContainer>
  </Card>
</div>
```

### 10. Attendance Sync to hr_mas Table
**Migration Needed:**

```sql
-- backend/sql/XXX_sync_attendance_to_hr_mas.sql

-- 1. Ensure hr_mas.attendance_logs table exists
CREATE TABLE IF NOT EXISTS hr_mas.attendance_logs (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  clock_in DATETIME NOT NULL,
  clock_out DATETIME,
  work_hours DECIMAL(5,2),
  date DATE NOT NULL,
  status ENUM('present', 'absent', 'half_day', 'late') DEFAULT 'present',
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_employee_date (employee_id, date),
  INDEX idx_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Sync existing data
INSERT INTO hr_mas.attendance_logs 
  (id, employee_id, clock_in, clock_out, work_hours, date, status, synced_at)
SELECT 
  id, employee_id, clock_in, clock_out, 
  TIMESTAMPDIFF(MINUTE, clock_in, clock_out) / 60 as work_hours,
  DATE(clock_in) as date,
  status,
  NOW()
FROM Shivamgiri.attendance_logs
WHERE DATE(clock_in) >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)  -- Last 90 days
ON DUPLICATE KEY UPDATE
  clock_out = VALUES(clock_out),
  work_hours = VALUES(work_hours),
  status = VALUES(status),
  synced_at = NOW();

-- 3. Create trigger for ongoing sync
DELIMITER $$
CREATE TRIGGER after_attendance_insert
AFTER INSERT ON Shivamgiri.attendance_logs
FOR EACH ROW
BEGIN
  INSERT INTO hr_mas.attendance_logs 
    (id, employee_id, clock_in, clock_out, work_hours, date, status)
  VALUES (
    NEW.id, NEW.employee_id, NEW.clock_in, NEW.clock_out,
    TIMESTAMPDIFF(MINUTE, NEW.clock_in, NEW.clock_out) / 60,
    DATE(NEW.clock_in), NEW.status
  );
END$$

CREATE TRIGGER after_attendance_update
AFTER UPDATE ON Shivamgiri.attendance_logs
FOR EACH ROW
BEGIN
  UPDATE hr_mas.attendance_logs
  SET 
    clock_out = NEW.clock_out,
    work_hours = TIMESTAMPDIFF(MINUTE, NEW.clock_in, NEW.clock_out) / 60,
    status = NEW.status,
    synced_at = NOW()
  WHERE id = NEW.id;
END$$
DELIMITER ;
```

---

## 📋 **EXECUTION CHECKLIST**

### Frontend (Can be done immediately):
- [x] Profile DOB display - FIXED ✅
- [ ] Payslip redesign - Apply changes to masCallnetPayslipGenerator.ts
- [ ] Work Inbox modern layout
- [ ] Attendance page - remove clock, add detailed view

### Backend (Requires database access):
- [ ] Run engagement tables migration (SQL 038)
- [ ] Fix leave 2026 dates
- [ ] Debug Reports & Analytics endpoints
- [ ] Fix Employee Report filter API
- [ ] Realign Dashboard graphs (frontend + data)
- [ ] Run attendance sync migration

---

## 🚀 **NEXT STEPS**

1. **Commit Profile DOB Fix:**
   ```bash
   git add src/pages/Profile.tsx
   git commit -m "fix: Profile DOB display timezone issue"
   ```

2. **Apply Payslip Changes:**
   - Update `src/lib/masCallnetPayslipGenerator.ts` with exact template specs above
   - Test download with real data
   - Ensure CTC removed from PDF (keep in portal only)

3. **Backend Fixes:**
   - Run SQL migrations on database
   - Test each API endpoint
   - Verify data corrections

4. **Test Everything:**
   - Profile → Check DOB shows correctly
   - Payslips → Download and verify exact template match
   - Work Inbox → Check new design
   - Attendance → Verify detailed view without clock buttons
   - Reports → Verify data appears
   - Admin Dashboard → Check graph alignment

---

**Document Version:** 1.0  
**Last Updated:** 2026-06-14
