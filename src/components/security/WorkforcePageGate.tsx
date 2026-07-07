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
  const { isLoading, canViewPage, data } = useWorkforceAccess();

  // Show loading until we have data — don't evaluate canViewPage with undefined data
  if (isLoading || !data) {
    return (
      <DashboardLayout>
        <div className="rounded-3xl border bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Checking access...</p>
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
