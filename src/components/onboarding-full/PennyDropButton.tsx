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
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check existing status on mount
  useEffect(() => {
    async function checkStatus() {
      if (!token) return;
      try {
        const res = await hrmsApi.get(`/api/onboarding/penny-drop/status?token=${token}`);
        if (res.data.data?.status) {
          setStatus(res.data.data.status);
        }
      } catch {
        // Ignore - no existing penny drop
      }
    }
    checkStatus();
  }, [token]);

  async function handleVerify() {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.post("/api/onboarding/penny-drop/initiate", {
        token,
        accountNo,
        ifscCode,
        accountHolderName,
      });

      if (res.data.success) {
        setStatus("initiated");
        // Poll status every 3 seconds
        const interval = setInterval(async () => {
          try {
            const statusRes = await hrmsApi.get(`/api/onboarding/penny-drop/status?token=${token}`);
            if (statusRes.data.data?.status && statusRes.data.data.status !== "initiated") {
              setStatus(statusRes.data.data.status);
              clearInterval(interval);
              setLoading(false);
            }
          } catch {
            clearInterval(interval);
            setLoading(false);
          }
        }, 3000);

        // Stop polling after 2 minutes
        setTimeout(() => {
          clearInterval(interval);
          setLoading(false);
        }, 120000);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "Verification failed");
      setLoading(false);
    }
  }

  const statusColors: Record<string, string> = {
    verified: "text-emerald-700",
    name_mismatch: "text-amber-700",
    failed: "text-red-700",
    initiated: "text-blue-700",
  };

  const statusMessages: Record<string, string> = {
    verified: "✓ Account Verified",
    name_mismatch: "Name Mismatch - Under HR Review",
    failed: "Verification Failed",
    initiated: "Verification in progress...",
  };

  const isVerified = status === "verified";
  const canVerify = !disabled && !loading && accountNo && ifscCode && !isVerified;

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
            {statusMessages[status!] || status}
          </>
        ) : (
          <>🏦 Verify Bank Account (₹1 Drop)</>
        )}
      </Button>

      {status && !loading && (
        <p className={`text-xs font-bold ${statusColors[status] || "text-slate-600"}`}>
          Status: {statusMessages[status] || status}
        </p>
      )}

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> {error}
        </p>
      )}

      {!accountNo || !ifscCode ? (
        <p className="text-xs text-slate-500">
          Enter account number and IFSC code above to enable verification
        </p>
      ) : null}
    </div>
  );
}
