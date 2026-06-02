import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { hrmsApi } from '@/lib/hrmsApi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { useToast } from '../../hooks/use-toast';

export default function NativeCustomizationRuleEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditMode = !!id;

  const [form, setForm] = useState({
    ruleName: '',
    entityType: '',
    entityId: '',
    configType: 'override' as 'override' | 'merge' | 'extend' | 'disable',
    configData: '{}',
    priority: 0,
    effectiveFrom: '',
    effectiveTo: '',
    branchIds: [] as string[],
    processIds: [] as string[],
    departmentIds: [] as string[],
    designationIds: [] as string[],
    roleIds: [] as string[],
    employeeIds: [] as string[],
  });

  const [jsonError, setJsonError] = useState('');

  // Load rule if editing
  const { data: rule } = useQuery({
    queryKey: ['customization-rule', id],
    queryFn: async () => {
      if (!id) return null;
      const res = await hrmsApi.get(`/customization/rules/${id}`);
      return res.data;
    },
    enabled: isEditMode,
  });

  useEffect(() => {
    if (rule) {
      setForm({
        ruleName: rule.rule_name || '',
        entityType: rule.entity_type || '',
        entityId: rule.entity_id || '',
        configType: rule.config_type || 'override',
        configData: JSON.stringify(rule.config_data || {}, null, 2),
        priority: rule.priority || 0,
        effectiveFrom: rule.effective_from || '',
        effectiveTo: rule.effective_to || '',
        branchIds: rule.branch_ids || [],
        processIds: rule.process_ids || [],
        departmentIds: rule.department_ids || [],
        designationIds: rule.designation_ids || [],
        roleIds: rule.role_ids || [],
        employeeIds: rule.employee_ids || [],
      });
    }
  }, [rule]);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (isEditMode) {
        return hrmsApi.patch(`/customization/rules/${id}`, data);
      } else {
        return hrmsApi.post('/customization/rules', data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customization-rules'] });
      toast({
        title: isEditMode ? 'Rule updated' : 'Rule created',
        description: `${form.ruleName} has been saved.`,
      });
      navigate('/customization');
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.response?.data?.message || 'Failed to save rule',
        variant: 'destructive',
      });
    },
  });

  const handleConfigChange = (value: string) => {
    setForm({ ...form, configData: value });
    try {
      JSON.parse(value);
      setJsonError('');
    } catch (err) {
      setJsonError('Invalid JSON');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate JSON
    let configData;
    try {
      configData = JSON.parse(form.configData);
    } catch (err) {
      setJsonError('Invalid JSON - cannot save');
      return;
    }

    const payload = {
      ruleName: form.ruleName,
      entityType: form.entityType,
      entityId: form.entityId || undefined,
      configType: form.configType,
      configData,
      priority: form.priority,
      effectiveFrom: form.effectiveFrom || undefined,
      effectiveTo: form.effectiveTo || undefined,
      branchIds: form.branchIds.length > 0 ? form.branchIds : undefined,
      processIds: form.processIds.length > 0 ? form.processIds : undefined,
      departmentIds: form.departmentIds.length > 0 ? form.departmentIds : undefined,
      designationIds: form.designationIds.length > 0 ? form.designationIds : undefined,
      roleIds: form.roleIds.length > 0 ? form.roleIds : undefined,
      employeeIds: form.employeeIds.length > 0 ? form.employeeIds : undefined,
    };

    saveMutation.mutate(payload);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/customization')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <h1 className="text-3xl font-bold">
          {isEditMode ? 'Edit Rule' : 'Create Rule'}
        </h1>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-6">
        {/* Basic Info */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold border-b pb-2">Basic Information</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="ruleName">Rule Name *</Label>
              <Input
                id="ruleName"
                value={form.ruleName}
                onChange={(e) => setForm({ ...form, ruleName: e.target.value })}
                placeholder="Mumbai Branch Extended Leave"
                required
              />
            </div>

            <div>
              <Label htmlFor="entityType">Entity Type *</Label>
              <Input
                id="entityType"
                value={form.entityType}
                onChange={(e) => setForm({ ...form, entityType: e.target.value })}
                placeholder="leave_type, attendance_policy, salary_component"
                required
              />
              <p className="text-xs text-gray-500 mt-1">Examples: leave_type, attendance_policy, salary_component, approval_workflow</p>
            </div>

            <div>
              <Label htmlFor="entityId">Entity ID (optional)</Label>
              <Input
                id="entityId"
                value={form.entityId}
                onChange={(e) => setForm({ ...form, entityId: e.target.value })}
                placeholder="UUID of specific entity"
              />
              <p className="text-xs text-gray-500 mt-1">Leave blank to apply to all entities of this type</p>
            </div>

            <div>
              <Label htmlFor="configType">Config Type *</Label>
              <Select value={form.configType} onValueChange={(val: any) => setForm({ ...form, configType: val })}>
                <SelectTrigger id="configType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="override">Override (replace values)</SelectItem>
                  <SelectItem value="merge">Merge (deep merge objects)</SelectItem>
                  <SelectItem value="extend">Extend (append to arrays)</SelectItem>
                  <SelectItem value="disable">Disable (mark as disabled)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="priority">Priority</Label>
              <Input
                id="priority"
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
              />
              <p className="text-xs text-gray-500 mt-1">Higher priority = applied last = wins</p>
            </div>
          </div>
        </div>

        {/* Config Data */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold border-b pb-2">Configuration Data (JSON)</h2>
          <div>
            <Label htmlFor="configData">Config JSON *</Label>
            <Textarea
              id="configData"
              value={form.configData}
              onChange={(e) => handleConfigChange(e.target.value)}
              rows={10}
              className="font-mono text-sm"
              placeholder='{"max_days_per_year": 15, "carry_forward": false}'
            />
            {jsonError && <p className="text-red-600 text-sm mt-1">{jsonError}</p>}
            <p className="text-xs text-gray-500 mt-1">
              Examples: <code>{`{"max_days_per_year": 15}`}</code> or <code>{`{"grace_period_minutes": 15}`}</code>
            </p>
          </div>
        </div>

        {/* Date Range */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold border-b pb-2">Effective Date Range (Optional)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="effectiveFrom">From Date</Label>
              <Input
                id="effectiveFrom"
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="effectiveTo">To Date</Label>
              <Input
                id="effectiveTo"
                type="date"
                value={form.effectiveTo}
                onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* Dimension Filters */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold border-b pb-2">Dimension Filters (Optional)</h2>
          <p className="text-sm text-gray-600">
            Leave all blank to apply to everyone. Add UUIDs to filter by dimension.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="roleIds">Role IDs (comma-separated)</Label>
              <Input
                id="roleIds"
                value={form.roleIds.join(', ')}
                onChange={(e) => setForm({ ...form, roleIds: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="admin, hr, manager"
              />
            </div>
            <div>
              <Label htmlFor="branchIds">Branch UUIDs (comma-separated)</Label>
              <Input
                id="branchIds"
                value={form.branchIds.join(', ')}
                onChange={(e) => setForm({ ...form, branchIds: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="branch-uuid-1, branch-uuid-2"
              />
            </div>
            <div>
              <Label htmlFor="processIds">Process UUIDs (comma-separated)</Label>
              <Input
                id="processIds"
                value={form.processIds.join(', ')}
                onChange={(e) => setForm({ ...form, processIds: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="process-uuid-1, process-uuid-2"
              />
            </div>
            <div>
              <Label htmlFor="departmentIds">Department UUIDs (comma-separated)</Label>
              <Input
                id="departmentIds"
                value={form.departmentIds.join(', ')}
                onChange={(e) => setForm({ ...form, departmentIds: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="dept-uuid-1, dept-uuid-2"
              />
            </div>
            <div>
              <Label htmlFor="designationIds">Designation UUIDs (comma-separated)</Label>
              <Input
                id="designationIds"
                value={form.designationIds.join(', ')}
                onChange={(e) => setForm({ ...form, designationIds: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="designation-uuid-1"
              />
            </div>
            <div>
              <Label htmlFor="employeeIds">Employee UUIDs (comma-separated)</Label>
              <Input
                id="employeeIds"
                value={form.employeeIds.join(', ')}
                onChange={(e) => setForm({ ...form, employeeIds: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="employee-uuid-1"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-4 pt-4 border-t">
          <Button type="button" variant="outline" onClick={() => navigate('/customization')}>
            Cancel
          </Button>
          <Button type="submit" disabled={saveMutation.isPending || !!jsonError}>
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? 'Saving...' : isEditMode ? 'Update Rule' : 'Create Rule'}
          </Button>
        </div>
      </form>
    </div>
  );
}
