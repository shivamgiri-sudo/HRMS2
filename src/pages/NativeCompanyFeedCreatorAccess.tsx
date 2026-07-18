import { useMemo, useState } from "react";
import { Search, ShieldCheck, Sparkles, UserPlus, UserX } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  useCompanyPostCreators,
  useGrantCompanyPostCreator,
  useRevokeCompanyPostCreator,
} from "@/hooks/useCompanyFeed";
import { useEmployeeSearchOptions } from "@/hooks/useEmployees";
import { useToast } from "@/hooks/use-toast";

function formatDateTime(value: string | null): string {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function NativeCompanyFeedCreatorAccess() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const creatorsQuery = useCompanyPostCreators();
  const searchQuery = useEmployeeSearchOptions(search);
  const grantMutation = useGrantCompanyPostCreator();
  const revokeMutation = useRevokeCompanyPostCreator();

  const activeCreatorIds = useMemo(
    () => new Set((creatorsQuery.data ?? []).map((row) => row.employee_id)),
    [creatorsQuery.data],
  );

  async function handleGrant(employeeId: string) {
    try {
      await grantMutation.mutateAsync({ employeeId });
      toast({ title: "Creator access granted", description: "The employee can now submit company feed posts." });
      setSearch("");
    } catch (error) {
      toast({
        title: "Grant failed",
        description: error instanceof Error ? error.message : "Unable to grant creator access.",
        variant: "destructive",
      });
    }
  }

  async function handleRevoke(employeeId: string) {
    try {
      await revokeMutation.mutateAsync({ employeeId });
      toast({ title: "Creator access revoked", description: "The employee can no longer submit company feed posts." });
    } catch (error) {
      toast({
        title: "Revoke failed",
        description: error instanceof Error ? error.message : "Unable to revoke creator access.",
        variant: "destructive",
      });
    }
  }

  return (
    <DashboardLayout>
      <main className="space-y-8 p-4 sm:p-6 lg:p-8">
        <section
          className="relative overflow-hidden rounded-[2rem] border border-white/30 px-5 py-6 text-white shadow-[var(--shadow-brand-lg)] sm:px-7 sm:py-8 lg:px-9"
          style={{
            background:
              "linear-gradient(135deg, var(--sidebar-canvas) 0%, var(--brand-700) 35%, var(--brand-500) 74%, rgba(232,35,26,0.84) 115%)",
          }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.18)_0%,_rgba(255,255,255,0)_34%),radial-gradient(circle_at_bottom_right,_rgba(255,255,255,0.14)_0%,_rgba(255,255,255,0)_30%)]" />
          <div className="relative max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/90 backdrop-blur">
              <ShieldCheck className="h-3.5 w-3.5" />
              Super Admin Creator Rights
            </div>
            <div className="space-y-3">
              <h1 className="font-['Fira_Sans'] text-3xl font-bold leading-tight tracking-[-0.04em] sm:text-4xl lg:text-[3.2rem]">
                Decide exactly who can publish into the company feed workflow.
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-blue-50/92 sm:text-[15px]">
                Creator rights stay tightly controlled here. Grant access only to trusted employees, and revoke it instantly when responsibility changes.
              </p>
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
          <Card className="rounded-[1.8rem] border-slate-200 bg-white shadow-[var(--shadow-sm)]">
            <CardContent className="space-y-4 p-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--brand-700)]">
                  Search employees
                </p>
                <h2 className="mt-2 font-['Fira_Sans'] text-xl font-semibold tracking-[-0.03em] text-slate-950">
                  Grant creator access
                </h2>
              </div>

              <div className="relative">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by employee name or code"
                  className="rounded-2xl pl-11"
                />
              </div>

              {searchQuery.isLoading ? (
                <div className="space-y-3">
                  <div className="h-20 rounded-[1.2rem] skeleton" />
                  <div className="h-20 rounded-[1.2rem] skeleton" />
                </div>
              ) : null}

              {search.trim().length > 0 && !searchQuery.isLoading ? (
                <div className="space-y-3">
                  {(searchQuery.data ?? []).length === 0 ? (
                    <div className="rounded-[1.2rem] border border-dashed border-slate-300 bg-slate-50/80 p-5 text-sm text-slate-500">
                      No matching employees found in your current scope.
                    </div>
                  ) : (
                    (searchQuery.data ?? []).map((employee) => (
                      <div key={employee.id} className="rounded-[1.2rem] border border-slate-200 bg-slate-50/90 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-slate-900">{employee.name}</p>
                            <p className="mt-1 text-sm text-slate-500">{employee.employee_code}</p>
                          </div>
                          <Button
                            type="button"
                            disabled={grantMutation.isPending || activeCreatorIds.has(employee.id)}
                            className="rounded-xl"
                            onClick={() => void handleGrant(employee.id)}
                          >
                            <UserPlus className="h-4 w-4" />
                            {activeCreatorIds.has(employee.id) ? "Granted" : "Grant"}
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="rounded-[1.2rem] border border-dashed border-slate-300 bg-slate-50/80 p-5 text-sm text-slate-500">
                  Start typing to find an employee and assign posting rights.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-[1.8rem] border-slate-200 bg-white shadow-[var(--shadow-sm)]">
            <CardContent className="space-y-4 p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--brand-700)]">
                    Active creators
                  </p>
                  <h2 className="mt-2 font-['Fira_Sans'] text-2xl font-semibold tracking-[-0.03em] text-slate-950">
                    Current publishing roster
                  </h2>
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {(creatorsQuery.data ?? []).length} active
                </span>
              </div>

              {creatorsQuery.isLoading ? (
                <div className="space-y-3">
                  <div className="h-24 rounded-[1.2rem] skeleton" />
                  <div className="h-24 rounded-[1.2rem] skeleton" />
                </div>
              ) : null}

              {creatorsQuery.isError ? (
                <div className="rounded-[1.2rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  {creatorsQuery.error?.message ?? "Unable to load creator assignments."}
                </div>
              ) : null}

              {!creatorsQuery.isLoading && !creatorsQuery.isError && (creatorsQuery.data ?? []).length === 0 ? (
                <div className="rounded-[1.4rem] border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center">
                  <Sparkles className="mx-auto h-6 w-6 text-[color:var(--brand-600)]" />
                  <h3 className="mt-4 font-['Fira_Sans'] text-2xl font-semibold text-slate-950">
                    No creators assigned yet
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Once access is granted, those employees appear here with their audit timestamps.
                  </p>
                </div>
              ) : null}

              {!creatorsQuery.isLoading && !creatorsQuery.isError ? (
                <div className="space-y-4">
                  {(creatorsQuery.data ?? []).map((row) => (
                    <div key={row.id} className="rounded-[1.3rem] border border-slate-200 bg-slate-50/90 p-4">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <p className="font-semibold text-slate-900">Employee ID: {row.employee_id}</p>
                          <p className="text-sm text-slate-500">Mapped user ID: {row.user_id}</p>
                          <div className="grid gap-1 text-sm text-slate-500">
                            <p>Granted at: <span className="font-semibold text-slate-700">{formatDateTime(row.granted_at)}</span></p>
                            {row.revoked_at ? <p>Last revoked at: <span className="font-semibold text-slate-700">{formatDateTime(row.revoked_at)}</span></p> : null}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={revokeMutation.isPending}
                          className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                          onClick={() => void handleRevoke(row.employee_id)}
                        >
                          <UserX className="h-4 w-4" />
                          Revoke
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </main>
    </DashboardLayout>
  );
}
