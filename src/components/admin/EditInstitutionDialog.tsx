import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Plus, Pencil, Trash2, GraduationCap, LayoutGrid, Settings2, BookOpen } from "lucide-react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sortClassRows } from "@/lib/classSort";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FeaturesSelectionStep, AVAILABLE_FEATURES } from "./institution-wizard/FeaturesSelectionStep";
import { InstitutionLogoUploader } from "./InstitutionLogoUploader";
import RenameClassDialog from "@/components/school/RenameClassDialog";
import { type ClassData } from "@/hooks/useClasses";

interface EditInstitutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string | null;
}

const currentYear = new Date().getFullYear();
const ACADEMIC_YEARS = [
  `${currentYear - 1}-${String(currentYear).slice(-2)}`,
  `${currentYear}-${String(currentYear + 1).slice(-2)}`,
  `${currentYear + 1}-${String(currentYear + 2).slice(-2)}`,
];

export function EditInstitutionDialog({ open, onOpenChange, institutionId }: EditInstitutionDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("details");
  
  const [formData, setFormData] = useState({
    name: "", code: "", contactEmail: "", contactPhone: "", address: "", isActive: true, isDemo: false,
  });

  const [newClassName, setNewClassName] = useState("");
  const [newClassSection, setNewClassSection] = useState("");
  const [newClassAcademicYear, setNewClassAcademicYear] = useState(ACADEMIC_YEARS[1]);
  const [editingClass, setEditingClass] = useState<{ id: string; name: string; section: string | null; academic_year: string } | null>(null);
  const [deleteClassId, setDeleteClassId] = useState<string | null>(null);
  const [renamingClass, setRenamingClass] = useState<ClassData | null>(null);

  // Features state
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);

  // Fetch institution
  const { data: institution } = useQuery({
    queryKey: ["institution-edit", institutionId],
    queryFn: async () => {
      if (!institutionId) return null;
      const { data } = await supabase.from("institutions").select("*").eq("id", institutionId).single();
      return data;
    },
    enabled: !!institutionId && open,
  });

  const { data: gradeLevels } = useQuery({
    queryKey: ['grade-levels'],
    queryFn: async () => {
      const { data } = await supabase.from('grade_levels').select('id, grade_name').eq('is_active', true).order('display_order');
      return data || [];
    },
    enabled: open,
  });

  const { data: classes, refetch: refetchClasses } = useQuery({
    queryKey: ["institution-classes", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];
      const { data } = await supabase
        .from("classes")
        .select("*")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name")
        .order("section");
      return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
    },
    enabled: !!institutionId && open,
  });

  // Fetch institution features
  const { data: institutionFeatures, refetch: refetchFeatures } = useQuery({
    queryKey: ["institution-features", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];
      const { data } = await supabase
        .from("institution_features")
        .select("feature_id, is_enabled")
        .eq("institution_id", institutionId)
        .eq("is_enabled", true);
      return data || [];
    },
    enabled: !!institutionId && open,
  });

  useEffect(() => {
    if (institution) {
      setFormData({
        name: institution.name, code: institution.code,
        contactEmail: institution.contact_email || "", contactPhone: institution.contact_phone || "",
        address: institution.address || "", isActive: institution.is_active ?? true,
        isDemo: institution.is_demo ?? false,
      });
    }
  }, [institution]);

  // Sync features from DB
  useEffect(() => {
    if (institutionFeatures) {
      setSelectedFeatures(institutionFeatures.map((f) => f.feature_id));
    }
  }, [institutionFeatures]);

  useEffect(() => {
    if (!open) {
      setActiveTab("details");
      setNewClassName(""); setNewClassSection("");
      setNewClassAcademicYear(ACADEMIC_YEARS[1]);
      setEditingClass(null); setSelectedFeatures([]); setRenamingClass(null);
    }
  }, [open]);

  const updateInstitution = useMutation({
    mutationFn: async () => {
      if (!institutionId) throw new Error("No institution selected");
      const { error } = await supabase.from("institutions").update({
        name: formData.name, code: formData.code,
        contact_email: formData.contactEmail || null, contact_phone: formData.contactPhone || null,
        address: formData.address || null, is_active: formData.isActive,
        is_demo: formData.isDemo,
      }).eq("id", institutionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-institutions"] });
      queryClient.invalidateQueries({ queryKey: ["institution-details", institutionId] });
      queryClient.invalidateQueries({ queryKey: ["institution-edit", institutionId] });
      // is_demo moves tickets in and out of the Support Inbox turnaround figures.
      queryClient.invalidateQueries({ queryKey: ["support-inbox-stats"] });
      toast({ title: "Institution updated successfully" });
      onOpenChange(false);
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't update this institution.", context: "updateInstitution" }),
  });

  const addClass = useMutation({
    mutationFn: async () => {
      if (!institutionId || !newClassName) throw new Error("Missing required fields");
      // class_group_id is required by the schema but is wired by the
      // onboarding wizard (which calls the admin-operations edge function).
      // This admin-edit path creates standalone sections without a group;
      // cast to `never` to bypass typegen until the form is migrated.
      const { error } = await supabase.from("classes").insert({
        name: newClassName, section: newClassSection || null,
        academic_year: newClassAcademicYear, institution_id: institutionId, is_active: true,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      refetchClasses(); queryClient.invalidateQueries({ queryKey: ["admin-institutions"] });
      setNewClassName(""); setNewClassSection("");
      toast({ title: "Class added successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add class", description: error.message, variant: "destructive" });
    },
  });

  const updateClass = useMutation({
    mutationFn: async () => {
      if (!editingClass) throw new Error("No class selected");
      const { error } = await supabase.from("classes").update({
        section: editingClass.section || null, academic_year: editingClass.academic_year,
      }).eq("id", editingClass.id);
      if (error) throw error;
    },
    onSuccess: () => {
      refetchClasses(); queryClient.invalidateQueries({ queryKey: ["admin-institutions"] });
      setEditingClass(null); toast({ title: "Class updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update class", description: error.message, variant: "destructive" });
    },
  });

  const deleteClassMut = useMutation({
    mutationFn: async (classId: string) => {
      const { error } = await supabase.from("classes").delete().eq("id", classId);
      if (error) throw error;
    },
    onSuccess: () => {
      refetchClasses();
      queryClient.invalidateQueries({ queryKey: ["admin-institutions"] });
      queryClient.invalidateQueries({ queryKey: ["class-groups", institutionId] });
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      setDeleteClassId(null);
      toast({ title: "Class deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete class", description: error.message, variant: "destructive" });
    },
  });

  // Save features mutation
  const saveFeatures = useMutation({
    mutationFn: async () => {
      if (!institutionId) throw new Error("No institution selected");

      // Get all feature IDs
      const allFeatureIds = AVAILABLE_FEATURES.map((f) => f.id);
      
      // Delete all existing features for this institution
      const { error: deleteError } = await supabase.from("institution_features").delete().eq("institution_id", institutionId);
      if (deleteError) throw deleteError;

      // Insert selected features
      if (selectedFeatures.length > 0) {
        const rows = selectedFeatures
          .filter((fid) => allFeatureIds.includes(fid))
          .map((fid) => ({
            institution_id: institutionId,
            feature_id: fid,
            is_enabled: true,
          }));
        const { error } = await supabase.from("institution_features").insert(rows);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      refetchFeatures();
      queryClient.invalidateQueries({ queryKey: ["institution-features", institutionId] });
      queryClient.invalidateQueries({ queryKey: ["admin-institutions"] });
      toast({ title: "Features updated successfully" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update features", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateInstitution.mutate();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Edit Institution</DialogTitle>
            <DialogDescription>Manage institution details, classes, and feature access</DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <TabsList className="grid w-full grid-cols-3 flex-shrink-0">
              <TabsTrigger value="details" className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4" />
                Details
              </TabsTrigger>
              <TabsTrigger value="classes" className="flex items-center gap-2">
                <GraduationCap className="h-4 w-4" />
                Classes & Sections
              </TabsTrigger>
              <TabsTrigger value="features" className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Features
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto mt-4 min-h-0" style={{ maxHeight: "calc(90vh - 220px)" }}>
              <TabsContent value="details" className="mt-0 space-y-4 pr-2">
                {institutionId && (
                  <div className="grid gap-2">
                    <Label>Institution Logo</Label>
                    <InstitutionLogoUploader
                      institutionId={institutionId}
                      logoUrl={institution?.logo_url ?? null}
                      institutionName={formData.name || institution?.name || ""}
                    />
                  </div>
                )}
                <form id="institution-form" onSubmit={handleSubmit}>
                  <div className="grid gap-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="name">Name *</Label>
                        <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="code">Code *</Label>
                        <Input id="code" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })} required />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="contactEmail">Contact Email</Label>
                        <Input id="contactEmail" type="email" value={formData.contactEmail} onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })} />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="contactPhone">Contact Phone</Label>
                        <Input id="contactPhone" type="tel" value={formData.contactPhone} onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })} />
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="address">Address</Label>
                      <Textarea id="address" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} rows={3} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Active Status</Label>
                        <p className="text-xs text-muted-foreground">Inactive institutions cannot use the platform</p>
                      </div>
                      <Switch checked={formData.isActive} onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Demo or test school</Label>
                        <p className="text-xs text-muted-foreground">SALCI's own demo or test school. Its tickets stay in the Support Inbox but are left out of SALCI turnaround figures.</p>
                      </div>
                      <Switch checked={formData.isDemo} onCheckedChange={(checked) => setFormData({ ...formData, isDemo: checked })} />
                    </div>
                  </div>
                </form>
              </TabsContent>

              <TabsContent value="classes" className="mt-0 space-y-4 pr-2">
                <div className="border rounded-lg p-4 bg-muted/30">
                  <h4 className="font-medium mb-3">Add New Class</h4>
                  <div className="grid grid-cols-4 gap-3">
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Grade/Class *</Label>
                      <SearchableSelect value={newClassName} onValueChange={setNewClassName} placeholder="Select grade" searchPlaceholder="Search..." options={gradeLevels?.map((g) => ({ value: g.grade_name, label: g.grade_name })) || []} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Section Name</Label>
                      <Input value={newClassSection} onChange={(e) => setNewClassSection(e.target.value)} placeholder="e.g., A, Golden Globes" />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Academic Year</Label>
                      <SearchableSelect value={newClassAcademicYear} onValueChange={setNewClassAcademicYear} placeholder="Select year" searchPlaceholder="Search..." options={ACADEMIC_YEARS.map((y) => ({ value: y, label: y }))} />
                    </div>
                    <div className="flex items-end">
                      <Button type="button" onClick={() => addClass.mutate()} disabled={!newClassName || addClass.isPending} className="w-full">
                        {addClass.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                        Add
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Grade</TableHead>
                        <TableHead>Section</TableHead>
                        <TableHead>Academic Year</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[140px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {classes?.length === 0 && (
                        <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No classes added yet</TableCell></TableRow>
                      )}
                      {classes?.map((cls) => (
                        <TableRow key={cls.id}>
                          <TableCell>
                            <span className="font-medium">{cls.name}</span>
                          </TableCell>
                          <TableCell>
                            {editingClass?.id === cls.id ? (
                              <Input value={editingClass.section || ""} onChange={(e) => setEditingClass({ ...editingClass, section: e.target.value })} placeholder="e.g., A, Golden Globes" className="h-9" />
                            ) : cls.section || "-"}
                          </TableCell>
                          <TableCell>
                            {editingClass?.id === cls.id ? (
                              <SearchableSelect value={editingClass.academic_year} onValueChange={(v) => setEditingClass({ ...editingClass, academic_year: v })} placeholder="Select year" searchPlaceholder="Search..." options={ACADEMIC_YEARS.map((y) => ({ value: y, label: y }))} />
                            ) : cls.academic_year}
                          </TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400'}`}>
                              {cls.is_active ? "Active" : "Inactive"}
                            </span>
                          </TableCell>
                          <TableCell>
                            {editingClass?.id === cls.id ? (
                              <div className="flex gap-1">
                                <Button size="sm" variant="default" onClick={() => updateClass.mutate()} disabled={updateClass.isPending}>
                                  {updateClass.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setEditingClass(null)}>Cancel</Button>
                              </div>
                            ) : (
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" title="Rename class" onClick={() => setRenamingClass({ ...(cls as ClassData), student_count: 0, teacher_count: 0 })}>
                                  <BookOpen className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost" title="Edit section / year" onClick={() => setEditingClass({ id: cls.id, name: cls.name, section: cls.section, academic_year: cls.academic_year })}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost" title="Delete" onClick={() => setDeleteClassId(cls.id)}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="features" className="mt-0 pr-2">
                <FeaturesSelectionStep
                  selectedFeatures={selectedFeatures}
                  onFeaturesChange={setSelectedFeatures}
                  maxHeight="350px"
                />
              </TabsContent>
            </div>
          </Tabs>

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            {activeTab === "details" && (
              <Button type="submit" form="institution-form" disabled={updateInstitution.isPending}>
                {updateInstitution.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            )}
            {activeTab === "features" && (
              <Button onClick={() => saveFeatures.mutate()} disabled={saveFeatures.isPending}>
                {saveFeatures.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Features
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteClassId} onOpenChange={() => setDeleteClassId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Class?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the class and all related assignments. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteClassId && deleteClassMut.mutate(deleteClassId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteClassMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RenameClassDialog
        classData={renamingClass}
        open={!!renamingClass}
        onOpenChange={(o) => !o && setRenamingClass(null)}
      />
    </>
  );
}
