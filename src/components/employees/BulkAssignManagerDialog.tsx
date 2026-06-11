import { useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Users } from "lucide-react";
import { Employee } from "./EmployeeTable";

interface BulkAssignManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Employee[];
  onSuccess?: () => void;
}

export function BulkAssignManagerDialog({
  open,
  onOpenChange,
  employees,
  onSuccess,
}: BulkAssignManagerDialogProps) {
  const queryClient = useQueryClient();
  const [selectedManagerId, setSelectedManagerId] = useState<string>("");

  // Fetch managers (active employees who can be managers)
  const { data: managers = [], isLoading: isLoadingManagers } = useQuery({
    queryKey: ["managers"],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/employees");
      return res.data ?? [];
    },
    enabled: open,
  });

  // Filter out employees being assigned from manager list
  const employeeIds = employees.map((e) => e.id);
  const availableManagers = managers.filter((mgr) => !employeeIds.includes(mgr.id));

  const assignManagerMutation = useMutation({
    mutationFn: async ({ employeeIds, managerId }: { employeeIds: string[]; managerId: string }) => {
      await Promise.all(
        employeeIds.map((id) =>
          hrmsApi.patch(`/api/employees/${id}`, { reporting_manager_id: managerId })
        )
      );
      return { updatedCount: employeeIds.length };
    },
    onSuccess: ({ updatedCount }) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success(`Reporting manager assigned to ${updatedCount} employee${updatedCount > 1 ? "s" : ""}`);
      setSelectedManagerId("");
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(`Failed to assign manager: ${error.message}`);
    },
  });

  const handleAssign = () => {
    if (!selectedManagerId) {
      toast.error("Please select a reporting manager");
      return;
    }
    assignManagerMutation.mutate({
      employeeIds: employeeIds,
      managerId: selectedManagerId,
    });
  };

  const selectedManager = managers.find((m) => m.id === selectedManagerId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Assign Reporting Manager
          </DialogTitle>
          <DialogDescription>
            Assign a reporting manager to {employees.length} selected employee
            {employees.length > 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Selected employees preview */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Selected Employees</Label>
            <div className="max-h-32 overflow-y-auto rounded-md border bg-muted/50 p-3">
              <ul className="space-y-1 text-sm">
                {employees.slice(0, 5).map((emp) => (
                  <li key={emp.id} className="text-muted-foreground">
                    {emp.name}
                  </li>
                ))}
                {employees.length > 5 && (
                  <li className="text-muted-foreground font-medium">
                    ... and {employees.length - 5} more
                  </li>
                )}
              </ul>
            </div>
          </div>

          {/* Manager selection */}
          <div className="space-y-2">
            <Label htmlFor="manager">Reporting Manager *</Label>
            <Select
              value={selectedManagerId}
              onValueChange={setSelectedManagerId}
              disabled={isLoadingManagers}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a manager" />
              </SelectTrigger>
              <SelectContent>
                {availableManagers.map((mgr) => (
                  <SelectItem key={mgr.id} value={mgr.id}>
                    {mgr.first_name} {mgr.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableManagers.length === 0 && !isLoadingManagers && (
              <p className="text-xs text-muted-foreground">
                No available managers found. Managers cannot be assigned to themselves.
              </p>
            )}
          </div>

          {selectedManager && (
            <div className="rounded-md border bg-primary/5 p-3">
              <p className="text-sm">
                <span className="font-medium">{selectedManager.first_name} {selectedManager.last_name}</span>{" "}
                will be assigned as the reporting manager for{" "}
                <span className="font-medium">{employees.length} employee{employees.length > 1 ? "s" : ""}</span>.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={assignManagerMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleAssign}
            disabled={!selectedManagerId || assignManagerMutation.isPending}
          >
            {assignManagerMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Assign Manager
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
