import { useMemo, useState } from "react";

/** Branch Budget foundation (PR 9): tracks which column ids are pinned (sticky-left) and
 *  computes their left-offset in pixels dynamically, based on measured widths — the
 *  user-driven counterpart to BpoPnlMatrixTable's hardcoded `stickyOffsets` array. */
export function useColumnPinning(defaultPinnedIds: string[] = []) {
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => new Set(defaultPinnedIds));

  function togglePin(id: string) {
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function isPinned(id: string) {
    return pinnedIds.has(id);
  }

  function replacePinned(ids: string[]) {
    setPinnedIds(new Set(ids));
  }

  return { pinnedIds, togglePin, isPinned, replacePinned };
}

/** Given an ordered list of column ids and each column's width in pixels, returns the sticky-left
 *  offset (in px) for every *pinned* column, in the order they appear — unpinned columns get no
 *  offset. Pinned columns are always rendered first (left of unpinned ones) by the caller. */
export function usePinnedOffsets(
  orderedPinnedIds: string[],
  widthByColumnId: Record<string, number>
): Record<string, number> {
  return useMemo(() => {
    const offsets: Record<string, number> = {};
    let cursor = 0;
    for (const id of orderedPinnedIds) {
      offsets[id] = cursor;
      cursor += widthByColumnId[id] ?? 160;
    }
    return offsets;
  }, [orderedPinnedIds, widthByColumnId]);
}
