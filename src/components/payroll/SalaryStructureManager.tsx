import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Edit, Trash2, IndianRupee, Search, FileStack, Users } from "lucide-react";
import { toast } from "sonner";
import {
  useSalaryStructures,
  useCreateSalaryStructure,
  useUpdateSalaryStructure,
  useDeleteSalaryStructure,
  type SalaryStructure,
} from "@/hooks/usePayroll";
import { useEmployees } from "@/hooks/useEmployees";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export function SalaryStructureManager() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedStructure, setSelectedStructure] = useState<SalaryStructure | null>(null);
  const [formData, setFormData] = useState({
    employee_id: "",
    basic_salary: "",
    hra: "",
    transport_allowance: "",
    medical_allowance: "",
    other_allowances: "",
    tax_deduction: "",
    other_deductions: "",
    effective_from: new Date().toISOString().split("T")[0],
  });

  const { data: structures = [], isLoading } = useSalaryStructures();
  const { data: employees = [] } = useEmployees();
  const createStructure = useCreateSalaryStructure();
  const updateStructure = useUpdateSalaryStructure();
  const deleteStructure = useDeleteSalaryStructure();

  // Filter employees who don't have a salary structure yet
  const employeesWithoutStructure = employees.filter(
    (emp) => emp.status === "active" && !structures.find((s) => s.employeeId === emp.id)
  );

  const filteredStructures = structures.filter(
    (s) =>
      s.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.employeeEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.employeeCode ?? "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const resetForm = () => {
    setFormData({
      employee_id: "",
      basic_salary: "",
      hra: "",
      transport_allowance: "",
      medical_allowance: "",
      other_allowances: "",
      tax_deduction: "",
      other_deductions: "",
      effective_from: new Date().toISOString().split("T")[0],
    });
  };

  const handleAdd = () => {
    if (!formData.employee_id || !formData.basic_salary) {
      toast.error("Employee and basic salary are required");
      return;
    }

    createStructure.mutate(
      {
        employee_id: formData.employee_id,
        basic_salary: parseFloat(formData.basic_salary),
        hra: formData.hra ? parseFloat(formData.hra) : undefined,
        transport_allowance: formData.transport_allowance ? parseFloat(formData.transport_allowance) : undefined,
        medical_allowance: formData.medical_allowance ? parseFloat(formData.medical_allowance) : undefined,
        other_allowances: formData.other_allowances ? parseFloat(formData.other_allowances) : undefined,
        tax_deduction: formData.tax_deduction ? parseFloat(formData.tax_deduction) : undefined,
        other_deductions: formData.other_deductions ? parseFloat(formData.other_deductions) : undefined,
        effective_from: formData.effective_from,
      },
      {
        onSuccess: () => {
          toast.success("Salary structure created successfully");
          setIsAddDialogOpen(false);
          resetForm();
        },
        onError: () => {
          toast.error("Failed to create salary structure");
        },
      }
    );
  };

  const handleEdit = (structure: SalaryStructure) => {
    setSelectedStructure(structure);
    setFormData({
      employee_id: structure.employeeId,
      basic_salary: structure.basicSalary.toString(),
      hra: structure.hra.toString(),
      transport_allowance: structure.transportAllowance.toString(),
      medical_allowance: structure.medicalAllowance.toString(),
      other_allowances: structure.otherAllowances.toString(),
      tax_deduction: structure.taxDeduction.toString(),
      other_deductions: structure.otherDeductions.toString(),
      effective_from: structure.effectiveFrom,
    });
    setIsEditDialogOpen(true);
  };

  const handleUpdate = () => {
    if (!selectedStructure || !formData.basic_salary) {
      toast.error("Basic salary is required");
      return;
    }

    updateStructure.mutate(
      {
        id: selectedStructure.id,
        basic_salary: parseFloat(formData.basic_salary),
        hra: formData.hra ? parseFloat(formData.hra) : 0,
        transport_allowance: formData.transport_allowance ? parseFloat(formData.transport_allowance) : 0,
        medical_allowance: formData.medical_allowance ? parseFloat(formData.medical_allowance) : 0,
        other_allowances: formData.other_allowances ? parseFloat(formData.other_allowances) : 0,
        tax_deduction: formData.tax_deduction ? parseFloat(formData.tax_deduction) : 0,
        other_deductions: formData.other_deductions ? parseFloat(formData.other_deductions) : 0,
        effective_from: formData.effective_from,
      },
      {
        onSuccess: () => {
          toast.success("Salary structure updated successfully");
          setIsEditDialogOpen(false);
          setSelectedStructure(null);
          resetForm();
        },
        onError: () => {
          toast.error("Failed to update salary structure");
        },
      }
    );
  };

  const handleDelete = (structure: SalaryStructure) => {
    setSelectedStructure(structure);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (!selectedStructure) return;

    deleteStructure.mutate(selectedStructure.id, {
      onSuccess: () => {
        toast.success("Salary structure deleted successfully");
        setIsDeleteDialogOpen(false);
        setSelectedStructure(null);
      },
      onError: () => {
        toast.error("Failed to delete salary structure");
      },
    });
  };

  const calculateNetSalary = () => {
    const basic = parseFloat(formData.basic_salary) || 0;
    const allowances =
      (parseFloat(formData.hra) || 0) +
      (parseFloat(formData.transport_allowance) || 0) +
      (parseFloat(formData.medical_allowance) || 0) +
      (parseFloat(formData.other_allowances) || 0);
    const deductions =
      (parseFloat(formData.tax_deduction) || 0) +
      (parseFloat(formData.other_deductions) || 0);
    return basic + allowances - deductions;
  };

  const SalaryFormFields = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 space-y-2">
          <Label>Basic Salary *</Label>
          <Input
            type="number"
            value={formData.basic_salary}
            onChange={(e) => setFormData({ ...formData, basic_salary: e.target.value })}
            placeholder="50000"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium text-muted-foreground">Allowances</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs">HRA</Label>
            <Input
              type="number"
              value={formData.hra}
              onChange={(e) => setFormData({ ...formData, hra: e.target.value })}
              placeholder="0"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Transport</Label>
            <Input
              type="number"
              value={formData.transport_allowance}
              onChange={(e) => setFormData({ ...formData, transport_allowance: e.target.value })}
              placeholder="0"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Medical</Label>
            <Input
              type="number"
              value={formData.medical_allowance}
              onChange={(e) => setFormData({ ...formData, medical_allowance: e.target.value })}
              placeholder="0"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Other</Label>
            <Input
              type="number"
              value={formData.other_allowances}
              onChange={(e) => setFormData({ ...formData, other_allowances: e.target.value })}
              placeholder="0"
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium text-muted-foreground">Deductions</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs">Tax</Label>
            <Input
              type="number"
              value={formData.tax_deduction}
              onChange={(e) => setFormData({ ...formData, tax_deduction: e.target.value })}
              placeholder="0"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Other</Label>
            <Input
              type="number"
              value={formData.other_deductions}
              onChange={(e) => setFormData({ ...formData, other_deductions: e.target.value })}
              placeholder="0"
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Effective From</Label>
        <Input
          type="date"
          value={formData.effective_from}
          onChange={(e) => setFormData({ ...formData, effective_from: e.target.value })}
        />
      </div>

      <div className="rounded-lg bg-primary/10 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">Net Salary</span>
          <span className="text-lg font-bold text-primary">{formatCurrency(calculateNetSalary())}</span>
        </div>
      </div>
    </div>
  );

  const uniqueTemplates = (() => {
    const map = new Map<string, { basic: number; hra: number; other: number; count: number }>();
    for (const s of structures) {
      const key = `${s.basicSalary}-${s.hra}-${s.otherAllowances}`;
      const existing = map.get(key);
      if (existing) { existing.count++; } else { map.set(key, { basic: s.basicSalary, hra: s.hra, other: s.otherAllowances, count: 1 }); }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  })();

  return (
    <Tabs defaultValue="assignments" className="space-y-4">
      <TabsList>
        <TabsTrigger value="assignments" className="gap-2"><Users className="h-4 w-4" />Employee Assignments</TabsTrigger>
        <TabsTrigger value="templates" className="gap-2"><FileStack className="h-4 w-4" />Salary Templates</TabsTrigger>
      </TabsList>

      <TabsContent value="templates" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Salary Structure Templates</CardTitle>
          </CardHeader>
          <CardContent>
            {uniqueTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No salary structures defined yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Basic</TableHead>
                    <TableHead>HRA</TableHead>
                    <TableHead>Other Allowances</TableHead>
                    <TableHead>Gross (Template)</TableHead>
                    <TableHead className="text-right">Employees</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uniqueTemplates.map((t, i) => (
                    <TableRow key={i}>
                      <TableCell>{formatCurrency(t.basic)}</TableCell>
                      <TableCell>{formatCurrency(t.hra)}</TableCell>
                      <TableCell>{formatCurrency(t.other)}</TableCell>
                      <TableCell className="font-medium">{formatCurrency(t.basic + t.hra + t.other)}</TableCell>
                      <TableCell className="text-right"><Badge variant="secondary">{t.count}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="assignments" className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search employees..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button onClick={() => setIsAddDialogOpen(true)} disabled={employeesWithoutStructure.length === 0}>
          <Plus className="mr-2 h-4 w-4" />
          Add Salary Structure
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : filteredStructures.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <IndianRupee className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="text-lg font-semibold text-foreground">No Salary Structures</h3>
            <p className="text-muted-foreground">
              {structures.length === 0
                ? "Add salary structures to enable payroll generation"
                : "No structures match your search"}
            </p>
            {structures.length === 0 && employeesWithoutStructure.length > 0 && (
              <Button className="mt-4" onClick={() => setIsAddDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add First Salary Structure
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Basic</TableHead>
                  <TableHead className="text-right">Allowances</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net Salary</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStructures.map((structure) => (
                  <TableRow key={structure.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={structure.employeeAvatar} />
                          <AvatarFallback>
                            {structure.employeeName.split(" ").map((n) => n[0]).join("")}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-foreground">{structure.employeeName}</p>
                          <p className="text-xs text-muted-foreground">{structure.employeeCode || structure.employeeEmail}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(structure.basicSalary)}
                    </TableCell>
                    <TableCell className="text-right text-emerald-600">
                      +{formatCurrency(structure.hra + structure.otherAllowances)}
                    </TableCell>
                    <TableCell className="text-right text-slate-400 text-xs">
                      At run time
                    </TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      {formatCurrency(structure.basicSalary + structure.hra + structure.otherAllowances)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(structure)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(structure)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Salary Structure</DialogTitle>
            <DialogDescription>Set up salary components for an employee.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Select Employee *</Label>
              <Select
                value={formData.employee_id}
                onValueChange={(value) => setFormData({ ...formData, employee_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose an employee" />
                </SelectTrigger>
                <SelectContent>
                  {employeesWithoutStructure.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name} - {emp.department}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <SalaryFormFields />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={createStructure.isPending}>
              {createStructure.isPending ? "Creating..." : "Create Structure"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Salary Structure</DialogTitle>
            <DialogDescription>
              Update salary for {selectedStructure?.employeeName}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <SalaryFormFields />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={updateStructure.isPending}>
              {updateStructure.isPending ? "Updating..." : "Update Structure"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Salary Structure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the salary structure for {selectedStructure?.employeeName}.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteStructure.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </TabsContent>
    </Tabs>
  );
}