import React, { useRef, useState } from 'react';
import { Upload, FileCheck, Loader2 } from 'lucide-react';

import { hrmsApi } from '@/lib/hrmsApi';

interface InlineDocUploadProps {
  token: string;
  docType: string;
  label: string;
  accept?: string;
  onUploaded?: (doc: Record<string, unknown>) => void;
  existingFileName?: string;
}

export function InlineDocUpload({ token, docType, label, accept = '.pdf,.jpg,.jpeg,.png,.webp', onUploaded, existingFileName }: InlineDocUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<string | null>(existingFileName ?? null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('token', token);
    formData.append('doc_type', docType);
    try {
      const data = await hrmsApi.postForm<{ success: boolean; data?: Record<string, unknown>; message?: string }>(
        '/api/ats/onboarding-full/documents',
        formData
      );
      if (data.success) {
        setUploaded(file.name);
        onUploaded?.(data.data ?? {});
      } else {
        setError(data.message ?? 'Upload failed. Please try again.');
      }
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-gray-600 mb-1">{label}</p>
      {uploaded ? (
        <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          <FileCheck size={14} />
          <span className="truncate max-w-48">{uploaded}</span>
          <button
            type="button"
            onClick={() => { setUploaded(null); if (inputRef.current) inputRef.current.value = ''; }}
            className="ml-auto text-gray-400 hover:text-red-500 text-xs"
          >
            Replace
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-3 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-purple-400 hover:text-purple-600 transition-colors disabled:opacity-50"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {uploading ? 'Uploading…' : 'Upload document'}
        </button>
      )}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
    </div>
  );
}
