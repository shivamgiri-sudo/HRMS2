import { Input } from "@/components/ui/input";
import { NAMED_POOL_OPTIONS } from "./source-form";
import { Field, selectClass } from "./form-bits";

/** Picks one of the databases this system already connects to, and the table to read in it. */
export function NamedPoolFields({
  poolKey,
  table,
  onChange,
}: {
  poolKey: string;
  table: string;
  onChange: (patch: { integration_key?: string; source_object?: string }) => void;
}) {
  const chosen = NAMED_POOL_OPTIONS.find((pool) => pool.key === poolKey);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field
        id="source-pool"
        label="Database"
        hint={
          <>
            {chosen ? `${chosen.description} ` : ""}
            The login for this database stays on the server. Nothing is entered or stored here.
          </>
        }
      >
        <select
          id="source-pool"
          value={poolKey}
          onChange={(event) => onChange({ integration_key: event.target.value })}
          className={selectClass}
        >
          <option value="">Choose a database…</option>
          {/* A key saved outside this list is shown rather than dropped, so the problem is visible. */}
          {poolKey && !chosen && <option value={poolKey}>{poolKey} (not recognised)</option>}
          {NAMED_POOL_OPTIONS.map((pool) => (
            <option key={pool.key} value={pool.key}>
              {pool.label}
            </option>
          ))}
        </select>
      </Field>

      <Field id="source-table" label="Table name" hint="The table in that database, exactly as it is named there.">
        <Input
          id="source-table"
          value={table}
          onChange={(event) => onChange({ source_object: event.target.value })}
          placeholder="neemans_sale_raw"
          className="font-mono text-xs"
        />
      </Field>
    </div>
  );
}
