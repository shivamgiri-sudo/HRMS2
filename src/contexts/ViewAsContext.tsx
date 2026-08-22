import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import type { AppRole } from "@/types/roles";
import type { UserRoleData, WorkforcePageAccess } from "@/hooks/useUserRole";

// ─── Feature flag key ──────────────────────────────────────────────────────────
const LS_ENABLED_KEY = "hrms_viewas_enabled";

// ─── Minimal employee option shape (from /api/employees/options/search) ────────
export interface ViewAsEmployee {
  id: string;
  employee_code: string;
  full_name: string;
  designation_name?: string;
  branch_name?: string;
  primary_role?: string;
}

// ─── Role alias expansion (mirrors useUserRole.ts — kept local to avoid export) ─
const ROLE_ALIASES: Record<string, string[]> = {
  manager: ["process_manager"],
  process_manager: ["manager"],
  tl: ["team_leader"],
  team_leader: ["tl"],
};

function expandRoleKeys(values: string[]): string[] {
  const expanded = new Set(values.filter(Boolean));
  for (const role of values) {
    for (const alias of ROLE_ALIASES[role] ?? []) expanded.add(alias);
  }
  return Array.from(expanded);
}

const ROLE_PRIORITY: AppRole[] = [
  "super_admin","admin","hr","ceo","branch_head","process_manager","manager",
  "assistant_manager","wfm","finance","payroll","qa","recruiter","trainer",
  "team_leader","tl","employee",
];

function getPrimaryRole(roles: AppRole[]): AppRole | null {
  const expanded = expandRoleKeys(roles);
  return ROLE_PRIORITY.find((p) => expanded.includes(p)) ?? null;
}

// ─── Context shape ─────────────────────────────────────────────────────────────
interface ViewAsContextValue {
  isViewAsEnabled: boolean;
  activeEmployee: ViewAsEmployee | null;
  isLoading: boolean;
  setActiveEmployee: (emp: ViewAsEmployee) => Promise<void>;
  clearViewAs: () => void;
  toggleFeatureEnabled: () => void;
}

const ViewAsContext = createContext<ViewAsContextValue | null>(null);

// ─── Provider ──────────────────────────────────────────────────────────────────
export function ViewAsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [isViewAsEnabled, setIsViewAsEnabled] = useState<boolean>(
    () => localStorage.getItem(LS_ENABLED_KEY) === "true"
  );
  const [activeEmployee, setActiveEmployeeState] = useState<ViewAsEmployee | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Clear impersonation when feature is toggled off
  const clearViewAs = useCallback(() => {
    setActiveEmployeeState(null);
    if (user?.id) {
      queryClient.invalidateQueries({ queryKey: ["user-role-workforce-os", user.id] });
    }
  }, [queryClient, user?.id]);

  const toggleFeatureEnabled = useCallback(() => {
    setIsViewAsEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(LS_ENABLED_KEY, String(next));
      if (!next) clearViewAs();
      return next;
    });
  }, [clearViewAs]);

  // When user changes (e.g. re-login), clear any active impersonation
  const prevUserId = useRef(user?.id);
  useEffect(() => {
    if (prevUserId.current !== user?.id) {
      prevUserId.current = user?.id;
      setActiveEmployeeState(null);
    }
  }, [user?.id]);

  // Real page grants for a role, in the shape useWorkforceAccess()'s canViewPage()
  // expects. Previously this whole feature hardcoded `pages: []`, which made
  // ProtectedRoute's `canViewPage(routePageCode)` check — "the source of truth" for
  // page-mapped routes per its own comment — deny every page-gated route for every
  // impersonated employee regardless of their real role's real grants. Fetched from
  // the same admin-only endpoint the role-permissions editor UI uses
  // (GET /api/access/roles/:roleKey/permissions), not invented here.
  async function fetchRolePages(roleKey: string): Promise<WorkforcePageAccess[]> {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/access/roles/${roleKey}/permissions`
      );
      const rows = res?.data ?? [];
      return rows.map((row) => ({
        page_code: row.page_code,
        can_view: Boolean(row.permissions?.can_view),
        can_create: Boolean(row.permissions?.can_create),
        can_edit: Boolean(row.permissions?.can_edit),
        can_delete: Boolean(row.permissions?.can_delete),
        can_export: Boolean(row.permissions?.can_export),
      }));
    } catch {
      // Same fail-closed default the rest of this hook already relies on: an
      // empty pages list denies every page-mapped route rather than opening one.
      return [];
    }
  }

  const setActiveEmployee = useCallback(
    async (emp: ViewAsEmployee) => {
      if (!user?.id) return;
      setIsLoading(true);
      try {
        // Fetch full employee record to get role
        const res = await hrmsApi.get<{ success: boolean; data: any }>(
          `/api/employees/${emp.id}`
        );
        const empData = res?.data ?? res;
        const rawRole: string =
          empData?.primary_role ??
          empData?.role ??
          emp.primary_role ??
          "employee";

        const roles = [rawRole] as AppRole[];
        const roleKeys = expandRoleKeys(roles);
        const primaryRole = getPrimaryRole(roles);
        const pages = await fetchRolePages(rawRole);

        const synthetic: UserRoleData = {
          roles,
          roleKeys,
          primaryRole,
          employeeId: String(emp.id),
          employeeCode: empData?.employee_code ?? emp.employee_code,
          employeeName: empData?.full_name ?? emp.full_name,
          scopes: [],
          pages,
          disabledPageCodes: [],
        };

        queryClient.setQueryData(
          ["user-role-workforce-os", user.id],
          synthetic
        );
        setActiveEmployeeState({
          ...emp,
          primary_role: rawRole,
          designation_name: empData?.designation_name ?? emp.designation_name,
          branch_name: empData?.branch_name ?? emp.branch_name,
        });
      } catch {
        // Fallback: use whatever role was passed with the option
        const rawRole = emp.primary_role ?? "employee";
        const roles = [rawRole] as AppRole[];
        const pages = await fetchRolePages(rawRole);
        const synthetic: UserRoleData = {
          roles,
          roleKeys: expandRoleKeys(roles),
          primaryRole: getPrimaryRole(roles),
          employeeId: String(emp.id),
          employeeCode: emp.employee_code,
          employeeName: emp.full_name,
          scopes: [],
          pages,
          disabledPageCodes: [],
        };
        queryClient.setQueryData(["user-role-workforce-os", user.id], synthetic);
        setActiveEmployeeState(emp);
      } finally {
        setIsLoading(false);
      }
    },
    [queryClient, user?.id]
  );

  const value = useMemo(
    () => ({ isViewAsEnabled, activeEmployee, isLoading, setActiveEmployee, clearViewAs, toggleFeatureEnabled }),
    [isViewAsEnabled, activeEmployee, isLoading, setActiveEmployee, clearViewAs, toggleFeatureEnabled]
  );

  return (
    <ViewAsContext.Provider value={value}>
      {/* Amber banner shown when impersonating */}
      {activeEmployee && (
        <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-3 bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-900 shadow-md">
          <span>
            Viewing as: <strong>{activeEmployee.full_name}</strong>
            {activeEmployee.designation_name && (
              <span className="ml-1 font-normal opacity-80">
                · {activeEmployee.designation_name}
              </span>
            )}
            {activeEmployee.branch_name && (
              <span className="ml-1 font-normal opacity-80">
                · {activeEmployee.branch_name}
              </span>
            )}
            {activeEmployee.primary_role && (
              <span className="ml-2 rounded-full bg-amber-600 px-2 py-0.5 text-xs text-white">
                {activeEmployee.primary_role}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={clearViewAs}
            className="ml-2 flex items-center gap-1 rounded-full bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-700 transition-colors"
          >
            <X className="h-3 w-3" />
            Exit
          </button>
        </div>
      )}
      {/* Push content down when banner is showing */}
      {activeEmployee && <div className="h-10 flex-shrink-0" />}
      {children}
    </ViewAsContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────────
export function useViewAs(): ViewAsContextValue {
  const ctx = useContext(ViewAsContext);
  if (!ctx) throw new Error("useViewAs must be used inside ViewAsProvider");
  return ctx;
}
