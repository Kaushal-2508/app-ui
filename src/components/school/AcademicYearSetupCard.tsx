import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useUpsertCalAcademicYear } from "@/hooks/useAcademicCalendar";

interface Props {
  /** AY code, e.g. "2026-27". */
  academicYear: string;
  /** Suggested defaults (typically Apr 1 → Mar 31 of the AY). */
  defaultStart: string;       // ISO yyyy-mm-dd
  defaultEnd: string;         // ISO yyyy-mm-dd
}

/**
 * First-step setup card shown on the Annual Calendar page when no
 * `cal_academic_years` row exists for the selected AY. The admin types in
 * (or accepts the defaults for) the year's start and end dates; saving
 * persists the row and the rest of the calendar mounts on the next render.
 */
export function AcademicYearSetupCard({ academicYear, defaultStart, defaultEnd }: Props) {
  const upsert = useUpsertCalAcademicYear();
  const [startsOn, setStartsOn] = useState(defaultStart);
  const [endsOn, setEndsOn] = useState(defaultEnd);

  // Reset draft if the user switches to a different AY before saving.
  useEffect(() => {
    setStartsOn(defaultStart);
    setEndsOn(defaultEnd);
  }, [defaultStart, defaultEnd]);

  const datesValid = useMemo(() => {
    if (!startsOn || !endsOn) return false;
    return startsOn < endsOn;
  }, [startsOn, endsOn]);

  function handleSave() {
    if (!datesValid) return;
    upsert.mutate({
      code: academicYear,
      starts_on: startsOn,
      ends_on: endsOn,
    });
  }

  return (
    <Card className="border-dashed">
      <CardContent className="p-6 sm:p-8 space-y-5 max-w-2xl mx-auto">
        <div className="text-center space-y-2">
          <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <CalendarRange className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-semibold">Set up academic year {academicYear}</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Pick the first and last day of this academic year. Everything else
            on this page (holidays, exam blocks, attendance counts) hangs off
            this date range, so this is step one.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="ay-start">Start date</Label>
            <Input
              id="ay-start"
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ay-end">End date</Label>
            <Input
              id="ay-end"
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
            />
          </div>
        </div>

        {!datesValid && startsOn && endsOn && (
          <Alert className="bg-amber-50 border-amber-200 text-amber-900">
            <AlertDescription className="text-xs">
              The end date must be after the start date.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!datesValid || upsert.isPending}>
            {upsert.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save academic year
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
