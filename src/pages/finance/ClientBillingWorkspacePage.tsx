/**
 * Client Billing workspace (/finance/client-billing) — STUB.
 *
 * This file exists so the route wired in Task 1 (src/config/routes/finance.routes.tsx)
 * resolves at build time: the plan (docs/superpowers/plans/2026-08-19-client-billing-frontend.md,
 * Task 2's own Interfaces note) explicitly anticipates Task 1 running before Task 2 and says
 * Task 1's route import needs "a stub or, if done in dependency order, the actual first
 * version". This is that stub — Task 2 replaces its body with the real 3-tab
 * Proformas/Invoices/Credit Notes workspace described in
 * docs/superpowers/specs/2026-08-19-client-billing-frontend-design.md, built on top of
 * src/lib/clientBillingApi.ts.
 */
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ClientBillingWorkspacePage() {
  return (
    <DashboardLayout>
      <div className="space-y-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Client Billing</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              The Client Billing workspace (Proformas, Invoices, Credit Notes) is being built.
              This page is reachable and gated by <code>FINANCE_CLIENT_BILLING</code>, but its
              UI has not shipped yet.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
