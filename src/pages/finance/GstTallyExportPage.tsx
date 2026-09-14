import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GstTallyExportPanel } from "@/components/finance/gst/GstTallyExportPanel";

/**
 * GST / Tally Export — its own page rather than a Client Billing tab: the audience (who
 * generates and files a return) is narrower than who can view an invoice, and the backend
 * already enforces that split (GST_WRITE_ROLES vs GST_READ_ROLES in gst-export.routes.ts).
 */
export default function GstTallyExportPage() {
  return (
    <DashboardLayout>
      <div className="grn-scope p-4 md:p-6">
        <GstTallyExportPanel />
      </div>
    </DashboardLayout>
  );
}
