/**
 * Processes carrying quality scores that no approved target governs.
 *
 * The quality-governance API has existed and worked for some time — 13 endpoints, correct
 * SQL, RBAC held by real users — but nothing in the product ever called it, so the gap it
 * measures was invisible and process_quality_target still holds zero rows. This surfaces the
 * read-only half of it: which processes are scoring agents against a bar nobody approved.
 *
 * DELIBERATELY read-only. Authoring and approving targets is the other half of that API
 * (draft -> submit -> approve -> activate) and is not exposed here.
 *
 * The one rule this component must never break: a failed check must not render as "no gaps".
 * A green "every process has a target" panel produced by a 500 is worse than no panel, and it
 * is the same silent-zero failure that let broken dashboards sit at a confident zero for
 * months. Loading, forbidden, failed and genuinely-empty are four distinct states here.
 */
import { useQuery } from "@tanstack/react-query";
import { Target, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { hrmsApi, getHrmsApiErrorStatus } from "@/lib/hrmsApi";

interface MissingTargetProcess {
  processId: string;
  processName: string;
  employeesWithQuality: number;
}

interface MissingTargetResponse {
  success: boolean;
  data: MissingTargetProcess[];
  totalEmployeesAffected: number;
}

export function QualityTargetGapCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["quality-governance", "targets-missing"],
    queryFn: async () =>
      hrmsApi.get<MissingTargetResponse>("/api/quality-governance/targets/missing"),
    // A 403 means this viewer is not a health viewer — that is an answer, not a fault worth
    // retrying. Anything else may be transient.
    retry: (failureCount, err) => getHrmsApiErrorStatus(err) !== 403 && failureCount < 2,
  });

  // Not permitted for this role: render nothing rather than an alarming error tile. The
  // endpoint's own role list is the authority; the page gate is broader than it.
  if (getHrmsApiErrorStatus(error) === 403) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Target className="h-4 w-4 text-primary" />
          Processes without an approved quality target
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Checking target coverage…</p>}

        {/* Explicitly NOT an empty state. We do not know the answer, and saying "none" here
            would invent one. */}
        {!isLoading && error && (
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-muted-foreground">
              Target coverage could not be checked — {error instanceof Error ? error.message : "request failed"}.
              This is not a statement that coverage is complete.
            </p>
          </div>
        )}

        {!isLoading && !error && data && data.data.length === 0 && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <p className="text-muted-foreground">
              Every process with quality scores in the last 30 days has an approved target.
            </p>
          </div>
        )}

        {!isLoading && !error && data && data.data.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{data.totalEmployeesAffected.toLocaleString()}</span>{" "}
              {data.totalEmployeesAffected === 1 ? "employee is" : "employees are"} being scored on quality in{" "}
              <span className="font-medium text-foreground">{data.data.length}</span>{" "}
              {data.data.length === 1 ? "process" : "processes"} with no approved target to score against.
            </p>
            <ul className="divide-y divide-border/60 rounded-md border border-border/60">
              {data.data.map((p) => (
                <li key={p.processId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate text-sm">{p.processName}</span>
                  <Badge variant="secondary" className="shrink-0">
                    {p.employeesWithQuality.toLocaleString()}{" "}
                    {p.employeesWithQuality === 1 ? "employee" : "employees"}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
