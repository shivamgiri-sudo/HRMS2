import { ReactNode, useState } from "react";
import { ShieldAlert, SendHorizonal } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";

type WorkforcePageGateProps = {
  pageCode: string;
  children: ReactNode;
};

function RequestAccessButton({ pageCode }: { pageCode: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit() {
    if (!reason.trim()) {
      toast.error("Please enter a reason for your request.");
      return;
    }
    setLoading(true);
    try {
      await hrmsApi.post("/api/access/access-requests", { page_code: pageCode, reason });
      setSubmitted(true);
      toast.success("Access request submitted. An admin will review it shortly.");
      setOpen(false);
    } catch {
      toast.error("Failed to submit access request. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <p className="mt-4 text-xs font-semibold text-rose-600">
        Your access request has been submitted for review.
      </p>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="mt-4 border-rose-300 text-rose-700 hover:bg-rose-50"
        onClick={() => setOpen(true)}
      >
        <SendHorizonal className="mr-2 h-4 w-4" />
        Request Access
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request Page Access</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Explain why you need access to this page. Your request will be reviewed by an administrator.
          </p>
          <Textarea
            placeholder="e.g. I need to view this section to complete my daily reporting tasks…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            className="mt-2"
          />
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={loading || !reason.trim()}>
              {loading ? "Submitting…" : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function WorkforcePageGate({ pageCode, children }: WorkforcePageGateProps) {
  const { isLoading, canViewPage, data, isError, error } = useWorkforceAccess();

  // Show a minimal inline spinner — ProtectedRoute already waited for auth/role queries,
  // so this loading state is almost never visible in practice after initial page load.
  // Do not block on !data: if loading is done but data is absent the isError branch handles it.
  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-slate-200 border-t-slate-600" />
      </div>
    );
  }

  // Handle API error (auth failure, network failure, etc.)
  if (isError) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-2xl rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center shadow-sm">
          <ShieldAlert className="mx-auto h-12 w-12 text-amber-600" />
          <h1 className="mt-4 text-2xl font-black text-amber-950">Unable to verify access</h1>
          <p className="mt-3 text-sm leading-6 text-amber-800">
            Could not load your permissions. This may be a temporary issue.
          </p>
          {error && (
            <p className="mt-2 text-xs text-amber-700">{String(error)}</p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-4 border-amber-300 text-amber-700 hover:bg-amber-100"
            onClick={() => window.location.reload()}
          >
            Refresh Page
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  if (!canViewPage(pageCode)) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-2xl rounded-3xl border border-rose-200 bg-rose-50 p-8 text-center shadow-sm">
          <ShieldAlert className="mx-auto h-12 w-12 text-rose-600" />
          <h1 className="mt-4 text-2xl font-black text-rose-950">Access not available</h1>
          <p className="mt-3 text-sm leading-6 text-rose-800">
            Your current role does not have permission to open this Workforce OS page.
          </p>
          <p className="mt-3 rounded-2xl bg-white/70 px-4 py-3 text-xs font-semibold text-rose-700">
            Contact your administrator or use the button below to request access.
          </p>
          <RequestAccessButton pageCode={pageCode} />
        </div>
      </DashboardLayout>
    );
  }

  return <>{children}</>;
}
