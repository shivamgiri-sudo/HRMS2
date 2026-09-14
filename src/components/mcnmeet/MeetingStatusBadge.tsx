import { STATUS_COLORS, MEETING_STATUS_LABELS, type MeetingStatus } from "@/hooks/useMcnmeet";
import { cn } from "@/lib/utils";

export function MeetingStatusBadge({ status, className }: { status: MeetingStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_COLORS[status], className)}>
      {MEETING_STATUS_LABELS[status]}
    </span>
  );
}
