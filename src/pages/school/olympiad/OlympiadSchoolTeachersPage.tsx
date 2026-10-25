import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, Plus, Upload, Users } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useOlympiadTeachers } from "@/hooks/olympiad/useOlympiadTeachers";
import { useOlympiadSchoolDashboard } from "@/hooks/olympiad/useOlympiadSchoolDashboard";
import { useOlympiadRevenueByClass } from "@/hooks/olympiad/useOlympiadRevenueByClass";
import {
  TeacherPerformanceTable,
  type TeacherPerformanceRow,
} from "@/components/olympiad/school/TeacherPerformanceTable";
import { AddTeacherSheet } from "@/components/olympiad/school/AddTeacherSheet";
import { AssignTeachersSheet } from "@/components/olympiad/school/AssignTeachersSheet";
import { BulkAddTeachersSheet } from "@/components/olympiad/school/BulkAddTeachersSheet";
import { useOlympiadClasses } from "@/hooks/olympiad/useOlympiadClasses";

export default function OlympiadSchoolTeachersPage() {
  const location = useLocation();
  const { data: school, isLoading: schoolLoading } = useOlympiadMySchool();
  const { data: teachers, isLoading: teachersLoading } = useOlympiadTeachers(school?.id);
  // Per-class aggregates backing the table columns: enrolled counts from the
  // dashboard query (shared cache with Home), paid revenue per class split by
  // channel from the server-side RPC.
  const { data: dashStats, isLoading: dashLoading } = useOlympiadSchoolDashboard(school?.id);
  const { data: cashByClass, isLoading: cashLoading } = useOlympiadRevenueByClass(school?.id, "cash");
  const { data: onlineByClass, isLoading: onlineLoading } = useOlympiadRevenueByClass(school?.id, "online");
  const { data: olyClasses = [] } = useOlympiadClasses();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  // The school's participating classes with display labels, for the bulk sheet.
  const participatingClasses = useMemo(() => {
    const allowed = new Set(school?.participating_grade_level_ids ?? []);
    return olyClasses
      .filter((c) => allowed.has(c.grade_level_id))
      .map((c) => ({
        gradeLevelId: c.grade_level_id,
        // grade_name is canonical ("Class 9", "Class 11 Commerce") - Class ${n}
        // would mislabel stream classes whose grade_number runs 11-18.
        label: c.grade_name,
      }));
  }, [olyClasses, school?.participating_grade_level_ids]);

  // Arriving from the dashboard "Onboard teachers" tile opens the sheet
  // immediately. The ref makes it once-only so closing the sheet sticks.
  const autoOpened = useRef(false);
  useEffect(() => {
    const wantsAdd = (location.state as { openAdd?: boolean } | null)?.openAdd;
    if (wantsAdd && school && !autoOpened.current) {
      autoOpened.current = true;
      setSheetOpen(true);
    }
  }, [location.state, school]);

  if (schoolLoading) {
    return (
      <PageShell>
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
        </div>
      </PageShell>
    );
  }

  if (!school) {
    return (
      <PageShell>
        <p className="py-6 text-sm text-ink-600">No active Olympiad campaign.</p>
      </PageShell>
    );
  }

  const isExisting = school.is_existing_salci_school;
  const buttonLabel = isExisting ? "Assign teachers" : "Add teacher";

  // One row per teacher, summing the aggregates over their assigned class(es).
  const valuesLoading = dashLoading || cashLoading || onlineLoading;
  const rows: TeacherPerformanceRow[] = (teachers ?? []).map((teacher) => {
    let enrolled = 0, cashRupees = 0, onlineRupees = 0;
    for (const gid of teacher.grade_level_ids) {
      enrolled += dashStats?.byClass.find((c) => c.grade_level_id === gid)?.count ?? 0;
      cashRupees += cashByClass?.find((r) => r.grade_level_id === gid)?.revenue_rupees ?? 0;
      onlineRupees += onlineByClass?.find((r) => r.grade_level_id === gid)?.revenue_rupees ?? 0;
    }
    return { teacher, enrolled, cashRupees, onlineRupees };
  });

  return (
    <PageShell>
      <NavLink
        to="/school/olympiad"
        className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2"
      >
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </NavLink>

      <PageHeader
        title={isExisting ? "Assign Olympiad Teachers" : "Olympiad Teachers"}
        subtitle={
          isExisting
            ? "Pick existing SALCI teachers to manage Olympiad classes"
            : "Create teacher accounts for your Olympiad"
        }
      />

      <div className="space-y-4 py-4">
        <div className="flex items-center justify-end gap-2">
          {!isExisting && (
            <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
              <Upload className="h-4 w-4 mr-1" />
              Bulk upload
            </Button>
          )}
          <Button size="sm" onClick={() => setSheetOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {buttonLabel}
          </Button>
        </div>

        {teachersLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
          </div>
        ) : (teachers ?? []).length === 0 ? (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title="No teachers yet"
            description={
              isExisting
                ? "Assign one of your existing teachers to manage an Olympiad class."
                : "Create your first teacher account."
            }
            action={{
              label: buttonLabel,
              onClick: () => setSheetOpen(true),
              icon: <Plus className="h-4 w-4" />,
            }}
          />
        ) : (
          <TeacherPerformanceTable
            rows={rows}
            valuesLoading={valuesLoading}
            olySchoolId={school.id}
            canManage={!isExisting}
          />
        )}
      </div>

      {!isExisting && (
        <AddTeacherSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          olySchoolId={school.id}
          participatingGradeIds={school.participating_grade_level_ids}
        />
      )}
      {!isExisting && (
        <BulkAddTeachersSheet
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          olySchoolId={school.id}
          classes={participatingClasses}
        />
      )}
      {isExisting && (
        <AssignTeachersSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          olySchoolId={school.id}
          participatingGradeIds={school.participating_grade_level_ids}
        />
      )}
    </PageShell>
  );
}
