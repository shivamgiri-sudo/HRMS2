import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import { Layers, MessageSquare } from "lucide-react";
import { Spinner, SectionCard, formatINR } from "./DashboardKit";

/**
 * Bellavita's "Chat Dashboard BVO" snapshot -- MTD / weekly / daily matrix
 * for exactly 3 real LOBs (Chat, Bevzilla, Kenaz), per explicit user
 * request replicating the layout of a reference sheet they supplied. See
 * getBellavitaChatLobSnapshot()'s own header comment in the backend service
 * for the full list of reference-sheet rows deliberately left out (Planned
 * Capacity, Capacity Utilization, With Out Agent FRT) and why -- no real
 * data source exists for them in db_masmis, so they're omitted rather than
 * invented, not silently renamed into something that looks similar.
 */

interface Period { key: string; label: string }
interface MetricRow { metric: string; values: Record<string, number | null>; format: "count" | "pct" | "currency" }
interface Snapshot { lob: string; rows: MetricRow[] }
interface SnapshotData { periods: Period[]; snapshots: Snapshot[] }

function formatValue(v: number | null, format: MetricRow["format"]): string {
  if (v === null) return "—";
  if (format === "pct") return `${v}%`;
  if (format === "currency") return formatINR(v);
  return v.toLocaleString("en-IN");
}

const LOB_TONE: Record<string, { gradient: string; icon: typeof MessageSquare }> = {
  Chat: { gradient: "from-rose-500 via-pink-500 to-rose-600", icon: MessageSquare },
  Bevzilla: { gradient: "from-violet-600 via-indigo-600 to-violet-700", icon: Layers },
  Kenaz: { gradient: "from-emerald-600 via-teal-600 to-emerald-700", icon: Layers },
};

function LobMatrix({ snapshot, periods }: { snapshot: Snapshot; periods: Period[] }) {
  const tone = LOB_TONE[snapshot.lob] ?? LOB_TONE.Chat;
  const Icon = tone.icon;
  return (
    <SectionCard
      icon={Icon} title={`${snapshot.lob} — Chat Dashboard`} tone="slate"
      footnote={
        snapshot.lob !== "Chat"
          ? "Revenue/AOV show — for this LOB: db_masmis.bb_sale has no Bevzilla/Kenaz split, only one combined 'Chat' campaign — those two rows are real for the Chat snapshot only, not fabricated here."
          : undefined
      }
    >
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[1400px] border-collapse text-center text-[11px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border-b border-slate-700 bg-slate-800 px-3 py-2.5 text-left font-bold text-white">Metric</th>
              {periods.map((p) => (
                <th
                  key={p.key}
                  className={`border-b border-l border-slate-700 px-2.5 py-2.5 font-bold text-white ${
                    p.key === "mtd" ? "bg-amber-700" : p.key.startsWith("w") ? "bg-slate-700" : "bg-slate-800"
                  }`}
                >
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {snapshot.rows.map((row, ri) => (
              <tr key={row.metric} className={ri % 2 === 1 ? "bg-slate-50/60" : "bg-white"}>
                <td className="sticky left-0 z-10 border-b border-slate-100 bg-inherit px-3 py-2 text-left font-semibold text-slate-700">
                  {row.metric}
                </td>
                {periods.map((p) => (
                  <td
                    key={p.key}
                    className={`border-b border-l border-slate-100 px-2.5 py-2 text-slate-600 ${
                      p.key === "mtd" ? "bg-amber-50 font-bold text-amber-800" : ""
                    }`}
                  >
                    {formatValue(row.values[p.key] ?? null, row.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

const LOB_LINE_COLOR: Record<string, string> = { Chat: "#e11d48", Bevzilla: "#7c3aed", Kenaz: "#059669" };

export function BellavitaChatLobSnapshot() {
  const [data, setData] = useState<SnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    hrmsApi.get<{ success: boolean; data: SnapshotData }>("/api/process-performance/bellavita-chat-dashboard/lob-snapshot")
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the LOB snapshot."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  /** Day-wise Overall Chat Volume for all 3 LOBs (including Chat), read
   * straight out of each snapshot's own "Overall Chat Volume" row, keyed by
   * the same day-period keys ("YYYY-MM-DD") the table's daily columns
   * already use -- so the chart never disagrees with the table below it. */
  const dailyVolume = useMemo(() => {
    if (!data) return [];
    const dayPeriods = data.periods.filter((p) => p.key !== "mtd" && !p.key.startsWith("w"));
    const rowFor = (lob: string) => data.snapshots.find((s) => s.lob === lob)?.rows.find((r) => r.metric === "Overall Chat Volume");
    const chatRow = rowFor("Chat");
    const bevzillaRow = rowFor("Bevzilla");
    const kenazRow = rowFor("Kenaz");
    return dayPeriods.map((p) => ({
      date: p.label,
      Chat: chatRow?.values[p.key] ?? 0,
      Bevzilla: bevzillaRow?.values[p.key] ?? 0,
      Kenaz: kenazRow?.values[p.key] ?? 0,
    }));
  }, [data]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500">
        MTD, weekly and daily breakdown for the current month, live from db_masmis.bb_chat — scoped to Chat, Bevzilla and Kenaz per request.
        The MTD column is highlighted. Scroll horizontally for daily figures.
      </p>

      <SectionCard icon={MessageSquare} title="Day-wise Overall Chat Volume — Chat vs Bevzilla vs Kenaz" tone="slate" footnote="Same daily figures as the Overall Chat Volume row in each LOB's matrix below.">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={dailyVolume} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="Chat" stroke={LOB_LINE_COLOR.Chat} strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Bevzilla" stroke={LOB_LINE_COLOR.Bevzilla} strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Kenaz" stroke={LOB_LINE_COLOR.Kenaz} strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </SectionCard>

      {data.snapshots.map((s) => (
        <LobMatrix key={s.lob} snapshot={s} periods={data.periods} />
      ))}
    </div>
  );
}
