import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  FlaskConical,
  Library,
  Monitor,
  Dumbbell,
  Boxes,
} from "lucide-react";
import { SharedResourceForm } from "@/components/school/SharedResourceForm";
import {
  RESOURCE_TYPE_LABELS,
  type ResourceType,
  type SharedResourceInput,
} from "@/hooks/useSharedResources";

interface SharedResourcesStepProps {
  resources: SharedResourceInput[];
  confirmedEmpty: boolean;
  onResourcesChange: (resources: SharedResourceInput[]) => void;
  onConfirmedEmptyChange: (value: boolean) => void;
}

const RESOURCE_ICON: Record<
  ResourceType,
  React.ComponentType<{ className?: string }>
> = {
  lab: FlaskConical,
  library: Library,
  computer_room: Monitor,
  sports_facility: Dumbbell,
  other: Boxes,
};

type Mode = "unanswered" | "adding" | "has-resources" | "none";

export function SharedResourcesStep({
  resources,
  confirmedEmpty,
  onResourcesChange,
  onConfirmedEmptyChange,
}: SharedResourcesStepProps) {
  const initialMode: Mode = confirmedEmpty
    ? "none"
    : resources.length > 0
      ? "has-resources"
      : "unanswered";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const handleYes = () => {
    onConfirmedEmptyChange(false);
    setMode(resources.length > 0 ? "has-resources" : "adding");
  };

  const handleNo = () => {
    onResourcesChange([]);
    onConfirmedEmptyChange(true);
    setMode("none");
    setEditingIndex(null);
  };

  const handleAddSubmit = (input: SharedResourceInput) => {
    onResourcesChange([...resources, input]);
    setMode("has-resources");
  };

  const handleEditSubmit = (input: SharedResourceInput) => {
    if (editingIndex === null) return;
    const next = resources.slice();
    next[editingIndex] = input;
    onResourcesChange(next);
    setEditingIndex(null);
    setMode("has-resources");
  };

  const handleRemove = (index: number) => {
    onResourcesChange(resources.filter((_, i) => i !== index));
  };

  const showingForm = mode === "adding" || editingIndex !== null;

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Shared Resources
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-1">
          <h3 className="font-medium">
            Does your school have shared rooms like labs or a library?
          </h3>
          <p className="text-sm text-muted-foreground">
            These are rooms used across wings. The timetable will make sure
            two classes don&apos;t book the same one at the same time.
          </p>
        </div>

        {mode === "unanswered" && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              className="h-auto py-4 flex-col items-start text-left"
              onClick={handleYes}
            >
              <span className="font-semibold">Yes, we have shared rooms</span>
              <span className="text-xs text-muted-foreground font-normal">
                Add labs, library, computer room, etc.
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-auto py-4 flex-col items-start text-left"
              onClick={handleNo}
            >
              <span className="font-semibold">No shared rooms</span>
              <span className="text-xs text-muted-foreground font-normal">
                Classrooms only, no school-wide rooms to schedule.
              </span>
            </Button>
          </div>
        )}

        {mode === "none" && (
          <Alert className="border-emerald-300 bg-emerald-50">
            <CheckCircle2 className="h-4 w-4 text-emerald-700" />
            <AlertTitle className="text-emerald-800">
              Confirmed: no shared resources
            </AlertTitle>
            <AlertDescription className="text-emerald-700">
              The timetable builder won&apos;t ask about room conflicts. You can
              add shared resources later from Settings → Shared Resources.
              <div className="mt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleYes}
                >
                  Actually, I want to add some
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {(mode === "has-resources" || mode === "adding") && (
          <div className="space-y-4">
            {/* Existing resources list */}
            {resources.length > 0 && editingIndex === null && mode !== "adding" && (
              <div className="space-y-2">
                {resources.map((r, idx) => {
                  const Icon = RESOURCE_ICON[r.resource_type];
                  return (
                    <div
                      key={`${r.name}-${idx}`}
                      className="flex items-start justify-between gap-3 border rounded-lg p-3"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="space-y-0.5 min-w-0">
                          <div className="font-medium truncate">{r.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {RESOURCE_TYPE_LABELS[r.resource_type]}
                          </div>
                          {r.description && (
                            <div className="text-xs text-muted-foreground truncate">
                              {r.description}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="secondary">
                          {r.count} room{r.count === 1 ? "" : "s"}
                        </Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingIndex(idx)}
                          aria-label="Edit resource"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleRemove(idx)}
                          aria-label="Remove resource"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Inline form */}
            {showingForm ? (
              <Card className="border-dashed">
                <CardContent className="p-4 space-y-4">
                  <div className="font-medium">
                    {editingIndex !== null
                      ? "Edit resource"
                      : "New shared resource"}
                  </div>
                  <SharedResourceForm
                    initial={
                      editingIndex !== null ? resources[editingIndex] : null
                    }
                    onSubmit={
                      editingIndex !== null
                        ? handleEditSubmit
                        : handleAddSubmit
                    }
                    onCancel={() => {
                      setEditingIndex(null);
                      setMode(
                        resources.length > 0 ? "has-resources" : "unanswered",
                      );
                    }}
                    submitLabel={
                      editingIndex !== null ? "Save changes" : "Add resource"
                    }
                  />
                </CardContent>
              </Card>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setMode("adding")}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add another resource
              </Button>
            )}

            {resources.length > 0 && !showingForm && (
              <div className="text-xs text-muted-foreground">
                Not seeing a type you need? Pick <em>Other</em> and name it
                (e.g. &quot;Auditorium&quot;).
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
