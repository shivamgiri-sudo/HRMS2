import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { ExternalLink } from 'lucide-react';

interface ReceiptViewerProps {
  open: boolean;
  onClose: () => void;
  receiptUrl: string;
  title?: string;
}

export function ReceiptViewer({ open, onClose, receiptUrl, title = 'Receipt' }: ReceiptViewerProps) {
  const isPdf = receiptUrl.toLowerCase().includes('.pdf');
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          {isPdf ? (
            <iframe src={receiptUrl} className="w-full h-[600px] border rounded" title={title} />
          ) : (
            <img src={receiptUrl} alt={title} className="max-h-[600px] object-contain rounded" />
          )}
          <Button variant="outline" size="sm" onClick={() => window.open(receiptUrl, '_blank')}>
            <ExternalLink className="h-4 w-4 mr-2" /> Open in new tab
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
