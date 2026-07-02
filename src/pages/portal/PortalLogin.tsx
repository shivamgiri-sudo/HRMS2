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
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 relative overflow-hidden font-sans">
      {/* Dynamic Futuristic Glowing Background Accents */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/10 blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-600/10 blur-[120px]" />

      <div className="w-full max-w-[420px] z-10">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-blue-400 text-xs font-semibold uppercase tracking-wider mb-3">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-400" /> Secure Gate
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            MAS Callnet
          </h1>
          <p className="text-sm text-slate-400 mt-1">Operations & Analytics Client Portal</p>
        </div>

        {/* Card Component with Glassmorphism and Neon Highlight */}
        <Card className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 shadow-2xl relative">
          <div className="absolute -top-px left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent" />
          
          <CardHeader className="space-y-1 pb-6">
            <CardTitle className="text-white text-xl text-center font-bold">
              {step === "email" ? "Client Sign In" : "Verify Code"}
            </CardTitle>
            <CardDescription className="text-slate-400 text-center text-sm">
              {step === "email"
                ? "Access real-time operational metrics & glide paths"
                : `We've sent a 6-digit confirmation code to ${email}`}
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-4">
            {step === "email" ? (
              <form onSubmit={handleRequestOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-300 text-xs font-semibold uppercase tracking-wide">
                    Email address
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      autoFocus
                      onChange={e => setEmail(e.target.value)}
                      className="bg-slate-950/80 border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-white pl-10 h-10 transition-colors"
                      placeholder="client@company.com"
                    />
                  </div>
                </div>

                {error && (
                  <div className="p-3 bg-red-950/50 border border-red-900/50 rounded-lg text-xs text-red-400">
                    {error}
                  </div>
                )}

                {/* Info Tips for Demo Mode - Only show in development */}
                {import.meta.env.DEV && (
                  <div className="p-3 bg-blue-950/30 border border-blue-900/30 rounded-lg text-xs text-blue-400 leading-relaxed">
                    💡 <strong>Demo Mode Enabled</strong>: Use <code className="bg-blue-900/40 px-1 rounded text-white">demo@mascallnet.com</code> to log in instantly without database dependency or actual OTP requirements.
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium h-10 transition-all shadow-lg shadow-blue-950"
                  disabled={loading || !email}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" /> Requesting...
                    </>
                  ) : (
                    <>
                      Send OTP <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="otp" className="text-slate-300 text-xs font-semibold uppercase tracking-wide">
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
                      onChange={e => setOtp(e.target.value.replace(/\D/g, ""))}
                      className="bg-slate-950/80 border-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white pl-10 text-center text-xl tracking-[0.4em] font-mono h-10 transition-colors"
                      placeholder="000000"
                    />
                  </div>
                </div>

                {error && (
                  <div className="p-3 bg-red-950/50 border border-red-900/50 rounded-lg text-xs text-red-400">
                    {error}
                  </div>
                )}

                {/* Info Tips for Demo OTP - Only show in development */}
                {import.meta.env.DEV && (
                  <div className="p-3 bg-emerald-950/30 border border-emerald-900/30 rounded-lg text-xs text-emerald-400">
                    💡 <strong>Demo Key</strong>: Enter any 6 digits (e.g., <code className="bg-emerald-900/40 px-1 rounded text-white">123456</code>) to verify.
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium h-10 transition-all shadow-lg shadow-emerald-950"
                  disabled={loading || otp.length !== 6}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" /> Verifying...
                    </>
                  ) : (
                    <>
                      Verify OTP <UserCheck className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-slate-400 hover:text-white text-xs h-9"
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

        {/* Footer info */}
        <p className="text-center text-xs text-slate-500 mt-6">
          Authorized Client Access Only · © 2026 MAS Callnet India
        </p>
      </div>
    </div>
  );
}
