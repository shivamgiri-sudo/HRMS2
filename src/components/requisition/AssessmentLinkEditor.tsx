import { useState } from 'react';
import { AlertCircle, CheckCircle, Loader2, Save } from 'lucide-react';
import { hrmsApi } from '@/lib/hrmsApi';
import {
  ASSESSMENT_LINK_MAX, isAssessmentLinkDirty, validateAssessmentLink, type AssessmentLinkStatus,
} from './assessmentLink.model';

export interface AssessmentLinkViewProps {
  inputId: string;
  value: string;
  savedValue: string | null;
  canEdit: boolean;
  status: AssessmentLinkStatus;
  message: string | null;
  onChange: (v: string) => void;
  onSave: () => void;
}

/** Presentational part (rendered to static markup in tests). Fixed-height status row so saving never shifts the layout. */
export function AssessmentLinkView(p: AssessmentLinkViewProps) {
  const dirty = isAssessmentLinkDirty(p.savedValue, p.value);
  const busy = p.status === 'saving';
  const describedBy = `${p.inputId}-help ${p.inputId}-status`;
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4" aria-labelledby={`${p.inputId}-title`}>
      <h3 id={`${p.inputId}-title`} className="text-sm font-semibold text-gray-700">Assessment link</h3>
      <p id={`${p.inputId}-help`} className="mt-1 text-xs text-gray-500">
        Sent to candidates in invites for this requisition. Changes apply from the next message sent. Leave empty to remove the link.
      </p>
      {p.canEdit ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="flex-1">
            <label htmlFor={p.inputId} className="mb-1 block text-sm font-medium text-gray-700">BMI / Assessment link</label>
            <input
              id={p.inputId}
              type="url"
              inputMode="url"
              autoComplete="off"
              maxLength={ASSESSMENT_LINK_MAX + 50}
              value={p.value}
              disabled={busy}
              aria-invalid={p.status === 'error'}
              aria-describedby={describedBy}
              onChange={(e) => p.onChange(e.target.value)}
              placeholder="https://…"
              className="min-h-[44px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:bg-gray-50"
            />
          </div>
          <button
            type="button"
            onClick={p.onSave}
            disabled={busy || !dirty}
            className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:mt-6 motion-reduce:transition-none"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            {busy ? 'Saving' : 'Save link'}
          </button>
        </div>
      ) : (
        <p className="mt-3 break-all text-sm text-gray-800">{p.savedValue ? p.savedValue : 'No link set'}</p>
      )}
      <div id={`${p.inputId}-status`} role="status" aria-live="polite" className="mt-2 min-h-[20px] text-sm">
        {p.status === 'saved' && (
          <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle className="h-4 w-4" aria-hidden="true" />{p.message ?? 'Saved'}</span>
        )}
        {p.status === 'error' && (
          <span className="inline-flex items-center gap-1 text-red-700"><AlertCircle className="h-4 w-4" aria-hidden="true" />Error: {p.message}</span>
        )}
      </div>
    </section>
  );
}

export default function AssessmentLinkEditor({
  requisitionId, initialValue, canEdit, onSaved,
}: { requisitionId: string; initialValue: string | null; canEdit: boolean; onSaved?: (v: string | null) => void }) {
  const [saved, setSaved] = useState<string | null>(initialValue?.trim() || null);
  const [value, setValue] = useState(initialValue ?? '');
  const [status, setStatus] = useState<AssessmentLinkStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    const problem = validateAssessmentLink(value);
    if (problem) { setStatus('error'); setMessage(problem); return; }
    setStatus('saving'); setMessage(null);
    const next = value.trim() || null;
    try {
      await hrmsApi.patch(`/api/job-requisition/${requisitionId}`, { bmi_assessment_url: next });
      setSaved(next); setValue(next ?? ''); setStatus('saved');
      setMessage(next ? 'Link saved' : 'Link removed');
      onSaved?.(next);
    } catch (err) {
      setStatus('error'); setMessage(err instanceof Error ? err.message : 'Could not save the link');
    }
  };

  return (
    <AssessmentLinkView
      inputId={`assessment-link-${requisitionId}`}
      value={value} savedValue={saved} canEdit={canEdit} status={status} message={message}
      onChange={(v) => { setValue(v); if (status !== 'saving') setStatus('idle'); }}
      onSave={save}
    />
  );
}
