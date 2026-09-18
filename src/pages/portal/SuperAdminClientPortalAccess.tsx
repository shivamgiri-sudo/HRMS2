import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { savePortalToken } from "@/lib/portalApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldAlert, Building2, LogIn, Search } from "lucide-react";

interface ClientUserRow {
  id: string;
  email: string;
  name: string;
  client_id: string;
  client_name: string;
}

/**
 * Super-admin utility: search any active client_user account and open their real
 * dashboard directly, without needing their email OTP.
 *
 * Backed by POST /api/portal/admin/impersonate (portal-admin.routes.ts), which mints the
 * exact same token shape/lifetime a real client OTP login produces (via
 * portalAuthService.issueToken) — so this is not a separate "admin view" of the data, it
 * is the real client dashboard, opened on the admin's behalf. Every use is written to
 * portal_admin_impersonation_log with the admin's own id, the target client, and a
 * required reason.
 */
export default function SuperAdminClientPortalAccess() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<ClientUserRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["portal-admin-client-users", search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await hrmsApi.get<{ data: ClientUserRow[] }>(
        `/api/portal/admin/client-users?${params.toString()}`
      );
      return res.data ?? [];
    },
  });

  const impersonateMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Select a client user first");
      if (!reason.trim()) throw new Error("A reason is required");
      const res = await hrmsApi.post<{ token: string }>("/api/portal/admin/impersonate", {
        client_user_id: selected.id,
        reason: reason.trim(),
      });
      return res;
    },
    onSuccess: (res) => {
      savePortalToken(res.token);
      navigate("/portal");
    },
    onError: (err: any) => {
      setError(err?.message ?? "Failed to open client dashboard");
    },
  });

  const rows = data ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans">
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-amber-400" /> Client Portal Access
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            Open any client's real dashboard directly. Every access is logged with your
            user id, the client, and the reason you provide below.
          </p>
        </div>

        <Card className="bg-slate-900/70 border-slate-800">
          <CardHeader>
            <CardTitle className="text-base text-white">1. Find the client</CardTitle>
            <CardDescription>Search by client name or portal login email</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search client name or email..."
                className="pl-10 bg-slate-950 border-slate-800 text-white"
              />
            </div>

            {isLoading ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
              </div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">No active client accounts found.</p>
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {rows.map((row) => (
                  <button
                    key={row.id}
                    onClick={() => setSelected(row)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors flex items-center gap-3 ${
                      selected?.id === row.id
                        ? "bg-blue-600/20 border-blue-500/50"
                        : "bg-slate-950/40 border-slate-800 hover:bg-slate-800/60"
                    }`}
                  >
                    <Building2 className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{row.client_name}</p>
                      <p className="text-xs text-slate-500 truncate">{row.email}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {selected && (
          <Card className="bg-slate-900/70 border-slate-800">
            <CardHeader>
              <CardTitle className="text-base text-white">2. Confirm and open dashboard</CardTitle>
              <CardDescription>
                Opening <span className="text-slate-300 font-medium">{selected.client_name}</span>'s
                dashboard as <span className="text-slate-300 font-medium">{selected.email}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="reason" className="text-slate-300">Reason (required, audited)</Label>
                <Input
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Client requested a walkthrough of their metrics"
                  className="mt-1 bg-slate-950 border-slate-800 text-white"
                />
              </div>

              {error && (
                <div className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <Button
                onClick={() => impersonateMutation.mutate()}
                disabled={impersonateMutation.isPending || !reason.trim()}
                className="w-full bg-blue-600 hover:bg-blue-500"
              >
                {impersonateMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" /> Opening dashboard...
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4 mr-2" /> Open {selected.client_name}'s Dashboard
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
