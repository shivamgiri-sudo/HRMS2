import { AlertTriangle, ShieldAlert } from "lucide-react";
import { fmtInt } from "./format";
import type { ComplianceSummary, DrawerTarget, FeedKind } from "./types";

export interface ComplianceAlert { key: string; severity: "high" | "medium"; text: string; action: () => void }

/** Severity-ordered alerts derived from the summary; each is click-to-filter or click-to-drill. */
export function buildAlerts(
  s: ComplianceSummary | undefined,
  o: { filterRule: (ruleId: string, kind: FeedKind) => void; open: (t: DrawerTarget) => void },
): ComplianceAlert[] {
  if (!s || !s.hasData) return [];
  const alerts: ComplianceAlert[] = [];
  for (const r of s.rules) {
    if (r.violationCount > 0) {
      alerts.push({ key: r.ruleId, severity: r.severity === "high" ? "high" : "medium", text: `${r.ruleName}: ${fmtInt(r.violationCount)} incidents, ${fmtInt(r.employeesAffected)} employees`, action: () => o.filterRule(r.ruleId, "roster") });
    }
  }
  for (const b of s.byBranch) {
    if (b.score !== null && b.score < 75) {
      alerts.push({ key: `b-${b.branchId}`, severity: "high", text: `${b.branchName} is below 75% compliance (${b.score}%)`, action: () => o.open({ type: "branch", id: b.branchId }) });
    }
  }
  if (s.attendance && s.attendance.unreconciled > 0) {
    alerts.push({ key: "unrec", severity: "medium", text: `${fmtInt(s.attendance.unreconciled)} rostered days have no reconciled attendance`, action: () => o.filterRule("UNRECONCILED", "attendance") });
  }
  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}

export function ComplianceAlertStrip({ alerts }: { alerts: ComplianceAlert[] }) {
  if (!alerts.length) return null;
  const high = alerts.filter((a) => a.severity === "high").length;
  return (
    <section aria-label="Compliance alerts" className="mb-3 rounded-lg border border-border bg-card p-3">
      <p className="mb-2 text-xs font-semibold text-slate-700">{alerts.length} alerts, {high} high severity. Select one to filter or drill down.</p>
      <ul className="flex flex-wrap gap-2">
        {alerts.map((a) => {
          const Icon = a.severity === "high" ? ShieldAlert : AlertTriangle;
          return (
            <li key={a.key}>
              <button type="button" onClick={a.action} className={`inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${a.severity === "high" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">{a.severity === "high" ? "High severity: " : "Medium severity: "}</span>{a.text}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
