import { useState, type ReactNode } from "react";
import {
  ArrowUpDown,
  CheckCircle2,
  Download,
  History,
  Laptop,
  Monitor,
  Package,
  Plus,
  Search,
  ShieldAlert,
  Smartphone,
  UserCheck,
  Wallet,
  X,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  format,
  isAfter,
  isBefore,
  isWithinInterval,
  parse,
  parseISO,
} from "date-fns";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AssetCard } from "@/components/assets/AssetCard";
import { DateRangeExportDialog } from "@/components/export/DateRangeExportDialog";

import {
  useAssetHistory,
  useAssets,
  useAssetStats,
  useAssignAsset,
  useCreateAsset,
  useDeleteAsset,
  useReturnAsset,
  useUpdateAsset,
  type Asset,
} from "@/hooks/useAssets";
import { useEmployees } from "@/hooks/useEmployees";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { usePagination } from "@/hooks/usePagination";
import { useSorting } from "@/hooks/useSorting";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu as SortDropdownMenu,
  DropdownMenuContent as SortDropdownMenuContent,
  DropdownMenuItem as SortDropdownMenuItem,
  DropdownMenuTrigger as SortDropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

interface AssetMetricCardProps {
  label: string;
  value: string | number;
  description: string;
  icon: ReactNode;
  tone: "sky" | "emerald" | "indigo" | "amber" | "slate";
}

const metricToneMap = {
  sky: {
    card: "border-sky-100 bg-gradient-to-br from-white via-white to-sky-50",
    icon: "bg-sky-50 text-sky-700 ring-sky-100",
  },
  emerald: {
    card: "border-emerald-100 bg-gradient-to-br from-white via-white to-emerald-50",
    icon: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  },
  indigo: {
    card: "border-indigo-100 bg-gradient-to-br from-white via-white to-indigo-50",
    icon: "bg-indigo-50 text-indigo-700 ring-indigo-100",
  },
  amber: {
    card: "border-amber-100 bg-gradient-to-br from-white via-white to-amber-50",
    icon: "bg-amber-50 text-amber-700 ring-amber-100",
  },
  slate: {
    card: "border-slate-200 bg-white",
    icon: "bg-slate-100 text-slate-700 ring-slate-200",
  },
};

const categoryOptions = [
  { value: "laptop", label: "Laptop" },
  { value: "monitor", label: "Monitor" },
  { value: "phone", label: "Phone" },
  { value: "accessory", label: "Accessory" },
];

const statusOptions = [
  { value: "available", label: "Available" },
  { value: "assigned", label: "Assigned" },
  { value: "maintenance", label: "Maintenance" },
  { value: "retired", label: "Retired" },
];

const AssetMetricCard = ({
  label,
  value,
  description,
  icon,
  tone,
}: AssetMetricCardProps) => {
  const style = metricToneMap[tone];

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${style.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {label}
          </p>

          <h3 className="mt-2 truncate text-2xl font-semibold tracking-tight text-slate-950">
            {value}
          </h3>
        </div>

        <div className={`rounded-xl p-2.5 ring-1 ${style.icon}`}>{icon}</div>
      </div>

      <p className="mt-3 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
};

const EmptyState = ({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) => {
  return (
    <Card className="border-dashed border-slate-200 bg-slate-50/70 shadow-none">
      <CardContent className="flex flex-col items-center justify-center py-14 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
          <Package className="h-7 w-7" />
        </div>

        <h3 className="text-base font-semibold text-slate-950">{title}</h3>

        <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
          {description}
        </p>

        {action && <div className="mt-5">{action}</div>}
      </CardContent>
    </Card>
  );
};

const parseAssetPurchaseDate = (purchaseDate?: string) => {
  if (!purchaseDate || purchaseDate === "Unknown") return null;

  const isoDate = parseISO(purchaseDate);
  if (!Number.isNaN(isoDate.getTime())) return isoDate;

  const formattedDate = parse(purchaseDate, "MMM d, yyyy", new Date());
  if (!Number.isNaN(formattedDate.getTime())) return formattedDate;

  return null;
};

const Assets = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);

  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [historyAssetId, setHistoryAssetId] = useState<string | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [assignmentNotes, setAssignmentNotes] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    category: "laptop",
    serial_number: "",
    purchase_date: "",
    purchase_cost: "",
    vendor: "",
    notes: "",
  });

  const { data: assets = [], isLoading } = useAssets();
  const { data: stats } = useAssetStats();
  const { data: employees = [] } = useEmployees();
  const { isAdminOrHR } = useIsAdminOrHR();

  const createAsset = useCreateAsset();
  const updateAsset = useUpdateAsset();
  const deleteAsset = useDeleteAsset();
  const assignAsset = useAssignAsset();
  const returnAsset = useReturnAsset();

  const { data: assetHistory = [], isLoading: isHistoryLoading } =
    useAssetHistory(historyAssetId);

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredAssets = assets.filter((asset) => {
    const matchesSearch =
      !normalizedSearch ||
      asset.name.toLowerCase().includes(normalizedSearch) ||
      asset.serialNumber.toLowerCase().includes(normalizedSearch) ||
      asset.type.toLowerCase().includes(normalizedSearch) ||
      asset.status.toLowerCase().includes(normalizedSearch) ||
      asset.assignedTo?.name.toLowerCase().includes(normalizedSearch);

    const matchesType = typeFilter === "all" || asset.type === typeFilter;
    const matchesStatus = statusFilter === "all" || asset.status === statusFilter;

    return matchesSearch && matchesType && matchesStatus;
  });

  const {
    sortedItems: sortedAssets,
    sortConfig,
    requestSort,
  } = useSorting<Asset>(filteredAssets);

  const sortOptions = [
    { key: "name", label: "Name" },
    { key: "type", label: "Type" },
    { key: "status", label: "Status" },
    { key: "cost", label: "Cost" },
  ] as const;

  const {
    paginatedItems: paginatedAssets,
    currentPage,
    totalPages,
    totalItems,
    setPage,
    setPageSize,
    pageSize,
    goToNextPage,
    goToPreviousPage,
    canGoNext,
    canGoPrevious,
  } = usePagination(sortedAssets, { initialPageSize: 12 });

  const availableAssets = assets.filter(
    (asset) => asset.status === "available"
  ).length;

  const assignedAssets = assets.filter(
    (asset) => asset.status === "assigned"
  ).length;

  const maintenanceAssets = assets.filter(
    (asset) => asset.status === "maintenance"
  ).length;

  const totalAssetValue = assets.reduce((sum, asset) => sum + (asset.cost || 0), 0);

  const formatCurrency = (amount: number) => {
    return `₹${amount.toLocaleString("en-IN")}`;
  };

  const filterByDateRange = (
    items: Asset[],
    startDate?: Date,
    endDate?: Date
  ) => {
    if (!startDate && !endDate) return items;

    return items.filter((asset) => {
      const purchaseDate = parseAssetPurchaseDate(asset.purchaseDate);

      if (!purchaseDate) return !startDate && !endDate;

      if (startDate && endDate) {
        return isWithinInterval(purchaseDate, {
          start: startDate,
          end: endDate,
        });
      }

      if (startDate) {
        return (
          isAfter(purchaseDate, startDate) ||
          purchaseDate.getTime() === startDate.getTime()
        );
      }

      if (endDate) {
        return (
          isBefore(purchaseDate, endDate) ||
          purchaseDate.getTime() === endDate.getTime()
        );
      }

      return true;
    });
  };

  const exportToCSV = (startDate?: Date, endDate?: Date) => {
    const dataToExport = filterByDateRange(sortedAssets, startDate, endDate);

    const headers = [
      "Name",
      "Category",
      "Serial Number",
      "Status",
      "Cost",
      "Purchase Date",
      "Assigned To",
    ];

    const csvContent = [
      headers.join(","),
      ...dataToExport.map((asset) =>
        [
          `"${asset.name}"`,
          `"${asset.type}"`,
          `"${asset.serialNumber}"`,
          `"${asset.status}"`,
          `"${asset.cost}"`,
          `"${asset.purchaseDate || ""}"`,
          `"${asset.assignedTo?.name || "Unassigned"}"`,
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");

    link.href = URL.createObjectURL(blob);

    const dateRange =
      startDate || endDate
        ? `-${startDate ? format(startDate, "yyyy-MM-dd") : "start"}-to-${
            endDate ? format(endDate, "yyyy-MM-dd") : "end"
          }`
        : "";

    link.download = `assets${dateRange}-${
      new Date().toISOString().split("T")[0]
    }.csv`;

    link.click();
    URL.revokeObjectURL(link.href);

    toast.success(`${dataToExport.length} assets exported to CSV`);
  };

  const exportToPDF = (startDate?: Date, endDate?: Date) => {
    const dataToExport = filterByDateRange(sortedAssets, startDate, endDate);

    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.text("Asset Inventory", 14, 22);
    doc.setFontSize(10);
    doc.text(`Generated on ${formatISTDate()}`, 14, 30);

    if (startDate || endDate) {
      doc.text(
        `Date Range: ${startDate ? format(startDate, "PP") : "Start"} - ${
          endDate ? format(endDate, "PP") : "End"
        }`,
        14,
        36
      );
      doc.text(`Total Assets: ${dataToExport.length}`, 14, 42);
    } else {
      doc.text(`Total Assets: ${dataToExport.length}`, 14, 36);
    }

    autoTable(doc, {
      startY: startDate || endDate ? 50 : 44,
      head: [["Name", "Category", "Serial Number", "Status", "Cost", "Assigned To"]],
      body: dataToExport.map((asset) => [
        asset.name,
        asset.type,
        asset.serialNumber,
        asset.status,
        formatCurrency(asset.cost),
        asset.assignedTo?.name || "Unassigned",
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 23, 42] },
    });

    const dateRange =
      startDate || endDate
        ? `-${startDate ? format(startDate, "yyyy-MM-dd") : "start"}-to-${
            endDate ? format(endDate, "yyyy-MM-dd") : "end"
          }`
        : "";

    doc.save(`assets${dateRange}-${new Date().toISOString().split("T")[0]}.pdf`);

    toast.success(`${dataToExport.length} assets exported to PDF`);
  };

  const resetForm = () => {
    setFormData({
      name: "",
      category: "laptop",
      serial_number: "",
      purchase_date: "",
      purchase_cost: "",
      vendor: "",
      notes: "",
    });
  };

  const handleAddAsset = () => {
    if (!formData.name.trim()) {
      toast.error("Asset name is required");
      return;
    }

    createAsset.mutate(
      {
        name: formData.name,
        category: formData.category,
        serial_number: formData.serial_number || undefined,
        purchase_date: formData.purchase_date || undefined,
        purchase_cost: formData.purchase_cost
          ? parseFloat(formData.purchase_cost)
          : undefined,
        vendor: formData.vendor || undefined,
        notes: formData.notes || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Asset added successfully");
          setIsAddDialogOpen(false);
          resetForm();
        },
        onError: () => {
          toast.error("Failed to add asset");
        },
      }
    );
  };

  const handleEditAsset = (asset: Asset) => {
    setSelectedAsset(asset);
    setFormData({
      name: asset.name,
      category: asset.type,
      serial_number: asset.serialNumber,
      purchase_date: "",
      purchase_cost: asset.cost.toString(),
      vendor: "",
      notes: asset.notes || "",
    });
    setIsEditDialogOpen(true);
  };

  const handleUpdateAsset = () => {
    if (!selectedAsset || !formData.name.trim()) {
      toast.error("Asset name is required");
      return;
    }

    updateAsset.mutate(
      {
        id: selectedAsset.id,
        name: formData.name,
        category: formData.category,
        serial_number: formData.serial_number || undefined,
        purchase_date: formData.purchase_date || undefined,
        purchase_cost: formData.purchase_cost
          ? parseFloat(formData.purchase_cost)
          : undefined,
        vendor: formData.vendor || undefined,
        notes: formData.notes || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Asset updated successfully");
          setIsEditDialogOpen(false);
          setSelectedAsset(null);
          resetForm();
        },
        onError: () => {
          toast.error("Failed to update asset");
        },
      }
    );
  };

  const handleDeleteAsset = (asset: Asset) => {
    setSelectedAsset(asset);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (!selectedAsset) return;

    deleteAsset.mutate(selectedAsset.id, {
      onSuccess: () => {
        toast.success("Asset deleted successfully");
        setIsDeleteDialogOpen(false);
        setSelectedAsset(null);
      },
      onError: () => {
        toast.error("Failed to delete asset");
      },
    });
  };

  const handleAssignAsset = (asset: Asset) => {
    setSelectedAsset(asset);
    setSelectedEmployeeId("");
    setAssignmentNotes("");
    setIsAssignDialogOpen(true);
  };

  const confirmAssign = () => {
    if (!selectedAsset || !selectedEmployeeId) {
      toast.error("Please select an employee");
      return;
    }

    assignAsset.mutate(
      {
        assetId: selectedAsset.id,
        employeeId: selectedEmployeeId,
        notes: assignmentNotes || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Asset assigned successfully");
          setIsAssignDialogOpen(false);
          setSelectedAsset(null);
          setSelectedEmployeeId("");
          setAssignmentNotes("");
        },
        onError: () => {
          toast.error("Failed to assign asset");
        },
      }
    );
  };

  const handleReturnAsset = (asset: Asset) => {
    returnAsset.mutate(asset.id, {
      onSuccess: () => {
        toast.success("Asset marked as returned");
      },
      onError: () => {
        toast.error("Failed to return asset");
      },
    });
  };

  const handleViewHistory = (asset: Asset) => {
    setSelectedAsset(asset);
    setHistoryAssetId(asset.id);
    setIsHistoryDialogOpen(true);
  };

  const assetMetrics = [
    {
      label: "Total Assets",
      value: stats?.total || 0,
      description: "Total assets in inventory.",
      icon: <Package className="h-5 w-5" />,
      tone: "sky" as const,
    },
    {
      label: "Available",
      value: availableAssets,
      description: "Assets ready for assignment.",
      icon: <CheckCircle2 className="h-5 w-5" />,
      tone: "emerald" as const,
    },
    {
      label: "Assigned",
      value: assignedAssets,
      description: "Assets currently assigned.",
      icon: <UserCheck className="h-5 w-5" />,
      tone: "indigo" as const,
    },
    {
      label: "Asset Value",
      value: formatCurrency(totalAssetValue),
      description: "Total recorded purchase value.",
      icon: <Wallet className="h-5 w-5" />,
      tone: "amber" as const,
    },
  ];

  const categoryMetrics = [
    {
      label: "Laptops",
      value: stats?.laptops || 0,
      icon: <Laptop className="h-4 w-4" />,
    },
    {
      label: "Monitors",
      value: stats?.monitors || 0,
      icon: <Monitor className="h-4 w-4" />,
    },
    {
      label: "Phones",
      value: stats?.phones || 0,
      icon: <Smartphone className="h-4 w-4" />,
    },
    {
      label: "Maintenance",
      value: maintenanceAssets,
      icon: <ShieldAlert className="h-4 w-4" />,
    },
  ];

  const hasFilters =
    searchQuery.trim() || typeFilter !== "all" || statusFilter !== "all";

  if (!isAdminOrHR) {
    return (
      <DashboardLayout>
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-amber-100">
              <ShieldAlert className="h-7 w-7" />
            </div>

            <h2 className="text-xl font-semibold tracking-tight text-slate-950">
              Access Denied
            </h2>

            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
              You do not have permission to access asset management. Only
              administrators and HR personnel can manage company assets.
            </p>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Header */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-0 lg:grid-cols-[1fr_auto]">
            <div className="relative p-5 sm:p-6">
              <div className="absolute inset-y-0 left-0 w-1 bg-slate-950" />

              <div className="pl-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                  Asset Management
                </p>

                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                  Asset Inventory
                </h1>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  Track laptops, monitors, phones, accessories, assignments,
                  returns and asset history.
                </p>
              </div>
            </div>

            <div className="flex flex-col justify-center gap-3 border-t border-slate-200 bg-slate-50 p-5 sm:flex-row sm:items-center lg:border-l lg:border-t-0">
              <DateRangeExportDialog
                title="Export Asset Inventory"
                description="Export asset inventory with optional purchase date range filter."
                onExportCSV={exportToCSV}
                onExportPDF={exportToPDF}
              />

              <Button
                className="h-10 rounded-xl bg-slate-950 px-4 text-xs font-semibold text-white hover:bg-slate-800"
                onClick={() => {
                  resetForm();
                  setIsAddDialogOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Asset
              </Button>
            </div>
          </div>
        </section>

        {/* Main Metrics */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {isLoading ? (
            <>
              {[1, 2, 3, 4].map((item) => (
                <Skeleton key={item} className="h-32 rounded-2xl" />
              ))}
            </>
          ) : (
            <>
              {assetMetrics.map((metric) => (
                <AssetMetricCard
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  description={metric.description}
                  icon={metric.icon}
                  tone={metric.tone}
                />
              ))}
            </>
          )}
        </section>

        {/* Category Strip */}
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {categoryMetrics.map((metric) => (
            <div
              key={metric.label}
              className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-slate-100 p-2.5 text-slate-700">
                  {metric.icon}
                </div>

                <p className="text-sm font-semibold text-slate-950">
                  {metric.label}
                </p>
              </div>

              <span className="text-lg font-semibold text-slate-950">
                {metric.value}
              </span>
            </div>
          ))}
        </section>

        {/* Filters */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-slate-950">
                Inventory Controls
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Search, filter, sort and export company assets.
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
              <Download className="h-3.5 w-3.5 text-sky-700" />
              {filteredAssets.length} result
              {filteredAssets.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[1fr_190px_190px_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

              <Input
                placeholder="Search by asset name, serial number, status or assigned employee..."
                className="h-11 rounded-xl border-slate-200 bg-white pl-10 text-sm shadow-sm"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                <SelectValue placeholder="Type" />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {categoryOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <SortDropdownMenu>
              <SortDropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="h-11 rounded-xl border-slate-200 bg-white px-4 text-xs font-semibold shadow-sm"
                >
                  <ArrowUpDown className="mr-2 h-4 w-4" />
                  Sort:{" "}
                  {sortConfig.key
                    ? sortOptions.find((option) => option.key === sortConfig.key)
                        ?.label
                    : "None"}
                  {sortConfig.direction &&
                    (sortConfig.direction === "asc" ? " ↑" : " ↓")}
                </Button>
              </SortDropdownMenuTrigger>

              <SortDropdownMenuContent align="end">
                {sortOptions.map((option) => (
                  <SortDropdownMenuItem
                    key={option.key}
                    onClick={() => requestSort(option.key as keyof Asset)}
                    className={sortConfig.key === option.key ? "bg-accent" : ""}
                  >
                    {option.label}
                    {sortConfig.key === option.key && (
                      <span className="ml-2">
                        {sortConfig.direction === "asc" ? "↑" : "↓"}
                      </span>
                    )}
                  </SortDropdownMenuItem>
                ))}
              </SortDropdownMenuContent>
            </SortDropdownMenu>
          </div>

          {hasFilters && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {searchQuery.trim() && (
                <span className="rounded-full bg-indigo-50 px-3 py-1 font-medium text-indigo-700">
                  Search: {searchQuery}
                </span>
              )}

              {typeFilter !== "all" && (
                <span className="rounded-full bg-sky-50 px-3 py-1 font-medium text-sky-700">
                  Type: {typeFilter}
                </span>
              )}

              {statusFilter !== "all" && (
                <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
                  Status: {statusFilter}
                </span>
              )}

              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                onClick={() => {
                  setSearchQuery("");
                  setTypeFilter("all");
                  setStatusFilter("all");
                }}
              >
                <X className="h-3 w-3" />
                Clear Filters
              </button>
            </div>
          )}
        </section>

        {/* Asset Grid */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-slate-950">
                Asset List
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Assign, return, edit, delete and review assignment history.
              </p>
            </div>

            <Badge className="w-fit bg-slate-100 text-slate-700 hover:bg-slate-100">
              {totalItems} item{totalItems === 1 ? "" : "s"}
            </Badge>
          </div>

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((item) => (
                <Skeleton key={item} className="h-64 rounded-2xl" />
              ))}
            </div>
          ) : filteredAssets.length === 0 ? (
            <EmptyState
              title="No Assets Found"
              description={
                assets.length === 0
                  ? "Start by adding your first company asset."
                  : "No assets match your current search or filter criteria."
              }
              action={
                assets.length === 0 ? (
                  <Button
                    className="h-10 rounded-xl bg-slate-950 px-4 text-xs font-semibold text-white hover:bg-slate-800"
                    onClick={() => {
                      resetForm();
                      setIsAddDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Asset
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {paginatedAssets.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    onEdit={handleEditAsset}
                    onDelete={handleDeleteAsset}
                    onAssign={handleAssignAsset}
                    onReturn={handleReturnAsset}
                    onViewHistory={handleViewHistory}
                    showAdminActions={isAdminOrHR}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="mt-4 flex flex-col items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row">
                  <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500 sm:justify-start">
                    <span>Show</span>

                    <Select
                      value={pageSize.toString()}
                      onValueChange={(value) => setPageSize(Number(value))}
                    >
                      <SelectTrigger className="h-8 w-[74px] rounded-lg bg-white text-xs">
                        <SelectValue />
                      </SelectTrigger>

                      <SelectContent>
                        {[6, 12, 24, 48].map((size) => (
                          <SelectItem key={size} value={size.toString()}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <span>of {totalItems} assets</span>
                  </div>

                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() => canGoPrevious && goToPreviousPage()}
                          className={
                            !canGoPrevious
                              ? "pointer-events-none opacity-50"
                              : "cursor-pointer"
                          }
                        />
                      </PaginationItem>

                      {(() => {
                        const pages: (number | "ellipsis")[] = [];

                        if (totalPages <= 7) {
                          for (let i = 1; i <= totalPages; i++) pages.push(i);
                        } else {
                          pages.push(1);

                          if (currentPage > 3) pages.push("ellipsis");

                          for (
                            let i = Math.max(2, currentPage - 1);
                            i <= Math.min(totalPages - 1, currentPage + 1);
                            i++
                          ) {
                            pages.push(i);
                          }

                          if (currentPage < totalPages - 2) {
                            pages.push("ellipsis");
                          }

                          pages.push(totalPages);
                        }

                        return pages.map((page, index) =>
                          page === "ellipsis" ? (
                            <PaginationItem key={`ellipsis-${index}`}>
                              <PaginationEllipsis />
                            </PaginationItem>
                          ) : (
                            <PaginationItem key={page}>
                              <PaginationLink
                                onClick={() => setPage(page)}
                                isActive={currentPage === page}
                                className="cursor-pointer"
                              >
                                {page}
                              </PaginationLink>
                            </PaginationItem>
                          )
                        );
                      })()}

                      <PaginationItem>
                        <PaginationNext
                          onClick={() => canGoNext && goToNextPage()}
                          className={
                            !canGoNext
                              ? "pointer-events-none opacity-50"
                              : "cursor-pointer"
                          }
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </>
          )}
        </section>

        {/* Add Asset Dialog */}
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add New Asset</DialogTitle>
              <DialogDescription>
                Create a new company asset record.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="name">Asset Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(event) =>
                    setFormData({ ...formData, name: event.target.value })
                  }
                  placeholder="e.g., MacBook Pro 16"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) =>
                    setFormData({ ...formData, category: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    {categoryOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="serial_number">Serial Number</Label>
                <Input
                  id="serial_number"
                  value={formData.serial_number}
                  onChange={(event) =>
                    setFormData({
                      ...formData,
                      serial_number: event.target.value,
                    })
                  }
                  placeholder="e.g., ABC123XYZ"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="purchase_date">Purchase Date</Label>
                  <Input
                    id="purchase_date"
                    type="date"
                    value={formData.purchase_date}
                    onChange={(event) =>
                      setFormData({
                        ...formData,
                        purchase_date: event.target.value,
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="purchase_cost">Cost</Label>
                  <Input
                    id="purchase_cost"
                    type="number"
                    value={formData.purchase_cost}
                    onChange={(event) =>
                      setFormData({
                        ...formData,
                        purchase_cost: event.target.value,
                      })
                    }
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="vendor">Vendor</Label>
                <Input
                  id="vendor"
                  value={formData.vendor}
                  onChange={(event) =>
                    setFormData({ ...formData, vendor: event.target.value })
                  }
                  placeholder="e.g., Apple Store"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(event) =>
                    setFormData({ ...formData, notes: event.target.value })
                  }
                  placeholder="e.g., 16GB RAM, 512GB SSD, M3 Pro chip"
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => setIsAddDialogOpen(false)}
              >
                Cancel
              </Button>

              <Button
                className="rounded-xl bg-slate-950 text-white hover:bg-slate-800"
                onClick={handleAddAsset}
                disabled={createAsset.isPending}
              >
                {createAsset.isPending ? "Adding..." : "Add Asset"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Asset Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Asset</DialogTitle>
              <DialogDescription>
                Update the asset details below.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Asset Name *</Label>
                <Input
                  id="edit-name"
                  value={formData.name}
                  onChange={(event) =>
                    setFormData({ ...formData, name: event.target.value })
                  }
                  placeholder="e.g., MacBook Pro 16"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-category">Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) =>
                    setFormData({ ...formData, category: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    {categoryOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-serial_number">Serial Number</Label>
                <Input
                  id="edit-serial_number"
                  value={formData.serial_number}
                  onChange={(event) =>
                    setFormData({
                      ...formData,
                      serial_number: event.target.value,
                    })
                  }
                  placeholder="e.g., ABC123XYZ"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-purchase_date">Purchase Date</Label>
                  <Input
                    id="edit-purchase_date"
                    type="date"
                    value={formData.purchase_date}
                    onChange={(event) =>
                      setFormData({
                        ...formData,
                        purchase_date: event.target.value,
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-purchase_cost">Cost</Label>
                  <Input
                    id="edit-purchase_cost"
                    type="number"
                    value={formData.purchase_cost}
                    onChange={(event) =>
                      setFormData({
                        ...formData,
                        purchase_cost: event.target.value,
                      })
                    }
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-vendor">Vendor</Label>
                <Input
                  id="edit-vendor"
                  value={formData.vendor}
                  onChange={(event) =>
                    setFormData({ ...formData, vendor: event.target.value })
                  }
                  placeholder="e.g., Apple Store"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea
                  id="edit-notes"
                  value={formData.notes}
                  onChange={(event) =>
                    setFormData({ ...formData, notes: event.target.value })
                  }
                  placeholder="e.g., 16GB RAM, 512GB SSD, M3 Pro chip"
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => setIsEditDialogOpen(false)}
              >
                Cancel
              </Button>

              <Button
                className="rounded-xl bg-slate-950 text-white hover:bg-slate-800"
                onClick={handleUpdateAsset}
                disabled={updateAsset.isPending}
              >
                {updateAsset.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
        >
          <AlertDialogContent className="rounded-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Asset</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &quot;{selectedAsset?.name}
                &quot;? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>

              <AlertDialogAction
                onClick={confirmDelete}
                className="rounded-xl bg-amber-600 text-white hover:bg-amber-700"
              >
                {deleteAsset.isPending ? "Deleting..." : "Delete Asset"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Assign Asset Dialog */}
        <Dialog open={isAssignDialogOpen} onOpenChange={setIsAssignDialogOpen}>
          <DialogContent className="rounded-2xl sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Assign Asset</DialogTitle>
              <DialogDescription>
                Assign &quot;{selectedAsset?.name}&quot; to an employee.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="employee">Select Employee *</Label>
                <Select
                  value={selectedEmployeeId}
                  onValueChange={setSelectedEmployeeId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an employee" />
                  </SelectTrigger>

                  <SelectContent>
                    {employees
                      .filter((employee) => employee.status === "active")
                      .map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.name} - {employee.department}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="assign-notes">Notes optional</Label>
                <Textarea
                  id="assign-notes"
                  value={assignmentNotes}
                  onChange={(event) => setAssignmentNotes(event.target.value)}
                  placeholder="e.g., Assigned for project work"
                  rows={2}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => setIsAssignDialogOpen(false)}
              >
                Cancel
              </Button>

              <Button
                className="rounded-xl bg-slate-950 text-white hover:bg-slate-800"
                onClick={confirmAssign}
                disabled={assignAsset.isPending || !selectedEmployeeId}
              >
                {assignAsset.isPending ? "Assigning..." : "Assign Asset"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Assignment History Dialog */}
        <Dialog
          open={isHistoryDialogOpen}
          onOpenChange={(open) => {
            setIsHistoryDialogOpen(open);

            if (!open) {
              setHistoryAssetId(null);
              setSelectedAsset(null);
            }
          }}
        >
          <DialogContent className="rounded-2xl sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Assignment History</DialogTitle>
              <DialogDescription>
                History for &quot;{selectedAsset?.name}&quot;
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="max-h-[400px] pr-3">
              {isHistoryLoading ? (
                <div className="space-y-3 p-1">
                  {[1, 2, 3].map((item) => (
                    <Skeleton key={item} className="h-20 w-full rounded-xl" />
                  ))}
                </div>
              ) : assetHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                    <History className="h-6 w-6" />
                  </div>

                  <p className="text-sm font-medium text-slate-950">
                    No assignment history found
                  </p>
                </div>
              ) : (
                <div className="space-y-3 p-1">
                  {assetHistory.map((assignment, index) => (
                    <div
                      key={assignment.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar className="h-10 w-10 border border-slate-200">
                            <AvatarImage src={assignment.employee.avatar} />
                            <AvatarFallback className="bg-slate-950 text-xs font-semibold text-white">
                              {assignment.employee.name
                                .split(" ")
                                .map((name) => name[0])
                                .join("")}
                            </AvatarFallback>
                          </Avatar>

                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-950">
                              {assignment.employee.name}
                            </p>

                            <p className="mt-0.5 text-xs text-slate-500">
                              {assignment.assignedDate} —{" "}
                              {assignment.returnedDate || "Present"}
                            </p>
                          </div>
                        </div>

                        <Badge
                          className={
                            index === 0 && !assignment.returnedDate
                              ? "bg-sky-50 text-sky-700 hover:bg-sky-50"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-100"
                          }
                        >
                          {index === 0 && !assignment.returnedDate
                            ? "Current"
                            : "Returned"}
                        </Badge>
                      </div>

                      {assignment.notes && (
                        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
                          {assignment.notes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>

            <DialogFooter>
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => setIsHistoryDialogOpen(false)}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
};

export default Assets;