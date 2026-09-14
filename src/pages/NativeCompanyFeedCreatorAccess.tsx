import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Search, Sparkles, UserPlus, UserX } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  type CompanyPostCreatorAccessRow,
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

const DEBOUNCE_MS = 300;
const ROSTER_PAGE_SIZE = 20;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function NativeCompanyFeedCreatorAccess() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, DEBOUNCE_MS);

  const creatorsQuery = useCompanyPostCreators();
  const searchQuery = useEmployeeSearchOptions(debouncedSearch);
  const grantMutation = useGrantCompanyPostCreator();
  const revokeMutation = useRevokeCompanyPostCreator();

  const [pendingGrantId, setPendingGrantId] = useState<string | null>(null);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<CompanyPostCreatorAccessRow | null>(null);

  // Multi-select state for bulk grant
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkPending, setIsBulkPending] = useState(false);

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleBulkGrant = async () => {
    const ids = Array.from(selectedIds);
    setIsBulkPending(true);
    try {
      const results = await Promise.allSettled(
        ids.map(id => grantMutation.mutateAsync({ employeeId: id }))
      );
      const succeeded = ids.filter((_, i) => results[i].status === "fulfilled");
      setSelectedIds(prev => {
        const next = new Set(prev);
        succeeded.forEach(id => next.delete(id));
        return next;
      });
    } finally {
      setIsBulkPending(false);
    }
  };

  // Clear selection when a new search fires
  useEffect(() => {
    setSelectedIds(new Set());
  }, [debouncedSearch]);

  // Roster pagination
  const [rosterPage, setRosterPage] = useState(1);

  const activeCreatorIds = useMemo(
    () => new Set((creatorsQuery.data ?? []).map((row) => row.employee_id)),
    [creatorsQuery.data],
  );

  const paginatedRoster = (creatorsQuery.data ?? []).slice(0, rosterPage * ROSTER_PAGE_SIZE);
  const hasMoreRoster = (creatorsQuery.data ?? []).length > rosterPage * ROSTER_PAGE_SIZE;

  async function handleGrant(employeeId: string) {
    setPendingGrantId(employeeId);
    try {
      await grantMutation.mutateAsync({ employeeId });
      toast({
        title: "Creator access granted",
        description: "The employee can now submit company feed posts.",
      });
      setSearch("");
    } catch (error) {
      toast({
        title: "Grant failed",
        description: error instanceof Error ? error.message : "Unable to grant creator access.",
        variant: "destructive",
      });
    } finally {
      setPendingGrantId(null);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setPendingRevokeId(revokeTarget.employee_id);
    try {
      await revokeMutation.mutateAsync({ employeeId: revokeTarget.employee_id });
      toast({
        title: "Creator access revoked",
        description: "The employee can no longer submit company feed posts.",
      });
    } catch (error) {
      toast({
        title: "Revoke failed",
        description: error instanceof Error ? error.message : "Unable to revoke creator access.",
        variant: "destructive",
      });
    } finally {
      setPendingRevokeId(null);
      setRevokeTarget(null);
    }
  }

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
          <h1 className="text-sm font-semibold">Feed Creators</h1>
        </div>
        <main className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
          {/* Grant panel */}
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

              {searchQuery.isError ? (
                <div className="flex items-start gap-2 rounded-[1.2rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  Employee search failed. Please try again.
                </div>
              ) : null}

              {searchQuery.isLoading ? (
                <div className="space-y-3">
                  <div className="h-20 rounded-[1.2rem] skeleton" />
                  <div className="h-20 rounded-[1.2rem] skeleton" />
                </div>
              ) : null}

              {debouncedSearch.trim().length > 0 && !searchQuery.isLoading && !searchQuery.isError ? (
                <div className="space-y-3">
                  {(searchQuery.data ?? []).length === 0 ? (
                    <div className="rounded-[1.2rem] border border-dashed border-slate-300 bg-slate-50/80 p-5 text-sm text-slate-500">
                      No matching employees found in your current scope.
                    </div>
                  ) : (
                    <>
                      {(searchQuery.data ?? []).map((employee) => {
                        const isGranted = activeCreatorIds.has(employee.id);
                        const isThisPending = pendingGrantId === employee.id;
                        return (
                          <div
                            key={employee.id}
                            className="flex items-center gap-2 rounded-[1.2rem] border border-slate-200 bg-slate-50/90 px-4 py-1.5"
                          >
                            <input
                              type="checkbox"
                              checked={selectedIds.has(employee.id)}
                              onChange={() => toggleSelect(employee.id)}
                              disabled={isGranted}
                              className="h-3.5 w-3.5 cursor-pointer"
                            />
                            <div className="flex flex-1 items-start justify-between gap-3 py-2">
                              <div>
                                <p className="font-semibold text-slate-900">{employee.name}</p>
                                <p className="mt-1 text-sm text-slate-500">{employee.employee_code}</p>
                              </div>
                              <Button
                                type="button"
                                disabled={isGranted || isThisPending}
                                className="rounded-xl"
                                onClick={() => void handleGrant(employee.id)}
                              >
                                {isThisPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <UserPlus className="h-4 w-4" />
                                )}
                                {isGranted ? "Granted" : "Grant"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}

                      {selectedIds.size > 0 && (
                        <div className="mt-2 flex justify-end border-t pt-2">
                          <Button
                            size="sm"
                            onClick={() => void handleBulkGrant()}
                            disabled={isBulkPending}
                          >
                            {isBulkPending ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Grant {selectedIds.size} selected
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : !searchQuery.isLoading ? (
                <div className="rounded-[1.2rem] border border-dashed border-slate-300 bg-slate-50/80 p-5 text-sm text-slate-500">
                  Start typing to find an employee and assign posting rights.
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Roster panel */}
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

              {!creatorsQuery.isLoading &&
              !creatorsQuery.isError &&
              (creatorsQuery.data ?? []).length === 0 ? (
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
                  {paginatedRoster.map((row) => {
                    const isThisPending = pendingRevokeId === row.employee_id;
                    const displayName = row.employee_name ?? row.employee_code ?? row.employee_id;
                    return (
                      <div
                        key={row.id}
                        className="rounded-[1.3rem] border border-slate-200 bg-slate-50/90 p-4"
                      >
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-1">
                            <p className="font-semibold text-slate-900">{displayName}</p>
                            {row.employee_code && row.employee_name && (
                              <p className="text-sm text-slate-500">@{row.employee_code}</p>
                            )}
                            {row.department && (
                              <p className="text-xs text-slate-400">{row.department}</p>
                            )}
                            <p className="text-sm text-slate-500">
                              Granted:{" "}
                              <span className="font-semibold text-slate-700">
                                {formatDateTime(row.granted_at)}
                              </span>
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={isThisPending}
                            className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                            onClick={() => setRevokeTarget(row)}
                          >
                            {isThisPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <UserX className="h-4 w-4" />
                            )}
                            Revoke
                          </Button>
                        </div>
                      </div>
                    );
                  })}

                  {hasMoreRoster && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs mt-2"
                      onClick={() => setRosterPage(p => p + 1)}
                    >
                      Show more ({(creatorsQuery.data ?? []).length - paginatedRoster.length} remaining)
                    </Button>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* Revoke confirmation */}
        <AlertDialog
          open={!!revokeTarget}
          onOpenChange={(open) => !open && setRevokeTarget(null)}
        >
          <AlertDialogContent className="rounded-[1.6rem]">
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke creator access?</AlertDialogTitle>
              <AlertDialogDescription>
                {revokeTarget
                  ? `${revokeTarget.employee_name ?? revokeTarget.employee_code ?? "This employee"} will no longer be able to submit company feed posts.`
                  : "This employee will no longer be able to submit company feed posts."}
                {" "}Access can be re-granted from this page at any time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-rose-600 hover:bg-rose-700"
                onClick={() => void handleRevoke()}
              >
                Confirm revoke
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        </main>
      </div>
    </DashboardLayout>
  );
}
