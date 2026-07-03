import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import {
  User, Phone, Mail, MapPin, Briefcase, GraduationCap,
  Clock, CheckCircle, XCircle, AlertCircle, Star, ThumbsUp,
  ThumbsDown, MessageSquare, Calendar, TrendingUp, Award
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Candidate {
  candidate_id: string;
  full_name: string;
  mobile: string;
  email: string;
  applied_for_role: string;
  applied_for_branch: string;
  branch_display_name: string;
  education: string;
  years_of_experience: string;
  address: string;
  gender: string;
  resume_url: string;
  selfie_url: string;
  token_number: string;
  queue_status: string;
  registered_at: string;
}

interface PerformanceMetrics {
  total_interviews: number;
  selected_count: number;
  rejected_count: number;
  hold_count: number;
  no_show_count: number;
  avg_communication_rating: number;
  avg_stability_rating: number;
  selection_rate: number;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeRecruiterPortal() {
  const [view, setView] = useState<'list' | 'interview' | 'metrics'>('list');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidatePhotos, setCandidatePhotos] = useState<Record<string, string>>({});
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Interview form state
  const [interviewStatus, setInterviewStatus] = useState<'selected' | 'rejected' | 'hold' | 'callback' | 'no_show' | 'walkout'>('selected');
  const [communicationRating, setCommunicationRating] = useState(3);
  const [stabilityRating, setStabilityRating] = useState(3);
  const [salaryFit, setSalaryFit] = useState(true);
  const [shiftFit, setShiftFit] = useState(true);
  const [locationFit, setLocationFit] = useState(true);
  const [roleFit, setRoleFit] = useState(true);
  const [remarks, setRemarks] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [nextStep, setNextStep] = useState('');

  // ── Load assigned candidates ───────────────────────────────────────────────
  useEffect(() => {
    if (view === 'list') {
      loadCandidates();
    } else if (view === 'metrics') {
      loadMetrics();
    }
  }, [view]);

  useEffect(() => {
    const objectUrls: string[] = [];
    let cancelled = false;

    const loadCandidatePhotos = async () => {
      const next: Record<string, string> = {};
      for (const candidate of candidates) {
        if (!candidate.selfie_url) continue;
        try {
          const blob = await hrmsApi.getBlob(candidate.selfie_url);
          const objectUrl = URL.createObjectURL(blob);
          objectUrls.push(objectUrl);
          next[candidate.candidate_id] = objectUrl;
        } catch {
          // Silent fallback: show initials/avatar when secured file fetch is unavailable
        }
      }
      if (!cancelled) {
        setCandidatePhotos(next);
      } else {
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
      }
    };

    if (candidates.length > 0) {
      void loadCandidatePhotos();
    } else {
      setCandidatePhotos({});
    }

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [candidates]);

  const loadCandidates = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await hrmsApi.get('/api/ats/interview/assigned-candidates');
      setCandidates(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load candidates');
    } finally {
      setLoading(false);
    }
  };

  const loadMetrics = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await hrmsApi.get('/api/ats/interview/performance');
      setMetrics(res.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  };

  // ── Update queue status ────────────────────────────────────────────────────
  const updateStatus = async (candidateId: string, status: 'called' | 'in_interview') => {
    try {
      await hrmsApi.post('/api/ats/interview/update-queue-status', {
        candidate_id: candidateId,
        status,
      });
      loadCandidates();
    } catch (err: any) {
      setError(err.message || 'Failed to update status');
    }
  };

  // ── Submit interview result ────────────────────────────────────────────────
  const submitInterview = async () => {
    if (!selectedCandidate) return;

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      await hrmsApi.post('/api/ats/interview/submit-result', {
        candidate_id: selectedCandidate.candidate_id,
        interview_status: interviewStatus,
        communication_rating: communicationRating,
        stability_rating: stabilityRating,
        salary_fit: salaryFit,
        shift_fit: shiftFit,
        location_fit: locationFit,
        role_fit: roleFit,
        remarks,
        rejection_reason: interviewStatus === 'rejected' ? rejectionReason : undefined,
        next_step: nextStep,
      });

      setSuccess(`Interview result submitted: ${interviewStatus}`);
      setTimeout(() => {
        setView('list');
        setSelectedCandidate(null);
        resetForm();
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to submit interview result');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setInterviewStatus('selected');
    setCommunicationRating(3);
    setStabilityRating(3);
    setSalaryFit(true);
    setShiftFit(true);
    setLocationFit(true);
    setRoleFit(true);
    setRemarks('');
    setRejectionReason('');
    setNextStep('');
  };

  // ── Render Star Rating ─────────────────────────────────────────────────────
  const StarRating = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          className="focus:outline-none"
        >
          <Star
            className={`w-6 h-6 ${
              star <= value ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'
            }`}
          />
        </button>
      ))}
    </div>
  );

  // ── View: List ─────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <DashboardLayout>
        <div className="p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Recruiter Portal</h1>
              <p className="text-sm text-gray-600 mt-1">Your assigned candidates</p>
            </div>
            <button
              onClick={() => setView('metrics')}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2"
            >
              <TrendingUp className="w-4 h-4" />
              My Performance
            </button>
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-red-800">{error}</span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : candidates.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <User className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600">No candidates assigned</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {candidates.map((candidate) => (
                <div
                  key={candidate.candidate_id}
                  className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4">
                      {candidatePhotos[candidate.candidate_id] ? (
                        <img
                          src={candidatePhotos[candidate.candidate_id]}
                          alt={candidate.full_name}
                          className="w-16 h-16 rounded-full object-cover border-2 border-purple-200"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-purple-100 flex items-center justify-center">
                          <User className="w-8 h-8 text-purple-600" />
                        </div>
                      )}
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{candidate.full_name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="px-3 py-1 bg-purple-100 text-purple-800 text-xs font-medium rounded-full">
                            {candidate.token_number}
                          </span>
                          <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                            candidate.queue_status === 'waiting' ? 'bg-yellow-100 text-yellow-800' :
                            candidate.queue_status === 'called' ? 'bg-blue-100 text-blue-800' :
                            candidate.queue_status === 'in_interview' ? 'bg-green-100 text-green-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {candidate.queue_status.replace('_', ' ').toUpperCase()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Phone className="w-4 h-4" />
                      <span>{candidate.mobile}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Mail className="w-4 h-4" />
                      <span>{candidate.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Briefcase className="w-4 h-4" />
                      <span>{candidate.applied_for_role}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <GraduationCap className="w-4 h-4" />
                      <span>{candidate.education}</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {candidate.queue_status === 'waiting' && (
                      <button
                        onClick={() => updateStatus(candidate.candidate_id, 'called')}
                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        Call Candidate
                      </button>
                    )}
                    {candidate.queue_status === 'called' && (
                      <button
                        onClick={() => updateStatus(candidate.candidate_id, 'in_interview')}
                        className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                      >
                        Start Interview
                      </button>
                    )}
                    {candidate.queue_status === 'in_interview' && (
                      <button
                        onClick={() => {
                          setSelectedCandidate(candidate);
                          setView('interview');
                        }}
                        className="flex-1 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700"
                      >
                        Submit Interview Result
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DashboardLayout>
    );
  }

  // ── View: Interview ────────────────────────────────────────────────────────
  if (view === 'interview' && selectedCandidate) {
    return (
      <DashboardLayout>
        <div className="p-6 max-w-4xl mx-auto">
          <div className="mb-6">
            <button
              onClick={() => {
                setView('list');
                setSelectedCandidate(null);
                resetForm();
              }}
              className="text-sm text-purple-600 hover:text-purple-700 font-medium mb-2"
            >
              ← Back to List
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Interview Result</h1>
            <p className="text-sm text-gray-600 mt-1">{selectedCandidate.full_name}</p>
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-red-800">{error}</span>
            </div>
          )}

          {success && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-green-800">{success}</span>
            </div>
          )}

          <div className="space-y-6">
            {/* Interview Status */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Interview Status</h2>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: 'selected', label: 'Selected', icon: CheckCircle, color: 'green' },
                  { value: 'rejected', label: 'Rejected', icon: XCircle, color: 'red' },
                  { value: 'hold', label: 'On Hold', icon: AlertCircle, color: 'yellow' },
                ].map((status) => {
                  const Icon = status.icon;
                  return (
                    <button
                      key={status.value}
                      onClick={() => setInterviewStatus(status.value as any)}
                      className={`p-4 border-2 rounded-lg flex flex-col items-center gap-2 transition-all ${
                        interviewStatus === status.value
                          ? `border-${status.color}-500 bg-${status.color}-50`
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <Icon className={`w-6 h-6 ${
                        interviewStatus === status.value ? `text-${status.color}-600` : 'text-gray-400'
                      }`} />
                      <span className="font-medium text-sm">{status.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Ratings */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Ratings</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Communication Skills
                  </label>
                  <StarRating value={communicationRating} onChange={setCommunicationRating} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Stability/Commitment
                  </label>
                  <StarRating value={stabilityRating} onChange={setStabilityRating} />
                </div>
              </div>
            </div>

            {/* Fit Assessment */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Fit Assessment</h2>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Salary Expectation Fit', value: salaryFit, onChange: setSalaryFit },
                  { label: 'Shift Availability Fit', value: shiftFit, onChange: setShiftFit },
                  { label: 'Location Comfort Fit', value: locationFit, onChange: setLocationFit },
                  { label: 'Role Suitability Fit', value: roleFit, onChange: setRoleFit },
                ].map((item) => (
                  <label key={item.label} className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={item.value}
                      onChange={(e) => item.onChange(e.target.checked)}
                      className="w-4 h-4 text-purple-600 rounded focus:ring-2 focus:ring-purple-500"
                    />
                    <span className="text-sm font-medium text-gray-700">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Rejection Reason (if rejected) */}
            {interviewStatus === 'rejected' && (
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Rejection Reason *
                </label>
                <select
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  required
                >
                  <option value="">Select reason</option>
                  <option value="communication_poor">Poor Communication Skills</option>
                  <option value="experience_insufficient">Insufficient Experience</option>
                  <option value="salary_mismatch">Salary Expectation Mismatch</option>
                  <option value="location_issue">Location/Travel Concerns</option>
                  <option value="shift_unavailable">Shift Availability Issue</option>
                  <option value="attitude_concern">Attitude/Cultural Fit Concern</option>
                  <option value="background_issue">Background Verification Concern</option>
                  <option value="other">Other</option>
                </select>
              </div>
            )}

            {/* Next Step (if hold/callback) */}
            {(interviewStatus === 'hold' || interviewStatus === 'callback') && (
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Next Step *
                </label>
                <input
                  type="text"
                  value={nextStep}
                  onChange={(e) => setNextStep(e.target.value)}
                  placeholder="e.g., Second round interview with manager"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
            )}

            {/* Remarks */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Remarks
              </label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={4}
                placeholder="Additional notes about the interview..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setView('list');
                  setSelectedCandidate(null);
                  resetForm();
                }}
                className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitInterview}
                disabled={submitting}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Submitting...
                  </>
                ) : (
                  'Submit Interview Result'
                )}
              </button>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ── View: Performance Metrics ──────────────────────────────────────────────
  if (view === 'metrics' && metrics) {
    return (
      <DashboardLayout>
        <div className="p-6 max-w-6xl mx-auto">
          <div className="mb-6">
            <button
              onClick={() => setView('list')}
              className="text-sm text-purple-600 hover:text-purple-700 font-medium mb-2"
            >
              ← Back to Candidates
            </button>
            <h1 className="text-2xl font-bold text-gray-900">My Performance</h1>
            <p className="text-sm text-gray-600 mt-1">Your interview statistics</p>
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-red-800">{error}</span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Total Interviews */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-600">Total Interviews</h3>
                  <User className="w-5 h-5 text-gray-400" />
                </div>
                <p className="text-3xl font-bold text-gray-900">{metrics.total_interviews}</p>
              </div>

              {/* Selected */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-600">Selected</h3>
                  <CheckCircle className="w-5 h-5 text-green-500" />
                </div>
                <p className="text-3xl font-bold text-green-600">{metrics.selected_count}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {metrics.selection_rate.toFixed(1)}% selection rate
                </p>
              </div>

              {/* Rejected */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-600">Rejected</h3>
                  <XCircle className="w-5 h-5 text-red-500" />
                </div>
                <p className="text-3xl font-bold text-red-600">{metrics.rejected_count}</p>
              </div>

              {/* On Hold */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-600">On Hold</h3>
                  <AlertCircle className="w-5 h-5 text-yellow-500" />
                </div>
                <p className="text-3xl font-bold text-yellow-600">{metrics.hold_count}</p>
              </div>

              {/* No Show */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-600">No Show</h3>
                  <Clock className="w-5 h-5 text-gray-400" />
                </div>
                <p className="text-3xl font-bold text-gray-600">{metrics.no_show_count}</p>
              </div>

              {/* Avg Communication Rating */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-600">Avg Communication</h3>
                  <MessageSquare className="w-5 h-5 text-purple-500" />
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-3xl font-bold text-purple-600">
                    {metrics.avg_communication_rating.toFixed(1)}
                  </p>
                  <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
                </div>
              </div>

              {/* Avg Stability Rating */}
              <div className="bg-white border border-gray-200 rounded-lg p-6 md:col-span-2 lg:col-span-1">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-600">Avg Stability</h3>
                  <Award className="w-5 h-5 text-blue-500" />
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-3xl font-bold text-blue-600">
                    {metrics.avg_stability_rating.toFixed(1)}
                  </p>
                  <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
                </div>
              </div>
            </div>
          )}
        </div>
      </DashboardLayout>
    );
  }

  // Default
  return (
    <DashboardLayout>
      <div className="p-6 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    </DashboardLayout>
  );
}
