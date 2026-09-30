import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FILTER_OPS, describeFilterRows, type FilterOp, type FilterRow } from "./source-form";
import { focusRing, selectClass } from "./form-bits";

/**
 * Conditions narrowing which rows ONE field counts. Two fields on the same source can be filtered
 * differently, which is what makes a pair like answered/offered expressible: offered counts every
 * call, answered only the calls that reached an agent. All conditions must hold at once.
 */
export function FieldFilterEditor({
  rows,
  onChange,
  columns,
  idPrefix,
}: {
  rows: readonly FilterRow[];
  onChange: (rows: FilterRow[]) => void;
  /** Column names read from the table, offered as suggestions. Typing a name still works. */
  columns: readonly string[];
  idPrefix: string;
}) {
  const update = (index: number, patch: Partial<FilterRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const listId = `${idPrefix}-columns`;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium text-slate-700">Count only some rows (optional)</p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
        Add a condition to measure part of the table, for example only answered calls. A row must
        meet every condition to be counted.
      </p>

      <datalist id={listId}>
        {columns.map((column) => (
          <option key={column} value={column} />
        ))}
      </datalist>

      {rows.length > 0 && (
        <ul className="mt-2.5 space-y-2.5">
          {rows.map((row, index) => {
            const needsValue = FILTER_OPS.find((op) => op.value === row.op)?.needsValue ?? true;
            const id = `${idPrefix}-${index}`;
            return (
              <li
                key={index}
                className="grid grid-cols-[1fr_auto] gap-2 border-t border-slate-100 pt-2.5 first:border-t-0 first:pt-0 sm:grid-cols-[1fr_11rem_1fr_auto] sm:items-end"
              >
                <div className="col-span-2 sm:col-span-1">
                  <label htmlFor={`${id}-column`} className="mb-1 block text-[11px] font-medium text-slate-600">
                    Column
                  </label>
                  <Input
                    id={`${id}-column`}
                    list={listId}
                    value={row.column}
                    onChange={(event) => update(index, { column: event.target.value })}
                    placeholder="call_status"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label htmlFor={`${id}-op`} className="mb-1 block text-[11px] font-medium text-slate-600">
                    Comparison
                  </label>
                  <select
                    id={`${id}-op`}
                    value={row.op}
                    onChange={(event) => update(index, { op: event.target.value as FilterOp })}
                    className={selectClass}
                  >
                    {FILTER_OPS.map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  {needsValue && (
                    <>
                      <label htmlFor={`${id}-value`} className="mb-1 block text-[11px] font-medium text-slate-600">
                        {row.op === "in" ? "Values, separated by commas" : "Value"}
                      </label>
                      <Input
                        id={`${id}-value`}
                        value={row.value}
                        onChange={(event) => update(index, { value: event.target.value })}
                        placeholder={row.op === "in" ? "ANSWERED, TRANSFERRED" : "ANSWERED"}
                        className="font-mono text-xs"
                      />
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}
                  aria-label={`Remove condition ${index + 1}`}
                  className={`flex h-9 w-9 cursor-pointer items-center justify-center self-end justify-self-end rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 ${focusRing}`}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => onChange([...rows, { column: "", op: "eq", value: "" }])}
        className={`mt-2.5 inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-indigo-400 hover:text-indigo-700 ${focusRing}`}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add a condition
      </button>

      <p aria-live="polite" className="mt-2.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-[11px] leading-snug text-slate-600">
        {describeFilterRows(rows)}
        {rows.length > 0 && " On a day when no row matches, the field reads as no data rather than zero."}
      </p>
    </div>
  );
}
