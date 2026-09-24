import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useProcessLobOptions } from "@/hooks/useProcessLobMap";
import { useLOBs } from "@/hooks/useOrgMasters";

export const LOB_ALL = "__all__";
/** Sentinel the roster endpoints understand as "employees with no LOB". */
export const LOB_NONE = "__none__";

export interface LobSelectProps {
  processId: string;
  /** "" = All LOBs, LOB_NONE = unassigned, otherwise a LOB uuid. */
  value: string;
  onChange: (lobId: string) => void;
  includeUnassigned?: boolean;
  className?: string;
}

interface LobChoice { id: string; name: string }

/** Pure helper (unit-tested): shape whichever source we have into select choices. */
export function toLobChoices(
  processOptions: Array<{ lob_id: string; lob_name: string }> | undefined,
  allLobs: Array<{ id: string; lob_name?: string; name?: string }> | undefined,
  hasProcess: boolean,
): LobChoice[] {
  if (hasProcess && processOptions) return processOptions.map((o) => ({ id: o.lob_id, name: o.lob_name }));
  return (allLobs ?? []).map((l) => ({ id: l.id, name: l.lob_name ?? l.name ?? l.id }));
}

/**
 * LOB filter. With a process selected it lists that process's mapped LOBs; otherwise all
 * active LOBs. The process-lob mapping endpoint is role-gated, so if it fails we fall back
 * to the org LOB list rather than hiding the control.
 */
export function LobSelect({ processId, value, onChange, includeUnassigned = false, className }: LobSelectProps) {
  const hasProcess = processId.trim().length > 0;
  const processLobs = useProcessLobOptions(processId);
  const orgLobs = useLOBs();
  const useProcessList = hasProcess && !processLobs.isError;
  const choices = toLobChoices(
    processLobs.data?.options,
    orgLobs.data as Array<{ id: string; lob_name?: string }> | undefined,
    useProcessList,
  );
  const loading = useProcessList ? processLobs.isLoading : orgLobs.isLoading;

  return (
    <Select
      value={value || LOB_ALL}
      onValueChange={(v) => onChange(v === LOB_ALL ? "" : v)}
      disabled={loading && choices.length === 0}
    >
      <SelectTrigger className={className} aria-label="LOB">
        <SelectValue placeholder="All LOBs" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={LOB_ALL}>All LOBs</SelectItem>
        {choices.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
        {includeUnassigned && <SelectItem value={LOB_NONE}>Unassigned (no LOB)</SelectItem>}
      </SelectContent>
    </Select>
  );
}
