import { lazy, Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Library, Brain, Building2, Clock, Shield, ScrollText, CalendarClock, Archive } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { ErrorBoundary } from "@/components/ui/error-boundary";

// ── Lazy-loaded view components ───────────────────────────────────────────────
const ReportLibraryView    = lazy(() => import("@/components/reports/views/ReportLibraryView"));
const DecisionCenterView   = lazy(() => import("@/components/reports/views/DecisionCenterView"));
const BpoMasterView        = lazy(() => import("@/components/reports/views/BpoMasterView"));
const ReportRequestsView   = lazy(() => import("@/components/reports/views/ReportRequestsView"));
const SourceValidationView = lazy(() => import("@/components/reports/views/SourceValidationView"));
const AuditTrailView       = lazy(() => import("@/components/reports/views/AuditTrailView"));
const AonAnalyticsView       = lazy(() => import("@/components/reports/views/AonAnalyticsView"));
const LegacyHrmsReportsView = lazy(() => import("@/components/reports/views/LegacyHrmsReportsView"));

// ── View and role constants ───────────────────────────────────────────────────
const VIEWS = ['library', 'control-room', 'bpo', 'aon', 'requests', 'validation', 'audit', 'legacy'] as const;
type ReportView = typeof VIEWS[number];

const REPORT_ROLES = [
  'admin','hr','manager','ceo','coo','branch_head','wfm','operations_manager',
  'qa','quality_analyst','payroll_head','finance','recruiter','super_admin',
  'hr_admin','recruitment_hr','process_manager',
];
const REPORT_VALIDATION_ROLES = ['super_admin','admin'];
const AUDIT_ROLES = ['super_admin'];

function hasAnyRole(userRoles: string[], required: string[]): boolean {
  return required.some(r => userRoles.includes(r));
}

function resolveDefaultView(userRoles: string[]): ReportView {
  if (hasAnyRole(userRoles, REPORT_ROLES)) return 'library';
  return 'requests';
}

function resolvePermittedView(requested: string | null, userRoles: string[]): ReportView {
  const def = resolveDefaultView(userRoles);
  if (!requested || !(VIEWS as readonly string[]).includes(requested)) return def;
  const view = requested as ReportView;
  if (view === 'library'      && !hasAnyRole(userRoles, REPORT_ROLES))            return def;
  if (view === 'control-room' && !hasAnyRole(userRoles, REPORT_ROLES))            return def;
  if (view === 'bpo'          && !hasAnyRole(userRoles, REPORT_ROLES))            return def;
  if (view === 'aon'          && !hasAnyRole(userRoles, REPORT_ROLES))            return def;
  if (view === 'validation'   && !hasAnyRole(userRoles, REPORT_VALIDATION_ROLES)) return def;
  if (view === 'audit'        && !hasAnyRole(userRoles, AUDIT_ROLES))             return def;
  if (view === 'legacy'       && !hasAnyRole(userRoles, REPORT_ROLES))            return def;
  return view;
}

// ── Tab definition ────────────────────────────────────────────────────────────
interface TabDef {
  key: ReportView;
  label: string;
  Icon: React.FC<{ className?: string }>;
  requiredRoles?: string[];
}

const TABS: TabDef[] = [
  { key: 'library',      label: 'Report Library',  Icon: Library,     requiredRoles: REPORT_ROLES },
  { key: 'control-room', label: 'Decision Center',  Icon: Brain,       requiredRoles: REPORT_ROLES },
  { key: 'bpo',          label: 'BPO Reports',      Icon: Building2,   requiredRoles: REPORT_ROLES },
  { key: 'aon',          label: 'AON & Attrition',  Icon: CalendarClock, requiredRoles: REPORT_ROLES },
  { key: 'requests',     label: 'My Requests',      Icon: Clock },
  { key: 'validation',   label: 'Source Validation',Icon: Shield,      requiredRoles: REPORT_VALIDATION_ROLES },
  { key: 'audit',        label: 'Audit Trail',      Icon: ScrollText,  requiredRoles: AUDIT_ROLES },
  { key: 'legacy',       label: 'Legacy HRMS Reports', Icon: Archive,  requiredRoles: REPORT_ROLES },
];

// ── Loader ────────────────────────────────────────────────────────────────────
const ViewLoader = () => (
  <div className="flex h-64 items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-700" />
  </div>
);

// ── Hub shell ─────────────────────────────────────────────────────────────────
export default function ReportsHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { roleKeys } = useWorkforceAccess();
  const userRoles = roleKeys ?? [];

  const requestedView = searchParams.get('view');
  const preselectedReport = searchParams.get('report') ?? undefined;
  const activeView = resolvePermittedView(requestedView, userRoles);

  function switchView(view: ReportView) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('view', view);
      next.delete('report');
      return next;
    }, { replace: false });
  }

  const visibleTabs = TABS.filter(t =>
    !t.requiredRoles || hasAnyRole(userRoles, t.requiredRoles)
  );

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full min-h-0">
        {/* Tab bar */}
        <div className="border-b border-slate-200 bg-white px-4 pt-4 flex-shrink-0">
          <nav className="flex gap-1 overflow-x-auto">
            {visibleTabs.map(tab => {
              const isActive = activeView === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => switchView(tab.key)}
                  className={[
                    'flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-md border-b-2 whitespace-nowrap transition-colors',
                    isActive
                      ? 'border-slate-800 text-slate-900 bg-slate-50'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50',
                  ].join(' ')}
                >
                  <tab.Icon className="h-4 w-4 flex-shrink-0" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Active view */}
        <div className="flex-1 overflow-auto">
          <ErrorBoundary
            key={activeView}
            size="card"
            className="m-6"
          >
            <Suspense fallback={<ViewLoader />}>
              {activeView === 'library'      && <ReportLibraryView    preselectedReport={preselectedReport} />}
              {activeView === 'control-room' && <DecisionCenterView />}
              {activeView === 'bpo'          && <BpoMasterView />}
              {activeView === 'aon'          && <AonAnalyticsView />}
              {activeView === 'requests'     && <ReportRequestsView />}
              {activeView === 'validation'   && <SourceValidationView />}
              {activeView === 'audit'        && <AuditTrailView />}
              {activeView === 'legacy'       && <LegacyHrmsReportsView />}
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    </DashboardLayout>
  );
}
