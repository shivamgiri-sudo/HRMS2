import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";
import TeamMemberDrawer from "./TeamMemberDrawer";

/**
 * Which of your people are missing a required record.
 *
 * The cheapest high-value surface on this page: no new tables, one join per field, and every
 * cell is something a team leader can close this week. Nothing in the platform put these in
 * front of the person who can chase them.
 *
 * Scale of the gap across the 1,120 active employees, counted 2026-08-27:
 *   1,095 no nominee · 1,080 no emergency contact · 702 no UAN
 *     330 no PAN     ·   143 no bank record       ·  34 no date of birth
 *
 * A missing nominee is a death benefit with no payee. A missing emergency contact is a floor
 * incident with nobody to call. Those two lead the sort for that reason, not alphabetically.
 */

interface HygieneField { key: string; label: string; critical: boolean; present: boolean }

interface HygieneMember {
  employee_id: string;
  employee_code: string | null;
  full_name: string;
  designation: string | null;
  fields: HygieneField[];
  missing_count: number;
  missing_critical: number;
  complete_pct: number;
}

interface HygienePayload {
  members: HygieneMember[];
  summary: {
    team_size: number;
    fully_complete: number;
    avg_complete_pct: number;
    by_field: Record<string, number>;
  };
}

/** Why each gap matters — shown on the chase list so the priority is self-evident. */
const CONSEQUENCE: Record<string, string> = {
  nominee: "Death benefit has no payee",
  emergency_contact: "Nobody to call in an incident",
  uan_number: "Blocks PF filing",
  pan_number: "Blocks TDS",
  bank_detail: "Cannot be paid by transfer",
  mobile: "Cannot be reached or OTP'd",
  date_of_birth: "Blocks statutory age checks",
  personal_email: "No channel after exit",
};

export default function TeamHygieneTab() {
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["team-hygiene"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: HygienePayload }>("/api/management/team-hygiene");
      return res.data;
    },
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const members = data?.members ?? [];
  const summary = data?.summary;

  if (members.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
        <BadgeCheck className="mx-auto mb-2 h-8 w-8 text-slate-300" />
        <p className="text-sm text-slate-500">No team members to check.</p>
      </div>
    );
  }

  // Worst first — this is a work queue, so the people needing action lead.
  const ranked = [...members].sort(
    (a, b) => b.missing_critical - a.missing_critical || b.missing_count - a.missing_count || a.full_name.localeCompare(b.full_name),
  );

  const fieldOrder = members[0].fields.map((f) => f.key);
  const labelOf = (key: string) => members[0].fields.find((f) => f.key === key)?.label ?? key;

  return (
    <div className="space-y-6">
      {/* Team totals */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Team size", value: summary?.team_size ?? 0, tone: "text-slate-900" },
          { label: "Fully complete", value: summary?.fully_complete ?? 0, tone: "text-emerald-700" },
          {
            label: "Need attention",
            value: (summary?.team_size ?? 0) - (summary?.fully_complete ?? 0),
            tone: "text-rose-700",
          },
          { label: "Avg completeness", value: `${summary?.avg_complete_pct ?? 0}%`, tone: "text-slate-900" },
        ].map((t) => (
          <div key={t.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t.label}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${t.tone}`}>{t.value}</p>
          </div>
        ))}
      </div>

      {/* What to chase first — one row per field, ordered by how many people are missing it */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Chase list</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {fieldOrder
            .map((key) => ({ key, missing: summary?.by_field?.[key] ?? 0 }))
            .filter((f) => f.missing > 0)
            .sort((a, b) => b.missing - a.missing)
            .map((f) => (
              <div key={f.key} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-lg font-bold tabular-nums text-rose-600">{f.missing}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{labelOf(f.key)}</p>
                  <p className="truncate text-xs text-slate-400">{CONSEQUENCE[f.key] ?? "Missing"}</p>
                </div>
              </div>
            ))}
          {Object.values(summary?.by_field ?? {}).every((v) => v === 0) && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Every required record is on file for this team.
            </div>
          )}
        </div>
      </div>

      {/* Per-member grid — click through to the full member view */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">By member</h3>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5 text-left font-semibold">Member</th>
                {fieldOrder.map((key) => (
                  <th key={key} className="px-2 py-2.5 text-center font-semibold" title={labelOf(key)}>
                    {labelOf(key).split(" ")[0]}
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right font-semibold">Complete</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {ranked.map((m) => (
                <tr
                  key={m.employee_id}
                  onClick={() => setSelected({ id: m.employee_id, name: m.full_name })}
                  className="cursor-pointer border-b border-slate-50 hover:bg-slate-50"
                >
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-900">{m.full_name}</p>
                    <p className="text-xs text-slate-400">
                      {m.employee_code}{m.designation ? ` · ${m.designation}` : ""}
                    </p>
                  </td>
                  {fieldOrder.map((key) => {
                    const f = m.fields.find((x) => x.key === key);
                    return (
                      <td key={key} className="px-2 py-2.5 text-center">
                        {f?.present ? (
                          <span className="text-emerald-500" title="On record">✓</span>
                        ) : (
                          <span
                            className={f?.critical ? "font-bold text-rose-500" : "text-amber-500"}
                            title={CONSEQUENCE[key] ?? "Missing"}
                          >
                            ✕
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className={`text-sm font-bold tabular-nums ${
                        m.complete_pct === 100 ? "text-emerald-600" : m.complete_pct >= 70 ? "text-amber-600" : "text-rose-600"
                      }`}
                    >
                      {m.complete_pct}%
                    </span>
                  </td>
                  <td className="pr-3 text-slate-300"><ChevronRight className="h-4 w-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <TeamMemberDrawer
        employeeId={selected?.id ?? null}
        employeeName={selected?.name}
        open={!!selected}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
    </div>
  );
}
