import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

export function PennyDropButton({
  token,
  accountNo,
  ifscCode,
  accountHolderName,
  disabled,
}: {
  token: string;
  accountNo: string;
  ifscCode: string;
  accountHolderName: string;
  disabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [bankStatus, setBankStatus] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check existing BGV bank check status on mount
  useEffect(() => {
    async function checkExisting() {
      if (!token) return;
      try {
        const res = await hrmsApi.get(`/api/ats/bgv/status?token=${encodeURIComponent(token)}`);
        const checks: any[] = res.data?.data?.checks ?? [];
        const bankCheck = checks.find((c: any) => c.check_type === "bank");
        if (bankCheck) {
          setBankStatus(bankCheck.status);
          setResultSummary(bankCheck.result_summary ?? null);
        }
      } catch {
        // No existing BGV record — ignore
      }
    }
    checkExisting();
  }, [token]);

  async function handleVerify() {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.post("/api/ats/bgv/verify/bank", {
        token,
        accountNo,
        ifscCode,
        accountHolderName,
      });

      const checks: any[] = res.data?.data?.checks ?? [];
      const bankCheck = checks.find((c: any) => c.check_type === "bank");
      if (bankCheck) {
        setBankStatus(bankCheck.status);
        setResultSummary(bankCheck.result_summary ?? null);
      } else {
        // Response succeeded but no bank check record yet — treat as queued
        setBankStatus("queued");
        setResultSummary("Bank verification queued for review.");
      }
    } catch (err: any) {
      const status = err.response?.status;
      const msg = err.response?.data?.message ?? err.response?.data?.error ?? err.message;

      if (status === 403) {
        setError("BGV consent is required before bank verification. Please complete Step 5 first.");
      } else if (status === 503) {
        setError("Bank verification service is not configured — please contact HR.");
      } else {
        setError(msg || "Verification failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  const statusColors: Record<string, string> = {
    verified: "text-emerald-700",
    mismatch: "text-amber-700",
    failed: "text-red-700",
    queued: "text-blue-700",
    manual_review: "text-amber-700",
  };

  const statusMessages: Record<string, string> = {
    verified: "✓ Account Verified",
    mismatch: "Name Mismatch — Under HR Review",
    failed: "Verification Failed",
    queued: "Queued for Review",
    manual_review: "Flagged for Manual Review",
  };

  const isVerified = bankStatus === "verified";
  const canVerify = !disabled && !loading && !!accountNo && !!ifscCode && !isVerified;

  return (
    <div className="space-y-2">
      <Button
        onClick={handleVerify}
        disabled={!canVerify}
        size="lg"
        className="w-full min-h-[48px] font-bold rounded-lg"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Verifying Bank Account...
          </>
        ) : isVerified ? (
          <>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            {statusMessages[bankStatus!] || bankStatus}
          </>
        ) : (
          <>🏦 Verify Bank Account</>
        )}
      </Button>

      {bankStatus && !loading && (
        <p className={`text-xs font-bold ${statusColors[bankStatus] || "text-slate-600"}`}>
          Status: {statusMessages[bankStatus] || bankStatus}
        </p>
      )}

      {resultSummary && !loading && (
        <p className="text-xs text-slate-500">{resultSummary}</p>
      )}

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> {error}
        </p>
      )}

      {(!accountNo || !ifscCode) && (
        <p className="text-xs text-slate-500">
          Enter account number and IFSC code above to enable verification
        </p>
      )}
    </div>
  );
}
