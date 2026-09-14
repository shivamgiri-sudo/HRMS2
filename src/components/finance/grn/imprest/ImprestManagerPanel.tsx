import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, UserCheck } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { StatusStamp } from "@/components/finance/grn/StatusStamp";
import { dateLabel } from "@/components/finance/grn/grn-format";
import {
  GRN_TR, GrnAlert, GrnButton, GrnCard, GrnCardHeader, GrnCellSub, GrnChip, GrnEmptyState,
  GrnFieldRow, GrnIconButton, GrnInput, GrnSelect, GrnTable, GrnTd, GrnTh,
} from "@/components/finance/grn/grn-ui";

/**
 * Imprest Manager master (Requirement 8) — who holds a branch's cash float.
 *
 * WITHOUT THIS SCREEN THE WHOLE IMPREST CHAIN IS INERT. An allocation needs a manager to credit,
 * so no float is ever funded; and an approved voucher with no manager to debit skips its ledger
 * posting. The API existed and was tested; there was simply nowhere to appoint anybody.
 *
 * AN APPOINTMENT IS A PERIOD, NOT A FLAG. The float belongs to a person for a stretch of time,
 * which is why the master is effective-dated and why the server's "who holds this today" query
 * checks the dates rather than just active_status. Ending an appointment sets its end date; it
 * does not delete the row, because the ledger entries posted under it must stay explainable.
 *
 * The holder cannot be edited after appointment — only the Tally name, the end date and the
 * active flag, which is exactly what the service permits. Handing a float to a different person
 * is a new appointment, so the ledger can always say who was accountable on any given day.
 */

type Manager = {
  id: string;
  branch_id: string;
  branch_name?: string | null;
  employee_name?: string | null;
  employee_code?: string | null;
  tally_name?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  active_status: number;
};

type Branch = { id: string; branch_name: string };
type Candidate = { employee_id: string; user_id: string; employee_code: string; full_name: string };

function unwrap<T>(response: unknown): T[] {
  const body = (response as any)?.data ?? response;
  const rows = body?.data ?? body?.rows ?? body;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY = { branchId: "", employeeId: "", tallyName: "", effectiveFrom: today(), effectiveTo: "" };

export function ImprestManagerPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [filterBranch, setFilterBranch] = useState("");

  const branchesQuery = useQuery({
    queryKey: ["imprest-manager-branches"],
    queryFn: async () => unwrap<Branch>(await hrmsApi.get<any>("/api/org/branches?limit=200")),
  });
  const allBranches = branchesQuery.data ?? [];

  const managersQuery = useQuery({
    queryKey: ["imprest-managers-master", includeInactive, filterBranch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (includeInactive) params.set("includeInactive", "1");
      if (filterBranch) params.set("branchId", filterBranch);
      const queryString = params.toString();
      return unwrap<Manager>(
        await hrmsApi.get<any>(`/api/finance/imprest/managers${queryString ? `?${queryString}` : ""}`),
      );
    },
  });

  // Only employees who can actually operate a float: active, at this branch, with a login.
  const candidatesQuery = useQuery({
    queryKey: ["imprest-manager-candidates", draft.branchId],
    enabled: Boolean(draft.branchId),
    queryFn: async () =>
      unwrap<Candidate>(
        await hrmsApi.get<any>(
          `/api/finance/imprest/manager-candidates?branchId=${encodeURIComponent(draft.branchId)}`,
        ),
      ),
  });

  const managers = managersQuery.data ?? [];
  const branches = branchesQuery.data ?? [];
  const candidates = candidatesQuery.data ?? [];
  const chosen = candidates.find((c) => c.employee_id === draft.employeeId) ?? null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["imprest-managers-master"] });

  const appoint = useMutation({
    mutationFn: async () => {
      if (!chosen) throw new Error("Choose who will hold the float");
      return hrmsApi.post<any>("/api/finance/imprest/managers", {
        branchId: draft.branchId,
        // Both are sent: user_id is who acts, employee_id is who they are. The service stores
        // each separately, and the ledger records the user.
        userId: chosen.user_id,
        employeeId: chosen.employee_id,
        tallyName: draft.tallyName.trim() || null,
        effectiveFrom: draft.effectiveFrom,
        effectiveTo: draft.effectiveTo || null,
      });
    },
    onSuccess: () => {
      toast({ title: "Imprest manager appointed" });
      setDraft(EMPTY);
      setShowForm(false);
      refresh();
    },
    onError: (e: Error) =>
      toast({ title: "Could not appoint", description: e.message, variant: "destructive" }),
  });

  const endAppointment = useMutation({
    mutationFn: async (manager: Manager) =>
      hrmsApi.put<any>(`/api/finance/imprest/managers/${manager.id}`, {
        tallyName: manager.tally_name,
        // Ended, not deleted: the ledger entries posted under this appointment have to stay
        // explainable, and a deleted holder makes past postings anonymous.
        effectiveTo: today(),
        activeStatus: 0,
      }),
    onSuccess: () => {
      toast({ title: "Appointment ended", description: "Past ledger entries are unaffected." });
      refresh();
    },
    onError: (e: Error) =>
      toast({ title: "Could not end the appointment", description: e.message, variant: "destructive" }),
  });

  const isLive = (m: Manager) => {
    if (!m.active_status) return false;
    const from = m.effective_from?.slice(0, 10);
    const to = m.effective_to?.slice(0, 10);
    const now = today();
    return (!from || from <= now) && (!to || to >= now);
  };

  return (
    <div className="space-y-4">
      <GrnCard>
        <GrnCardHeader
          title="Imprest managers"
          description="Who holds each branch's cash float, and for what period."
          action={
            <div className="flex items-center gap-1">
              <GrnSelect
                small
                value={filterBranch}
                onChange={(e) => setFilterBranch(e.target.value)}
                aria-label="Filter by branch"
                className="w-[180px]"
              >
                <option value="">All branches</option>
                {allBranches.map((b) => (
                  <option key={b.id} value={b.id}>{b.branch_name}</option>
                ))}
              </GrnSelect>
              <GrnChip active={includeInactive} onClick={() => setIncludeInactive((v) => !v)}>
                {includeInactive ? "Showing past" : "Live only"}
              </GrnChip>
              <GrnChip active={showForm} onClick={() => setShowForm((open) => !open)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {showForm ? "Close" : "Appoint"}
              </GrnChip>
              <GrnIconButton aria-label="Refresh" onClick={() => managersQuery.refetch()}>
                <RefreshCw className={`h-3.5 w-3.5 ${managersQuery.isFetching ? "animate-spin" : ""}`} />
              </GrnIconButton>
            </div>
          }
        />

        {showForm && (
          <div>
            <GrnFieldRow label="Branch" required>
              <GrnSelect
                value={draft.branchId}
                onChange={(e) => setDraft((d) => ({ ...d, branchId: e.target.value, employeeId: "" }))}
              >
                <option value="">— choose —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.branch_name}</option>
                ))}
              </GrnSelect>
            </GrnFieldRow>

            <GrnFieldRow
              label="Holder"
              required
              hint={
                !draft.branchId
                  ? "Choose a branch first."
                  : candidatesQuery.isLoading
                    ? "Loading…"
                    : candidates.length
                      ? "Active employees at this branch who have a login. A float holder has to be able to sign in and be recorded on each posting."
                      : "Nobody at this branch has both an active record and a login."
              }
            >
              <GrnSelect
                disabled={!draft.branchId || !candidates.length}
                value={draft.employeeId}
                onChange={(e) => setDraft((d) => ({ ...d, employeeId: e.target.value }))}
              >
                <option value="">— choose —</option>
                {candidates.map((c) => (
                  <option key={c.employee_id} value={c.employee_id}>
                    {c.full_name} · {c.employee_code}
                  </option>
                ))}
              </GrnSelect>
            </GrnFieldRow>

            <GrnFieldRow
              label="Tally name"
              hint="The ledger name this float posts to in Tally. Leave blank to use the branch default."
            >
              <GrnInput
                className="w-[280px]"
                value={draft.tallyName}
                onChange={(e) => setDraft((d) => ({ ...d, tallyName: e.target.value }))}
              />
            </GrnFieldRow>

            <GrnFieldRow
              label="Effective"
              required
              error={
                draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom
                  ? "The end date falls before the start date."
                  : undefined
              }
              hint="Leave the end date blank for an open-ended appointment."
            >
              <div className="flex flex-wrap items-center gap-2">
                <GrnInput
                  type="date"
                  className="w-[165px]"
                  aria-label="Effective from"
                  value={draft.effectiveFrom}
                  onChange={(e) => setDraft((d) => ({ ...d, effectiveFrom: e.target.value }))}
                />
                <span className="text-[11px] text-grn-ink-soft">to</span>
                <GrnInput
                  type="date"
                  className="w-[165px]"
                  aria-label="Effective to"
                  value={draft.effectiveTo}
                  onChange={(e) => setDraft((d) => ({ ...d, effectiveTo: e.target.value }))}
                />
              </div>
            </GrnFieldRow>

            <div className="flex items-center justify-end gap-2 border-t border-grn-line px-4 py-3">
              <GrnChip active={false} onClick={() => { setDraft(EMPTY); setShowForm(false); }}>
                Cancel
              </GrnChip>
              <GrnButton
                disabled={
                  appoint.isPending
                  || !draft.branchId
                  || !draft.employeeId
                  || !draft.effectiveFrom
                  || Boolean(draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom)
                }
                onClick={() => appoint.mutate()}
              >
                Appoint
              </GrnButton>
            </div>
          </div>
        )}
      </GrnCard>

      <GrnCard>
        {managers.length === 0 ? (
          <GrnEmptyState
            title={managersQuery.isLoading ? "Loading…" : "No imprest manager is appointed"}
            description={
              managersQuery.isLoading
                ? undefined
                : "Until somebody holds a branch's float, no allocation can be raised against it and an approved voucher has nothing to debit."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <GrnTable>
              <thead>
                <tr>
                  <GrnTh>Branch</GrnTh>
                  <GrnTh>Holder</GrnTh>
                  <GrnTh>Tally name</GrnTh>
                  <GrnTh>Effective</GrnTh>
                  <GrnTh>Status</GrnTh>
                  <GrnTh>Action</GrnTh>
                </tr>
              </thead>
              <tbody>
                {managers.map((m) => (
                  <tr key={m.id} className={GRN_TR}>
                    <GrnTd>{m.branch_name ?? "—"}</GrnTd>
                    <GrnTd>
                      {m.employee_name ?? "—"}
                      <GrnCellSub>{m.employee_code ?? ""}</GrnCellSub>
                    </GrnTd>
                    <GrnTd>{m.tally_name ?? ""}</GrnTd>
                    <GrnTd>
                      {dateLabel(m.effective_from)}
                      <GrnCellSub>{m.effective_to ? `until ${dateLabel(m.effective_to)}` : "open-ended"}</GrnCellSub>
                    </GrnTd>
                    <GrnTd>
                      <StatusStamp tone={isLive(m) ? "ok" : "neutral"}>
                        {isLive(m) ? "Holding" : "Ended"}
                      </StatusStamp>
                    </GrnTd>
                    <GrnTd>
                      {isLive(m) ? (
                        <GrnIconButton
                          aria-label={`End ${m.employee_name ?? "this"} appointment`}
                          disabled={endAppointment.isPending}
                          onClick={() => endAppointment.mutate(m)}
                        >
                          <UserCheck className="h-3.5 w-3.5" />
                        </GrnIconButton>
                      ) : (
                        <span className="text-[11px] text-grn-ink-soft">—</span>
                      )}
                    </GrnTd>
                  </tr>
                ))}
              </tbody>
            </GrnTable>
          </div>
        )}

        {managers.length > 0 && (
          <div className="border-t border-grn-line p-3">
            <GrnAlert tone="info">
              Ending an appointment closes it as of today and leaves every ledger entry posted
              under it intact — a float's history has to stay explainable. To hand a float to
              somebody else, end the current appointment and appoint the new holder.
            </GrnAlert>
          </div>
        )}
      </GrnCard>
    </div>
  );
}
