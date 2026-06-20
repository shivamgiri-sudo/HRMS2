import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileCheck, Clock, Eye, RefreshCw } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UnverifiedDoc {
  id: string;
  employee_id: string;
  employee_code?: string;
  first_name?: string;
  last_name?: string;
  document_type?: string;
  document_name?: string;
  created_at?: string;
}

interface ExpiringDoc {
  id: string;
  employee_id: string;
  first_name?: string;
  last_name?: string;
  employee_code?: string;
  document_type?: string;
  document_name?: string;
  expiry_date?: string;
}

interface AccessLogEntry {
  id: string;
  document_id: string;
  accessed_by?: string;
  first_name?: string;
  last_name?: string;
  action_type?: string;
  ip_address?: string;
  accessed_at?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(dateStr);
  expiry.setHours(0, 0, 0, 0);
  return Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function DaysRemainingBadge({ expiryDate }: { expiryDate?: string }) {
  if (!expiryDate) return <span className="text-slate-400 text-xs">No expiry</span>;
  const days = daysUntil(expiryDate);
  if (days < 0) {
    return (
      <Badge variant="destructive" className="text-xs">
        Expired {Math.abs(days)}d ago
      </Badge>
    );
  }
  if (days < 7) {
    return (
      <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">
        {days}d remaining
      </Badge>
    );
  }
  if (days < 30) {
    return (
      <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
        {days}d remaining
      </Badge>
    );
  }
  return (
    <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
      {days}d remaining
    </Badge>
  );
}

function formatDate(str?: string): string {
  if (!str) return "—";
  try {
    return new Date(str).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return str;
  }
}

function fullName(row: { first_name?: string; last_name?: string }) {
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

// ── Tab types ─────────────────────────────────────────────────────────────────

type Tab = "pending" | "expiring" | "access-log";

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NativeDocumentVerification() {
  const [activeTab, setActiveTab] = useState<Tab>("pending");
  const [docIdInput, setDocIdInput] = useState("");
  const [selectedDocId, setSelectedDocId] = useState("");

  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // -- Queries -----------------------------------------------------------------

  const unverifiedQuery = useQuery({
    queryKey: ["docs-unverified"],
    queryFn: () =>
      hrmsApi
        .get<UnverifiedDoc[]>("/lifecycle/documents/unverified")
        .then((r) => r ?? []),
    enabled: activeTab === "pending",
  });

  const expiringQuery = useQuery({
    queryKey: ["docs-expiring"],
    queryFn: () =>
      hrmsApi
        .get<ExpiringDoc[]>("/lifecycle/documents/expiring?days=30")
        .then((r) => r ?? []),
    enabled: activeTab === "expiring",
  });

  const accessLogQuery = useQuery({
    queryKey: ["doc-access-log", selectedDocId],
    queryFn: () =>
      hrmsApi
        .get<AccessLogEntry[]>(
          `/lifecycle/documents/${selectedDocId}/access-log`
        )
        .then((r) => r ?? []),
    enabled: !!selectedDocId && activeTab === "access-log",
  });

  // -- Mutations ----------------------------------------------------------------

  const verifyMutation = useMutation({
    mutationFn: (docId: string) =>
      hrmsApi.post(`/api/lifecycle/documents/${docId}/verify`, {
        verifiedBy: user?.id ?? "",
        remarks: "Verified",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["docs-unverified"] });
      toast({ title: "Document verified successfully." });
    },
    onError: (err: any) => {
      toast({
        title: "Verification failed",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  // -- Render ------------------------------------------------------------------

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "pending", label: "Pending Verification", icon: <FileCheck className="h-4 w-4" /> },
    { key: "expiring", label: "Expiring Documents", icon: <Clock className="h-4 w-4" /> },
    { key: "access-log", label: "Access Log", icon: <Eye className="h-4 w-4" /> },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page header */}
        <div className="rounded-3xl bg-slate-950 p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[.22em] text-blue-300">
            HR Ops
          </p>
          <h1 className="mt-2 text-3xl font-black">Document Verification</h1>
          <p className="mt-2 text-sm text-slate-300">
            Review pending documents, track expiring files, and audit access logs.
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-2 border-b border-slate-200 pb-0">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={[
                "flex items-center gap-2 rounded-t-xl border border-b-0 px-5 py-2.5 text-sm font-semibold transition",
                activeTab === t.key
                  ? "border-slate-200 bg-white text-slate-900 shadow-sm"
                  : "border-transparent text-slate-500 hover:text-slate-700",
              ].join(" ")}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab: Pending Verification */}
        {activeTab === "pending" && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold">
                Unverified Documents
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  queryClient.invalidateQueries({ queryKey: ["docs-unverified"] })
                }
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {unverifiedQuery.isLoading && (
                <p className="text-sm text-slate-400 py-4 text-center">Loading…</p>
              )}
              {unverifiedQuery.isError && (
                <p className="text-sm text-red-500 py-4 text-center">
                  Failed to load documents.
                </p>
              )}
              {unverifiedQuery.data && (
                <Table className="smarthr-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Emp Code</TableHead>
                      <TableHead>Employee Name</TableHead>
                      <TableHead>Doc Type</TableHead>
                      <TableHead>Document Name</TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unverifiedQuery.data.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center text-slate-400 py-8"
                        >
                          No unverified documents.
                        </TableCell>
                      </TableRow>
                    )}
                    {unverifiedQuery.data.map((doc) => (
                      <TableRow key={doc.id} className="hover:bg-gray-50 transition-colors">
                        <TableCell className="font-mono text-xs">
                          {doc.employee_code ?? "—"}
                        </TableCell>
                        <TableCell>{fullName(doc)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">
                            {doc.document_type ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {doc.document_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {formatDate(doc.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            disabled={verifyMutation.isPending}
                            onClick={() => verifyMutation.mutate(doc.id)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            <FileCheck className="h-3.5 w-3.5 mr-1.5" />
                            Verify
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tab: Expiring Documents */}
        {activeTab === "expiring" && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold">
                Expiring within 30 Days
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  queryClient.invalidateQueries({ queryKey: ["docs-expiring"] })
                }
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {expiringQuery.isLoading && (
                <p className="text-sm text-slate-400 py-4 text-center">Loading…</p>
              )}
              {expiringQuery.isError && (
                <p className="text-sm text-red-500 py-4 text-center">
                  Failed to load expiring documents.
                </p>
              )}
              {expiringQuery.data && (
                <Table className="smarthr-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Doc Type</TableHead>
                      <TableHead>Document Name</TableHead>
                      <TableHead>Expiry Date</TableHead>
                      <TableHead>Days Remaining</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expiringQuery.data.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center text-slate-400 py-8"
                        >
                          No documents expiring within 30 days.
                        </TableCell>
                      </TableRow>
                    )}
                    {expiringQuery.data.map((doc) => (
                      <TableRow key={doc.id} className="hover:bg-gray-50 transition-colors">
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-sm">
                              {fullName(doc)}
                            </span>
                            {doc.employee_code && (
                              <span className="font-mono text-xs text-slate-400">
                                {doc.employee_code}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">
                            {doc.document_type ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {doc.document_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {formatDate(doc.expiry_date)}
                        </TableCell>
                        <TableCell>
                          <DaysRemainingBadge expiryDate={doc.expiry_date} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tab: Access Log */}
        {activeTab === "access-log" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Document Access Log
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Input
                  placeholder="Enter Document ID (UUID)…"
                  value={docIdInput}
                  onChange={(e) => setDocIdInput(e.target.value)}
                  className="max-w-sm font-mono text-sm"
                />
                <Button
                  variant="secondary"
                  onClick={() => setSelectedDocId(docIdInput.trim())}
                  disabled={!docIdInput.trim()}
                >
                  <Eye className="h-3.5 w-3.5 mr-1.5" />
                  Load Log
                </Button>
                {selectedDocId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedDocId("");
                      setDocIdInput("");
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>

              {selectedDocId && accessLogQuery.isLoading && (
                <p className="text-sm text-slate-400 py-4 text-center">Loading…</p>
              )}
              {selectedDocId && accessLogQuery.isError && (
                <p className="text-sm text-red-500 py-4 text-center">
                  Failed to load access log.
                </p>
              )}
              {selectedDocId && accessLogQuery.data && (
                <Table className="smarthr-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Accessed By</TableHead>
                      <TableHead>Action Type</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Accessed At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accessLogQuery.data.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="text-center text-slate-400 py-8"
                        >
                          No access log entries for this document.
                        </TableCell>
                      </TableRow>
                    )}
                    {accessLogQuery.data.map((entry) => (
                      <TableRow key={entry.id} className="hover:bg-gray-50 transition-colors">
                        <TableCell>
                          {entry.first_name || entry.last_name
                            ? fullName(entry)
                            : entry.accessed_by ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">
                            {entry.action_type ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-500">
                          {entry.ip_address ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {entry.accessed_at
                            ? new Date(entry.accessed_at).toLocaleString("en-IN")
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {!selectedDocId && (
                <p className="text-sm text-slate-400 py-8 text-center">
                  Enter a Document ID above to load its access log.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
