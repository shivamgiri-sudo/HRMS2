/**
 * UAT control-plane viewer.
 *
 * Named "admin" for consistency with its page code, but it is deliberately READ-ONLY, and
 * the page says so plainly. The rules that decide what an automated change may touch are
 * code, reviewed through a pull request with CODEOWNERS attached — not configuration a
 * single admin can widen from inside the running application.
 *
 * Showing them here anyway matters: a locked toggle with no explanation invites someone to
 * go looking for the override. Showing the rule, the reason, and where it lives answers the
 * question instead.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileCode, Loader, Lock, RefreshCcw, Search } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

interface PathRule {
  tier: "deny" | "review";
  category: string;
  pattern: string;
  reason: string;
}

interface Capability {
  key: string;
  name: string;
  class: string;
  requiredApproverRoles: string[];
  mandatoryTests: string[];
  reason: string;
}

interface ControlPlane {
  protectedPaths: { sha256: string; rules: PathRule[] };
  capabilities: { sha256: string; items: Capability[] };
  editableInApp: boolean;
  note: string;
}

const CLASS_STYLES: Record<string, string> = {
  DENY: "bg-red-100 text-red-800 border-red-300",
  HIGH_REVIEW: "bg-orange-100 text-orange-800 border-orange-300",
  REVIEW: "bg-amber-100 text-amber-800 border-amber-300",
  STANDARD: "bg-sky-100 text-sky-800 border-sky-300",
  TRIVIAL: "bg-slate-100 text-slate-700 border-slate-300",
};

const TIER_STYLES: Record<string, string> = {
  deny: "bg-red-100 text-red-800 border-red-300",
  review: "bg-amber-100 text-amber-800 border-amber-300",
};

export default function NativeUatChecklistAdmin() {
  const [data, setData] = useState<ControlPlane | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<"capabilities" | "paths">("capabilities");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<{ data: ControlPlane }>("/api/uat/control-plane");
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the control plane.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const q = filter.trim().toLowerCase();

  const capabilities = useMemo(() => {
    const items = data?.capabilities.items ?? [];
    if (!q) return items;
    return items.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.key.toLowerCase().includes(q) ||
        c.reason.toLowerCase().includes(q)
    );
  }, [data, q]);

  const rules = useMemo(() => {
    const items = data?.protectedPaths.rules ?? [];
    if (!q) return items;
    return items.filter(
      (r) => r.pattern.toLowerCase().includes(q) || r.reason.toLowerCase().includes(q)
    );
  }, [data, q]);

  return (
    <DashboardLayout>
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">UAT safety rules</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              These decide which parts of HRMS an automated change may touch, and which need a
              named human first. Risk is judged on two dimensions at once — the files a change
              would reach, and the business capability it affects — and the stricter of the two
              wins.
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="inline-flex shrink-0 items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-50 p-4">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <div className="text-sm text-slate-700">
            <p className="font-medium text-slate-900">Read-only, on purpose</p>
            <p className="mt-1">
              {data?.note ??
                "These rules are code, not configuration. They change through a reviewed pull request."}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Defined in{" "}
              <code className="rounded bg-white px-1 py-0.5 font-mono">uat/capability-registry.json</code>{" "}
              and{" "}
              <code className="rounded bg-white px-1 py-0.5 font-mono">uat/protected-paths.json</code>,
              with required reviewers set in <code className="rounded bg-white px-1 py-0.5 font-mono">.github/CODEOWNERS</code>.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Loader className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : !data ? null : (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <div className="flex rounded border border-slate-300 bg-white p-0.5">
                {(
                  [
                    ["capabilities", `Business capabilities (${data.capabilities.items.length})`],
                    ["paths", `Protected paths (${data.protectedPaths.rules.length})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`rounded px-3 py-1.5 text-sm font-medium ${
                      tab === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter…"
                  className="w-full rounded border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-slate-500 focus:outline-none"
                />
              </div>
            </div>

            {tab === "capabilities" ? (
              <ul className="mt-4 space-y-2">
                {capabilities.map((c) => (
                  <li key={c.key} className="rounded border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{c.name}</span>
                      <span
                        className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
                          CLASS_STYLES[c.class] ?? CLASS_STYLES.TRIVIAL
                        }`}
                      >
                        {c.class.replace("_", " ")}
                      </span>
                      <span className="ml-auto font-mono text-[11px] text-slate-400">{c.key}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{c.reason}</p>
                    {(c.requiredApproverRoles.length > 0 || c.mandatoryTests.length > 0) && (
                      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                        {c.requiredApproverRoles.length > 0 && (
                          <span>
                            Requires:{" "}
                            <span className="font-medium text-slate-700">
                              {c.requiredApproverRoles.join(", ")}
                            </span>
                          </span>
                        )}
                        {c.mandatoryTests.length > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <FileCode className="h-3 w-3" />
                            {c.mandatoryTests.length} mandatory test
                            {c.mandatoryTests.length === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
                {capabilities.length === 0 && (
                  <li className="py-8 text-center text-sm text-slate-400">Nothing matches.</li>
                )}
              </ul>
            ) : (
              <ul className="mt-4 space-y-1.5">
                {rules.map((r) => (
                  <li
                    key={`${r.tier}-${r.pattern}`}
                    className="rounded border border-slate-200 bg-white p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          TIER_STYLES[r.tier]
                        }`}
                      >
                        {r.tier}
                      </span>
                      <code className="font-mono text-xs text-slate-800">{r.pattern}</code>
                      <span className="ml-auto text-[11px] text-slate-400">{r.category}</span>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-600">{r.reason}</p>
                  </li>
                ))}
                {rules.length === 0 && (
                  <li className="py-8 text-center text-sm text-slate-400">Nothing matches.</li>
                )}
              </ul>
            )}

            <p className="mt-6 font-mono text-[11px] text-slate-400">
              registry {data.capabilities.sha256.slice(0, 12)} · paths{" "}
              {data.protectedPaths.sha256.slice(0, 12)}
            </p>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
