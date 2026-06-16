import React from 'react';
import { CheckCircle, XCircle, Clock, AlertTriangle, MinusCircle } from 'lucide-react';

type VerificationStatus = 'verified' | 'mismatch' | 'failed' | 'manual_review' | 'queued' | 'not_run';

interface VerificationBadgeProps {
  status?: VerificationStatus;
  label?: string;
  summary?: string;
}

const CONFIG: Record<VerificationStatus, { icon: React.ElementType; bg: string; text: string; label: string }> = {
  verified:      { icon: CheckCircle,  bg: 'bg-green-100',  text: 'text-green-700',  label: 'Verified' },
  mismatch:      { icon: AlertTriangle,bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Mismatch' },
  failed:        { icon: XCircle,      bg: 'bg-red-100',    text: 'text-red-700',    label: 'Failed' },
  manual_review: { icon: AlertTriangle,bg: 'bg-orange-100', text: 'text-orange-700', label: 'Manual Review' },
  queued:        { icon: Clock,        bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'In Progress' },
  not_run:       { icon: MinusCircle,  bg: 'bg-gray-100',   text: 'text-gray-500',   label: 'Not Verified' },
};

export function VerificationBadge({ status = 'not_run', label, summary }: VerificationBadgeProps) {
  const cfg = CONFIG[status] ?? CONFIG.not_run;
  const Icon = cfg.icon;
  return (
    <span
      title={summary}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}
    >
      <Icon size={12} />
      {label ?? cfg.label}
    </span>
  );
}
