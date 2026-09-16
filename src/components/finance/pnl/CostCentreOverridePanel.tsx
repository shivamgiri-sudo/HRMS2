import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Loader2, Power } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { costCentreText } from "@/components/finance/pnl/costCentreLabel";
import { useCostCentreList } from "@/hooks/useCostCentreManagement";
import { useHasRole } from "@/hooks/useUserRole";
import { useCostCentreOverrideMutations, useCostCentreOverrides } from "@/hooks/useCostCentreOverride";

const WRITE_ROLES = ["super_admin", "admin", "finance", "finance_head", "accounts_head", "payroll_head"] as const;

function parseCodes(text: string): string[] {
  return Array.from(new Set(
    text.split(/[\s,]+/).map((code) => code.trim()).filter(Boolean),
  ));
}

/**
 * Cost centre mapping — redirect a batch of employees' pay to a different cost centre for P&L
 * attribution only. See backend/src/modules/process-pnl/pnl-cost-centre-override.service.ts.
 *
 * Built for the exact case that surfaced it: BSS/BO/NOIDA-2/577 is a back-office pool whose staff
 * work entirely on BSS/BO/NOIDA-2/576 (Onfido), so 576's margin read low and 577's read as pure
 * unattributed cost. Paste the codes, pick where their cost should count, save — no code change,
 * no touching anyone's actual HR cost centre.
 */
export function CostCentreOverridePanel() {
  const canWrite = useHasRole(...WRITE_ROLES);
  const overridesQuery = useCostCentreOverrides();
  const costCentreList = useCostCentreList({ status: "active" });
  const { bulkSet, deactivate } = useCostCentreOverrideMutations();

  const [codesText, setCodesText] = useState("");
  const [targetCostCentreId, setTargetCostCentreId] = useState("");
  const [reason, setReason] = useState("");
  const [confirmingDeactivate, setConfirmingDeactivate] = useState<string | null>(null);

  const costCentres = costCentreList.data?.data ?? [];
  const costCentreName = useMemo(
    () => new Map(costCentres.map((cc: any) => [
      cc.id,
      costCentreText(String(cc.cost_centre_code || cc.cost_centre_name || cc.id), cc.process_name || cc.process_name_bill || cc.billing_client_name || null),
    ])),
    [costCentres],
  );

  const codes = parseCodes(codesText);
  const rows = overridesQuery.data ?? [];
  const active = rows.filter((r) => r.activeStatus);

  async function save() {
    if (!codes.length || !targetCostCentreId) return;
    try {
      const result = await bulkSet.mutateAsync({ employeeCodes: codes, targetCostCentreId, reason: reason.trim() || null });
      if (result.applied.length > 0) {
        toast.success(`Mapped ${result.applied.length} employee(s) to ${costCentreName.get(targetCostCentreId) ?? "the target cost centre"}`);
      }
      if (result.notFound.length > 0) {
        toast.error(`${result.notFound.length} code(s) not found: ${result.notFound.join(", ")}`);
      }
      if (result.applied.length > 0) {
        setCodesText("");
        setReason("");
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message ?? "Could not save the mapping");
    }
  }

  async function confirmDeactivate(employeeId: string) {
    try {
      await deactivate.mutateAsync(employeeId);
      toast.success("Reverted to the employee's real cost centre");
    } catch (error: any) {
      toast.error(error?.response?.data?.message ?? "Could not deactivate the mapping");
    } finally {
      setConfirmingDeactivate(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Map employees to a cost centre</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Paste employee codes (space, comma, or newline separated) and pick the cost centre their pay should count
          toward in the P&L. This changes reporting only — nobody's actual HR cost centre, roster, attendance or
          leave is touched.
        </p>
        {!canWrite && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" /> You have read-only access to this screen.
          </p>
        )}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs">Employee codes</Label>
            <Textarea
              className="mt-1 h-28 font-mono text-xs"
              placeholder={"MAS12345\nMAS12346\nMAS12347"}
              value={codesText}
              disabled={!canWrite}
              onChange={(event) => setCodesText(event.target.value)}
            />
            {codes.length > 0 && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{codes.length} code(s) detected</p>
            )}
          </div>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Counts toward this cost centre</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-900"
                value={targetCostCentreId}
                disabled={!canWrite}
                onChange={(event) => setTargetCostCentreId(event.target.value)}
              >
                <option value="">Select cost centre…</option>
                {costCentres.map((cc: any) => (
                  <option key={cc.id} value={cc.id}>{costCentreName.get(cc.id) ?? cc.cost_centre_name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Reason (optional)</Label>
              <Textarea
                className="mt-1 h-16 text-xs"
                placeholder="e.g. Back office pool works entirely on this account"
                value={reason}
                disabled={!canWrite}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={!canWrite || !codes.length || !targetCostCentreId || bulkSet.isPending}
              onClick={save}
            >
              {bulkSet.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Map {codes.length > 0 ? `${codes.length} employee(s)` : "employees"}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Active mappings</h3>
        {overridesQuery.isLoading ? (
          <Skeleton className="mt-3 h-24 w-full" />
        ) : active.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">None</p>
        ) : (
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Real cost centre</TableHead>
                <TableHead></TableHead>
                <TableHead>Counts toward</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Set by</TableHead>
                {canWrite && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs font-medium">{row.employeeCode} {row.employeeName ? `— ${row.employeeName}` : ""}</TableCell>
                  <TableCell className="text-xs text-slate-500">{row.actualCostCentreCode ?? "—"}</TableCell>
                  <TableCell><ArrowRight className="h-3.5 w-3.5 text-slate-400" /></TableCell>
                  <TableCell className="text-xs">
                    <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-800">{row.targetCostCentreCode ?? row.targetCostCentreId}</Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-slate-500" title={row.reason ?? ""}>{row.reason ?? "—"}</TableCell>
                  <TableCell className="text-xs text-slate-500">{row.createdByName ?? "—"}</TableCell>
                  {canWrite && (
                    <TableCell className="text-right">
                      {confirmingDeactivate === row.employeeId ? (
                        <span className="inline-flex items-center gap-1">
                          <Button size="sm" variant="destructive" onClick={() => confirmDeactivate(row.employeeId)} disabled={deactivate.isPending}>Confirm</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmingDeactivate(null)}>Cancel</Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setConfirmingDeactivate(row.employeeId)}>
                          <Power className="mr-1 h-3.5 w-3.5" /> Revert
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
