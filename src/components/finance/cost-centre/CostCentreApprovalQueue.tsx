import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Eye, RefreshCw } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { useCostCentreApprovalQueue, type CostCentreRecord } from "@/hooks/useCostCentreManagement";
import { formatDistanceToNow } from "date-fns";

interface CostCentreApprovalQueueProps {
  onReview: (cc: CostCentreRecord) => void;
}

export function CostCentreApprovalQueue({ onReview }: CostCentreApprovalQueueProps) {
  const { data: queue, isLoading, refetch } = useCostCentreApprovalQueue();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Approval Queue</h3>
          <p className="text-sm text-muted-foreground">
            Cost centres awaiting your approval action
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Submitted By</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : !queue?.length ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No items pending approval
                </TableCell>
              </TableRow>
            ) : (
              queue.map((cc) => (
                <TableRow key={cc.id}>
                  <TableCell className="font-medium">{cc.cost_centre_code}</TableCell>
                  <TableCell>{cc.cost_centre_name}</TableCell>
                  <TableCell>{cc.client_name ?? "-"}</TableCell>
                  <TableCell>{cc.branch_name ?? "-"}</TableCell>
                  <TableCell>{cc.submitted_by_name ?? "-"}</TableCell>
                  <TableCell>
                    {cc.submitted_at ? (
                      <span className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(cc.submitted_at), { addSuffix: true })}
                      </span>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={cc.status} />
                  </TableCell>
                  <TableCell>
                    <Button size="sm" onClick={() => onReview(cc)}>
                      <Eye className="h-4 w-4 mr-2" />
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {queue && queue.length > 0 && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <Badge variant="outline" className="gap-1">
            <span className="font-medium">{queue.filter((q) => q.status === "pending_l1").length}</span> Pending L1
          </Badge>
          <Badge variant="outline" className="gap-1">
            <span className="font-medium">{queue.filter((q) => q.status === "pending_l2").length}</span> Pending L2
          </Badge>
        </div>
      )}
    </div>
  );
}
