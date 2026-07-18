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
import type { PerformanceMetricCode, PerformancePeople } from "@/types/performanceHub";

function metricValue(
  metrics: PerformancePeople["rows"][number]["metrics"],
  code: PerformanceMetricCode,
): string {
  const metric = metrics.find((item) => item.metricCode === code);
  if (!metric || metric.value === null) return "—";
  return `${metric.value.toLocaleString("en-IN")}${metric.unit === "percent" ? "%" : ""}`;
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

  return (
    <section className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] shadow-[var(--shadow-xs)]">
      <div className="border-b border-[var(--border-hairline)] px-4 py-4">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">People performance</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {people.total.toLocaleString("en-IN")} active employees in your authorised scope
        </p>
      </div>
      <div className="hidden md:block">
        <Table aria-label="Team performance">
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Process</TableHead>
              <TableHead>Calls</TableHead>
              <TableHead>AHT</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead>Conversion</TableHead>
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
                <TableCell>{metricValue(person.metrics, "CALLS")}</TableCell>
                <TableCell>{metricValue(person.metrics, "AHT")}</TableCell>
                <TableCell>{metricValue(person.metrics, "QUALITY_SCORE")}</TableCell>
                <TableCell>{metricValue(person.metrics, "CONVERSION_RATE")}</TableCell>
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
              <div><dt className="text-[var(--text-muted)]">Calls</dt><dd>{metricValue(person.metrics, "CALLS")}</dd></div>
              <div><dt className="text-[var(--text-muted)]">Quality</dt><dd>{metricValue(person.metrics, "QUALITY_SCORE")}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
