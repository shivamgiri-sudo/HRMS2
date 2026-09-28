import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Loader2, Power, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBranches } from "@/hooks/useOrgMasters";
import { useHasRole } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  useCostCentreOverrideMutations,
  useCostCentreOverrides,
  useOverrideCostCentreOptions,
  useOverrideEmployeeSearch,
  type OverrideEmployeeOption,
} from "@/hooks/useCostCentreOverride";

const WRITE_ROLES = ["super_admin", "admin", "finance", "finance_head", "accounts_head", "payroll_head"] as const;
const SEARCH_DEBOUNCE_MS = 300;

type PickState = "verified" | "checking" | "notfound" | "unverified";

interface PickedEmployee {
  code: string;
  name: string | null;
  branchName: string | null;
  costCentreCode: string | null;
  /** verified = found in the employee table; checking = lookup in flight; notfound = no ACTIVE employee has this code; unverified = lookup itself failed. */
  state: PickState;
}

function parseCodes(text: string): string[] {
  return Array.from(new Set(text.split(/[\s,]+/).map((code) => code.trim()).filter(Boolean)));
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Cost centre mapping — redirect employees' pay to a different cost centre for P&L attribution only.
 * See backend/src/modules/process-pnl/pnl-cost-centre-override.service.ts.
 *
 * The branch filter narrows the target cost-centre list to that branch's open cost centres and the
 * active-mappings table to mappings that land in it. Employees are picked by searching the employee
 * table by code or name, so the person's name is visible before anyone is mapped.
 */
export function CostCentreOverridePanel() {
  const canWrite = useHasRole(...WRITE_ROLES);
  const overridesQuery = useCostCentreOverrides();
  const branchesQuery = useBranches();
  const { bulkSet, deactivate } = useCostCentreOverrideMutations();

  const [branchId, setBranchId] = useState("");
  const [targetCostCentreId, setTargetCostCentreId] = useState("");
  const [picked, setPicked] = useState<PickedEmployee[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [reason, setReason] = useState("");
  const [confirmingDeactivate, setConfirmingDeactivate] = useState<string | null>(null);

  const debouncedSearch = useDebounced(employeeSearch, SEARCH_DEBOUNCE_MS);
  const costCentreQuery = useOverrideCostCentreOptions(branchId);
  const employeeQuery = useOverrideEmployeeSearch(debouncedSearch, "");

  const branches = branchesQuery.data ?? [];
  const costCentres = costCentreQuery.data ?? [];
  const targetCostCentre = costCentres.find((cc) => cc.id === targetCostCentreId) ?? null;

  const costCentreOptions: SearchableOption[] = useMemo(
    () => costCentres.map((cc) => ({
      value: cc.id,
      label: cc.code,
      hint: [cc.name && cc.name !== cc.code ? cc.name : null, cc.processName, branchId ? null : cc.branchName]
        .filter(Boolean).join(" · "),
      keywords: [cc.name, cc.processName, cc.branchName].filter(Boolean).join(" "),
    })),
    [costCentres, branchId],
  );

  const pickedCodes = useMemo(() => new Set(picked.map((p) => p.code)), [picked]);
  const employeeOptions: SearchableOption[] = useMemo(
    () => (employeeQuery.data ?? [])
      .filter((emp) => !pickedCodes.has(emp.employeeCode))
      .map((emp) => ({
        value: emp.employeeCode,
        label: `${emp.employeeCode} — ${emp.name ?? "Unnamed"}`,
        hint: [emp.branchName, emp.costCentreCode, emp.alreadyMappedTo ? `already mapped to ${emp.alreadyMappedTo}` : null]
          .filter(Boolean).join(" · "),
      })),
    [employeeQuery.data, pickedCodes],
  );

  const rows = overridesQuery.data ?? [];
  const active = rows.filter((r) => r.activeStatus && (!branchId || r.targetBranchId === branchId));

  function changeBranch(next: string) {
    setBranchId(next);
    setTargetCostCentreId("");
  }

  function pickEmployee(code: string) {
    const found = (employeeQuery.data ?? []).find((emp) => emp.employeeCode === code);
    if (!found) return;
    setPicked((current) => current.some((p) => p.code === code) ? current : [
      ...current,
      { code, name: found.name, branchName: found.branchName, costCentreCode: found.costCentreCode, state: "verified" },
    ]);
    setEmployeeSearch("");
  }

  function addPastedCodes() {
    const codes = parseCodes(pasteText).filter((code) => !pickedCodes.has(code));
    if (!codes.length) return;
    setPicked((current) => [...current, ...codes.map((code): PickedEmployee => ({ code, name: null, branchName: null, costCentreCode: null, state: "checking" }))]);
    setPasteText("");
    codes.forEach((code) => { void resolvePastedCode(code); });
  }

  /** Look a pasted code up in the employee table so its name shows, or it is flagged not found, before anyone can save. */
  async function resolvePastedCode(code: string) {
    let next: Partial<PickedEmployee> = { state: "unverified" };
    try {
      const response = await hrmsApi.get<{ success: boolean; data: OverrideEmployeeOption[] }>(
        `/api/finance/pnl/cost-centre-overrides/employees?q=${encodeURIComponent(code)}&limit=5`,
      );
      const hit = (response.data ?? []).find((emp) => emp.employeeCode.toLowerCase() === code.toLowerCase());
      next = hit
        ? { name: hit.name, branchName: hit.branchName, costCentreCode: hit.costCentreCode, state: "verified" }
        : { state: "notfound" };
    } catch {
      next = { state: "unverified" };
    }
    setPicked((current) => current.map((p) => (p.code === code ? { ...p, ...next } : p)));
  }

  async function save() {
    if (!picked.length || !targetCostCentreId) return;
    try {
      const result = await bulkSet.mutateAsync({
        employeeCodes: picked.map((p) => p.code),
        targetCostCentreId,
        reason: reason.trim() || null,
      });
      if (result.applied.length > 0) {
        toast.success(`Mapped ${result.applied.length} employee(s) to ${targetCostCentre?.code ?? "the target cost centre"}`);
      }
      if (result.notFound.length > 0) {
        toast.error(`${result.notFound.length} code(s) not found: ${result.notFound.join(", ")}`);
      }
      if (result.applied.length > 0) {
        setPicked(picked.filter((p) => result.notFound.includes(p.code)));
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
          Search employees by code or name and pick the cost centre their pay should count toward in the P&L. This
          changes reporting only — nobody's actual HR cost centre, roster, attendance or leave is touched.
        </p>
        {!canWrite && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" /> You have read-only access to this screen.
          </p>
        )}

        <div className="mt-3 max-w-xs">
          <Label className="text-xs">Branch</Label>
          <select
            className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-900"
            value={branchId}
            onChange={(event) => changeBranch(event.target.value)}
          >
            <option value="">All branches</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.branch_name ?? branch.name ?? branch.id}</option>
            ))}
          </select>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs">Employees (search by code or name)</Label>
            <SearchableSelect
              options={employeeOptions}
              value=""
              onChange={pickEmployee}
              placeholder="Search employee code or name…"
              searchPlaceholder="Type at least 2 letters of a name or code…"
              emptyText={debouncedSearch.trim().length < 2 ? "Type at least 2 characters." : "No active employee matches."}
              disabled={!canWrite}
              loading={employeeQuery.isFetching}
              search={employeeSearch}
              onSearchChange={setEmployeeSearch}
              aria-label="Search employees"
            />
            {picked.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {picked.map((emp) => (
                  <Badge key={emp.code} variant="outline" className="gap-1 border-slate-300 py-1 text-xs">
                    <span className="font-mono">{emp.code}</span>
                    {emp.state === "verified" && emp.name ? <span>{emp.name}</span> : null}
                    {emp.state === "checking" ? <span className="text-slate-400">checking…</span> : null}
                    {emp.state === "notfound" ? <span className="text-red-700" title="No active employee has this code">not found</span> : null}
                    {emp.state === "unverified" ? <span className="text-amber-700" title="Could not check this code">unverified</span> : null}
                    {emp.costCentreCode ? <span className="text-slate-400">({emp.costCentreCode})</span> : null}
                    {canWrite && (
                      <button
                        type="button"
                        aria-label={`Remove ${emp.code}`}
                        onClick={() => setPicked((current) => current.filter((p) => p.code !== emp.code))}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
            )}
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer">Paste a list of codes instead</summary>
              <Textarea
                className="mt-1 h-20 font-mono text-xs"
                placeholder={"MAS12345\nMAS12346"}
                value={pasteText}
                disabled={!canWrite}
                onChange={(event) => setPasteText(event.target.value)}
              />
              <Button type="button" size="sm" variant="outline" className="mt-1" disabled={!canWrite || !pasteText.trim()} onClick={addPastedCodes}>
                Add codes
              </Button>
            </details>
          </div>

          <div className="space-y-3">
            <div>
              <Label className="text-xs">
                Counts toward this cost centre{branchId ? " (this branch's open cost centres)" : " (all open cost centres)"}
              </Label>
              <SearchableSelect
                options={costCentreOptions}
                value={targetCostCentreId}
                onChange={setTargetCostCentreId}
                placeholder={costCentreQuery.isLoading ? "Loading cost centres…" : `Select cost centre (${costCentres.length})…`}
                searchPlaceholder="Search by cost centre code, name, process or branch…"
                emptyText="No open cost centre matches."
                disabled={!canWrite}
                loading={costCentreQuery.isLoading}
                aria-label="Target cost centre"
                className="mt-1"
              />
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
              disabled={!canWrite || !picked.length || !targetCostCentreId || bulkSet.isPending || picked.some((p) => p.state === "notfound" || p.state === "checking")}
              onClick={save}
            >
              {bulkSet.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Map {picked.length > 0 ? `${picked.length} employee(s)` : "employees"}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
          Active mappings{branchId ? " counting toward the selected branch" : ""}
        </h3>
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
                <TableHead>Branch</TableHead>
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
                  <TableCell className="text-xs text-slate-500">{row.targetBranchName ?? "—"}</TableCell>
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
