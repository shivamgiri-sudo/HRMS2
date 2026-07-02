import { useState } from 'react';
import { Plus, Settings, ToggleLeft, ToggleRight, Trash2, Edit2, Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { hrmsApi } from '@/lib/hrmsApi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';

interface CustomizationRule {
  id: string;
  rule_name: string;
  entity_type: string;
  entity_id?: string;
  config_type: 'override' | 'merge' | 'extend' | 'disable';
  priority: number;
  is_active: number;
  effective_from?: string;
  effective_to?: string;
  branch_ids?: string[];
  process_ids?: string[];
  department_ids?: string[];
  designation_ids?: string[];
  role_ids?: string[];
  employee_ids?: string[];
  created_at: string;
}

export default function NativeCustomizationManager() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    entityType: '',
    isActive: 'active',
    page: 1,
    limit: 50,
  });

  const { data: rulesData, isLoading } = useQuery({
    queryKey: ['customization-rules', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.entityType) params.append('entityType', filters.entityType);
      params.append('isActive', filters.isActive);
      params.append('page', filters.page.toString());
      params.append('limit', filters.limit.toString());
      const res = await hrmsApi.get(`/api/customization/rules?${params}`);
      return res.data;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      return hrmsApi.post(`/api/customization/rules/${ruleId}/toggle`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customization-rules'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      return hrmsApi.delete(`/api/customization/rules/${ruleId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customization-rules'] });
    },
  });

  const rules = rulesData?.data || [];
  const total = rulesData?.total || 0;

  const configTypeColors: Record<string, string> = {
    override: 'bg-orange-100 text-orange-700',
    merge: 'bg-blue-100 text-blue-700',
    extend: 'bg-green-100 text-green-700',
    disable: 'bg-red-100 text-red-700',
  };

  const getDimensionCount = (rule: CustomizationRule) => {
    return [
      rule.branch_ids?.length || 0,
      rule.process_ids?.length || 0,
      rule.department_ids?.length || 0,
      rule.designation_ids?.length || 0,
      rule.role_ids?.length || 0,
      rule.employee_ids?.length || 0,
    ].reduce((sum, count) => sum + count, 0);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Settings className="w-8 h-8 text-blue-600" />
            Customization Manager
          </h1>
          <p className="text-gray-600 mt-1">
            Configure rules for branch, process, department, designation, and role-based customization
          </p>
        </div>
        <Button className="flex items-center gap-2" onClick={() => navigate('/customization/new')}>
          <Plus className="w-4 h-4" />
          Create Rule
        </Button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Entity Type</label>
            <input
              type="text"
              placeholder="leave_type, attendance_policy, etc."
              value={filters.entityType}
              onChange={(e) => setFilters({ ...filters, entityType: e.target.value, page: 1 })}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Status</label>
            <select
              value={filters.isActive}
              onChange={(e) => setFilters({ ...filters, isActive: e.target.value as any, page: 1 })}
              className="w-full border rounded px-3 py-2"
            >
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
      </div>

      {/* Rules List */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">
            Customization Rules ({total})
          </h2>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading rules...</div>
        ) : rules.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No rules found. Create your first customization rule to get started.
          </div>
        ) : (
          <div className="divide-y">
            {rules.map((rule: CustomizationRule) => (
              <div key={rule.id} className="p-4 hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-lg">{rule.rule_name}</h3>
                      <Badge className={configTypeColors[rule.config_type]}>
                        {rule.config_type}
                      </Badge>
                      {rule.is_active ? (
                        <Badge className="bg-green-100 text-green-700">Active</Badge>
                      ) : (
                        <Badge className="bg-gray-100 text-gray-700">Inactive</Badge>
                      )}
                      <Badge variant="outline">Priority: {rule.priority}</Badge>
                    </div>

                    <div className="text-sm text-gray-600 space-y-1">
                      <p>
                        <span className="font-medium">Entity:</span> {rule.entity_type}
                        {rule.entity_id && ` (${rule.entity_id.slice(0, 8)}...)`}
                      </p>
                      <p>
                        <span className="font-medium">Dimensions:</span> {getDimensionCount(rule)} filters applied
                        {rule.branch_ids?.length ? ` | ${rule.branch_ids.length} branch(es)` : ''}
                        {rule.process_ids?.length ? ` | ${rule.process_ids.length} process(es)` : ''}
                        {rule.department_ids?.length ? ` | ${rule.department_ids.length} department(s)` : ''}
                        {rule.designation_ids?.length ? ` | ${rule.designation_ids.length} designation(s)` : ''}
                        {rule.role_ids?.length ? ` | ${rule.role_ids.length} role(s)` : ''}
                        {rule.employee_ids?.length ? ` | ${rule.employee_ids.length} employee(s)` : ''}
                      </p>
                      {(rule.effective_from || rule.effective_to) && (
                        <p>
                          <span className="font-medium">Effective:</span>{' '}
                          {rule.effective_from || 'Any'} → {rule.effective_to || 'Any'}
                        </p>
                      )}
                      <p className="text-xs text-gray-500">
                        Created: {formatIST(rule.created_at)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/customization/${rule.id}/edit`)}>
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleMutation.mutate(rule.id)}
                      disabled={toggleMutation.isPending}
                    >
                      {rule.is_active ? (
                        <ToggleRight className="w-4 h-4 text-green-600" />
                      ) : (
                        <ToggleLeft className="w-4 h-4 text-gray-400" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm(`Delete rule "${rule.rule_name}"?`)) {
                          deleteMutation.mutate(rule.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {total > filters.limit && (
          <div className="px-6 py-4 border-t flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Showing {(filters.page - 1) * filters.limit + 1} -{' '}
              {Math.min(filters.page * filters.limit, total)} of {total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={filters.page === 1}
                onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={filters.page * filters.limit >= total}
                onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
