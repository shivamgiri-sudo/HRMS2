/** The "Confirmed to attend" list of one drive in a side sheet (opened from a Walk-in board card). Write buttons for write roles only. */
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import ConfirmedList from "./ConfirmedList";
import { canWriteHe } from "./responsesModel";

export default function ConfirmedSheet({ driveId, title, onClose }: { driveId: string | null; title: string; onClose: () => void }) {
  const { roleKeys, isResolved } = useWorkforceAccess();
  return (
    <Sheet open={driveId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="text-slate-700 dark:text-slate-200">Who said they will come, how they said it, and who has arrived. Print it as the desk checklist.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 pb-8">{driveId && <ConfirmedList driveId={driveId} canWrite={isResolved && canWriteHe(roleKeys)} headingLevel="h3" />}</div>
      </SheetContent>
    </Sheet>
  );
}
