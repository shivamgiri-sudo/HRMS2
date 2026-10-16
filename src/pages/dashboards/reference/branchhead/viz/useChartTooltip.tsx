import { useCallback, useState, type KeyboardEvent, type ReactNode } from "react";

/** One tooltip anchor, positioned in percent of the chart box (0..100 on both axes). */
export interface TipAnchor {
  x: number;
  y: number;
  content: ReactNode;
}

/** Keep the tooltip inside the chart box: horizontally 12..88 %, vertically 0..100 %. */
export function tipPosition(x: number, y: number): { left: number; top: number } {
  const f = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
  return { left: f(x, 12, 88), top: f(y, 0, 100) };
}

/**
 * Shared hover + keyboard tooltip. Pointer: spread `markProps(i)` on each mark (or its hit area).
 * Keyboard: spread `surfaceProps` on the focusable chart surface (arrows / Home / End move, Esc hides),
 * or `focusProps(i)` on per-row buttons. The tooltip renders inside the chart box, no portal, and is
 * aria-hidden because every value it shows is also in the accessible name, a direct label or the table.
 */
export function useChartTooltip(anchors: TipAnchor[]) {
  const [active, setActive] = useState<number | null>(null);
  const count = anchors.length;

  const markProps = useCallback((i: number) => ({
    onPointerEnter: () => setActive(i),
    onPointerMove: () => setActive(i),
    onPointerLeave: () => setActive(null),
  }), []);

  const focusProps = useCallback((i: number) => ({
    onFocus: () => setActive(i),
    onBlur: () => setActive(null),
    onPointerEnter: () => setActive(i),
    onPointerLeave: () => setActive(null),
  }), []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!count) return;
    const cur = active ?? -1;
    let next: number | null = cur;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(count - 1, cur + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    else if (e.key === "Escape") next = null;
    else return;
    e.preventDefault();
    setActive(next);
  };

  const surfaceProps = {
    tabIndex: count ? 0 : -1,
    className: "bh-focus",
    onFocus: () => setActive((a) => a ?? (count ? 0 : null)),
    onBlur: () => setActive(null),
    onKeyDown,
  };

  const anchor = active != null ? anchors[active] : undefined;
  const pos = anchor ? tipPosition(anchor.x, anchor.y) : null;
  const tooltip = anchor && pos ? (
    <div className="bh-tip" aria-hidden="true" style={{ left: `${pos.left}%`, top: `${pos.top}%` }}>{anchor.content}</div>
  ) : null;

  return { active, setActive, markProps, focusProps, surfaceProps, tooltip };
}
