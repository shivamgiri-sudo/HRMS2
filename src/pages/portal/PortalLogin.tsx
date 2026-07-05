import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { portalApi, savePortalToken } from "@/lib/portalApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldCheck, Mail, KeyRound, ArrowRight, UserCheck } from "lucide-react";

export default function PortalLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await portalApi.requestOtp(email);
      setStep("otp");
    } catch (err: any) {
      setError(err.message || "Failed to request OTP. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token } = await portalApi.verifyOtp(email, otp);
      savePortalToken(token);
      navigate("/portal");
    } catch (err: any) {
      setError(err.message || "Invalid OTP code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4 font-sans">
      <div className="absolute left-[-10%] top-[-10%] h-[50%] w-[50%] rounded-full bg-blue-600/10 blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] h-[50%] w-[50%] rounded-full bg-emerald-600/10 blur-[120px]" />

      <div className="z-10 w-full max-w-[420px]">
        <div className="mb-6 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blue-400">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-400" /> Secure Gate
          </div>
          <h1 className="bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent">
            MAS Callnet
          </h1>
          <p className="mt-1 text-sm text-slate-400">Operations & Analytics Client Portal</p>
        </div>

        <Card className="relative border border-slate-800/80 bg-slate-900/60 shadow-2xl backdrop-blur-xl">
          <div className="absolute left-[10%] right-[10%] top-[-1px] h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent" />

          <CardHeader className="space-y-1 pb-6">
            <CardTitle className="text-center text-xl font-bold text-white">
              {step === "email" ? "Client Sign In" : "Verify Code"}
            </CardTitle>
            <CardDescription className="text-center text-sm text-slate-400">
              {step === "email"
                ? "Access real-time operational metrics and glide paths"
                : `We've sent a 6-digit confirmation code to ${email}`}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {step === "email" ? (
              <form onSubmit={handleRequestOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                    Email address
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      autoFocus
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-10 border-slate-800 bg-slate-950/80 pl-10 text-white transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      placeholder="client@company.com"
                    />
                  </div>
                </div>

                {error ? (
                  <div className="rounded-lg border border-red-900/50 bg-red-950/50 p-3 text-xs text-red-400">
                    {error}
                  </div>
                ) : null}

                <Button
                  type="submit"
                  className="h-10 w-full bg-blue-600 font-medium text-white shadow-lg shadow-blue-950 transition-all hover:bg-blue-500"
                  disabled={loading || !email}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Requesting...
                    </>
                  ) : (
                    <>
                      Send OTP <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="otp" className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                    Verification Code
                  </Label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input
                      id="otp"
                      type="text"
                      value={otp}
                      autoFocus
                      maxLength={6}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                      className="h-10 border-slate-800 bg-slate-950/80 pl-10 text-center font-mono text-xl tracking-[0.4em] text-white transition-colors focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                      placeholder="000000"
                    />
                  </div>
                </div>

                {error ? (
                  <div className="rounded-lg border border-red-900/50 bg-red-950/50 p-3 text-xs text-red-400">
                    {error}
                  </div>
                ) : null}

                <Button
                  type="submit"
                  className="h-10 w-full bg-emerald-600 font-medium text-white shadow-lg shadow-emerald-950 transition-all hover:bg-emerald-500"
                  disabled={loading || otp.length !== 6}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...
                    </>
                  ) : (
                    <>
                      Verify OTP <UserCheck className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 w-full text-xs text-slate-400 hover:text-white"
                  onClick={() => {
                    setStep("email");
                    setOtp("");
                    setError(null);
                  }}
                >
                  Use a different email address
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-slate-500">
          Authorized Client Access Only | 2026 MAS Callnet India
        </p>
      </div>
    </div>
  );
}
