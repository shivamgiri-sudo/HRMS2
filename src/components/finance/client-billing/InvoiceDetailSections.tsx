// src/components/finance/client-billing/InvoiceDetailSections.tsx
/**
 * Lower sections of the invoice drill-down drawer: approval timeline (who / when per step),
 * client e-mail log, change requests and the audit trail. Split out of InvoiceDetailDialog.tsx
 * to keep both files small; every value is read from the API rows, nothing is computed.
 */
import { CheckCircle2, Circle, XCircle } from "lucide-react";
import type { AuditLogEntry, ChangeRequestRow, InvoiceRow, SubmissionRow } from "@/lib/clientBillingApi";
import { auditActionLabel, auditActor } from "./auditLabels";
import { SECTION_LABEL_CLASS, formatDateTime } from "./shared";

const None = () => <p className="mt-1 text-xs text-muted-foreground">None</p>;

function SectionError({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  return (
    <p role="alert" className="mt-1 text-xs text-rose-700">
      Could not load {what}: {error instanceof Error ? error.message : "unknown error"}{" "}
      <button type="button" className="cursor-pointer underline" onClick={onRetry}>Retry</button>
    </p>
  );
}

/** Latest audit entry of one action (the API order is not relied on). */
function latest(audit: AuditLogEntry[], action: string): AuditLogEntry | undefined {
  return audit
    .filter((a) => a.action === action)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
}

interface Step { key: string; title: string; at: string | null | undefined; by: string | null | undefined; state: "done" | "pending" | "failed"; note?: string | null }

/** Approval steps for one client_invoice row, newest facts from the row, actor names from the audit log. */
export function buildApprovalSteps(inv: InvoiceRow, audit: AuditLogEntry[]): Step[] {
  const actor = (action: string, name?: string | null, id?: string | null) => {
    const entry = latest(audit, action);
    return name || (entry ? auditActor(entry) : null) || id || null;
  };
  const approved = latest(audit, "approved");
  const steps: Step[] = [
    { key: "created", title: "Proforma created", at: inv.created_at, by: actor("created", null, inv.created_by), state: "done" },
    {
      key: "proforma", title: "Proforma approved", at: inv.proforma_approved_at,
      by: inv.proforma_approved_at ? actor("proforma_approved", inv.proforma_approved_by_name, inv.proforma_approved_by) : null,
      state: inv.proforma_approved_at || inv.bill_no ? "done" : "pending",
    },
    {
      key: "invoice", title: "Invoice approved (bill no. generated)", at: inv.approved_at ?? approved?.created_at,
      by: inv.bill_no ? actor("approved", inv.approved_by_name, inv.approved_by) : null,
      state: inv.bill_no ? "done" : "pending",
    },
  ];
  if (inv.po_numbers) {
    steps.push({
      key: "po", title: "PO approved", at: inv.po_approved_at ?? latest(audit, "po_approved")?.created_at,
      by: inv.po_approved ? actor("po_approved") : null, state: inv.po_approved ? "done" : "pending",
    });
  }
  steps.push({
    key: "sent", title: "Sent to client", at: inv.last_sent_at,
    by: inv.last_sent_at ? actor("submitted_to_client", inv.last_sent_by_name, inv.last_sent_by) : null,
    state: inv.last_sent_at ? "done" : "pending",
  });
  if (inv.invoice_status === "rejected") {
    const action = latest(audit, "void_approved") && inv.bill_no ? "void_approved" : "rejected";
    steps.push({
      key: "rejected", title: inv.bill_no ? "Voided" : "Rejected", at: inv.rejected_at,
      by: actor(action, inv.rejected_by_name, inv.rejected_by), state: "failed", note: inv.rejected_reason,
    });
  }
  return steps;
}

export function ApprovalTimeline({ invoice, audit }: { invoice: InvoiceRow; audit: AuditLogEntry[] }) {
  const steps = buildApprovalSteps(invoice, audit);
  return (
    <section aria-label="Approval history">
      <p className={SECTION_LABEL_CLASS}>Approval history</p>
      <ol className="mt-2 space-y-2 border-l border-slate-200 pl-4">
        {steps.map((s) => {
          const Icon = s.state === "done" ? CheckCircle2 : s.state === "failed" ? XCircle : Circle;
          const tone = s.state === "done" ? "text-emerald-600" : s.state === "failed" ? "text-rose-600" : "text-slate-300";
          return (
            <li key={s.key} className="relative text-sm">
              <Icon className={`absolute -left-[1.4rem] top-0.5 h-4 w-4 bg-white ${tone}`} aria-hidden="true" />
              <span className={s.state === "pending" ? "text-slate-500" : "font-medium text-slate-900"}>{s.title}</span>
              {s.state === "pending" ? (
                <span className="ml-2 text-xs text-slate-400">not yet</span>
              ) : (
                <span className="ml-2 text-xs text-slate-600">{formatDateTime(s.at)}{s.by ? ` · ${s.by}` : ""}</span>
              )}
              {s.note && <p className="text-xs text-rose-700">{s.note}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function SubmissionsSection({ rows, error, onRetry }: { rows: SubmissionRow[]; error: unknown; onRetry: () => void }) {
  return (
    <section>
      <p className={SECTION_LABEL_CLASS}>Submitted to client</p>
      {error ? <SectionError what="the e-mail log" error={error} onRetry={onRetry} /> : rows.length === 0 ? <None /> : (
        <ul className="mt-1 space-y-1">
          {rows.map((s) => (
            <li key={s.id} className="rounded border px-2 py-1 text-xs">
              <span className={s.send_status === "sent" ? "font-medium text-emerald-700" : "font-medium text-rose-700"}>
                {s.send_status === "sent" ? "Sent" : "Failed"}
              </span>{" "}
              {formatDateTime(s.sent_at)} by {s.sent_by} to {s.to_emails}
              {s.error_message && <span className="text-rose-700"> — {s.error_message}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ChangeRequestsSection({ rows, error, onRetry }: { rows: ChangeRequestRow[]; error: unknown; onRetry: () => void }) {
  return (
    <section>
      <p className={SECTION_LABEL_CLASS}>Change requests</p>
      {error ? <SectionError what="change requests" error={error} onRetry={onRetry} /> : rows.length === 0 ? <None /> : (
        <ul className="mt-1 space-y-1">
          {rows.map((r) => (
            <li key={r.id} className="rounded border px-2 py-1 text-xs">
              <span className="font-medium">{r.request_type === "void" ? "Void" : `Type → ${r.requested_value}`}</span>{" "}
              ({r.request_status}) · {formatDateTime(r.requested_at)} · {r.requested_by_name || r.requested_by} · {r.reason}
              {r.decision_note && <span className="text-muted-foreground"> · decision: {r.decision_note}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AuditSection({ rows, error, onRetry }: { rows: AuditLogEntry[]; error: unknown; onRetry: () => void }) {
  return (
    <section>
      <p className={SECTION_LABEL_CLASS}>Audit trail</p>
      {error ? <SectionError what="the audit trail" error={error} onRetry={onRetry} /> : rows.length === 0 ? <None /> : (
        <ul className="mt-1 space-y-1">
          {rows.map((a) => (
            <li key={a.id} className="rounded border px-2 py-1 text-xs">
              <span className="font-medium">{auditActionLabel(a.action)}</span> · {formatDateTime(a.created_at)} · {auditActor(a)}
              {a.reason && <p className="mt-0.5 text-muted-foreground">{a.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
