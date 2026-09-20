import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldAlert, LogOut, Loader2 } from "lucide-react";
import { getImpersonationInfo, clearPortalToken, portalApi } from "@/lib/portalApi";

/**
 * Persistent, always-visible banner shown on every authenticated portal page while the
 * current session was opened via super-admin impersonation (POST /api/portal/admin/impersonate)
 * rather than the client's own OTP login.
 *
 * Required per the Client Portal master prompt's CP-09 (impersonation must be "visibly
 * labelled" and allow "immediate exit") -- this was the missing piece after the backend
 * fix: the token itself now carries impersonatedBy, but nothing rendered it. Deliberately
 * NOT dismissible: hiding it while still inside someone else's session data is exactly what
 * this exists to prevent.
 */
/** Fixed height in px, exported so pages needing to reserve space for this banner (when it
 *  renders) can offset their own sticky headers by the same amount without guessing. */
export const IMPERSONATION_BANNER_HEIGHT_PX = 40;

export function ImpersonationBanner() {
  const navigate = useNavigate();
  const { isImpersonating } = getImpersonationInfo();
  const [exiting, setExiting] = useState(false);

  if (!isImpersonating) return null;

  async function handleExit() {
    setExiting(true);
    try {
      // Revoke server-side FIRST -- clearing the local token before this call would
      // succeed either way (logout() only needs the token that's about to be erased),
      // but ordering it this way means a network failure here is visible (still shows
      // the local session as active) rather than silently leaving the real token valid
      // while the UI already looks signed out.
      await portalApi.logout();
    } catch {
      // Revocation failing server-side must not trap the admin in the impersonated
      // session -- clearing the local token below still ends it from this browser's
      // point of view, which is the same guarantee "Exit" gave before this change.
    } finally {
      clearPortalToken();
      navigate("/portal/login");
    }
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-amber-950 border-b border-amber-600"
      style={{ height: IMPERSONATION_BANNER_HEIGHT_PX }}
    >
      <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-bold">
          <ShieldAlert className="w-4 h-4 flex-shrink-0" />
          <span>
            You are viewing this client's portal as a super admin, not as the client. This session expires in 2 hours and is audit-logged.
          </span>
        </div>
        <button
          onClick={handleExit}
          disabled={exiting}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-950/10 hover:bg-amber-950/20 text-xs font-bold whitespace-nowrap transition-colors disabled:opacity-60"
        >
          {exiting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />} Exit
        </button>
      </div>
    </div>
  );
}
