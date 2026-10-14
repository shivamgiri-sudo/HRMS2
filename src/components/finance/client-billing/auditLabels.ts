// src/components/finance/client-billing/auditLabels.ts
/**
 * Human labels for client_invoice_audit_log.action codes and the actor display rule shared by
 * every audit list (detail drawer, audit dialog, change-request drawer). Unknown codes fall back
 * to the code itself with underscores turned into spaces, so a new backend action never renders
 * blank.
 */
import type { AuditAction, AuditLogEntry } from "@/lib/clientBillingApi";

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  created: "Proforma created",
  edited: "Edited",
  approved: "Invoice approved (bill no. generated)",
  rejected: "Rejected",
  void_requested: "Void requested",
  void_approved: "Void approved",
  void_declined: "Void declined",
  status_change_requested: "Type change requested",
  status_change_approved: "Type change approved",
  status_change_declined: "Type change declined",
  submitted_to_client: "Sent to client",
  proforma_approved: "Proforma approved",
  po_approved: "PO approved",
  grn_added: "GRN added",
};

export function auditActionLabel(action: string): string {
  return (AUDIT_ACTION_LABEL as Record<string, string>)[action] ?? action.replace(/_/g, " ");
}

/** `actor_name ?? actor_email ?? actor_id` — names appear once the API joins them. */
export function auditActor(entry: Pick<AuditLogEntry, "actor_id" | "actor_name" | "actor_email">): string {
  return entry.actor_name || entry.actor_email || entry.actor_id || "—";
}
