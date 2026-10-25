import { useState } from "react";
import {
  CalendarClock,
  Clock,
  Layers,
  Link2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { currentAcademicYear } from "@/hooks/useAcademicCalendar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
  useTtPeriodStructures,
  useDeletePeriodStructure,
  useTtResources,
  useDeleteResource,
  type TtPeriodStructureRow,
  type TtResourceRow,
} from "@/hooks/useTimetableV2";
import PeriodStructureDialogV2 from "./PeriodStructureDialogV2";
import ResourceDialogV2 from "./ResourceDialogV2";
import AssignStructureDialogV2 from "./AssignStructureDialogV2";

type SheetMode = "all" | "structures" | "resources";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: SheetMode;
}

const SHEET_COPY: Record<SheetMode, { title: string; description: string }> = {
  all: {
    title: "Timetable settings",
    description: "Manage period structures and shared resources for your school.",
  },
  structures: {
    title: "Period structures",
    description: "Weekly grids of periods + breaks. One structure can be assigned to many classes.",
  },
  resources: {
    title: "Shared resources",
    description: "Labs, libraries, rooms, and sports facilities that can be booked from the slot drawer.",
  },
};

export default function SettingsSheetV2({ open, onOpenChange, mode = "all" }: Props) {
  const copy = SHEET_COPY[mode];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg w-full flex flex-col">
        <SheetHeader>
          <SheetTitle>{copy.title}</SheetTitle>
          <SheetDescription>{copy.description}</SheetDescription>
        </SheetHeader>

        {mode === "structures" ? (
          <div className="flex-1 overflow-y-auto mt-4 min-h-0">
            <StructuresTab />
          </div>
        ) : mode === "resources" ? (
          <div className="flex-1 overflow-y-auto mt-4 min-h-0">
            <ResourcesTab />
          </div>
        ) : (
          <Tabs defaultValue="structures" className="flex-1 flex flex-col mt-4 min-h-0">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="structures">
                <Clock className="h-3.5 w-3.5 mr-1" />
                Structures
              </TabsTrigger>
              <TabsTrigger value="resources">
                <Layers className="h-3.5 w-3.5 mr-1" />
                Resources
              </TabsTrigger>
            </TabsList>

            <TabsContent value="structures" className="flex-1 overflow-y-auto mt-3">
              <StructuresTab />
            </TabsContent>
            <TabsContent value="resources" className="flex-1 overflow-y-auto mt-3">
              <ResourcesTab />
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

function StructuresTab() {
  const q = useTtPeriodStructures();
  const del = useDeletePeriodStructure();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TtPeriodStructureRow | null>(null);
  const academicYear = currentAcademicYear();

  function requestDelete(row: TtPeriodStructureRow) {
    if (row.usedByClassCount === 0) {
      // Idempotent quick path — no destructive cascade, no confirm needed.
      del.mutate(row.id);
      return;
    }
    setConfirmDelete(row);
  }

  return (
    <div className="space-y-4">
      <Button
        size="lg"
        className="w-full"
        onClick={() => {
          setEditingId(null);
          setDialogOpen(true);
        }}
      >
        <Plus className="h-4 w-4 mr-2" />
        New structure
      </Button>

      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (q.data ?? []).length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No period structures yet. Create one to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {(q.data ?? []).map((s) => (
            <StructureCard
              key={s.id}
              row={s}
              onAssign={() => setAssigning({ id: s.id, name: s.name })}
              onEdit={() => {
                setEditingId(s.id);
                setDialogOpen(true);
              }}
              onDelete={() => requestDelete(s)}
              deleting={del.isPending}
            />
          ))}
        </div>
      )}

      <PeriodStructureDialogV2
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditingId(null);
        }}
        structureId={editingId}
      />

      {assigning && (
        <AssignStructureDialogV2
          open
          onOpenChange={(o) => {
            if (!o) setAssigning(null);
          }}
          structureId={assigning.id}
          structureName={assigning.name}
          academicYear={academicYear}
        />
      )}

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{confirmDelete?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete
                ? `This structure is currently assigned to ${confirmDelete.usedByClassCount} class${
                    confirmDelete.usedByClassCount === 1 ? "" : "es"
                  }. Deleting it will unassign every one of them and clear their scheduled timetable cells. This can't be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete) del.mutate(confirmDelete.id);
                setConfirmDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete &amp; unassign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StructureCard({
  row,
  onAssign,
  onEdit,
  onDelete,
  deleting,
}: {
  row: TtPeriodStructureRow;
  onAssign: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-3 flex items-start gap-3">
        <CalendarClock className="h-4 w-4 mt-1 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{row.name}</div>
          <div className="text-xs text-muted-foreground flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
            <span>{row.slotCount} period{row.slotCount === 1 ? "" : "s"}</span>
            <span>·</span>
            <span>{row.working_days.length} working day{row.working_days.length === 1 ? "" : "s"}</span>
            {row.usedByClassCount > 0 && (
              <>
                <span>·</span>
                <Badge variant="outline" className="text-[10px]">
                  Used by {row.usedByClassCount} class{row.usedByClassCount === 1 ? "" : "es"}
                </Badge>
              </>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-primary"
          onClick={onAssign}
          title="Assign to classes"
        >
          <Link2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={onEdit}
          title="Edit structure"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive"
          onClick={onDelete}
          disabled={deleting}
          title={
            row.usedByClassCount > 0
              ? `Delete (will unassign ${row.usedByClassCount} class${row.usedByClassCount === 1 ? "" : "es"})`
              : "Delete"
          }
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}

function ResourcesTab() {
  const q = useTtResources();
  const del = useDeleteResource();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-4">
      <Button size="lg" className="w-full" onClick={() => setDialogOpen(true)}>
        <Plus className="h-4 w-4 mr-2" />
        New resource
      </Button>

      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (q.data ?? []).length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No shared resources yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {(q.data ?? []).map((r) => (
            <ResourceCard
              key={r.id}
              row={r}
              onDelete={() => del.mutate(r.id)}
              deleting={del.isPending}
            />
          ))}
        </div>
      )}

      <ResourceDialogV2 open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  lab: "Lab",
  library: "Library",
  computer_room: "Computer room",
  sports_facility: "Sports facility",
  other: "Other",
};

function ResourceCard({
  row,
  onDelete,
  deleting,
}: {
  row: TtResourceRow;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-3 flex items-start gap-3">
        <Layers className="h-4 w-4 mt-1 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{row.name}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
            <Badge variant="outline" className="text-[10px]">
              {KIND_LABEL[row.kind] ?? row.kind}
            </Badge>
            <span>Capacity: {row.capacity}</span>
          </div>
          {row.description && (
            <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {row.description}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive"
          onClick={onDelete}
          disabled={deleting}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}
