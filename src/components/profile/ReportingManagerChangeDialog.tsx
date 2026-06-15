import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  useManagerSearch,
  useSubmitRMChangeRequest,
  type ManagerSearchResult,
} from '@/hooks/useReportingManagerChange';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentManagerName?: string | null;
}

export function ReportingManagerChangeDialog({
  open,
  onOpenChange,
  currentManagerName,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<ManagerSearchResult | null>(null);
  const [reason, setReason] = useState('');

  const { data: searchResults, isFetching } = useManagerSearch(searchQuery);
  const submit = useSubmitRMChangeRequest();

  const handleSubmit = async () => {
    if (!selected) return;
    try {
      await submit.mutateAsync({
        requested_manager_id: selected.id,
        reason: reason.trim() || undefined,
      });
      toast.success('Request submitted — pending WFM approval');
      onOpenChange(false);
      setSelected(null);
      setSearchQuery('');
      setReason('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit request');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change Reporting Manager</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {currentManagerName && (
            <div className="text-sm text-muted-foreground">
              Current manager:{' '}
              <span className="font-medium text-foreground">{currentManagerName}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Search new manager</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Type name or employee code…"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelected(null);
                }}
              />
            </div>
          </div>

          {isFetching && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Searching…
            </div>
          )}

          {searchResults && searchResults.length > 0 && !selected && (
            <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
              {searchResults.map((emp) => (
                <button
                  type="button"
                  key={emp.id}
                  className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-center justify-between"
                  onClick={() => {
                    setSelected(emp);
                    setSearchQuery(emp.full_name);
                  }}
                >
                  <div>
                    <span className="font-medium">{emp.full_name}</span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {emp.employee_code}
                    </span>
                  </div>
                  {emp.designation_name && (
                    <Badge variant="secondary" className="text-xs">
                      {emp.designation_name}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div className="flex items-center gap-2 p-2 bg-emerald-50 border border-emerald-200 rounded-md text-sm">
              <UserCheck className="h-4 w-4 text-emerald-600" />
              <span className="font-medium text-emerald-800">{selected.full_name}</span>
              <span className="text-emerald-600 text-xs">{selected.employee_code}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>
              Reason{' '}
              <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <Textarea
              placeholder="Why is this change needed?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            This request will be sent to your Branch WFM Head for approval.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!selected || submit.isPending}>
            {submit.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Submit Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
