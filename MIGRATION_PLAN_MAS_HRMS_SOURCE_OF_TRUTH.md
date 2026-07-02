# Migration Plan: mas_hrms as Source of Truth

**Date**: 2026-06-12  
**Current Phase**: Phase 1 - db_bill → mas_hrms sync (ACTIVE)  
**Target Phase**: Phase 2 - mas_hrms = Source of Truth (FUTURE)

---

## 📋 **Executive Summary**

### **Current State (Phase 1)**
```
db_bill (14.97.30.236)                   mas_hrms (122.184.128.90)
   ├── Salary data entered           ──────→  ├── Synced daily
   ├── Manual payroll processing              ├── HRMS application
   └── Source of truth (CURRENT)              └── Read-only replica
```

**Issue**: Dual data entry, manual process, sync delays

### **Target State (Phase 2)**
```
mas_hrms (122.184.128.90)                db_bill (14.97.30.236)
   ├── Salary data entered           ──────→  ├── Legacy archive
   ├── Automated payroll processing           ├── Historical reference
   └── Source of truth (FUTURE)               └── Sync DISABLED
```

**Benefit**: Single source of truth, automated, real-time, no sync needed

---

## 🎯 **Migration Objectives**

1. **Eliminate dual data entry** - HR enters salary data once (in mas_hrms)
2. **Remove sync dependency** - No more db_bill → mas_hrms sync
3. **Enable real-time payroll** - Instant payslip availability
4. **Reduce manual work** - Automated salary processing
5. **Improve data accuracy** - Single source eliminates inconsistency

---

## 📊 **Current Sync Status**

### **Auto-Sync Configuration**

**Schedule**: Daily at 2:00 AM  
**Mode**: Delta sync (last 2 months)  
**Status**: ✅ ENABLED  
**Toggle File**: `/home/shuvam/hrms-audit/scripts/.sync-enabled`

**Disable Command**:
```bash
rm /home/shuvam/hrms-audit/scripts/.sync-enabled
```

**Enable Command**:
```bash
touch /home/shuvam/hrms-audit/scripts/.sync-enabled
```

---

## 🗺️ **Migration Phases**

### **Phase 1: Dual System (CURRENT) - Duration: 3-6 months**

**Period**: June 2026 - Dec 2026  
**Status**: ✅ **IN PROGRESS**

**Activities**:
1. ✅ db_bill continues as primary entry point
2. ✅ Auto-sync runs daily (db_bill → mas_hrms)
3. ✅ mas_hrms used for employee self-service only
4. ✅ HR team validates mas_hrms accuracy
5. ✅ Parallel data verification

**Sync Settings**:
- **Enabled**: YES
- **Frequency**: Daily
- **Direction**: db_bill → mas_hrms (ONE WAY)

**Success Criteria**:
- [ ] 3+ months of stable sync (0% failures)
- [ ] Data accuracy verified (100% match)
- [ ] All employees can view payslips in mas_hrms
- [ ] HR team comfortable with mas_hrms interface
- [ ] No sync-related issues reported

---

### **Phase 2: Parallel Entry (TRANSITION) - Duration: 2-3 months**

**Period**: Jan 2027 - Mar 2027  
**Status**: ⏳ **PENDING**

**Activities**:
1. Train HR team on mas_hrms payroll module
2. Set up salary processing workflows in mas_hrms
3. Enter NEW salaries in BOTH systems (parallel validation)
4. Compare outputs monthly (mas_hrms vs db_bill)
5. Document any discrepancies and fix

**Sync Settings**:
- **Enabled**: YES (still syncing db_bill → mas_hrms for old data)
- **Frequency**: Daily
- **Direction**: db_bill → mas_hrms (ONE WAY)
- **New Data**: Entered in BOTH systems

**Success Criteria**:
- [ ] HR team trained on mas_hrms
- [ ] 2+ months of parallel entry (100% match)
- [ ] Workflow automation tested
- [ ] Approval processes working
- [ ] Reports generation verified

---

### **Phase 3: mas_hrms Primary (CUTOVER) - Duration: 1 month**

**Period**: Apr 2027  
**Status**: ⏳ **PENDING**

**Activities**:
1. **CUTOVER DATE**: April 1, 2027 (start of financial year Q1)
2. Stop entering salary data in db_bill
3. mas_hrms becomes primary salary entry system
4. Keep sync ENABLED for 1 month (safety net)
5. Monitor for any issues

**Sync Settings**:
- **Enabled**: YES (safety net only)
- **Frequency**: Daily
- **Direction**: db_bill → mas_hrms (ONE WAY)
- **Note**: db_bill has NO new data (so sync does nothing)

**Success Criteria**:
- [ ] All April salary processing done in mas_hrms
- [ ] No db_bill entries for April
- [ ] Payslips generated correctly
- [ ] No employee complaints
- [ ] HR workflow smooth

---

### **Phase 4: mas_hrms Source of Truth (FINAL) - Duration: Ongoing**

**Period**: May 2027 onwards  
**Status**: ⏳ **PENDING**

**Activities**:
1. **DISABLE SYNC** - Remove `.sync-enabled` file
2. Archive db_bill salary data (historical reference only)
3. Update all integrations to use mas_hrms
4. Set db_bill to read-only mode
5. Celebrate! 🎉

**Sync Settings**:
- **Enabled**: ❌ **NO** (sync disabled permanently)
- **Direction**: N/A (no sync)
- **db_bill Status**: Read-only archive

**Success Criteria**:
- [x] Sync disabled (`.sync-enabled` removed)
- [ ] 1+ month of mas_hrms-only operation
- [ ] No sync-related issues
- [ ] HR team confident
- [ ] Employees satisfied
- [ ] Data integrity maintained

---

## 🔧 **Technical Implementation**

### **Current Sync Architecture**

```bash
# Cron job (runs daily at 2:00 AM)
/home/shuvam/hrms-audit/scripts/run-sync-cron.sh

# Script checks for toggle file
if [ -f .sync-enabled ]; then
    # Run sync
    node db_bill-to-mas_hrms-salary-sync.js --mode=delta --months=2
else
    # Sync disabled - exit
    echo "Sync DISABLED - mas_hrms is source of truth"
    exit 0
fi
```

### **How to Disable Sync (Phase 4)**

```bash
# Step 1: Remove toggle file
rm /home/shuvam/hrms-audit/scripts/.sync-enabled

# Step 2: Verify sync is disabled
tail -f /home/shuvam/hrms-audit/scripts/logs/sync-auto-*.log
# Should see: "Sync DISABLED - mas_hrms is now source of truth"

# Step 3: Optional - Remove cron job
crontab -e
# Comment out or remove the line containing "run-sync-cron.sh"
```

### **How to Re-enable Sync (If Needed)**

```bash
# Emergency rollback only!
touch /home/shuvam/hrms-audit/scripts/.sync-enabled

# Manual sync
/home/shuvam/hrms-audit/scripts/run-sync-cron.sh

# Verify sync is working
tail -f /home/shuvam/hrms-audit/scripts/logs/sync-auto-*.log
```

---

## 📋 **Migration Checklist**

### **Phase 1: Dual System (Current)**

#### Setup
- [x] Auto-sync cron job configured
- [x] Daily sync running (2:00 AM)
- [x] Log rotation setup
- [x] Sync enabled (`.sync-enabled` exists)
- [x] Historical data synced (12+ months)

#### Monitoring
- [ ] Check sync logs weekly
- [ ] Verify data accuracy monthly
- [ ] Track sync failures (target: 0%)
- [ ] Employee feedback collection
- [ ] HR team satisfaction survey

#### Validation
- [ ] 3+ months stable operation
- [ ] 100% sync success rate
- [ ] 0 data discrepancies
- [ ] All employees able to view payslips
- [ ] PDF download working for all

---

### **Phase 2: Parallel Entry (Transition)**

#### Training
- [ ] HR team trained on mas_hrms payroll module
- [ ] Documentation created (user guides)
- [ ] Test salary runs completed
- [ ] Approval workflows tested
- [ ] Reports generation verified

#### Implementation
- [ ] New salary entry process in mas_hrms
- [ ] Parallel entry in both systems
- [ ] Monthly comparison (mas_hrms vs db_bill)
- [ ] Discrepancy resolution process
- [ ] Workflow automation tested

#### Validation
- [ ] 2+ months parallel entry
- [ ] 100% match between systems
- [ ] No workflow issues
- [ ] HR team confident
- [ ] Management approval obtained

---

### **Phase 3: Cutover (Primary Switch)**

#### Preparation
- [ ] Cutover date announced (April 1, 2027)
- [ ] Final training session conducted
- [ ] Backup procedures tested
- [ ] Rollback plan documented
- [ ] Support team on standby

#### Execution (April 1, 2027)
- [ ] Stop db_bill salary entry
- [ ] All April salaries in mas_hrms only
- [ ] Sync still enabled (safety net)
- [ ] Daily monitoring for issues
- [ ] HR support hotline active

#### Validation
- [ ] 1 month mas_hrms-only operation
- [ ] All payslips generated correctly
- [ ] No employee complaints
- [ ] No sync-related issues
- [ ] HR workflow smooth

---

### **Phase 4: Final State (Source of Truth)**

#### Implementation
- [ ] Remove `.sync-enabled` file
- [ ] Verify sync disabled in logs
- [ ] Update all integrations
- [ ] Set db_bill to read-only
- [ ] Archive db_bill data

#### Verification
- [ ] Sync no longer running
- [ ] mas_hrms as primary source
- [ ] All reports using mas_hrms
- [ ] No db_bill dependencies
- [ ] Integration tests passed

#### Cleanup
- [ ] Document final architecture
- [ ] Update SOPs for HR team
- [ ] Archive migration documentation
- [ ] Celebrate success! 🎉

---

## 🚨 **Rollback Plan**

### **If Issues Arise in Phase 3/4**

**Scenario**: Critical issues found after disabling sync

**Action Plan**:

1. **Immediate Rollback** (< 1 hour)
   ```bash
   # Re-enable sync
   touch /home/shuvam/hrms-audit/scripts/.sync-enabled
   
   # Run manual full sync
   cd /home/shuvam/hrms-audit/scripts
   node db_bill-to-mas_hrms-salary-sync.js --mode=full
   ```

2. **Communicate**
   - Notify HR team
   - Inform employees (if affected)
   - Document issue

3. **Investigate**
   - Review logs
   - Identify root cause
   - Fix underlying issue

4. **Re-attempt**
   - Test fix thoroughly
   - Plan new cutover date
   - Execute with caution

---

## 📊 **Success Metrics**

### **Phase 1 (Current)**

| Metric | Target | Current |
|--------|--------|---------|
| Sync Success Rate | > 99% | Monitoring |
| Data Accuracy | 100% | Monitoring |
| Employee Satisfaction | > 90% | TBD |
| HR Team Confidence | High | TBD |

### **Phase 2 (Transition)**

| Metric | Target | Status |
|--------|--------|--------|
| Training Completion | 100% HR staff | Pending |
| Parallel Entry Accuracy | 100% match | Pending |
| Workflow Test Success | 100% | Pending |
| Discrepancy Rate | < 1% | Pending |

### **Phase 3 (Cutover)**

| Metric | Target | Status |
|--------|--------|--------|
| April Payroll Success | 100% | Pending |
| Employee Complaints | 0 | Pending |
| HR Workflow Issues | 0 | Pending |
| Payslip Generation Time | < 1 min | Pending |

### **Phase 4 (Final)**

| Metric | Target | Status |
|--------|--------|--------|
| Sync Disabled | YES | Pending |
| mas_hrms Uptime | > 99.9% | Pending |
| Data Integrity | 100% | Pending |
| HR Efficiency Gain | > 50% | Pending |

---

## 📞 **Support & Contact**

### **Phase 1-2 (Sync Issues)**
- Check sync logs: `/home/shuvam/hrms-audit/scripts/logs/`
- Manual sync: `run-sync-cron.sh`
- Re-enable: `touch .sync-enabled`

### **Phase 3-4 (mas_hrms Issues)**
- HRMS support: admin@teammas.in
- Technical support: dev@teammas.in
- Escalation: Management team

### **Emergency Contacts**
- HR Head: [Name] - [Phone]
- IT Head: [Name] - [Phone]
- Project Owner: Shivam - [Phone]

---

## 📚 **Related Documentation**

1. **DB_BILL_SALARY_SYNC_COMPLETE.md** - Sync system documentation
2. **COMPREHENSIVE_AUDIT_FINAL_REPORT.md** - Complete audit report
3. **FIX_SUMMARY_PAYSLIP_COMPONENT_BREAKDOWN.md** - Payslip fixes
4. **TESTING_GUIDE_AND_NAVIGATION_AUDIT.md** - Testing procedures

---

## 🎯 **Timeline Summary**

```
Jun 2026         Dec 2026         Mar 2027         Apr 2027         May 2027+
   │                │                │                │                │
   │◄───Phase 1────►│◄───Phase 2────►│◄──Phase 3────►│◄───Phase 4────►
   │                │                │                │                │
   │  Dual System   │  Parallel      │   Cutover     │   mas_hrms    │
   │  (Current)     │   Entry        │   (Primary)   │   Source of   │
   │                │                │                │   Truth       │
   │  Sync: ON      │  Sync: ON      │  Sync: ON     │  Sync: OFF    │
   │  db_bill → mas │  Both systems  │  mas_hrms →   │  mas_hrms =   │
   │                │                │  db_bill off  │  PRIMARY      │
```

**Total Migration Duration**: ~12 months  
**Current Phase**: Phase 1 (Month 1)  
**Expected Completion**: May 2027

---

## 📝 **Change Log**

| Date | Phase | Action | By |
|------|-------|--------|-----|
| 2026-06-12 | Phase 1 | Auto-sync enabled | Claude |
| 2026-06-12 | Phase 1 | Migration plan created | Claude |
| 2027-04-01 | Phase 3 | Cutover to mas_hrms | Planned |
| 2027-05-01 | Phase 4 | Sync disabled | Planned |

---

**Status**: ✅ **Phase 1 Active - Auto-sync running daily**

**Next Milestone**: Complete 3 months of stable sync operation (September 2026)

**Action Required**: Monitor sync logs weekly, validate data accuracy monthly

---

**Generated**: 2026-06-12  
**Auto-Sync Script**: `/home/shuvam/hrms-audit/scripts/run-sync-cron.sh`  
**Setup Script**: `/home/shuvam/hrms-audit/scripts/setup-auto-sync-cron.sh`  
**Toggle File**: `/home/shuvam/hrms-audit/scripts/.sync-enabled`
