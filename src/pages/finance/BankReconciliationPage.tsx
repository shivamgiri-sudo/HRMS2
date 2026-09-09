// src/pages/finance/BankReconciliationPage.tsx
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Upload, CheckCircle2, XCircle, RotateCcw, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";

type BankAccount = { id: string; account_name: string };
type PayableAccount = { id: string; account_name: string };

type Period = {
  id: string;
  bank_account_id: string;
  from_date: string;
  to_date: string;
  status: "open" | "closed";
  opening_balance: string | number;
  statement_closing_balance: string | number | null;
  computed_closing_balance: string | number | null;
  outstanding_total: string | number | null;
  closed_by: string | null;
  closed_at: string | null;
  reopened_by: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
};

type StatementLine = {
  id: string;
  txn_date: string;
  description: string;
  reference: string | null;
  debit_amount: string | number;
  credit_amount: string | number;
  match_status: "unmatched" | "matched" | "adjusted";
};

type LedgerCandidate = {
  id: string;
  entry_date: string;
  debit_amount: string | number;
  credit_amount: string | number;
  narration: string;
};

function money(value: unknown) {
  const n = Number(value ?? 0);
  if (n === 0) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function dayAfter(dateStr: string): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function BankReconciliationPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [bankAccountId, setBankAccountId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [newPeriodOpen, setNewPeriodOpen] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [amountMode, setAmountMode] = useState<"pair" | "single">("pair");

  const [matchLine, setMatchLine] = useState<StatementLine | null>(null);
  const [pickedCandidate, setPickedCandidate] = useState("");
  const [adjustLine, setAdjustLine] = useState<StatementLine | null>(null);
  const [adjustPayableId, setAdjustPayableId] = useState("");
  const [adjustNarration, setAdjustNarration] = useState("");
  const [statementClosingBalance, setStatementClosingBalance] = useState("");

  const [historyPeriod, setHistoryPeriod] = useState<Period | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ["bank-reconciliation-accounts"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: BankAccount[] }>("/api/finance/bank-accounts")).data ?? [],
  });

  const payableAccountsQuery = useQuery({
    queryKey: ["payable-accounts"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: PayableAccount[] }>("/api/finance/payable-accounts")).data ?? [],
  });

  const periodsQuery = useQuery({
    queryKey: ["bank-reconciliation-periods", bankAccountId],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: Period[] }>(`/api/finance/bank-reconciliation/periods?bankAccountId=${bankAccountId}`)).data ?? [],
    enabled: !!bankAccountId,
  });

  const periods = periodsQuery.data ?? [];
  const openPeriod = periods.find((p) => p.status === "open");
  const closedPeriods = periods.filter((p) => p.status === "closed").sort((a, b) => b.to_date.localeCompare(a.to_date));
  const activePeriod = periods.find((p) => p.id === periodId) ?? openPeriod ?? null;

  const linesQuery = useQuery({
    queryKey: ["bank-reconciliation-lines", activePeriod?.id],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: StatementLine[] }>(`/api/finance/bank-reconciliation/periods/${activePeriod!.id}/statement-lines`)).data ?? [],
    enabled: !!activePeriod,
  });
  const statementLines = linesQuery.data ?? [];
  const refetchLines = () => qc.invalidateQueries({ queryKey: ["bank-reconciliation-lines", activePeriod?.id] });

  const candidatesQuery = useQuery({
    queryKey: ["bank-reconciliation-candidates", matchLine?.id],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: LedgerCandidate[] }>(`/api/finance/bank-reconciliation/statement-lines/${matchLine!.id}/candidates`)).data ?? [],
    enabled: !!matchLine,
  });

  const createPeriodMutation = useMutation({
    mutationFn: () => hrmsApi.post("/api/finance/bank-reconciliation/periods", { bankAccountId, fromDate: newFrom, toDate: newTo }),
    onSuccess: (res: any) => {
      setNewPeriodOpen(false);
      setPeriodId(res.data.id);
      qc.invalidateQueries({ queryKey: ["bank-reconciliation-periods", bankAccountId] });
      toast({ title: "Period started" });
    },
    onError: (e: any) => toast({ title: "Couldn't start period", description: e.message, variant: "destructive" }),
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("file", file!);
      form.append("bankAccountId", bankAccountId);
      const finalMapping = amountMode === "single"
        ? { date: mapping.date, description: mapping.description, reference: mapping.reference || undefined, amount: mapping.amount }
        : { date: mapping.date, description: mapping.description, reference: mapping.reference || undefined, debit: mapping.debit, credit: mapping.credit };
      form.append("columnMapping", JSON.stringify(finalMapping));
      return hrmsApi.postForm<{ success: boolean; data: { importId: string; rowCount: number; matchedCount: number; unmatchedCount: number } }>(
        `/api/finance/bank-reconciliation/periods/${activePeriod!.id}/statements`, form,
      );
    },
    onSuccess: (res) => {
      toast({ title: `${res.data.matchedCount} of ${res.data.rowCount} auto-matched`, description: `${res.data.unmatchedCount} left to resolve manually.` });
      setFile(null); setHeaders(null); setMapping({});
      refetchLines();
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("file", file!);
      return hrmsApi.postForm<{ success: boolean; data: { headers: string[] } }>("/api/finance/bank-reconciliation/statement-preview", form);
    },
    onSuccess: (res) => setHeaders(res.data.headers),
    onError: (e: any) => toast({ title: "Couldn't read the file", description: e.message, variant: "destructive" }),
  });

  const matchMutation = useMutation({
    mutationFn: () => hrmsApi.post(`/api/finance/bank-reconciliation/statement-lines/${matchLine!.id}/match`, { ledgerEntryId: pickedCandidate }),
    onSuccess: () => {
      refetchLines();
      setMatchLine(null); setPickedCandidate("");
      toast({ title: "Matched" });
    },
    onError: (e: any) => toast({ title: "Couldn't match", description: e.message, variant: "destructive" }),
  });

  const unmatchMutation = useMutation({
    mutationFn: (lineId: string) => hrmsApi.post(`/api/finance/bank-reconciliation/statement-lines/${lineId}/unmatch`, {}),
    onSuccess: () => {
      refetchLines();
      toast({ title: "Unmatched" });
    },
    onError: (e: any) => toast({ title: "Couldn't unmatch", description: e.message, variant: "destructive" }),
  });

  const adjustMutation = useMutation({
    mutationFn: () => hrmsApi.post(`/api/finance/bank-reconciliation/statement-lines/${adjustLine!.id}/adjustment`, {
      bankAccountId, payableAccountId: adjustPayableId, narration: adjustNarration,
    }),
    onSuccess: () => {
      refetchLines();
      setAdjustLine(null); setAdjustPayableId(""); setAdjustNarration("");
      toast({ title: "Adjustment posted" });
    },
    onError: (e: any) => toast({ title: "Couldn't post adjustment", description: e.message, variant: "destructive" }),
  });

  const closeMutation = useMutation({
    mutationFn: () => hrmsApi.post(`/api/finance/bank-reconciliation/periods/${activePeriod!.id}/close`, { statementClosingBalance: Number(statementClosingBalance) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bank-reconciliation-periods", bankAccountId] });
      setPeriodId("");
      toast({ title: "Period closed" });
    },
    onError: (e: any) => toast({ title: "Can't close yet", description: e.message, variant: "destructive" }),
  });

  const reopenMutation = useMutation({
    mutationFn: () => hrmsApi.post(`/api/finance/bank-reconciliation/periods/${historyPeriod!.id}/reopen`, { reason: reopenReason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bank-reconciliation-periods", bankAccountId] });
      setHistoryPeriod(null); setReopenReason(""); setReopenConfirmOpen(false);
      toast({ title: "Period reopened" });
    },
    onError: (e: any) => toast({ title: "Couldn't reopen", description: e.message, variant: "destructive" }),
  });

  const unmatchedLines = statementLines.filter((l) => l.match_status === "unmatched");
  const resolvedCount = statementLines.length - unmatchedLines.length;
  const canClose = statementLines.length > 0 && unmatchedLines.length === 0 && statementClosingBalance !== "";
  const mostRecentClosed = closedPeriods[0];

  const startNewPeriodDefaultFrom = useMemo(() => {
    if (closedPeriods.length === 0) return "";
    return dayAfter(closedPeriods[0].to_date);
  }, [closedPeriods]);

  return (
    <div className="space-y-6 p-6">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-r from-blue-700 to-blue-500 p-6 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <Landmark className="h-7 w-7" />
          <div>
            <h1 className="text-xl font-bold">Bank Reconciliation</h1>
            <p className="text-sm text-blue-100">Match released vouchers against the real bank statement, post adjustments, and close periods.</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Bank Account</Label>
            <Select value={bankAccountId} onValueChange={(v) => { setBankAccountId(v); setPeriodId(""); }}>
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {(accountsQuery.data ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Period</Label>
            {openPeriod ? (
              <div className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm">
                <Badge className="bg-amber-100 text-amber-800">Open</Badge>
                {fmtDate(openPeriod.from_date)} – {fmtDate(openPeriod.to_date)}
              </div>
            ) : (
              <Button variant="outline" disabled={!bankAccountId} className="cursor-pointer" onClick={() => { setNewFrom(startNewPeriodDefaultFrom); setNewPeriodOpen(true); }}>
                Start New Period
              </Button>
            )}
          </div>
        </div>
      </div>

      {activePeriod && activePeriod.status === "open" && (
        <Tabs defaultValue="workspace">
          <TabsList>
            <TabsTrigger value="workspace" className="cursor-pointer">Reconcile</TabsTrigger>
            <TabsTrigger value="history" className="cursor-pointer">History</TabsTrigger>
          </TabsList>

          <TabsContent value="workspace" className="space-y-6">
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <Label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-400">Upload Bank Statement</Label>
              <div className="flex flex-wrap items-center gap-3">
                <Input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setHeaders(null); }} className="max-w-xs" />
                <Button variant="outline" className="cursor-pointer" disabled={!file || previewMutation.isPending} onClick={() => previewMutation.mutate()}>
                  Read Columns
                </Button>
              </div>

              {headers && (
                <div className="mt-4 space-y-3 rounded-lg border bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-700">Map columns</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <Label className="mb-1 block text-xs text-slate-500">Date</Label>
                      <Select value={mapping.date ?? ""} onValueChange={(v) => setMapping((m) => ({ ...m, date: v }))}>
                        <SelectTrigger><SelectValue placeholder="Column" /></SelectTrigger>
                        <SelectContent>{headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="mb-1 block text-xs text-slate-500">Description</Label>
                      <Select value={mapping.description ?? ""} onValueChange={(v) => setMapping((m) => ({ ...m, description: v }))}>
                        <SelectTrigger><SelectValue placeholder="Column" /></SelectTrigger>
                        <SelectContent>{headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="mb-1 block text-xs text-slate-500">Reference (optional)</Label>
                      <Select value={mapping.reference ?? ""} onValueChange={(v) => setMapping((m) => ({ ...m, reference: v }))}>
                        <SelectTrigger><SelectValue placeholder="Column" /></SelectTrigger>
                        <SelectContent>{headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label className="mb-1 block text-xs text-slate-500">Amount layout</Label>
                    <Select value={amountMode} onValueChange={(v: "pair" | "single") => setAmountMode(v)}>
                      <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pair">Separate Debit / Credit columns</SelectItem>
                        <SelectItem value="single">Single signed Amount column</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {amountMode === "pair" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="mb-1 block text-xs text-slate-500">Debit</Label>
                        <Select value={mapping.debit ?? ""} onValueChange={(v) => setMapping((m) => ({ ...m, debit: v }))}>
                          <SelectTrigger><SelectValue placeholder="Column" /></SelectTrigger>
                          <SelectContent>{headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="mb-1 block text-xs text-slate-500">Credit</Label>
                        <Select value={mapping.credit ?? ""} onValueChange={(v) => setMapping((m) => ({ ...m, credit: v }))}>
                          <SelectTrigger><SelectValue placeholder="Column" /></SelectTrigger>
                          <SelectContent>{headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Label className="mb-1 block text-xs text-slate-500">Amount</Label>
                      <Select value={mapping.amount ?? ""} onValueChange={(v) => setMapping((m) => ({ ...m, amount: v }))}>
                        <SelectTrigger className="max-w-xs"><SelectValue placeholder="Column" /></SelectTrigger>
                        <SelectContent>{headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                  <Button className="cursor-pointer" disabled={uploadMutation.isPending} onClick={() => uploadMutation.mutate()}>
                    <Upload className="mr-1.5 h-4 w-4" /> Upload &amp; Auto-Match
                  </Button>
                </div>
              )}
            </div>

            {statementLines.length > 0 && (
              <>
                <div className="rounded-2xl border bg-white shadow-sm">
                  <div className="border-b px-4 py-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      Unmatched Statement Lines ({unmatchedLines.length} of {statementLines.length}, {resolvedCount} resolved)
                    </p>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unmatchedLines.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center text-sm text-slate-400">All lines resolved</TableCell></TableRow>
                      )}
                      {unmatchedLines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell>{fmtDate(line.txn_date)}</TableCell>
                          <TableCell>{line.description}</TableCell>
                          <TableCell>{line.reference ?? "—"}</TableCell>
                          <TableCell className="text-right">{money(line.debit_amount)}</TableCell>
                          <TableCell className="text-right">{money(line.credit_amount)}</TableCell>
                          <TableCell className="space-x-2">
                            <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => setMatchLine(line)}>Match</Button>
                            <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => setAdjustLine(line)}>Post Adjustment</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {resolvedCount > 0 && (
                  <div className="rounded-2xl border bg-white shadow-sm">
                    <div className="border-b px-4 py-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Resolved Lines ({resolvedCount})</p>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {statementLines.filter((l) => l.match_status !== "unmatched").map((line) => (
                          <TableRow key={line.id}>
                            <TableCell>{fmtDate(line.txn_date)}</TableCell>
                            <TableCell>{line.description}</TableCell>
                            <TableCell className="text-right">{money(line.debit_amount) !== "—" ? money(line.debit_amount) : money(line.credit_amount)}</TableCell>
                            <TableCell>
                              <Badge className={line.match_status === "matched" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}>
                                {line.match_status === "matched" ? "Matched" : "Adjustment"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {line.match_status === "matched" && (
                                <Button size="sm" variant="outline" className="cursor-pointer" disabled={unmatchMutation.isPending} onClick={() => unmatchMutation.mutate(line.id)}>
                                  Unmatch
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                  <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Reconciliation Summary</p>
                  <div className="grid gap-4 sm:grid-cols-4">
                    <div>
                      <Label className="mb-1 block text-xs text-slate-500">Statement Closing Balance</Label>
                      <Input type="number" value={statementClosingBalance} onChange={(e) => setStatementClosingBalance(e.target.value)} placeholder="From the bank statement" />
                    </div>
                    <div>
                      <Label className="mb-1 block text-xs text-slate-500">Resolved lines</Label>
                      <p className="pt-2 text-sm font-semibold">{resolvedCount} / {statementLines.length}</p>
                    </div>
                    <div className="sm:col-span-2 flex items-end justify-end">
                      <Button className="cursor-pointer" disabled={!canClose || closeMutation.isPending} onClick={() => closeMutation.mutate()}>
                        <Lock className="mr-1.5 h-4 w-4" /> Close Period
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="history">
            <PeriodHistoryTable periods={periods} onOpen={setHistoryPeriod} />
          </TabsContent>
        </Tabs>
      )}

      {activePeriod && activePeriod.status !== "open" && (
        <PeriodHistoryTable periods={periods} onOpen={setHistoryPeriod} />
      )}

      {bankAccountId && periods.length > 0 && !activePeriod && (
        <PeriodHistoryTable periods={periods} onOpen={setHistoryPeriod} />
      )}

      {/* Start New Period dialog */}
      <Dialog open={newPeriodOpen} onOpenChange={setNewPeriodOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Start New Reconciliation Period</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="mb-1 block text-xs text-slate-500">From</Label>
              <Input type="date" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-slate-500">To</Label>
              <Input type="date" value={newTo} onChange={(e) => setNewTo(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button className="cursor-pointer" disabled={!newFrom || !newTo || createPeriodMutation.isPending} onClick={() => createPeriodMutation.mutate()}>Start</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Match candidate picker */}
      <Dialog open={!!matchLine} onOpenChange={(open) => !open && setMatchLine(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Match Statement Line</DialogTitle></DialogHeader>
          {matchLine && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">{matchLine.description} — {money(matchLine.debit_amount) !== "—" ? money(matchLine.debit_amount) : money(matchLine.credit_amount)}</p>
              <Select value={pickedCandidate} onValueChange={setPickedCandidate}>
                <SelectTrigger><SelectValue placeholder="Pick the matching ledger entry" /></SelectTrigger>
                <SelectContent>
                  {(candidatesQuery.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{fmtDate(c.entry_date)} — {c.narration}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(candidatesQuery.data ?? []).length === 0 && !candidatesQuery.isLoading && (
                <p className="text-xs text-slate-400">No unmatched ledger entries with this exact amount on this account.</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button className="cursor-pointer" disabled={!pickedCandidate || matchMutation.isPending} onClick={() => matchMutation.mutate()}>Confirm Match</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjustment dialog */}
      <Dialog open={!!adjustLine} onOpenChange={(open) => !open && setAdjustLine(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Post as Adjustment</DialogTitle></DialogHeader>
          {adjustLine && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">{adjustLine.description}</p>
              <div>
                <Label className="mb-1 block text-xs text-slate-500">Ledger Head</Label>
                <Select value={adjustPayableId} onValueChange={setAdjustPayableId}>
                  <SelectTrigger><SelectValue placeholder="Select ledger head" /></SelectTrigger>
                  <SelectContent>
                    {(payableAccountsQuery.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.account_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block text-xs text-slate-500">Narration</Label>
                <Input value={adjustNarration} onChange={(e) => setAdjustNarration(e.target.value)} placeholder="e.g. Bank charges per statement" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button className="cursor-pointer" disabled={!adjustPayableId || !adjustNarration || adjustMutation.isPending} onClick={() => adjustMutation.mutate()}>Post Adjustment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History drill-down drawer */}
      <Sheet open={!!historyPeriod} onOpenChange={(open) => !open && setHistoryPeriod(null)}>
        <SheetContent className="max-w-2xl overflow-y-auto">
          {historyPeriod && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {fmtDate(historyPeriod.from_date)} – {fmtDate(historyPeriod.to_date)}
                  <Badge className={historyPeriod.status === "closed" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
                    {historyPeriod.status}
                  </Badge>
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <Section label="Balances">
                  <Field label="Opening Balance" value={money(historyPeriod.opening_balance)} />
                  <Field label="Statement Closing Balance" value={money(historyPeriod.statement_closing_balance)} />
                  <Field label="Computed Closing Balance" value={money(historyPeriod.computed_closing_balance)} />
                  <Field label="Outstanding Total" value={money(historyPeriod.outstanding_total)} />
                </Section>
                <Section label="Close / Reopen Audit">
                  <Field label="Closed By" value={historyPeriod.closed_by ?? "None"} />
                  <Field label="Closed At" value={fmtDate(historyPeriod.closed_at)} />
                  <Field label="Last Reopened At" value={fmtDate(historyPeriod.reopened_at)} />
                  <Field label="Reopen Reason" value={historyPeriod.reopen_reason ?? "None"} />
                </Section>
                {historyPeriod.status === "closed" && mostRecentClosed?.id === historyPeriod.id && (
                  <Button variant="outline" className="cursor-pointer" onClick={() => setReopenConfirmOpen(true)}>
                    <RotateCcw className="mr-1.5 h-4 w-4" /> Reopen This Period
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={reopenConfirmOpen} onOpenChange={setReopenConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reopen this period?</AlertDialogTitle>
            <AlertDialogDescription>This unlocks its ledger entries and the Tally export for this range goes back to provisional. A reason is required.</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Why are you reopening this period?" />
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <AlertDialogAction className="cursor-pointer" disabled={!reopenReason.trim() || reopenMutation.isPending} onClick={() => reopenMutation.mutate()}>
              Reopen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="grid grid-cols-2 gap-3 rounded-lg border bg-slate-50 p-3">{children}</div>
    </div>
  );
}
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

function PeriodHistoryTable({ periods, onOpen }: { periods: Period[]; onOpen: (p: Period) => void }) {
  if (periods.length === 0) {
    return <div className="rounded-2xl border bg-white p-8 text-center text-sm text-slate-400 shadow-sm">No reconciliation periods yet for this account.</div>;
  }
  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Closing Balance</TableHead>
            <TableHead>Closed By</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {periods.map((p) => (
            <TableRow key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(p)}>
              <TableCell>{fmtDate(p.from_date)} – {fmtDate(p.to_date)}</TableCell>
              <TableCell>
                {p.status === "closed"
                  ? <Badge className="bg-emerald-100 text-emerald-800"><CheckCircle2 className="mr-1 h-3 w-3" />Closed</Badge>
                  : <Badge className="bg-amber-100 text-amber-800"><XCircle className="mr-1 h-3 w-3" />Open</Badge>}
              </TableCell>
              <TableCell className="text-right">{money(p.statement_closing_balance)}</TableCell>
              <TableCell>{p.closed_by ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
