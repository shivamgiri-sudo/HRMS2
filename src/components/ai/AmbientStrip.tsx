import { useCallback, useRef, useState } from 'react';
import { MiraAvatar } from './MiraAvatar';

/** Distance from the right and bottom viewport edges, in px, on first render. */
const DEFAULT_POS = { x: 24, y: 80 };
/**
 * Pointer travel, in px, before a press is treated as a drag rather than a click.
 * Without this every click would register as a 1px drag and never open the panel,
 * because a mouse almost always moves a little between down and up.
 */
const DRAG_THRESHOLD = 4;
/** Keeps the button fully on screen: its own footprint plus a small margin. */
const EDGE_MARGIN = 16;
const BUTTON_FOOTPRINT = 80;

export function AmbientStrip({
  contextType: _contextType,
  onOpen,
  open = false,
}: {
  contextType: string;
  onOpen: () => void;
  open?: boolean;
}) {
  const [pos, setPos] = useState(DEFAULT_POS);
  const dragging = useRef(false);
  const moved = useRef(false);
  const startRef = useRef({ mx: 0, my: 0, x: 0, y: 0 });

  const clamp = useCallback((x: number, y: number) => ({
    x: Math.max(EDGE_MARGIN, Math.min(window.innerWidth - BUTTON_FOOTPRINT, x)),
    y: Math.max(EDGE_MARGIN, Math.min(window.innerHeight - BUTTON_FOOTPRINT, y)),
  }), []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    // Capture means we keep receiving move/up even when the pointer leaves the
    // button — without it a fast drag drops the gesture the moment the cursor
    // outruns the 64px target.
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    moved.current = false;
    startRef.current = { mx: event.clientX, my: event.clientY, x: pos.x, y: pos.y };
  }, [pos]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging.current) return;
    const dx = event.clientX - startRef.current.mx;
    const dy = event.clientY - startRef.current.my;
    if (!moved.current && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      moved.current = true;
    }
    if (!moved.current) return;
    // Both offsets are measured from the far edge, so they move opposite to the
    // pointer: dragging right (dx > 0) shrinks the right offset, and dragging
    // down (dy > 0) shrinks the bottom offset.
    setPos(clamp(startRef.current.x - dx, startRef.current.y - dy));
  }, [clamp]);

  const endDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragging.current = false;
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const wasDrag = moved.current;
    endDrag(event);
    moved.current = false;
    // A press that never crossed the threshold is a click, so it opens the panel.
    // A press that did was a reposition, and must not also open it.
    if (!wasDrag) onOpen();
  }, [endDrag, onOpen]);

  const onPointerCancel = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    endDrag(event);
    moved.current = false;
  }, [endDrag]);

  return (
    <div className="group fixed z-50" style={{ right: pos.x, bottom: pos.y }}>
      <div className="pointer-events-none absolute bottom-full right-0 mb-2 translate-y-1 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 opacity-0 shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100">
        Ask Mira about your HRMS account
      </div>
      <button
        type="button"
        aria-label="Open Mira, your private HR assistant"
        aria-expanded={open}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        // Keyboard users never drag, so Enter/Space stays a plain open. The
        // handler is explicit because there is no onClick to fall back on.
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen();
          }
        }}
        className="relative flex h-16 w-16 cursor-grab select-none items-center justify-center rounded-full border-2 border-white bg-white shadow-[0_12px_38px_rgba(30,41,59,0.28)] transition-shadow duration-200 active:cursor-grabbing"
        // touchAction none stops a touch-drag from scrolling the page instead of
        // moving the button.
        style={{ touchAction: 'none' }}
      >
        <MiraAvatar mood={open ? 'happy' : 'idle'} size="md" />
        <span className="absolute -left-1 -top-1 rounded-full border-2 border-white bg-indigo-600 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white shadow-sm">AI</span>
      </button>
    </div>
  );
}
