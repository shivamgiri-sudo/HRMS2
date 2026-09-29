import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useOpsRecords, type RecordsRequest } from "./useOpsCommand";
import { fmtDate, formatMetric, type OpsQuery } from "./opsTypes";

interface Props {
  query: OpsQuery;
  request: Omit<RecordsRequest, "offset"> | null;
  scopeLabel: string | null;
  onClose: () => void;
  onOpenEmployee: (id: string) => void;
}

const PAGE = 50;

/** Right-side slide-over listing the people behind a number. Row click opens the employee 360. */
export function OpsRecordsSheet({ query, request, scopeLabel, onClose, onOpenEmployee }: Props) {
  const [offset, setOffset] = useState(0);
  const key = request ? `${request.domain}|${request.groupBy}|${request.groupId}` : "";
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) { setLastKey(key); setOffset(0); }
  const { data, isLoading, isError } = useOpsRecords(query, request ? { ...request, offset } : null);

  return (
    <Sheet open={!!request} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{data?.title ?? "Loading…"}</SheetTitle>
          <SheetDescription>{scopeLabel ? `${scopeLabel} · ` : ""}{data ? `${data.total.toLocaleString("en-IN")} people` : ""}</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {isLoading && <div className="h-32 animate-pulse rounded bg-muted" />}
          {isError && <p className="text-sm text-rose-600">Could not load this list. Try again.</p>}
          {data && !data.rows.length && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">None</p>}
          {data && data.rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    {data.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-2 font-semibold">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={`${r.employee_id}-${i}`} className="cursor-pointer border-b hover:bg-muted/40" onClick={() => onOpenEmployee(String(r.employee_id))}>
                      {data.columns.map((c) => {
                        const v = r[c.key];
                        return (
                          <td key={c.key} className="whitespace-nowrap px-3 py-2">
                            {c.type === "date" ? fmtDate(v as string) : c.type === "pct" ? formatMetric(v === null ? null : Number(v), "pct") : c.type === "number" ? formatMetric(v === null ? null : Number(v), "count") : (v ?? "—")}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && data.total > PAGE && (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>{offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total.toLocaleString("en-IN")}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
                <Button size="sm" variant="outline" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
