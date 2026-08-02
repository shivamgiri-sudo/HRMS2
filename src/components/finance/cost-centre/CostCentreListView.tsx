import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Plus, Search, Eye, Pencil, RefreshCw } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { useCostCentreList, useCostCentreStatusCounts, type CostCentreRecord, type CostCentreStatus } from "@/hooks/useCostCentreManagement";
import { useHasRole } from "@/hooks/useUserRole";
import { cn } from "@/lib/utils";

interface CostCentreListViewProps {
  onView: (cc: CostCentreRecord) => void;
  onEdit: (cc: CostCentreRecord) => void;
  onCreate: () => void;
}

const statusFilters: { value: CostCentreStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "pending_l1", label: "Pending L1" },
  { value: "pending_l2", label: "Pending L2" },
  { value: "approved", label: "Approved" },
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
  { value: "rejected", label: "Rejected" },
  { value: "revision_required", label: "Revision Required" },
];

export function CostCentreListView({ onView, onEdit, onCreate }: CostCentreListViewProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CostCentreStatus | "all">("all");
  const [page, setPage] = useState(1);

  const { data: listData, isLoading, refetch } = useCostCentreList({
    q: search || undefined,
    status: statusFilter,
    page,
    limit: 20,
  });

  const { data: statusCounts } = useCostCentreStatusCounts();

  // useHasRole, not user.role: HrmsUser carries only { id, email, isReadOnly },
  // so `user?.role` was always undefined and nobody could create or edit.
  const canCreate = useHasRole("finance_head", "accounts_head", "admin", "super_admin");

  const canEditRecord = (cc: CostCentreRecord) => {
    return ["draft", "revision_required"].includes(cc.status) && canCreate;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search cost centres..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-8 w-[300px]"
            />
          </div>
          <Button variant="ghost" size="icon" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        {canCreate && (
          <Button onClick={onCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New Cost Centre
          </Button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        {statusFilters.map((sf) => {
          const count = sf.value === "all" ? listData?.total : statusCounts?.[sf.value] ?? 0;
          return (
            <Button
              key={sf.value}
              variant={statusFilter === sf.value ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setStatusFilter(sf.value);
                setPage(1);
              }}
              className={cn("gap-2", statusFilter === sf.value && "bg-primary")}
            >
              {sf.label}
              {count !== undefined && count > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs">{count}</span>
              )}
            </Button>
          );
        })}
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Process</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : !listData?.data?.length ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No cost centres found
                </TableCell>
              </TableRow>
            ) : (
              listData.data.map((cc) => (
                <TableRow key={cc.id}>
                  <TableCell className="font-medium">{cc.cost_centre_code}</TableCell>
                  <TableCell>{cc.cost_centre_name}</TableCell>
                  <TableCell>{cc.client_name ?? "-"}</TableCell>
                  <TableCell>{cc.branch_name ?? "-"}</TableCell>
                  <TableCell>{cc.process_name ?? "-"}</TableCell>
                  <TableCell>
                    <StatusBadge status={cc.status} />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onView(cc)}>
                          <Eye className="h-4 w-4 mr-2" />
                          View
                        </DropdownMenuItem>
                        {canEditRecord(cc) && (
                          <DropdownMenuItem onClick={() => onEdit(cc)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {listData && listData.total > listData.limit && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * listData.limit + 1} to {Math.min(page * listData.limit, listData.total)} of {listData.total}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * listData.limit >= listData.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
