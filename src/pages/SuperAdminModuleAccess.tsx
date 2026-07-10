import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import {
  Shield, Users, Search, Plus, X, Check, Lock, Unlock,
  AlertCircle, CheckCircle, Settings, Grid, List, Filter,
  UserCheck, UserX, Eye, TrendingUp
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Module {
  module_name: string;
  display_name: string;
  description: string;
  total_users: number;
}

interface ModuleAccess {
  id: string;
  module_name: string;
  employee_code: string;
  employee_name: string;
  has_access: boolean;
  granted_by: string;
  granted_at: string;
  revoked_at: string | null;
  remarks: string | null;
}

interface Employee {
  employee_code: string;
  employee_name: string;
  designation: string;
  branch: string;
  mobile: string;
  email: string;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function SuperAdminModuleAccess() {
  const [view, setView] = useState<'modules' | 'employees'>('modules');
  const [modules, setModules] = useState<Module[]>([]);
  const [accessList, setAccessList] = useState<ModuleAccess[]>([]);
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Grant Access Modal
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [grantModuleName, setGrantModuleName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Employee[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [grantRemarks, setGrantRemarks] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);

  // Filters
  const [filterModule, setFilterModule] = useState('all');
  const [filterSearch, setFilterSearch] = useState('');

  // ── Load Data ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadModules();
    loadAccessList();
  }, []);

  useEffect(() => {
    if (selectedModule) {
      loadAccessList(selectedModule);
    }
  }, [selectedModule]);

  const loadModules = async () => {
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Module[] }>(
        '/api/ats/super-admin/modules'
      );
      setModules(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load modules');
    } finally {
      setLoading(false);
    }
  };

  const loadAccessList = async (moduleName?: string) => {
    try {
      const url = moduleName
        ? `/api/ats/super-admin/module-access?module_name=${moduleName}`
        : '/api/ats/super-admin/module-access';

      const res = await hrmsApi.get<{ success: boolean; data: ModuleAccess[] }>(url);
      setAccessList(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load access list');
    }
  };

  // ── Search Employees ───────────────────────────────────────────────────────────
  const handleSearchEmployees = async () => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) return;

    setSearchLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Employee[] }>(
        `/api/ats/super-admin/search-employees?q=${encodeURIComponent(searchQuery.trim())}`
      );
      setSearchResults(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to search employees');
    } finally {
      setSearchLoading(false);
    }
  };

  // ── Grant Access ───────────────────────────────────────────────────────────────
  const handleGrantAccess = async () => {
    if (!grantModuleName || selectedEmployees.length === 0) {
      setError('Please select a module and at least one employee');
      return;
    }

    setActionLoading(true);
    setError('');
    setSuccess('');

    try {
      if (selectedEmployees.length === 1) {
        await hrmsApi.post('/api/ats/super-admin/grant-access', {
          module_name: grantModuleName,
          employee_code: selectedEmployees[0],
          remarks: grantRemarks.trim() || undefined,
        });
      } else {
        await hrmsApi.post('/api/ats/super-admin/bulk-grant', {
          module_name: grantModuleName,
          employee_codes: selectedEmployees,
          remarks: grantRemarks.trim() || undefined,
        });
      }

      setSuccess(`Access granted to ${selectedEmployees.length} employee(s)`);
      setShowGrantModal(false);
      setSelectedEmployees([]);
      setSearchQuery('');
      setSearchResults([]);
      setGrantRemarks('');
      await loadAccessList(selectedModule || undefined);
      await loadModules();
    } catch (err: any) {
      setError(err.message || 'Failed to grant access');
    } finally {
      setActionLoading(false);
    }
  };

  // ── Revoke Access ──────────────────────────────────────────────────────────────
  const handleRevokeAccess = async (moduleName: string, employeeCode: string) => {
    if (!confirm('Are you sure you want to revoke this access?')) return;

    setActionLoading(true);
    setError('');
    setSuccess('');

    try {
      await hrmsApi.post('/api/ats/super-admin/revoke-access', {
        module_name: moduleName,
        employee_code: employeeCode,
      });

      setSuccess('Access revoked successfully');
      await loadAccessList(selectedModule || undefined);
      await loadModules();
    } catch (err: any) {
      setError(err.message || 'Failed to revoke access');
    } finally {
      setActionLoading(false);
    }
  };

  // ── Filter Access List ─────────────────────────────────────────────────────────
  const filteredAccessList = accessList.filter((access) => {
    if (filterModule !== 'all' && access.module_name !== filterModule) return false;
    if (filterSearch) {
      const query = filterSearch.toLowerCase();
      return (
        access.employee_name.toLowerCase().includes(query) ||
        access.employee_code.toLowerCase().includes(query)
      );
    }
    return true;
  }).filter((access) => access.has_access && !access.revoked_at);

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
            <Shield className="w-4 h-4" />
            <span>System / Super Admin</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Module Access Control</h1>
              <p className="text-sm text-gray-600 mt-1">
                Manage employee access to system modules
              </p>
            </div>
            <button
              onClick={() => {
                setShowGrantModal(true);
                setGrantModuleName('');
                setSelectedEmployees([]);
                setSearchQuery('');
                setSearchResults([]);
              }}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 font-medium"
            >
              <Plus className="w-4 h-4" />
              Grant Access
            </button>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="text-sm text-red-800">{error}</span>
              <button
                onClick={() => setError('')}
                className="ml-2 text-red-600 hover:text-red-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {success && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="text-sm text-green-800">{success}</span>
              <button
                onClick={() => setSuccess('')}
                className="ml-2 text-green-600 hover:text-green-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* View Toggle */}
        <div className="flex gap-2 border-b border-gray-200">
          <button
            onClick={() => setView('modules')}
            className={`px-4 py-2 font-medium text-sm transition-colors ${
              view === 'modules'
                ? 'text-purple-600 border-b-2 border-purple-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <Grid className="w-4 h-4" />
              Modules
            </div>
          </button>
          <button
            onClick={() => setView('employees')}
            className={`px-4 py-2 font-medium text-sm transition-colors ${
              view === 'employees'
                ? 'text-purple-600 border-b-2 border-purple-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Access List
            </div>
          </button>
        </div>

        {/* Modules View */}
        {view === 'modules' && (
          <div>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {modules.map((module) => (
                  <div
                    key={module.module_name}
                    className="bg-white border border-gray-200 rounded-lg p-5 hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => {
                      setSelectedModule(module.module_name);
                      setView('employees');
                      setFilterModule(module.module_name);
                    }}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                        <Lock className="w-5 h-5 text-purple-600" />
                      </div>
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded">
                        {module.total_users} users
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-gray-900 mb-1">
                      {module.display_name}
                    </h3>
                    <p className="text-sm text-gray-600 line-clamp-2">
                      {module.description}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Employees View */}
        {view === 'employees' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by name or code..."
                    value={filterSearch}
                    onChange={(e) => setFilterSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                  />
                </div>
                <select
                  value={filterModule}
                  onChange={(e) => setFilterModule(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                >
                  <option value="all">All Modules</option>
                  {modules.map((m) => (
                    <option key={m.module_name} value={m.module_name}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Access List Table */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              {filteredAccessList.length === 0 ? (
                <div className="text-center py-12">
                  <UserX className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-600 font-medium">No access records found</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {filterModule !== 'all' || filterSearch
                      ? 'Try adjusting your filters'
                      : 'Grant access to employees to see them here'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Employee
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Module
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Granted By
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Granted At
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {filteredAccessList.map((access) => (
                        <tr key={access.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                                <UserCheck className="w-4 h-4 text-purple-600" />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-900">
                                  {access.employee_name}
                                </p>
                                <p className="text-xs text-gray-500">{access.employee_code}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span className="inline-flex px-2 py-1 bg-purple-100 text-purple-800 text-xs font-medium rounded">
                              {modules.find((m) => m.module_name === access.module_name)?.display_name ||
                                access.module_name}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <p className="text-sm text-gray-900">{access.granted_by}</p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="text-sm text-gray-900">
                              {formatISTDate(access.granted_at)}
                            </p>
                            <p className="text-xs text-gray-500">
                              {new Date(access.granted_at).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: 'Asia/Kolkata',
                              })}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() =>
                                  handleRevokeAccess(access.module_name, access.employee_code)
                                }
                                disabled={actionLoading}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                title="Revoke Access"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Grant Access Modal */}
      {showGrantModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Grant Module Access</h2>
            </div>

            <div className="p-6 space-y-6">
              {/* Module Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Module *
                </label>
                <select
                  value={grantModuleName}
                  onChange={(e) => setGrantModuleName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">-- Select Module --</option>
                  {modules.map((m) => (
                    <option key={m.module_name} value={m.module_name}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Employee Search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Search Employees *
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearchEmployees()}
                    placeholder="Enter name or employee code..."
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                  <button
                    onClick={handleSearchEmployees}
                    disabled={searchLoading || searchQuery.trim().length < 2}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  >
                    {searchLoading ? 'Searching...' : 'Search'}
                  </button>
                </div>
              </div>

              {/* Search Results */}
              {searchResults.length > 0 && (
                <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
                  {searchResults.map((emp) => (
                    <label
                      key={emp.employee_code}
                      className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEmployees.includes(emp.employee_code)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedEmployees([...selectedEmployees, emp.employee_code]);
                          } else {
                            setSelectedEmployees(
                              selectedEmployees.filter((code) => code !== emp.employee_code)
                            );
                          }
                        }}
                        className="w-4 h-4 text-purple-600 rounded focus:ring-2 focus:ring-purple-500"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{emp.employee_name}</p>
                        <p className="text-xs text-gray-500">
                          {emp.employee_code} • {emp.designation}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {/* Selected Count */}
              {selectedEmployees.length > 0 && (
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <p className="text-sm text-purple-800 font-medium">
                    {selectedEmployees.length} employee(s) selected
                  </p>
                </div>
              )}

              {/* Remarks */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Remarks (Optional)
                </label>
                <textarea
                  value={grantRemarks}
                  onChange={(e) => setGrantRemarks(e.target.value)}
                  rows={3}
                  placeholder="Add any notes about this access grant..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex gap-3">
              <button
                onClick={() => {
                  setShowGrantModal(false);
                  setSelectedEmployees([]);
                  setSearchQuery('');
                  setSearchResults([]);
                  setGrantRemarks('');
                }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleGrantAccess}
                disabled={
                  actionLoading || !grantModuleName || selectedEmployees.length === 0
                }
                className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {actionLoading ? 'Granting...' : 'Grant Access'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
