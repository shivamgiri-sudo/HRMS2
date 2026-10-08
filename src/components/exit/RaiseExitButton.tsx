import { useState } from "react";
import { UserMinus } from "lucide-react";
import { toast } from "sonner";
import { RaiseExitDialog, type RaiseExitEmployee } from "./RaiseExitDialog";

/**
 * "Will not return / absconded / resigning" entry point for a reporting manager, placed next to a
 * team member wherever managers see their team. Opens the same form as Exit Command Center; the
 * exit it creates shows up there and continues through that flow.
 */
export function RaiseExitButton({
  employee,
  compact = false,
  className = "",
}: {
  employee: RaiseExitEmployee;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        title={`Raise exit for ${employee.name}`}
        aria-label={`Raise exit for ${employee.name}`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-1.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 ${className}`}
      >
        <UserMinus className="h-3 w-3" aria-hidden />
        {!compact && "Raise exit"}
      </button>
      {open && (
        <RaiseExitDialog
          employee={employee}
          onClose={() => setOpen(false)}
          onSubmitted={() => toast.success(`Exit raised for ${employee.name} - now in Exit Command Center`)}
        />
      )}
    </>
  );
}

export default RaiseExitButton;
