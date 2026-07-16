/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { HrmsModernShell, HrmsBentoTile } from '@/components/ui/hrms-modern';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertTriangle, CheckCircle2, ChevronRight, Loader2,
  RefreshCw, Search, Shield, ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';

interface NameMismatch {
  candidate_id: string; candidate_code: string; full_name: string;
  overall_status: 'mismatched' | 'partial_match' | 'unverified' | 'matched';
  min_score: number; max_score: number; sources_checked: number;
  last_calculated_at: string;
}

interface NameDetail {
  source_type: string; source_name: string; match_score: number; status: string;
}

const STATUS_COLOR: Record<string, string> = {
  mismatched:    'bg-red-50 text-red-700 border-red-200',
  partial_match: 'bg-amber-50 text-amber-700 border-amber-200',
  unverified:    'bg-slate-100 text-slate-500 border-slate-200',
  matched:       'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function scoreColor(score: number) {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 60) return 'text-amber-600';
  return 'text-red-600';
}

export default function NativeATSNameConsistency() {
  const qc = useQueryClient();
  const [search, setSearch]           = useState('');
  const [sheetOpen, setSheetOpen]     = useState(false);
  const [sheetCandidate, setSheetCandidate] = useState<NameMismatch | null>(null);
  const [details, setDetails]         = useState<NameDetail[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['name-consistency'],
    queryFn: async () => {
      const r = await hrmsApi.get<any>('/api/ats/name-consistency/');
      return ((r as any)?.data ?? []) as NameMismatch[];
    },
  });

  const recalcMutation = useMutation({
    mutationFn: (candidateId: string) => hrmsApi.post(`/api/ats/name-consistency/${candidateId}/recalculate`, {}),
    onSuccess: () => { toast.success('Name match recalculated'); qc.invalidateQueries({ queryKey: ['name-consistency'] }); },
    onError: (e: any) => toast.error(e?.message ?? 'Recalculation failed'),
  });

  async function openSheet(row: NameMismatch) {
    setSheetCandidate(row);
    setSheetOpen(true);
    setLoadingDetails(true);
    try {
      const r = await hrmsApi.get<any>(`/api/ats/name-consistency/${row.candidate_id}`);
      setDetails(((r as any)?.data?.details ?? []) as NameDetail[]);
    } catch {
      toast.error('Failed to load name match details');
      setDetails([]);
    } finally {
      setLoadingDetails(false);
    }
  }

  const rows = (data ?? []).filter(r =>
    !search ||
    r.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.candidate_code?.toLowerCase().includes(search.toLowerCase())
  );

  const totalMismatched   = (data ?? []).filter(r => r.overall_status === 'mismatched').length;
  const totalPartial      = (data ?? []).filter(r => r.overall_status === 'partial_match').length;
  const avgScore          = rows.length ? Math.round(rows.reduce((s, r) => s + r.min_score, 0) / rows.length) : 0;

  return (
    <DashboardLayout>
      <HrmsModernShell
        eyebrow="ATS · Compliance"
        title="Name Consistency Matrix"
        description="Candidates with name mismatches across form, Aadhaar, PAN, bank, and appointment letter."
        icon={<Shield className="h-6 w-6" />}
        actions={
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading} className="gap-2 min-h-[40px]">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        }
      >

        {/* Stat tiles */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
          <HrmsBentoTile title="Mismatched" value={totalMismatched} detail="Critical name conflicts" icon={<ShieldAlert className="h-5 w-5 text-red-600" />} accentClassName="from-red-500 to-rose-500" />
          <HrmsBentoTile title="Partial Match" value={totalPartial} detail="Partial token overlap" icon={<AlertTriangle className="h-5 w-5 text-amber-600" />} accentClassName="from-amber-500 to-orange-500" />
          <HrmsBentoTile title="Avg Min Score" value={`${avgScore}%`} detail="Lowest match across sources" icon={<Shield className="h-5 w-5 text-blue-600" />} accentClassName="from-blue-500 to-cyan-500" className="col-span-2 lg:col-span-1" />
        </div>

        {/* Table */}
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          {/* Search bar */}
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search candidate or code…" className="pl-9" />
            </div>
            <p className="text-sm text-slate-500 ml-auto">{rows.length} record{rows.length !== 1 ? 's' : ''}</p>
          </div>

          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <CheckCircle2 className="h-12 w-12 mb-3 text-emerald-200" />
              <p className="font-semibold text-slate-700">No name mismatches found</p>
              <p className="text-sm text-slate-400 mt-1">All candidate names are consistent across documents.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Candidate</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Mismatch Status</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide hidden sm:table-cell">Min Score</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide hidden md:table-cell">Sources</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(row => (
                    <TableRow
                      key={row.candidate_id}
                      className="hover:bg-slate-50/60 transition-colors cursor-pointer"
                      onClick={() => void openSheet(row)}
                    >
                      <TableCell>
                        <p className="font-semibold text-slate-900 text-sm">{row.full_name}</p>
                        <p className="text-xs text-slate-400">{row.candidate_code}</p>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold capitalize whitespace-nowrap ${STATUS_COLOR[row.overall_status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                          <ShieldAlert className="h-3 w-3" />
                          {row.overall_status.replace(/_/g, ' ')}
                        </span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <span className={`text-lg font-black ${scoreColor(row.min_score)}`}>{row.min_score}%</span>
                      </TableCell>
                      <TableCell className="text-sm text-slate-500 hidden md:table-cell">{row.sources_checked}</TableCell>
                      <TableCell>
                        <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                          <Button
                            size="sm" variant="outline"
                            className="h-8 text-xs cursor-pointer"
                            onClick={() => void openSheet(row)}
                          >
                            <ChevronRight className="h-3 w-3 mr-1" /> Details
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            className="h-8 text-xs cursor-pointer hidden sm:inline-flex"
                            disabled={recalcMutation.isPending}
                            onClick={() => recalcMutation.mutate(row.candidate_id)}
                          >
                            {recalcMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Recalculate'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </HrmsModernShell>

      {/* Details Sheet — full mobile-friendly drawer */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full max-w-md sm:max-w-lg p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-3 border-b">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Shield className="h-5 w-5" />
              {sheetCandidate?.full_name}
            </SheetTitle>
            <p className="text-xs text-slate-500">{sheetCandidate?.candidate_code}</p>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {loadingDetails ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
              </div>
            ) : details.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">No name match details available.</p>
            ) : (
              <>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Name Matches By Source</p>
                <div className="space-y-2">
                  {details.map((d, i) => (
                    <div key={i} className={`rounded-xl border p-3 ${d.match_score >= 80 ? 'border-emerald-200 bg-emerald-50' : d.match_score >= 60 ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{d.source_type?.replace(/_/g, ' ')}</p>
                          <p className="font-semibold text-slate-900 text-sm truncate mt-0.5">{d.source_name || '—'}</p>
                        </div>
                        <span className={`text-xl font-black shrink-0 ${scoreColor(d.match_score)}`}>{d.match_score}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="px-5 py-4 border-t flex gap-2">
            <Button
              className="flex-1 cursor-pointer"
              disabled={recalcMutation.isPending}
              onClick={() => { if (sheetCandidate) recalcMutation.mutate(sheetCandidate.candidate_id); }}
            >
              {recalcMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Recalculate
            </Button>
            <Button variant="outline" onClick={() => setSheetOpen(false)} className="cursor-pointer">Close</Button>
          </div>
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
