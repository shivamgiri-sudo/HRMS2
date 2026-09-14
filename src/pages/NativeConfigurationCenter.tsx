import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LayoutDashboard, Settings2, Database, AlertTriangle,
  CheckCircle, XCircle, Clock, Search, ExternalLink,
  Building2, Calendar, Users, BarChart3, CreditCard,
  Network, Target, Shield, Bell, DollarSign, GraduationCap,
  Lock, Cpu, ChevronRight, TrendingUp, FileText, Coffee,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

// ── Types ─────────────────────────────────────────────────────────────────────

type GovernanceLevel = "none" | "basic" | "versioned" | "good";
type RiskLevel = "critical" | "high" | "medium" | "low";
type GapType = "hard-coded" | "missing-columns" | "no-versioning" | "raw-json" | "no-eligibility-type";

interface ConfigPage {
  label: string;
  href: string;
}

interface ConfigDomainRecord {
  key: string;
  name: string;
  Icon: React.ElementType;
  pages: ConfigPage[];
  tables: string[];
  governanceLevel: GovernanceLevel;
  coverage: string;
}

interface DbTableRecord {
  tableName: string;
  migrationFile: string;
  hasEffectiveFrom: boolean;
  hasHistoryTable: boolean;
  hasMakerChecker: boolean;
  scopeType: string;
  governanceLevel: GovernanceLevel;
  configPageHref: string | null;
  domain: string;
}

interface GapRecord {
  domain: string;
  configOrTable: string;
  gapType: GapType;
  riskLevel: RiskLevel;
  proposedFix: string;
  phase: string;
}

// ── Static data ───────────────────────────────────────────────────────────────

const DOMAINS: ConfigDomainRecord[] = [
  {
    key: "attendance",
    name: "Attendance",
    Icon: Clock,
    pages: [
      { label: "Attendance Rules Master", href: "/attendance-rules-master" },
      { label: "Attendance Billing Config", href: "/wfm/attendance-integrity?tab=billing" },
    ],
    tables: ["attendance_rule_config"],
    governanceLevel: "basic",
    coverage: "Partial — APR employee eligibility still hard-coded in SQL",
  },
  {
    key: "leave",
    name: "Leave",
    Icon: Calendar,
    pages: [
      { label: "Leave Types", href: "/leave-types" },
    ],
    tables: ["leave_policy_config", "leave_type_master"],
    governanceLevel: "none",
    coverage: "Partial — no carry-forward, sandwich rule, or lapse config; gender eligibility hard-coded",
  },
  {
    key: "wfm",
    name: "WFM / Roster",
    Icon: Users,
    pages: [
      { label: "WFM Planning Rules", href: "/wfm/planning-rules" },
      { label: "Slot Requirements", href: "/wfm/slot-requirements" },
      { label: "Week-off Day Rules", href: "/wfm/weekoff-day-rules" },
      { label: "Roster Master Builder", href: "/roster-master-builder" },
      { label: "Roster Capacity Config", href: "/roster-capacity-config" },
      { label: "Branch WFM SPOC Config", href: "/wfm/branch-spoc-config" },
    ],
    tables: ["wfm_process_planning_rule", "wfm_slot_requirement", "process_weekoff_rule", "roster_template", "branch_wfm_spoc_config"],
    governanceLevel: "basic",
    coverage: "Good — scope and effective-dating on planning rules; slot/weekoff missing versioning",
  },
  {
    key: "break",
    name: "Break Management",
    Icon: Coffee,
    pages: [
      { label: "Break Desk Devices", href: "/wfm/break-desk-devices" },
    ],
    tables: ["break_settings", "break_kiosk_devices"],
    governanceLevel: "none",
    coverage: "Partial — no process eligibility type; break settings apply to all processes at branch",
  },
  {
    key: "payroll",
    name: "Payroll",
    Icon: CreditCard,
    pages: [
      { label: "Statutory Config", href: "/payroll/statutory-config" },
      { label: "Payroll Masters", href: "/payroll/masters" },
      { label: "Config Flags", href: "/payroll/config-flags" },
      { label: "Holiday Master", href: "/payroll/holiday-master" },
    ],
    tables: ["statutory_config", "statutory_config_history", "payroll_config_flags", "salary_structure_master", "salary_component_master"],
    governanceLevel: "good",
    coverage: "Good — statutory_config has effective_from and audit history; config flags scoped to branch/process",
  },
  {
    key: "kpi",
    name: "KPI / Performance",
    Icon: BarChart3,
    pages: [
      { label: "KPI Master Config", href: "/kpi-master" },
      { label: "KPI Configuration", href: "/kpi-config" },
    ],
    tables: ["kpi_master_config", "kpi_metric_master"],
    governanceLevel: "none",
    coverage: "Gap — upsert overwrites the only version; no history of target changes (governance columns added in Migration 1031)",
  },
  {
    key: "workflow",
    name: "Workflow / Approvals",
    Icon: Network,
    pages: [
      { label: "Workflow Admin", href: "/workflow-admin" },
    ],
    tables: ["approval_workflow_master", "approval_workflow_step"],
    governanceLevel: "basic",
    coverage: "Basic — workflow steps and SLA hours configurable but no versioning or maker-checker",
  },
  {
    key: "ats",
    name: "ATS / Recruitment",
    Icon: Users,
    pages: [
      { label: "ATS Form Config", href: "/ats/form-config" },
    ],
    tables: ["ats_form_config"],
    governanceLevel: "basic",
    coverage: "Basic — form field options and schema stored as JSON; no versioning",
  },
  {
    key: "communication",
    name: "Communication",
    Icon: Bell,
    pages: [
      { label: "Communication Config", href: "/settings/communication-config" },
      { label: "Email Command Centre", href: "/communication/email-centre" },
      { label: "Comm Templates", href: "/communication/templates" },
      { label: "Call Centre Config", href: "/settings/call-centre-config" },
    ],
    tables: ["communication_provider_config", "notification_event_config"],
    governanceLevel: "good",
    coverage: "Good — provider config has test/audit fields; notification events have storm-control flags",
  },
  {
    key: "finance",
    name: "Finance / P&L",
    Icon: DollarSign,
    pages: [
      { label: "P&L Configuration", href: "/finance/process-pnl/configuration" },
      { label: "P&L LOB Management", href: "/finance/process-pnl/lobs" },
      { label: "P&L Period Close", href: "/finance/process-pnl/period-close" },
    ],
    tables: ["finance_pnl_component_master", "finance_meter_master"],
    governanceLevel: "basic",
    coverage: "Good structure — period close controls financial lock; component master configurable",
  },
  {
    key: "lms",
    name: "LMS Integration",
    Icon: GraduationCap,
    pages: [
      { label: "LMS Admin", href: "/lms/admin" },
      { label: "LMS Integration", href: "/lms/integration" },
    ],
    tables: ["lms_sync_audit"],
    governanceLevel: "basic",
    coverage: "Basic — sync configuration managed through integration hub patterns",
  },
  {
    key: "privacy",
    name: "Privacy / Compliance",
    Icon: Shield,
    pages: [
      { label: "DPDP / Privacy", href: "/compliance/dpdp" },
    ],
    tables: ["data_retention_policy", "dpdp_config", "consent_text_version"],
    governanceLevel: "basic",
    coverage: "Basic — retention days and DPDP config configurable; no versioning on policy changes",
  },
  {
    key: "system",
    name: "System / Org",
    Icon: Cpu,
    pages: [
      { label: "Org Masters", href: "/org-masters" },
      { label: "Location & Policies", href: "/org-masters/locations-policies" },
      { label: "Process Config", href: "/process-config" },
      { label: "Settings", href: "/settings" },
      { label: "Policy Engine", href: "/super-admin/policy-engine" },
    ],
    tables: ["org_settings", "process_configuration", "visitor_configuration", "business_policy_config", "business_policy_config_history"],
    governanceLevel: "basic",
    coverage: "Mixed — business_policy_config (best pattern: domain/section/key, history, reason required); org_settings is raw key/value; process_configuration is unvalidated JSON",
  },
];

const DB_TABLES: DbTableRecord[] = [
  { tableName: "org_settings", migrationFile: "067", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Company", governanceLevel: "none", configPageHref: "/settings", domain: "System/Org" },
  { tableName: "business_policy_config", migrationFile: "450", hasEffectiveFrom: true, hasHistoryTable: true, hasMakerChecker: false, scopeType: "Company", governanceLevel: "good", configPageHref: "/super-admin/policy-engine", domain: "System/Org" },
  { tableName: "attendance_rule_config", migrationFile: "044", hasEffectiveFrom: true, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Designation/Process/Branch/Global", governanceLevel: "basic", configPageHref: "/attendance-rules-master", domain: "Attendance" },
  { tableName: "leave_policy_config", migrationFile: "150 → 1031", hasEffectiveFrom: true, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Leave Type", governanceLevel: "basic", configPageHref: "/leave-types", domain: "Leave" },
  { tableName: "wfm_process_planning_rule", migrationFile: "232", hasEffectiveFrom: true, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Process/Branch", governanceLevel: "basic", configPageHref: "/wfm/planning-rules", domain: "WFM/Roster" },
  { tableName: "wfm_slot_requirement", migrationFile: "233", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Process", governanceLevel: "none", configPageHref: "/wfm/slot-requirements", domain: "WFM/Roster" },
  { tableName: "process_weekoff_rule", migrationFile: "223", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Process", governanceLevel: "none", configPageHref: "/wfm/weekoff-day-rules", domain: "WFM/Roster" },
  { tableName: "process_configuration", migrationFile: "186", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Process (JSON)", governanceLevel: "none", configPageHref: "/process-config", domain: "System/Org" },
  { tableName: "statutory_config", migrationFile: "007", hasEffectiveFrom: true, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Company", governanceLevel: "basic", configPageHref: "/payroll/statutory-config", domain: "Payroll" },
  { tableName: "statutory_config_history", migrationFile: "396", hasEffectiveFrom: false, hasHistoryTable: true, hasMakerChecker: false, scopeType: "Audit Log", governanceLevel: "versioned", configPageHref: "/payroll/statutory-config", domain: "Payroll" },
  { tableName: "payroll_config_flags", migrationFile: "330", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Branch/Process", governanceLevel: "none", configPageHref: "/payroll/config-flags", domain: "Payroll" },
  { tableName: "kpi_master_config", migrationFile: "160 → 1031", hasEffectiveFrom: true, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Dept/Designation/Process/CC", governanceLevel: "basic", configPageHref: "/kpi-master", domain: "KPI/Performance" },
  { tableName: "approval_workflow_master", migrationFile: "015", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Company", governanceLevel: "none", configPageHref: "/workflow-admin", domain: "Workflow" },
  { tableName: "approval_workflow_step", migrationFile: "015", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Company", governanceLevel: "none", configPageHref: "/workflow-admin", domain: "Workflow" },
  { tableName: "communication_provider_config", migrationFile: "071", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Company (1/channel)", governanceLevel: "basic", configPageHref: "/settings/communication-config", domain: "Communication" },
  { tableName: "notification_event_config", migrationFile: "1022", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Company", governanceLevel: "basic", configPageHref: "/communication/email-centre", domain: "Communication" },
  { tableName: "ats_form_config", migrationFile: "051", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Company", governanceLevel: "none", configPageHref: "/ats/form-config", domain: "ATS" },
  { tableName: "break_settings", migrationFile: "376", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Branch/Process", governanceLevel: "none", configPageHref: "/wfm/break-desk-devices", domain: "Break" },
  { tableName: "visitor_configuration", migrationFile: "409", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Branch/Global (JSON)", governanceLevel: "none", configPageHref: null, domain: "System/Org" },
  { tableName: "tat_matrix_master", migrationFile: "294", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Company", governanceLevel: "none", configPageHref: "/governance/tat-matrix", domain: "Workflow" },
  { tableName: "escalation_matrix_master", migrationFile: "294", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Company", governanceLevel: "none", configPageHref: "/governance/tat-matrix", domain: "Workflow" },
  { tableName: "dashboard_metric_target", migrationFile: "341", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Company", governanceLevel: "none", configPageHref: null, domain: "KPI/Performance" },
  { tableName: "data_retention_policy", migrationFile: "030", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Company", governanceLevel: "none", configPageHref: "/compliance/dpdp", domain: "Privacy" },
  { tableName: "dpdp_config", migrationFile: "030", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Company", governanceLevel: "none", configPageHref: "/compliance/dpdp", domain: "Privacy" },
  { tableName: "roster_template", migrationFile: "060", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Company", governanceLevel: "none", configPageHref: "/roster-master-builder", domain: "WFM/Roster" },
  { tableName: "finance_pnl_component_master", migrationFile: "426", hasEffectiveFrom: false, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Company", governanceLevel: "none", configPageHref: "/finance/process-pnl/configuration", domain: "Finance/P&L" },
  { tableName: "performance_source_dataset", migrationFile: "580", hasEffectiveFrom: false, hasHistoryTable: true, hasMakerChecker: false, scopeType: "Dataset", governanceLevel: "versioned", configPageHref: null, domain: "KPI/Performance" },
  { tableName: "apr_eligibility_config", migrationFile: "1032 (new)", hasEffectiveFrom: true, hasHistoryTable: false, hasMakerChecker: false, scopeType: "Dept/Designation/Process", governanceLevel: "basic", configPageHref: "/attendance-rules-master", domain: "Attendance" },
];

const GAPS: GapRecord[] = [
  {
    domain: "Attendance",
    configOrTable: "APR employee detection (174_apr_attendance_rule.sql)",
    gapType: "hard-coded",
    riskLevel: "high",
    proposedFix: "apr_eligibility_config table created (Migration 1032). Wire APR service to read from table in Phase 2.",
    phase: "Phase 2",
  },
  {
    domain: "Leave",
    configOrTable: "leave.routes.ts:282–296",
    gapType: "hard-coded",
    riskLevel: "medium",
    proposedFix: "Add gender_eligibility column to leave_type_master. Currently ML/MTRL=female, PL/PTRL=male hard-coded in route query.",
    phase: "Phase 2",
  },
  {
    domain: "KPI / Performance",
    configOrTable: "kpi_master_config (unique key overwrites)",
    gapType: "no-versioning",
    riskLevel: "high",
    proposedFix: "Governance columns (effective_from, version_number, change_reason) added by Migration 1031. Version enforcement logic in Phase 2.",
    phase: "Phase 2",
  },
  {
    domain: "Leave",
    configOrTable: "leave_policy_config",
    gapType: "missing-columns",
    riskLevel: "high",
    proposedFix: "Missing: max_carry_forward, lapse_enabled, sandwich_rule_enabled, eligibility_months_min. Governance columns added by Migration 1031. Field columns Phase 2.",
    phase: "Phase 2",
  },
  {
    domain: "System / Org",
    configOrTable: "visitor_configuration.config_value",
    gapType: "raw-json",
    riskLevel: "low",
    proposedFix: "Render as structured form with labels, dropdowns, and validation. Raw JSON editor replaced with schema-driven form in Phase 2.",
    phase: "Phase 2",
  },
  {
    domain: "System / Org",
    configOrTable: "process_configuration.config_value",
    gapType: "raw-json",
    riskLevel: "medium",
    proposedFix: "Schema-validated form per process type. Unrestricted JSON editing replaced with typed fields in Phase 2.",
    phase: "Phase 2",
  },
  {
    domain: "Break Management",
    configOrTable: "break_settings",
    gapType: "no-eligibility-type",
    riskLevel: "low",
    proposedFix: "Add process_eligibility_type column so break kiosk rules can be restricted to specific processes rather than applying to all processes at a branch.",
    phase: "Phase 2",
  },
];

// ── Helper badge components ───────────────────────────────────────────────────

function GovernanceBadge({ level }: { level: GovernanceLevel }) {
  const variants: Record<GovernanceLevel, { label: string; cls: string }> = {
    none:      { label: "None",     cls: "bg-red-100 text-red-700 border-red-200" },
    basic:     { label: "Basic",    cls: "bg-yellow-100 text-yellow-700 border-yellow-200" },
    versioned: { label: "Versioned",cls: "bg-blue-100 text-blue-700 border-blue-200" },
    good:      { label: "Good",     cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  };
  const v = variants[level];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${v.cls}`}>{v.label}</span>;
}

function RiskBadge({ level }: { level: RiskLevel }) {
  const variants: Record<RiskLevel, { label: string; cls: string }> = {
    critical: { label: "Critical", cls: "bg-red-100 text-red-700 border-red-200" },
    high:     { label: "High",     cls: "bg-orange-100 text-orange-700 border-orange-200" },
    medium:   { label: "Medium",   cls: "bg-yellow-100 text-yellow-700 border-yellow-200" },
    low:      { label: "Low",      cls: "bg-slate-100 text-slate-600 border-slate-200" },
  };
  const v = variants[level];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${v.cls}`}>{v.label}</span>;
}

function BoolIcon({ value }: { value: boolean }) {
  return value
    ? <CheckCircle className="h-4 w-4 text-emerald-600" />
    : <XCircle className="h-4 w-4 text-slate-300" />;
}

// ── Domain card ───────────────────────────────────────────────────────────────

function DomainCard({ domain }: { domain: ConfigDomainRecord }) {
  const navigate = useNavigate();

  return (
    <Card className="flex flex-col border-slate-200 hover:border-slate-300 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
              <domain.Icon className="h-4 w-4 text-slate-600" />
            </div>
            <CardTitle className="text-sm font-semibold text-slate-800">{domain.name}</CardTitle>
          </div>
          <GovernanceBadge level={domain.governanceLevel} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="text-xs text-slate-500 leading-relaxed">{domain.coverage}</p>
        <div className="flex gap-2">
          <Badge variant="secondary" className="text-xs">{domain.pages.length} page{domain.pages.length !== 1 ? "s" : ""}</Badge>
          <Badge variant="secondary" className="text-xs">{domain.tables.length} table{domain.tables.length !== 1 ? "s" : ""}</Badge>
        </div>
        <div className="mt-auto flex flex-col gap-1">
          {domain.pages.map((p) => (
            <button
              key={p.href}
              onClick={() => navigate(p.href)}
              className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors text-left"
            >
              <span>{p.label}</span>
              <ChevronRight className="h-3 w-3 text-slate-400" />
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NativeConfigurationCenter() {
  const [tableSearch, setTableSearch] = useState("");

  const totalPages = DOMAINS.reduce((acc, d) => acc + d.pages.length, 0);
  const tablesWithVersioning = DB_TABLES.filter((t) => t.hasEffectiveFrom || t.hasHistoryTable).length;
  const tablesWithoutDating = DB_TABLES.filter((t) => !t.hasEffectiveFrom).length;
  const healthScore = Math.round((tablesWithVersioning / DB_TABLES.length) * 100);

  const filteredTables = DB_TABLES.filter(
    (t) =>
      tableSearch === "" ||
      t.tableName.toLowerCase().includes(tableSearch.toLowerCase()) ||
      t.domain.toLowerCase().includes(tableSearch.toLowerCase()) ||
      t.migrationFile.toLowerCase().includes(tableSearch.toLowerCase()),
  );

  const riskGroups: Record<RiskLevel, string[]> = {
    critical: ["Payroll formulas", "Statutory config", "Access control", "JWT / auth"],
    high: ["Attendance thresholds (APR)", "Leave accrual & carry-forward", "KPI targets (no history)"],
    medium: ["WFM planning rules", "Break eligibility", "Roster templates", "Process JSON config"],
    low: ["Communication templates", "Visitor config", "ATS form options", "BGV provider"],
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900">
              <LayoutDashboard className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Configuration Control Center</h1>
              <p className="text-sm text-slate-500">
                Governance inventory for all HRMS configuration domains — Phase 1 read-only audit
              </p>
            </div>
          </div>
        </div>

        <Tabs defaultValue="overview">
          <TabsList className="h-auto w-full grid grid-cols-4 sm:inline-flex sm:h-10 sm:w-auto gap-1">
            <TabsTrigger value="overview" className="gap-1.5 text-xs sm:text-sm">
              <TrendingUp className="h-3.5 w-3.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="domains" className="gap-1.5 text-xs sm:text-sm">
              <Settings2 className="h-3.5 w-3.5" />
              By Domain
            </TabsTrigger>
            <TabsTrigger value="gaps" className="gap-1.5 text-xs sm:text-sm">
              <AlertTriangle className="h-3.5 w-3.5" />
              Gaps &amp; Risks
              <Badge className="ml-1 h-4 px-1.5 text-[10px] bg-orange-100 text-orange-700 border-0">
                {GAPS.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="tables" className="gap-1.5 text-xs sm:text-sm">
              <Database className="h-3.5 w-3.5" />
              DB Tables
            </TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Overview ─────────────────────────────────────────────── */}
          <TabsContent value="overview" className="mt-6 space-y-6">
            {/* Health score */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700">Configuration Governance Health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Tables with versioning or effective-dating</span>
                  <span className="font-semibold text-slate-900">{healthScore}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-500 transition-all"
                    style={{ width: `${healthScore}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500">
                  {tablesWithVersioning} of {DB_TABLES.length} config tables have at least{" "}
                  <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">effective_from</code> or a
                  dedicated history table. Target: 80%+ by Phase 3.
                </p>
              </CardContent>
            </Card>

            {/* Stat tiles */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: "Config Domains", value: DOMAINS.length, Icon: Settings2, color: "text-blue-600 bg-blue-50" },
                { label: "Active Config Pages", value: totalPages, Icon: FileText, color: "text-violet-600 bg-violet-50" },
                { label: "Tables w/ Versioning", value: tablesWithVersioning, Icon: CheckCircle, color: "text-emerald-600 bg-emerald-50" },
                { label: "Confirmed Hard-coded Rules", value: GAPS.filter(g => g.gapType === "hard-coded").length, Icon: AlertTriangle, color: "text-orange-600 bg-orange-50" },
              ].map(({ label, value, Icon, color }) => (
                <Card key={label} className="border-slate-200">
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-slate-900">{value}</p>
                      <p className="text-xs text-slate-500">{label}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Missing effective_from note */}
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="flex items-start gap-3 p-4">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="text-sm text-amber-800">
                  <span className="font-semibold">{tablesWithoutDating} tables</span> have no{" "}
                  <code className="rounded bg-amber-100 px-1 font-mono text-[11px]">effective_from</code> column.
                  Editing any of these changes live production data immediately with no scheduling or rollback path.
                </div>
              </CardContent>
            </Card>

            {/* Risk breakdown */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700">Risk Breakdown by Domain</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-slate-100">
                  {(["critical", "high", "medium", "low"] as RiskLevel[]).map((level) => (
                    <div key={level} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="mt-0.5 shrink-0">
                        <RiskBadge level={level} />
                      </div>
                      <p className="text-sm text-slate-600">{riskGroups[level].join(" · ")}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Pending governance work */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700">Pending Governance Work</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {GAPS.map((gap, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <RiskBadge level={gap.riskLevel} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-slate-800">{gap.domain} — {gap.configOrTable}</p>
                        <p className="mt-0.5 text-xs text-slate-500 truncate">{gap.proposedFix}</p>
                      </div>
                      <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{gap.phase}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Tab 2: By Domain ─────────────────────────────────────────────── */}
          <TabsContent value="domains" className="mt-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {DOMAINS.map((domain) => (
                <DomainCard key={domain.key} domain={domain} />
              ))}
            </div>
          </TabsContent>

          {/* ── Tab 3: Gaps & Risks ──────────────────────────────────────────── */}
          <TabsContent value="gaps" className="mt-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700">
                  Confirmed Governance Gaps ({GAPS.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50">
                      <tr>
                        {["Domain", "Config / Table", "Gap Type", "Risk", "Proposed Fix", "Phase"].map((h) => (
                          <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {GAPS.map((gap, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-xs font-medium text-slate-700 whitespace-nowrap">{gap.domain}</td>
                          <td className="px-4 py-3 text-xs text-slate-600 max-w-[200px]">
                            <code className="rounded bg-slate-100 px-1 font-mono text-[11px] break-all">{gap.configOrTable}</code>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                            {gap.gapType.replace(/-/g, " ")}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <RiskBadge level={gap.riskLevel} />
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600 max-w-[260px]">{gap.proposedFix}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{gap.phase}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Tab 4: DB Tables ─────────────────────────────────────────────── */}
          <TabsContent value="tables" className="mt-6 space-y-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search table name, domain, migration…"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50">
                      <tr>
                        {["Table", "Domain", "Migration", "effective_from", "History", "Maker/Checker", "Scope", "Level", ""].map((h) => (
                          <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredTables.map((t, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-3 py-2.5 text-xs">
                            <code className="font-mono text-[11px] text-slate-700">{t.tableName}</code>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">{t.domain}</td>
                          <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">{t.migrationFile}</td>
                          <td className="px-3 py-2.5"><BoolIcon value={t.hasEffectiveFrom} /></td>
                          <td className="px-3 py-2.5"><BoolIcon value={t.hasHistoryTable} /></td>
                          <td className="px-3 py-2.5"><BoolIcon value={t.hasMakerChecker} /></td>
                          <td className="px-3 py-2.5 text-xs text-slate-500 max-w-[140px] truncate" title={t.scopeType}>{t.scopeType}</td>
                          <td className="px-3 py-2.5"><GovernanceBadge level={t.governanceLevel} /></td>
                          <td className="px-3 py-2.5">
                            {t.configPageHref ? (
                              <a
                                href={t.configPageHref}
                                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                              >
                                Open <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredTables.length === 0 && (
                    <div className="py-12 text-center text-sm text-slate-400">No tables match "{tableSearch}"</div>
                  )}
                </div>
              </CardContent>
            </Card>
            <p className="text-xs text-slate-400">
              Showing {filteredTables.length} of {DB_TABLES.length} config tables · Inventory is static in Phase 1;
              live counts added in Phase 2.
            </p>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
