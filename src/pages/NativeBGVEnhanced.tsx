import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import {
  Shield, CheckCircle, XCircle, Clock, AlertCircle, FileText,
  CreditCard, GraduationCap, Briefcase, MapPin, AlertTriangle,
  TrendingUp, Users
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type VerificationStatus = 'pending' | 'in_progress' | 'verified' | 'failed';

type VerificationType = 'aadhaar' | 'pan' | 'education' | 'employment' | 'address' | 'criminal';

interface BGVStatus {
  id: string;
  candidate_name: string;
  candidate_code: string;
  mobile: string;
  email: string;
  current_stage: string;
  verification_status: VerificationStatus;
  aadhaar_status: string | null;
  pan_status: string | null;
  education_status: string | null;
  employment_status: string | null;
  address_status: string | null;
  criminal_status: string | null;
  overall_progress: number;
  initiated_at: string;
  completed_at: string | null;
}

interface VerificationDetail {
  verification_type: string;
  status: string;
  verification_method: string;
  document_number: string | null;
  verified_at: string | null;
  initiated_by_name: string;
  remarks: string | null;
}

interface BGVStatistics {
  total_pending: number;
  in_progress: number;
  verified: number;
  failed: number;
  avg_completion_time_days: number;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeBGVEnhanced() {
  const [requests, setRequests] = useState<BGVStatus[]>([]);
  const [stats, setStats] = useState<BGVStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  const [details, setDetails] = useState<{ candidate: any; verifications: VerificationDetail[] } | null>(null);
  const [showInitiateModal, setShowInitiateModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [selectedVerificationId, setSelectedVerificationId] = useState('');

  // Form state
  const [verificationType, setVerificationType] = useState<VerificationType>('aadhaar');
  const [documentNumber, setDocumentNumber] = useState('');
  const [verificationMethod, setVerificationMethod] = useState<'manual' | 'digilocker' | 'api'>('manual');
  const [remarks, setRemarks] = useState('');
  const [updateStatus, setUpdateStatus] = useState<'verified' | 'failed'>('verified');
  const [submitting, setSubmitting] = useState(false);

  // ── Load Data ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    loadRequests();
    loadStats();
  }, []);

  const loadRequests = async () => {
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: BGVStatus[] }>(
        '/api/ats/bgv-enhanced/pending'
      );
      setRequests(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load BGV requests');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: BGVStatistics }>(
        '/api/ats/bgv-enhanced/stats/overview'
      );
      setStats(res.data);
    } catch (err: any) {
      console.error('Failed to load stats:', err);
    }
  };

  const loadDetails = async (candidateId: string) => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: { candidate: any; verifications: VerificationDetail[] } }>(
        `/api/ats/bgv-enhanced/${candidateId}`
      );
      setDetails(res.data);
      setSelectedCandidate(candidateId);
    } catch (err: any) {
      alert(err.message || 'Failed to load details');
    }
  };

  // ── Actions ────────────────────────────────────────────────────────────────────

  const handleInitiateVerification = async () => {
    if (!selectedCandidate) return;

    setSubmitting(true);
    try {
      await hrmsApi.post('/api/ats/bgv-enhanced/initiate', {
        candidate_id: selectedCandidate,
        verification_type: verificationType,
        document_number: documentNumber.trim() || undefined,
        verification_method: verificationMethod,
        remarks: remarks.trim() || undefined,
      });

      setShowInitiateModal(false);
      setDocumentNumber('');
      setRemarks('');
      await loadDetails(selectedCandidate);
      await loadRequests();
    } catch (err: any) {
      alert(err.message || 'Failed to initiate verification');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!selectedVerificationId) return;

    setSubmitting(true);
    try {
      await hrmsApi.post('/api/ats/bgv-enhanced/update-status', {
        verification_id: selectedVerificationId,
        status: updateStatus,
        remarks: remarks.trim() || undefined,
      });

      setShowUpdateModal(false);
      setSelectedVerificationId('');
      setRemarks('');
      if (selectedCandidate) {
        await loadDetails(selectedCandidate);
      }
      await loadRequests();
      await loadStats();
    } catch (err: any) {
      alert(err.message || 'Failed to update status');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────────

  const getVerificationIcon = (type: string) => {
    switch (type) {
      case 'aadhaar':
        return <CreditCard className="w-5 h-5" />;
      case 'pan':
        return <CreditCard className="w-5 h-5" />;
      case 'education':
        return <GraduationCap className="w-5 h-5" />;
      case 'employment':
        return <Briefcase className="w-5 h-5" />;
      case 'address':
        return <MapPin className="w-5 h-5" />;
      case 'criminal':
        return <AlertTriangle className="w-5 h-5" />;
      default:
        return <FileText className="w-5 h-5" />;
    }
  };

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case 'verified':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'failed':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'in_progress':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getStatusIcon = (status: string | null) => {
    switch (status) {
      case 'verified':
        return <CheckCircle className="w-4 h-4" />;
      case 'failed':
        return <XCircle className="w-4 h-4" />;
      case 'in_progress':
        return <Clock className="w-4 h-4" />;
      default:
        return <AlertCircle className="w-4 h-4" />;
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-screen">
          <div className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
            <Shield className="w-4 h-4" />
            <span>ATS / BGV Management</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Background Verification</h1>
          <p className="text-sm text-gray-600 mt-1">
            Digital verification and status tracking
          </p>
        </div>

        {/* Statistics */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Pending</span>
                <Users className="w-5 h-5 text-amber-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.total_pending}</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">In Progress</span>
                <Clock className="w-5 h-5 text-blue-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.in_progress}</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Verified</span>
                <CheckCircle className="w-5 h-5 text-green-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.verified}</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Failed</span>
                <XCircle className="w-5 h-5 text-red-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.failed}</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Avg Days</span>
                <TrendingUp className="w-5 h-5 text-purple-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.avg_completion_time_days}</p>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Candidates List */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Pending Verifications</h2>
            </div>

            <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
              {requests.map((request) => (
                <div
                  key={request.id}
                  onClick={() => loadDetails(request.id)}
                  className={`p-4 cursor-pointer transition-colors ${
                    selectedCandidate === request.id ? 'bg-purple-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-medium text-gray-900">{request.candidate_name}</p>
                      <p className="text-sm text-gray-600">{request.candidate_code}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded border ${getStatusColor(request.verification_status)}`}>
                      {request.verification_status}
                    </span>
                  </div>

                  <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                    <div
                      className="bg-purple-600 h-2 rounded-full transition-all"
                      style={{ width: `${request.overall_progress}%` }}
                    />
                  </div>

                  <p className="text-xs text-gray-500">{request.overall_progress}% complete</p>
                </div>
              ))}

              {requests.length === 0 && (
                <div className="p-8 text-center">
                  <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-600">No pending verifications</p>
                </div>
              )}
            </div>
          </div>

          {/* Details Panel */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {details ? (
              <>
                <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{details.candidate.full_name}</h2>
                    <p className="text-sm text-gray-600">{details.candidate.candidate_id}</p>
                  </div>
                  <button
                    onClick={() => setShowInitiateModal(true)}
                    className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700"
                  >
                    Initiate Check
                  </button>
                </div>

                <div className="p-4 space-y-4 max-h-[550px] overflow-y-auto">
                  {['aadhaar', 'pan', 'education', 'employment', 'address', 'criminal'].map((type) => {
                    const typeKey = `${type}_status` as keyof typeof details.candidate;
                    const status = details.candidate[typeKey];
                    const verification = details.verifications.find(v => v.verification_type === type);

                    return (
                      <div key={type} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center text-purple-600">
                              {getVerificationIcon(type)}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900 capitalize">{type}</p>
                              <p className="text-xs text-gray-500">{verification?.verification_method || 'Not initiated'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-1 rounded border flex items-center gap-1 ${getStatusColor(status)}`}>
                              {getStatusIcon(status)}
                              {status || 'pending'}
                            </span>
                          </div>
                        </div>

                        {verification && (
                          <div className="text-sm space-y-1">
                            {verification.document_number && (
                              <p className="text-gray-600">
                                Document: <span className="font-mono">{verification.document_number}</span>
                              </p>
                            )}
                            {verification.initiated_by_name && (
                              <p className="text-gray-600">By: {verification.initiated_by_name}</p>
                            )}
                            {verification.remarks && (
                              <p className="text-gray-600">Remarks: {verification.remarks}</p>
                            )}
                            {verification.status === 'in_progress' && (
                              <button
                                onClick={() => {
                                  setSelectedVerificationId(type);
                                  setShowUpdateModal(true);
                                }}
                                className="mt-2 text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                              >
                                Update Status
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full p-8">
                <div className="text-center">
                  <Shield className="w-16 h-16 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-600">Select a candidate to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Initiate Modal */}
        {showInitiateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Initiate Verification</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Verification Type</label>
                  <select
                    value={verificationType}
                    onChange={(e) => setVerificationType(e.target.value as VerificationType)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="aadhaar">Aadhaar</option>
                    <option value="pan">PAN</option>
                    <option value="education">Education</option>
                    <option value="employment">Employment</option>
                    <option value="address">Address</option>
                    <option value="criminal">Criminal Background</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
                  <select
                    value={verificationMethod}
                    onChange={(e) => setVerificationMethod(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="manual">Manual</option>
                    <option value="digilocker">Digilocker</option>
                    <option value="api">API</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Document Number</label>
                  <input
                    type="text"
                    value={documentNumber}
                    onChange={(e) => setDocumentNumber(e.target.value)}
                    placeholder="Enter document number"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
                  <textarea
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowInitiateModal(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleInitiateVerification}
                  disabled={submitting}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  {submitting ? 'Initiating...' : 'Initiate'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Update Modal */}
        {showUpdateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Update Verification Status</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={updateStatus}
                    onChange={(e) => setUpdateStatus(e.target.value as 'verified' | 'failed')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="verified">Verified</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
                  <textarea
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    rows={3}
                    placeholder="Add remarks..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowUpdateModal(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateStatus}
                  disabled={submitting}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  {submitting ? 'Updating...' : 'Update'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
