import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

// Every existing HR role. Kept in step with HR_TEAM_ROLES in job-requisition-deadline.service.ts.
const HR_TEAM_ROLES = [
  "hr",
  "hr_admin",
  "hr_head",
  "ho_hr",
  "hr_manager",
  "recruitment_hr",
];
const MAX_EXTENSION_DAYS = 90;
const REFRESH_MS = 5 * 60 * 1000;
const SEEN_KEY = "requisition-expiry-dialog-seen";

interface PendingDecision {
  id: string;
  requisition_id: string;
  requisition_code: string;
  designation_name: string | null;
  branch_name: string | null;
  process_name: string | null;
  validity: string;
  requested_headcount: number;
  fulfilled_headcount: number;
}

type Action = "close" | "extend" | "keep_open";

const ACTION_LABEL: Record<Action, string> = {
  close: "Close requisition",
  extend: "Extend validity",
  keep_open: "Keep open",
};

const toDisplayDate = (iso: string) => iso.split("-").reverse().join("/");
const daysOverdue = (iso: string) =>
  Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(`${iso}T00:00:00`).getTime()) / 86_400_000,
    ),
  );
const isoInDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function readSeen(): string {
  try {
    return sessionStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeSeen(value: string) {
  try {
    sessionStorage.setItem(SEEN_KEY, value);
  } catch {
    /* storage can be blocked; the dialog then simply reopens on next load */
  }
}

function DecisionCard({
  item,
  onDone,
}: {
  item: PendingDecision;
  onDone: () => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [newValidity, setNewValidity] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filledPct =
    item.requested_headcount > 0
      ? Math.round((item.fulfilled_headcount / item.requested_headcount) * 100)
      : 0;
  const short = item.requested_headcount - item.fulfilled_headcount;
  const late = daysOverdue(item.validity);
  const canSubmit =
    action !== null &&
    reason.trim().length >= 3 &&
    (action !== "extend" || newValidity !== "") &&
    !saving;

  const submit = async () => {
    if (!action) return;
    setSaving(true);
    setError(null);
    try {
      const body =
        action === "extend"
          ? { action, reason: reason.trim(), newValidity }
          : { action, reason: reason.trim() };
      await hrmsApi.post(`/api/job-requisition-expiry/${item.id}/decide`, body);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the decision");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-slate-900">
            {item.requisition_code}
          </p>
          <p className="text-xs text-slate-600">
            {[item.designation_name, item.branch_name, item.process_name]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
          {late} day{late === 1 ? "" : "s"} past deadline
        </span>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
          <span>
            {item.fulfilled_headcount} of {item.requested_headcount} filled (
            {filledPct}%)
          </span>
          <span>{short} short</span>
        </div>
        <div
          className="mt-1 h-2 overflow-hidden rounded-full bg-white/80"
          role="progressbar"
          aria-valuenow={filledPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Positions filled"
        >
          <div
            className="h-full rounded-full bg-amber-500"
            style={{ width: `${Math.min(100, filledPct)}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Validity was {toDisplayDate(item.validity)}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {(Object.keys(ACTION_LABEL) as Action[]).map((a) => (
          <Button
            key={a}
            type="button"
            size="sm"
            variant={action === a ? "default" : "outline"}
            className="min-h-[44px] flex-1 sm:flex-none"
            onClick={() => {
              setAction(a);
              setError(null);
            }}
          >
            {a === "close" ? (
              <XCircle className="mr-1.5 h-4 w-4" />
            ) : a === "extend" ? (
              <CalendarClock className="mr-1.5 h-4 w-4" />
            ) : (
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
            )}
            {ACTION_LABEL[a]}
          </Button>
        ))}
      </div>

      {action && (
        <div className="mt-3 space-y-2 rounded-xl bg-white/80 p-3">
          {action === "extend" && (
            <div>
              <label
                htmlFor={`nv-${item.id}`}
                className="text-[11px] font-bold uppercase tracking-wide text-slate-500"
              >
                New validity date
              </label>
              <input
                id={`nv-${item.id}`}
                type="date"
                min={isoInDays(1)}
                max={isoInDays(MAX_EXTENSION_DAYS)}
                value={newValidity}
                onChange={(e) => setNewValidity(e.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Up to {MAX_EXTENSION_DAYS} days from today.
              </p>
            </div>
          )}
          <div>
            <label
              htmlFor={`rs-${item.id}`}
              className="text-[11px] font-bold uppercase tracking-wide text-slate-500"
            >
              Reason (required)
            </label>
            <textarea
              id={`rs-${item.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder={
                action === "keep_open"
                  ? "Why should this stay open? You will be asked again in 7 days."
                  : "Why?"
              }
            />
          </div>
          {error && (
            <p role="alert" className="text-xs font-semibold text-red-600">
              {error}
            </p>
          )}
          <Button
            type="button"
            className="min-h-[44px] w-full"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Confirm: {ACTION_LABEL[action]}
          </Button>
        </div>
      )}
    </div>
  );
}

export function RequisitionExpiryDecisionDialog() {
  const { roleKeys, isLoading } = useWorkforceAccess();
  const isHrTeam =
    !isLoading && roleKeys.some((k) => HR_TEAM_ROLES.includes(k));
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["requisition-expiry-pending"],
    enabled: isHrTeam,
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const r = await hrmsApi.get<{ data?: PendingDecision[] }>(
        "/api/job-requisition-expiry/pending",
      );
      return Array.isArray(r?.data) ? r.data : [];
    },
  });

  const pending = useMemo(() => data ?? [], [data]);
  const signature = useMemo(
    () =>
      pending
        .map((p) => p.id)
        .sort()
        .join(","),
    [pending],
  );

  useEffect(() => {
    if (pending.length > 0 && readSeen() !== signature) setOpen(true);
    if (pending.length === 0) setOpen(false);
  }, [pending.length, signature]);

  if (!isHrTeam || pending.length === 0) return null;

  const close = () => {
    writeSeen(signature);
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <DialogContent className="flex h-full max-h-[100dvh] w-full max-w-2xl flex-col gap-3 overflow-y-auto sm:h-auto sm:max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            {pending.length} job requisition{pending.length === 1 ? "" : "s"}{" "}
            need an HR decision
          </DialogTitle>
          <DialogDescription>
            These passed their validity date with positions still unfilled, so
            the system did not close them. Any HR team member can decide. Once
            one person decides, it clears for everyone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {pending.map((item) => (
            <DecisionCard
              key={item.id}
              item={item}
              onDone={() =>
                void queryClient.invalidateQueries({
                  queryKey: ["requisition-expiry-pending"],
                })
              }
            />
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          className="min-h-[44px]"
          onClick={close}
        >
          Decide later
        </Button>
      </DialogContent>
    </Dialog>
  );
}
