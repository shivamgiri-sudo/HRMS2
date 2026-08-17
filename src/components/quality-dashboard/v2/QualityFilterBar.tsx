import { RefreshCcw } from "lucide-react";
import type { ClientRow } from "./types";
import { clientLabel } from "./types";

interface Props {
  from: string;
  to: string;
  clientId: string;
  granularity: "day" | "week";
  clients: ClientRow[];
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onClient: (v: string) => void;
  onGranularity: (v: "day" | "week") => void;
  onRefresh: () => void;
}

export function QualityFilterBar({
  from, to, clientId, granularity, clients,
  onFrom, onTo, onClient, onGranularity, onRefresh,
}: Props) {
  return (
    <div className="flex flex-wrap items-end gap-2.5 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-sm">
      {/* Date range */}
      {([{ label: "From", value: from, setter: onFrom }, { label: "To", value: to, setter: onTo }] as const).map(
        ({ label, value, setter }) => (
          <div key={label} className="flex flex-col gap-0.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</label>
            <input
              type="date"
              value={value}
              onChange={(e) => setter(e.target.value)}
              className="h-8 rounded-lg border border-slate-200 px-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300 cursor-pointer"
            />
          </div>
        ),
      )}

      {/* Client filter */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Client</label>
        <select
          value={clientId}
          onChange={(e) => onClient(e.target.value)}
          className="h-8 rounded-lg border border-slate-200 px-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300 cursor-pointer"
        >
          <option value="">All Clients</option>
          {clients.map((c) => (
            <option key={c.client_id} value={c.client_id}>
              {clientLabel(c)}
            </option>
          ))}
        </select>
      </div>

      {/* Granularity toggle */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Granularity</label>
        <div className="flex h-8 gap-0.5 rounded-lg border border-slate-200 p-0.5">
          {(["day", "week"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onGranularity(g)}
              className={`cursor-pointer rounded-md px-3 text-xs font-semibold capitalize transition-colors ${
                granularity === g
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Refresh */}
      <button
        type="button"
        onClick={onRefresh}
        className="ml-auto flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
      >
        <RefreshCcw className="h-3.5 w-3.5" /> Refresh
      </button>
    </div>
  );
}
