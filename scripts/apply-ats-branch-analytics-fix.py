from __future__ import annotations

from pathlib import Path
import re

SERVICE_PATH = Path("backend/src/modules/ats/recruiter-hiring.service.ts")
PAGE_PATH = Path("src/pages/NativeATSHiringEntry.tsx")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one regex match, found {count}")
    return updated


def patch_service(service: str) -> str:
    service = regex_once(
        service,
        r"export interface HiringActivityAnalytics \{.*?\n\}\n\nexport async function getHiringActivityAnalytics",
        """export interface HiringActivityAnalytics {
  funnel: { stage: string; count: number; pct: number }[];
  byOutcome: { label: string; count: number }[];
  bySource: { label: string; total: number; walkins: number; selected: number; joined: number }[];
  byProcess: { label: string; total: number; walkins: number; selected: number; joined: number }[];
  byRecruiter: { label: string; total: number; walkins: number; selected: number; joined: number; selRate: number }[];
  byBranch: Array<{
    label: string;
    total: number;
    contacted: number;
    walkins: number;
    selected: number;
    joined: number;
    contactRate: number;
    walkinRate: number;
    selectionRate: number;
    joinRate: number;
    overallRate: number;
    volumeSharePct: number;
    dataQualityIssues: string[];
  }>;
  branchOptions: string[];
  byGender: { label: string; count: number; walkins: number; selected: number; joined: number }[];
  byDayOfWeek: { label: string; count: number }[];
  trend: { date: string; logged: number; walkins: number; selected: number }[];
  followupDue: { id: string; candidate_name: string; mobile: string; followup_date: string; followup_reason: string }[];
}

export async function getHiringActivityAnalytics""",
        "analytics response interface",
    )

    service = replace_once(
        service,
        '  if (filters.branch)      { clauses.push("arha.branch_name LIKE ?");              params.push(`%${filters.branch}%`); }',
        """  if (filters.branch) {
    clauses.push(`(
      LOWER(TRIM(COALESCE(arha.branch_name, ''))) = LOWER(TRIM(?))
      OR LOWER(TRIM(COALESCE(arha.location_name, ''))) = LOWER(TRIM(?))
      OR EXISTS (
        SELECT 1
          FROM branch_master bm_filter
         WHERE LOWER(TRIM(COALESCE(bm_filter.branch_name, ''))) = LOWER(TRIM(?))
           AND (
             LOWER(TRIM(COALESCE(arha.branch_name, ''))) IN (
               LOWER(TRIM(COALESCE(bm_filter.branch_name, ''))),
               LOWER(TRIM(COALESCE(bm_filter.branch_code, '')))
             )
             OR LOWER(TRIM(COALESCE(arha.location_name, ''))) IN (
               LOWER(TRIM(COALESCE(bm_filter.branch_name, ''))),
               LOWER(TRIM(COALESCE(bm_filter.branch_code, '')))
             )
           )
      )
    )`);
    params.push(filters.branch, filters.branch, filters.branch);
  }""",
        "canonical branch filter",
    )

    service = regex_once(
        service,
        r"  // Use pre-computed flag columns.*?\n  const IS_CONTACTED.*?\n  const IS_WALKIN.*?\n  const IS_SELECTED.*?\n  const IS_JOINED.*?;",
        """  // Later stages imply every earlier funnel stage. This keeps historical and
  // backfilled records from producing impossible Selected > Walk-in funnels.
  const IS_JOINED    = `arha.joined_flag = 1`;
  const IS_SELECTED  = `(arha.final_selection_flag = 1 OR ${IS_JOINED})`;
  const IS_WALKIN    = `(arha.walkin_flag = 1 OR ${IS_SELECTED})`;
  const IS_CONTACTED = `(arha.contacted_flag = 1 OR ${IS_WALKIN})`;""",
        "monotonic funnel predicates",
    )

    service = replace_once(
        service,
        """    branchRows,
    genderRows,""",
        """    branchRows,
    branchMasterRows,
    genderRows,""",
        "branch master result slot",
    )

    service = regex_once(
        service,
        r"    safe\(\(\) => db\.execute<RowDataPacket\[\]>\(\n      `SELECT COALESCE\(NULLIF\(arha\.branch_name,''\),'Unknown'\) AS label,.*?\n    \), \[\] as RowDataPacket\[\]\),\n    safe\(\(\) => db\.execute<RowDataPacket\[\]>\(\n      `SELECT COALESCE\(NULLIF\(arha\.gender",
        """    safe(() => db.execute<RowDataPacket[]>(
      `SELECT COALESCE(
                NULLIF(TRIM(arha.branch_name),''),
                NULLIF(TRIM(arha.location_name),''),
                'Unmapped'
              ) AS label,
              COUNT(*) AS total,
              SUM(CASE WHEN ${IS_CONTACTED} THEN 1 ELSE 0 END) AS contacted,
              SUM(CASE WHEN ${IS_WALKIN}    THEN 1 ELSE 0 END) AS walkins,
              SUM(CASE WHEN ${IS_SELECTED}  THEN 1 ELSE 0 END) AS selected,
              SUM(CASE WHEN ${IS_JOINED}    THEN 1 ELSE 0 END) AS joined
         FROM ats_recruiter_hiring_activity arha WHERE ${W}
         GROUP BY label ORDER BY total DESC LIMIT 100`,
      params
    ), [] as RowDataPacket[]),
    safe(() => db.execute<RowDataPacket[]>(
      `SELECT branch_name, branch_code
         FROM branch_master
        WHERE NULLIF(TRIM(branch_name), '') IS NOT NULL
        ORDER BY branch_name ASC`,
      []
    ), [] as RowDataPacket[]),
    safe(() => db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(arha.gender""",
        "branch aggregation and branch master query",
    )

    service = replace_once(
        service,
        "  const byBranch    = (branchRows as any[]).map((r) => ({ label: String(r.label || 'Unknown'), total: Number(r.total) || 0, walkins: Number(r.walkins) || 0, selected: Number(r.selected) || 0, joined: Number(r.joined) || 0 }));",
        """  const normalizeBranchKey = (value: unknown) => String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\\b(branch|office|site)\\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\\s+/g, " ")
    .trim();

  const branchAliases = new Map<string, string>();
  const branchOptionSet = new Set<string>();
  for (const row of branchMasterRows as any[]) {
    const preferred = String(row.branch_name ?? "").trim();
    if (!preferred) continue;
    branchOptionSet.add(preferred);
    const nameKey = normalizeBranchKey(preferred);
    const codeKey = normalizeBranchKey(row.branch_code);
    if (nameKey) branchAliases.set(nameKey, preferred);
    if (codeKey) branchAliases.set(codeKey, preferred);
  }

  const branchAccumulator = new Map<string, {
    label: string;
    total: number;
    contacted: number;
    walkins: number;
    selected: number;
    joined: number;
  }>();
  for (const row of branchRows as any[]) {
    const rawLabel = String(row.label ?? "").trim() || "Unmapped";
    const preferred = branchAliases.get(normalizeBranchKey(rawLabel)) ?? rawLabel.replace(/\\s+/g, " ");
    const current = branchAccumulator.get(preferred) ?? {
      label: preferred,
      total: 0,
      contacted: 0,
      walkins: 0,
      selected: 0,
      joined: 0,
    };
    current.total += Number(row.total) || 0;
    current.contacted += Number(row.contacted) || 0;
    current.walkins += Number(row.walkins) || 0;
    current.selected += Number(row.selected) || 0;
    current.joined += Number(row.joined) || 0;
    branchAccumulator.set(preferred, current);
  }

  const rate = (numerator: number, denominator: number) => denominator > 0
    ? Math.round((numerator / denominator) * 1000) / 10
    : 0;
  const byBranch = Array.from(branchAccumulator.values())
    .map((row) => {
      const dataQualityIssues: string[] = [];
      if (row.contacted > row.total) dataQualityIssues.push("Contacted exceeds logged");
      if (row.walkins > row.contacted) dataQualityIssues.push("Walk-ins exceed contacted");
      if (row.selected > row.walkins) dataQualityIssues.push("Selected exceeds walk-ins");
      if (row.joined > row.selected) dataQualityIssues.push("Joined exceeds selected");
      return {
        ...row,
        contactRate: rate(row.contacted, row.total),
        walkinRate: rate(row.walkins, row.contacted),
        selectionRate: rate(row.selected, row.walkins),
        joinRate: rate(row.joined, row.selected),
        overallRate: rate(row.joined, row.total),
        volumeSharePct: rate(row.total, logged),
        dataQualityIssues,
      };
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const branchOptions = Array.from(branchOptionSet).sort((a, b) => a.localeCompare(b));""",
        "branch normalization and rates",
    )

    service = replace_once(
        service,
        "  return { funnel, byOutcome, bySource, byProcess, byRecruiter, byBranch, byGender, byDayOfWeek, trend, followupDue };",
        "  return { funnel, byOutcome, bySource, byProcess, byRecruiter, byBranch, branchOptions, byGender, byDayOfWeek, trend, followupDue };",
        "analytics response payload",
    )

    return service


def patch_page(page: str) -> str:
    page = replace_once(
        page,
        "  byBranch: { label: string; total: number; walkins: number; selected: number; joined: number }[];",
        """  byBranch: Array<{
    label: string;
    total: number;
    contacted: number;
    walkins: number;
    selected: number;
    joined: number;
    contactRate: number;
    walkinRate: number;
    selectionRate: number;
    joinRate: number;
    overallRate: number;
    volumeSharePct: number;
    dataQualityIssues: string[];
  }>;
  branchOptions: string[];""",
        "frontend branch analytics type",
    )

    page = regex_once(
        page,
        r'<input type="text" placeholder="All branches" value=\{aBranch\} onChange=\{\(e\) => setABranch\(e\.target\.value\)\}\s*className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs outline-none focus:border-violet-400 focus:bg-white" />',
        """<select value={aBranch} onChange={(e) => setABranch(e.target.value)}
                    className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs outline-none focus:border-violet-400 focus:bg-white">
                    <option value="">All branches</option>
                    {(analytics?.branchOptions ?? []).map((branch) => (
                      <option key={branch} value={branch}>{branch}</option>
                    ))}
                  </select>""",
        "canonical branch selector",
    )

    branch_section = """
                  {/* ── Row 4: Process + Branch Analytics ── */}
                  <div className="grid gap-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="mb-1 text-sm font-black text-slate-900">Process Breakdown</div>
                      <div className="mb-3 text-xs text-slate-400">Candidates per process — logged → walk-in → selected → joined</div>
                      {analytics.byProcess.length === 0 ? (
                        <AnalyticsEmptyState label="No process data" />
                      ) : (
                        <ResponsiveContainer width="100%" height={Math.max(220, analytics.byProcess.length * 40)}>
                          <BarChart data={analytics.byProcess} layout="vertical" margin={{ left: 10, right: 50 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                            <YAxis dataKey="label" type="category" tick={{ fontSize: 10 }} width={150} />
                            <Tooltip formatter={(v: number, name: string) => [v.toLocaleString(), name]} />
                            <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="total" fill="#94a3b8" name="Logged" radius={[0, 3, 3, 0]} />
                            <Bar dataKey="walkins" fill="#0ea5e9" name="Walk-in" radius={[0, 3, 3, 0]} />
                            <Bar dataKey="selected" fill="#10b981" name="Selected" radius={[0, 3, 3, 0]} />
                            <Bar dataKey="joined" fill="#6366f1" name="Joined" radius={[0, 3, 3, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                            <BarChart2 className="h-4 w-4 text-violet-500" />
                            Branch Analytics
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            Branch names and codes are consolidated. Selection is calculated from walk-ins; joining is calculated from selections.
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right">
                          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Branches in scope</div>
                          <div className="text-xl font-black text-slate-900">{analytics.byBranch.length}</div>
                        </div>
                      </div>

                      {analytics.byBranch.length === 0 ? (
                        <AnalyticsEmptyState label="No branch data" />
                      ) : (
                        <div className="mt-4 space-y-5">
                          <ResponsiveContainer width="100%" height={Math.max(240, Math.min(analytics.byBranch.length, 12) * 42)}>
                            <BarChart data={analytics.byBranch.slice(0, 12)} layout="vertical" margin={{ left: 10, right: 35 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(value: number) => `${value}%`} />
                              <YAxis dataKey="label" type="category" tick={{ fontSize: 10 }} width={140} />
                              <Tooltip formatter={(value: number, name: string) => [`${value}%`, name]} />
                              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                              <Bar dataKey="selectionRate" fill="#10b981" name="Selection rate" radius={[0, 3, 3, 0]} />
                              <Bar dataKey="joinRate" fill="#6366f1" name="Join rate" radius={[0, 3, 3, 0]} />
                              <Bar dataKey="overallRate" fill="#8b5cf6" name="Overall conversion" radius={[0, 3, 3, 0]} />
                            </BarChart>
                          </ResponsiveContainer>

                          <div className="overflow-x-auto rounded-xl border border-slate-200">
                            <table className="min-w-[1080px] w-full text-xs">
                              <thead className="bg-slate-50">
                                <tr className="border-b border-slate-200">
                                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase text-slate-500">Branch</th>
                                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Logged</th>
                                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Contacted</th>
                                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Walk-in</th>
                                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Selected</th>
                                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Joined</th>
                                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Contact %</th>
                                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Walk-in %</th>
                                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Selection %</th>
                                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase text-slate-500">Join %</th>
                                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase text-slate-500">Validation</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {analytics.byBranch.map((branch) => (
                                  <tr key={branch.label} className="hover:bg-slate-50/80">
                                    <td className="px-3 py-2.5">
                                      <div className="max-w-[190px] truncate font-bold text-slate-800" title={branch.label}>{branch.label}</div>
                                      <div className="mt-1 text-[10px] text-slate-400">{branch.volumeSharePct}% of logged volume</div>
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-800">{branch.total}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-blue-700">{branch.contacted}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-sky-700">{branch.walkins}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{branch.selected}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-violet-700">{branch.joined}</td>
                                    <td className="px-3 py-2.5 text-right font-bold tabular-nums">{branch.contactRate}%</td>
                                    <td className="px-3 py-2.5 text-right font-bold tabular-nums">{branch.walkinRate}%</td>
                                    <td className="px-3 py-2.5 text-right font-bold tabular-nums text-emerald-700">{branch.selectionRate}%</td>
                                    <td className="px-3 py-2.5 text-right font-bold tabular-nums text-violet-700">{branch.joinRate}%</td>
                                    <td className="px-3 py-2.5">
                                      {branch.dataQualityIssues.length === 0 ? (
                                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Valid</span>
                                      ) : (
                                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700" title={branch.dataQualityIssues.join(", ")}>Review</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Row 5: Gender Donut + Recruiter Conversion ── */}"""

    page = regex_once(
        page,
        r"\n\s*\{/\* ── Row 4: Process \+ Branch ── \*/\}.*?\n\s*\{/\* ── Row 5: Gender Donut \+ Recruiter Conversion ── \*/\}",
        "\n" + branch_section,
        "branch analytics layout",
    )

    return page


def main() -> None:
    service = SERVICE_PATH.read_text(encoding="utf-8")
    page = PAGE_PATH.read_text(encoding="utf-8")

    SERVICE_PATH.write_text(patch_service(service), encoding="utf-8")
    PAGE_PATH.write_text(patch_page(page), encoding="utf-8")


if __name__ == "__main__":
    main()
