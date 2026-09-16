import { UploadCloud } from "lucide-react";

/**
 * Placeholder — the real component was never committed.
 *
 * ProcessOperationsPage.tsx (e149ff62, 2026-09-16) imports MasmisUploaderGrid from this exact
 * path, but no file of that name exists anywhere in this repo's history (`git log --all` on the
 * path returns nothing) — the build broke for every branch and every deploy the moment that
 * commit landed, with `[UNLOADABLE_DEPENDENCY] Could not load
 * src/components/process-operations/MasmisUploader`.
 *
 * This stub only unblocks the build. It does NOT reimplement the intended upload flow — that is
 * real, specific business logic (which bulk-upload job code each template maps to, what payload
 * shape it expects, the review/approval gate) that belongs to whoever built the demo this was
 * meant to serve, and guessing at it here risked shipping something that silently uploads to the
 * wrong place. Each template renders as a disabled, clearly-labelled card instead of a working
 * button, so nobody mistakes it for a working upload. Real uploads for every code listed already
 * work today through the existing Bulk Upload Hub (/bulk-upload) — that page is untouched.
 */
export function MasmisUploaderGrid({ templates }: { templates: Array<{ code: string; label: string }> }) {
  if (!templates.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {templates.map((t) => (
        <div
          key={t.code}
          className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-slate-400 dark:border-slate-700 dark:bg-slate-900"
          title={`${t.label} (${t.code}) — not wired up here yet; use the Bulk Upload Hub`}
        >
          <UploadCloud className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-xs">{t.label}</span>
        </div>
      ))}
    </div>
  );
}
