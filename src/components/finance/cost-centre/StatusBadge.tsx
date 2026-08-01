import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CostCentreStatus } from "@/hooks/useCostCentreManagement";

const statusConfig: Record<CostCentreStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className?: string }> = {
  draft: { label: "Draft", variant: "secondary" },
  pending_l1: { label: "Pending L1", variant: "outline", className: "border-amber-500 text-amber-600" },
  pending_l2: { label: "Pending L2", variant: "outline", className: "border-blue-500 text-blue-600" },
  approved: { label: "Approved", variant: "outline", className: "border-green-500 text-green-600" },
  active: { label: "Active", variant: "default", className: "bg-green-600" },
  closed: { label: "Closed", variant: "secondary", className: "bg-gray-400" },
  rejected: { label: "Rejected", variant: "destructive" },
  revision_required: { label: "Revision Required", variant: "outline", className: "border-orange-500 text-orange-600" },
};

interface StatusBadgeProps {
  status: CostCentreStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] ?? { label: status, variant: "secondary" as const };
  return (
    <Badge variant={config.variant} className={cn(config.className, className)}>
      {config.label}
    </Badge>
  );
}
