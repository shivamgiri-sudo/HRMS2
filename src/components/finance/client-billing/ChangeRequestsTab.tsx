// src/components/finance/client-billing/ChangeRequestsTab.tsx
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/useDebounce";
import { auditActionLabel, auditActor } from "./auditLabels";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  decideChangeRequest,
  getChangeRequest,
  listChangeRequests,
  type ChangeRequestRow,
} from "@/lib/clientBillingApi";
import {
  DRAWER_60VW_CLASS,
  SECTION_LABEL_CLASS,
  formatDateOnly,
  formatDateTime,
  InlineError,
  money,
} from "./shared";

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
  { value: "_all", label: "All" },
];

const STATUS_CLASS: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  declined: "border-slate-200 bg-slate-100 text-slate-600",
};

const TYPE_OPTIONS = [
  { value: "_all", label: "All types" },
  { value: "void", label: "Void / delete" },
  { value: "status_change", label: "Type change" },
];
const CR_PAGE = 50;

const TYPE_LABEL: Record<string, string> = {
  void: "Void",
  status_change: "Type change",
};

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/** Row drill-down for a change request: full record, invoice summary, decision form, audit trail. */
function ChangeRequestDrawer({
  requestId,
  onClose,
}: {
  requestId: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [confirmVoid, setConfirmVoid] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["client-billing", "change-request", requestId],
    queryFn: () => getChangeRequest(requestId as string),
    enabled: Boolean(requestId),
  });
  const request = detailQuery.data?.data;

  const decide = useMutation({
    mutationFn: (decision: "approve" | "decline") =>
      decideChangeRequest(
        requestId as string,
        decision,
        note.trim() || undefined,
      ),
    onSuccess: (res) => {
      toast({
        title:
          res.data.requestStatus === "approved"
            ? "Request approved"
            : "Request declined",
      });
      setNote("");
      setConfirmVoid(false);
      void queryClient.invalidateQueries({ queryKey: ["client-billing"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not record the decision",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Sheet
      open={Boolean(requestId)}
      onOpenChange={(open) => !open && onClose()}
    >
      <SheetContent side="right" className={DRAWER_60VW_CLASS}>
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle className="flex items-center gap-2 text-sm">
            {request
              ? `${TYPE_LABEL[request.request_type]} request — ${request.bill_no ?? request.proforma_no ?? ""}`
              : "Change request"}
            {request && (
              <Badge
                variant="outline"
                className={STATUS_CLASS[request.request_status]}
              >
                {request.request_status}
              </Badge>
            )}
          </SheetTitle>
          {request && (
            <p className="text-xs text-muted-foreground">
              Raised {formatDateTime(request.requested_at)}
            </p>
          )}
        </SheetHeader>

        {detailQuery.isLoading || !request ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-5 px-4 py-4">
            <section>
              <p className={SECTION_LABEL_CLASS}>Request</p>
              <dl className="mt-1">
                <DetailRow label="Type">
                  {TYPE_LABEL[request.request_type]}
                </DetailRow>
                <DetailRow label="Current">
                  {request.current_value ?? "—"}
                </DetailRow>
                {request.request_type === "status_change" && (
                  <DetailRow label="Requested">
                    {request.requested_value}
                  </DetailRow>
                )}
                <DetailRow label="Reason">{request.reason}</DetailRow>
                <DetailRow label="Raised by">{request.requested_by_name || request.requested_by}</DetailRow>
                <DetailRow label="Decided by">
                  {request.decided_by_name || request.decided_by || "—"}
                </DetailRow>
                <DetailRow label="Decided at">
                  {formatDateTime(request.decided_at)}
                </DetailRow>
                <DetailRow label="Decision note">
                  {request.decision_note ?? "—"}
                </DetailRow>
              </dl>
            </section>

            <section>
              <p className={SECTION_LABEL_CLASS}>Invoice</p>
              <dl className="mt-1">
                <DetailRow label="Number">
                  {request.bill_no ?? request.proforma_no ?? "—"}
                </DetailRow>
                <DetailRow label="Client">
                  {request.cost_centre_display_name ?? "—"}
                </DetailRow>
                <DetailRow label="Category">
                  {request.category ?? "—"}
                </DetailRow>
                <DetailRow label="Period">
                  {request.month_label} · {request.finance_year}
                </DetailRow>
                <DetailRow label="Invoice date">
                  {formatDateOnly(request.invoice_date)}
                </DetailRow>
                <DetailRow label="Status">{request.invoice_status}</DetailRow>
                <DetailRow label="Grand total">
                  {money(request.grand_total)}
                </DetailRow>
              </dl>
            </section>

            {request.request_status === "pending" && (
              <section>
                <p className={SECTION_LABEL_CLASS}>Decision</p>
                <Label className="mt-1 block text-xs">
                  Note (required to decline)
                </Label>
                <Textarea
                  className="mt-1 min-h-[64px] text-sm"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    disabled={decide.isPending}
                    onClick={() => (request.request_type === "void" ? setConfirmVoid(true) : decide.mutate("approve"))}
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decide.isPending || note.trim().length < 3}
                    onClick={() => decide.mutate("decline")}
                  >
                    <X className="mr-1.5 h-3.5 w-3.5" />
                    Decline
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  The person who raised a request cannot decide it.
                </p>
                {decide.isError && !confirmVoid && (
                  <div className="mt-2"><InlineError title="Could not record the decision" message={decide.error.message} /></div>
                )}
                <ConfirmActionDialog
                  open={confirmVoid}
                  destructive
                  title={`Void ${request.bill_no ?? request.proforma_no ?? "this invoice"}?`}
                  description={<>The invoice is cancelled and any PO / provision balance it used is returned. This cannot be undone; the bill number stays on the voided record.</>}
                  confirmLabel="Approve void"
                  pending={decide.isPending}
                  error={decide.isError ? decide.error.message : null}
                  onConfirm={() => decide.mutate("approve")}
                  onCancel={() => { setConfirmVoid(false); decide.reset(); }}
                />
              </section>
            )}

            <section>
              <p className={SECTION_LABEL_CLASS}>Invoice audit trail</p>
              {request.audit_log.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">None</p>
              ) : (
                <ul className="mt-1 space-y-1.5">
                  {request.audit_log.map((a) => (
                    <li key={a.id} className="rounded border px-2 py-1 text-xs">
                      <span className="font-medium">{auditActionLabel(a.action)}</span> ·{" "}
                      {formatDateTime(a.created_at)} · {auditActor(a)}
                      {a.reason && (
                        <p className="mt-0.5 text-muted-foreground">
                          {a.reason}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function ChangeRequestsTab() {
  const [status, setStatus] = useState("pending");
  const [type, setType] = useState("_all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const term = useDebounce(search.trim(), 300);

  const listQuery = useQuery({
    queryKey: ["client-billing", "change-requests", status, type, term, page],
    queryFn: () =>
      listChangeRequests({
        status: status === "_all" ? undefined : status,
        requestType: type === "_all" ? undefined : type,
        search: term || undefined,
        page,
        limit: CR_PAGE,
      }),
  });
  // The origin/main route filters by status and pages only; type and search are also applied
  // here to the page it returns, so they work today and become server-side once supported.
  const lower = term.toLowerCase();
  const rows: ChangeRequestRow[] = (listQuery.data?.data ?? []).filter((r) =>
    (type === "_all" || r.request_type === type) &&
    (!lower || [r.bill_no, r.proforma_no, r.cost_centre_display_name, r.reason, r.requested_value]
      .some((v) => String(v ?? "").toLowerCase().includes(lower))));
  const total = listQuery.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / CR_PAGE));

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="w-48">
          <SearchableSelect
            options={STATUS_OPTIONS}
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
            aria-label="Request status"
          />
        </div>
        <div className="w-40">
          <SearchableSelect options={TYPE_OPTIONS} value={type} onChange={(v) => { setType(v); setPage(1); }} aria-label="Request type" />
        </div>
        <Input className="h-8 w-56 text-xs" placeholder="Bill no., client, reason…" aria-label="Search requests"
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <span className="text-xs text-muted-foreground">
          Void and invoice-type change requests awaiting a second approver.
        </span>
      </div>

      <div className="flex-1 overflow-y-auto rounded-md border">
        {listQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : listQuery.isError ? (
          <div className="py-8 text-center">
            <p role="alert" className="text-sm text-rose-700">Could not load requests: {(listQuery.error as Error).message}</p>
            <Button size="sm" variant="outline" className="mt-2 cursor-pointer" onClick={() => void listQuery.refetch()}>Retry</Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Request</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Raised</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No requests
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => setOpenId(r.id)}
                  >
                    <TableCell className="font-medium">
                      {r.bill_no ?? r.proforma_no ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.cost_centre_display_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      {TYPE_LABEL[r.request_type]}
                      {r.request_type === "status_change" && (
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          → {r.requested_value}
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className="max-w-[260px] truncate text-xs"
                      title={r.reason}
                    >
                      {r.reason}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(r.grand_total)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDateTime(r.requested_at)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={STATUS_CLASS[r.request_status]}
                      >
                        {r.request_status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex items-center justify-between border-t px-1 py-2 text-xs">
        <span className="text-slate-500">{total} request(s){rows.length !== (listQuery.data?.data.length ?? 0) ? ` · ${rows.length} shown on this page after filters` : ""}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="cursor-pointer" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
          <span className="font-semibold">{page} / {pages}</span>
          <Button variant="outline" size="sm" className="cursor-pointer" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>

      <ChangeRequestDrawer requestId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
