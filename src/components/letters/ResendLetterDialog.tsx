/**
 * "Resend appointment letter" dialog.
 *
 * Two ways to resend the Review & Accept link:
 *   - the addresses already on the employee record (one click, as before);
 *   - a different address HR types in (the employee lost their inbox, or gave a
 *     new one). That path needs a reason, is audited, and tells the registered
 *     address that a new link went elsewhere. The employee master is not edited.
 *
 * The form is split from the dialog shell so its states can be rendered and
 * tested without a browser: ResendLetterForm is a pure function of its props.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, Plus, Trash2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  MAX_CUSTOM_RECIPIENTS, MIN_REASON_LENGTH, validateResendForm,
  type ResendFormState, type ResendMode,
} from "@/lib/appointmentLetterResend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export type OnFileAddress = { kind: "personal" | "official"; masked: string };
export type ResendHistoryEntry = {
  id: string; actedAt: string | null; actor: string | null;
  outcome: "sent" | "failed"; custom: boolean; recipients: string[]; reason: string | null;
};
export type ResendOptions = { letterNumber: string; onFile: OnFileAddress[]; history: ResendHistoryEntry[] };

export const CONFIRMATION_LINE =
  "The previous link will stop working. The employee's registered address will be told a new link was sent.";
const KIND_LABEL: Record<OnFileAddress["kind"], string> = { personal: "personal", official: "official" };

export const emptyResendForm = (hasOnFile: boolean): ResendFormState => ({
  mode: hasOnFile ? "onfile" : "custom", addresses: [""], reason: "",
});

type FormProps = {
  /** null while the on-file addresses are still loading or could not be loaded. */
  onFile: OnFileAddress[] | null;
  loading?: boolean;
  state: ResendFormState;
  /** Fields the user has already left, so "required" is not shouted at a fresh form. */
  touched: { addresses: boolean[]; reason: boolean };
  sending?: boolean;
  apiError?: string | null;
  onChange: (next: ResendFormState) => void;
  onTouch: (field: { address?: number; reason?: boolean }) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

export function ResendLetterForm(p: FormProps) {
  const v = useMemo(() => validateResendForm(p.state), [p.state]);
  const custom = p.state.mode === "custom";
  const canSend = v.valid && !p.sending && !p.loading;
  const hasOnFile = (p.onFile?.length ?? 0) > 0;

  const setAddress = (i: number, value: string) =>
    p.onChange({ ...p.state, addresses: p.state.addresses.map((a, idx) => (idx === i ? value : a)) });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (canSend) p.onSubmit(); }}
      className="space-y-4"
      noValidate
    >
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-slate-700">Send to</legend>
        <RadioGroup
          value={p.state.mode}
          onValueChange={(m) => p.onChange({ ...p.state, mode: m as ResendMode })}
          aria-label="Send to"
        >
          <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 p-3">
            <RadioGroupItem value="onfile" id="resend-onfile" className="mt-0.5" disabled={p.onFile !== null && !hasOnFile} />
            <Label htmlFor="resend-onfile" className="cursor-pointer text-sm font-normal text-slate-700">
              <span className="font-semibold">Email address on record</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                {p.loading ? "Loading…"
                  : p.onFile === null ? "The address(es) saved on the employee record"
                  : hasOnFile ? p.onFile.map((a) => `${a.masked} (${KIND_LABEL[a.kind]})`).join(", ")
                  : "No email address is saved for this employee"}
              </span>
            </Label>
          </div>
          <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 p-3">
            <RadioGroupItem value="custom" id="resend-custom" className="mt-0.5" />
            <Label htmlFor="resend-custom" className="cursor-pointer text-sm font-semibold text-slate-700">
              Another email address…
            </Label>
          </div>
        </RadioGroup>
      </fieldset>

      {custom && (
        <div className="space-y-3">
          <div className="space-y-2">
            {p.state.addresses.map((address, i) => {
              const showError = v.addressErrors[i] && (address.trim() !== "" || p.touched.addresses[i]);
              return (
                <div key={i}>
                  <div className="flex items-center gap-2">
                    <Input
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      value={address}
                      maxLength={254}
                      placeholder="name@example.com"
                      aria-label={`Email address ${i + 1}`}
                      aria-invalid={showError ? true : undefined}
                      onChange={(e) => setAddress(i, e.target.value)}
                      onBlur={() => p.onTouch({ address: i })}
                    />
                    {i > 0 && (
                      <Button
                        type="button" variant="ghost" size="icon" aria-label={`Remove email address ${i + 1}`}
                        onClick={() => p.onChange({ ...p.state, addresses: p.state.addresses.filter((_, idx) => idx !== i) })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {showError && <p role="alert" className="mt-1 text-xs text-red-600">{v.addressErrors[i]}</p>}
                </div>
              );
            })}
            {p.state.addresses.length < MAX_CUSTOM_RECIPIENTS && (
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => p.onChange({ ...p.state, addresses: [...p.state.addresses, ""] })}
              >
                <Plus className="mr-1 h-4 w-4" /> Add another address
              </Button>
            )}
          </div>

          <div>
            <Label htmlFor="resend-reason" className="text-sm font-semibold text-slate-700">
              Reason <span className="text-red-600">*</span>
            </Label>
            <Textarea
              id="resend-reason"
              rows={3}
              maxLength={500}
              value={p.state.reason}
              placeholder="e.g. Employee no longer has access to the old mailbox"
              aria-invalid={v.reasonError && (p.state.reason.trim() !== "" || p.touched.reason) ? true : undefined}
              onChange={(e) => p.onChange({ ...p.state, reason: e.target.value })}
              onBlur={() => p.onTouch({ reason: true })}
              className="mt-1"
            />
            {v.reasonError && (p.state.reason.trim() !== "" || p.touched.reason) ? (
              <p role="alert" className="mt-1 text-xs text-red-600">{v.reasonError}</p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">Required (at least {MIN_REASON_LENGTH} characters). Recorded against the letter.</p>
            )}
          </div>
        </div>
      )}

      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{CONFIRMATION_LINE}</p>

      {p.apiError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{p.apiError}</p>
      )}

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={p.onCancel} disabled={p.sending}>Cancel</Button>
        <Button type="submit" disabled={!canSend}>
          {p.sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
          Send
        </Button>
      </DialogFooter>
    </form>
  );
}

type DialogProps = {
  issueId: string | null;
  letterNumber: string;
  employeeName: string | null;
  onClose: () => void;
  /** Called after a successful send, with the message to show; the caller refreshes its list. */
  onSent: (message: string) => void;
};

export function ResendLetterDialog({ issueId, letterNumber, employeeName, onClose, onSent }: DialogProps) {
  const [options, setOptions] = useState<ResendOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<ResendFormState>(emptyResendForm(true));
  const [touched, setTouched] = useState<{ addresses: boolean[]; reason: boolean }>({ addresses: [], reason: false });
  const [sending, setSending] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    if (!issueId) return;
    let cancelled = false;
    setOptions(null); setApiError(null); setSending(false);
    setTouched({ addresses: [], reason: false });
    setState(emptyResendForm(true));
    setLoading(true);
    hrmsApi.get<{ data: ResendOptions }>(`/api/letters/appointment-letters/${issueId}/resend-options`)
      .then((res) => {
        if (cancelled) return;
        setOptions(res.data);
        setState(emptyResendForm(res.data.onFile.length > 0));
      })
      // The one-click option does not depend on this lookup, so a failure here must not block it.
      .catch(() => { /* leave options null: the form falls back to a generic label */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [issueId]);

  const submit = async () => {
    if (!issueId) return;
    const v = validateResendForm(state);
    if (!v.valid) return;
    setSending(true);
    setApiError(null);
    try {
      const body = state.mode === "custom" ? { recipients: v.recipients, reason: state.reason.trim() } : {};
      const res = await hrmsApi.post<{ message?: string; data?: { emailedTo?: string[] } }>(
        `/api/letters/appointment-letters/${issueId}/resend-link`, body,
      );
      const masked = (res.data?.emailedTo ?? []).join(", ");
      const message = masked ? `Accept link sent to ${masked}.` : (res.message ?? `Accept link re-sent for ${letterNumber}.`);
      toast.success(message);
      onSent(message);
    } catch (err) {
      // Shown exactly as the server wrote it (revoked, already accepted, rate limit, ...).
      setApiError(err instanceof Error ? err.message : "Unable to resend the appointment letter.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={issueId !== null} onOpenChange={(open) => { if (!open && !sending) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resend appointment letter</DialogTitle>
          <DialogDescription>
            {letterNumber}{employeeName ? ` · ${employeeName}` : ""}
          </DialogDescription>
        </DialogHeader>
        <ResendLetterForm
          onFile={options?.onFile ?? null}
          loading={loading}
          state={state}
          touched={touched}
          sending={sending}
          apiError={apiError}
          onChange={setState}
          onTouch={(f) => setTouched((t) => ({
            reason: f.reason ? true : t.reason,
            addresses: f.address === undefined ? t.addresses
              : Object.assign([...t.addresses], { [f.address]: true }),
          }))}
          onSubmit={() => void submit()}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
