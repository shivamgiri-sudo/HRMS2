# Integration Roadmap - Updated Priority Order

**Date**: 2026-06-04  
**Status**: Payroll Compliance Pack → Next Priority

---

## ✅ COMPLETED INTEGRATIONS

### 1. ✅ Auto-Roster Synced V2 (COMPLETE)
- **Duration**: 35 minutes
- **Status**: Production ready
- **Tables**: 10 tables
- **Features**: PM approval workflow, coverage matrix

### 2. ✅ Scope Governance (100% COMPLETE)
- **Duration**: 6 hours (Phases 4-9)
- **Status**: Production ready
- **Modules**: 7/7 modules secured
- **Features**: Backend scope enforcement, 90% data exposure reduction

### 3. ✅ Service Layer Integration (100% COMPLETE)
- **Duration**: 1.5 hours
- **Status**: Production ready
- **Services**: Employees, ATS, Payroll all with scopeFilter

### 4. ✅ Control Tower (COMPLETE)
- **Duration**: 1 hour
- **Status**: Production ready
- **Tables**: 4 tables
- **Features**: Unified inbox, event feed, risk register

### 5. ✅ Corrections Package (ANALYZED)
- **Duration**: 1 hour analysis
- **Status**: Control Tower extracted and integrated
- **Result**: 70% overlap, 30% new (already integrated)

---

## 🎯 CURRENT PRIORITY

### NEXT: Payroll Compliance Pack (India Statutory)
- **Priority**: 🔴 **CRITICAL**
- **Effort**: 6-7 hours
- **Start**: NOW (user approved)
- **Risk**: Medium (file merge conflicts)
- **Value**: Critical for production payroll

**Contents**:
- 14 new tables
- 7 statutory registers
- Tax engine (centralized)
- FY-wise tax slabs
- PT state-wise slabs
- Manual adjustment with audit
- DPDP compliance logging

**Critical Features**:
1. Preserve existing employee salary breakups
2. FY 2025-26 & 2026-27 tax slabs seeded
3. PT slab missing blocks calculation (not silent ₹200)
4. Manual adjustment audit trail
5. Compliance validation gate
6. Salary/PF/ESIC/PT/TDS/Bank/Variance registers

---

## ⏭️ DEFERRED (Option B Confirmed)

### DEFERRED: ATS Full Parity Pack V2
- **Priority**: 🟡 **MEDIUM-HIGH** (after payroll)
- **Effort**: 6-7 hours
- **Reason for Deferral**: Don't interrupt payroll integration flow
- **Timing**: After payroll compliance complete

**Why Deferred**:
- Payroll is more critical (legal compliance)
- ATS parity can wait 1 week
- Allows testing of current scope guard pattern first
- Gives time to validate service layer updates

**Contents** (when ready):
- 18 new tables
- 70+ columns to ats_candidate
- Command center dashboard
- 4 scheduled jobs
- Google Sheets → MySQL migration

---

## 📅 EXECUTION PLAN

### Phase A: Payroll Compliance Integration (TODAY/THIS WEEK)

**Duration**: 6-7 hours

**Steps**:
1. ✅ Analysis complete (already done)
2. ⏭️ Backup database
3. ⏭️ Apply migration 114
4. ⏭️ Copy new files (taxEngine, payrollCompliance services)
5. ⏭️ Merge enhanced files (CAREFUL - retain scope guards!)
6. ⏭️ Add scope guards to payrollCompliance.routes.ts
7. ⏭️ Update app.ts (mount /api/payroll-compliance)
8. ⏭️ Seed PT slabs for all states
9. ⏭️ Migrate existing employee data
10. ⏭️ Test compliance center
11. ⏭️ Test registers generation
12. ⏭️ Deploy to staging

---

### Phase B: ATS Full Parity Integration (NEXT WEEK)

**Duration**: 6-7 hours

**Steps**:
1. ✅ Analysis complete (already done)
2. ⏭️ Backup ats_candidate table
3. ⏭️ Apply migration 117
4. ⏭️ Copy atsFullParity services
5. ⏭️ Add scope guards to ALL new routes
6. ⏭️ Add scopeFilter pattern to service
7. ⏭️ Copy command center page
8. ⏭️ Setup 4 cron jobs
9. ⏭️ Test workflows
10. ⏭️ Deploy to staging

---

### Phase C: Testing & Deployment (ONGOING)

**Duration**: 2-3 hours (parallel with integrations)

**Activities**:
1. ⏭️ Run Phase 10 test script (22 scenarios)
2. ⏭️ Test with real users
3. ⏭️ Monitor 403 errors
4. ⏭️ Validate scope filtering
5. ⏭️ Performance profiling

---

## 🎯 MILESTONES

### Milestone 1: Payroll Compliance ✅ (Target: This Week)
- [ ] Migration 114 applied
- [ ] Tax engine integrated
- [ ] 7 registers working
- [ ] PT slabs seeded
- [ ] Compliance center deployed

### Milestone 2: ATS Full Parity ✅ (Target: Next Week)
- [ ] Migration 117 applied
- [ ] Command center deployed
- [ ] 4 cron jobs running
- [ ] Google Sheets eliminated

### Milestone 3: Production Deployment ✅ (Target: 2 weeks)
- [ ] All integrations complete
- [ ] Full test suite passed
- [ ] User acceptance testing done
- [ ] Production deployment

---

## 📊 CURRENT STATUS

### Completed:
- ✅ Scope guards (7 modules)
- ✅ Service layer (3 services)
- ✅ Auto-roster (production ready)
- ✅ Control tower (production ready)

### In Progress:
- 🔄 **Payroll Compliance** (starting now)

### Upcoming:
- ⏭️ ATS Full Parity (next week)
- ⏭️ Readiness Engine (future)
- ⏭️ Phase 10 Testing (parallel)

---

## 🚀 IMMEDIATE NEXT STEPS

1. **Start Payroll Compliance Integration** (NOW)
   - Backup database
   - Apply migration 114
   - Begin file integration

2. **Document Progress**
   - Update roadmap as tasks complete
   - Commit after each phase
   - Push to GitHub regularly

3. **Test Continuously**
   - Validate each component
   - Test with real data
   - Monitor for issues

---

## 💡 DECISION RATIONALE

### Why Payroll First?
1. **Legal Compliance** - Mandatory for production payroll
2. **Critical Path** - Blocks go-live if missing
3. **Momentum** - Continue current integration flow
4. **Risk Management** - Test one major package at a time

### Why ATS Second?
1. **Less Critical** - Operations can continue with current ATS
2. **Complexity** - Requires scope guard pattern validation first
3. **Testing Time** - Service layer updates need validation
4. **Dependencies** - Benefits from payroll learnings

---

## 📅 TIMELINE SUMMARY

**Week 1 (Current)**:
- Mon-Tue: Scope governance (DONE ✅)
- Wed-Thu: Service layer (DONE ✅)
- Thu-Fri: Payroll compliance (IN PROGRESS 🔄)

**Week 2 (Next)**:
- Mon-Tue: ATS full parity
- Wed-Thu: Testing & validation
- Fri: Production deployment prep

**Week 3 (Future)**:
- Production deployment
- Monitoring & optimization
- Readiness engine integration

---

## 🏆 SUCCESS CRITERIA

### Payroll Integration Success:
- ✅ All 14 tables created
- ✅ Tax engine calculating correctly
- ✅ 7 registers generating
- ✅ PT slabs working (no silent ₹200)
- ✅ Compliance gate validating
- ✅ Scope guards applied

### ATS Integration Success:
- ✅ All 18 tables created
- ✅ ats_candidate extended safely
- ✅ Command center working
- ✅ 4 cron jobs running
- ✅ Scope guards applied
- ✅ Google Sheets eliminated

---

**Current Focus**: 🎯 **PAYROLL COMPLIANCE PACK INTEGRATION**

**Status**: Ready to begin
**Next Action**: Backup database and start Phase 1
