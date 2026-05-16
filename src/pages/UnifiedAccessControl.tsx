import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

type ModuleRow = { module_code: string; module_name: string; active_status: boolean };
type PageRow = { page_code: string; page_name: string; module_code: string; active_status: boolean };
type RolePageRow = {
  id?: string;
  role_key: string;
  page_code: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
  active_status: boolean;
};

const db = supabase as any;

const defaultRoles = [
  "admin",
  "hr",
  "branch_head",
  "process_head",
  "recruiter",
  "training_coordinator",
  "lms_admin",
  "trainer",
  "qa",
  "qtl",
  "quality_head",
  "wfm_admin",
  "guard",
  "supervisor",
  "manager",
  "tl",
  "employee",
  "trainee",
  "ceo",
  "management",
];

export default function UnifiedAccessControl() {
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [accessRows, setAccessRows] = useState<RolePageRow[]>([]);
  const [selectedRole, setSelectedRole] = useState("admin");
  const [selectedModule, setSelectedModule] = useState("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const [modRes, pageRes, accessRes] = await Promise.all([
        db.from("module_master").select("module_code,module_name,active_status").order("display_order"),
        db.from("page_master").select("page_code,page_name,module_code,active_status").order("display_order"),
        db.from("role_page_access").select("*").eq("role_key", selectedRole).order("page_code"),
      ]);
      if (modRes.error) throw modRes.error;
      if (pageRes.error) throw pageRes.error;
      if (accessRes.error) throw accessRes.error;
      setModules((modRes.data || []) as ModuleRow[]);
      setPages((pageRes.data || []) as PageRow[]);
      setAccessRows((accessRes.data || []) as RolePageRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load access control.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [selectedRole]);

  const accessMap = useMemo(() => {
    const map: Record<string, RolePageRow> = {};
    accessRows.forEach((row) => {
      map[row.page_code] = row;
    });
    return map;
  }, [accessRows]);

  const filteredPages = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pages
      .filter((page) => selectedModule === "ALL" || page.module_code === selectedModule)
      .filter((page) => {
        if (!q) return true;
        return [page.page_code, page.page_name, page.module_code].some((value) => String(value).toLowerCase().includes(q));
      });
  }, [pages, selectedModule, search]);

  async function upsertAccess(pageCode: string, patch: Partial<RolePageRow>) {
    setError(null);
    setMessage(null);
    const current = accessMap[pageCode];
    const next: RolePageRow = {
      role_key: selectedRole,
      page_code: pageCode,
      can_view: current?.can_view || false,
      can_create: current?.can_create || false,
      can_edit: current?.can_edit || false,
      can_delete: current?.can_delete || false,
      can_export: current?.can_export || false,
      active_status: true,
      ...patch,
    };

    const { error: saveError } = await db
      .from("role_page_access")
      .upsert(next, { onConflict: "role_key,page_code" });

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setMessage("Access updated.");
    await loadData();
  }

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Admin Settings</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">Unified Access Control</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
              Control which role can open which HRMS, ATS, LMS, WFM, Quality, Operations and Performance page.
            </p>
          </section>

          {(message || error) && (
            <div className={`rounded-2xl border p-4 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
              {error || message}
            </div>
          )}

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Role">
                <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400">
                  {defaultRoles.map((role) => <option key={role} value={role}>{role.replace(/_/g, " ")}</option>)}
                </select>
              </Field>
              <Field label="Module">
                <select value={selectedModule} onChange={(e) => setSelectedModule(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400">
                  <option value="ALL">All Modules</option>
                  {modules.map((module) => <option key={module.module_code} value={module.module_code}>{module.module_name}</option>)}
                </select>
              </Field>
              <Field label="Search Page">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search page" className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400" />
              </Field>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Page Access for {selectedRole.replace(/_/g, " ")}</h2>
                <p className="mt-1 text-sm text-slate-500">Toggle page permissions. View controls sidebar/module launcher visibility.</p>
              </div>
              <button onClick={loadData} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Refresh</button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <Th>Module</Th>
                      <Th>Page</Th>
                      <Th>View</Th>
                      <Th>Create</Th>
                      <Th>Edit</Th>
                      <Th>Delete</Th>
                      <Th>Export</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {loading ? (
                      <tr><td colSpan={7} className="p-8 text-center text-sm text-slate-500">Loading access rows...</td></tr>
                    ) : filteredPages.length === 0 ? (
                      <tr><td colSpan={7} className="p-8 text-center text-sm text-slate-500">No pages found.</td></tr>
                    ) : (
                      filteredPages.map((page) => {
                        const access = accessMap[page.page_code];
                        return (
                          <tr key={page.page_code} className="hover:bg-slate-50">
                            <Td>{page.module_code}</Td>
                            <Td>
                              <div className="font-semibold text-slate-900">{page.page_name}</div>
                              <div className="text-xs text-slate-400">{page.page_code}</div>
                            </Td>
                            <Toggle checked={!!access?.can_view} onChange={(checked) => upsertAccess(page.page_code, { can_view: checked })} />
                            <Toggle checked={!!access?.can_create} onChange={(checked) => upsertAccess(page.page_code, { can_create: checked })} />
                            <Toggle checked={!!access?.can_edit} onChange={(checked) => upsertAccess(page.page_code, { can_edit: checked })} />
                            <Toggle checked={!!access?.can_delete} onChange={(checked) => upsertAccess(page.page_code, { can_delete: checked })} />
                            <Toggle checked={!!access?.can_export} onChange={(checked) => upsertAccess(page.page_code, { can_export: checked })} />
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <td className="whitespace-nowrap px-4 py-3">
      <button
        onClick={() => onChange(!checked)}
        className={`rounded-full px-3 py-1 text-xs font-semibold ${checked ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
      >
        {checked ? "Yes" : "No"}
      </button>
    </td>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="whitespace-nowrap px-4 py-3 text-slate-600">{children}</td>;
}
