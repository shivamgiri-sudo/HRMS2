import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

interface FilterOptionsPayload {
  tlNames: string[];
  amNames: string[];
  tlAmMapping?: Record<string, string[]>;
}

const EMPTY_OPTIONS: FilterOptionsPayload = {
  tlNames: [],
  amNames: [],
  tlAmMapping: {},
};

/**
 * Shared AM -> TL cascading filter state for every Onfido tab. Selecting an AM
 * restricts the TL list to the TLs aligned to that AM in the selected date
 * range (they change month to month), and drops a previously chosen TL that
 * is no longer under that AM.
 */
export function useHierarchyFilters(range: { from: string; to: string }) {
  const [tlFilter, setTlFilter] = useState("");
  const [amFilter, setAmFilterState] = useState("");

  const query = useQuery({
    queryKey: ["onfido-process", "filter-options", range.from, range.to],
    queryFn: () =>
      hrmsApi.get<{ data: FilterOptionsPayload }>(
        `/api/onfido-process/filter-options?from=${range.from}&to=${range.to}`,
      ),
    enabled: range.from !== "" && range.to !== "" && range.from <= range.to,
    staleTime: 5 * 60 * 1000,
  });
  const options = query.data?.data ?? EMPTY_OPTIONS;

  const tlOptions =
    amFilter && options.tlAmMapping
      ? (options.tlAmMapping[amFilter] ?? [])
      : options.tlNames;

  const setAmFilter = useCallback(
    (am: string) => {
      setAmFilterState(am);
      setTlFilter((currentTl) => {
        if (!am || !currentTl) return currentTl;
        const aligned = options.tlAmMapping?.[am];
        return aligned && !aligned.includes(currentTl) ? "" : currentTl;
      });
    },
    [options.tlAmMapping],
  );

  const clear = useCallback(() => {
    setTlFilter("");
    setAmFilterState("");
  }, []);

  return {
    tlFilter,
    setTlFilter,
    amFilter,
    setAmFilter,
    tlOptions,
    amOptions: options.amNames,
    clear,
  };
}
