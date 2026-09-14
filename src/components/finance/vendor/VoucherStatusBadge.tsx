// src/components/finance/vendor/VoucherStatusBadge.tsx
import { CheckCircle2, Circle, Clock, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  STAGE_BAR, STAGE_TEXT, STATUS_LABEL, STATUS_TONE,
  dateTime, type Stage, type StageState, type VoucherStatus,
} from "@/lib/finance/paymentVoucherStatus";

/**
 * One voucher status, rendered identically wherever it appears — the vouchers grid, the
 * Vendor Payment Dispatch grid, and the shared drawer header.
 */
export function VoucherStatusBadge({ status, className }: { status: VoucherStatus; className?: string }) {
  return (
    <Badge className={cn(STATUS_TONE[status], className)}>{STATUS_LABEL[status]}</Badge>
  );
}

export function StageIcon({ state }: { state: StageState }) {
  if (state === "done") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />;
  if (state === "rejected") return <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden />;
  if (state === "current") return <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />;
  return <Circle className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />;
}

export function ApprovalTrack({ stages }: { stages: Stage[] }) {
  return (
    <ol className="flex items-stretch gap-2" aria-label="Voucher approval progress">
      {stages.map((s) => (
        <li key={s.key} className="min-w-0 flex-1">
          <div className={cn("h-1 rounded-full transition-colors duration-200", STAGE_BAR[s.state])} />
          <div className="mt-1.5 flex items-center gap-1">
            <StageIcon state={s.state} />
            <span className={cn("truncate text-[10px] font-bold uppercase tracking-wide", STAGE_TEXT[s.state])}>{s.label}</span>
          </div>
          <p className="mt-0.5 truncate text-[11px] leading-tight text-slate-500">
            {s.state === "upcoming" ? "Not yet reached" : s.state === "current" ? "Awaiting decision" : (dateTime(s.at) !== "—" ? dateTime(s.at) : (s.state === "rejected" ? "Rejected" : "Done"))}
          </p>
        </li>
      ))}
    </ol>
  );
}
