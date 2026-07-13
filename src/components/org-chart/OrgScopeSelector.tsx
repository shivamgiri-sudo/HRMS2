import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Users, Network, MapPin, Globe } from "lucide-react";

export type OrgChartScope = "my-chain" | "my-team" | "process" | "branch" | "company";

interface ScopeOption {
  value: OrgChartScope;
  label: string;
  count: number;
  can_export: boolean;
  can_see_data_quality: boolean;
}

interface OrgScopeSelectorProps {
  availableScopes: ScopeOption[];
  currentScope: OrgChartScope;
  onScopeChange: (scope: OrgChartScope) => void;
  disabled?: boolean;
}

const SCOPE_ICONS: Record<OrgChartScope, React.ElementType> = {
  "my-chain": Users,
  "my-team": Users,
  process: Network,
  branch: Building2,
  company: Globe,
};

export function OrgScopeSelector({
  availableScopes,
  currentScope,
  onScopeChange,
  disabled = false,
}: OrgScopeSelectorProps) {
  if (availableScopes.length === 0) {
    return null;
  }

  // If only one scope, show as read-only
  if (availableScopes.length === 1) {
    const scope = availableScopes[0];
    const Icon = SCOPE_ICONS[scope.value];
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-xl border border-slate-200">
        <Icon className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-sm font-medium text-slate-700">{scope.label}</span>
        <span className="text-xs text-slate-400">({scope.count})</span>
      </div>
    );
  }

  return (
    <Select value={currentScope} onValueChange={(value) => onScopeChange(value as OrgChartScope)} disabled={disabled}>
      <SelectTrigger className="h-9 w-[200px] text-sm border-slate-200 rounded-xl">
        <SelectValue placeholder="Select scope" />
      </SelectTrigger>
      <SelectContent>
        {availableScopes.map((scope) => {
          const Icon = SCOPE_ICONS[scope.value];
          return (
            <SelectItem key={scope.value} value={scope.value}>
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-slate-500" />
                <span>{scope.label}</span>
                <span className="text-xs text-slate-400">({scope.count})</span>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
