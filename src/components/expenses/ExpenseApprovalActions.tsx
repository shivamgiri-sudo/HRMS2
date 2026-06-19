import { useState } from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { CheckCircle, XCircle } from 'lucide-react';

interface ExpenseApprovalActionsProps {
  onApprove: (comments?: string) => void;
  onReject: (reason: string) => void;
  isLoading?: boolean;
}

export function ExpenseApprovalActions({ onApprove, onReject, isLoading }: ExpenseApprovalActionsProps) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [approveComments, setApproveComments] = useState('');

  return (
    <>
      <div className="flex gap-2">
        <Button variant="default" disabled={isLoading} onClick={() => onApprove(approveComments || undefined)}>
          <CheckCircle className="h-4 w-4 mr-2" /> Approve
        </Button>
        <Button variant="destructive" disabled={isLoading} onClick={() => setRejectOpen(true)}>
          <XCircle className="h-4 w-4 mr-2" /> Reject
        </Button>
      </div>
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Expense Claim</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Reason for rejection *</Label>
            <Textarea
              placeholder="Provide a clear reason for rejection..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!reason.trim()}
              onClick={() => {
                onReject(reason);
                setRejectOpen(false);
                setReason('');
              }}
            >
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
