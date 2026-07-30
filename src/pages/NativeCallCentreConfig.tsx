import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Download, Search, X } from "lucide-react";

interface BranchCCRow {
  id: string;
  branch_name: string;
  branch_code: string;
  call_centre_code: string | null;
  process_count: number;
  employee_count: number;
}

interface ConfirmPayload {
  id: string;
  branchName: string;
  oldCode: string | null;
  newCode: string;
}

export default function NativeCallCentreConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editing, setEditing] = useState<Record<string, string>>({});
  const [editOpen, setEditOpen] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [showUnconfigured, setShowUnconfigured] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState<ConfirmPayload | null>(null);

  const { data, isLoading, isError } = useQuery<{ data: BranchCCRow[] }>({
    queryKey: ["branches-cc-code-map"],
    queryFn: () => hrmsApi.get("/api/org/branches/cc-code-map"),
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: ({ id, ccCode }: { id: string; ccCode: string }) =>
      hrmsApi.patch(`/api/org/branches/${id}/call-centre-code`, { ccCode }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["branches-cc-code-map"] });
      setEditOpen((prev) => {
        const next = { ...prev };
        delete next[variables.id];
        return next;
      });
      setEditing((prev) => {
        const next = { ...prev };
        delete next[variables.id];
        return next;
      });
      setConfirmPayload(null);
      toast({ title: "CC Code updated", description: "Call centre code saved successfully." });
    },
    onError: (err: Error) => {
      setConfirmPayload(null);
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const startEdit = (row: BranchCCRow) => {
    setEditing((prev) => ({ ...prev, [row.id]: row.call_centre_code ?? "" }));
    setEditOpen((prev) => ({ ...prev, [row.id]: true }));
  };

  const cancelEdit = (id: string) => {
    setEditOpen((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setEditing((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const requestSave = (row: BranchCCRow) => {
    const newCode = (editing[row.id] ?? "").trim().toUpperCase();
    if (!newCode) {
      toast({ title: "Validation", description: "CC Code cannot be empty.", variant: "destructive" });
      return;
    }
    const ccPattern = /^[A-Z0-9][A-Z0-9\-]{1,28}[A-Z0-9]$/;
    if (!ccPattern.test(newCode)) {
      toast({
        title: "Invalid format",
        description: "CC Code must be 3–30 uppercase alphanumeric characters (hyphens allowed internally).",
        variant: "destructive",
      });
      return;
    }
    setConfirmPayload({ id: row.id, branchName: row.branch_name, oldCode: row.call_centre_code, newCode });
  };

  const confirmSave = () => {
    if (!confirmPayload) return;
    mutation.mutate({ id: confirmPayload.id, ccCode: confirmPayload.newCode });
  };

  const rows: BranchCCRow[] = data?.data ?? [];
  const unconfiguredCount = rows.filter((r) => !r.call_centre_code).length;

  const filteredRows = useMemo(() => {
    let result = rows;
    if (showUnconfigured) result = result.filter((r) => !r.call_centre_code);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.branch_name.toLowerCase().includes(q) ||
          r.branch_code.toLowerCase().includes(q) ||
          (r.call_centre_code ?? "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [rows, search, showUnconfigured]);

  const exportCsv = () => {
    const header = ["Branch Name", "Branch Code", "CC Code", "Processes", "Employees", "Status"];
    const lines = [
      header,
      ...rows.map((r) => [
        r.branch_name,
        r.branch_code,
        r.call_centre_code ?? "",
        String(r.process_count),
        String(r.employee_count),
        r.call_centre_code ? "Configured" : "Pending",
      ]),
    ]
      .map((row) => row.map((v) => `"${v.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([lines], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `cc-code-map-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Call Centre Code Configuration</h1>
            <p className="text-slate-500 mt-1">
              Manage unique CC master keys used across reports and integrations
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}
            className="inline-flex items-center gap-2">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search branch name, code or CC code…"
              className="h-10 w-full rounded-2xl border bg-white pl-9 pr-4 text-sm text-slate-900 outline-none focus:border-blue-400"
            />
            {search && (
              <button onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowUnconfigured((v) => !v)}
            className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold transition-colors ${
              showUnconfigured
                ? "border-amber-400 bg-amber-50 text-amber-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            Unconfigured only
            {unconfiguredCount > 0 && (
              <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold text-amber-800">
                {unconfiguredCount}
              </span>
            )}
          </button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-800">
              Branch CC Code Map
              <span className="ml-2 text-sm font-normal text-slate-400">
                {filteredRows.length} of {rows.length} branches
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
                Loading branches…
              </div>
            )}
            {isError && (
              <div className="flex items-center justify-center py-16 text-red-500 text-sm">
                Failed to load data. Please try again.
              </div>
            )}
            {!isLoading && !isError && filteredRows.length === 0 && (
              <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
                {rows.length === 0 ? "No active branches found." : "No branches match your filters."}
              </div>
            )}
            {!isLoading && !isError && filteredRows.length > 0 && (
              <Table className="smarthr-table">
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="pl-6">Branch Name</TableHead>
                    <TableHead>Branch Code</TableHead>
                    <TableHead>CC Code</TableHead>
                    <TableHead className="text-center">Processes</TableHead>
                    <TableHead className="text-center">Employees</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="pr-6 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row) => {
                    const isEditingRow = !!editOpen[row.id];
                    const isSaving = mutation.isPending && mutation.variables?.id === row.id;
                    return (
                      <TableRow key={row.id} className="hover:bg-slate-50/60">
                        <TableCell className="pl-6 font-medium text-slate-800">
                          {row.branch_name}
                        </TableCell>
                        <TableCell>
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-600">
                            {row.branch_code}
                          </code>
                        </TableCell>
                        <TableCell>
                          {isEditingRow ? (
                            <div className="flex items-center gap-2">
                              <Input
                                aria-label={`Edit CC code for ${row.branch_name}`}
                                className="h-8 w-36 font-mono text-xs uppercase"
                                value={editing[row.id] ?? ""}
                                onChange={(e) =>
                                  setEditing((prev) => ({
                                    ...prev,
                                    [row.id]: e.target.value.toUpperCase(),
                                  }))
                                }
                                placeholder="e.g. MAS-BLR-01"
                                maxLength={30}
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") requestSave(row);
                                  if (e.key === "Escape") cancelEdit(row.id);
                                }}
                              />
                              <Button
                                aria-label={`Save CC code for ${row.branch_name}`}
                                size="sm"
                                className="h-8 px-3 text-xs"
                                disabled={isSaving}
                                onClick={() => requestSave(row)}
                              >
                                {isSaving ? "Saving…" : "Save"}
                              </Button>
                              <Button
                                aria-label={`Cancel editing CC code for ${row.branch_name}`}
                                size="sm"
                                variant="ghost"
                                className="h-8 px-3 text-xs"
                                disabled={isSaving}
                                onClick={() => cancelEdit(row.id)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <span className="font-mono text-sm text-slate-700">
                              {row.call_centre_code ?? (
                                <span className="text-slate-400 italic">Not set</span>
                              )}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-slate-600">
                          {row.process_count}
                        </TableCell>
                        <TableCell className="text-center text-slate-600">
                          {row.employee_count}
                        </TableCell>
                        <TableCell className="text-center">
                          {row.call_centre_code ? (
                            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs">
                              Configured
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                              Pending
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          {!isEditingRow && (
                            <Button
                              aria-label={`Edit CC code for ${row.branch_name}`}
                              size="sm"
                              variant="outline"
                              className="h-7 px-3 text-xs"
                              onClick={() => startEdit(row)}
                            >
                              Edit
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Confirmation dialog */}
      {confirmPayload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Confirm CC Code Change</h2>
              <button onClick={() => setConfirmPayload(null)}
                className="cursor-pointer text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <p className="text-sm text-slate-600">
                Update CC code for <strong>{confirmPayload.branchName}</strong>?
              </p>
              <div className="rounded-2xl bg-slate-50 p-4 text-sm space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 w-16">Before:</span>
                  <code className="font-mono text-slate-700">
                    {confirmPayload.oldCode ?? <em className="not-italic text-slate-400">Not set</em>}
                  </code>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 w-16">After:</span>
                  <code className="font-mono font-bold text-emerald-700">{confirmPayload.newCode}</code>
                </div>
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                This affects all dialer integrations and reports that use this branch's CC code.
              </p>
            </div>
            <div className="flex justify-end gap-3 border-t p-6">
              <Button variant="outline" onClick={() => setConfirmPayload(null)}>Cancel</Button>
              <Button onClick={confirmSave} disabled={mutation.isPending}>
                {mutation.isPending ? "Saving…" : "Confirm Change"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
