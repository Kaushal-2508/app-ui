import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useEmployeeLevels, useCreateEmployeeLevel, useUpdateEmployeeLevel, useDeleteEmployeeLevel, EmployeeLevel } from "@/hooks/useEmployeeLevels";
import { Layers, Plus, Pencil, Trash2, Shield, Hash, ShieldCheck } from "lucide-react";
import { GradientKPICard } from "@/components/ui/gradient-kpi-card";
import { DashboardSection } from "@/components/ui/dashboard-section";

const DEFAULT_PERMISSIONS = [
  // User Management
  { key: "can_create_users", label: "Create Users", category: "User Management", description: "Create new user accounts" },
  { key: "can_edit_users", label: "Edit Users", category: "User Management", description: "Modify user profiles and details" },
  { key: "can_delete_users", label: "Delete Users", category: "User Management", description: "Remove user accounts" },
  { key: "can_assign_roles", label: "Assign Roles", category: "User Management", description: "Change user roles" },
  { key: "can_reset_passwords", label: "Reset Passwords", category: "User Management", description: "Reset user passwords" },
  { key: "can_manage_parents", label: "Manage Parents", category: "User Management", description: "Link/unlink parent accounts" },
  
  // Exam Management
  { key: "can_create_exams", label: "Create Exams", category: "Exam Management", description: "Create new examinations" },
  { key: "can_edit_exams", label: "Edit Exams", category: "Exam Management", description: "Modify existing exams" },
  { key: "can_delete_exams", label: "Delete Exams", category: "Exam Management", description: "Remove examinations" },
  { key: "can_publish_exams", label: "Publish Exams", category: "Exam Management", description: "Make exams visible to students" },
  { key: "can_evaluate", label: "Evaluate Answers", category: "Exam Management", description: "Grade student responses" },
  { key: "can_finalize_results", label: "Finalize Results", category: "Exam Management", description: "Lock and publish final results" },
  { key: "can_manage_question_bank", label: "Manage Question Bank", category: "Exam Management", description: "Add/edit/delete questions" },
  { key: "can_use_ai_questions", label: "Use AI Questions", category: "Exam Management", description: "Generate questions using AI" },
  
  // Class & Student Management
  { key: "can_manage_students", label: "Manage Students", category: "Class Management", description: "Add/edit student records" },
  { key: "can_manage_classes", label: "Manage Classes", category: "Class Management", description: "Create and configure classes" },
  { key: "can_assign_classes", label: "Assign Classes", category: "Class Management", description: "Assign teachers to classes" },
  { key: "can_manage_sections", label: "Manage Sections", category: "Class Management", description: "Create class sections" },
  { key: "can_manage_subjects", label: "Manage Subjects", category: "Class Management", description: "Add/edit subjects" },
  { key: "can_bulk_operations", label: "Bulk Operations", category: "Class Management", description: "Perform bulk imports/exports" },
  
  // Syllabus & Content
  { key: "can_manage_syllabus", label: "Manage Syllabus", category: "Content", description: "Add/edit syllabus topics" },
  { key: "can_manage_materials", label: "Manage Materials", category: "Content", description: "Upload study materials" },
  { key: "can_approve_content", label: "Approve Content", category: "Content", description: "Approve submitted content" },
  
  // Analytics & Reports
  { key: "can_view_reports", label: "View Reports", category: "Analytics", description: "Access report dashboards" },
  { key: "can_export_reports", label: "Export Reports", category: "Analytics", description: "Download report data" },
  { key: "can_view_analytics", label: "View Analytics", category: "Analytics", description: "Access analytics dashboard" },
  { key: "can_view_audit_logs", label: "View Audit Logs", category: "Analytics", description: "Access activity logs" },
  { key: "can_view_ai_usage", label: "View AI Usage", category: "Analytics", description: "Monitor AI quota usage" },
  
  // Tasks & Approvals
  { key: "can_approve_tasks", label: "Approve Tasks", category: "Tasks", description: "Approve pending tasks" },
  { key: "can_create_tasks", label: "Create Tasks", category: "Tasks", description: "Assign tasks to staff" },
  { key: "can_manage_learning_actions", label: "Manage Learning Actions", category: "Tasks", description: "Approve student learning tasks" },
  
  // Proctoring
  { key: "can_view_proctoring", label: "View Proctoring", category: "Proctoring", description: "Access proctoring alerts" },
  { key: "can_review_violations", label: "Review Violations", category: "Proctoring", description: "Review exam violations" },
  
  // Financial
  { key: "can_view_billing", label: "View Billing", category: "Financial", description: "View payment records" },
  { key: "can_manage_billing", label: "Manage Billing", category: "Financial", description: "Process payments" },
  { key: "can_generate_receipts", label: "Generate Receipts", category: "Financial", description: "Create payment receipts" },
  
  // System & Admin
  { key: "can_use_ai", label: "Use AI Features", category: "System", description: "Access AI-powered features" },
  { key: "can_manage_settings", label: "Manage Settings", category: "System", description: "Configure system settings" },
  { key: "can_manage_institutions", label: "Manage Institutions", category: "System", description: "Add/edit institutions" },
  { key: "can_manage_employee_levels", label: "Manage Employee Levels", category: "System", description: "Configure permission levels" },
  { key: "super_admin_access", label: "Super Admin Access", category: "System", description: "Full system access" },
];

export default function EmployeeLevelsPage() {
  const { data: levels = [], isLoading } = useEmployeeLevels();
  const createLevel = useCreateEmployeeLevel();
  const updateLevel = useUpdateEmployeeLevel();
  const deleteLevel = useDeleteEmployeeLevel();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLevel, setEditingLevel] = useState<EmployeeLevel | null>(null);
  const [formData, setFormData] = useState({
    level_name: "",
    level_number: 1,
    description: "",
    permissions: {} as Record<string, boolean>,
  });

  const resetForm = () => {
    setFormData({
      level_name: "",
      level_number: levels.length + 1,
      description: "",
      permissions: {},
    });
    setEditingLevel(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setFormData(prev => ({ ...prev, level_number: levels.length + 1 }));
    setIsDialogOpen(true);
  };

  const openEditDialog = (level: EmployeeLevel) => {
    setEditingLevel(level);
    setFormData({
      level_name: level.level_name,
      level_number: level.level_number,
      description: level.description || "",
      permissions: (level.permissions as Record<string, boolean>) || {},
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (editingLevel) {
      await updateLevel.mutateAsync({
        id: editingLevel.id,
        level_name: formData.level_name,
        level_number: formData.level_number,
        description: formData.description || null,
        permissions: formData.permissions,
      });
    } else {
      await createLevel.mutateAsync({
        level_name: formData.level_name,
        level_number: formData.level_number,
        description: formData.description,
        permissions: formData.permissions,
      });
    }
    setIsDialogOpen(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    await deleteLevel.mutateAsync(id);
  };

  const togglePermission = (key: string) => {
    setFormData(prev => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [key]: !prev.permissions[key],
      },
    }));
  };

  // Calculate total permissions across all levels
  const totalPermissions = levels.reduce((sum, level) => {
    const perms = (level.permissions as Record<string, boolean>) || {};
    return sum + Object.values(perms).filter(Boolean).length;
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-md">
              <Layers className="h-5 w-5" />
            </div>
            Employee Levels
          </h1>
          <p className="text-muted-foreground mt-1">
            Define permission levels for staff hierarchy (L1-L5)
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Add Level
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingLevel ? "Edit Level" : "Create Level"}</DialogTitle>
              <DialogDescription>
                {editingLevel ? "Update employee level details" : "Define a new employee permission level"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Level Name</Label>
                  <Input
                    placeholder="e.g., Senior Teacher"
                    value={formData.level_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, level_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Level Number</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={formData.level_number}
                    onChange={(e) => setFormData(prev => ({ ...prev, level_number: parseInt(e.target.value) || 1 }))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  placeholder="Describe this level's responsibilities..."
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>
              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Permissions
                </Label>
                <div className="max-h-[400px] overflow-y-auto space-y-6 pr-2">
                  {Array.from(new Set(DEFAULT_PERMISSIONS.map(p => p.category))).map((category) => (
                    <div key={category} className="space-y-2">
                      <div className="flex items-center justify-between sticky top-0 bg-background py-1">
                        <h4 className="text-sm font-semibold text-primary">{category}</h4>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-xs h-6"
                          onClick={() => {
                            const categoryPerms = DEFAULT_PERMISSIONS.filter(p => p.category === category);
                            const allEnabled = categoryPerms.every(p => formData.permissions[p.key]);
                            const newPerms = { ...formData.permissions };
                            categoryPerms.forEach(p => {
                              newPerms[p.key] = !allEnabled;
                            });
                            setFormData(prev => ({ ...prev, permissions: newPerms }));
                          }}
                        >
                          Toggle All
                        </Button>
                      </div>
                      <div className="space-y-2">
                        {DEFAULT_PERMISSIONS.filter(p => p.category === category).map((perm) => (
                          <div 
                            key={perm.key} 
                            className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${
                              formData.permissions[perm.key] ? "bg-primary/5 border-primary/30" : ""
                            }`}
                          >
                            <div className="flex-1">
                              <span className="text-sm font-medium">{perm.label}</span>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {perm.description}
                              </p>
                            </div>
                            <Switch
                              checked={formData.permissions[perm.key] || false}
                              onCheckedChange={() => togglePermission(perm.key)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="pt-3 border-t">
                  <p className="text-sm text-muted-foreground">
                    {Object.values(formData.permissions).filter(Boolean).length} of {DEFAULT_PERMISSIONS.length} permissions enabled
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleSubmit}
                disabled={!formData.level_name || createLevel.isPending || updateLevel.isPending}
              >
                {editingLevel ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
        <GradientKPICard
          icon={Layers}
          value={levels.length}
          label="Total Levels"
          variant="purple"
          infoTooltip="Number of employee permission levels defined in the system."
        />
        <GradientKPICard
          icon={Hash}
          value={DEFAULT_PERMISSIONS.length}
          label="Available Permissions"
          variant="blue"
          infoTooltip="Total number of granular permissions that can be assigned to each level."
        />
        <GradientKPICard
          icon={ShieldCheck}
          value={totalPermissions}
          label="Active Permissions"
          subLabel="across all levels"
          variant="emerald"
          infoTooltip="Sum of all enabled permissions across all employee levels."
        />
      </div>

      {/* Levels Table */}
      <DashboardSection
        title="Permission Levels"
        description="Higher level numbers typically have more permissions"
        icon={Shield}
        iconGradient="from-violet-500 to-fuchsia-600"
      >
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : levels.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Layers className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No employee levels defined yet</p>
            <p className="text-sm">Create levels like L1 (Junior), L2 (Senior), etc.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[80px]">Level</TableHead>
                  <TableHead className="min-w-[120px]">Name</TableHead>
                  <TableHead className="min-w-[150px]">Description</TableHead>
                  <TableHead className="min-w-[100px]">Permissions</TableHead>
                  <TableHead className="text-right min-w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {levels.map((level) => {
                  const perms = (level.permissions as Record<string, boolean>) || {};
                  const enabledPerms = Object.entries(perms).filter(([, v]) => v).length;
                  
                  return (
                    <TableRow key={level.id}>
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          L{level.level_number}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{level.level_name}</TableCell>
                      <TableCell className="text-muted-foreground max-w-[200px] truncate">
                        {level.description || "N/A"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {enabledPerms} of {DEFAULT_PERMISSIONS.length}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(level)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Level</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete "{level.level_name}"? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(level.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DashboardSection>
    </div>
  );
}
