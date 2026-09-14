import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export interface DrillDownChip {
  dimension: string;
  value: string;
  label: string;
}

interface DrillDownContextValue {
  chips: DrillDownChip[];
  pushChip: (chip: DrillDownChip) => void;
  popToChip: (index: number) => void;
  clear: () => void;
  showEmployeeList: boolean;
  openEmployeeList: () => void;
  closeEmployeeList: () => void;
  selectedEmployeeId: string | null;
  selectEmployee: (id: string) => void;
  deselectEmployee: () => void;
}

const DrillDownContext = createContext<DrillDownContextValue | null>(null);

/**
 * Appends `chip` to `chips`, replacing an existing chip of the same dimension rather than
 * stacking a duplicate -- e.g. clicking a different AON bucket cell replaces the current
 * bucket chip, it doesn't add a second one. Exported as a pure function so the chip-state
 * transitions can be tested directly (this repo has no jsdom/@testing-library/react to drive
 * real click events against the mounted component).
 */
export function applyPushChip(chips: DrillDownChip[], chip: DrillDownChip): DrillDownChip[] {
  const withoutSameDimension = chips.filter((c) => c.dimension !== chip.dimension);
  return [...withoutSameDimension, chip];
}

/** Truncates `chips` to the first `index` entries -- removing the clicked chip and everything after it. */
export function applyPopToChip(chips: DrillDownChip[], index: number): DrillDownChip[] {
  return chips.slice(0, index);
}

export function DrillDownProvider({ children }: { children: React.ReactNode }) {
  const [chips, setChips] = useState<DrillDownChip[]>([]);
  const [showEmployeeList, setShowEmployeeList] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  const pushChip = useCallback((chip: DrillDownChip) => {
    setChips((prev) => applyPushChip(prev, chip));
  }, []);

  const popToChip = useCallback((index: number) => {
    setChips((prev) => applyPopToChip(prev, index));
  }, []);

  const clear = useCallback(() => {
    setChips([]);
    setShowEmployeeList(false);
  }, []);

  const openEmployeeList = useCallback(() => setShowEmployeeList(true), []);
  const closeEmployeeList = useCallback(() => setShowEmployeeList(false), []);
  const selectEmployee = useCallback((id: string) => setSelectedEmployeeId(id), []);
  const deselectEmployee = useCallback(() => setSelectedEmployeeId(null), []);

  const value = useMemo(
    () => ({
      chips,
      pushChip,
      popToChip,
      clear,
      showEmployeeList,
      openEmployeeList,
      closeEmployeeList,
      selectedEmployeeId,
      selectEmployee,
      deselectEmployee,
    }),
    [
      chips,
      pushChip,
      popToChip,
      clear,
      showEmployeeList,
      openEmployeeList,
      closeEmployeeList,
      selectedEmployeeId,
      selectEmployee,
      deselectEmployee,
    ],
  );

  return <DrillDownContext.Provider value={value}>{children}</DrillDownContext.Provider>;
}

export function useDrillDown(): DrillDownContextValue {
  const ctx = useContext(DrillDownContext);
  if (!ctx) throw new Error("useDrillDown must be used inside a DrillDownProvider");
  return ctx;
}
