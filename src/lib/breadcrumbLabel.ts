import { useEffect, useSyncExternalStore } from "react";

/**
 * Route-specific breadcrumb labels. TopBar derives crumbs from the URL, which is fine for static pages but shows a raw record id on a
 * page like /performance/process-dashboard/:processId. A page that knows the human label registers it here for its own href; TopBar
 * prefers a registered label and otherwise behaves exactly as before. Labels are removed when the page unmounts.
 */
const labels = new Map<string, string>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, string> = new Map();
const emit = () => { snapshot = new Map(labels); listeners.forEach((l) => l()); };

export function setBreadcrumbLabel(href: string, label: string | null | undefined): void {
  const clean = label?.trim();
  if (clean ? labels.get(href) === clean : !labels.has(href)) return;
  if (clean) labels.set(href, clean); else labels.delete(href);
  emit();
}

export function useBreadcrumbLabels(): ReadonlyMap<string, string> {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => snapshot, () => snapshot);
}

/** Register `label` for `href` while the calling page is mounted. */
export function useBreadcrumbLabel(href: string, label: string | null | undefined): void {
  useEffect(() => {
    setBreadcrumbLabel(href, label);
    return () => setBreadcrumbLabel(href, null);
  }, [href, label]);
}
