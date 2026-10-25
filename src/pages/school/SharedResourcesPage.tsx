import { useState } from "react";
import {
  Building2,
  FlaskConical,
  Library,
  Monitor,
  Dumbbell,
  Boxes,
  Plus,
  Pencil,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageShell, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/surfaces";
import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";
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
import { useUserRole } from "@/hooks/useUserRole";
import { useIsTimetableManager } from "@/hooks/useIsTimetableManager";
import {
  RESOURCE_TYPE_LABELS,
  useSharedResources,
  type ResourceType,
  type SharedResource,
  type SharedResourceInput,
} from "@/hooks/useSharedResources";
import { SharedResourceForm } from "@/components/school/SharedResourceForm";

const RESOURCE_ICON: Record<ResourceType, React.ComponentType<{ className?: string }>> = {
  lab: FlaskConical,
  library: Library,
  computer_room: Monitor,
  sports_facility: Dumbbell,
  other: Boxes,
};

// One tint per kind so a row of mixed rooms scans by colour as well as icon.
const RESOURCE_TONE: Record<ResourceType, Tone> = {
  lab: "violet",
  library: "peach",
  computer_room: "sky",
  sports_facility: "mint",
  other: "teal",
};

export default function SharedResourcesPage() {
  const { data: roleInfo } = useUserRole();
  // Per-user override grant (tt_manager_overrides): resources are part of
  // the timetable module, so the grant confers full manage rights here too.
  const { isTimetableManager } = useIsTimetableManager();
  const canEdit = !!(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin) || isTimetableManager;

  const {
    resources,
    isLoading,
    isError,
    error,
    createResource,
    updateResource,
    deleteResource,
  } = useSharedResources();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editing, setEditing] = useState<SharedResource | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SharedResource | null>(
    null,
  );

  const handleCreate = async (input: SharedResourceInput) => {
    await createResource.mutateAsync(input);
    setShowAddForm(false);
  };

  const handleUpdate = async (input: SharedResourceInput) => {
    if (!editing) return;
    await updateResource.mutateAsync({ id: editing.id, ...input });
    setEditing(null);
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    await deleteResource.mutateAsync(pendingDelete.id);
    setPendingDelete(null);
  };

  const isSubmitting = createResource.isPending || updateResource.isPending;
  const formOpen = canEdit && (showAddForm || editing !== null);
  const closeForm = () => {
    setShowAddForm(false);
    setEditing(null);
  };

  return (
    <PageShell>
      <PageHeader
        icon={<Building2 className="h-5 w-5" />}
        title="Shared Resources"
        subtitle="Rooms shared across the school, such as labs, the library and computer rooms. The timetable uses them to stop two classes booking one room."
        primaryAction={
          canEdit
            ? {
                label: "Add resource",
                icon: <Plus className="h-4 w-4" />,
                onClick: () => {
                  setEditing(null);
                  setShowAddForm(true);
                },
              }
            : undefined
        }
      />

      <div className="space-y-6">
      {isError && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load resources</AlertTitle>
          <AlertDescription>
            {error?.message ?? "Please refresh and try again."}
          </AlertDescription>
        </Alert>
      )}

      {/* Add / edit live in one centred dialog instead of a page-wide inline
          form: four fields stretched across a laptop read as a wall, and the
          list they belong to was pushed below the fold. */}
      <Dialog open={formOpen} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit resource" : "New shared resource"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Rename the room, change its kind, or adjust how many of it there are."
                : "Name the room and say how many of that kind the school has."}
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <SharedResourceForm
              key={editing.id}
              initial={{
                name: editing.name,
                resource_type: editing.resource_type,
                count: editing.count,
                description: editing.description,
              }}
              onSubmit={handleUpdate}
              onCancel={closeForm}
              isSubmitting={updateResource.isPending}
              submitLabel="Save changes"
            />
          ) : (
            <SharedResourceForm
              key="new"
              onSubmit={handleCreate}
              onCancel={closeForm}
              isSubmitting={createResource.isPending}
              submitLabel="Add resource"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* List */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full rounded-card" />
          ))}
        </div>
      ) : !isError && resources.length === 0 ? (
        <div className="surface-card frosted-shadow">
          <EmptyState
            icon={<Building2 className="h-7 w-7" />}
            title="No shared resources yet"
            description='Add rooms like "Science Lab" or "Library" so the timetable can stop the same room being booked by two classes at once.'
            action={
              canEdit
                ? {
                    label: "Add your first resource",
                    icon: <Plus className="h-4 w-4" />,
                    onClick: () => setShowAddForm(true),
                  }
                : undefined
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {resources.map((r) => {
            const Icon = RESOURCE_ICON[r.resource_type];
            const t = TONES[RESOURCE_TONE[r.resource_type]];
            return (
              <article
                key={r.id}
                className="surface-card frosted-shadow flex flex-col gap-3 p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-card-lg md:p-5"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "relative inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl shadow-card-sm ring-1 ring-inset ring-white/60 dark:ring-white/10",
                      t.bg,
                      t.fg,
                    )}
                  >
                    <span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/60 to-transparent dark:from-white/10" aria-hidden />
                    <Icon className="relative h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-ink-900">{r.name}</p>
                    <p className="eyebrow mt-0.5">{RESOURCE_TYPE_LABELS[r.resource_type]}</p>
                  </div>
                  <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-ink-400/10 px-2.5 text-xs font-semibold tabular-nums text-ink-700">
                    <Users className="h-3.5 w-3.5" aria-hidden />
                    {r.count} {r.count === 1 ? "room" : "rooms"}
                  </span>
                </div>

                {r.description && (
                  <p className="line-clamp-2 text-sm text-ink-600">{r.description}</p>
                )}

                {canEdit && (
                  <div className="mt-auto flex justify-end gap-1 border-t border-surface-stroke pt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-ink-700"
                      onClick={() => {
                        setShowAddForm(false);
                        setEditing(r);
                      }}
                      disabled={isSubmitting}
                    >
                      <Pencil className="mr-1.5 h-4 w-4" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-destructive hover:text-destructive"
                      onClick={() => setPendingDelete(r)}
                      disabled={isSubmitting}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      </div>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this shared resource?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.name} will no longer be selectable in the
              timetable builder. Existing bookings referencing it will need to
              be cleared first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteResource.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteResource.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
