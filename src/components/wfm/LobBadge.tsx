/** Small LOB label for roster rows: the LOB name, or a muted "Unassigned" when the employee has none. */
export function LobBadge({ name, className = "" }: { name: string | null | undefined; className?: string }) {
  return name
    ? <span className={`inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 ${className}`} title="Line of business">{name}</span>
    : <span className={`inline-block text-[10px] text-slate-400 ${className}`} title="No LOB assigned">Unassigned</span>;
}
