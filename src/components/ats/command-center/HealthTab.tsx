import { useState } from "react";
import { CheckCircle, AlertTriangle, RefreshCcw, Activity, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";

interface HealthTabProps {
  onLoadHealth?: () => void;
}

export function HealthTab({ onLoadHealth }: HealthTabProps) {
  const [health, setHealth] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  async function loadHealth() {
    setHealthLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: any }>(
        `/api/ats-full-parity/health`
      );
      setHealth(res.data);

      if (res.data.ok) {
        toast.success("All health checks passed");
      } else {
        toast.warning("Some health checks need attention");
      }
    } catch (error) {
      toast.error("Health check failed");
    } finally {
      setHealthLoading(false);
    }
  }

  const checks = health?.checks || [];
  const dataIntegrityChecks = checks.filter((c: any) => c.type === "data_integrity");
  const slaChecks = checks.filter((c: any) => c.type === "sla");
  const notificationChecks = checks.filter((c: any) => c.type === "notification");
  const integrationChecks = checks.filter((c: any) => c.type === "integration");

  const getCheckIcon = (ok: boolean) => {
    return ok ? (
      <CheckCircle className="h-5 w-5 text-emerald-600" />
    ) : (
      <AlertTriangle className="h-5 w-5 text-rose-600" />
    );
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "data_integrity":
        return <Shield className="h-5 w-5 text-blue-600" />;
      case "sla":
        return <Activity className="h-5 w-5 text-amber-600" />;
      default:
        return <CheckCircle className="h-5 w-5 text-slate-600" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Health Overview */}
      <Card className={health?.ok ? "border-emerald-300 bg-emerald-50" : health ? "border-rose-300 bg-rose-50" : ""}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {health?.ok ? (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600">
                  <CheckCircle className="h-6 w-6 text-white" />
                </div>
              ) : health ? (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-600">
                  <AlertTriangle className="h-6 w-6 text-white" />
                </div>
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-600">
                  <Activity className="h-6 w-6 text-white" />
                </div>
              )}
              <div>
                <CardTitle className="text-2xl">
                  {health ? (health.ok ? "System Healthy" : "Attention Required") : "System Health"}
                </CardTitle>
                <p className="text-sm text-slate-600 mt-1">
                  {health
                    ? health.ok
                      ? "All system checks passed successfully"
                      : "Some checks need attention"
                    : "Run health checks to view system status"}
                </p>
              </div>
            </div>
            <button
              onClick={() => loadHealth()}
              disabled={healthLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <RefreshCcw className={`h-4 w-4 ${healthLoading ? "animate-spin" : ""}`} />
              {healthLoading ? "Running..." : health ? "Re-run Checks" : "Run Health Checks"}
            </button>
          </div>
        </CardHeader>
      </Card>

      {/* Loading State */}
      {healthLoading && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
              <p className="text-sm font-semibold text-slate-600">Running health checks...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Health Check Results */}
      {health && !healthLoading && (
        <>
          {/* Summary Stats */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-slate-900">{checks.length}</p>
                  <p className="text-sm text-slate-600 mt-1">Total Checks</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-emerald-300 bg-emerald-50">
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-emerald-600">
                    {checks.filter((c: any) => c.ok).length}
                  </p>
                  <p className="text-sm text-emerald-700 mt-1">Passed</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-rose-300 bg-rose-50">
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-rose-600">
                    {checks.filter((c: any) => !c.ok).length}
                  </p>
                  <p className="text-sm text-rose-700 mt-1">Failed</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-blue-600">
                    {Math.round((checks.filter((c: any) => c.ok).length / checks.length) * 100)}%
                  </p>
                  <p className="text-sm text-slate-600 mt-1">Health Score</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Data Integrity Checks */}
          {dataIntegrityChecks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-blue-600" />
                  Data Integrity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {dataIntegrityChecks.map((check: any, index: number) => (
                    <div
                      key={index}
                      className={`flex items-center justify-between rounded-lg border p-4 ${
                        check.ok
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-rose-200 bg-rose-50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {getCheckIcon(check.ok)}
                        <div>
                          <p className="font-semibold text-slate-900">{check.name}</p>
                          {check.count > 0 && !check.ok && (
                            <p className="text-sm text-rose-600 mt-1">
                              {check.count} issues found
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge variant={check.ok ? "secondary" : "destructive"}>
                        {check.ok ? "OK" : "Fix Needed"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* SLA Compliance Checks */}
          {slaChecks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-amber-600" />
                  SLA Compliance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {slaChecks.map((check: any, index: number) => (
                    <div
                      key={index}
                      className={`flex items-center justify-between rounded-lg border p-4 ${
                        check.ok
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-rose-200 bg-rose-50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {getCheckIcon(check.ok)}
                        <div>
                          <p className="font-semibold text-slate-900">{check.name}</p>
                          {check.count > 0 && (
                            <p className="text-sm text-slate-600 mt-1">
                              {check.count} {check.ok ? "compliant" : "breaches"}
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge variant={check.ok ? "secondary" : "destructive"}>
                        {check.ok ? "OK" : "Attention"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Notification Checks */}
          {notificationChecks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-purple-600" />
                  Notifications
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {notificationChecks.map((check: any, index: number) => (
                    <div
                      key={index}
                      className={`flex items-center justify-between rounded-lg border p-4 ${
                        check.ok
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-rose-200 bg-rose-50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {getCheckIcon(check.ok)}
                        <div>
                          <p className="font-semibold text-slate-900">{check.name}</p>
                          {check.count > 0 && (
                            <p className="text-sm text-slate-600 mt-1">
                              {check.count} {check.ok ? "delivered" : "pending/failed"}
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge variant={check.ok ? "secondary" : "destructive"}>
                        {check.ok ? "OK" : "Review"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Integration Checks */}
          {integrationChecks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-cyan-600" />
                  Integrations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {integrationChecks.map((check: any, index: number) => (
                    <div
                      key={index}
                      className={`flex items-center justify-between rounded-lg border p-4 ${
                        check.ok
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-rose-200 bg-rose-50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {getCheckIcon(check.ok)}
                        <div>
                          <p className="font-semibold text-slate-900">{check.name}</p>
                        </div>
                      </div>
                      <Badge variant={check.ok ? "secondary" : "destructive"}>
                        {check.ok ? "Connected" : "Disconnected"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Initial State */}
      {!health && !healthLoading && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-3 text-center">
              <Activity className="h-16 w-16 text-slate-300" />
              <p className="text-lg font-semibold text-slate-600">
                Run health checks to view system status
              </p>
              <p className="text-sm text-slate-500 max-w-md">
                Health checks monitor data integrity, SLA compliance, notifications, and integrations
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
