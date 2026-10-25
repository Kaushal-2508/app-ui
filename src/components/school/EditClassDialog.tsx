import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { useUpdateClass, ClassData } from "@/hooks/useClasses";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface EditClassDialogProps {
  classData: ClassData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SECTIONS = ["A", "B", "C", "D", "E", "F"];

const currentYear = new Date().getFullYear();
const ACADEMIC_YEARS = [
  `${currentYear - 1}-${String(currentYear).slice(-2)}`,
  `${currentYear}-${String(currentYear + 1).slice(-2)}`,
  `${currentYear + 1}-${String(currentYear + 2).slice(-2)}`,
];

export default function EditClassDialog({ classData, open, onOpenChange }: EditClassDialogProps) {
  // Fetch grade levels dynamically
  const { data: gradeLevels } = useQuery({
    queryKey: ['grade-levels'],
    queryFn: async () => {
      const { data } = await supabase
        .from('grade_levels')
        .select('id, grade_name')
        .eq('is_active', true)
        .order('display_order');
      return data || [];
    }
  });

  const [formData, setFormData] = useState({
    name: "",
    section: "",
    academic_year: "",
    is_active: true,
  });

  const updateClass = useUpdateClass();

  useEffect(() => {
    if (classData) {
      setFormData({
        name: classData.name,
        section: classData.section || "",
        academic_year: classData.academic_year,
        is_active: classData.is_active ?? true,
      });
    }
  }, [classData]);

  const handleSubmit = async () => {
    if (!classData || !formData.name) return;

    await updateClass.mutateAsync({
      id: classData.id,
      name: formData.name,
      section: formData.section || null,
      academic_year: formData.academic_year,
      is_active: formData.is_active,
    });

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Class</DialogTitle>
          <DialogDescription>
            Update class details.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Grade/Class</Label>
            <SearchableSelect
              value={formData.name}
              onValueChange={(value) => setFormData({ ...formData, name: value })}
              placeholder="Select grade"
              searchPlaceholder="Search grades..."
              options={gradeLevels?.map((grade) => ({
                value: grade.grade_name,
                label: grade.grade_name,
              })) || []}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="section">Section</Label>
            <SearchableSelect
              value={formData.section}
              onValueChange={(value) => setFormData({ ...formData, section: value })}
              placeholder="Select section"
              searchPlaceholder="Search sections..."
              options={SECTIONS.map((section) => ({
                value: section,
                label: `Section ${section}`,
              }))}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="academic_year">Academic Year</Label>
            <SearchableSelect
              value={formData.academic_year}
              onValueChange={(value) => setFormData({ ...formData, academic_year: value })}
              placeholder="Select academic year"
              searchPlaceholder="Search years..."
              options={ACADEMIC_YEARS.map((year) => ({
                value: year,
                label: year,
              }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="is_active">Active</Label>
            <Switch
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!formData.name || updateClass.isPending}>
            {updateClass.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
