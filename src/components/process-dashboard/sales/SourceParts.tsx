import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTables, type ColumnInfo, type Kind } from "./extApi";
import { SOURCE_SCHEMAS } from "./ext.model";
import { ErrorBox } from "../ui";
import { input, lbl, msg } from "./ext.style";

/** Schema select + searchable table list (mas_hrms holds thousands of tables, so a bare select is unusable). */
export function TablePicker({ kind, idPrefix, schema, table, onChange, label }: { kind: Kind; idPrefix: string; schema: string; table: string; onChange: (schema: string, table: string) => void; label: string }) {
  const [needle, setNeedle] = useState("");
  const tables = useQuery({ queryKey: ["pd-admin", kind, "tables", schema], queryFn: () => fetchTables(kind, schema), staleTime: 60_000, retry: false });
  const shown = useMemo(() => {
    const n = needle.trim().toLowerCase();
    const all = tables.data ?? [];
    const hit = n ? all.filter((t) => t.table.toLowerCase().includes(n)) : all;
    const list = hit.slice(0, 300);
    return table && !list.some((t) => t.table === table) ? [{ table, rows: null }, ...list] : list;
  }, [tables.data, needle, table]);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div><label className={lbl} htmlFor={`${idPrefix}-schema`}>Schema</label>
        <select id={`${idPrefix}-schema`} className={`${input} cursor-pointer`} value={schema} onChange={(e) => onChange(e.target.value, "")}>{SOURCE_SCHEMAS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
      <div><label className={lbl} htmlFor={`${idPrefix}-find`}>Find a table</label>
        <input id={`${idPrefix}-find`} type="search" className={input} value={needle} onChange={(e) => setNeedle(e.target.value)} placeholder="Type part of the name" autoComplete="off" /></div>
      <div><label className={lbl} htmlFor={`${idPrefix}-table`}>{label} <span className="text-red-700" aria-hidden="true">*</span></label>
        <select id={`${idPrefix}-table`} className={`${input} cursor-pointer`} value={table} onChange={(e) => onChange(schema, e.target.value)} disabled={tables.isLoading}>
          <option value="">{tables.isLoading ? "Loading tables..." : `Select a table (${(tables.data ?? []).length} in ${schema})`}</option>
          {shown.map((t) => <option key={t.table} value={t.table}>{t.table}{t.rows != null ? ` (~${t.rows.toLocaleString("en-IN")} rows)` : ""}</option>)}</select></div>
      {tables.isError && <div className="sm:col-span-3"><ErrorBox message={msg(tables.error)} onRetry={() => void tables.refetch()} /></div>}
    </div>
  );
}

/** Optional "this table mixes several processes" filter. */
export function FilterFields({ idPrefix, columns, column, value, onChange }: { idPrefix: string; columns: ColumnInfo[]; column: string; value: string; onChange: (column: string, value: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div><label className={lbl} htmlFor={`${idPrefix}-fcol`}>Process filter column (optional)</label>
        <select id={`${idPrefix}-fcol`} className={`${input} cursor-pointer`} value={column} onChange={(e) => onChange(e.target.value, "")}>
          <option value="">No filter: the table holds only this process</option>{columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select>
        <p className="mt-1 text-[11px] text-slate-600">Use when one table mixes several processes or clients.</p></div>
      <div><label className={lbl} htmlFor={`${idPrefix}-fval`}>Filter value</label>
        <input id={`${idPrefix}-fval`} className={input} value={value} disabled={!column} onChange={(e) => onChange(column, e.target.value)} /></div>
    </div>
  );
}
