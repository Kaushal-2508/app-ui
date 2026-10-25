import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadClasses } from "@/hooks/olympiad/useOlympiadClasses";
import { ClassListRow } from "@/components/olympiad/admin/ClassListRow";

export default function OlympiadClassesTab() {
  const navigate = useNavigate();
  const { data: classes, isLoading } = useOlympiadClasses();
  const [pickerOpen, setPickerOpen] = useState(false);

  const configured = (classes ?? []).filter((c) => c.subject_count > 0);
  const available = (classes ?? []).filter((c) => c.subject_count === 0);

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Classes</p>
        <Button size="sm" onClick={() => setPickerOpen(true)} disabled={available.length === 0}>
          <Plus className="h-4 w-4 mr-1" />
          Add class
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
      ) : configured.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="h-7 w-7" />}
          title="No classes configured"
          description="Add a class to start building its subjects and question bank."
          action={available.length > 0 ? { label: "Add class", onClick: () => setPickerOpen(true), icon: <Plus className="h-4 w-4" /> } : undefined}
        />
      ) : (
        <div className="space-y-2">
          {configured.map((c) => <ClassListRow key={c.grade_level_id} klass={c} />)}
        </div>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add a class</DialogTitle>
            <DialogDescription>Pick a grade level that has no Olympiad subjects yet.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {available.length === 0 ? (
              <p className="text-sm text-ink-600">All grade levels already have classes.</p>
            ) : (
              available.map((c) => (
                <button
                  key={c.grade_level_id}
                  onClick={() => { setPickerOpen(false); navigate(`/admin/olympiad/classes/${c.grade_level_id}`); }}
                  className="w-full text-left flex items-center gap-3 rounded-md border border-surface-stroke p-3 hover:bg-surface-card/80 transition-colors"
                >
                  <GraduationCap className="h-4 w-4 text-brand-primary" />
                  <span className="text-sm font-medium text-ink-900">{c.grade_name}</span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
