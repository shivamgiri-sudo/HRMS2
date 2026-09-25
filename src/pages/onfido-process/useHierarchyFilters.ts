import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export interface AnalystOption {
  email: string;
  name: string | null;
  tlName: string | null;
  amName: string | null;
}

interface FilterOptionsPayload {
  tlNames: string[];
  amNames: string[];
  tlAmMapping?: Record<string, string[]>;
  analysts?: AnalystOption[];
}

const EMPTY_OPTIONS: FilterOptionsPayload = {
  tlNames: [],
  amNames: [],
  tlAmMapping: {},
  analysts: [],
};

/**
 * Shared AM -> TL -> Analyst cascading filter state for every Onfido tab.
 * Selecting an AM restricts the TL list to the TLs aligned to that AM in the
 * selected date range (they change month to month); selecting a TL/AM restricts
 * the analyst list the same way. A previously chosen TL/analyst that falls out
 * of the new selection is dropped.
 */
export function useHierarchyFilters(range: { from: string; to: string }) {
  const [tlFilter, setTlFilterState] = useState("");
  const [amFilter, setAmFilterState] = useState("");
  const [analystFilter, setAnalystFilter] = useState("");

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
  const allAnalysts = options.analysts ?? [];

  const tlOptions =
    amFilter && options.tlAmMapping
      ? (options.tlAmMapping[amFilter] ?? [])
      : options.tlNames;

  const analystOptions = allAnalysts
    .filter(
      (a) =>
        (!tlFilter || a.tlName === tlFilter) &&
        (!amFilter || a.amName === amFilter),
    )
    .filter((a, i, list) => list.findIndex((b) => b.email === a.email) === i);

  const keepAnalystIfStillListed = useCallback(
    (tl: string, am: string) => {
      setAnalystFilter((currentAnalyst) => {
        if (!currentAnalyst) return currentAnalyst;
        const stillListed = allAnalysts.some(
          (a) =>
            a.email === currentAnalyst &&
            (!tl || a.tlName === tl) &&
            (!am || a.amName === am),
        );
        return stillListed ? currentAnalyst : "";
      });
    },
    [allAnalysts],
  );

  const setAmFilter = useCallback(
    (am: string) => {
      setAmFilterState(am);
      let nextTl = tlFilter;
      if (am && tlFilter) {
        const aligned = options.tlAmMapping?.[am];
        if (aligned && !aligned.includes(tlFilter)) nextTl = "";
      }
      setTlFilterState(nextTl);
      keepAnalystIfStillListed(nextTl, am);
    },
    [options.tlAmMapping, tlFilter, keepAnalystIfStillListed],
  );

  const setTlFilter = useCallback(
    (tl: string) => {
      setTlFilterState(tl);
      keepAnalystIfStillListed(tl, amFilter);
    },
    [amFilter, keepAnalystIfStillListed],
  );

  const clear = useCallback(() => {
    setTlFilterState("");
    setAmFilterState("");
    setAnalystFilter("");
  }, []);

  return {
    tlFilter,
    setTlFilter,
    amFilter,
    setAmFilter,
    analystFilter,
    setAnalystFilter,
    tlOptions,
    amOptions: options.amNames,
    analystOptions,
    clear,
  };
}
