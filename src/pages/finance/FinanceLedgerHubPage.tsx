// src/pages/finance/FinanceLedgerHubPage.tsx
//
// One page, one URL, for the whole Payment Voucher / double-entry ledger subject — owner
// request: 8 separate pages (Payment Vouchers, Vendor Payment Tracking, Bank Accounts, Ledger
// Heads, Bank Directory, Bank Ledger, Ledger Reports, Bank Reconciliation) covering one
// connected thing. Same shell pattern ProcessPerformanceV2Page.tsx already uses: one
// DashboardLayout, each tab's actual content pulled in as its own small component (the
// `*Content` exports each page's own file now provides) rather than one giant file — see each
// page's own file for its logic, this file only switches between them.
//
// "Payments" merges Payment Vouchers (every voucher, any source) and Vendor Payment Tracking
// (vendor dues + dispatch) into one tab with two sub-views, since both already open the exact
// same PaymentVoucherDrawer for the exact same payment_voucher rows.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PaymentVouchersContent } from "./PaymentVouchersPage";
import { VendorPaymentDispatchContent } from "./VendorPaymentDispatchPage";
import { CompanyBankAccountsContent } from "./CompanyBankAccountsPage";
import { LedgerHeadsContent } from "./LedgerHeadsPage";
import { BankDirectoryContent } from "./BankDirectoryPage";
import { BankLedgerReportContent } from "./BankLedgerReportPage";
import { LedgerReportsContent } from "./LedgerReportsPage";
import { BankReconciliationContent } from "./BankReconciliationPage";

const TABS = [
  { key: "payments", label: "Payments" },
  { key: "bank-accounts", label: "Bank Accounts" },
  { key: "bank-ledger", label: "Bank Ledger" },
  { key: "reconciliation", label: "Reconciliation" },
  { key: "ledger-reports", label: "Ledger Reports" },
  { key: "ledger-heads", label: "Ledger Heads" },
  { key: "bank-directory", label: "Bank Directory" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const PAYMENTS_SUBTABS = [
  { key: "vouchers", label: "All Vouchers" },
  { key: "dispatch", label: "Vendor Dues & Dispatch" },
] as const;
type PaymentsSubTabKey = (typeof PAYMENTS_SUBTABS)[number]["key"];

export default function FinanceLedgerHubPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "payments";
  const [paymentsSubTab, setPaymentsSubTab] = useState<PaymentsSubTabKey>("vouchers");

  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Finance Ledger</h1>
          <p className="text-sm text-slate-500">Payment vouchers, bank accounts and the general ledger — one place.</p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="cursor-pointer">{t.label}</TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="payments">
            <Tabs value={paymentsSubTab} onValueChange={(v) => setPaymentsSubTab(v as PaymentsSubTabKey)}>
              <TabsList>
                {PAYMENTS_SUBTABS.map((t) => (
                  <TabsTrigger key={t.key} value={t.key} className="cursor-pointer">{t.label}</TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="vouchers"><PaymentVouchersContent /></TabsContent>
              <TabsContent value="dispatch"><VendorPaymentDispatchContent /></TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="bank-accounts"><CompanyBankAccountsContent /></TabsContent>
          <TabsContent value="bank-ledger"><BankLedgerReportContent /></TabsContent>
          <TabsContent value="reconciliation"><BankReconciliationContent /></TabsContent>
          <TabsContent value="ledger-reports"><LedgerReportsContent /></TabsContent>
          <TabsContent value="ledger-heads"><LedgerHeadsContent /></TabsContent>
          <TabsContent value="bank-directory"><BankDirectoryContent /></TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
