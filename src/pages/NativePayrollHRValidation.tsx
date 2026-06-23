import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { ChevronRight, Calendar, DollarSign, User, Building, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { SecureDocumentList } from '@/components/documents/SecureDocumentList';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PendingCandidate {
  candidate_id: string;
  full_name: string;
  mobile: string;
  email: string;
  applied_for_role: string;
  applied_for_branch: string;
  branch_display_name: string;
  bgv_status: string;
  bgv_completed_at: string;
  education: string;
  years_of_experience: string;
  onboarding_submitted_at: string;
}

interface ValidationFormData {
  employment_type: 'onroll' | 'offrole';
  company_id: string;
  designation_id: string;
  department_id: string;
  process_id: string;
  cost_centre_id: string;
  reporting_manager_id: string;
  salary_slab_id: string;
  gross_salary: number;
  requested_gross_salary: number;
  salary_exception_reason: string;
  joining_date: string;
  salary_start_date: string;
  shift_id: string;
  remarks: string;
}

interface SalaryBreakdown {
  gross: number;
  components: {
    basic: number;
    hra: number;
    conveyance: number;
    specialAllowance: number;
  };
  deductions: {
    pf: number;
    esic: number;
    total: number;
  };
  net: number;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativePayrollHRValidation() {
  const [view, setView] = useState<'list' | 'validate'>('list');
  const [candidates, setCandidates] = useState<PendingCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<PendingCandidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Master data
  const [companies, setCompanies] = useState<any[]>([]);
  const [designations, setDesignations] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [processes, setProcesses] = useState<any[]>([]);
  const [costCentres, setCostCentres] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [salarySlabs, setSalarySlabs] = useState<any[]>([]);

  const [formData, setFormData] = useState<ValidationFormData>({
    employment_type: 'onroll',
    company_id: '',
    designation_id: '',
    department_id: '',
    process_id: '',
    cost_centre_id: '',
    reporting_manager_id: '',
    salary_slab_id: '',
    gross_salary: 0,
    requested_gross_salary: 0,
    salary_exception_reason: '',
    joining_date: '',
    salary_start_date: '',
    shift_id: '',
    remarks: '',
  });

  const [breakdown, setBreakdown] = useState<SalaryBreakdown | null>(null);
  const [calculatingBreakdown, setCalculatingBreakdown] = useState(false);

  // ── Load pending candidates ────────────────────────────────────────────────
  useEffect(() => {
    if (view === 'list') {
      loadPendingCandidates();
    }
  }, [view]);

  const loadPendingCandidates = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await hrmsApi.get('/api/ats/payroll-hr/pending-candidates');
      setCandidates(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load candidates');
    } finally {
      setLoading(false);
    }
  };

  // ── Load master data ───────────────────────────────────────────────────────
  useEffect(() => {
    loadMasterData();
  }, []);

  const loadMasterData = async () => {
    try {
      const [
        companiesRes,
        designationsRes,
        departmentsRes,
        processesRes,
        costCentresRes,
        managersRes,
        shiftsRes,
        salarySlabsRes,
      ] = await Promise.all([
        hrmsApi.get('/api/org/companies'),
        hrmsApi.get('/api/org/designations'),
        hrmsApi.get('/api/org/departments'),
        hrmsApi.get('/api/org/processes'),
        hrmsApi.get('/api/org/cost-centres'),
        hrmsApi.get('/api/employees?role=manager'),
        hrmsApi.get('/api/wfm/shifts'),
        hrmsApi.get('/api/payroll-masters/slabs'),
      ]);

      setCompanies(companiesRes.data || []);
      setDesignations(designationsRes.data || []);
      setDepartments(departmentsRes.data || []);
      setProcesses(processesRes.data || []);
      setCostCentres(costCentresRes.data || []);
      setManagers(managersRes.data || []);
      setShifts(shiftsRes.data || []);
      setSalarySlabs(salarySlabsRes.data || []);
    } catch (err) {
      console.error('Failed to load master data:', err);
    }
  };

  // ── Calculate salary breakdown ─────────────────────────────────────────────
  const calculateBreakdown = async () => {
    if (!formData.salary_slab_id || !formData.gross_salary || formData.gross_salary <= 0) {
      setError('Please select an active salary slab');
      return;
    }

    setCalculatingBreakdown(true);
    setError('');
    try {
      const res = await hrmsApi.post('/api/ats/payroll-hr/calculate-breakdown', {
        gross_salary: formData.gross_salary,
        employment_type: formData.employment_type,
      });
      setBreakdown(res.data);
    } catch (err: any) {
      setError(err.message || 'Failed to calculate breakdown');
    } finally {
      setCalculatingBreakdown(false);
    }
  };

  // ── Submit validation ──────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selectedCandidate) return;

    // Validation
    if (!formData.joining_date) {
      setError('Joining date is required');
      return;
    }
    if (!formData.salary_slab_id) {
      setError('Salary slab is required');
      return;
    }
    if (formData.requested_gross_salary && formData.requested_gross_salary !== formData.gross_salary && !formData.salary_exception_reason.trim()) {
      setError('Salary exception reason is required when requested gross differs from the slab.');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      await hrmsApi.post('/api/ats/payroll-hr/validate', {
        candidate_id: selectedCandidate.candidate_id,
        ...formData,
      });

      setSuccess('Salary validation completed successfully!');
      setTimeout(() => {
        setView('list');
        setSelectedCandidate(null);
        resetForm();
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to submit validation');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      employment_type: 'onroll',
      company_id: '',
      designation_id: '',
      department_id: '',
      process_id: '',
      cost_centre_id: '',
      reporting_manager_id: '',
      salary_slab_id: '',
      gross_salary: 0,
      requested_gross_salary: 0,
      salary_exception_reason: '',
      joining_date: '',
      salary_start_date: '',
      shift_id: '',
      remarks: '',
    });
    setBreakdown(null);
  };

  // ── View: List ─────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <DashboardLayout>
        <div className="p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Payroll HR Validation</h1>
            <p className="text-sm text-gray-600 mt-1">
              BGV verified candidates pending salary assignment
            </p>
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
              <CheckCircle className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600">No pending candidates</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {candidates.map((candidate) => (
                <div
                  key={candidate.candidate_id}
                  className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => {
                    setSelectedCandidate(candidate);
                    setView('validate');
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-gray-900">{candidate.full_name}</h3>
                        <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">
                          BGV Verified
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="flex items-center gap-2 text-gray-600">
                          <User className="w-4 h-4" />
                          <span>{candidate.applied_for_role}</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-600">
                          <Building className="w-4 h-4" />
                          <span>{candidate.branch_display_name}</span>
                        </div>
                        <div className="text-gray-600">
                          <span className="font-medium">Education:</span> {candidate.education}
                        </div>
                        <div className="text-gray-600">
                          <span className="font-medium">Experience:</span> {candidate.years_of_experience}
                        </div>
                      </div>

                      <div className="mt-2 text-xs text-gray-500">
                        BGV Completed: {new Date(candidate.bgv_completed_at).toLocaleDateString()}
                      </div>
                    </div>

                    <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DashboardLayout>
    );
  }

  // ── View: Validate ─────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto">
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
          <h1 className="text-2xl font-bold text-gray-900">Salary Validation</h1>
          <p className="text-sm text-gray-600 mt-1">{selectedCandidate?.full_name}</p>
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
          {selectedCandidate?.candidate_id && (
            <SecureDocumentList candidateId={selectedCandidate.candidate_id} />
          )}

          {/* Employment Details */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Employment Details</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Employment Type *
                </label>
                <select
                  value={formData.employment_type}
                  onChange={(e) =>
                    setFormData({ ...formData, employment_type: e.target.value as 'onroll' | 'offrole' })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="onroll">On Roll (PF + ESIC)</option>
                  <option value="offrole">Off Roll (No PF/ESIC)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company *</label>
                <select
                  value={formData.company_id}
                  onChange={(e) => setFormData({ ...formData, company_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">Select Company</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.company_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Designation *</label>
                <select
                  value={formData.designation_id}
                  onChange={(e) => setFormData({ ...formData, designation_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">Select Designation</option>
                  {designations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.designation_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Department *</label>
                <select
                  value={formData.department_id}
                  onChange={(e) => setFormData({ ...formData, department_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">Select Department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.department_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Process *</label>
                <select
                  value={formData.process_id}
                  onChange={(e) => setFormData({ ...formData, process_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">Select Process</option>
                  {processes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.process_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cost Centre *</label>
                <select
                  value={formData.cost_centre_id}
                  onChange={(e) => setFormData({ ...formData, cost_centre_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">Select Cost Centre</option>
                  {costCentres.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.cost_centre_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reporting Manager *</label>
                <select
                  value={formData.reporting_manager_id}
                  onChange={(e) => setFormData({ ...formData, reporting_manager_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">Select Manager</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name} ({m.employee_code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shift</label>
                <select
                  value={formData.shift_id}
                  onChange={(e) => setFormData({ ...formData, shift_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">Select Shift</option>
                  {shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.shift_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Salary Details */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Salary Details</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Salary Slab *
                </label>
                <select
                  value={formData.salary_slab_id}
                  onChange={(e) => {
                    const slab = salarySlabs.find((s) => s.id === e.target.value);
                    const gross = slab ? Number(slab.range_to || 0) : 0;
                    setFormData({ ...formData, salary_slab_id: e.target.value, gross_salary: gross, requested_gross_salary: 0 });
                    setBreakdown(null);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">Select active slab</option>
                  {salarySlabs.filter((s) => Number(s.active_status ?? 1) === 1).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label || s.slab_code} (₹{Number(s.range_from || 0).toLocaleString()} - ₹{Number(s.range_to || 0).toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Gross Salary From Slab *
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="number"
                    value={formData.gross_salary || ''}
                    readOnly
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Salary Exception Proposal
                </label>
                <input
                  type="number"
                  value={formData.requested_gross_salary || ''}
                  onChange={(e) => setFormData({ ...formData, requested_gross_salary: parseFloat(e.target.value) || 0 })}
                  placeholder="Only if different from slab"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>

              {formData.requested_gross_salary > 0 && formData.requested_gross_salary !== formData.gross_salary && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Exception Reason *
                  </label>
                  <textarea
                    value={formData.salary_exception_reason}
                    onChange={(e) => setFormData({ ...formData, salary_exception_reason: e.target.value })}
                    placeholder="Required for Branch Head review"
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                  />
                </div>
              )}

              <button
                onClick={calculateBreakdown}
                disabled={calculatingBreakdown || !formData.gross_salary}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {calculatingBreakdown ? 'Calculating...' : 'Calculate Breakdown'}
              </button>

              {breakdown && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <h3 className="font-semibold text-gray-900 mb-3">Salary Breakdown</h3>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Basic (40%)</span>
                      <span className="font-medium">₹{breakdown.components.basic.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">HRA (30%)</span>
                      <span className="font-medium">₹{breakdown.components.hra.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Conveyance (10%)</span>
                      <span className="font-medium">₹{breakdown.components.conveyance.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Special Allowance</span>
                      <span className="font-medium">
                        ₹{breakdown.components.specialAllowance.toLocaleString()}
                      </span>
                    </div>

                    {formData.employment_type === 'onroll' && (
                      <>
                        <div className="border-t border-gray-300 my-2"></div>
                        <div className="flex justify-between text-red-600">
                          <span>PF (12% of basic)</span>
                          <span className="font-medium">-₹{breakdown.deductions.pf.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-red-600">
                          <span>ESIC (0.75% of gross)</span>
                          <span className="font-medium">-₹{breakdown.deductions.esic.toLocaleString()}</span>
                        </div>
                      </>
                    )}

                    <div className="border-t border-gray-300 my-2"></div>
                    <div className="flex justify-between font-semibold text-lg">
                      <span className="text-gray-900">Net Salary</span>
                      <span className="text-green-600">₹{breakdown.net.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Date Details - YOUR FEATURE */}
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-2 border-purple-200 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-5 h-5 text-purple-600" />
              <h2 className="text-lg font-semibold text-gray-900">Date Details</h2>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-800">
                <strong>Important:</strong> Set joining date and salary start date carefully.
                Salary generation will begin from the salary start date.
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Joining Date * <span className="text-xs text-gray-500">(Physical day 1 in office)</span>
                </label>
                <input
                  type="date"
                  value={formData.joining_date}
                  onChange={(e) => setFormData({ ...formData, joining_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Salary Start Date{' '}
                  <span className="text-xs text-gray-500">(If blank, defaults to joining date)</span>
                </label>
                <input
                  type="date"
                  value={formData.salary_start_date}
                  onChange={(e) => setFormData({ ...formData, salary_start_date: e.target.value })}
                  min={formData.joining_date}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
            </div>

            {formData.joining_date && formData.salary_start_date && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                <strong>Training Period:</strong>{' '}
                {Math.ceil(
                  (new Date(formData.salary_start_date).getTime() -
                    new Date(formData.joining_date).getTime()) /
                    (1000 * 60 * 60 * 24)
                )}{' '}
                days
              </div>
            )}
          </div>

          {/* Remarks */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
            <textarea
              value={formData.remarks}
              onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
              placeholder="Additional notes (e.g., training period details)"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-4">
            <button
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
              onClick={handleSubmit}
                disabled={submitting || !formData.joining_date || !formData.salary_slab_id || !formData.gross_salary}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {submitting ? 'Submitting...' : 'Save & Send for Approval'}
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
