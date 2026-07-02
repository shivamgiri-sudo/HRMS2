# PeopleOS Role Mindmaps and End-to-End Journeys

**Date:** 30-May-2026  
**Status:** Mandatory role journey blueprint for frontend, backend and access-control implementation.

---

## 1. Purpose

This file defines what each PeopleOS role must see, do, approve, monitor and receive as alerts. Use this as the role-wise build map for all future packages.

Rules:
- Frontend visibility is not security; backend scope must enforce access.
- Client Portal is aggregate-only.
- Payroll, documents, disciplinary, Aadhaar/e-sign and personal data require role-based masking and audit.
- Each role journey should be implemented as a real working page, not only a placeholder.

---

## 2. Super Admin Mindmap

```text
Super Admin
├─ Platform Setup
│  ├─ Branch Master
│  ├─ Client Master
│  ├─ Process Master
│  ├─ LOB Master
│  ├─ Cost Centre Master
│  ├─ Role & Permission Master
│  └─ Business Rule Master
├─ Security & Compliance
│  ├─ User Management
│  ├─ Account Lock/Unlock/Reset
│  ├─ Role Scope Assignment
│  ├─ Audit Logs
│  ├─ DPDP Control Tower
│  ├─ Breach Register
│  └─ Retention Policies
├─ Integrations
│  ├─ External SQL Connectors
│  ├─ Manual Upload Mapping
│  ├─ LMS Snapshot Mapping
│  ├─ Call Master Snapshot Mapping
│  └─ Sync Health
└─ Governance
   ├─ Approval Matrices
   ├─ Client Publish Rules
   ├─ System Health
   └─ Deployment Readiness
```

Journey:
1. Configure masters.
2. Create roles and scopes.
3. Approve high-risk settings.
4. Monitor DPDP/privacy controls.
5. Audit sensitive actions.
6. Review system health and integration health.

---

## 3. HR Admin Mindmap

```text
HR Admin
├─ Recruitment to Joining
│  ├─ Candidate Conversion
│  ├─ Offer Acknowledgement
│  ├─ BGV Status
│  ├─ Document Verification
│  └─ Joining Checklist
├─ Employee Lifecycle
│  ├─ Employee Master
│  ├─ Employee ID Generation
│  ├─ Onboarding Data Validation
│  ├─ Designation Assignment
│  ├─ Process/LOB/Cost Centre Assignment
│  └─ Employee Stat Card
├─ HR Operations
│  ├─ Leave Governance
│  ├─ Letters
│  ├─ Helpdesk
│  ├─ Benefits
│  ├─ PIP / Warning / Case Logs
│  └─ Exit Management
└─ Compliance
   ├─ Document Compliance
   ├─ Consent Ledger
   ├─ DSR Requests
   └─ Privacy Audit
```

Journey:
1. Receive selected candidate from ATS.
2. Validate offer acceptance and document compliance.
3. Generate employee ID according to active branch/process/cost-centre rule.
4. Auto-fill employee onboarding profile from candidate data and parsed resume data.
5. Validate manually submitted fields.
6. Convert candidate to employee.
7. Maintain employee journey timeline until exit.

---

## 4. Candidate / Pre-Joining User Mindmap

```text
Candidate / Pre-Joining User
├─ Registration
│  ├─ Basic Profile
│  ├─ Resume Upload / Resume Photo Capture
│  ├─ Resume Parsing Autofill
│  ├─ Candidate Validation
│  └─ Consent Capture
├─ Selection to Joining
│  ├─ Offer Letter View
│  ├─ Offer Acknowledgement / e-Sign Consent
│  ├─ Document Upload
│  ├─ Document Verification Status
│  ├─ Joining Details
│  └─ Pre-Joining Checklist
└─ Conversion
   ├─ Confirm Personal Details
   ├─ Confirm Address / Bank / Emergency Contact
   ├─ Submit Declaration
   └─ Employee Portal Activation
```

Journey:
1. Opens candidate/pre-joining portal.
2. Enters mobile/email/Candidate ID.
3. System fetches ATS data after OTP/validation.
4. Candidate uploads resume PDF/image or clicks photo of resume.
5. Parser extracts name, email, mobile, education, experience, skills, address and employer history.
6. System pre-fills form.
7. Candidate reviews, corrects and submits.
8. HR/compliance validates.
9. Employee ID is generated only after approved conversion rule.

---

## 5. Recruiter Mindmap

```text
Recruiter
├─ Candidate Queue
│  ├─ Assigned Candidates
│  ├─ Duplicate/Reprocess Alerts
│  ├─ Screening Actions
│  └─ Follow-up SLA
├─ Selection Workflow
│  ├─ Interview Updates
│  ├─ Candidate Status
│  ├─ Offer Request
│  └─ Joining Pipeline
└─ Productivity
   ├─ Calls/Attempts
   ├─ Walk-in/Selected/Joined Conversion
   ├─ Source Performance
   └─ Recruiter Dashboard
```

Journey:
1. Works only on assigned candidates.
2. Updates screening/interview/follow-up.
3. Sends selected candidates to offer/document/compliance flow.
4. Tracks joining and recruiter productivity.

---

## 6. Employee Mindmap

```text
Employee
├─ Self Service
│  ├─ Profile
│  ├─ Documents
│  ├─ Roster
│  ├─ Attendance
│  ├─ Leave
│  ├─ Payslip
│  ├─ Tax Declarations
│  ├─ Assets
│  ├─ Helpdesk
│  └─ Resignation
├─ Growth
│  ├─ LMS / Learning
│  ├─ Certification
│  ├─ Performance
│  ├─ Coaching
│  ├─ Goals
│  ├─ Gamification
│  └─ Incentive View
└─ Privacy
   ├─ Consent View
   ├─ Personal Data Requests
   ├─ Communication Preferences
   └─ Grievance / Data Request
```

Journey:
1. Logs in after employee activation.
2. Completes missing onboarding details.
3. Acknowledges roster and policies.
4. Applies leave/regularization/resignation.
5. Views payslip, incentives, documents and learning.
6. Tracks own journey and achievements.

---

## 7. WFM Mindmap

```text
WFM
├─ Demand & Capacity
│  ├─ Mandate HC
│  ├─ Buffer %
│  ├─ Shrinkage
│  ├─ Training Pipeline
│  └─ Shortage/Surplus
├─ Roster
│  ├─ Roster Logic Master
│  ├─ Auto Draft Generation
│  ├─ Exception Handling
│  ├─ Publish Governance
│  └─ Post-Publish Change Audit
├─ RTA
│  ├─ Live Tracker
│  ├─ Adherence
│  ├─ Planned vs Unplanned
│  ├─ Leave Impact
│  └─ Payroll Readiness
└─ Reporting
   ├─ Process/LOB/Cost Centre View
   ├─ Client Aggregate View
   └─ WFM Health
```

Journey:
1. Maintains staffing mandate and roster rules.
2. Generates weekly roster draft.
3. Resolves conflicts with Process Manager.
4. Tracks adherence and shrinkage.
5. Feeds payroll readiness and client aggregate reporting.

---

## 8. Process Manager Mindmap

```text
Process Manager
├─ Delivery Readiness
│  ├─ Active HC
│  ├─ Required HC
│  ├─ Shortage/Surplus
│  ├─ Training Pipeline
│  └─ Deployment Readiness
├─ Roster Governance
│  ├─ Review Draft Roster
│  ├─ Approve Publish
│  ├─ Coverage Actions
│  └─ TL/AM Accountability
├─ Performance
│  ├─ KPI Targets
│  ├─ Quality Summary
│  ├─ Productivity
│  ├─ Coaching/PIP
│  └─ Incentive Inputs
└─ Client Governance
   ├─ SLA/SOW Metrics
   ├─ Action Plans
   ├─ Client Requests
   └─ Published Aggregate Data
```

Journey:
1. Monitors mapped process/LOB/cost centre.
2. Owns weekly roster publish with WFM.
3. Tracks delivery gaps and assigns actions to TL/AM.
4. Reviews performance, quality, staffing and client risk.

---

## 9. Assistant Manager Mindmap

```text
Assistant Manager
├─ TL Governance
│  ├─ Team Coverage
│  ├─ Late/No-Show Actions
│  ├─ Coaching Closure
│  └─ Action Escalations
├─ Process Support
│  ├─ Roster Exceptions
│  ├─ Attendance Risk
│  ├─ Performance Risk
│  └─ Quality Risk
└─ Approvals
   ├─ Shift/WO Changes if allowed
   ├─ Incentive Step Approval if configured
   └─ PIP/Coaching Review
```

Journey:
1. Monitors TL teams.
2. Acts on exceptions.
3. Escalates unresolved gaps.
4. Cannot freely edit published roster truth.

---

## 10. Team Leader Mindmap

```text
Team Leader
├─ Team Control
│  ├─ Team Roster View
│  ├─ Attendance Follow-up
│  ├─ Daily Briefing
│  ├─ No-Show / Late / Break Actions
│  └─ Agent Availability
├─ Performance
│  ├─ KPI Tracking
│  ├─ Coaching
│  ├─ TNI
│  ├─ PIP Inputs
│  └─ Incentive Inputs
└─ Employee Support
   ├─ Leave visibility
   ├─ Helpdesk escalation
   ├─ Document pending follow-up
   └─ Resignation alert
```

Journey:
1. Reviews mapped team daily.
2. Handles attendance and productivity gaps.
3. Raises roster/coverage actions.
4. Provides coaching and performance inputs.

---

## 11. QA / T&Q Mindmap

```text
QA / T&Q
├─ Quality Governance
│  ├─ Audit Parameters
│  ├─ Fatal/Critical Alerts
│  ├─ Call Master Evidence
│  ├─ Calibration
│  └─ Quality Dashboard
├─ Improvement
│  ├─ Coaching
│  ├─ TNI
│  ├─ CAPA
│  ├─ Analyst Acknowledgement
│  └─ Repeat Defect Tracking
└─ Reporting
   ├─ Agent/TL/Process View
   ├─ Client-Safe Summary
   └─ Quality Trend
```

Journey:
1. Consumes Call Master/quality data.
2. Flags defects and fatal/critical risks.
3. Drives coaching/TNI/CAPA.
4. Publishes only approved aggregate quality summaries to clients.

---

## 12. Trainer Mindmap

```text
Trainer
├─ Training Pipeline
│  ├─ New Joiner Batch
│  ├─ LMS Mapping
│  ├─ Attendance
│  ├─ Progress
│  └─ Certification
├─ Readiness
│  ├─ Process Readiness
│  ├─ Certification Rules
│  ├─ Handover to Operations
│  └─ Risk Flags
└─ Reporting
   ├─ Training Projection
   ├─ Certified Pending Deployment
   └─ Client Aggregate Readiness
```

Journey:
1. Receives joined/new hire batch.
2. Maps to existing LMS.
3. Tracks progress/certification.
4. Updates deployment readiness.

---

## 13. Payroll / Finance Mindmap

```text
Payroll / Finance
├─ Payroll Setup
│  ├─ Salary Structure
│  ├─ Payroll Components
│  ├─ PF/UAN/ESIC/TDS Rules
│  ├─ Cost Centre Payroll Config
│  └─ Bank/Disbursement Config
├─ Monthly Payroll
│  ├─ Attendance Readiness
│  ├─ LWP
│  ├─ Incentive Approved Inputs
│  ├─ Tax Declaration
│  ├─ Payslip Generation
│  └─ Disbursement Export
└─ Exit/F&F
   ├─ Clearance Inputs
   ├─ Gratuity
   ├─ Recovery
   ├─ F&F Approval
   └─ Final Payslip
```

Journey:
1. Receives payroll-ready employees only.
2. Validates attendance/LWP/incentive inputs.
3. Generates payslips after maker-checker approval.
4. Handles F&F after exit clearance.

---

## 14. CEO / Leadership Mindmap

```text
CEO / Leadership
├─ Company Health
│  ├─ Headcount
│  ├─ Hiring Pipeline
│  ├─ Training Readiness
│  ├─ Staffing Risk
│  ├─ Attrition
│  └─ Cost Centre View
├─ Delivery Health
│  ├─ Client SLA
│  ├─ Process Performance
│  ├─ Quality
│  ├─ Roster/Attendance Risk
│  └─ Action Plan Status
├─ Financial/People View
│  ├─ Payroll Summary
│  ├─ Incentive Summary
│  ├─ Cost Centre Trends
│  └─ Productivity
└─ Compliance
   ├─ DPDP Dashboard
   ├─ Breach Incidents
   ├─ Audit Exceptions
   └─ Health Control Tower
```

Journey:
1. Views company-wide dashboards.
2. Drills branch/process/LOB/cost centre.
3. Reviews risks and action closures.
4. Sees privacy/compliance health.

---

## 15. Client User Mindmap

```text
Client User
├─ Process View
│  ├─ SLA/SOW Metrics
│  ├─ Staffing Readiness Aggregate
│  ├─ Training Readiness Aggregate
│  ├─ Quality Summary Aggregate
│  └─ Action Plan Status
├─ Governance
│  ├─ MOM
│  ├─ Requests
│  ├─ Escalations
│  └─ Closure Evidence
└─ Reports
   ├─ Published Reports
   ├─ Approved Metrics
   └─ No PII / No Payroll / No Raw Data
```

Journey:
1. Logs into Client Portal.
2. Views only mapped client/process published aggregate metrics.
3. Raises requests/escalations.
4. Tracks governance actions and published reports.

---

## 16. Compliance / Auditor Mindmap

```text
Compliance / Auditor
├─ DPDP Controls
│  ├─ Data Inventory
│  ├─ Consent Ledger
│  ├─ Privacy Notices
│  ├─ DSR Requests
│  ├─ Retention Policies
│  └─ Breach Register
├─ Audit
│  ├─ Sensitive Action Logs
│  ├─ Data Export Logs
│  ├─ Document Access Logs
│  └─ Role Permission Review
└─ Evidence
   ├─ Compliance Reports
   ├─ Incident Evidence Pack
   └─ Corrective Actions
```

Journey:
1. Reviews privacy/security dashboards.
2. Tracks incidents, requests and sensitive actions.
3. Produces audit evidence and action closure reports.
