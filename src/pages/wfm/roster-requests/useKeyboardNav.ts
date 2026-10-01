import { useQueryClient } from "@tanstack/react-query";
import type { KeyboardEvent } from "react";
import { canQuickApprove } from "./actions";
import type { Impact } from "./useImpact";
import type { RosterRequest } from "./types";

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);
};

/** onKeyDown for the list container: j/k/arrows move, `a` quick-approves, `r` focuses reject reason. */
export function useKeyboardNav(opts: {
  visible: RosterRequest[]; selected: RosterRequest | null;
  select: (r: RosterRequest) => void; approve: (r: RosterRequest) => void; focusReject: () => void;
}) {
  const qc = useQueryClient();
  return (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const { visible, selected } = opts;
    const idx = selected ? visible.findIndex((r) => r.key === selected.key) : -1;
    const move = (d: number) => {
      const next = visible[Math.min(visible.length - 1, Math.max(0, idx + d))];
      if (next) { e.preventDefault(); opts.select(next); }
    };
    if (e.key === "j" || e.key === "ArrowDown") move(1);
    else if (e.key === "k" || e.key === "ArrowUp") move(-1);
    else if (e.key === "a" && selected) {
      const impact = qc.getQueryData<Impact>(["rr", "impact", selected.key]);
      if (canQuickApprove(selected, impact)) { e.preventDefault(); opts.approve(selected); }
    } else if (e.key === "r" && selected) { e.preventDefault(); opts.focusReject(); }
  };
}
