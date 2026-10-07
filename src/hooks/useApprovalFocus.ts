import { useEffect } from "react";

const RING = ["ring-2", "ring-primary", "ring-offset-2", "bg-primary/5", "transition-shadow"];

/**
 * Deep-link target for the Approval Center's "View" button.
 *
 * The popup opens `<page>?approvalId=<id>`. A page opts in by (1) tagging each row/card with
 * `data-approval-id={row.id}` and (2) calling `useApprovalFocus(rowsLoaded)` — pass true once the rows
 * the id could be in have rendered (the hook retries until the element exists). The matching element
 * is scrolled into view and ringed for a few seconds. Returns the id so the page can also switch tab /
 * open a drawer / pre-filter.
 */
export function useApprovalFocus(ready: boolean = true): string | null {
  // Read from the URL directly (no Router context needed) so any component can use it, tests included.
  const id = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("approvalId");

  useEffect(() => {
    if (!id || !ready) return;
    let tries = 0;
    let timer: number | undefined;
    const attempt = () => {
      const el = document.querySelector<HTMLElement>(`[data-approval-id="${CSS.escape(id)}"]`);
      if (el) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
        el.classList.add(...RING);
        timer = window.setTimeout(() => el.classList.remove(...RING), 6000);
        return;
      }
      if (++tries < 20) timer = window.setTimeout(attempt, 250);
    };
    attempt();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [id, ready]);

  return id;
}
