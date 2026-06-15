import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreHorizontal,
  Eye,
  Edit,
  FileText,
  ChevronDown,
  UserX,
  UserCheck,
  Mail,
  Download,
  UserCog,
  Trash2,
  KeyRound
} from "lucide-react";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { SortDirection } from "@/hooks/useSorting";
import { employeeStatusStyles } from "@/lib/statusStyles";

export interface Employee {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  phone?: string | null;
  avatar?: string;
  department: string;
  process: string;
  branch: string;
  costCentre: string;
  reportingManager: string;
  officialEmailCompliant: boolean;
  designation: string;
  joinDate: string;
  status: "active" | "inactive" | "onboarding" | "offboarded";
}

interface EmployeeTableProps {
  employees: Employee[];
  onView?: (employee: Employee) => void;
  onEdit?: (employee: Employee) => void;
  onResetPassword?: (employee: Employee) => void;
  onManageDocuments?: (employee: Employee) => void;
  isAdminOrHR?: boolean;
  canResetPassword?: boolean;
  sortKey?: keyof Employee | null;
  sortDirection?: SortDirection;
  onSort?: (key: keyof Employee) => void;
  // Bulk selection props
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onBulkAction?: (action: string, ids: string[]) => void;
}

const statusStyles = employeeStatusStyles;

export function EmployeeTable({
  employees,
  onView,
  onEdit,
  onResetPassword,
  onManageDocuments,
  isAdminOrHR = false,
  canResetPassword = false,
  sortKey,
  sortDirection,
  onSort,
  selectedIds = [],
  onSelectionChange,
  onBulkAction,
}: EmployeeTableProps) {
  const handleSort = (key: string) => {
    onSort?.(key as keyof Employee);
  };

  const allSelected = employees.length > 0 && selectedIds.length === employees.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < employees.length;

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      onSelectionChange?.(employees.map(e => e.id));
    } else {
      onSelectionChange?.([]);
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    if (checked) {
      onSelectionChange?.([...selectedIds, id]);
    } else {
      onSelectionChange?.(selectedIds.filter(selectedId => selectedId !== id));
    }
  };

  const showBulkActions = isAdminOrHR && onSelectionChange && onBulkAction;

  return (
    <div className="space-y-4">
      {/* Bulk Actions Bar */}
      {showBulkActions && selectedIds.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-3">
          <span className="text-sm font-medium">
            {selectedIds.length} employee{selectedIds.length > 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Bulk Actions
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onBulkAction?.('export', selectedIds)}>
                  <Download className="mr-2 h-4 w-4" />
                  Export Selected
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onBulkAction?.('email', selectedIds)}>
                  <Mail className="mr-2 h-4 w-4" />
                  Send Email
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onBulkAction?.('assign-manager', selectedIds)}>
                  <UserCog className="mr-2 h-4 w-4" />
                  Assign Manager
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onBulkAction?.('activate', selectedIds)}>
                  <UserCheck className="mr-2 h-4 w-4" />
                  Set as Active
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onBulkAction?.('deactivate', selectedIds)}>
                  <UserX className="mr-2 h-4 w-4" />
                  Set as Inactive
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={() => onBulkAction?.('delete', selectedIds)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Selected
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => onSelectionChange?.([])}
            >
              Clear Selection
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {showBulkActions && (
                <TableHead className="w-[50px]">
                  <Checkbox 
                    checked={allSelected}
                    onCheckedChange={handleSelectAll}
                    aria-label="Select all"
                    className={someSelected ? "data-[state=checked]:bg-primary" : ""}
                    {...(someSelected ? { "data-state": "checked" } : {})}
                  />
                </TableHead>
              )}
              {onSort ? (
                <>
                  <SortableTableHead
                    sortKey="employeeCode"
                    currentSortKey={sortKey ?? null}
                    direction={sortKey === "employeeCode" ? sortDirection ?? null : null}
                    onSort={handleSort}
                    className="w-[100px]"
                  >
                    Emp. No.
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="name"
                    currentSortKey={sortKey ?? null}
                    direction={sortKey === "name" ? sortDirection ?? null : null}
                    onSort={handleSort}
                    className="w-[260px]"
                  >
                    Employee
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="department"
                    currentSortKey={sortKey ?? null}
                    direction={sortKey === "department" ? sortDirection ?? null : null}
                    onSort={handleSort}
                  >
                    Department
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="process"
                    currentSortKey={sortKey ?? null}
                    direction={sortKey === "process" ? sortDirection ?? null : null}
                    onSort={handleSort}
                  >
                    Process / Cost Centre
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="reportingManager"
                    currentSortKey={sortKey ?? null}
                    direction={sortKey === "reportingManager" ? sortDirection ?? null : null}
                    onSort={handleSort}
                  >
                    Reporting Manager
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="designation"
                    currentSortKey={sortKey ?? null}
                    direction={sortKey === "designation" ? sortDirection ?? null : null}
                    onSort={handleSort}
                  >
                    Designation
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="joinDate"
                    currentSortKey={sortKey ?? null}
                    direction={sortKey === "joinDate" ? sortDirection ?? null : null}
                    onSort={handleSort}
                  >
                    Join Date
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="status"
                    currentSortKey={sortKey ?? null}
                    direction={sortKey === "status" ? sortDirection ?? null : null}
                    onSort={handleSort}
                  >
                    Status
                  </SortableTableHead>
                </>
              ) : (
                <>
                  <TableHead className="w-[100px]">Emp. No.</TableHead>
                  <TableHead className="w-[260px]">Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Process / Cost Centre</TableHead>
                  <TableHead>Reporting Manager</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Join Date</TableHead>
                  <TableHead>Status</TableHead>
                </>
              )}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.map((employee) => (
              <TableRow 
                key={employee.id}
                className={selectedIds.includes(employee.id) ? "bg-primary/5" : ""}
              >
                {showBulkActions && (
                  <TableCell>
                    <Checkbox 
                      checked={selectedIds.includes(employee.id)}
                      onCheckedChange={(checked) => handleSelectOne(employee.id, checked as boolean)}
                      aria-label={`Select ${employee.name}`}
                    />
                  </TableCell>
                )}
                <TableCell className="font-mono text-sm text-muted-foreground">
                  {employee.employeeCode}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={employee.avatar} />
                      <AvatarFallback>
                        {employee.name.split(" ").map((n) => n[0]).join("")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-foreground">{employee.name}</p>
                      <p className="text-sm text-muted-foreground">{employee.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{employee.department}</TableCell>
                <TableCell className="text-muted-foreground">
                  <div className="font-medium text-slate-700">{employee.process}</div>
                  <div className="text-xs text-slate-500">{employee.costCentre}</div>
                </TableCell>
                <TableCell className="text-muted-foreground">{employee.reportingManager}</TableCell>
                <TableCell className="text-muted-foreground">{employee.designation}</TableCell>
                <TableCell className="text-muted-foreground">{employee.joinDate}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={statusStyles[employee.status]}>
                    {employee.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Open actions for ${employee.name}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onView?.(employee)}>
                        <Eye className="mr-2 h-4 w-4" />
                        View Profile
                      </DropdownMenuItem>
                      {isAdminOrHR && (
                        <>
                          <DropdownMenuItem onClick={() => onEdit?.(employee)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onManageDocuments?.(employee)}>
                            <FileText className="mr-2 h-4 w-4" />
                            Documents
                          </DropdownMenuItem>
                        </>
                      )}
                      {canResetPassword && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => onResetPassword?.(employee)}
                            className="text-amber-600 focus:text-amber-700"
                          >
                            <KeyRound className="mr-2 h-4 w-4" />
                            Reset Password
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
