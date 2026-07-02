import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { hrmsApi } from '@/lib/hrmsApi';
import {
  User, Mail, Phone, MapPin, Briefcase, Calendar, FileText,
  CheckCircle, Clock, AlertCircle, Upload, Download, LogOut,
  Building2, BadgeCheck, FileCheck, Users, Home
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface CandidateInfo {
  id: string;
  candidate_code: string;
  full_name: string;
  mobile: string;
  email: string;
  applied_for_role: string;
  applied_for_branch: string;
  current_stage: string;
  joining_date?: string;
  salary_start_date?: string;
}

interface OnboardingTask {
  id: string;
  task_name: string;
  task_description: string;
  is_completed: boolean;
  completed_at?: string;
  document_url?: string;
}

interface DocumentUpload {
  id: string;
  document_type: string;
  file_name: string;
  file_url: string;
  uploaded_at: string;
  verification_status: 'pending' | 'verified' | 'rejected';
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function CandidatePortalDashboard() {
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<CandidateInfo | null>(null);
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  const [documents, setDocuments] = useState<DocumentUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Load Data ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    setError('');

    try {
      // Load candidate info
      const candidateRes = await hrmsApi.get<{ success: boolean; data: CandidateInfo }>(
        '/api/ats/candidate-portal/profile'
      );
      setCandidate(candidateRes.data);

      // Load onboarding tasks
      const tasksRes = await hrmsApi.get<{ success: boolean; data: OnboardingTask[] }>(
        '/api/ats/candidate-portal/tasks'
      );
      setTasks(tasksRes.data || []);

      // Load uploaded documents
      const docsRes = await hrmsApi.get<{ success: boolean; data: DocumentUpload[] }>(
        '/api/ats/candidate-portal/documents'
      );
      setDocuments(docsRes.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  // ── Handle Logout ──────────────────────────────────────────────────────────────
  const handleLogout = () => {
    localStorage.removeItem('candidate_token');
    localStorage.removeItem('candidate_info');
    navigate('/candidate-portal/login');
  };

  // ── Calculate Progress ─────────────────────────────────────────────────────────
  const completedTasks = tasks.filter((t) => t.is_completed).length;
  const totalTasks = tasks.length;
  const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // ── Get Stage Color ────────────────────────────────────────────────────────────
  const getStageColor = (stage: string) => {
    const stageColors: Record<string, string> = {
      selected: 'bg-green-100 text-green-800 border-green-200',
      bgv_pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      bgv_verified: 'bg-blue-100 text-blue-800 border-blue-200',
      offer_pending: 'bg-orange-100 text-orange-800 border-orange-200',
      offer_accepted: 'bg-purple-100 text-purple-800 border-purple-200',
      onboarding: 'bg-indigo-100 text-indigo-800 border-indigo-200',
      joined: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    };
    return stageColors[stage.toLowerCase()] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  // ── Render ─────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl border border-red-200 p-8 max-w-md w-full">
          <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 text-center mb-2">Error</h2>
          <p className="text-sm text-gray-600 text-center mb-6">{error}</p>
          <button
            onClick={() => navigate('/candidate-portal/login')}
            className="w-full px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (!candidate) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-blue-600 rounded-xl flex items-center justify-center">
                <Home className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Candidate Portal</h1>
                <p className="text-xs text-gray-600">Mas Callnet India Pvt. Ltd.</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid gap-6">
          {/* Welcome Card */}
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-gradient-to-br from-purple-100 to-blue-100 rounded-full flex items-center justify-center">
                  <User className="w-8 h-8 text-purple-600" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    Welcome, {candidate.full_name}!
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Candidate ID: {candidate.candidate_code}
                  </p>
                </div>
              </div>
              <span
                className={`px-4 py-2 rounded-full text-sm font-medium border ${getStageColor(
                  candidate.current_stage
                )}`}
              >
                {candidate.current_stage.replace(/_/g, ' ').toUpperCase()}
              </span>
            </div>

            {/* Candidate Details */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <Phone className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-600">Mobile</p>
                  <p className="text-sm font-medium text-gray-900">{candidate.mobile}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <Mail className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-600">Email</p>
                  <p className="text-sm font-medium text-gray-900">{candidate.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <Briefcase className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-600">Role</p>
                  <p className="text-sm font-medium text-gray-900">{candidate.applied_for_role}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <Building2 className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-600">Branch</p>
                  <p className="text-sm font-medium text-gray-900">{candidate.applied_for_branch}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Progress Card */}
          {totalTasks > 0 && (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Onboarding Progress</h3>
                <span className="text-sm font-medium text-purple-600">
                  {completedTasks}/{totalTasks} Completed
                </span>
              </div>
              <div className="relative pt-1">
                <div className="overflow-hidden h-3 text-xs flex rounded-full bg-gray-200">
                  <div
                    style={{ width: `${progressPercentage}%` }}
                    className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gradient-to-r from-purple-600 to-blue-600 transition-all duration-500"
                  ></div>
                </div>
                <p className="text-right text-sm text-gray-600 mt-2">{progressPercentage}% Complete</p>
              </div>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Onboarding Tasks */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-purple-600" />
                Onboarding Tasks
              </h3>

              {tasks.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p>No tasks assigned yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className={`p-4 border rounded-lg transition-colors ${
                        task.is_completed
                          ? 'bg-green-50 border-green-200'
                          : 'bg-gray-50 border-gray-200 hover:border-purple-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-0.5">
                          {task.is_completed ? (
                            <CheckCircle className="w-5 h-5 text-green-600" />
                          ) : (
                            <Clock className="w-5 h-5 text-gray-400" />
                          )}
                        </div>
                        <div className="flex-1">
                          <h4 className="text-sm font-medium text-gray-900">{task.task_name}</h4>
                          {task.task_description && (
                            <p className="text-xs text-gray-600 mt-1">{task.task_description}</p>
                          )}
                          {task.is_completed && task.completed_at && (
                            <p className="text-xs text-green-600 mt-1">
                              Completed on {formatISTDate(task.completed_at)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Documents */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Upload className="w-5 h-5 text-purple-600" />
                  Documents
                </h3>
                <button
                  onClick={() => navigate('/candidate-portal/upload')}
                  className="text-sm text-purple-600 hover:text-purple-700 font-medium"
                >
                  Upload New
                </button>
              </div>

              {documents.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p>No documents uploaded yet</p>
                  <button
                    onClick={() => navigate('/candidate-portal/upload')}
                    className="mt-4 px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700"
                  >
                    Upload Documents
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="p-4 border border-gray-200 rounded-lg hover:border-purple-300 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <FileText className="w-5 h-5 text-gray-400" />
                          <div>
                            <h4 className="text-sm font-medium text-gray-900">{doc.document_type}</h4>
                            <p className="text-xs text-gray-600 mt-0.5">{doc.file_name}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded-full ${
                              doc.verification_status === 'verified'
                                ? 'bg-green-100 text-green-800'
                                : doc.verification_status === 'rejected'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            {doc.verification_status.toUpperCase()}
                          </span>
                          <button
                            onClick={() => window.open(doc.file_url, '_blank')}
                            className="p-1 text-purple-600 hover:bg-purple-50 rounded"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Important Dates */}
          {(candidate.joining_date || candidate.salary_start_date) && (
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-2 border-purple-200 rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-purple-600" />
                Important Dates
              </h3>
              <div className="grid md:grid-cols-2 gap-4">
                {candidate.joining_date && (
                  <div className="bg-white rounded-lg p-4">
                    <p className="text-sm text-gray-600">Joining Date</p>
                    <p className="text-lg font-semibold text-gray-900 mt-1">
                      {new Date(candidate.joining_date).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                )}
                {candidate.salary_start_date && (
                  <div className="bg-white rounded-lg p-4">
                    <p className="text-sm text-gray-600">Salary Start Date</p>
                    <p className="text-lg font-semibold text-gray-900 mt-1">
                      {new Date(candidate.salary_start_date).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
