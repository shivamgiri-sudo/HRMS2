// src/components/finance/client-billing/AuditLogDialog.tsx
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { getAuditLog } from "@/lib/clientBillingApi";
import { formatISTDate } from "@/lib/utils";

interface Props {
  invoiceId: string | null;
  label: string;
  onOpenChange: (open: boolean) => void;
}

const ACTION_CLASS: Record<string, string> = {
  created: "border-slate-200 bg-slate-100 text-slate-700",
  edited: "border-blue-200 bg-blue-50 text-blue-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
};

export function AuditLogDialog({ invoiceId, label, onOpenChange }: Props) {
  const auditQuery = useQuery({
    queryKey: ["client-billing", "audit-log", invoiceId],
    queryFn: () => getAuditLog(invoiceId as string),
    enabled: Boolean(invoiceId),
  });
  const entries = auditQuery.data?.data ?? [];

  return (
    <Dialog open={Boolean(invoiceId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Audit log — {label}</DialogTitle>
        </DialogHeader>
        {auditQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No audit entries yet.</p>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-md border p-2 text-sm">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className={ACTION_CLASS[entry.action] ?? ""}>
                    {entry.action}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatISTDate(entry.created_at)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Actor: {entry.actor_id}</p>
                {entry.reason && <p className="mt-1 text-xs">{entry.reason}</p>}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
