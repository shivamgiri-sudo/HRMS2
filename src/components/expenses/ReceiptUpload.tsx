import { useRef } from 'react';
import { Button } from '../ui/button';
import { Upload, CheckCircle } from 'lucide-react';
import { useUploadReceipt } from '../../integrations/expenses/hooks';
import { apiBaseUrl } from '@/lib/apiBase';

interface ReceiptUploadProps {
  claimId: number;
  itemId: number;
  existingPath?: string;
  onUploaded?: (path: string) => void;
}

function getAuthToken(): string | null {
  const mysqlToken = localStorage.getItem('hrms_access_token');
  if (mysqlToken) return mysqlToken;
  const demoRaw = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true'
    ? localStorage.getItem('hrms_demo_session')
    : null;
  if (demoRaw) {
    try {
      const demo = JSON.parse(demoRaw);
      return demo?.access_token ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

const API_BASE = apiBaseUrl();

export function ReceiptUpload({ claimId, itemId, existingPath, onUploaded }: ReceiptUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { mutate: uploadReceipt, isPending } = useUploadReceipt();

  const handleFile = async (file: File) => {
    const formData = new FormData();
    formData.append('receipt', file);

    const headers: HeadersInit = {};
    const token = getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(
        `${API_BASE}/api/expenses/claims/${claimId}/items/${itemId}/receipt-upload`,
        { method: 'POST', headers, body: formData }
      );
      if (!res.ok) {
        console.error('Receipt upload failed', res.status);
        return;
      }
      const { receipt_path } = await res.json();
      uploadReceipt(
        { claimId, itemId, receiptPath: receipt_path },
        { onSuccess: () => onUploaded?.(receipt_path) }
      );
    } catch (err) {
      console.error('Receipt upload error', err);
    }
  };

  if (existingPath) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600">
        <CheckCircle className="h-4 w-4" />
        <a href={existingPath} target="_blank" rel="noopener noreferrer" className="underline">View Receipt</a>
      </div>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="h-4 w-4 mr-2" />
        {isPending ? 'Uploading...' : 'Upload Receipt'}
      </Button>
    </>
  );
}
