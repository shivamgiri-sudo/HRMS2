import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertCircle, CheckCircle2, FilePlus, IndianRupee, Loader2, Save, Send, Upload, X } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { calculateBudgetLine } from "@/hooks/useBranchBudget";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function currentPeriod() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`; }
function currentFy() { const now = new Date(); const y=now.getFullYear(); return now.getMonth()+1>=4?`${y}-${String(y+1).slice(2)}`:`${y-1}-${String(y).slice(2)}`; }
function money(value: number) { return new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(value||0); }

export function BudgetLinkedGrnForm() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form,setForm]=useState({grnType:"vendor",branchId:"",budgetLineId:"",vendorId:"",vendorName:"",quantity:1,unitRate:0,billDate:"",paymentTermsDays:30,remarks:"",financialYear:currentFy()});
  const [file,setFile]=useState<File|null>(null);
  const [created,setCreated]=useState<{id:string;grnNumber:string}|null>(null);
  const period=form.billDate?form.billDate.slice(0,7):currentPeriod();

  const {data:branchResponse}=useQuery({queryKey:["grn-budget-branches"],queryFn:()=>hrmsApi.get<any>("/api/org/branches?limit=200")});
  const {data:vendorResponse}=useQuery({queryKey:["grn-budget-vendors"],queryFn:()=>hrmsApi.get<any>("/api/erp/vendors?limit=500")});
  const branches:any[]=branchResponse?.data??branchResponse??[];
  const vendors:any[]=vendorResponse?.data??vendorResponse??[];
  const {data:lineResponse,isLoading:linesLoading}=useQuery({
    queryKey:["available-budget-lines",form.branchId,period],
    enabled:Boolean(form.branchId),
    queryFn:()=>hrmsApi.get<any>(`/api/finance/pnl/budget-lines/available?branchId=${encodeURIComponent(form.branchId)}&period=${encodeURIComponent(period)}`),
  });
  const budgetLines:any[]=lineResponse?.data??lineResponse??[];
  const selected=budgetLines.find((line)=>line.id===form.budgetLineId);
  const calc=useMemo(()=>selected?calculateBudgetLine({head:selected.head,itemName:selected.item_name,quantity:Number(form.quantity),unit:selected.unit,unitRate:Number(form.unitRate),taxTreatment:selected.tax_treatment,gstRate:Number(selected.gst_rate),gstType:selected.gst_type,recoverableTaxPct:Number(selected.recoverable_tax_pct),justification:selected.justification}):null,[selected,form.quantity,form.unitRate]);

  const saveMutation=useMutation({
    mutationFn:async(submit:boolean)=>{
      if(!form.branchId) throw new Error("Select branch");
      if(!selected) throw new Error("Select an approved budget line");
      if(!file) throw new Error("Invoice / supporting attachment is mandatory");
      if(form.grnType==="vendor"&&!form.vendorId&&!form.vendorName.trim()) throw new Error("Select or enter vendor");
      const result=await hrmsApi.post<{id:string;grnNumber:string}>("/api/finance/grns",{
        grnType:form.grnType,branchId:form.branchId,budgetLineId:selected.id,processId:selected.process_id??undefined,costCentreId:selected.cost_centre_id??undefined,
        vendorId:form.vendorId||undefined,vendorName:form.vendorName||undefined,quantity:Number(form.quantity),unitRate:Number(form.unitRate),
        billDate:form.billDate||undefined,paymentTermsDays:Number(form.paymentTermsDays),remarks:form.remarks||undefined,financialYear:form.financialYear,
      });
      const fd=new FormData(); fd.append("file",file); await hrmsApi.postForm(`/api/finance/grns/${result.id}/attachment`,fd);
      if(submit) await hrmsApi.post(`/api/finance/grns/${result.id}/submit`,{});
      return result;
    },
    onSuccess:(result,submit)=>{setCreated(result);toast({title:submit?"GRN submitted to Branch Head":"GRN draft saved",description:result.grnNumber});setFile(null);void qc.invalidateQueries({queryKey:["grn-list"]});void qc.invalidateQueries({queryKey:["available-budget-lines"]});},
    onError:(error:Error)=>toast({title:"GRN could not be saved",description:error.message,variant:"destructive"}),
  });

  return <div className="mx-auto max-w-5xl space-y-5">
    {created&&<div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><CheckCircle2 className="h-5 w-5 text-emerald-600"/><div><p className="font-semibold text-emerald-900">{created.grnNumber}</p><p className="text-xs text-emerald-700">Budget-linked GRN saved successfully.</p></div></div>}
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100"><CardTitle className="flex items-center gap-2 text-base"><FilePlus className="h-4 w-4 text-[#073f78]"/>Create GRN against approved budget</CardTitle></CardHeader>
      <CardContent className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2"><Label>GRN type *</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.grnType} onChange={e=>setForm(v=>({...v,grnType:e.target.value}))}><option value="vendor">Vendor GRN</option><option value="imprest">Imprest GRN</option></select></div>
        <div className="space-y-2"><Label>Branch *</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.branchId} onChange={e=>setForm(v=>({...v,branchId:e.target.value,budgetLineId:""}))}><option value="">Select branch</option>{branches.map(b=><option key={b.id} value={b.id}>{b.branch_name??b.name}</option>)}</select></div>
        <div className="space-y-2"><Label>Bill date</Label><Input type="date" value={form.billDate} onChange={e=>setForm(v=>({...v,billDate:e.target.value,budgetLineId:""}))}/></div>
        <div className="space-y-2"><Label>Financial year</Label><Input value={form.financialYear} onChange={e=>setForm(v=>({...v,financialYear:e.target.value}))}/></div>
        <div className="space-y-2 md:col-span-2 xl:col-span-4"><div className="flex items-center justify-between"><Label>Approved budget line *</Label><Button asChild variant="link" size="sm" className="h-auto p-0"><Link to="/finance/branch-budget">Open branch budget</Link></Button></div><select className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={!form.branchId||linesLoading} value={form.budgetLineId} onChange={e=>{const line=budgetLines.find(x=>x.id===e.target.value);setForm(v=>({...v,budgetLineId:e.target.value,unitRate:Number(line?.unit_rate??0),vendorId:line?.preferred_vendor_id??v.vendorId,vendorName:line?.preferred_vendor_name??v.vendorName}))}}><option value="">{linesLoading?"Loading approved lines…":"Select approved budget line"}</option>{budgetLines.map(line=><option key={line.id} value={line.id}>{line.budget_number} · {line.head} / {line.sub_head||"General"} · {line.item_name} · Available {money(Number(line.available_gross_amount))}</option>)}</select></div>
        {form.branchId&&!linesLoading&&!budgetLines.length&&<div className="md:col-span-2 xl:col-span-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertCircle className="mt-0.5 h-4 w-4"/>No active approved budget line is available for {period}. Complete Branch Head, Finance Head and Accounts Head approval first.</div>}
        {selected&&<>
          <div className="space-y-2 xl:col-span-2"><Label>Budget item</Label><Input value={`${selected.head} / ${selected.sub_head||"General"} — ${selected.item_name}`} readOnly/></div>
          <div className="space-y-2"><Label>Cost centre</Label><Input value={selected.cost_centre_name??"Branch/common"} readOnly/></div>
          <div className="space-y-2"><Label>Process</Label><Input value={selected.process_name??"Shared/all processes"} readOnly/></div>
          <div className="space-y-2"><Label>Quantity *</Label><Input type="number" min="0.0001" step="0.01" value={form.quantity} onChange={e=>setForm(v=>({...v,quantity:Number(e.target.value)}))}/></div>
          <div className="space-y-2"><Label>Unit</Label><Input value={selected.unit} readOnly/></div>
          <div className="space-y-2"><Label>Unit rate *</Label><Input type="number" min="0" step="0.01" max={Number(selected.unit_rate)} value={form.unitRate} onChange={e=>setForm(v=>({...v,unitRate:Number(e.target.value)}))}/><p className="text-[11px] text-slate-500">Approved maximum: {money(Number(selected.unit_rate))}</p></div>
          <div className="space-y-2"><Label>Tax</Label><Input value={`${String(selected.tax_treatment).replaceAll("_"," ")} · ${Number(selected.gst_rate)}% · ${String(selected.gst_type).replaceAll("_"," + ")}`} readOnly/></div>
        </>}
        {form.grnType==="vendor"&&<><div className="space-y-2 xl:col-span-2"><Label>Vendor *</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.vendorId} onChange={e=>{const vendor=vendors.find(v=>v.id===e.target.value);setForm(v=>({...v,vendorId:e.target.value,vendorName:vendor?.vendor_name??vendor?.name??""}))}}><option value="">Select vendor</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.vendor_name??v.name}</option>)}</select></div><div className="space-y-2 xl:col-span-2"><Label>Vendor name / fallback</Label><Input value={form.vendorName} onChange={e=>setForm(v=>({...v,vendorName:e.target.value}))}/></div></>}
        <div className="space-y-2"><Label>Payment terms</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.paymentTermsDays} onChange={e=>setForm(v=>({...v,paymentTermsDays:Number(e.target.value)}))}>{[0,7,15,30,45,60,90].map(d=><option key={d} value={d}>{d===0?"Immediate":`${d} days`}</option>)}</select></div>
        <div className="space-y-2 md:col-span-1 xl:col-span-3"><Label>Invoice / supporting proof *</Label><label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 text-sm text-slate-600"><Upload className="h-4 w-4"/><span className="truncate">{file?.name??"Upload PDF or image"}</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={e=>setFile(e.target.files?.[0]??null)}/>{file&&<X className="ml-auto h-4 w-4"/>}</label></div>
        <div className="space-y-2 md:col-span-2 xl:col-span-4"><Label>Remarks</Label><Textarea value={form.remarks} onChange={e=>setForm(v=>({...v,remarks:e.target.value}))} placeholder="Purpose, receipt details and any exception note"/></div>
        {calc&&<div className="md:col-span-2 xl:col-span-4 grid gap-3 sm:grid-cols-4">{[["Without tax",calc.base],["Tax",calc.tax],["With tax",calc.gross],["P&L cost",calc.pnlCost]].map(([label,value])=><div key={String(label)} className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 flex items-center font-bold text-slate-900"><IndianRupee className="h-3.5 w-3.5"/>{Number(value).toLocaleString("en-IN",{maximumFractionDigits:2})}</p></div>)}</div>}
      </CardContent>
      <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 bg-slate-50/60 p-5"><Button variant="outline" onClick={()=>saveMutation.mutate(false)} disabled={saveMutation.isPending}><Save className="mr-2 h-4 w-4"/>Save draft</Button><Button className="bg-[#073f78] hover:bg-[#052d57]" onClick={()=>saveMutation.mutate(true)} disabled={saveMutation.isPending}>{saveMutation.isPending?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Send className="mr-2 h-4 w-4"/>}Save & submit</Button></div>
    </Card>
  </div>;
}
