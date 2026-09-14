import type { ReactNode } from "react";
import { Loader } from "lucide-react";

type KpiTileProps = {
  icon?: ReactNode;
  label: string;
  value: number | string;
  color?: string;
  highlight?: boolean;
};

export function KpiTile({ icon, label, value, color = "text-gray-800", highlight }: KpiTileProps) {
  return (
    <div className={`bg-white border rounded-xl p-4 ${icon ? "flex items-center gap-3" : ""} ${highlight ? "border-red-200" : "border-gray-200"}`}>
      {icon && <div className={`p-2 rounded-lg ${highlight ? "bg-red-50" : "bg-gray-50"}`}>{icon}</div>}
      <div>
        <div className={`text-xl font-bold ${highlight ? "text-red-600" : color}`}>{value}</div>
        <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      </div>
    </div>
  );
}

type FilterFieldProps = {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  focusClass?: string;
};

export function FilterField({ label, type = "text", value, onChange, focusClass = "focus:ring-indigo-500" }: FilterFieldProps) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${focusClass}`}
      />
    </div>
  );
}

type SelectFilterProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  focusClass?: string;
  formatOption?: (value: string) => string;
};

export function SelectFilter({
  label,
  value,
  onChange,
  options,
  focusClass = "focus:ring-indigo-500",
  formatOption = (option) => option,
}: SelectFilterProps) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 ${focusClass}`}
      >
        <option value="">All</option>
        {options.map((option) => <option key={option} value={option}>{formatOption(option)}</option>)}
      </select>
    </div>
  );
}

export function DashboardLoading({ colorClass = "text-indigo-500" }: { colorClass?: string }) {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader size={28} className={`animate-spin ${colorClass}`} />
    </div>
  );
}

export function EmptyState({ icon, message }: { icon: ReactNode; message: string }) {
  return (
    <div className="text-center py-16 text-gray-400">
      <div className="mx-auto mb-3 opacity-30 flex justify-center">{icon}</div>
      <p>{message}</p>
    </div>
  );
}
