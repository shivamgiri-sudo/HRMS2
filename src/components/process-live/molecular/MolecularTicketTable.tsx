/** Molecular / Reginald Email Dashboard — detailed ticket table (MOL-06): sort + CSV export, same filters as the KPIs. */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, Loading, Notice } from "./MolecularUi";
import { emailDashApi, EMAIL_DASHBOARDS, fmtStamp, orNA, type EmailDashSource, type MolFilters, type MolTicket } from "./molecularApi";

type Col = { key: keyof MolTicket | "reopenFlag"; label: string; num?: boolean; render: (t: MolTicket) => string };

const COLS: Col[] = [
  { key: "ticketId", label: "Ticket ID", render: (t) => t.ticketId },
  { key: "createdAt", label: "Created", render: (t) => orNA(t.createdAt) },
  { key: "agentName", label: "Agent", render: (t) => orNA(t.agentName) },
  { key: "category", label: "Category / Queue", render: (t) => orNA(t.category) },
  { key: "priority", label: "Priority", render: (t) => orNA(t.priority) },
  { key: "status", label: "Current Status", render: (t) => orNA(t.status) },
  { key: "firstClosedAt", label: "First Closed", render: (t) => orNA(t.firstClosedAt) },
  { key: "reopenFlag", label: "Reopened", render: (t) => (t.isReopened ? "Yes" : "No") },
  { key: "reopenCount", label: "Reopen Count", num: true, render: (t) => String(t.reopenCount) },
  { key: "finalClosedAt", label: "Final Closed", render: (t) => orNA(t.finalClosedAt) },
  { key: "tatHours", label: "TAT / Age (h)", num: true, render: (t) => (t.tatHours === null ? "N/A" : t.tatHours.toFixed(2)) },
  { key: "tatBucket", label: "TAT Bucket", render: (t) => orNA(t.tatBucket) },
  { key: "slaStatus", label: "SLA Status", render: (t) => t.slaStatus },
  { key: "dqFlag", label: "Data Quality", render: (t) => t.dqFlag ?? "OK" },
];

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function MolecularTicketTable({ f, source = "molecular" }: { f: MolFilters; source?: EmailDashSource }) {
  const q = useQuery({ queryKey: ["mol", source, "tickets", f], queryFn: () => emailDashApi(source).tickets(f), staleTime: 60_000 });
  const [sort, setSort] = useState<{ key: Col["key"]; dir: 1 | -1 }>({ key: "createdAt", dir: -1 });

  const rows = useMemo(() => {
    const list = (q.data?.rows ?? []).slice();
    const col = COLS.find((c) => c.key === sort.key) ?? COLS[1];
    const val = (t: MolTicket): string | number | null => {
      if (col.key === "reopenFlag") return t.isReopened ? 1 : 0;
      const v = t[col.key as keyof MolTicket];
      return typeof v === "number" ? v : v === null || v === undefined ? null : String(v);
    };
    list.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1; // N/A always last
      if (y === null) return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
    });
    return list;
  }, [q.data, sort]);

  const exportCsv = () => {
    const header = COLS.map((c) => csvCell(c.label)).join(",");
    const body = rows.map((t) => COLS.map((c) => csvCell(c.render(t))).join(",")).join("\n");
    const blob = new Blob([`${header}\n${body}\n`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${EMAIL_DASHBOARDS[source].title.replace(/ /g, "_")}_tickets_${f.from}_to_${f.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Notice tone="error">{(q.error as Error)?.message ?? "Failed to load tickets."}</Notice>;

  return (
    <Card
      title="Ticket detail"
      sub={`${q.data.total.toLocaleString()} unique tickets match the filters${q.data.truncated ? ` (showing the newest ${rows.length.toLocaleString()})` : ""}. Times are IST; TAT for open tickets is age at ${fmtStamp(q.data.asOf)}.`}
      right={<button type="button" onClick={exportCsv} disabled={rows.length === 0} className="h-8 rounded-md bg-slate-800 px-3 text-xs font-semibold text-white disabled:opacity-40">Export CSV</button>}
    >
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full whitespace-nowrap text-xs">
          <thead className="sticky top-0 bg-white text-left text-slate-500">
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className={`cursor-pointer select-none px-2 py-1 ${c.num ? "text-right" : ""}`}
                  onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
                  {c.label}{sort.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.ticketId} className={`border-t border-slate-100 ${t.dqFlag ? "bg-amber-50" : ""}`}>
                {COLS.map((c) => <td key={c.key} className={`px-2 py-1 ${c.num ? "text-right" : ""}`}>{c.render(t)}</td>)}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={COLS.length} className="py-6 text-center text-slate-400">No tickets match these filters</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
