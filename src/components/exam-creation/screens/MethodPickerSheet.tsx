import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Sparkles, Library, Pencil } from "lucide-react";
import { ContextStrip } from "../components/ContextStrip";

export type AddMethod = "ai" | "bank" | "manual";

interface MethodPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionTitle: string;
  typeLabel: string;
  remaining: number;
  onPick: (method: AddMethod) => void;
}

const METHODS: {
  id: AddMethod;
  title: string;
  description: string;
  icon: typeof Sparkles;
}[] = [
  {
    id: "ai",
    title: "AI Generate",
    description: "Auto-draft questions from selected chapters.",
    icon: Sparkles,
  },
  {
    id: "bank",
    title: "Question Bank",
    description: "Pull from previously saved questions.",
    icon: Library,
  },
  {
    id: "manual",
    title: "Manual Entry",
    description: "Type your own question from scratch.",
    icon: Pencil,
  },
];

export function MethodPickerSheet({
  open,
  onOpenChange,
  sectionTitle,
  typeLabel,
  remaining,
  onPick,
}: MethodPickerSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl sm:mx-auto"
      >
        <SheetHeader className="mb-3">
          <SheetTitle>Add questions</SheetTitle>
        </SheetHeader>
        <ContextStrip
          sectionTitle={sectionTitle}
          typeLabel={typeLabel}
          remaining={remaining}
          className="mb-3"
        />
        <div className="space-y-2">
          {METHODS.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onPick(m.id)}
                className="flex w-full items-center gap-4 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 min-h-[72px]"
              >
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <div className="font-semibold">{m.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
