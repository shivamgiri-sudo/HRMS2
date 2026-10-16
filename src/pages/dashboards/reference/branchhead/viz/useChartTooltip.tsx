import { useCallback, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";

/** One tooltip anchor, positioned in percent of the chart box (0..100 on both axes). */
export interface TipAnchor {
  x: number;
  y: number;
  content: ReactNode;
}

export interface TipPlacement {
  left: number;
  top: number;
  /** Flip below the anchor when there is no room above (top quarter of the box). */
  below: boolean;
  /** Horizontal alignment so a wide tooltip grows inward instead of past the box edge. */
  align: "start" | "center" | "end";
}

/** Keep the tooltip inside the chart box (so a scrolling parent such as the drawer body never clips it). */
export function tipPosition(x: number, y: number): TipPlacement {
  const f = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
  const left = f(x, 0, 100);
  const top = f(y, 0, 100);
  return { left, top, below: top < 25, align: left < 30 ? "start" : left > 70 ? "end" : "center" };
}

/** True only for keyboard (focus-visible) focus; pointer clicks on a row button do not pop a tooltip. */
export function isKeyboardFocus(target: { matches?: (sel: string) => boolean } | null): boolean {
  try {
    return !!target?.matches?.(":focus-visible");
  } catch {
    return false;
  }
}

/**
 * Shared hover + keyboard tooltip. Pointer and keyboard keep separate state so a pointer leaving the
 * chart never clears a tooltip held by keyboard focus. Pointer: spread `markProps(i)` on each mark or
 * hit area. Keyboard: spread `surfaceProps` on the single focusable chart surface (arrows / Home / End
 * move, Esc hides), or `focusProps(i)` on per-row buttons. Renders inside the chart box, no portal;
 * aria-hidden because every value is also in the accessible name, a direct label or the table view.
 */
export function useChartTooltip(anchors: TipAnchor[]) {
  const [pointerIdx, setPointerIdx] = useState<number | null>(null);
  const [keyIdx, setKeyIdx] = useState<number | null>(null);
  const count = anchors.length;
  const active = pointerIdx ?? keyIdx;

  const markProps = useCallback((i: number) => ({
    onPointerEnter: () => setPointerIdx(i),
    onPointerMove: () => setPointerIdx(i),
    onPointerLeave: () => setPointerIdx(null),
  }), []);

  const focusProps = useCallback((i: number) => ({
    onFocus: (e: FocusEvent<HTMLElement>) => { if (isKeyboardFocus(e.currentTarget)) setKeyIdx(i); },
    onBlur: () => setKeyIdx(null),
    onPointerEnter: () => setPointerIdx(i),
    onPointerLeave: () => setPointerIdx(null),
  }), []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!count) return;
    const cur = keyIdx ?? -1;
    let next: number | null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(count - 1, cur + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    else if (e.key === "Escape") next = null;
    else return;
    e.preventDefault();
    setPointerIdx(null);
    setKeyIdx(next);
  };

  const surfaceProps = {
    tabIndex: count ? 0 : -1,
    onFocus: (e: FocusEvent<Element>) => {
      if (count && isKeyboardFocus(e.currentTarget)) setKeyIdx((k) => k ?? 0);
    },
    onBlur: () => setKeyIdx(null),
    onPointerLeave: () => setPointerIdx(null),
    onKeyDown,
  };

  const anchor = active != null ? anchors[active] : undefined;
  let tooltip: ReactNode = null;
  if (anchor) {
    const p = tipPosition(anchor.x, anchor.y);
    const cls = `bh-tip bh-tip-${p.align}${p.below ? " bh-tip-below" : ""}`;
    tooltip = <div className={cls} aria-hidden="true" style={{ left: `${p.left}%`, top: `${p.top}%` }}>{anchor.content}</div>;
  }

  return { active, markProps, focusProps, surfaceProps, tooltip };
}
