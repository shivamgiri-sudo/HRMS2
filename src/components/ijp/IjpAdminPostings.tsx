import { useState } from "react";
import {
  Briefcase,
  Calendar,
  ChevronDown,
  Edit,
  Eye,
  Loader2,
  MoreHorizontal,
  Plus,
  Send,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useIjpPostings, useCreateIjpPosting, usePublishIjpPosting, useCloseIjpPosting } from "./useIjp";
import { useDepartments } from "@/hooks/useDepartments";
import { useProcesses, useBranches, useDesignations } from "@/hooks/useOrgMasters";
import type { IjpPostingStatus, IjpPostingWithDetails } from "./types";

const STATUS_CONFIG: Record<IjpPostingStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "Draft", variant: "secondary" },
  open: { label: "Open", variant: "default" },
  closed: { label: "Closed", variant: "outline" },
  filled: { label: "Filled", variant: "default" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: IjpPostingStatus }) {
  const config = STATUS_CONFIG[status] || { label: status, variant: "secondary" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

interface CreatePostingFormData {
  job_title: string;
  description: string;
  department_id: string;
  process_id: string;
  designation_id: string;
  branch_id: string;
  vacancies: number;
  min_tenure_months: number;
  require_manager_approval: boolean;
  closes_at: string;
  eligible_department_ids: string[];
  eligible_process_ids: string[];
  excluded_process_ids: string[];
  eligible_designation_ids: string[];
  eligible_branch_ids: string[];
}

const defaultFormData: CreatePostingFormData = {
  job_title: "",
  description: "",
  department_id: "",
  process_id: "",
  designation_id: "",
  branch_id: "",
  vacancies: 1,
  min_tenure_months: 12,
  require_manager_approval: false,
  closes_at: "",
  eligible_department_ids: [],
  eligible_process_ids: [],
  excluded_process_ids: [],
  eligible_designation_ids: [],
  eligible_branch_ids: [],
};

function CreatePostingDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<CreatePostingFormData>(defaultFormData);
  const [showEligibility, setShowEligibility] = useState(false);
  const createMutation = useCreateIjpPosting();
  const { data: departments } = useDepartments();
  const { data: processes } = useProcesses();
  const { data: branches } = useBranches();
  const { data: designations } = useDesignations();

  const handleSubmit = async () => {
    const payload: Record<string, unknown> = {
      job_title: form.job_title,
      description: form.description || undefined,
      vacancies: form.vacancies,
      min_tenure_months: form.min_tenure_months,
      require_manager_approval: form.require_manager_approval,
    };
    if (form.department_id) payload.department_id = form.department_id;
    if (form.process_id) payload.process_id = form.process_id;
    if (form.designation_id) payload.designation_id = form.designation_id;
    if (form.branch_id) payload.branch_id = form.branch_id;
    if (form.closes_at) payload.closes_at = new Date(form.closes_at).toISOString();
    if (form.eligible_department_ids.length) payload.eligible_department_ids = form.eligible_department_ids;
    if (form.eligible_process_ids.length) payload.eligible_process_ids = form.eligible_process_ids;
    if (form.excluded_process_ids.length) payload.excluded_process_ids = form.excluded_process_ids;
    if (form.eligible_designation_ids.length) payload.eligible_designation_ids = form.eligible_designation_ids;
    if (form.eligible_branch_ids.length) payload.eligible_branch_ids = form.eligible_branch_ids;

    try {
      await createMutation.mutateAsync(payload);
      setForm(defaultFormData);
      onOpenChange(false);
      onSuccess();
    } catch {
      // error handled by mutation state
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Internal Job Posting</DialogTitle>
          <DialogDescription>
            Define the position details and eligibility criteria
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="job_title">Job Title *</Label>
              <Input
                id="job_title"
                value={form.job_title}
                onChange={(e) => setForm({ ...form, job_title: e.target.value })}
                placeholder="e.g., Senior Process Executive"
              />
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Describe the role and requirements..."
                className="min-h-[80px]"
              />
            </div>

            <div>
              <Label>Department</Label>
              <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any Department</SelectItem>
                  {departments?.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Process</Label>
              <Select value={form.process_id} onValueChange={(v) => setForm({ ...form, process_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select process" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any Process</SelectItem>
                  {processes?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Branch</Label>
              <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any Branch</SelectItem>
                  {branches?.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Target Designation</Label>
              <Select value={form.designation_id} onValueChange={(v) => setForm({ ...form, designation_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any</SelectItem>
                  {designations?.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="vacancies">Vacancies</Label>
              <Input
                id="vacancies"
                type="number"
                min={1}
                max={100}
                value={form.vacancies}
                onChange={(e) => setForm({ ...form, vacancies: parseInt(e.target.value) || 1 })}
              />
            </div>

            <div>
              <Label htmlFor="min_tenure">Minimum Tenure (months)</Label>
              <Input
                id="min_tenure"
                type="number"
                min={0}
                max={240}
                value={form.min_tenure_months}
                onChange={(e) => setForm({ ...form, min_tenure_months: parseInt(e.target.value) || 0 })}
              />
            </div>

            <div>
              <Label htmlFor="closes_at">Application Deadline</Label>
              <Input
                id="closes_at"
                type="date"
                value={form.closes_at}
                onChange={(e) => setForm({ ...form, closes_at: e.target.value })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="manager_approval" className="cursor-pointer">
                Require Manager Approval
              </Label>
              <Switch
                id="manager_approval"
                checked={form.require_manager_approval}
                onCheckedChange={(v) => setForm({ ...form, require_manager_approval: v })}
              />
            </div>
          </div>

          <Collapsible open={showEligibility} onOpenChange={setShowEligibility}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                Eligibility Restrictions
                <ChevronDown className={`h-4 w-4 transition-transform ${showEligibility ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                Leave empty to allow all employees. Select specific options to restrict eligibility.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Eligible Departments</Label>
                  <Select
                    value={form.eligible_department_ids.join(",")}
                    onValueChange={(v) => setForm({ ...form, eligible_department_ids: v ? v.split(",") : [] })}
                  >
                    <SelectTrigger><SelectValue placeholder="All departments" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All Departments</SelectItem>
                      {departments?.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Excluded Processes</Label>
                  <Select
                    value={form.excluded_process_ids.join(",")}
                    onValueChange={(v) => setForm({ ...form, excluded_process_ids: v ? v.split(",") : [] })}
                  >
                    <SelectTrigger><SelectValue placeholder="None excluded" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">No Exclusions</SelectItem>
                      {processes?.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!form.job_title || createMutation.isPending}>
            {createMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Posting"
            )}
          </Button>
        </DialogFooter>

        {createMutation.isError && (
          <p className="text-sm text-red-600 mt-2">
            {(createMutation.error as Error)?.message || "Failed to create posting"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PostingRow({
  posting,
  onViewApplications,
}: {
  posting: IjpPostingWithDetails;
  onViewApplications: (id: string) => void;
}) {
  const publishMutation = usePublishIjpPosting();
  const closeMutation = useCloseIjpPosting();

  return (
    <TableRow>
      <TableCell className="font-medium">
        <div>
          <p className="font-semibold">{posting.job_title}</p>
          <p className="text-xs text-muted-foreground">{posting.posting_code}</p>
        </div>
      </TableCell>
      <TableCell>
        <div className="text-sm">
          {posting.department_name || "Any"}
          {posting.branch_name && <span className="text-muted-foreground"> / {posting.branch_name}</span>}
        </div>
      </TableCell>
      <TableCell className="text-center">{posting.vacancies}</TableCell>
      <TableCell className="text-center">{posting.min_tenure_months}m</TableCell>
      <TableCell className="text-center">
        <Badge variant="outline">{posting.application_count}</Badge>
      </TableCell>
      <TableCell><StatusBadge status={posting.status} /></TableCell>
      <TableCell className="text-sm">{formatDate(posting.closes_at)}</TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onViewApplications(posting.id)}>
              <Eye className="mr-2 h-4 w-4" /> View Applications
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <Edit className="mr-2 h-4 w-4" /> Edit Posting
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {posting.status === "draft" && (
              <DropdownMenuItem
                onClick={() => publishMutation.mutate(posting.id)}
                disabled={publishMutation.isPending}
              >
                <Send className="mr-2 h-4 w-4" /> Publish
              </DropdownMenuItem>
            )}
            {posting.status === "open" && (
              <DropdownMenuItem
                onClick={() => closeMutation.mutate({ id: posting.id, reason: "Closed by admin" })}
                disabled={closeMutation.isPending}
              >
                <X className="mr-2 h-4 w-4" /> Close Posting
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

export function IjpAdminPostings({ onViewApplications }: { onViewApplications: (postingId: string) => void }) {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading, refetch } = useIjpPostings({ status: statusFilter || undefined });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="filled">Filled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Create Posting
        </Button>
      </div>

      {data?.postings && data.postings.length > 0 ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job Title</TableHead>
                <TableHead>Department / Branch</TableHead>
                <TableHead className="text-center">Vacancies</TableHead>
                <TableHead className="text-center">Min Tenure</TableHead>
                <TableHead className="text-center">Applications</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Closes</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.postings.map((posting) => (
                <PostingRow
                  key={posting.id}
                  posting={posting}
                  onViewApplications={onViewApplications}
                />
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Briefcase className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium">No postings found</p>
            <p className="text-muted-foreground mb-4">
              Create your first internal job posting to get started
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Create Posting
            </Button>
          </CardContent>
        </Card>
      )}

      <CreatePostingDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => refetch()}
      />
    </>
  );
}
