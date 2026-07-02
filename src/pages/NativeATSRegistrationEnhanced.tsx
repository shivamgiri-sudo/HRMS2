import React, { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Users, Building2, UserCheck, FileText, Camera, Upload, CheckCircle, AlertCircle } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface BranchAlias {
  canonical_key: string;
  display_name: string;
  alias_text?: string;
  active_status: boolean | number;
}

interface Recruiter {
  id: string;
  employee_id: string;
  employee_code: string;
  name: string;
  email: string;
  mobile?: string;
  present_today: boolean;
}

interface RegistrationForm {
  // Basic Details
  full_name: string;
  mobile: string;
  email: string;
  address: string;
  date_of_birth: string;
  gender: string;

  // Job Details
  applied_for_role: string;
  applied_for_branch: string;
  years_of_experience: string;
  education_qualification: string;
  preferred_shift: string;

  // Recruiter Assignment
  recruiter_id: string;
  sourcing_channel: string;

  // Documents
  resume_file: File | null;
  photo_file: File | null;
}

const EMPTY_FORM: RegistrationForm = {
  full_name: "",
  mobile: "",
  email: "",
  address: "",
  date_of_birth: "",
  gender: "",
  applied_for_role: "",
  applied_for_branch: "",
  years_of_experience: "",
  education_qualification: "",
  preferred_shift: "",
  recruiter_id: "",
  sourcing_channel: "Walk-in",
  resume_file: null,
  photo_file: null,
};

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeATSRegistrationEnhanced() {
  const [form, setForm] = useState<RegistrationForm>(EMPTY_FORM);
  const [branches, setBranches] = useState<BranchAlias[]>([]);
  const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [tokenNumber, setTokenNumber] = useState("");

  // ── Load Data ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    loadBranches();
  }, []);

  useEffect(() => {
    if (form.applied_for_branch) {
      loadRecruiters(form.applied_for_branch);
    }
  }, [form.applied_for_branch]);

  const loadBranches = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: BranchAlias[] }>(
        '/api/ats/registration/branch-aliases'
      );
      setBranches(res.data || []);
    } catch (err: any) {
      console.error("Failed to load branches:", err);
    }
  };

  const loadRecruiters = async (branchName: string) => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Recruiter[] }>(
        `/api/ats/registration/recruiters/${encodeURIComponent(branchName)}`
      );
      setRecruiters(res.data || []);

      // Auto-select if only one recruiter
      if (res.data && res.data.length === 1) {
        setForm(prev => ({ ...prev, recruiter_id: res.data[0].employee_id }));
      }
    } catch (err: any) {
      console.error("Failed to load recruiters:", err);
      setRecruiters([]);
    }
  };

  // ── Form Handlers ──────────────────────────────────────────────────────────────

  const handleChange = (field: keyof RegistrationForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError("");
  };

  const handleFileChange = (field: "resume_file" | "photo_file", file: File | null) => {
    setForm(prev => ({ ...prev, [field]: file }));
  };

  const validateForm = (): boolean => {
    if (!form.full_name.trim()) {
      setError("Full name is required");
      return false;
    }
    if (!/^[6-9]\d{9}$/.test(form.mobile)) {
      setError("Valid 10-digit mobile number is required");
      return false;
    }
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) {
      setError("Valid email is required");
      return false;
    }
    if (!form.applied_for_branch) {
      setError("Branch selection is required");
      return false;
    }
    if (!form.applied_for_role) {
      setError("Role is required");
      return false;
    }
    if (!form.education_qualification) {
      setError("Education is required");
      return false;
    }
    if (!form.years_of_experience) {
      setError("Experience is required");
      return false;
    }
    return true;
  };

  const uploadCandidateFile = async (
    candidateId: string,
    file: File,
    type: "resume" | "selfie"
  ) => {
    const body = new FormData();
    body.append("file", file);
    body.append("type", type);
    body.append("mobile", form.mobile);
    const apiBase = import.meta.env.VITE_HRMS_API_URL || (import.meta.env.DEV ? "http://localhost:5055" : "");
    const response = await fetch(`${apiBase}/api/ats/candidates/${candidateId}/upload`, {
      method: "POST",
      body,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || `${type} upload failed`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!validateForm()) return;

    setSubmitting(true);

    try {
      const branch = branches.find((item) => item.canonical_key === form.applied_for_branch);

      const res = await hrmsApi.post<{
        success: boolean;
        message?: string;
        tokenNumber?: string;
        candidateId?: string;
      }>('/api/ats/registration/submit-enhanced', {
        name: form.full_name.trim(),
        mobile: form.mobile,
        email: form.email || null,
        address: form.address || undefined,
        dateOfBirth: form.date_of_birth || null,
        gender: form.gender || null,
        roleApplied: form.applied_for_role,
        branchDisplayName: branch?.display_name || form.applied_for_branch,
        education: form.education_qualification,
        experience: form.years_of_experience,
        preferredShift: form.preferred_shift || null,
        preferredRecruiterId: form.recruiter_id || undefined,
        sourcingChannel: form.sourcing_channel,
      });

      if (res.success) {
        if (res.candidateId && form.resume_file) {
          await uploadCandidateFile(res.candidateId, form.resume_file, "resume");
        }
        if (res.candidateId && form.photo_file) {
          await uploadCandidateFile(res.candidateId, form.photo_file, "selfie");
        }
        setSuccess(true);
        setTokenNumber(res.tokenNumber || "Assignment pending");
        // Reset form
        setForm(EMPTY_FORM);
        setRecruiters([]);
      } else {
        setError(res.message || "Registration failed");
      }
    } catch (err: any) {
      setError(err.message || "Failed to submit registration");
    } finally {
      setSubmitting(false);
    }
  };

  const handleNewRegistration = () => {
    setSuccess(false);
    setTokenNumber("");
    setForm(EMPTY_FORM);
    setRecruiters([]);
  };

  // ── Render Success ─────────────────────────────────────────────────────────────

  if (success) {
    return (
      <DashboardLayout>
        <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-purple-50 to-blue-50">
          <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl p-8 text-center shadow-lg">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-10 h-10 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Registration Successful!</h2>
            <p className="text-gray-600 mb-6">Your token number is:</p>
            <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4 mb-6">
              <p className="text-3xl font-bold text-purple-700 font-mono">{tokenNumber}</p>
            </div>
            <p className="text-sm text-gray-600 mb-6">
              Please save this token number. You'll be called for interview shortly.
            </p>
            <button
              onClick={handleNewRegistration}
              className="w-full px-6 py-3 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition-colors"
            >
              Register Another Candidate
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ── Render Form ────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="min-h-screen p-6 bg-gradient-to-br from-purple-50 to-blue-50">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <Users className="w-8 h-8 text-purple-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Candidate Registration</h1>
                <p className="text-sm text-gray-600">Walk-in registration portal</p>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Registration Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Details */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-purple-600" />
                Basic Details
              </h3>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.full_name}
                    onChange={(e) => handleChange("full_name", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Mobile Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    value={form.mobile}
                    onChange={(e) => handleChange("mobile", e.target.value)}
                    placeholder="10-digit mobile"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => handleChange("email", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                  <select
                    value={form.gender}
                    onChange={(e) => handleChange("gender", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">Select Gender</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                  <textarea
                    value={form.address}
                    onChange={(e) => handleChange("address", e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>
            </div>

            {/* Job Details */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-purple-600" />
                Job Details
              </h3>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Branch <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.applied_for_branch}
                    onChange={(e) => {
                      handleChange("applied_for_branch", e.target.value);
                      handleChange("recruiter_id", ""); // Reset recruiter
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    required
                  >
                    <option value="">Select Branch</option>
                    {branches.filter(b => Boolean(b.active_status)).map(branch => (
                      <option key={branch.canonical_key} value={branch.canonical_key}>
                        {branch.display_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Applied Role <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.applied_for_role}
                    onChange={(e) => handleChange("applied_for_role", e.target.value)}
                    placeholder="e.g. Customer Service Executive"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Preferred Recruiter
                  </label>
                  <select
                    value={form.recruiter_id}
                    onChange={(e) => handleChange("recruiter_id", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    disabled={!form.applied_for_branch || recruiters.length === 0}
                  >
                    <option value="">
                      {!form.applied_for_branch
                        ? "Select branch first"
                        : recruiters.length === 0
                          ? "No recruiters available"
                          : "Select Recruiter"}
                    </option>
                    {recruiters.filter(recruiter => recruiter.present_today).map(recruiter => (
                      <option key={recruiter.employee_id} value={recruiter.employee_id}>
                        {recruiter.name} ({recruiter.employee_code})
                      </option>
                    ))}
                  </select>
                  {recruiters.some(recruiter => recruiter.present_today) ? (
                    <p className="text-xs text-gray-500 mt-1">
                      Only recruiters marked present today can be selected.
                    </p>
                  ) : form.applied_for_branch ? (
                    <p className="text-xs text-amber-600 mt-1">
                      No recruiter is marked present. Registration will continue for HR assignment.
                    </p>
                  ) : null}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Experience <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.years_of_experience}
                    onChange={(e) => handleChange("years_of_experience", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">Select Experience</option>
                    <option value="Fresher">Fresher</option>
                    <option value="0-1 Year">0-1 Year</option>
                    <option value="1-2 Years">1-2 Years</option>
                    <option value="2-3 Years">2-3 Years</option>
                    <option value="3-5 Years">3-5 Years</option>
                    <option value="5+ Years">5+ Years</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Education <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.education_qualification}
                    onChange={(e) => handleChange("education_qualification", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">Select Education</option>
                    <option value="10th Pass">10th Pass</option>
                    <option value="12th Pass">12th Pass</option>
                    <option value="Diploma">Diploma</option>
                    <option value="Graduate">Graduate</option>
                    <option value="Post Graduate">Post Graduate</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Preferred Shift</label>
                  <select
                    value={form.preferred_shift}
                    onChange={(e) => handleChange("preferred_shift", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">Select Shift</option>
                    <option value="Morning">Morning (6AM-2PM)</option>
                    <option value="Afternoon">Afternoon (2PM-10PM)</option>
                    <option value="Night">Night (10PM-6AM)</option>
                    <option value="Rotational">Rotational</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Documents */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-purple-600" />
                Documents (Optional)
              </h3>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Resume/CV
                  </label>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => handleFileChange("resume_file", e.target.files?.[0] || null)}
                    className="w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 cursor-pointer"
                  />
                  {form.resume_file && (
                    <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      {form.resume_file.name}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Photo
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFileChange("photo_file", e.target.files?.[0] || null)}
                    className="w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 cursor-pointer"
                  />
                  {form.photo_file && (
                    <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      {form.photo_file.name}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex items-center justify-end gap-4">
              <button
                type="button"
                onClick={handleNewRegistration}
                className="px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
                disabled={submitting}
              >
                Clear Form
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-8 py-3 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Submitting...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    Register Candidate
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </DashboardLayout>
  );
}
