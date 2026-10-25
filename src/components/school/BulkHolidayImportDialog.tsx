import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { seedHolidaysFor, type SeedHoliday } from "@/lib/indiaHolidays";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  academicYear: string;
  existingHolidayDates: Set<string>;
  onImport: (selected: SeedHoliday[]) => Promise<void>;
  isImporting?: boolean;
}

export function BulkHolidayImportDialog({
  open,
  onOpenChange,
  academicYear,
  existingHolidayDates,
  onImport,
  isImporting = false,
}: Props) {
  const seeds = useMemo(() => seedHolidaysFor(academicYear), [academicYear]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    // Pre-select everything that isn't already a holiday in the calendar.
    const next = new Set<string>();
    for (const h of seeds) {
      if (!existingHolidayDates.has(h.date)) {
        next.add(keyFor(h));
      }
    }
    setSelected(next);
  }, [open, seeds, existingHolidayDates]);

  const keyFor = (h: SeedHoliday) => `${h.date}__${h.title}`;

  const toggle = (h: SeedHoliday) => {
    const k = keyFor(h);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const selectAll = () => {
    const next = new Set<string>();
    for (const h of seeds) {
      if (!existingHolidayDates.has(h.date)) next.add(keyFor(h));
    }
    setSelected(next);
  };

  const deselectAll = () => setSelected(new Set());

  const handleImport = async () => {
    const picked = seeds.filter((h) => selected.has(keyFor(h)));
    await onImport(picked);
    onOpenChange(false);
  };

  const national = seeds.filter((h) => h.category === "national");
  const regional = seeds.filter((h) => h.category === "regional");

  const renderRow = (h: SeedHoliday) => {
    const alreadyAdded = existingHolidayDates.has(h.date);
    const k = keyFor(h);
    const weekday = new Date(h.date + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "short",
    });
    const formatted = new Date(h.date + "T00:00:00").toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    return (
      <div
        key={k}
        className={`flex items-center gap-3 py-2 px-3 rounded-md border ${
          alreadyAdded ? "bg-muted/50" : "hover:bg-muted/40"
        }`}
      >
        <Checkbox
          id={k}
          checked={selected.has(k)}
          disabled={alreadyAdded || isImporting}
          onCheckedChange={() => toggle(h)}
        />
        <label
          htmlFor={k}
          className="flex-1 flex items-center justify-between cursor-pointer gap-4"
        >
          <div>
            <div className="text-sm font-medium">{h.title}</div>
            <div className="text-xs text-muted-foreground">
              {weekday} · {formatted}
            </div>
          </div>
          {alreadyAdded && (
            <Badge variant="secondary" className="text-xs">
              Already added
            </Badge>
          )}
        </label>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import public holidays: {academicYear}</DialogTitle>
          <DialogDescription>
            Select national and regional holidays to add to the calendar.
            Holidays already on your calendar are disabled.
          </DialogDescription>
        </DialogHeader>

        {seeds.length === 0 ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>No holiday list available</AlertTitle>
            <AlertDescription>
              A seed list for {academicYear} isn&apos;t shipped yet. You can add
              holidays manually using the &quot;Add event&quot; button.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={selectAll}
                disabled={isImporting}
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={deselectAll}
                disabled={isImporting}
              >
                Clear
              </Button>
              <span className="text-sm text-muted-foreground ml-auto">
                {selected.size} selected
              </span>
            </div>

            <ScrollArea className="h-[380px] pr-4">
              <div className="space-y-4">
                {national.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      National holidays
                    </div>
                    <div className="space-y-2">{national.map(renderRow)}</div>
                  </div>
                )}
                {regional.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Regional / festivals
                    </div>
                    <div className="space-y-2">{regional.map(renderRow)}</div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isImporting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleImport}
            disabled={selected.size === 0 || isImporting}
          >
            Import {selected.size > 0 ? `${selected.size} ` : ""}
            holidays
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
