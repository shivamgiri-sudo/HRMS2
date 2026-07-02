import React, { useState, useEffect } from 'react';
import { CheckCircle2, Clock, AlertCircle, Upload } from 'lucide-react';

export interface DocumentStatus {
  docType: string;
  label: string;
  required: boolean;
  status: 'not_started' | 'uploaded' | 'pending_review' | 'verified' | 'failed';
  uploadedAt?: string;
  verificationStatus?: 'pending' | 'verified' | 'name_mismatch' | 'failed';
}

interface DocumentSubmissionTrackerProps {
  documents: DocumentStatus[];
  section: number;
}

export function DocumentSubmissionTracker({ documents, section }: DocumentSubmissionTrackerProps) {
  const uploaded = documents.filter(d => d.status !== 'not_started').length;
  const required = documents.filter(d => d.required).length;
  const verified = documents.filter(d => d.status === 'verified').length;

  const getStatusIcon = (status: DocumentStatus['status']) => {
    switch (status) {
      case 'verified':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'failed':
      case 'name_mismatch':
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      case 'pending_review':
        return <Clock className="h-5 w-5 text-blue-600" />;
      default:
        return <Upload className="h-5 w-5 text-slate-400" />;
    }
  };

  const getStatusColor = (status: DocumentStatus['status']) => {
    switch (status) {
      case 'verified':
        return 'bg-green-50 border-green-200';
      case 'failed':
      case 'name_mismatch':
        return 'bg-red-50 border-red-200';
      case 'pending_review':
        return 'bg-blue-50 border-blue-200';
      default:
        return 'bg-slate-50 border-slate-200';
    }
  };

  const getStatusText = (status: DocumentStatus['status']) => {
    switch (status) {
      case 'verified':
        return 'Verified';
      case 'failed':
        return 'Verification Failed';
      case 'name_mismatch':
        return 'Name Mismatch';
      case 'pending_review':
        return 'Under Review';
      case 'uploaded':
        return 'Uploaded';
      default:
        return 'Not Started';
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">Document Status</h3>
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-1">
            <span className="font-medium text-slate-900">{uploaded}</span>
            <span className="text-slate-600">Submitted</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="font-medium text-green-600">{verified}</span>
            <span className="text-slate-600">Verified</span>
          </div>
          {required > 0 && (
            <div className="flex items-center gap-1">
              <span className="font-medium text-slate-900">{required}</span>
              <span className="text-slate-600">Required</span>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {documents.map(doc => (
          <div
            key={doc.docType}
            className={`rounded-lg border p-3 flex items-center justify-between ${getStatusColor(doc.status)}`}
          >
            <div className="flex items-center gap-3 flex-1">
              {getStatusIcon(doc.status)}
              <div className="flex-1">
                <p className="font-medium text-sm text-slate-900">
                  {doc.label}
                  {doc.required && <span className="text-red-600 ml-1">*</span>}
                </p>
                {doc.uploadedAt && (
                  <p className="text-xs text-slate-600">
                    Uploaded: {formatISTDate(doc.uploadedAt)}
                  </p>
                )}
              </div>
            </div>
            <span className={`text-xs font-semibold ${
              doc.status === 'verified' ? 'text-green-700' :
              doc.status === 'failed' || doc.status === 'name_mismatch' ? 'text-red-700' :
              doc.status === 'pending_review' ? 'text-blue-700' :
              'text-slate-600'
            }`}>
              {getStatusText(doc.status)}
            </span>
          </div>
        ))}
      </div>

      {documents.some(d => d.status === 'name_mismatch') && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium">Name mismatch detected</p>
            <p>Payroll HQ will review these documents. You'll be notified if action is needed.</p>
          </div>
        </div>
      )}
    </div>
  );
}
