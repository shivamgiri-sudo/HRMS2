import { Users } from "lucide-react";
import { EmptyState } from "@/components/enterprise/EmptyState";
import { KpiCard } from "@/components/enterprise/KpiCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PerformanceMetric, PerformancePeople } from "@/types/performanceHub";

function metricValue(metrics: PerformanceMetric[], code: string): string {
  const metric = metrics.find((item) => item.metricCode === code);
  if (!metric || metric.value === null) return "—";
  if (metric.unit === "percent") return `${metric.value.toLocaleString("en-IN")}%`;
  if (metric.unit === "seconds") return `${metric.value.toLocaleString("en-IN")} sec`;
  if (metric.unit === "currency") return `₹${metric.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  return metric.value.toLocaleString("en-IN");
}

function visibleMetrics(people: PerformancePeople): PerformanceMetric[] {
  const catalog = new Map<string, PerformanceMetric>();
  for (const person of people.rows) {
    for (const metric of person.metrics) {
      if (!catalog.has(metric.metricCode)) catalog.set(metric.metricCode, metric);
    }
  }
  return [...catalog.values()]
    .sort((left, right) => left.displayOrder - right.displayOrder || left.label.localeCompare(right.label))
    .slice(0, 5);
}

export function PerformancePeopleTable({
  people,
  loading,
}: {
  people: PerformancePeople | undefined;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <KpiCard key={index} title="Loading employee" value="" loading />
        ))}
      </div>
    );
  }

  if (!people || people.rows.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-6 w-6" />}
        title="No employees in this scope"
        description="The server did not return any active employees for your assigned team, process, or branch."
      />
    );
  }

  const metrics = visibleMetrics(people);

  return (
    <section className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] shadow-[var(--shadow-xs)]">
      <div className="border-b border-[var(--border-hairline)] px-4 py-4">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">People performance</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {people.total.toLocaleString("en-IN")} active employees in your authorised scope
        </p>
      </div>
      <div className="hidden overflow-x-auto md:block">
        <Table aria-label="Team performance">
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Process</TableHead>
              {metrics.map((metric) => <TableHead key={metric.metricCode}>{metric.label}</TableHead>)}
              <TableHead>Achievement</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.rows.map((person) => (
              <TableRow key={person.employeeId}>
                <TableCell>
                  <p className="font-semibold text-[var(--text-primary)]">{person.employeeName}</p>
                  <p className="text-xs text-[var(--text-muted)]">{person.employeeCode}</p>
                </TableCell>
                <TableCell>
                  <p>{person.processName ?? "—"}</p>
                  <p className="text-xs text-[var(--text-muted)]">{person.branchName ?? "—"}</p>
                </TableCell>
                {metrics.map((metric) => (
                  <TableCell key={metric.metricCode} className="tabular-nums">
                    {metricValue(person.metrics, metric.metricCode)}
                  </TableCell>
                ))}
                <TableCell className="font-semibold tabular-nums">
                  {person.overallAchievementPct === null
                    ? "—"
                    : `${person.overallAchievementPct.toLocaleString("en-IN")}%`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-3 p-3 md:hidden">
        {people.rows.map((person) => (
          <article key={person.employeeId} className="rounded-[var(--r-md)] border border-[var(--border-hairline)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-[var(--text-primary)]">{person.employeeName}</h3>
                <p className="text-xs text-[var(--text-muted)]">
                  {person.employeeCode} · {person.processName ?? "No process"}
                </p>
              </div>
              <span className="font-semibold tabular-nums text-[var(--brand-700)]">
                {person.overallAchievementPct === null ? "—" : `${person.overallAchievementPct}%`}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              {metrics.slice(0, 4).map((metric) => (
                <div key={metric.metricCode}>
                  <dt className="text-[var(--text-muted)]">{metric.label}</dt>
                  <dd>{metricValue(person.metrics, metric.metricCode)}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
