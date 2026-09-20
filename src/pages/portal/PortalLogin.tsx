import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { portalApi, savePortalToken, setMustChangePasswordFlag } from "@/lib/portalApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldCheck, Mail, KeyRound, ArrowRight, UserCheck, Lock } from "lucide-react";

type Mode = "password" | "otp-email" | "otp-code";

/**
 * Client portal login. Supports two independent sign-in methods:
 *   - Login ID + password (client_user.login_id/password_hash, migration 1814)
 *   - Email + OTP (the original flow, portal.auth.service.ts's request/verifyOtp)
 *
 * When reached via /:portalSlug (App.tsx strips the "_clientportal" suffix before this
 * component ever sees it -- see PublicPortalSlugRoute), the page fetches the process/client
 * name for that slug purely for branding ("Signing in to <Client> / <Process>"); it does not
 * change what the account can see after login -- that is still entirely determined by the
 * account's own process_ids, exactly as before. A wrong or unknown slug still shows the
 * generic login form rather than blocking access, since the slug is a convenience URL, not
 * a second credential.
 */
export default function PortalLogin() {
  const navigate = useNavigate();
  const { portalSlug } = useParams<{ portalSlug?: string }>();

  const [mode, setMode] = useState<Mode>("password");
  // Distinguishes "sign in by email" (a plain alternative to password login, existing
  // behaviour) from "forgot my password" (the recovery gap this flag closes) -- both
  // reuse the exact same OTP request/verify calls, only the post-verification
  // destination differs. See handleVerifyOtp.
  const [isRecovery, setIsRecovery] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branding, setBranding] = useState<{ clientName: string; processName: string } | null>(null);

  useEffect(() => {
    if (!portalSlug) return;
    // Strip a trailing "_clientportal" if present -- the route itself already does this
    // (see public.routes.tsx), but this component may also be reached directly by slug
    // during development/testing, so it tolerates either form.
    const slug = portalSlug.replace(/_clientportal$/, "");
    portalApi
      .getProcessBySlug(slug)
      .then((res) => {
        if (res.data) setBranding({ clientName: res.data.client_name, processName: res.data.process_name });
      })
      .catch(() => {
        // Unknown slug -- fall back silently to the generic branding below. Not an error
        // state: a mistyped or stale URL should still land on a usable login form.
      });
  }, [portalSlug]);

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, mustChangePassword } = await portalApi.loginWithPassword(loginId, password);
      savePortalToken(token);
      setMustChangePasswordFlag(mustChangePassword);
      navigate(mustChangePassword ? "/portal/change-password" : "/portal");
    } catch (err: any) {
      setError(err.message || "Invalid login ID or password.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await portalApi.requestOtp(email);
      setMode("otp-code");
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
      setMustChangePasswordFlag(false);
      // Recovery intent (came in via "Forgot your password?") routes to the reset-password
      // screen instead of straight to the dashboard -- the whole point of this path is
      // that the client gets their login_id/password back, not just one-off dashboard
      // access via OTP again next time. See PortalChangePassword's own header comment.
      navigate(isRecovery ? "/portal/change-password?mode=recovery" : "/portal");
    } catch (err: any) {
      setError(err.message || "Invalid OTP code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const subtitle = branding
    ? `Signing in to ${branding.clientName} — ${branding.processName}`
    : "Access real-time operational metrics and glide paths";

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
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
        </div>

        <Card className="relative border border-slate-800/80 bg-slate-900/60 shadow-2xl backdrop-blur-xl">
          <div className="absolute left-[10%] right-[10%] top-[-1px] h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent" />

          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-center text-xl font-bold text-white">
              {mode === "password"
                ? "Client Sign In"
                : mode === "otp-email"
                ? isRecovery ? "Reset Your Password" : "Sign In by Email"
                : "Verify Code"}
            </CardTitle>
            <CardDescription className="text-center text-sm text-slate-400">
              {mode === "otp-code"
                ? `We've sent a 6-digit confirmation code to ${email}`
                : mode === "otp-email" && isRecovery
                ? "Enter the email on file for your portal account"
                : "Use your Login ID and password, or sign in by email instead"}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {mode === "password" && (
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="loginId" className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                    Login ID
                  </Label>
                  <div className="relative">
                    <UserCheck className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input
                      id="loginId"
                      type="text"
                      value={loginId}
                      autoFocus
                      onChange={(e) => setLoginId(e.target.value)}
                      className="h-10 border-slate-800 bg-slate-950/80 pl-10 text-white transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      placeholder="ProcessName_mas"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                    Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-10 border-slate-800 bg-slate-950/80 pl-10 text-white transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      placeholder="••••••••"
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
                  disabled={loading || !loginId || !password}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...
                    </>
                  ) : (
                    <>
                      Sign In <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>

                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 flex-1 text-xs text-slate-400 hover:text-white"
                    onClick={() => { setMode("otp-email"); setIsRecovery(false); setError(null); }}
                  >
                    Sign in by email instead
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 flex-1 text-xs text-slate-400 hover:text-white"
                    onClick={() => { setMode("otp-email"); setIsRecovery(true); setError(null); }}
                  >
                    Forgot your password?
                  </Button>
                </div>
              </form>
            )}

            {mode === "otp-email" && (
              <form onSubmit={handleRequestOtp} className="space-y-4">
                {isRecovery && (
                  <p className="text-xs text-slate-400 -mt-1">
                    We'll email you a code to confirm it's you, then let you set a brand new password.
                  </p>
                )}
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

                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 w-full text-xs text-slate-400 hover:text-white"
                  onClick={() => { setMode("password"); setIsRecovery(false); setError(null); }}
                >
                  Use Login ID and password instead
                </Button>
              </form>
            )}

            {mode === "otp-code" && (
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
                      maxLength={50}
                      onChange={(e) => setOtp(e.target.value)}
                      className="h-10 border-slate-800 bg-slate-950/80 pl-10 text-center font-mono text-lg tracking-wider text-white transition-colors focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                      placeholder="Enter code"
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
                  disabled={loading || otp.length < 6}
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
                    setMode("otp-email");
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
