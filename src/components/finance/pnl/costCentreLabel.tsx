/**
 * Cost centre + the process it serves, the same way on every P&L screen (owner request
 * 2026-09-15). The process comes from the backend (cost-centre-label.ts: mapped process, else the
 * billing process name); when it is unknown the code stands alone — never a guessed name.
 */

/** "BSS/OB/Noida/647 · Vodafone CS" for text contexts: dropdowns, titles, tooltips, CSV. */
export function costCentreText(code: string, processName?: string | null): string {
  const p = processName?.trim();
  return p ? `${code} · ${p}` : code;
}

/** Two-line cell: code on top, process (then branch) underneath. */
export function CostCentreName({
  code, processName, sub, className = "",
}: { code: string; processName?: string | null; sub?: string | null; className?: string }) {
  const p = processName?.trim();
  const second = [p, sub?.trim()].filter(Boolean).join(" · ");
  return (
    <span className={`block min-w-0 ${className}`}>
      <span className="block truncate font-semibold text-foreground" title={costCentreText(code, p)}>{code}</span>
      {second && <span className="block truncate text-[11px] text-muted-foreground" title={second}>{second}</span>}
    </span>
  );
}
