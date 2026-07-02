import { useState } from "react";
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

interface BranchCCRow {
  id: string;
  branch_name: string;
  branch_code: string;
  call_centre_code: string | null;
  process_count: number;
  employee_count: number;
}

export default function NativeCallCentreConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Map of branchId → editing state
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [editOpen, setEditOpen] = useState<Record<string, boolean>>({});

  const { data, isLoading, isError } = useQuery<{ data: BranchCCRow[] }>({
    queryKey: ["branches-cc-code-map"],
    queryFn: () => hrmsApi.get("/api/org/branches/cc-code-map"),
  });

  const mutation = useMutation({
    mutationFn: ({ id, ccCode }: { id: string; ccCode: string }) =>
      hrmsApi.patch(`/api/org/branches/${id}/call-centre-code`, { ccCode }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["branches-cc-code-map"] });
      setEditOpen((prev) => ({ ...prev, [variables.id]: false }));
      toast({ title: "CC Code updated", description: "Call centre code saved successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const startEdit = (row: BranchCCRow) => {
    setEditing((prev) => ({ ...prev, [row.id]: row.call_centre_code ?? "" }));
    setEditOpen((prev) => ({ ...prev, [row.id]: true }));
  };

  const cancelEdit = (id: string) => {
    setEditOpen((prev) => ({ ...prev, [id]: false }));
  };

  const saveEdit = (id: string) => {
    const ccCode = (editing[id] ?? "").trim();
    if (!ccCode) {
      toast({ title: "Validation", description: "CC Code cannot be empty.", variant: "destructive" });
      return;
    }
    mutation.mutate({ id, ccCode });
  };

  const rows: BranchCCRow[] = data?.data ?? [];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Call Centre Code Configuration</h1>
          <p className="text-slate-500 mt-1">
            Manage unique CC master keys used across reports and integrations
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-800">
              Branch CC Code Map
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
            {!isLoading && !isError && rows.length === 0 && (
              <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
                No active branches found.
              </div>
            )}
            {!isLoading && !isError && rows.length > 0 && (
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
                  {rows.map((row) => {
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
                                  if (e.key === "Enter") saveEdit(row.id);
                                  if (e.key === "Escape") cancelEdit(row.id);
                                }}
                              />
                              <Button
                                size="sm"
                                className="h-8 px-3 text-xs"
                                disabled={isSaving}
                                onClick={() => saveEdit(row.id)}
                              >
                                {isSaving ? "Saving…" : "Save"}
                              </Button>
                              <Button
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
    </DashboardLayout>
  );
}
