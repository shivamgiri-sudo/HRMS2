import type { FC } from "react";

type ReportStatus =
  | "REQUESTED"
  | "QUEUED"
  | "PROCESSING"
  | "GENERATED"
  | "EMAILED"
  | "DELIVERY_FAILED"
  | "GENERATION_FAILED"
  | "CANCELLED"
  | "EXPIRED";

const CONFIG: Record<ReportStatus, { label: string; className: string }> = {
  REQUESTED:         { label: "Requested",        className: "bg-slate-100 text-slate-700" },
  QUEUED:            { label: "Queued",            className: "bg-blue-100 text-blue-700" },
  PROCESSING:        { label: "Processing",        className: "bg-yellow-100 text-yellow-800" },
  GENERATED:         { label: "Generated",         className: "bg-indigo-100 text-indigo-700" },
  EMAILED:           { label: "Emailed",           className: "bg-emerald-100 text-emerald-700" },
  DELIVERY_FAILED:   { label: "Delivery Failed",   className: "bg-red-100 text-red-700" },
  GENERATION_FAILED: { label: "Generation Failed", className: "bg-red-100 text-red-700" },
  CANCELLED:         { label: "Cancelled",         className: "bg-gray-100 text-gray-500" },
  EXPIRED:           { label: "Expired",           className: "bg-gray-100 text-gray-400" },
};

interface Props {
  status: string;
  className?: string;
}

const RequestStatusBadge: FC<Props> = ({ status, className = "" }) => {
  const cfg = CONFIG[status as ReportStatus] ?? { label: status, className: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.className} ${className}`}>
      {cfg.label}
    </span>
  );
};

export default RequestStatusBadge;
