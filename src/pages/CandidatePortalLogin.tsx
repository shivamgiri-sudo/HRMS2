import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hrmsApi } from '@/lib/hrmsApi';
import {
  User, Lock, Eye, EyeOff, LogIn, AlertCircle,
  CheckCircle, Building2, UserCheck
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface LoginResponse {
  success: boolean;
  message?: string;
  candidate?: {
    id: string;
    full_name: string;
    mobile: string;
    email: string;
    applied_for_role: string;
    applied_for_branch: string;
    current_stage: string;
  };
  token?: string;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function CandidatePortalLogin() {
  const navigate = useNavigate();
  const [candidateId, setCandidateId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ── Handle Login ───────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!candidateId.trim()) {
      setError('Please enter your Candidate ID');
      return;
    }

    if (!password.trim()) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);

    try {
      const res = await hrmsApi.post<LoginResponse>('/api/ats/candidate-portal/login', {
        candidate_id: candidateId.trim(),
        password: password.trim(),
      });

      if (res.success && res.token) {
        // Store token and candidate info
        localStorage.setItem('candidate_token', res.token);
        localStorage.setItem('candidate_info', JSON.stringify(res.candidate));

        setSuccess('Login successful! Redirecting...');

        // Redirect to portal dashboard
        setTimeout(() => {
          navigate('/candidate-portal/dashboard');
        }, 1500);
      } else {
        setError(res.message || 'Login failed. Please check your credentials.');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-purple-600 to-blue-600 rounded-2xl mb-4">
            <UserCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Candidate Portal</h1>
          <p className="text-sm text-gray-600 mt-2">
            Welcome to Mas Callnet India Pvt. Ltd.
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Sign In</h2>
            <p className="text-sm text-gray-600 mt-1">
              Enter your credentials received via email
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-red-800">{error}</span>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-green-800">{success}</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Candidate ID */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Candidate ID *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  value={candidateId}
                  onChange={(e) => setCandidateId(e.target.value)}
                  placeholder="e.g., ATS001234"
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  disabled={loading}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Check your email for your Candidate ID
              </p>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  disabled={loading}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                  ) : (
                    <Eye className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg font-medium hover:from-purple-700 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Signing in...
                </>
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  Sign In
                </>
              )}
            </button>
          </form>

          {/* Help Text */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="space-y-3 text-sm text-gray-600">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
                <p>
                  <strong>First time login?</strong> Use the credentials sent to your email after selection.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
                <p>
                  <strong>Forgot password?</strong> Contact HR at{' '}
                  <a href="mailto:hr@mascallnet.com" className="text-purple-600 hover:underline">
                    hr@mascallnet.com
                  </a>
                </p>
              </div>
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
                <p>
                  <strong>Need help?</strong> Contact HR at{' '}
                  <a href="mailto:hr@mascallnet.com" className="text-purple-600 hover:underline">
                    hr@mascallnet.com
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-sm text-gray-600">
          <p>© 2024 Mas Callnet India Pvt. Ltd. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
