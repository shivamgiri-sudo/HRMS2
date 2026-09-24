import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDmy, type ApiFailure } from "./teamRosterFormat";

interface Props {
  failure: ApiFailure | null;
  /** employeeId -> display name, for problems that only carry an id */
  names: Record<string, string>;
  onClose: () => void;
}

/** Lists exactly which cells stopped a save/submit (validation, stale cells, or "pending with <manager>"). */
export default function SubmitProblemsDialog({ failure, names, onClose }: Props) {
  return (
    <Dialog open={!!failure} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{failure?.code === "CELL_PENDING" ? "Some dates are already pending" : "Could not continue"}</DialogTitle>
          <DialogDescription>{failure?.message}</DialogDescription>
        </DialogHeader>
        {failure && failure.details.length > 0 && (
          <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
            {failure.details.map((d, i) => (
              <li key={`${d.employeeId}-${d.date}-${i}`} className="rounded-md bg-slate-50 px-2.5 py-1.5">
                {(d.employeeName || (d.employeeId && names[d.employeeId])) && <span className="font-medium">{d.employeeName || names[d.employeeId!]}</span>}
                {d.date && <span className="text-slate-500"> {formatDmy(d.date)}</span>}
                <span className="block text-slate-700">{d.message}</span>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
