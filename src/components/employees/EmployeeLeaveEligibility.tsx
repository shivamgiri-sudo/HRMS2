import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useLeaveTypes } from "@/hooks/useLeaveRequests";
import { useLeaveEligibility, useUpdateLeaveEligibility } from "@/hooks/useLeaveEligibility";

interface Props {
  employeeId: string;
}

export interface EmployeeLeaveEligibilityHandle {
  save: () => Promise<void>;
}

export const EmployeeLeaveEligibility = forwardRef<EmployeeLeaveEligibilityHandle, Props>(
  ({ employeeId }, ref) => {
    const { data: leaveTypes, isLoading: loadingTypes } = useLeaveTypes();
    const { data: eligibility, isLoading: loadingElig } = useLeaveEligibility(employeeId);
    const updateMutation = useUpdateLeaveEligibility();

    const [selected, setSelected] = useState<Set<string>>(new Set());

    useEffect(() => {
      if (eligibility) {
        setSelected(new Set(eligibility.map((e) => e.leave_type_id)));
      }
    }, [eligibility]);

    useImperativeHandle(
      ref,
      () => ({
        save: async () => {
          await updateMutation.mutateAsync(
            { employeeId, leaveTypeIds: Array.from(selected) },
            { onSuccess: () => {} } // suppress default toast; parent handles success message
          );
        },
      }),
      [employeeId, selected, updateMutation]
    );

    const toggle = (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };

    const allIds = (leaveTypes ?? []).map((t) => t.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

    const toggleAll = () => {
      if (allSelected) {
        setSelected(new Set());
      } else {
        setSelected(new Set(allIds));
      }
    };

    if (loadingTypes || loadingElig) {
      return (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          Select which paid leave types this employee is eligible to apply for.
          <span className="block mt-1 text-xs">
            Unpaid Leave is always available to every employee and does not require allocation.
          </span>
        </div>

        {(leaveTypes ?? []).length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {selected.size} of {allIds.length} selected
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleAll}
            >
              {allSelected ? "Deselect All" : "Select All"}
            </Button>
          </div>
        )}

        <div className="space-y-2">
          {(leaveTypes ?? []).map((type) => {
            const checked = selected.has(type.id);
            return (
              <label
                key={type.id}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 cursor-pointer hover:bg-accent/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Checkbox checked={checked} onCheckedChange={() => toggle(type.id)} />
                  <div>
                    <div className="font-medium text-sm">{type.name}</div>
                    {type.description && (
                      <div className="text-xs text-muted-foreground">{type.description}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {type.days_per_year} days/yr
                  </Badge>
                  <Badge variant={type.is_paid ? "default" : "outline"} className="text-xs">
                    {type.is_paid ? "Paid" : "Unpaid"}
                  </Badge>
                </div>
              </label>
            );
          })}

          {(leaveTypes ?? []).length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-4">
              No leave types configured.
            </div>
          )}
        </div>
      </div>
    );
  }
);

EmployeeLeaveEligibility.displayName = "EmployeeLeaveEligibility";
