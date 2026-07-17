import { useMemo, useState } from "react";
import { Building2, CheckCircle2, IndianRupee, Plus, Save, Send, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { calculateBudgetLine, type BranchBudgetLineInput, useBranchBudgets } from "@/hooks/useBranchBudget";
import { hrmsApi } from "@/lib/hrmsApi";
import { useQuery } from "@tanstack/react-query";

const HEADS = [
  "Communication & Connectivity", "Contract Fees Facilities", "Electricity", "Fee & Subscription",
  "Hiring Charges", "Insurance Expenses", "Legal/Consultancy Charges", "Office Rent",
  "Office Maintenance A/c", "Printing & Stationery Expenses", "Repairs & Maintenance",
  "Security Service Charges", "Staff Welfare", "Staff Training & Recruitment", "Tours, Travelling & Conveyance",
];
const UNITS = ["Nos", "Seat", "User", "Month", "Candidate", "Service", "Sq. Ft.", "Connection", "Device", "Litre", "Unit"];
const GST_RATES = [0, 5, 12, 18, 28];

function periodNow() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
function fyFromPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  return month >= 4 ? `${year}-${String(year + 1).slice(-2)}` : `${year - 1}-${String(year).slice(-2)}`;
}
function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);
}
function blankLine(): BranchBudgetLineInput {
  return { head: "", subHead: "", itemName: "", quantity: 1, unit: "Nos", unitRate: 0, taxTreatment: "exclusive", gstRate: 18, gstType: "cgst_sgst", recoverableTaxPct: 100, allocationDriver: "agent_headcount", justification: "" };
}

export default function BranchBudgetManagementPage() {
  const [period, setPeriod] = useState(periodNow());
  const [branchId, setBranchId] = useState("");
  const [lines, setLines] = useState<BranchBudgetLineInput[]>([blankLine()]);
  const [savedBudgetId, setSavedBudgetId] = useState<string | null>(null);
  const { budgetsQuery, saveBudget, submitBudget } = useBranchBudgets({ period, branchId: branchId || undefined });

  const { data: branchResponse } = useQuery({ queryKey: ["budget-branches"], queryFn: () => hrmsApi.get<any>("/api/org/branches?limit=200") });
  const { data: processResponse } = useQuery({ queryKey: ["budget-processes"], queryFn: () => hrmsApi.get<any>("/api/org/processes?limit=500") });
  const { data: costCentreResponse } = useQuery({ queryKey: ["budget-cost-centres"], queryFn: () => hrmsApi.get<any>("/api/org/cost-centres?limit=500") });
  const branches = branchResponse?.data ?? branchResponse ?? [];
  const processes = (processResponse?.data ?? processResponse ?? []).filter((item: any) => !branchId || item.branch_id === branchId);
  const costCentres = (costCentreResponse?.data ?? costCentreResponse ?? []).filter((item: any) => !branchId || item.branch_id === branchId);

  const totals = useMemo(() => lines.reduce((acc, line) => {
    const value = calculateBudgetLine(line);
    acc.base += value.base; acc.tax += value.tax; acc.gross += value.gross; acc.pnl += value.pnlCost;
    return acc;
  }, { base: 0, tax: 0, gross: 0, pnl: 0 }), [lines]);

  const updateLine = (index: number, patch: Partial<BranchBudgetLineInput>) => setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  const removeLine = (index: number) => setLines((current) => current.length === 1 ? current : current.filter((_, i) => i !== index));

  async function save(submit = false) {
    try {
      if (!branchId) throw new Error("Select a branch before saving the budget.");
      for (const [index, line] of lines.entries()) {
        if (!line.head || !line.itemName || !line.unit || !line.justification) throw new Error(`Complete mandatory details in line ${index + 1}.`);
      }
      const result: any = await saveBudget.mutateAsync({ id: savedBudgetId || undefined, branchId, periodCode: period, financialYear: fyFromPeriod(period), lines });
      const id = result?.id ?? result?.data?.id ?? savedBudgetId;
      if (id) setSavedBudgetId(id);
      if (submit && id) await submitBudget.mutateAsync(id);
      toast.success(submit ? "Budget submitted to Branch Head." : "Budget draft saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Budget could not be saved.");
    }
  }

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.14),_transparent_26%),linear-gradient(180deg,_#f8fafc_0%,_#ffffff_44%,_#f5f7fb_100%)]">
        <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 text-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
            <div className="grid gap-8 p-6 lg:grid-cols-[1.5fr_0.8fr] lg:p-8">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200"><ShieldCheck className="h-3.5 w-3.5" />Branch Budget Control</div>
                <div><h1 className="text-3xl font-black tracking-tight sm:text-4xl">Build every branch budget at line-item depth before GRN consumption.</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">Quantity, unit rate, tax treatment, recoverable GST, process attribution and approval governance are captured in one finance workspace.</p></div>
                <div className="flex flex-wrap gap-3"><Button onClick={() => void save(false)} disabled={saveBudget.isPending}><Save className="mr-2 h-4 w-4" />Save draft</Button><Button variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={() => void save(true)} disabled={saveBudget.isPending || submitBudget.isPending}><Send className="mr-2 h-4 w-4" />Submit to Branch Head</Button></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                {[['Without tax', totals.base], ['Tax budget', totals.tax], ['With tax', totals.gross], ['P&L cost', totals.pnl]].map(([label, value]) => <Card key={String(label)} className="border-white/10 bg-white/5 text-white shadow-none"><CardContent className="p-4"><p className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</p><p className="mt-2 text-2xl font-black">{money(Number(value))}</p></CardContent></Card>)}
              </div>
            </div>
          </section>

          <Tabs defaultValue="create" className="space-y-5">
            <TabsList className="h-auto flex-wrap rounded-2xl bg-white p-1 shadow-sm"><TabsTrigger value="create">Create budget</TabsTrigger><TabsTrigger value="queue">Approval status</TabsTrigger></TabsList>
            <TabsContent value="create" className="space-y-5">
              <Card className="rounded-3xl border-slate-200 shadow-sm"><CardContent className="grid gap-4 p-5 md:grid-cols-3"><div className="space-y-2"><Label>Period</Label><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></div><div className="space-y-2"><Label>Branch</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">Select branch</option>{branches.map((branch: any) => <option key={branch.id} value={branch.id}>{branch.branch_name ?? branch.name}</option>)}</select></div><div className="space-y-2"><Label>Financial year</Label><Input value={fyFromPeriod(period)} readOnly /></div></CardContent></Card>

              <div className="space-y-4">{lines.map((line, index) => { const calc = calculateBudgetLine(line); return <Card key={index} className="rounded-3xl border-slate-200 shadow-sm"><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Budget line {index + 1}</CardTitle><Button variant="ghost" size="icon" onClick={() => removeLine(index)}><Trash2 className="h-4 w-4 text-rose-500" /></Button></CardHeader><CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2"><Label>Cost centre</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={line.costCentreId ?? ""} onChange={(e) => updateLine(index,{costCentreId:e.target.value || null})}><option value="">Branch/common</option>{costCentres.map((item:any)=><option key={item.id} value={item.id}>{item.cost_centre_name ?? item.name}</option>)}</select></div>
                <div className="space-y-2"><Label>Process</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={line.processId ?? ""} onChange={(e) => updateLine(index,{processId:e.target.value || null})}><option value="">Shared/all processes</option>{processes.map((item:any)=><option key={item.id} value={item.id}>{item.process_name ?? item.name}</option>)}</select></div>
                <div className="space-y-2"><Label>Head *</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={line.head} onChange={(e)=>updateLine(index,{head:e.target.value})}><option value="">Select head</option>{HEADS.map(head=><option key={head}>{head}</option>)}</select></div>
                <div className="space-y-2"><Label>Sub-head</Label><Input value={line.subHead ?? ""} onChange={(e)=>updateLine(index,{subHead:e.target.value})} /></div>
                <div className="space-y-2 xl:col-span-2"><Label>Item / service *</Label><Input value={line.itemName} onChange={(e)=>updateLine(index,{itemName:e.target.value})} placeholder="Example: Company-owned data connection" /></div>
                <div className="space-y-2"><Label>Quantity *</Label><Input type="number" min="0" step="0.01" value={line.quantity} onChange={(e)=>updateLine(index,{quantity:Number(e.target.value)})} /></div>
                <div className="space-y-2"><Label>Unit *</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={line.unit} onChange={(e)=>updateLine(index,{unit:e.target.value})}>{UNITS.map(unit=><option key={unit}>{unit}</option>)}</select></div>
                <div className="space-y-2"><Label>Unit rate *</Label><Input type="number" min="0" step="0.01" value={line.unitRate} onChange={(e)=>updateLine(index,{unitRate:Number(e.target.value)})} /></div>
                <div className="space-y-2"><Label>Tax treatment *</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={line.taxTreatment} onChange={(e)=>updateLine(index,{taxTreatment:e.target.value as any})}><option value="exclusive">Tax exclusive</option><option value="inclusive">Tax inclusive</option><option value="exempt">Exempt / no tax</option><option value="reverse_charge">Reverse charge</option><option value="non_gst">Non-GST</option></select></div>
                <div className="space-y-2"><Label>GST rate</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={line.gstRate} onChange={(e)=>updateLine(index,{gstRate:Number(e.target.value)})}>{GST_RATES.map(rate=><option key={rate} value={rate}>{rate}%</option>)}</select></div>
                <div className="space-y-2"><Label>GST type</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={line.gstType} onChange={(e)=>updateLine(index,{gstType:e.target.value as any})}><option value="cgst_sgst">CGST + SGST</option><option value="igst">IGST</option><option value="none">None</option></select></div>
                <div className="space-y-2"><Label>Recoverable GST %</Label><Input type="number" min="0" max="100" value={line.recoverableTaxPct} onChange={(e)=>updateLine(index,{recoverableTaxPct:Number(e.target.value)})} /></div>
                <div className="space-y-2"><Label>Allocation driver</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={line.allocationDriver ?? ""} onChange={(e)=>updateLine(index,{allocationDriver:e.target.value})}><option value="agent_headcount">Agent headcount</option><option value="total_manpower">Total manpower</option><option value="revenue_share">Revenue share</option><option value="seat_count">Seat count</option><option value="device_count">Device count</option><option value="floor_area">Floor area</option><option value="direct_tagging">Direct tagging</option></select></div>
                <div className="space-y-2 md:col-span-2 xl:col-span-4"><Label>Justification *</Label><Textarea value={line.justification} onChange={(e)=>updateLine(index,{justification:e.target.value})} placeholder="Business need, rate basis and supporting assumptions" /></div>
                <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Without tax</p><p className="font-bold">{money(calc.base)}</p></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Tax</p><p className="font-bold">{money(calc.tax)}</p></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-500">With tax</p><p className="font-bold">{money(calc.gross)}</p></div><div className="rounded-2xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">P&L cost</p><p className="font-bold text-emerald-900">{money(calc.pnlCost)}</p></div>
              </CardContent></Card>; })}</div>
              <Button variant="outline" className="w-full rounded-2xl border-dashed py-6" onClick={()=>setLines((current)=>[...current,blankLine()])}><Plus className="mr-2 h-4 w-4" />Add another budget line</Button>
            </TabsContent>
            <TabsContent value="queue"><Card className="rounded-3xl border-slate-200 shadow-sm"><CardHeader><CardTitle>Budget approval queue</CardTitle></CardHeader><CardContent className="space-y-3">{(budgetsQuery.data ?? []).map((budget) => <div key={budget.id} className="grid gap-3 rounded-2xl border border-slate-200 p-4 md:grid-cols-[1.2fr_1fr_1fr_auto]"><div><p className="font-semibold">{budget.budget_number}</p><p className="text-sm text-slate-500">{budget.branch_name} · {budget.period_code}</p></div><div><p className="text-xs text-slate-500">Budget with tax</p><p className="font-semibold">{money(Number(budget.gross_budget_amount))}</p></div><div><p className="text-xs text-slate-500">Consumed</p><p className="font-semibold">{money(Number(budget.consumed_amount))}</p></div><Badge className="self-center" variant="outline">{budget.status.replaceAll('_',' ')}</Badge></div>)}{!budgetsQuery.isLoading && !(budgetsQuery.data ?? []).length && <div className="py-12 text-center text-slate-500"><Building2 className="mx-auto mb-3 h-10 w-10" /><p>No budget found for this period.</p></div>}</CardContent></Card></TabsContent>
          </Tabs>
        </div>
      </div>
    </DashboardLayout>
  );
}
