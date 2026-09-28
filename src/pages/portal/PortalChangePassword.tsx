import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { portalApi, getMustChangePasswordFlag, setMustChangePasswordFlag, clearPortalToken } from "@/lib/portalApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, KeyRound, ShieldCheck, CheckCircle2 } from "lucide-react";

/**
 * Self-service client-portal password change (POST /api/portal/auth/change-password),
 * and -- when reached with ?mode=recovery -- the forgot-password RESET flow
 * (POST /api/portal/auth/reset-password) instead.
 *
 * Reachable any time from within the portal, and forced on first login after a
 * generated ProcessName@2026-style password (portal.controller.ts's createClientUser sets
 * must_change_password=1) -- PortalLogin.tsx routes here automatically when the login
 * response says mustChangePassword: true.
 *
 * The recovery mode is how PortalLogin.tsx's OTP flow closes the "forgot password with no
 * admin nearby" gap: a client who verifies via email OTP already holds a valid dashboard
 * token, so they can set a brand-new login password right here with no need to know their
 * old one -- identity was already proven by the OTP itself. See resetClientPasswordSchema
 * (backend) for why that endpoint has no currentPassword field at all.
 */
export default function PortalChangePassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const forced = getMustChangePasswordFlag();
  const isRecovery = searchParams.get("mode") === "recovery";

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown once, right after a recovery reset -- the client's new (or newly-minted)
  // Login ID. Skipped for a plain change-password, which never touches login_id.
  const [recoveredLoginId, setRecoveredLoginId] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setLoading(true);
    try {
      if (isRecovery) {
        const { loginId } = await portalApi.resetPassword(newPassword);
        setMustChangePasswordFlag(false);
        setRecoveredLoginId(loginId);
      } else {
        await portalApi.changePassword(currentPassword, newPassword);
        setMustChangePasswordFlag(false);
        navigate("/portal");
      }
    } catch (err: any) {
      setError(err.message || "Failed to set password.");
    } finally {
      setLoading(false);
    }
  }

  // Same defense-in-depth as ImpersonationBanner's Exit button -- revoke server-side
  // before clearing locally, but never block the actual sign-out on that call succeeding.
  async function handleSignOutInstead() {
    try {
      await portalApi.logout();
    } finally {
      clearPortalToken();
      navigate("/portal/login");
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4 font-sans">
      <div className="absolute left-[-10%] top-[-10%] h-[50%] w-[50%] rounded-full bg-blue-600/10 blur-[120px]" />

      <div className="z-10 w-full max-w-[420px]">
        <Card className="relative border border-slate-800/80 bg-slate-900/60 shadow-2xl backdrop-blur-xl">
          <div className="absolute left-[10%] right-[10%] top-[-1px] h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent" />

          {recoveredLoginId ? (
            <>
              <CardHeader className="space-y-1 pb-4">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <CardTitle className="text-center text-xl font-bold text-white">Password Reset</CardTitle>
                <CardDescription className="text-center text-sm text-slate-400">
                  Save this Login ID — you'll need it to sign in with a password next time.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs text-slate-400">Login ID</Label>
                  <div className="mt-1 rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 font-mono text-sm text-white">
                    {recoveredLoginId}
                  </div>
                </div>
                <Button
                  className="h-10 w-full bg-blue-600 font-medium text-white shadow-lg shadow-blue-950 transition-all hover:bg-blue-500"
                  onClick={() => navigate("/portal")}
                >
                  Continue to Dashboard
                </Button>
              </CardContent>
            </>
          ) : (
          <>
          <CardHeader className="space-y-1 pb-4">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10 text-blue-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <CardTitle className="text-center text-xl font-bold text-white">
              {isRecovery ? "Reset Your Password" : forced ? "Set a New Password" : "Change Password"}
            </CardTitle>
            <CardDescription className="text-center text-sm text-slate-400">
              {isRecovery
                ? "You verified your identity by email. Choose a new password to sign in with your Login ID from now on."
                : forced
                ? "You're signing in with a temporary password. Choose a new one to continue."
                : "Update the password for your client portal login."}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {!isRecovery && (
                <div className="space-y-2">
                  <Label htmlFor="currentPassword" className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                    {forced ? "Temporary Password" : "Current Password"}
                  </Label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input
                      id="currentPassword"
                      type="password"
                      value={currentPassword}
                      autoFocus
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="h-10 border-slate-800 bg-slate-950/80 pl-10 text-white transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="newPassword" className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                  New Password
                </Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  autoFocus={isRecovery}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="h-10 border-slate-800 bg-slate-950/80 text-white transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  placeholder="At least 8 characters"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                  Confirm New Password
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-10 border-slate-800 bg-slate-950/80 text-white transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {error ? (
                <div className="rounded-lg border border-red-900/50 bg-red-950/50 p-3 text-xs text-red-400">
                  {error}
                </div>
              ) : null}

              <Button
                type="submit"
                className="h-10 w-full bg-blue-600 font-medium text-white shadow-lg shadow-blue-950 transition-all hover:bg-blue-500"
                disabled={loading || (!isRecovery && !currentPassword) || !newPassword || !confirmPassword}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...
                  </>
                ) : isRecovery ? (
                  "Set New Password"
                ) : (
                  "Update Password"
                )}
              </Button>

              {!forced && !isRecovery && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 w-full text-xs text-slate-400 hover:text-white"
                  onClick={() => navigate("/portal")}
                >
                  Cancel
                </Button>
              )}

              {(forced || isRecovery) && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 w-full text-xs text-slate-400 hover:text-white"
                  onClick={handleSignOutInstead}
                >
                  Sign out instead
                </Button>
              )}
            </form>
          </CardContent>
          </>
          )}
        </Card>
      </div>
    </div>
  );
}
