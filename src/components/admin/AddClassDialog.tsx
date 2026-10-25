import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { Plus } from "lucide-react";
import { useCreateClass } from "@/hooks/useClasses";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface AddClassDialogProps {
  institutionId: string;
  trigger?: React.ReactNode;
}

const SECTIONS = ["A", "B", "C", "D", "E", "F"];

const currentYear = new Date().getFullYear();
const ACADEMIC_YEARS = [
  `${currentYear - 1}-${String(currentYear).slice(-2)}`,
  `${currentYear}-${String(currentYear + 1).slice(-2)}`,
  `${currentYear + 1}-${String(currentYear + 2).slice(-2)}`,
];

export default function AddClassDialog({ institutionId, trigger }: AddClassDialogProps) {
  const [open, setOpen] = useState(false);
  
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
    academic_year: ACADEMIC_YEARS[1], // Current year
    is_active: true,
  });

  const createClass = useCreateClass();

  const handleSubmit = async () => {
    if (!formData.name) {
      return;
    }

    await createClass.mutateAsync({
      name: formData.name,
      section: formData.section || null,
      academic_year: formData.academic_year,
      institution_id: institutionId,
      is_active: formData.is_active,
    });

    setOpen(false);
    setFormData({
      name: "",
      section: "",
      academic_year: ACADEMIC_YEARS[1],
      is_active: true,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add Class
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Class</DialogTitle>
          <DialogDescription>
            Create a new class section for your institution. You can assign subjects to this class later from the Subjects page.
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
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!formData.name || createClass.isPending}>
            {createClass.isPending ? "Creating..." : "Create Class"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
