import type { TallyExportStatus } from "@/lib/tallyVoucherApi";

const LABEL: Record<TallyExportStatus, string> = {
  not_exported: "Not exported",
  exported_unchanged: "Exported",
  changed_since_export: "Changed - will alter",
};

const TONE: Record<TallyExportStatus, string> = {
  not_exported: "bg-slate-100 text-slate-600",
  exported_unchanged: "bg-emerald-100 text-emerald-800",
  changed_since_export: "bg-amber-100 text-amber-800",
};

/** "Posted to Tally" status for one voucher. */
export function ExportStatusBadge({ status }: { status: TallyExportStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${TONE[status]}`}
    >
      {LABEL[status]}
    </span>
  );
}
