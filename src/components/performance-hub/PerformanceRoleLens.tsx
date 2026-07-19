import { BarChart3, BriefcaseBusiness, Building2, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PerformanceContext } from "@/types/performanceHub";

type Lens = {
  value: string;
  label: string;
  title: string;
  copy: string;
  icon: React.ReactNode;
};

function titleCaseRole(role: string): string {
  return role
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function roleFocus(context: PerformanceContext): string {
  if (context.scopeLevel === "SELF_ONLY") return "Personal target progress and source verification.";
  if (context.scopeLevel === "TEAM_ONLY") return "Team coaching, bottom-performer review, and daily outlier follow-up.";
  if (context.scopeLevel === "BRANCH_ALL") return "branch and process movement, staffing pressure, and source freshness.";
  if (context.scopeLevel === "PROCESS_ALL") return "Process movement, team comparison, and performance variance.";
  return "Cross-scope performance movement, source freshness, and verified formula coverage.";
}
function roleTitle(context: PerformanceContext): string {
  const role = context.effectiveRole.toLowerCase();
  if (role.includes("team") || context.scopeLevel === "TEAM_ONLY") return "Team leader view";
  if (role.includes("branch") || context.scopeLevel === "BRANCH_ALL") return "Branch head view";
  if (role.includes("process") || context.scopeLevel === "PROCESS_ALL") return "Process manager view";
  if (role === "employee" || context.scopeLevel === "SELF_ONLY") return "Employee view";
  return `${titleCaseRole(context.effectiveRole)} view`;
}

function lensesFor(context: PerformanceContext): Lens[] {
  const lenses: Lens[] = [
    {
      value: "self",
      label: "My scorecard",
      title: "My scorecard",
      copy: "Track personal calls, handle time, quality, adherence, utilization, and conversion against the targets assigned to your role.",
      icon: <UserRound className="h-4 w-4" aria-hidden="true" />,
    },
  ];

  if (context.canViewPeople && context.scopeLevel !== "SELF_ONLY") {
    lenses.push({
      value: "team",
      label: "Team health",
      title: "Team health",
      copy: "Use the people table for coaching, bottom-performer review, and outlier checks across the employees in your authorised scope.",
      icon: <UsersRound className="h-4 w-4" aria-hidden="true" />,
    });
  }

  if (["ORG_ALL", "BRANCH_ALL", "PROCESS_ALL", "CUSTOM_SCOPE"].includes(context.scopeLevel)) {
    lenses.push({
      value: "operations",
      label: "Operations lens",
      title: "Operations lens",
      copy: "Compare branch and process movement, data freshness, verified formula coverage, and source gaps before making staffing or performance decisions.",
      icon: <Building2 className="h-4 w-4" aria-hidden="true" />,
    });
  }

  return lenses;
}

export function defaultPerformanceLens(context: PerformanceContext): string {
  if (context.scopeLevel === "SELF_ONLY") return "self";
  if (["ORG_ALL", "BRANCH_ALL", "CUSTOM_SCOPE"].includes(context.scopeLevel)) {
    return "operations";
  }
  return "team";
}

export function PerformanceRoleLens({ context }: { context: PerformanceContext }) {
  const lenses = lensesFor(context);

  return (
    <section className="rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-4 shadow-[var(--shadow-xs)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Role lens</p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{roleTitle(context)}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
            Scope: {context.scopeLabel}. Values below follow backend row scope, so a user only sees the employees, process, or branch they are allowed to review.
          </p>
          <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">Focus: {roleFocus(context)}</p>
        </div>
        <div className="inline-flex min-h-11 items-center gap-2 rounded-[var(--r-md)] border border-[var(--brand-200)] bg-[var(--brand-50)] px-3 text-sm font-semibold text-[var(--brand-700)]">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Source scoped
        </div>
      </div>

      <Tabs defaultValue={defaultPerformanceLens(context)} className="mt-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 rounded-[var(--r-md)] bg-[var(--surface-1)] p-1">
          {lenses.map((lens) => (
            <TabsTrigger key={lens.value} value={lens.value} className="min-h-10 gap-2 rounded-[var(--r-sm)] px-3">
              {lens.icon}
              {lens.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {lenses.map((lens) => (
          <TabsContent key={lens.value} value={lens.value} className="mt-3 rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-sm)] border border-[var(--border-hairline)] bg-[var(--surface-0)] text-[var(--brand-700)]">
                {lens.value === "operations" ? <BriefcaseBusiness className="h-4 w-4" aria-hidden="true" /> : <BarChart3 className="h-4 w-4" aria-hidden="true" />}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">{lens.title}</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{lens.copy}</p>
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
