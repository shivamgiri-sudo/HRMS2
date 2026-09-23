import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useProcessLobOptions } from "@/hooks/useProcessLobMap";

interface WfmLobFieldProps {
  processId: string;
  value: string;
  onChange: (lobId: string) => void;
  disabled?: boolean;
}

/**
 * LOB dropdown for the WFM alignment form. Options are the LOBs mapped to the chosen process;
 * a single mapped LOB is preselected. A process with no mapped LOB never blocks completion -
 * it shows a pointer to Process LOB Mapping instead.
 */
export function WfmLobField({ processId, value, onChange, disabled }: WfmLobFieldProps) {
  // The process is typed free-form in the alignment form; wait for typing to settle.
  const [settled, setSettled] = useState(processId);
  useEffect(() => {
    const t = setTimeout(() => setSettled(processId), 400);
    return () => clearTimeout(t);
  }, [processId]);
  const query = useProcessLobOptions(settled);
  const options = query.data?.options ?? [];

  useEffect(() => {
    if (options.length === 1 && !value) onChange(options[0].lob_id);
    if (value && query.data && !options.some((o) => o.lob_id === value)) onChange("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  return (
    <div>
      <Label htmlFor="wfm-lob">
        LOB <span className="text-slate-400 font-normal">(optional)</span>
      </Label>
      <div className="mt-1">
        <SearchableSelect
          id="wfm-lob"
          options={options.map((o) => ({ value: o.lob_id, label: o.lob_name, hint: o.lob_code }))}
          value={value}
          onChange={onChange}
          placeholder={processId.trim() ? "Select LOB" : "Enter a process first"}
          searchPlaceholder="Search LOB"
          emptyText="No LOB mapped"
          disabled={disabled || !processId.trim() || options.length === 0}
          loading={query.isFetching}
        />
      </div>
      {query.isFetching && !query.data ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading LOBs for this process
        </p>
      ) : null}
      {query.data && options.length === 0 ? (
        <p className="mt-1 text-xs text-amber-700">
          No LOB mapped for this process —{" "}
          <Link to="/wfm/process-lob-mapping" className="underline font-medium">
            add one in Process LOB Mapping
          </Link>
          . You can still complete this task.
        </p>
      ) : null}
      {query.isError ? (
        <p className="mt-1 text-xs text-slate-500">
          LOB options unavailable for this process value (check the Process ID). Completion is not blocked.
        </p>
      ) : null}
    </div>
  );
}
