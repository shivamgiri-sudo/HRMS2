import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Monitor, LogOut, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Self-service session management — "Sign out of this device" / "Sign out
 * of all other devices". The backend endpoints (GET/DELETE /api/auth/sessions*)
 * already existed and were already correctly scoped to the caller's own
 * sessions, but nothing in the frontend called them — a real capability with
 * no way to reach it. (2026-08-13 audit, "fix immediately")
 *
 * DELETE /sessions/all/others originally required the caller's raw refresh
 * token via header/body, which a browser can never supply (the refresh token
 * is httpOnly specifically so client-side JS can't read it). Fixed
 * server-side to also accept the same httpOnly cookie /api/auth/refresh
 * already reads — this component relies on that fix; it sends no token
 * itself, since hrmsApi's requests already carry credentials.
 */

interface SessionRow {
  id: string;
  deviceName: string | null;
  deviceFingerprint: string | null;
  ipAddress: string | null;
  locationCity: string | null;
  locationCountry: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function SessionsSecurityPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["auth-sessions"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: SessionRow[] }>("/api/auth/sessions");
      return res.data ?? [];
    },
    staleTime: 30_000,
  });

  const revokeOne = useMutation({
    mutationFn: async (sessionId: string) => {
      setRevokingId(sessionId);
      return hrmsApi.delete(`/api/auth/sessions/${sessionId}`);
    },
    onSuccess: () => {
      toast({ title: "Session signed out" });
      queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
    },
    onError: (err: Error) => {
      toast({ title: "Could not sign out that session", description: err.message, variant: "destructive" });
    },
    onSettled: () => setRevokingId(null),
  });

  const revokeAllOthers = useMutation({
    mutationFn: async () => hrmsApi.delete<{ success: boolean; revokedCount: number; message: string }>(
      "/api/auth/sessions/all/others"
    ),
    onSuccess: (res) => {
      toast({ title: "Signed out of all other devices", description: res.message });
      queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
    },
    onError: (err: Error) => {
      toast({ title: "Could not sign out other devices", description: err.message, variant: "destructive" });
    },
  });

  const sessions = data ?? [];
  const otherCount = sessions.filter((s) => !s.isCurrent).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            Active Sessions
          </CardTitle>
          <CardDescription>
            Devices currently signed in to your account. If you don't recognize one, sign it out.
          </CardDescription>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={otherCount === 0 || revokeAllOthers.isPending}
            >
              {revokeAllOthers.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              Sign out all other devices
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out of all other devices?</AlertDialogTitle>
              <AlertDialogDescription>
                This immediately ends every session except the one you're using right now
                ({otherCount} {otherCount === 1 ? "device" : "devices"}). Anyone using this account
                elsewhere will be signed out and need to log in again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => revokeAllOthers.mutate()}>
                Sign out other devices
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading sessions...
          </div>
        ) : isError ? (
          <p className="py-6 text-sm text-muted-foreground">Could not load active sessions.</p>
        ) : sessions.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">No active sessions found.</p>
        ) : (
          <div className="divide-y">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-4 py-3">
                <div className="flex items-start gap-3">
                  <Monitor className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <div className="text-sm">
                    <div className="flex items-center gap-2 font-medium">
                      {s.deviceName || "Unknown device"}
                      {s.isCurrent && <Badge variant="secondary">This device</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[s.locationCity, s.locationCountry].filter(Boolean).join(", ") || s.ipAddress || "Unknown location"}
                      {" · "}Last active {formatWhen(s.lastActiveAt)}
                    </div>
                  </div>
                </div>
                {!s.isCurrent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revokeOne.mutate(s.id)}
                    disabled={revokingId === s.id}
                  >
                    {revokingId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign out"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
