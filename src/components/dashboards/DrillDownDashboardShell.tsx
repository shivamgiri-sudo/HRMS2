import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Home, Inbox, Loader2, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

export type DrillLevel = "branch" | "process" | "team" | "analyst";

export interface DrillNodeMetric {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}

export interface DrillNode {
  id: string;
  name: string;
  secondaryLabel?: string | null;
  metrics: DrillNodeMetric[];
  hasChildren: boolean;
}

export interface DrillLevelResponse {
  level: DrillLevel;
  parentId: string | null;
  parentLabel: string | null;
  nodes: DrillNode[];
  asOf: string;
  rangeDays?: number;
  /** Passthrough of the page's original typed node array, for hero/chart/insights aggregation above the grid. */
  raw?: unknown[];
}

const LEVEL_ORDER: DrillLevel[] = ["branch", "process", "team", "analyst"];
const DEFAULT_LEVEL_LABELS: Record<DrillLevel, string> = {
  branch: "Branch",
  process: "Process",
  team: "Team",
  analyst: "Analyst",
};

const TONE_CLASSES: Record<NonNullable<DrillNodeMetric["tone"]>, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-rose-600 dark:text-rose-400",
  neutral: "text-foreground",
};

interface BreadcrumbStep {
  level: DrillLevel;
  id: string | null;
  label: string;
}

interface DrillDownDashboardShellProps {
  queryKeyPrefix: string;
  accentClassName?: string;
  levelLabels?: Partial<Record<DrillLevel, string>>;
  fetchLevel: (level: DrillLevel, parentId: string | null) => Promise<DrillLevelResponse>;
  onSelectAnalyst?: (node: DrillNode) => void;
  onData?: (data: DrillLevelResponse) => void;
  headerRight?: ReactNode;
}

/**
 * Shared branch → process → team → analyst drill-down grid used by both QualityDashboard
 * and OperationsDashboard. Scope enforcement lives entirely server-side (dashboardScope.ts
 * applied inside every level query) — a role with a narrower scope simply receives fewer
 * nodes at "branch" level and everything below it, so this shell always starts at branch
 * level and never needs role-specific branching logic itself.
 */
export function DrillDownDashboardShell({
  queryKeyPrefix,
  accentClassName = "from-primary/15 via-primary/5 to-transparent",
  levelLabels,
  fetchLevel,
  onSelectAnalyst,
  onData,
  headerRight,
}: DrillDownDashboardShellProps) {
  const [trail, setTrail] = useState<BreadcrumbStep[]>([{ level: "branch", id: null, label: "All Branches" }]);
  const current = trail[trail.length - 1];
  const labels = { ...DEFAULT_LEVEL_LABELS, ...levelLabels };

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: [queryKeyPrefix, current.level, current.id],
    queryFn: () => fetchLevel(current.level, current.id),
  });

  useEffect(() => {
    if (data) onData?.(data);
  }, [data, onData]);

  const drillInto = (node: DrillNode) => {
    const nextLevel = LEVEL_ORDER[LEVEL_ORDER.indexOf(current.level) + 1];
    if (!nextLevel || !node.hasChildren) {
      if (current.level === "team" && onSelectAnalyst) onSelectAnalyst(node);
      return;
    }
    setTrail([...trail, { level: nextLevel, id: node.id, label: node.name }]);
  };

  const handleNodeClick = (node: DrillNode) => {
    if (current.level === "analyst") {
      onSelectAnalyst?.(node);
      return;
    }
    if (current.level === "team" && !node.hasChildren) {
      onSelectAnalyst?.(node);
      return;
    }
    drillInto(node);
  };

  const jumpTo = (index: number) => setTrail(trail.slice(0, index + 1));

  const isSingle = !!data && data.nodes.length === 1;

  return (
    <div className="space-y-5" data-testid="drilldown-shell">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex items-center gap-1.5 text-sm" aria-label="Drill-down breadcrumb">
          {trail.map((step, index) => (
            <span key={`${step.level}-${step.id ?? "root"}`} className="flex items-center gap-1.5">
              {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden />}
              <button
                onClick={() => jumpTo(index)}
                disabled={index === trail.length - 1}
                aria-current={index === trail.length - 1 ? "page" : undefined}
                className={cn(
                  "rounded-2xl px-3 py-1.5 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                  index === trail.length - 1
                    ? "bg-primary/12 text-primary cursor-default"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer",
                )}
              >
                {index === 0 && <Home className="mr-1 inline h-3.5 w-3.5 -mt-0.5" aria-hidden />}
                {step.label}
              </button>
            </span>
          ))}
          {isFetching && !isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Refreshing" />}
        </nav>
        {headerRight}
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-3xl" />
          ))}
        </div>
      )}

      {isError && (
        <EmptyState
          icon={<Inbox className="h-6 w-6" />}
          title="Couldn't load this level"
          description="The dashboard data source didn't respond. Try again in a moment."
        />
      )}

      {!isLoading && !isError && data && data.nodes.length === 0 && (
        <EmptyState
          icon={<Inbox className="h-6 w-6" />}
          title={`No ${labels[current.level].toLowerCase()} data in your scope`}
          description="There's no data for this level within your assigned access, or nothing was recorded in the selected range."
        />
      )}

      {!isLoading && !isError && data && data.nodes.length > 0 && (
        <div className={cn("grid grid-cols-1 gap-4", isSingle ? "sm:grid-cols-1" : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4")}>
          {data.nodes.map((node) => {
            const summary = node.metrics.map((m) => `${m.label} ${m.value}`).join(", ");
            return (
              <button
                key={node.id}
                onClick={() => handleNodeClick(node)}
                aria-label={`${node.hasChildren ? "Open" : "View"} ${node.name} — ${summary}`}
                className={cn(
                  "group rounded-3xl text-left cursor-pointer",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                )}
              >
                <Card
                  className={cn(
                    "relative overflow-hidden rounded-3xl border border-primary/15",
                    "bg-gradient-to-br backdrop-blur-xl shadow-[0_1px_1px_rgba(0,0,0,0.03),0_18px_36px_-24px_hsl(var(--primary)/0.4)]",
                    "transition-all duration-200 ease-out",
                    "group-hover:-translate-y-1 group-hover:scale-[1.01] group-hover:border-primary/40",
                    "group-hover:shadow-[0_1px_1px_rgba(0,0,0,0.04),0_26px_44px_-20px_hsl(var(--primary)/0.55)]",
                    accentClassName,
                  )}
                >
                  <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/10 blur-2xl transition-opacity duration-200 group-hover:opacity-80" />
                  <CardContent className={cn("relative p-5", isSingle && "sm:p-7")}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={cn("truncate font-serif font-semibold", isSingle ? "text-xl sm:text-2xl" : "text-base")}>{node.name}</p>
                        {node.secondaryLabel && (
                          <p className="truncate text-xs text-muted-foreground">{node.secondaryLabel}</p>
                        )}
                      </div>
                      {node.hasChildren && (
                        <ChevronRight
                          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                          aria-hidden
                        />
                      )}
                    </div>
                    <div className={cn("mt-4 grid gap-x-4 gap-y-3", isSingle ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2")}>
                      {node.metrics.map((m) => (
                        <div key={m.label}>
                          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                            {m.label}
                          </p>
                          <p className={cn("font-semibold", isSingle ? "text-xl sm:text-2xl" : "text-sm", m.tone ? TONE_CLASSES[m.tone] : TONE_CLASSES.neutral)}>
                            {m.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DrillDownLoadingIcon() {
  return <Loader2 className="h-4 w-4 animate-spin" aria-hidden />;
}

export function DrillDownAgentCountBadge({ count }: { count: number }) {
  return (
    <Badge variant="secondary" className="gap-1">
      <Users className="h-3 w-3" aria-hidden /> {count}
    </Badge>
  );
}
