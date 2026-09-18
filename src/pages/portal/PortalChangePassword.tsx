import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { portalApi, getMustChangePasswordFlag, setMustChangePasswordFlag, clearPortalToken } from "@/lib/portalApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, KeyRound, ShieldCheck } from "lucide-react";

/**
 * Self-service client-portal password change (POST /api/portal/auth/change-password).
 * Reachable any time from within the portal, and forced on first login after a
 * generated ProcessName@2026-style password (portal.controller.ts's createClientUser sets
 * must_change_password=1) -- PortalLogin.tsx routes here automatically when the login
 * response says mustChangePassword: true.
 */
export default function PortalChangePassword() {
  const navigate = useNavigate();
  const forced = getMustChangePasswordFlag();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await portalApi.changePassword(currentPassword, newPassword);
      setMustChangePasswordFlag(false);
      navigate("/portal");
    } catch (err: any) {
      setError(err.message || "Failed to change password.");
    } finally {
      setLoading(false);
    }
  }

  function handleSignOutInstead() {
    clearPortalToken();
    navigate("/portal/login");
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4 font-sans">
      <div className="absolute left-[-10%] top-[-10%] h-[50%] w-[50%] rounded-full bg-blue-600/10 blur-[120px]" />

      <div className="z-10 w-full max-w-[420px]">
        <Card className="relative border border-slate-800/80 bg-slate-900/60 shadow-2xl backdrop-blur-xl">
          <div className="absolute left-[10%] right-[10%] top-[-1px] h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent" />

          <CardHeader className="space-y-1 pb-4">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10 text-blue-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <CardTitle className="text-center text-xl font-bold text-white">
              {forced ? "Set a New Password" : "Change Password"}
            </CardTitle>
            <CardDescription className="text-center text-sm text-slate-400">
              {forced
                ? "You're signing in with a temporary password. Choose a new one to continue."
                : "Update the password for your client portal login."}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
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

              <div className="space-y-2">
                <Label htmlFor="newPassword" className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                  New Password
                </Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
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
                disabled={loading || !currentPassword || !newPassword || !confirmPassword}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...
                  </>
                ) : (
                  "Update Password"
                )}
              </Button>

              {!forced && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 w-full text-xs text-slate-400 hover:text-white"
                  onClick={() => navigate("/portal")}
                >
                  Cancel
                </Button>
              )}

              {forced && (
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
        </Card>
      </div>
    </div>
  );
}
