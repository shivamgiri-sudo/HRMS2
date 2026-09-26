import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export type CoachingSource = { employeeId: string } | { email: string } | { onfidoAnalyst: string };

interface CoachingData {
  employee: { id: string; code: string | null; name: string } | null;
  progress: {
    batchNo: string | null;
    batchName: string | null;
    mcqBestScore: number | null;
    readinessScore: number | null;
    attritionRisk: string | null;
    opsHandoverReady: number | null;
    syncedAt: string | null;
  } | null;
  courses: Array<{
    name: string;
    completionPct: number | null;
    status: string | null;
    dueDate: string | null;
    lastAccessed: string | null;
    overdue: boolean;
  }>;
  assessments: Array<{
    name: string;
    attempt: number;
    percentage: number | null;
    result: string | null;
    failed: boolean;
    attemptedAt: string | null;
  }>;
  certifications: Array<{
    name: string;
    status: string | null;
    issuedDate: string | null;
    expiryDate: string | null;
  }>;
  reminders: Array<{ type: string | null; sentAt: string | null }>;
}

const DASH = "-";
const pct = (value: number | null): string =>
  value === null ? DASH : `${Math.round(value)}%`;

function Tile({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "red" | "green" | "amber";
}) {
  const toneClass = {
    slate: "text-slate-900",
    red: "text-red-700",
    green: "text-emerald-700",
    amber: "text-amber-700",
  }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-1 text-lg font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}

function Section({
  title,
  empty,
  children,
  isEmpty,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
  isEmpty: boolean;
}) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      {isEmpty ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
          {empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * One person's coaching record from the synced LMS data: batch readiness, courses (overdue first),
 * assessment attempts, certifications and the reminders already sent. Used by the Coaching Center and by the
 * Onfido analyst drill-down (which knows analysts by email).
 */
export function CoachingDetail({ source }: { source: CoachingSource }) {
  const [kind, key, url] =
    "onfidoAnalyst" in source
      ? (["onfido", source.onfidoAnalyst, `/api/lms/coaching/onfido-analyst?email=${encodeURIComponent(source.onfidoAnalyst)}`] as const)
      : "email" in source
        ? (["email", source.email, `/api/lms/coaching/by-email?email=${encodeURIComponent(source.email)}`] as const)
        : (["id", source.employeeId, `/api/lms/coaching/employee/${source.employeeId}`] as const);
  const query = useQuery({
    queryKey: ["coaching", kind, key],
    queryFn: () => hrmsApi.get<{ data: CoachingData }>(url),
    staleTime: 60_000,
    retry: false,
  });

  if (query.isLoading)
    return (
      <p className="p-4 text-sm text-slate-500">Loading coaching record...</p>
    );
  if (query.error instanceof Error)
    return (
      <p role="alert" className="p-4 text-sm text-slate-600">
        {query.error.message}
      </p>
    );
  const data = query.data?.data;
  if (!data) return null;
  const p = data.progress;
  const risk = (p?.attritionRisk ?? "").toLowerCase();

  return (
    <div className="space-y-5">
      {p ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Batch" value={p.batchName ?? p.batchNo ?? DASH} />
          <Tile label="Readiness" value={pct(p.readinessScore)} />
          <Tile
            label="Handover"
            value={
              p.opsHandoverReady === null
                ? DASH
                : p.opsHandoverReady === 1
                  ? "Ready"
                  : "Not ready"
            }
            tone={
              p.opsHandoverReady === 1
                ? "green"
                : p.opsHandoverReady === 0
                  ? "amber"
                  : "slate"
            }
          />
          <Tile
            label="Attrition risk"
            value={p.attritionRisk ? p.attritionRisk : DASH}
            tone={risk === "red" ? "red" : risk === "green" ? "green" : "slate"}
          />
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          No LMS learner record has synced for this person yet.
        </p>
      )}
      {p?.syncedAt && (
        <p className="text-xs text-slate-400">LMS data synced {p.syncedAt}</p>
      )}

      <Section
        title="Courses"
        isEmpty={data.courses.length === 0}
        empty="No courses assigned."
      >
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="p-2">Course</th>
              <th className="p-2">Progress</th>
              <th className="p-2">Due</th>
              <th className="p-2">Last opened</th>
            </tr>
          </thead>
          <tbody>
            {data.courses.map((c) => (
              <tr
                key={`${c.name}-${c.dueDate}`}
                className="border-t border-slate-100"
              >
                <td className="p-2 font-medium text-slate-800">
                  {c.name}
                  {c.overdue && (
                    <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                      Overdue
                    </span>
                  )}
                </td>
                <td className="p-2">{pct(c.completionPct)}</td>
                <td className="p-2 font-mono text-slate-600">
                  {c.dueDate ?? DASH}
                </td>
                <td className="p-2 font-mono text-slate-600">
                  {c.lastAccessed ?? DASH}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Assessments"
        isEmpty={data.assessments.length === 0}
        empty="No assessment attempts."
      >
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="p-2">Assessment</th>
              <th className="p-2">Attempt</th>
              <th className="p-2">Score</th>
              <th className="p-2">Result</th>
              <th className="p-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {data.assessments.map((a) => (
              <tr
                key={`${a.name}-${a.attempt}-${a.attemptedAt}`}
                className="border-t border-slate-100"
              >
                <td className="p-2 font-medium text-slate-800">{a.name}</td>
                <td className="p-2">{a.attempt}</td>
                <td className="p-2">{pct(a.percentage)}</td>
                <td className="p-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${a.failed ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}
                  >
                    {a.result ?? DASH}
                  </span>
                </td>
                <td className="p-2 font-mono text-slate-600">
                  {a.attemptedAt ?? DASH}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Certifications"
        isEmpty={data.certifications.length === 0}
        empty="No certifications."
      >
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="p-2">Certification</th>
              <th className="p-2">Status</th>
              <th className="p-2">Issued</th>
              <th className="p-2">Expires</th>
            </tr>
          </thead>
          <tbody>
            {data.certifications.map((c) => (
              <tr
                key={`${c.name}-${c.issuedDate}`}
                className="border-t border-slate-100"
              >
                <td className="p-2 font-medium text-slate-800">{c.name}</td>
                <td className="p-2">{c.status ?? DASH}</td>
                <td className="p-2 font-mono text-slate-600">
                  {c.issuedDate ?? DASH}
                </td>
                <td className="p-2 font-mono text-slate-600">
                  {c.expiryDate ?? DASH}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {data.reminders.length > 0 && (
        <p className="text-xs text-slate-500">
          Reminders sent:{" "}
          {data.reminders
            .map((r) => `${r.type ?? "reminder"} (${r.sentAt ?? DASH})`)
            .join(", ")}
        </p>
      )}
    </div>
  );
}
