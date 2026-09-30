import { ChevronRight, Home, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OpsFilterOptions, OpsQuery } from "./opsTypes";

interface Crumb {
  key: "branchId" | "processId" | "lobId" | "managerId";
  kind: string;
  label: string;
}

interface Props {
  query: OpsQuery;
  options: OpsFilterOptions | undefined;
  onChange: (q: OpsQuery) => void;
}

const ORDER: Array<{ key: Crumb["key"]; kind: string; list: "branches" | "processes" | "lobs" | "managers" }> = [
  { key: "branchId", kind: "Branch", list: "branches" },
  { key: "processId", kind: "Process", list: "processes" },
  { key: "lobId", kind: "LOB", list: "lobs" },
  { key: "managerId", kind: "Team", list: "managers" },
];

/** Where you are in the drill: click any crumb to climb back up to that level. */
export function OpsScopeBar({ query, options, onChange }: Props) {
  const crumbs: Crumb[] = ORDER.filter((o) => query[o.key]).map((o) => ({
    key: o.key,
    kind: o.kind,
    label: query[o.key] === "__none__" ? `No ${o.kind.toLowerCase()}` : options?.[o.list].find((x) => x.id === query[o.key])?.name ?? "Selected",
  }));

  const climbTo = (index: number) => {
    const keep = new Set(crumbs.slice(0, index + 1).map((c) => c.key));
    const next: OpsQuery = { from: query.from, to: query.to };
    for (const o of ORDER) if (keep.has(o.key)) next[o.key] = query[o.key];
    onChange(next);
  };

  return (
    <nav aria-label="Drill path" className="flex flex-wrap items-center gap-1 text-sm">
      <button type="button" onClick={() => onChange({ from: query.from, to: query.to })}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        <Home className="h-3.5 w-3.5" /> All in scope
      </button>
      {crumbs.map((c, i) => (
        <span key={c.key} className="inline-flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <button type="button" onClick={() => climbTo(i)}
            className="group inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={`${c.kind}: ${c.label}. Click to go back to this level`}>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{c.kind}</span>
            <span className="max-w-[220px] truncate font-medium">{c.label}</span>
          </button>
        </span>
      ))}
      {crumbs.length > 0 && (
        <Button variant="ghost" size="sm" className="ml-1 h-7 gap-1 px-2 text-xs text-muted-foreground" onClick={() => onChange({ from: query.from, to: query.to })}>
          <X className="h-3 w-3" /> Reset
        </Button>
      )}
    </nav>
  );
}
