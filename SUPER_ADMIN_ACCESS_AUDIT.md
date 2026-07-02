# Super Admin Access Audit Report
**Generated:** 2026-06-30  
**Project:** MAS Callnet PeopleOS / HRMS  
**Audit Scope:** Complete route-level access verification for `super_admin` role

---

## Executive Summary

✅ **RESULT: Super Admin has FULL access to all pages**

The `super_admin` role has **universal bypass privileges** across the entire application through two mechanisms:

1. **Gate-based pages** - Bypassed via `useWorkforceAccess.canViewPage()` (line 174, `useUserRole.ts`)
2. **Role-restricted pages** - Bypassed via `ProtectedRoute` component (line 45, `ProtectedRoute.tsx`)

---

## Access Mechanism Details

### 1. Gate-Based Access (WorkforcePageGate)
**File:** `src/hooks/useUserRole.ts:171-174`

```typescript
const isSuperAdmin = roleKeys.includes("super_admin");
return {
  canViewPage: (pageCode: string) => isSuperAdmin || pageSet.has(pageCode),
  // ✅ super_admin bypasses page permission checks
```

**Pages protected:** All routes wrapped with `<Gate pageCode="...">`

### 2. Role-Based Access (ProtectedRoute)
**File:** `src/components/auth/ProtectedRoute.tsx:45`

```typescript
const hasRequiredRole = roleKeys.includes("super_admin") || roles.some((r) => roleKeys.includes(r));
// ✅ super_admin bypasses explicit role requirements
```

**Pages protected:** All routes with `<ProtectedRoute roles={[...]}>`

---

## Complete Route Inventory

### ✅ Public / Auth Routes (No restriction)
| Path | Page | Access |
|------|------|--------|
| `/auth`, `/login` | Auth | Public |
| `/reset-password` | ResetPassword | Public |
| `/onboard` | CandidateOnboardingPage | Public |
| `/interview-registration` | NativeATSCandidateRegistration | Public |
| `/onboard-full` | CandidateOnboardingFullPage | Public |
| `/candidate-portal/login` | CandidatePortalLogin | Public |
| `/candidate-portal/dashboard` | CandidatePortalDashboard | Public |
| `/portal/login` | PortalLogin | Public |

---

### ✅ Gate-Protected Pages (super_admin bypasses)
**Total:** 95+ pages using `<Gate pageCode="...">`

| Page Code | Route | Component |
|-----------|-------|-----------|
| `EMPLOYEE_MANAGEMENT` | `/employees` | Employees |
| `EMPLOYEE_MANAGEMENT` | `/employees/:id` | NativeEmployeeStatCard |
| `EMPLOYEE_MANAGEMENT` | `/employees/:id/360` | NativeEmployee360 |
| `PAYROLL` | `/payroll` | Payroll |
| `ATTENDANCE_REGULARIZATION` | `/attendance-regularization` | AttendanceRegularization |
| `ORG_MASTERS` | `/departments` | Departments |
| `ATS_DASHBOARD` | `/ats/dashboard` | NativeATSDashboardReplica |
| `ATS_RECRUITER_QUEUE` | `/ats/recruiter/my-candidates` | NativeATSRecruiterWorkspace |
| `ATS_ONBOARDING_BRIDGE` | `/ats/onboarding-bridge` | NativeATSOnboardingBridge |
| `ATS_WAITING_QUEUE` | `/ats/waiting-queue` | NativeATSWaitingQueue |
| `ATS_CANDIDATE_MASTER` | `/ats/candidate-master` | NativeATSCandidateMaster |
| `ATS_RECRUITER_WORKSPACE` | `/ats/recruiter/workspace` | NativeATSRecruiterWorkspace |
| `ATS_DASHBOARD` | `/ats/dashboard-v2` | NativeATSDashboardV2 |
| `ATS_DASHBOARD` | `/ats/sourcing-analysis` | NativeATSSourcingAnalysis |
| `ATS_EXTENSIONS` | `/ats/extensions` | NativeATSExtensions |
| `ATS_DASHBOARD` | `/ats/command-center` | NativeATSFullParityCommandCenter |
| `ATS_ONBOARDING_BRIDGE` | `/ats/onboarding-requests` | NativeHROnboardingRequests |
| `ATS_OFFER_APPROVALS` | `/ats/offer-approvals` | NativeBranchHeadApproval |
| `ATS_BRANCH_HEAD_APPROVAL` | `/ats/branch-head-approval` | BranchHeadApproval |
| `ATS_PAYROLL_HR` | `/ats/payroll-hr` | NativePayrollHRValidation |
| `ATS_BGV` | `/ats/bgv` | NativeBGVVerificationCenter |
| `ATS_BGV_REPORT` | `/ats/bgv-report` | NativeBGVReport |
| `ATS_RECRUITER_PORTAL` | `/ats/recruiter-portal` | NativeRecruiterPortal |
| `ATS_WALKIN_QUEUE` | `/ats/walkin-queue` | NativeWalkinQueue |
| `PROVISIONING_WFM_ALIGNMENT` | `/provisioning/wfm-alignment` | NativeITProvisioningTracker |
| `PROVISIONING_IT` | `/provisioning/it` | NativeITProvisioningTracker |
| `PROVISIONING_ADMIN` | `/provisioning/admin` | NativeITProvisioningTracker |
| `PROVISIONING_APPOINTMENT_LETTER` | `/provisioning/appointment-letter` | NativeITProvisioningTracker |
| `LMS_MY_LEARNING` | `/lms/my-learning` | NativeLMSMyLearning |
| `LMS_COORDINATOR` | `/lms/coordinator` | NativeLMSCoordinator |
| `LMS_ADMIN` | `/lms/admin` | LMSIntegrationAdmin |
| `LMS_INTEGRATION` | `/lms/integration` | NativeLMSIntegration |
| `WFM_ROSTER` | `/wfm/roster` | NativeWFMRoster |
| `WFM_LIVE_TRACKER` | `/wfm/live-tracker` | NativeBiometricCommandCenter |
| `WFM_LIVE_TRACKER` | `/wfm/adherence-command-center` | NativeBiometricCommandCenter |
| `WFM_LIVE_TRACKER` | `/wfm/agent-attendance-view` | NativeBiometricCommandCenter |
| `WFM_LIVE_TRACKER` | `/wfm/attendance-exceptions` | NativeAttendanceExceptionEngine |
| `WFM_LIVE_TRACKER` | `/wfm/cosec-monitoring` | NativeCosecSyncMonitoring |
| `WFM_EXTENSIONS` | `/wfm/extensions` | NativeWFMExtensions |
| `WFM_ROSTER` | `/wfm-manager-approvals` | NativeWFMManagerApproval |
| `WFM_ROSTER` | `/roster-preference` | NativeRosterPreference |
| `QUALITY_DASHBOARD` | `/quality/dashboard` | NativeQualityDashboard |
| `OPERATIONS_DASHBOARD` | `/operations/dashboard` | NativeOperationsDashboard |
| `WORKFORCE_COMMAND_CENTER` | `/performance/command-center` | UnifiedPerformanceCommandCenter |
| `ACCESS_CONTROL` | `/settings/access-control` | UnifiedAccessControl |
| `IT_PROVISIONING_TRACKER` | `/it-provisioning` | NativeITProvisioningTracker |
| `EXIT_COMMAND_CENTER` | `/exit-management` | NativeExitManagement |
| `EXIT_COMMAND_CENTER` | `/exit/command-center` | NativeExitCommandCenter |
| `KPI_CONFIG` | `/kpi-config` | NativeKPIConfiguration |
| `OPERATIONS_KPI` | `/operations-kpi` | NativeOperationsKPI |
| `KPI_MASTER` | `/kpi-master` | KpiMasterConfig |
| `MY_KPI` | `/my-kpi` | MyKpiDashboard |
| `PORTAL_DATA_MANAGER` | `/portal-data-manager` | NativePortalDataManager |
| `PROCESS_CONFIG` | `/process-config` | NativeProcessConfig |
| `LEAVE_TYPES` | `/leave-types` | NativeLeaveTypeConfig |
| `ROSTER_MASTER` | `/roster-master-builder` | NativeRosterMasterBuilder |
| `ROSTER_MASTER` | `/roster-capacity-config` | NativeRosterCapacityConfig |
| `WFM_AUTO_ROSTER` | `/wfm/auto-roster` | NativeWFMAutoRoster |
| `WFM_AUTO_ROSTER` | `/workforce-planning` | NativeWorkforcePlanning |
| `RTA_BOARD` | `/rta-board` | NativeRTABoard |
| `ATS_OFFER` | `/offer-letter` | NativeOfferLetterGeneration |
| `EMPLOYEE_MANAGEMENT` | `/document-verification` | NativeDocumentVerification |
| `ASSETS_MANAGER` | `/assets-manager` | NativeAssetsManager |
| `HELPDESK` | `/helpdesk` | NativeHelpdesk |
| `SUPPORT_COMMAND_CENTER` | `/support/command-center` | NativeSupportCommandCenter |
| `GRIEVANCE_COMMAND_CENTER` | `/support/grievance-command-center` | NativeGrievanceCommandCenter |
| `LETTERS` | `/letters` | NativeLetters |
| `EMPLOYEE_LIFECYCLE` | `/employee-lifecycle` | NativeLifecycle |
| `EMPLOYEE_LIFECYCLE` | `/employee-lifecycle-v2` | NativeEmployeeLifecycle |
| `ORG_MASTERS` | `/org-masters` | NativeOrgMasters |
| `ORG_MASTERS` | `/org-masters/locations-policies` | NativeLocationPolicyMasters |
| `WORKFLOW_ADMIN` | `/workflow-admin` | NativeWorkflowAdmin |
| `MANAGEMENT_DASHBOARD` | `/management/dashboard` | NativeManagementDashboard |
| `BENEFITS` | `/benefits` | NativeBenefitsClaims |
| `CAREER_PLANNING` | `/career-planning` | NativeCareerPlanning |
| `ERP` | `/erp` | NativeERP |
| `WORK_INBOX` | `/work-inbox` | NativeWorkInbox |
| `MOBILITY` | `/mobility` | NativeMobilityManagement |
| `STATUTORY_COMPLIANCE` | `/compliance/statutory` | NativeStatutoryCompliance |
| `LABOUR_COMPLIANCE` | `/compliance/labour` | NativeLabourCompliance |
| `DPDP_COMPLIANCE` | `/compliance/dpdp` | NativeDPDPCompliance |
| `INTEGRATION_HUB` | `/integration-hub` | NativeIntegrationHub |
| `CLIENT_MASTER` | `/client-master` | EnhancedClientMaster |
| `CUSTOMIZATION_MANAGER` | `/customization` | NativeCustomizationManager |
| `CUSTOMIZATION_MANAGER` | `/customization/new` | NativeCustomizationRuleEditor |
| `CUSTOMIZATION_MANAGER` | `/customization/:id/edit` | NativeCustomizationRuleEditor |
| `PAYROLL_PAYSLIPS` | `/payroll/payslips` | NativePayslipCenter |
| `PAYROLL` | `/payroll/readiness` | NativePayrollReadiness |
| `TAX_DECLARATION` | `/payroll/tax-declaration` | NativeTaxDeclaration |
| `FULL_FINAL` | `/payroll/full-final` | NativeFullFinal |
| `STATUTORY_CONFIG` | `/payroll/statutory-config` | NativeStatutoryConfig |
| `PAYROLL_MASTERS` | `/payroll/masters` | NativePayrollMasters |
| `SALARY_PACKAGES` | `/payroll/salary-packages` | NativeSalaryPackages |
| `PAYROLL_INCENTIVES` | `/payroll/incentives` | NativeIncentives |
| `CEO_DASHBOARD` | `/ceo/dashboard` | CeoDashboard |
| `PAYROLL_HR_DASHBOARD` | `/payroll-hr/dashboard` | PayrollHrDashboard |
| `WFM_DASHBOARD` | `/wfm/dashboard` | WfmDashboard |
| `HR_DASHBOARD` | `/hr/dashboard` | HrDashboard |
| `EMPLOYEE_SELF_DASHBOARD` | `/my-dashboard` | EmployeeSelfDashboard |
| `DPDP_WITHDRAWAL` | `/privacy/dpdp-withdrawal` | NativeDPDPWithdrawal |
| `DPDP_WITHDRAWAL_ADMIN` | `/compliance/dpdp-withdrawal-admin` | NativeDPDPWithdrawalAdmin |
| `TAT_MATRIX` | `/governance/tat-matrix` | NativePlaceholderPage |
| `TAT_DASHBOARD` | `/governance/tat-dashboard` | NativePlaceholderPage |
| `NAME_CONSISTENCY_MATRIX` | `/ats/name-consistency` | NativePlaceholderPage |
| `APPOINTMENT_ESIGN` | `/letters/appointment-esign` | NativeAppointmentEsign |
| `RESIGNATION_MY_REQUEST` | `/exit/resignation` | NativeMyResignation |
| `RESIGNATION_COMMAND_CENTER` | `/exit/resignation-command-center` | NativePlaceholderPage |

**✅ All Gate pages:** super_admin has access via `isSuperAdmin` bypass

---

### ✅ Role-Restricted Pages (super_admin bypasses)
**Total:** 42 pages with explicit role requirements

| Route | Required Roles | Component | super_admin Access |
|-------|---------------|-----------|-------------------|
| `/change-password` | (any authenticated) | ChangePassword | ✅ Yes |
| `/two-factor` | (any authenticated) | TwoFactor | ✅ Yes |
| `/onboarding` | `admin`, `hr` | Onboarding | ✅ Yes (bypassed) |
| `/bulk-upload` | `admin`, `hr`, `super_admin`, `wfm`, `payroll`, `payroll_hr` | BulkUploadHub | ✅ Yes (explicit) |
| `/ats/form-config` | `admin`, `hr`, `super_admin` | NativeATSFormConfig | ✅ Yes (explicit) |
| `/ats/payroll-hr` | `admin`, `hr`, `payroll_hr` | NativePayrollHRValidation | ✅ Yes (bypassed) |
| `/ats/bgv-enhanced` | `admin`, `hr` | NativeBGVEnhanced | ✅ Yes (bypassed) |
| `/employees/reactivation` | `hr`, `admin`, `super_admin`, `branch_head`, `payroll_head` | NativeEmployeeReactivation | ✅ Yes (explicit) |
| `/employees/bgv-status/:employeeId` | `admin`, `hr`, `payroll`, `super_admin` | NativeEmployeeBGVStatus | ✅ Yes (explicit) |
| `/super-admin/module-access` | `admin` | SuperAdminModuleAccess | ✅ Yes (bypassed) |
| `/super-admin/dashboard` | `admin` | SuperAdminDashboardV2 | ✅ Yes (bypassed) |
| `/ats/command-centre` | `admin`, `manager`, `hr` | ATSCommandCentre | ✅ Yes (bypassed) |
| `/provisioning/wfm-alignment` | `wfm`, `admin`, `super_admin` | NativeITProvisioningTracker | ✅ Yes (explicit) |
| `/provisioning/it` | `it`, `admin`, `super_admin` | NativeITProvisioningTracker | ✅ Yes (explicit) |
| `/provisioning/admin` | `branch_admin`, `hr`, `admin`, `super_admin` | NativeITProvisioningTracker | ✅ Yes (explicit) |
| `/provisioning/appointment-letter` | `hr`, `admin`, `super_admin` | NativeITProvisioningTracker | ✅ Yes (explicit) |
| `/security-center` | `admin`, `ceo`, `coo`, `hr` | NativeSecurityCenter | ✅ Yes (bypassed) |
| `/super-admin/page-access` | `admin` | SuperAdminAccessControl | ✅ Yes (bypassed) |
| `/settings/call-centre-config` | `admin` | NativeCallCentreConfig | ✅ Yes (bypassed) |
| `/people-experience/command-center` | `admin`, `hr`, `ceo`, `coo`, `manager`, `process_manager`, `team_leader`, `tl`, `branch_head`, `employee` | NativePeopleExperienceCommandCenter | ✅ Yes (bypassed) |
| `/maternity-leave` | `admin`, `hr` | NativeMaternityLeave | ✅ Yes (bypassed) |
| `/finance/vendor-payment-tracking` | (any protected) | NativeVendorPaymentTracking | ✅ Yes |
| `/finance/grn` | (any protected) | NativeGRNManagement | ✅ Yes |
| `/payroll/ho-queues` | (any protected) | NativePayrollHOQueues | ✅ Yes |
| `/payroll/cheque-validation` | `payroll`, `payroll_head`, `super_admin`, `finance` | NativeChequeNameValidation | ✅ Yes (explicit) |
| `/payroll/package-admin` | `admin`, `super_admin`, `payroll` | NativeSalaryPackageAdmin | ✅ Yes (explicit) |
| `/payroll/overtime` | `admin`, `wfm` | PayrollOvertimeManagement | ✅ Yes (bypassed) |
| `/payroll/config-flags` | `super_admin`, `admin`, `payroll_head`, `payroll_branch` | PayrollConfigFlags | ✅ Yes (explicit) |
| `/payroll/recalculation-queue` | `super_admin`, `admin`, `payroll_head`, `payroll_branch` | RecalculationQueue | ✅ Yes (explicit) |
| `/payroll/running-breakdown` | `super_admin`, `admin`, `payroll_head`, `payroll_branch`, `wfm`, `employee` | RunningPayrollBreakdown | ✅ Yes (explicit) |
| `/payroll/holiday-master` | `super_admin`, `admin`, `payroll_head`, `payroll_branch` | HolidayMaster | ✅ Yes (explicit) |
| `/payroll/holiday-work-requests` | `super_admin`, `admin`, `wfm`, `payroll_head`, `payroll_branch` | HolidayWorkRequest | ✅ Yes (explicit) |
| `/payroll/holiday-work-approvals` | `super_admin`, `admin`, `payroll_head`, `payroll_branch`, `wfm` | HolidayWorkApprovals | ✅ Yes (explicit) |
| `/wfm/weekoff-fairness` | `super_admin`, `admin`, `wfm` | WeekoffFairness | ✅ Yes (explicit) |
| `/communication/templates` | `admin`, `hr` | NativeTemplateManager | ✅ Yes (bypassed) |
| `/settings/email-templates/bulk-import` | `admin`, `super_admin` | NativeEmailTemplateBulkImport | ✅ Yes (explicit) |
| `/communication/dispatch` | `admin`, `hr` | NativeDispatchCenter | ✅ Yes (bypassed) |
| `/communication/history` | `admin`, `hr` | NativeDispatchHistory | ✅ Yes (bypassed) |
| `/settings/communication-config` | `admin` | NativeCommunicationConfig | ✅ Yes (bypassed) |
| `/migration-console` | `admin` | NativeMigrationConsole | ✅ Yes (bypassed) |
| `/attendance-rules-master` | `admin`, `hr` | NativeAttendanceRulesMaster | ✅ Yes (bypassed) |

**✅ All role-restricted pages:** super_admin bypasses via `ProtectedRoute` line 45

---

### ✅ Open Access Pages (no Gate or role check)
| Route | Component | Access |
|-------|-----------|--------|
| `/dashboard` | Index | All authenticated users |
| `/leaves` | Leaves | All authenticated users |
| `/assets` | Assets | All authenticated users |
| `/reports` | NativeReportsCenter | All authenticated users |
| `/settings` | Settings | All authenticated users |
| `/profile` | Profile | All authenticated users |
| `/employee-journey` | EmployeeJourney | All authenticated users |
| `/performance` | Performance | All authenticated users |
| `/attendance` | Attendance | All authenticated users |
| `/calendar` | CompanyCalendar | All authenticated users |
| `/notification-preferences` | NotificationPreferences | All authenticated users |
| `/notifications` | Notifications | All authenticated users |
| `/modules` | ModuleLauncher | All authenticated users |
| `/ats/candidate-registration` | NativeATSCandidateRegistration | All authenticated users |
| `/ats/registration-enhanced` | NativeATSRegistrationEnhanced | All authenticated users |
| `/agent-performance` | NativeAgentPerformanceDashboard | All authenticated users |
| `/performance-feedback/*` | (6 pages) | All authenticated users |
| `/engagement` | NativeEngagement | All authenticated users |
| `/engagement/badges` | NativeBadges | All authenticated users |
| `/engagement/kudos` | NativeKudos | All authenticated users |
| `/engagement/surveys` | NativeSurveys | All authenticated users |
| `/engagement/leaderboard` | NativeLeaderboard | All authenticated users |
| `/employee-stat-card` | NativeEmployeeStatCard | All authenticated users |
| `/employee-stat-card/:id` | NativeEmployeeStatCard | All authenticated users |
| `/portal` | PortalOverview (PortalRoute) | Client portal users |
| `/portal/processes/:id` | PortalProcessDashboard (PortalRoute) | Client portal users |
| `/my-roster` | NativeMyRoster | All authenticated users |
| `/week-off-preferences` | NativeWeekOffPreferences | All authenticated users |
| `/changelog` | Changelog | All authenticated users |
| `/expenses` | MyExpenses | All authenticated users |
| `/expenses/new` | NewExpenseClaim | All authenticated users |
| `/expenses/approvals` | ExpenseApprovals | All authenticated users |
| `/expenses/finance` | FinanceQueue | All authenticated users |
| `/expenses/reports` | ExpenseReports | All authenticated users |
| `/communication/preferences` | NativeNotificationPreferences | All authenticated users |
| `/employees/bgv-status` | NativeEmployeeBGVStatus (self) | All authenticated users |

**✅ All open pages:** super_admin has access (no restriction)

---

## Summary Statistics

| Category | Count | super_admin Access |
|----------|-------|-------------------|
| **Public / Auth** | 8 | ✅ Yes |
| **Gate-Protected** | 95+ | ✅ Yes (bypassed) |
| **Role-Restricted** | 42 | ✅ Yes (bypassed or explicit) |
| **Open Access** | 40+ | ✅ Yes |
| **TOTAL** | **185+** | ✅ **100% Access** |

---

## Verification Evidence

### Code References

1. **`src/hooks/useUserRole.ts:171-174`**
   ```typescript
   const isSuperAdmin = roleKeys.includes("super_admin");
   return {
     canViewPage: (pageCode: string) => isSuperAdmin || pageSet.has(pageCode),
   ```

2. **`src/components/auth/ProtectedRoute.tsx:45`**
   ```typescript
   const hasRequiredRole = roleKeys.includes("super_admin") || roles.some((r) => roleKeys.includes(r));
   ```

3. **`src/components/security/WorkforcePageGate.tsx:92-104`**
   ```typescript
   const { isLoading, canViewPage } = useWorkforceAccess();
   if (!canViewPage(pageCode)) {
     return <AccessDeniedScreen />;
   }
   ```

---

## Recommendations

✅ **No changes required** - The current implementation is correct.

### Current State (Correct)
- `super_admin` has universal bypass for both Gate and role-based protection
- All 185+ pages are accessible to `super_admin`
- Access control is implemented at two layers with proper bypass logic

### Best Practices Confirmed
1. ✅ Explicit `super_admin` checks in both protection layers
2. ✅ Consistent bypass behavior across the application
3. ✅ No pages accidentally locked to `super_admin`
4. ✅ Clear separation between Gate-based and role-based protection

---

## Testing Checklist

To verify `super_admin` access in production:

- [ ] Login as `super_admin` user
- [ ] Verify navigation sidebar shows all available modules
- [ ] Test random Gate-protected page (e.g., `/ats/dashboard`)
- [ ] Test random role-restricted page (e.g., `/communication/templates`)
- [ ] Test random open page (e.g., `/dashboard`)
- [ ] Verify no "Access Denied" screens appear
- [ ] Test deep links to restricted areas work without redirect

---

## Audit Conclusion

**STATUS:** ✅ **PASSED - No Issues Found**

The `super_admin` role has **complete, unrestricted access** to all 185+ pages in the MAS PeopleOS HRMS application. Both protection mechanisms (`WorkforcePageGate` and `ProtectedRoute`) correctly implement bypass logic for `super_admin`.

No code changes are required.

---

**Audited by:** Claude Sonnet 4.5  
**Report Generated:** 2026-06-30  
**Version:** 1.0
