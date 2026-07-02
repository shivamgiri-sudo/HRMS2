# HRMS1 TODO Audit Report

**Generated:** 2026-06-18  
**Total TODOs:** 36  

## 🔴 CRITICAL - Fix Immediately (4 items)

### 1. Offer Letter PDF Not Persisted
**File:** `backend/src/modules/ats/offer-letter.service.ts:147`  
**Issue:** `// TODO: Save PDF to storage (S3/local)`  
**Impact:** Offer letter PDFs are generated but never saved. Lost on server restart.  
**Fix:** Integrate with Supabase Storage or local filesystem.

### 2. Offer Letter Email Not Sent
**File:** `backend/src/modules/ats/offer-letter.service.ts:331`  
**Issue:** `// TODO: Send actual email with PDF attachment`  
**Impact:** Candidates never receive offer letters via email. UI shows "sent" but nothing happens.  
**Fix:** Integrate with existing email service (nodemailer).

### 3. Quality Import Non-Functional (5 locations)
**Files:** `backend/src/modules/performance-feedback/quality-aggregator.service.ts:43,58,146,173,201`  
**Issue:** `// TODO: Implement Google Sheets API integration`, `// TODO: Implement Excel parsing`, `// TODO: Implement sync logic`  
**Impact:** Quality score import feature is a stub. Buttons exist but do nothing.  
**Fix:** Either implement the features or remove the UI buttons.

### 4. Resume Parsing Broken
**File:** `backend/src/modules/ats/registration.enhanced.routes.ts:218`  
**Issue:** `// TODO: Integrate actual resume parsing library`  
**Impact:** Resume upload works but no data extraction happens.  
**Fix:** Integrate a resume parsing library or API.

---

## 🟡 IMPORTANT - Schedule in Sprint (2 items)

### 5. Analytics Missing Old System Data
**File:** `backend/src/modules/ats/analytics.unified.service.ts:83`  
**Issue:** `// TODO: Add old system data query when schema is known`  
**Impact:** ATS analytics only show current system data. Historical trends incomplete.  
**Fix:** Once legacy schema is documented, add the query.

### 6. Queue Token Format Placeholder
**File:** `backend/src/modules/ats/ats.service.ts:185`  
**Issue:** Comment says "format: WI-YYYYMMDD-XXXX" but implementation works  
**Impact:** None - code works, comment is just a note.  
**Fix:** Verify format matches spec, remove TODO.

---

## 🟢 LOW PRIORITY - Backlog (30 items)

### Column Name Alignment (4 items)
- `analytics.unified.service.ts:12,14,15` - Update table/column names when schema finalized
- Code works with current schema, TODOs are reminders for future alignment.

### Self-Scope Authorization (3 items)
- `kpi.routes.ts:45,66,69` - Add employee self-scope checks
- Currently admin/manager only. Adding self-scope allows employees to view own KPIs.
- Not a security issue, just a feature gap.

### Control Tower Scope Matching (1 item)
- `control-tower.service.ts:91` - Implement scope record matching
- Feature exists in placeholder form, needs full implementation.

### Peak Month Calculation (1 item)
- `analytics.unified.service.ts:205` - Calculate peak hiring months from data
- Currently returns hardcoded values. Works but not dynamic.

### Cost Per Hire Tracking (1 item)
- `analytics.unified.service.ts:105` - Add when cost data available
- Requires cost tracking feature to be implemented first.

### Employee Detail Self-Scope (1 item)
- `employee.routes.ts:403` - Add self-scope check for GET /:id
- Currently requires manager role. Should allow employee to view own profile.

### All Other TODOs (19 items)
- PII masking placeholders (already working)
- Form link configuration
- Demo data references  
- Legacy mapping notes

---

## Recommendations

1. **This Sprint:** Fix the 4 critical TODOs (offer letters, quality import, resume parsing)
2. **Next Sprint:** Address the 2 important items (analytics, self-scope features)
3. **Backlog:** 30 low-priority items can wait until their parent features are prioritized

**Estimated effort:**
- Critical fixes: 2-3 days  
- Important items: 1 day
- Backlog: ongoing as features mature
