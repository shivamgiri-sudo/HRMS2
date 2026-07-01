import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Package } from "lucide-react";
import { useAssetReport } from "@/hooks/useAssetReport";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(amount);
}

function getStatusBadge(status: string) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    available: "default",
    assigned: "secondary",
    maintenance: "outline",
    retired: "destructive",
  };
  return <Badge variant={variants[status] || "outline"}>{status}</Badge>;
}

export function AssetInventoryReport() {
  const { data: report, isLoading, error } = useAssetReport();

  const exportToPDF = async () => {
    if (!report) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Header
    doc.setFontSize(20);
    doc.text("Asset Inventory Report", pageWidth / 2, 20, { align: "center" });

    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, 28, {
      align: "center",
    });

    // Summary statistics
    doc.setFontSize(14);
    doc.text("Summary", 14, 42);

    doc.setFontSize(10);
    doc.text(`Total Assets: ${report.totalAssets}`, 14, 52);
    doc.text(`Total Value: ${formatCurrency(report.totalValue)}`, 14, 58);

    // Status breakdown
    let yPos = 68;
    doc.text("By Status:", 14, yPos);
    yPos += 6;
    report.byStatus.forEach((item) => {
      doc.text(`  ${item.status}: ${item.count}`, 14, yPos);
      yPos += 5;
    });

    // Category breakdown
    yPos += 4;
    doc.text("By Category:", 14, yPos);
    yPos += 6;
    report.byCategory.forEach((item) => {
      doc.text(`  ${item.category}: ${item.count}`, 14, yPos);
      yPos += 5;
    });

    // Asset details table
    yPos += 10;
    doc.setFontSize(14);
    doc.text("Asset Details", 14, yPos);

    autoTable(doc, {
      startY: yPos + 6,
      head: [["Code", "Name", "Category", "Status", "Cost", "Assigned To"]],
      body: report.records.map((asset) => [
        asset.assetCode,
        asset.name,
        asset.category,
        asset.status,
        formatCurrency(asset.purchaseCost),
        asset.assignedTo,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [59, 130, 246] },
    });

    doc.save(`asset-inventory-report-${new Date().toISOString().split("T")[0]}.pdf`);
  };

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-destructive">Error loading asset report</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>Asset Inventory Report</CardTitle>
            <CardDescription>Complete inventory of all company assets</CardDescription>
          </div>
        </div>
        <Button onClick={exportToPDF} disabled={isLoading || !report}>
          <Download className="mr-2 h-4 w-4" />
          Export PDF
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
            <Skeleton className="h-64" />
          </div>
        ) : report ? (
          <div className="space-y-6">
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm text-muted-foreground">Total Assets</p>
                <p className="text-2xl font-bold">{report.totalAssets}</p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm text-muted-foreground">Total Value</p>
                <p className="text-2xl font-bold">{formatCurrency(report.totalValue)}</p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm text-muted-foreground">Available</p>
                <p className="text-2xl font-bold">
                  {report.byStatus.find((s) => s.status === "available")?.count || 0}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm text-muted-foreground">Assigned</p>
                <p className="text-2xl font-bold">
                  {report.byStatus.find((s) => s.status === "assigned")?.count || 0}
                </p>
              </div>
            </div>

            {/* Asset table */}
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>Assigned To</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.records.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No assets found
                      </TableCell>
                    </TableRow>
                  ) : (
                    report.records.map((asset) => (
                      <TableRow key={asset.id}>
                        <TableCell className="font-medium">{asset.assetCode}</TableCell>
                        <TableCell>{asset.name}</TableCell>
                        <TableCell>{asset.category}</TableCell>
                        <TableCell>{getStatusBadge(asset.status)}</TableCell>
                        <TableCell>{formatCurrency(asset.purchaseCost)}</TableCell>
                        <TableCell>{asset.assignedTo}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
