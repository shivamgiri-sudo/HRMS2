import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

type ModuleMaster = {
  id: string;
  module_code: string;
  module_name: string;
  module_group: string | null;
  description: string | null;
  route_prefix: string | null;
  icon_name: string | null;
  display_order: number | null;
  active_status: boolean;
};

type PageMaster = {
  id: string;
  module_code: string;
  page_code: string;
  page_name: string;
  page_description: string | null;
  route_path: string | null;
  legacy_url: string | null;
  is_embedded: boolean;
  open_mode: "internal" | "iframe" | "new_tab";
  icon_name: string | null;
  display_order: number | null;
  active_status: boolean;
};

type RolePageAccess = {
  role_key: string;
  page_code: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
  active_status: boolean;
};

type UserRoleRow = {
  role?: string;
  role_key?: string;
};

type ScopeRow = {
  role_key: string;
  scope_type: string;
  active_status: boolean;
};

const db = supabase as any;

function normalizeRole(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function isPlaceholderUrl(url?: string | null) {
  if (!url) return true;
  return url.includes("PASTE_") || url.includes("_HERE");
}

function statusText(url?: string | null) {
  return isPlaceholderUrl(url) ? "URL pending" : "Ready";
}

export default function ModuleLauncher() {
  const [modules, setModules] = useState<ModuleMaster[]>([]);
  const [pages, setPages] = useState<PageMaster[]>([]);
  const [pageAccess, setPageAccess] = useState<RolePageAccess[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [scopes, setScopes] = useState<ScopeRow[]>([]);
  const [selectedModule, setSelectedModule] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iframePage, setIframePage] = useState<PageMaster | null>(null);

  async function loadLauncher() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const user = authData.user;
      if (!user) throw new Error("User session not found. Please login again.");

      const [moduleRes, pageRes, userRoleRes, scopeRes] = await Promise.all([
        db.from("module_master").select("*").eq("active_status", true).order("display_order", { ascending: true }),
        db.from("page_master").select("*").eq("active_status", true).order("display_order", { ascending: true }),
        db.from("user_roles").select("role").eq("user_id", user.id),
        db.from("user_assignment_scope").select("role_key, scope_type, active_status").eq("user_id", user.id).eq("active_status", true),
      ]);

      if (moduleRes.error) throw moduleRes.error;
      if (pageRes.error) throw pageRes.error;

      const detectedRoles = new Set<string>();
      ((userRoleRes.data || []) as UserRoleRow[]).forEach((r) => detectedRoles.add(normalizeRole(r.role)));
      ((scopeRes.data || []) as ScopeRow[]).forEach((r) => detectedRoles.add(normalizeRole(r.role_key)));

      if (detectedRoles.size === 0) detectedRoles.add("employee");
      const roleList = Array.from(detectedRoles).filter(Boolean);

      const accessRes = await db
        .from("role_page_access")
        .select("role_key,page_code,can_view,can_create,can_edit,can_delete,can_export,active_status")
        .in("role_key", roleList)
        .eq("can_view", true)
        .eq("active_status", true);

      if (accessRes.error) throw accessRes.error;

      setModules((moduleRes.data || []) as ModuleMaster[]);
      setPages((pageRes.data || []) as PageMaster[]);
      setPageAccess((accessRes.data || []) as RolePageAccess[]);
      setRoles(roleList);
      setScopes((scopeRes.data || []) as ScopeRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load module launcher.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLauncher();
  }, []);

  const accessiblePageCodes = useMemo(() => {
    const adminLike = roles.some((r) => ["admin", "super_admin", "company_admin"].includes(r));
    if (adminLike) return new Set(pages.map((p) => p.page_code));
    return new Set(pageAccess.filter((a) => a.can_view && a.active_status).map((a) => a.page_code));
  }, [pageAccess, pages, roles]);

  const visiblePages = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pages
      .filter((page) => accessiblePageCodes.has(page.page_code))
      .filter((page) => selectedModule === "ALL" || page.module_code === selectedModule)
      .filter((page) => {
        if (!q) return true;
        return [page.page_name, page.page_code, page.page_description, page.module_code]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      })
      .sort((a, b) => (a.display_order || 999) - (b.display_order || 999));
  }, [accessiblePageCodes, pages, search, selectedModule]);

  const moduleCounts = useMemo(() => {
    const map: Record<string, number> = {};
    visiblePages.forEach((page) => {
      map[page.module_code] = (map[page.module_code] || 0) + 1;
    });
    return map;
  }, [visiblePages]);

  function openPage(page: PageMaster) {
    setMessage(null);
    setError(null);

    if (page.is_embedded || page.open_mode === "iframe") {
      if (isPlaceholderUrl(page.legacy_url)) {
        setError(`${page.page_name} URL is not configured yet. Update page_master.legacy_url for ${page.page_code}.`);
        return;
      }
      setIframePage(page);
      return;
    }

    if (page.open_mode === "new_tab") {
      const url = page.legacy_url || page.route_path;
      if (!url || isPlaceholderUrl(url)) {
        setError(`${page.page_name} URL is not configured yet.`);
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    if (page.route_path) {
      window.location.href = page.route_path;
      return;
    }

    setError(`${page.page_name} route is not configured yet.`);
  }

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Unified Workforce OS</p>
                <h1 className="mt-2 text-2xl font-semibold text-slate-950">My Modules & Pages</h1>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
                  One HRMS shell for HRMS, ATS, LMS, WFM, Quality, Operations and Performance. Pages are shown based on your role and assignment scope.
                </p>
              </div>

              <button
                onClick={loadLauncher}
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Refresh Access
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {roles.map((role) => (
                <span key={role} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {role.replace(/_/g, " ")}
                </span>
              ))}
              {scopes.map((scope, index) => (
                <span key={`${scope.role_key}-${index}`} className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                  {scope.role_key}: {scope.scope_type}
                </span>
              ))}
            </div>
          </section>

          {(message || error) && (
            <div className={`rounded-2xl border p-4 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
              {error || message}
            </div>
          )}

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
              <select
                value={selectedModule}
                onChange={(e) => setSelectedModule(e.target.value)}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
              >
                <option value="ALL">All Modules</option>
                {modules.map((module) => (
                  <option key={module.module_code} value={module.module_code}>
                    {module.module_name}
                  </option>
                ))}
              </select>

              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search pages like Recruiter, LMS, WFM, Quality, Performance..."
                className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
              />
            </div>
          </section>

          {loading ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">Loading modules...</div>
          ) : visiblePages.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
              No pages are assigned to your current role. Ask Admin to configure role-page access.
            </div>
          ) : (
            <div className="grid gap-5">
              {modules
                .filter((module) => selectedModule === "ALL" || module.module_code === selectedModule)
                .filter((module) => moduleCounts[module.module_code])
                .map((module) => {
                  const modulePages = visiblePages.filter((p) => p.module_code === module.module_code);
                  return (
                    <section key={module.module_code} className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-semibold text-slate-950">{module.module_name}</h2>
                          <p className="text-sm text-slate-500">{module.description}</p>
                        </div>
                        <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{modulePages.length} pages</span>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {modulePages.map((page) => (
                          <article key={page.page_code} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">{page.module_code}</p>
                                <h3 className="mt-2 text-base font-semibold text-slate-950">{page.page_name}</h3>
                              </div>
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusText(page.legacy_url) === "Ready" || !page.is_embedded ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                                {page.is_embedded ? statusText(page.legacy_url) : "Internal"}
                              </span>
                            </div>

                            <p className="mt-3 min-h-[48px] text-sm leading-6 text-slate-500">{page.page_description || "Configured application page."}</p>

                            <div className="mt-4 flex items-center justify-between gap-3">
                              <code className="truncate rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500">{page.page_code}</code>
                              <button
                                onClick={() => openPage(page)}
                                className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                              >
                                Open
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {iframePage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Embedded Module</p>
                <h3 className="text-base font-semibold text-slate-950">{iframePage.page_name}</h3>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => window.open(iframePage.legacy_url || "", "_blank", "noopener,noreferrer")}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Open New Tab
                </button>
                <button
                  onClick={() => setIframePage(null)}
                  className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Close
                </button>
              </div>
            </div>
            <iframe title={iframePage.page_name} src={iframePage.legacy_url || ""} className="h-full w-full border-0" />
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
