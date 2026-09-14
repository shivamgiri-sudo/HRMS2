/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { HrmsModernShell, HrmsBentoTile } from '@/components/ui/hrms-modern';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Briefcase, CheckCircle2, Clock, Loader2,
  Plus, RefreshCw, Search, UserCheck, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatISTDate } from '@/lib/utils';
import { useWorkforceAccess } from '@/hooks/useUserRole';

// ── Types ──────────────────────────────────────────────────────────────────────

type PostingStatus = 'draft' | 'active' | 'paused' | 'closed';
type WalkinStatus  = 'waiting' | 'called' | 'in_interview' | 'completed' | 'no_show';

interface JobPosting {
  id: string; posting_code: string; title: string;
  process_name?: string; branch_name?: string; department_name?: string;
  vacancies: number; job_type: string; status: PostingStatus;
  description?: string; requirements?: string; salary_range?: string;
  deadline?: string; created_at: string;
}

interface WalkinEntry {
  id: string; token_number: string; candidate_name: string;
  mobile: string; email?: string; applied_role?: string;
  branch_name?: string; status: WalkinStatus;
  registered_at: string; called_at?: string;
}

const STATUS_BADGE: Record<string, string> = {
  active:       'bg-emerald-50 text-emerald-700 border-emerald-200',
  draft:        'bg-slate-100  text-slate-500  border-slate-200',
  paused:       'bg-amber-50   text-amber-700  border-amber-200',
  closed:       'bg-red-50     text-red-700    border-red-200',
  waiting:      'bg-blue-50    text-blue-700   border-blue-200',
  called:       'bg-violet-50  text-violet-700 border-violet-200',
  in_interview: 'bg-amber-50   text-amber-700  border-amber-200',
  completed:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  no_show:      'bg-red-50     text-red-700    border-red-200',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold capitalize ${STATUS_BADGE[status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

const EMPTY_POSTING = {
  title: '', description: '', requirements: '', job_type: 'full_time',
  vacancies: '1', salary_range: '', deadline: '', status: 'draft' as PostingStatus,
};

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeJobsPage() {
  const qc = useQueryClient();
  const { roleKeys } = useWorkforceAccess();
  const isAdmin     = roleKeys.some(k => ['admin', 'hr', 'super_admin'].includes(k));
  const isRecruiter = roleKeys.some(k => ['recruiter', 'admin', 'hr', 'super_admin'].includes(k));

  const [tab, setTab]               = useState<'postings' | 'walkin'>('postings');
  const [search, setSearch]         = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<JobPosting | null>(null);
  const [form, setForm]             = useState(EMPTY_POSTING);

  // ── Data ─────────────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);

  const { data: postingsRaw, isLoading: loadingP, refetch: refP } = useQuery({
    queryKey: ['jobs-postings', filterStatus],
    queryFn:  async () => {
      const qs = filterStatus ? `?status=${filterStatus}` : '';
      const r  = await hrmsApi.get<any>(`/api/jobs/postings${qs}`);
      return ((r as any)?.data ?? r ?? []) as JobPosting[];
    },
  });

  const { data: walkinRaw, isLoading: loadingW, refetch: refW } = useQuery({
    queryKey: ['jobs-walkin', today],
    queryFn:  async () => {
      const r = await hrmsApi.get<any>(`/api/jobs/walkin?date=${today}`);
      return ((r as any)?.data ?? r ?? []) as WalkinEntry[];
    },
  });

  const postings = (postingsRaw ?? []).filter(p =>
    !search || p.title?.toLowerCase().includes(search.toLowerCase()) || p.posting_code?.toLowerCase().includes(search.toLowerCase())
  );
  const walkin = (walkinRaw ?? []).filter(w =>
    !search || w.candidate_name?.toLowerCase().includes(search.toLowerCase()) || w.token_number?.includes(search)
  );

  // ── Stats ────────────────────────────────────────────────────────────────────
  const activePostings = (postingsRaw ?? []).filter(p => p.status === 'active').length;
  const totalVacancies = (postingsRaw ?? []).filter(p => p.status === 'active').reduce((s, p) => s + p.vacancies, 0);
  const waiting        = (walkinRaw ?? []).filter(w => w.status === 'waiting').length;
  const inInterview    = (walkinRaw ?? []).filter(w => w.status === 'in_interview').length;

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const createPosting = useMutation({
    mutationFn: (body: any) => hrmsApi.post('/api/jobs/postings', body),
    onSuccess: () => {
      toast.success('Job posting created');
      qc.invalidateQueries({ queryKey: ['jobs-postings'] });
      setShowCreate(false);
      setForm(EMPTY_POSTING);
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to create posting'),
  });

  const updatePosting = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => hrmsApi.patch(`/api/jobs/postings/${id}`, body),
    onSuccess: () => {
      toast.success('Posting updated');
      qc.invalidateQueries({ queryKey: ['jobs-postings'] });
      setEditTarget(null);
    },
    onError: (e: any) => toast.error(e?.message ?? 'Update failed'),
  });

  const callCandidate = useMutation({
    mutationFn: (id: string) => hrmsApi.patch(`/api/jobs/walkin/${id}/call`, {}),
    onSuccess: () => { toast.success('Candidate called'); void refW(); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  const updateWalkin = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      hrmsApi.patch(`/api/jobs/walkin/${id}/status`, { status }),
    onSuccess: () => void refW(),
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  function openEdit(p: JobPosting) {
    setEditTarget(p);
    setForm({ ...EMPTY_POSTING, title: p.title, job_type: p.job_type, vacancies: String(p.vacancies), status: p.status, salary_range: p.salary_range ?? '', deadline: p.deadline ?? '' });
  }

  return (
    <DashboardLayout>
      <HrmsModernShell
        eyebrow="Recruitment"
        title="Jobs & Walk-in Queue"
        description="Manage active job postings and today's walk-in candidate queue."
        icon={<Briefcase className="h-6 w-6" />}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { void refP(); void refW(); }} className="gap-2 min-h-[40px]">
              <RefreshCw className="h-4 w-4" />
            </Button>
            {isAdmin && (
              <Button size="sm" onClick={() => setShowCreate(true)} className="gap-2 min-h-[40px] bg-slate-950 hover:bg-slate-800 text-white">
                <Plus className="h-4 w-4" /> New Posting
              </Button>
            )}
          </div>
        }
      >

        {/* ── Stat tiles ─────────────────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <HrmsBentoTile
            title="Active Postings"
            value={activePostings}
            detail={`${totalVacancies} open vacancies`}
            icon={<Briefcase className="h-5 w-5 text-blue-600" />}
            accentClassName="from-blue-500 to-cyan-500"
          />
          <HrmsBentoTile
            title="Waiting Today"
            value={waiting}
            detail="Walk-in candidates in queue"
            icon={<Clock className="h-5 w-5 text-amber-600" />}
            accentClassName="from-amber-500 to-orange-500"
          />
          <HrmsBentoTile
            title="In Interview"
            value={inInterview}
            detail="Currently being interviewed"
            icon={<Users className="h-5 w-5 text-violet-600" />}
            accentClassName="from-violet-500 to-purple-500"
          />
          <HrmsBentoTile
            title="Completed Today"
            value={(walkinRaw ?? []).filter(w => w.status === 'completed').length}
            detail="Interviews completed"
            icon={<UserCheck className="h-5 w-5 text-emerald-600" />}
            accentClassName="from-emerald-500 to-teal-500"
          />
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="flex items-center gap-0 border-b border-slate-200 px-1 pt-1">
            {(['postings', 'walkin'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); setSearch(''); }}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-lg transition-colors cursor-pointer select-none
                  ${tab === t
                    ? 'bg-slate-950 text-white'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
              >
                {t === 'postings' ? <><Briefcase className="h-4 w-4" /> Job Postings</> : <><Users className="h-4 w-4" /> Today's Walk-in Queue</>}
              </button>
            ))}
          </div>

          {/* Search + filter bar */}
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={tab === 'postings' ? 'Search postings…' : 'Search candidate / token…'}
                className="pl-9"
              />
            </div>
            {tab === 'postings' && (
              <Select value={filterStatus || 'all'} onValueChange={v => setFilterStatus(v === 'all' ? '' : v)}>
                <SelectTrigger className="w-40 min-h-[40px]">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {/* ── Postings Table ─────────────────────────────────────────────────── */}
          {tab === 'postings' && (
            loadingP ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
              </div>
            ) : postings.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                <Briefcase className="h-12 w-12 mb-3 text-slate-200" />
                <p className="font-semibold text-slate-700">No job postings found</p>
                {isAdmin && <p className="text-sm text-slate-400 mt-1">Create a new posting to start recruiting.</p>}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Code</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Title</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Type</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Vacancies</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Status</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Deadline</TableHead>
                    {isAdmin && <TableHead className="text-xs font-bold uppercase tracking-wide">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {postings.map(p => (
                    <TableRow key={p.id} className="hover:bg-slate-50/60 transition-colors">
                      <TableCell className="font-mono text-xs text-slate-400">{p.posting_code}</TableCell>
                      <TableCell>
                        <p className="font-semibold text-slate-900 text-sm">{p.title}</p>
                        {(p.branch_name || p.process_name) && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            {[p.branch_name, p.process_name].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600 capitalize">{p.job_type?.replace(/_/g, ' ')}</TableCell>
                      <TableCell className="font-bold text-slate-900">{p.vacancies}</TableCell>
                      <TableCell><StatusBadge status={p.status} /></TableCell>
                      <TableCell className="text-sm text-slate-500">{p.deadline ? formatISTDate(p.deadline) : '—'}</TableCell>
                      {isAdmin && (
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs cursor-pointer"
                            onClick={() => openEdit(p)}
                          >
                            Edit
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          )}

          {/* ── Walk-in Queue Table ─────────────────────────────────────────────── */}
          {tab === 'walkin' && (
            loadingW ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
              </div>
            ) : walkin.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Users className="h-12 w-12 mb-3 text-slate-200" />
                <p className="font-semibold text-slate-700">No walk-in candidates today</p>
                <p className="text-sm text-slate-400 mt-1">Candidates registered at the counter will appear here.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Token</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Candidate</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Role Applied</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Registered</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Status</TableHead>
                    {isRecruiter && <TableHead className="text-xs font-bold uppercase tracking-wide">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {walkin.map(w => (
                    <TableRow key={w.id} className={`transition-colors ${w.status === 'waiting' ? 'bg-blue-50/30 hover:bg-blue-50/50' : 'hover:bg-slate-50/60'}`}>
                      <TableCell className="font-mono font-bold text-blue-700 text-sm">{w.token_number}</TableCell>
                      <TableCell>
                        <p className="font-semibold text-slate-900 text-sm">{w.candidate_name}</p>
                        <p className="text-xs text-slate-400">{w.mobile}</p>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">{w.applied_role ?? '—'}</TableCell>
                      <TableCell className="text-xs text-slate-500">{w.registered_at ? formatISTDate(w.registered_at) : '—'}</TableCell>
                      <TableCell><StatusBadge status={w.status} /></TableCell>
                      {isRecruiter && (
                        <TableCell>
                          <div className="flex gap-1.5">
                            {w.status === 'waiting' && (
                              <Button
                                size="sm"
                                className="h-8 text-xs bg-violet-600 hover:bg-violet-700 text-white cursor-pointer"
                                disabled={callCandidate.isPending}
                                onClick={() => callCandidate.mutate(w.id)}
                              >
                                {callCandidate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Call'}
                              </Button>
                            )}
                            {w.status === 'called' && (
                              <Button
                                size="sm"
                                className="h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
                                onClick={() => updateWalkin.mutate({ id: w.id, status: 'in_interview' })}
                              >
                                Start Interview
                              </Button>
                            )}
                            {w.status === 'in_interview' && (
                              <>
                                <Button
                                  size="sm"
                                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                                  onClick={() => updateWalkin.mutate({ id: w.id, status: 'completed' })}
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-1" /> Done
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50 cursor-pointer"
                                  onClick={() => updateWalkin.mutate({ id: w.id, status: 'no_show' })}
                                >
                                  No Show
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          )}
        </div>
      </HrmsModernShell>

      {/* ── Create Posting Dialog ─────────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={open => { setShowCreate(open); if (!open) setForm(EMPTY_POSTING); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5" /> New Job Posting
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="title">Job Title <span className="text-red-500">*</span></Label>
              <Input id="title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Customer Care Executive" className="mt-1" />
            </div>
            <div>
              <Label>Job Type</Label>
              <Select value={form.job_type} onValueChange={v => setForm(p => ({ ...p, job_type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full Time</SelectItem>
                  <SelectItem value="part_time">Part Time</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                  <SelectItem value="internship">Internship</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="vacancies">Vacancies</Label>
              <Input id="vacancies" type="number" min="1" value={form.vacancies} onChange={e => setForm(p => ({ ...p, vacancies: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Initial Status</Label>
              <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v as PostingStatus }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="salary_range">Salary Range</Label>
              <Input id="salary_range" value={form.salary_range} onChange={e => setForm(p => ({ ...p, salary_range: e.target.value }))} placeholder="₹15,000–₹20,000/month" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="deadline">Application Deadline</Label>
              <Input id="deadline" type="date" value={form.deadline} onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))} className="mt-1" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="desc">Description</Label>
              <Textarea id="desc" rows={2} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Role summary and responsibilities…" className="mt-1 resize-none" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="req">Requirements</Label>
              <Textarea id="req" rows={2} value={form.requirements} onChange={e => setForm(p => ({ ...p, requirements: e.target.value }))} placeholder="Skills, qualifications, experience…" className="mt-1 resize-none" />
            </div>
            <div className="sm:col-span-2 flex gap-2 pt-2">
              <Button
                className="flex-1 cursor-pointer"
                disabled={createPosting.isPending || !form.title.trim()}
                onClick={() => createPosting.mutate({ ...form, vacancies: Number(form.vacancies) })}
              >
                {createPosting.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Create Posting
              </Button>
              <Button variant="outline" onClick={() => setShowCreate(false)} className="cursor-pointer">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Posting Dialog ───────────────────────────────────────────────── */}
      <Dialog open={!!editTarget} onOpenChange={open => { if (!open) setEditTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Posting</DialogTitle>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-4">
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v as PostingStatus }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="edit-vacancies">Vacancies</Label>
                <Input id="edit-vacancies" type="number" min="1" value={form.vacancies} onChange={e => setForm(p => ({ ...p, vacancies: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="edit-salary">Salary Range</Label>
                <Input id="edit-salary" value={form.salary_range} onChange={e => setForm(p => ({ ...p, salary_range: e.target.value }))} className="mt-1" />
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1 cursor-pointer"
                  disabled={updatePosting.isPending}
                  onClick={() => updatePosting.mutate({ id: editTarget.id, body: { status: form.status, vacancies: Number(form.vacancies), salary_range: form.salary_range } })}
                >
                  {updatePosting.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Save Changes
                </Button>
                <Button variant="outline" onClick={() => setEditTarget(null)} className="cursor-pointer">
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
