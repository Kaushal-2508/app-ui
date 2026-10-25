import { useEffect, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { ScrollToTop } from "@/components/layout/ScrollToTop";
import { AuthProvider } from "@/contexts/AuthContext";
import { InstitutionProvider } from "@/contexts/InstitutionContext";
import { ActiveRoleProvider } from "@/contexts/ActiveRoleContext";
import { InstitutionCodeBridge } from "@/components/shared/InstitutionCodeBridge";
import { SymbolPickerProvider } from "@/components/shared/symbol-picker";
import { ImpersonationBanner } from "@/components/olympiad/admin/ImpersonationBanner";
import { NativeBootstrap } from "@/components/native/NativeBootstrap";
import { persistQueryCache, restoreQueryCache } from "@/lib/queryPersist";
import { toast } from "sonner";

// Auth pages
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import PasswordResetRequired from "./pages/PasswordResetRequired";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
/**
 * Shown while a lazily loaded page's chunk downloads. Pages are code-split so
 * the entry bundle stays small: with every page imported eagerly it reached
 * 6.7 MB and a phone parsed all of it before the login screen appeared
 * (2026-09-17). Full-height so the app bar does not jump when the page lands.
 */
function RouteFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-live="polite">
      <p className="text-sm text-ink-500">Loading...</p>
    </div>
  );
}

const ProfilePage = lazy(() => import("./pages/ProfilePage"));

// Lazy-loaded pages (isolate heavy imports from bootstrap)
const SupportPage = lazy(() => import("./pages/SupportPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const PRDPage = lazy(() => import("./pages/PRDPage"));
// Admin Dashboard v5. Replaced the previous Command Center on 2026-09-16; the
// old page and its layout components are gone, its two report actions moved
// across. Built to public/report_reference/salci-admin-dashboard-v5.html.
const CommandCenterV5Page = lazy(() => import("./pages/school/CommandCenterV5Page"));
const NoticeBoardPage = lazy(() => import("./pages/school/NoticeBoardPage"));
const OnboardingDashboardPage = lazy(() => import("./pages/school/OnboardingDashboardPage"));
const TeacherTargetsPage = lazy(() => import("./pages/school/TeacherTargetsPage"));
const AdmissionsPage = lazy(() => import("./pages/school/AdmissionsPage"));
const MyTargetsPage = lazy(() => import("./pages/teacher/MyTargetsPage"));
const OlympiadAdminPage = lazy(() => import("@/pages/admin/olympiad/OlympiadAdminPage"));
const OlympiadClassesTab = lazy(() => import("@/pages/admin/olympiad/OlympiadClassesTab"));
const OlympiadClassDetailPage = lazy(() => import("@/pages/admin/olympiad/OlympiadClassDetailPage"));
const OlympiadClassSubjectPage = lazy(() => import("@/pages/admin/olympiad/OlympiadClassSubjectPage"));
const OlympiadTopicsSubTab = lazy(() => import("@/pages/admin/olympiad/OlympiadTopicsSubTab"));
const OlympiadQuestionsSubTab = lazy(() => import("@/pages/admin/olympiad/OlympiadQuestionsSubTab"));
const OlympiadStudyMaterialSubTab = lazy(() => import("@/pages/admin/olympiad/OlympiadStudyMaterialSubTab"));
const OlympiadSchoolsTab = lazy(() => import("@/pages/admin/olympiad/OlympiadSchoolsTab"));
const OlympiadSchoolDetailPage = lazy(() => import("@/pages/admin/olympiad/OlympiadSchoolDetailPage"));
const NonSalciSchoolsPage = lazy(() => import("@/pages/admin/NonSalciSchoolsPage"));
const NonSalciSchoolDetailPage = lazy(() => import("@/pages/admin/NonSalciSchoolDetailPage"));
const AdminIssuesPage = lazy(() => import("./pages/AdminIssuesPage"));
const OlympiadPublicEnrollmentPage = lazy(() => import("@/pages/public/OlympiadPublicEnrollmentPage"));
const OlympiadPaymentSuccessPage = lazy(() => import("@/pages/public/OlympiadPaymentSuccessPage"));
const EnquiryPage = lazy(() => import("@/pages/public/EnquiryPage"));
const OlympiadSchoolShell = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolShell"));
const OlympiadSchoolDashboardPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolDashboardPage"));
const OlympiadSchoolResourcePlanningPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolResourcePlanningPage"));
const OlympiadSchoolExamPlanningPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolExamPlanningPage"));
const OlympiadSchoolStudyMaterialPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolStudyMaterialPage"));
const OlympiadSchoolStudentsPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolStudentsPage"));
const OptionalBatchesPage = lazy(() => import("@/pages/school/OptionalBatchesPage"));
const OlympiadSchoolTeachersPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolTeachersPage"));
const OlympiadSchoolMarketingPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolMarketingPage"));
const OlympiadSchoolLabsPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolLabsPage"));
const OlympiadSchoolStudentDashboardPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolStudentDashboardPage"));
const OlympiadSchoolExamPaperPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolExamPaperPage"));
const OlympiadTeacherDashboardPage = lazy(() => import("@/pages/teacher/olympiad/OlympiadTeacherDashboardPage"));
const OlympiadTeacherClassPage = lazy(() => import("@/pages/teacher/olympiad/OlympiadTeacherClassPage"));
const OlympiadSchoolBatchesPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolBatchesPage"));
const OlympiadSchoolBatchDetailPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolBatchDetailPage"));
const OlympiadSchoolPinCustodyPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolPinCustodyPage"));
const OlympiadSchoolAbsenteesPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolAbsenteesPage"));
const OlympiadSchoolReportPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolReportPage"));
const OlympiadSchoolRevenuePage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolRevenuePage"));
const OlympiadSchoolPublishStatusPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolPublishStatusPage"));
const OlympiadStudentLoginPage = lazy(() => import("@/pages/public/OlympiadStudentLoginPage"));
const OlympiadStudentDashboardPage = lazy(() => import("@/pages/student/olympiad/OlympiadStudentDashboardPage"));
const OlympiadStudentPinEntryPage = lazy(() => import("@/pages/student/olympiad/OlympiadStudentPinEntryPage"));
const OlympiadStudentStudyPage = lazy(() => import("@/pages/student/olympiad/OlympiadStudentStudyPage"));
const OlympiadExamAttemptPage = lazy(() => import("@/pages/student/olympiad/OlympiadExamAttemptPage"));
const OlympiadExamSubmittedPage = lazy(() => import("@/pages/student/olympiad/OlympiadExamSubmittedPage"));
const OlympiadStudentReviewPage = lazy(() => import("@/pages/student/olympiad/OlympiadStudentReviewPage"));
const HomeworkPage = lazy(() => import("./pages/HomeworkPage"));
const CreateHomework = lazy(() => import("./pages/CreateHomework"));
const EditHomework = lazy(() => import("./pages/EditHomework"));
const HomeworkMarkingPage = lazy(() => import("./pages/HomeworkMarkingPage"));
const StudentHomeworkPage = lazy(() => import("./pages/student/StudentHomeworkPage"));
const StudentHomeworkDetailPage = lazy(() => import("./pages/student/StudentHomeworkDetailPage"));
const StudentLeavePage = lazy(() => import("./pages/student/StudentLeavePage"));

// Dashboard
const Dashboard = lazy(() => import("./pages/Dashboard"));

// Teacher/Exam pages
const CreateExam = lazy(() => import("./pages/CreateExam"));
const EditExam = lazy(() => import("./pages/EditExam"));
const OfflineMarksEntryPage = lazy(() => import("./pages/OfflineMarksEntryPage"));
const ExamsPage = lazy(() => import("./pages/ExamsPage"));
const EvaluationsPage = lazy(() => import("./pages/EvaluationsPage"));
const ExamResultsPage = lazy(() => import("./pages/ExamResultsPage"));
const EvaluateAttemptPage = lazy(() => import("./pages/EvaluateAttemptPage"));
const TasksPage = lazy(() => import("./pages/TasksPage"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const PaymentsPage = lazy(() => import("./pages/PaymentsPage"));
const AchievementsPage = lazy(() => import("./pages/AchievementsPage"));
const BadgeLeaderboardPage = lazy(() => import("./pages/BadgeLeaderboardPage"));

// Student pages
const StudentExamsPage = lazy(() => import("./pages/student/StudentExamsPage"));
const StudentResultsPage = lazy(() => import("./pages/student/StudentResultsPage"));
const StudentResultDetailPage = lazy(() => import("./pages/student/StudentResultDetailPage"));
const StudentRechecksPage = lazy(() => import("./pages/student/StudentRechecksPage"));
const ExamAttemptPage = lazy(() => import("./pages/student/ExamAttemptPage"));
const HybridExamAttemptPage = lazy(() => import("./pages/student/HybridExamAttemptPage"));
const HybridUploadPage = lazy(() => import("./pages/student/HybridUploadPage"));
const HybridResultViewPage = lazy(() => import("./pages/student/HybridResultViewPage"));
const HybridEvaluatePage = lazy(() => import("./pages/teacher/HybridEvaluatePage"));
const HybridEvaluationListPage = lazy(() => import("./pages/teacher/HybridEvaluationListPage"));
const StudentStudyMaterialsPage = lazy(() => import("./pages/student/StudentStudyMaterialsPage"));
const StudentWeekPageV2 = lazy(() => import("./pages/student/StudentWeekPageV2"));
const StudentAttendancePage = lazy(() => import("./pages/student/StudentAttendancePage"));
const StudentPassportPage = lazy(() => import("./pages/student/StudentPassportPage"));

// Admin pages
const InstitutionsPage = lazy(() => import("./pages/admin/InstitutionsPage"));
const UsersPage = lazy(() => import("./pages/admin/UsersPage"));
const SyllabusPage = lazy(() => import("./pages/admin/SyllabusPage"));
const ActivityLogsPage = lazy(() => import("./pages/admin/ActivityLogsPage"));
const DeletedUsersPage = lazy(() => import("./pages/admin/DeletedUsersPage"));
const DeletedUserDetailPage = lazy(() => import("./pages/admin/DeletedUserDetailPage"));
const QuestionBankPage = lazy(() => import("./pages/admin/QuestionBankPage"));
const AIQuotaDashboardPage = lazy(() => import("./pages/admin/AIQuotaDashboardPage"));
const EmployeeLevelsPage = lazy(() => import("./pages/admin/EmployeeLevelsPage"));

// School Admin pages
const SchoolTeachersPage = lazy(() => import("./pages/school/SchoolTeachersPage"));
const SchoolClassesPage = lazy(() => import("./pages/school/SchoolClassesPage"));
const SchoolStudentsPage = lazy(() => import("./pages/school/SchoolStudentsPage"));
const SchoolSubjectsPage = lazy(() => import("./pages/school/SchoolSubjectsPage"));
const SchoolSyllabusPage = lazy(() => import("./pages/school/SchoolSyllabusPage"));
const SchoolCoordinatorsPage = lazy(() => import("./pages/school/SchoolCoordinatorsPage"));
const WingsPage = lazy(() => import("./pages/school/WingsPage"));
const RecheckManagementPage = lazy(() => import("./pages/school/RecheckManagementPage"));
const ManageAdminsPage = lazy(() => import("./pages/school/ManageAdminsPage"));
const ManageUsersPage = lazy(() => import("./pages/school/ManageUsersPage"));
const ClassDetailPage = lazy(() => import("./pages/school/ClassDetailPage"));
const TeacherDetailPage = lazy(() => import("./pages/school/TeacherDetailPage"));
const SubjectDetailPage = lazy(() => import("./pages/school/SubjectDetailPage"));
const StudentPerformancePage = lazy(() => import("./pages/school/StudentPerformancePage"));
const WorkforceOverviewPage = lazy(() => import("./pages/school/WorkforceOverviewPage"));
const SchoolSnapshotPage = lazy(() => import("./pages/school/SchoolSnapshotPage"));
const SchoolAttendancePage = lazy(() => import("./pages/school/SchoolAttendancePage"));
const UserAttendanceDetailPage = lazy(() => import("./pages/school/UserAttendanceDetailPage"));
const CommunicationPage = lazy(() => import("./pages/school/CommunicationPage"));
const FeesManagementPage = lazy(() => import("./pages/school/FeesManagementPage"));
const StudentFeesView = lazy(() => import("./pages/student/StudentFeesView"));
const AppointmentsPage = lazy(() => import("./pages/school/AppointmentsPage"));
const HRDashboardPage = lazy(() => import("./pages/school/HRDashboardPage"));
const AnnualCalendarPage = lazy(() => import("./pages/school/AnnualCalendarPage"));
const SharedResourcesPage = lazy(() => import("./pages/school/SharedResourcesPage"));
const WorkdayPage = lazy(() => import("./pages/staff/WorkdayPage"));
const PTMFeedbackPage = lazy(() => import("./pages/PTMFeedbackPage"));
// Public: Google Play's account-deletion link (Data safety).
const DeleteAccount = lazy(() => import("./pages/DeleteAccount"));
const MySalaryPage = lazy(() => import("./pages/staff/MySalaryPage"));

// Teacher pages
const ScanSheetsPage = lazy(() => import("./pages/teacher/ScanSheetsPage"));
const TeacherStudentsPage = lazy(() => import("./pages/teacher/TeacherStudentsPage"));
const TeacherMyWeekPageV2 = lazy(() => import("./pages/teacher/TeacherMyWeekPageV2"));
const TeacherSyllabusPage = lazy(() => import("./pages/teacher/TeacherSyllabusPage"));

// Proctoring pages
const ProctoringReviewPage = lazy(() => import("./pages/proctoring/ProctoringReviewPage"));
const LiveProctoringPage = lazy(() => import("./pages/proctoring/LiveProctoringPage"));

// PRD page - lazy loaded above

// Timetable
const TimetablePageV2 = lazy(() => import("./pages/school/TimetablePageV2"));
const ClassWorkspaceV2 = lazy(() => import("./pages/school/ClassWorkspaceV2"));

// QueryClient defaults — see CLAUDE.md §23.2.
// TanStack's default `staleTime: 0` refetches on every component mount,
// which at 60+ concurrent users multiplies REST calls by every component
// re-render. The 2026-05-16 incident showed this pattern saturating the
// Nano disk pipe. Hooks that genuinely need fresher data can opt to a
// shorter `staleTime` per-query (Realtime-backed notifications, live
// proctoring, etc.).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // A day, not five minutes: with the short window a screen left alone
      // for six minutes lost its data and came back as a skeleton; with this
      // one it comes back painted and refreshes underneath. staleTime still
      // decides when a query refetches, so this changes nothing about load.
      gcTime: 24 * 60 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
// Restore the last session's data before anything mounts, then keep the
// snapshot current. Both are no-ops when nobody is signed in.
restoreQueryCache(queryClient);
persistQueryCache(queryClient);

const App = () => {
  useEffect(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      console.error("Unhandled rejection:", event.reason);
      toast.error("An unexpected error occurred. Please try again.");
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", handleRejection);
    return () => window.removeEventListener("unhandledrejection", handleRejection);
  }, []);

  // Soft update toast — shown when a new Service Worker is ready but a dirty form
  // prevented auto-reload (see src/main.tsx controllerchange handler).
  useEffect(() => {
    const handler = () => {
      toast("Update ready", {
        description: "A new version is available.",
        action: { label: "Reload", onClick: () => window.location.reload() },
        duration: Infinity,
      });
    };
    window.addEventListener("salci-update-ready", handler);
    return () => window.removeEventListener("salci-update-ready", handler);
  }, []);

  return (
  <QueryClientProvider client={queryClient}>
   {/* Above BrowserRouter so auth resolves ONCE per boot; ProtectedRoute
       remounts per route and must not re-enter `loading` on navigation. */}
   <AuthProvider>
    <InstitutionProvider>
      <ActiveRoleProvider>
        <InstitutionCodeBridge />
        <TooltipProvider>
          <Toaster />
          <Sonner duration={2000} position="top-center" />
          <SymbolPickerProvider />
          <BrowserRouter>
          <ScrollToTop />
          {/* Renders nothing on the web; inside the Capacitor shell it owns
              splash, status bar, Android back and the offline banner. */}
          <NativeBootstrap />
          <ImpersonationBanner />
          <Suspense fallback={<RouteFallback />}>
          <Routes>
          {/* Public routes */}
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/password-reset-required" element={<PasswordResetRequired />} />
          <Route path="/delete-account" element={<DeleteAccount />} />
          {/* Public — pairing token IS the auth; no ProtectedRoute wrapper. */}
          <Route path="/student/hybrid-upload/:token" element={<HybridUploadPage />} />
          {/* Public — Olympiad student login; no auth required. */}
          <Route path="/olympiad/login" element={
            <Suspense fallback={<p>Loading...</p>}>
              <OlympiadStudentLoginPage />
            </Suspense>
          } />
          {/* Public — Olympiad parent enrollment + payment success; no auth required. */}
          <Route path="/olympiad/:schoolCode" element={
            <Suspense fallback={<p>Loading...</p>}>
              <OlympiadPublicEnrollmentPage />
            </Suspense>
          } />
          <Route path="/olympiad/:schoolCode/success" element={
            <Suspense fallback={<p>Loading...</p>}>
              <OlympiadPaymentSuccessPage />
            </Suspense>
          } />
          {/* Public: a school's admission enquiry form, no login. */}
          <Route path="/enquire/:schoolCode" element={
            <Suspense fallback={<p>Loading...</p>}>
              <EnquiryPage />
            </Suspense>
          } />
          
          {/* Protected routes - Dashboard */}
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } />

          {/* Salci Support, reporter side.

              NO allowedRoles, deliberately. ProtectedRoute only enforces roles
              when allowedRoles is non-empty (ProtectedRoute.tsx:62), so leaving
              it off admits every authenticated user. That is exactly the set
              that can already press the Salci Support button in the sidebar.
              Students and employees are 37% of real reporters and the entire
              point of this route; adding allowedRoles here recreates the hole
              it exists to close.

              DO NOT add "/support" to FEATURE_URL_MAP in
              src/components/admin/institution-wizard/featuresData.ts. The
              feature gate at ProtectedRoute.tsx:100-103 fires only for paths
              present in that map, and support must never be gateable: a school
              whose feature flags are misconfigured is precisely the school that
              needs to reach support. */}
          <Route path="/support" element={
            <ProtectedRoute>
              <Suspense fallback={<p>Loading...</p>}>
                <SupportPage />
              </Suspense>
            </ProtectedRoute>
          } />


          {/* Teacher routes */}
          <Route path="/exams" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
              <ExamsPage />
            </ProtectedRoute>
          } />
          <Route path="/exams/create" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
              <CreateExam />
            </ProtectedRoute>
          } />
          <Route path="/exams/edit/:id" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
              <EditExam />
            </ProtectedRoute>
          } />
          <Route path="/homework" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <HomeworkPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/homework/create" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <CreateHomework />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/homework/edit/:id" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <EditHomework />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/homework/:id" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <HomeworkMarkingPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/evaluations" element={<Navigate to="/exams" replace />} />
          <Route path="/exams/:examId/results" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
              <ExamResultsPage />
            </ProtectedRoute>
          } />
          <Route path="/exams/:examId/evaluate/:attemptId" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
              <EvaluateAttemptPage />
            </ProtectedRoute>
          } />
          <Route path="/exams/:examId/offline-marks" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
              <OfflineMarksEntryPage />
            </ProtectedRoute>
          } />
          {/* super_admin is here for Salci Support: support tickets are tasks
              assigned to the SALCI support owner, who works them on this page. */}
          <Route path="/tasks" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
              <TasksPage />
            </ProtectedRoute>
          } />
          
          {/* Scan Sheets route — admins only; teachers use OfflineMarksEntryPage */}
          <Route path="/scan-sheets" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
              <ScanSheetsPage />
            </ProtectedRoute>
          } />
          
          {/* Teacher Students route */}
          <Route path="/teacher/students" element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <TeacherStudentsPage />
            </ProtectedRoute>
          } />
          <Route path="/teacher/my-week" element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <TeacherMyWeekPageV2 />
            </ProtectedRoute>
          } />
          <Route
            path="/teacher/my-week-v2"
            element={<Navigate to="/teacher/my-week" replace />}
          />
          {/* Every chapter the teacher teaches, what was logged and which held
              papers tested it. Opened from the My Week header. */}
          <Route path="/teacher/my-syllabus" element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <TeacherSyllabusPage />
            </ProtectedRoute>
          } />
          {/* Teacher's own view of Teacher Targets. Also admits coordinator: a
              coordinator can be handed an individual target too, not only a
              wing pool (tt_target_eligible allows both roles). The target-set
              RPCs write notifications linking here, so this route and its
              FEATURE_URL_MAP entry must exist before any notification lands. */}
          <Route path="/teacher/my-targets" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <MyTargetsPage />
              </Suspense>
            </ProtectedRoute>
          } />

          {/* Student routes */}
          <Route path="/student/exams" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudentExamsPage />
            </ProtectedRoute>
          } />
          <Route path="/student/exams/:examId/attempt" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <ExamAttemptPage />
            </ProtectedRoute>
          } />
          <Route path="/student/hybrid-exam/:attemptId" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <HybridExamAttemptPage />
            </ProtectedRoute>
          } />
          <Route path="/student/hybrid-result/:attemptId" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <HybridResultViewPage />
            </ProtectedRoute>
          } />
          <Route path="/student/results" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudentResultsPage />
            </ProtectedRoute>
          } />
          <Route path="/student/results/:resultId" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudentResultDetailPage />
            </ProtectedRoute>
          } />
          <Route path="/student/rechecks" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudentRechecksPage />
            </ProtectedRoute>
          } />
          <Route path="/student/study-materials" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudentStudyMaterialsPage />
            </ProtectedRoute>
          } />
          <Route path="/student/my-week" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudentWeekPageV2 />
            </ProtectedRoute>
          } />
          <Route path="/student/attendance" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudentAttendancePage />
            </ProtectedRoute>
          } />
          <Route path="/student/leave" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <StudentLeavePage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route
            path="/student/my-week-v2"
            element={<Navigate to="/student/my-week" replace />}
          />
          {/* Retired: Reports destination redirects to the dashboard so
              bookmarks / PWA shortcuts / tour links don't 404. */}
          <Route path="/student/reports" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <Navigate to="/dashboard" replace />
            </ProtectedRoute>
          } />
          <Route path="/student/passport" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudentPassportPage />
            </ProtectedRoute>
          } />
          <Route path="/student/fees" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudentFeesView />
            </ProtectedRoute>
          } />
          <Route path="/student/homework" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <StudentHomeworkPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/student/homework/:id" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <StudentHomeworkDetailPage />
              </Suspense>
            </ProtectedRoute>
          } />

          {/* Super Admin routes */}
          <Route path="/admin/institutions" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <InstitutionsPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/non-salci-schools" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <NonSalciSchoolsPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/admin/non-salci-schools/:olySchoolId" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <NonSalciSchoolDetailPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/admin/users" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <UsersPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/analytics" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AnalyticsPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/payments" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <PaymentsPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/access" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <UsersPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/syllabus" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <SyllabusPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/question-bank" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <QuestionBankPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/olympiad" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadAdminPage />
              </Suspense>
            </ProtectedRoute>
          }>
            <Route index element={<Navigate to="schools" replace />} />
            <Route path="schools" element={<OlympiadSchoolsTab />} />
            <Route path="classes" element={<OlympiadClassesTab />} />
            <Route path="classes/:gradeLevelId" element={<OlympiadClassDetailPage />} />
            <Route path="classes/:gradeLevelId/subjects/:subjectId" element={<OlympiadClassSubjectPage />}>
              <Route index element={<OlympiadTopicsSubTab />} />
              <Route path="questions" element={<OlympiadQuestionsSubTab />} />
              <Route path="study-material" element={<OlympiadStudyMaterialSubTab />} />
            </Route>
          </Route>
          <Route path="/admin/olympiad/schools/:olySchoolId" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadSchoolDetailPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/admin/exams" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <ExamsPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/teachers" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <UsersPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/students" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <UsersPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/activity" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <ActivityLogsPage />
            </ProtectedRoute>
          } />
          {/* Deleted Users archive (CLAUDE.md §31): super admin here, and every
              dua_* RPC re-checks dua.viewers (team@salci.in) server-side. */}
          <Route path="/admin/deleted-users" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <DeletedUsersPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/deleted-users/:id" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <DeletedUserDetailPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/ai-quotas" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AIQuotaDashboardPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/employee-levels" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <EmployeeLevelsPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/issues" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <AdminIssuesPage />
              </Suspense>
            </ProtectedRoute>
          } />
          
          {/* School Admin routes - also accessible by super_admin when managing an institution */}
          <Route path="/school/users" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
              <ManageUsersPage />
            </ProtectedRoute>
          } />
          <Route path="/school/teachers" element={<Navigate to="/school/users?tab=teachers" replace />} />
          <Route path="/school/students" element={<Navigate to="/school/users?tab=students" replace />} />
          <Route path="/school/coordinators" element={<Navigate to="/school/users?tab=coordinators" replace />} />
          <Route path="/school/classes" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
              <SchoolClassesPage />
            </ProtectedRoute>
          } />
          <Route path="/school/subjects" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
              <SchoolSubjectsPage />
            </ProtectedRoute>
          } />
          <Route path="/school/syllabus" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "coordinator", "teacher", "super_admin"]}>
              <SchoolSyllabusPage />
            </ProtectedRoute>
          } />
          <Route path="/school/optional-batches" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "coordinator", "super_admin"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OptionalBatchesPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/school/exams" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
              <ExamsPage />
            </ProtectedRoute>
          } />
          <Route path="/school/evaluations" element={<Navigate to="/exams" replace />} />
          <Route path="/school/analytics" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
              <AnalyticsPage />
            </ProtectedRoute>
          } />
          <Route path="/school/billing" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
              <PaymentsPage />
            </ProtectedRoute>
          } />
          <Route path="/school/activity" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
              <ActivityLogsPage />
            </ProtectedRoute>
          } />
          <Route path="/school/wings" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
              <WingsPage />
            </ProtectedRoute>
          } />
          <Route path="/school/teacher-targets" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin", "coordinator"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <TeacherTargetsPage />
              </Suspense>
            </ProtectedRoute>
          } />
          {/* Admissions: every staff role reaches the page; it admits only
              admins and the school's named admissions staff. */}
          <Route path="/school/admissions" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin", "coordinator", "teacher", "employee"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <AdmissionsPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/school/rechecks" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
              <RecheckManagementPage />
            </ProtectedRoute>
          } />
          <Route path="/school/snapshot" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin", "coordinator", "teacher"]}>
              <SchoolSnapshotPage />
            </ProtectedRoute>
          } />
          <Route path="/school/command-center" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <CommandCenterV5Page />
              </Suspense>
            </ProtectedRoute>
          } />
          {/* The build-time preview URL. Kept as a redirect so any link or
              bookmark handed round while it was being built still lands. */}
          <Route path="/school/command-center-v5"
                 element={<Navigate to="/school/command-center" replace />} />
          <Route path="/school/onboarding-dashboard" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OnboardingDashboardPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/school/attendance" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "teacher", "coordinator", "super_admin"]}>
              <SchoolAttendancePage />
            </ProtectedRoute>
          } />
          <Route path="/school/attendance/user/:userId" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "coordinator", "super_admin", "teacher"]}>
              <UserAttendanceDetailPage />
            </ProtectedRoute>
          } />
          <Route path="/school/communication" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "teacher", "coordinator", "student", "super_admin"]}>
              <CommunicationPage />
            </ProtectedRoute>
          } />
          <Route path="/school/notices" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "teacher", "coordinator", "student", "super_admin"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <NoticeBoardPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/school/fees" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
              <FeesManagementPage />
            </ProtectedRoute>
          } />
          <Route path="/school/hr" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
              <HRDashboardPage />
            </ProtectedRoute>
          } />
          <Route path="/school/calendar" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin", "coordinator", "teacher"]}>
              <AnnualCalendarPage />
            </ProtectedRoute>
          } />
          <Route
            path="/school/period-structures"
            element={<Navigate to="/school/timetable" replace />}
          />
          <Route path="/school/shared-resources" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin", "coordinator"]} allowTimetableManagerOverride>
              <SharedResourcesPage />
            </ProtectedRoute>
          } />
          <Route path="/school/admins" element={<Navigate to="/school/users?tab=admins" replace />} />
          <Route path="/school/class/:classId" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin", "coordinator"]}>
              <ClassDetailPage />
            </ProtectedRoute>
          } />
          <Route path="/school/teacher/:teacherId" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin", "coordinator"]}>
              <TeacherDetailPage />
            </ProtectedRoute>
          } />
          <Route path="/school/subject/:subjectId" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin", "coordinator"]}>
              <SubjectDetailPage />
            </ProtectedRoute>
          } />
          <Route path="/school/student/:studentId" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin", "coordinator", "teacher"]}>
              <StudentPerformancePage />
            </ProtectedRoute>
          } />
          
          {/* Staff self-service routes */}
          {/* Workday: the staff side of attendance (own check-in, history and
              leave; staff attendance, the staff leave queue and substitutions
              for coordinators and admins). /staff/my-leaves was its address
              until 2026-09-28 and stays as a redirect for old links. */}
          <Route path="/staff/workday" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin"]}>
              <WorkdayPage />
            </ProtectedRoute>
          } />
          <Route path="/staff/my-leaves" element={<Navigate to="/staff/workday" replace />} />

          {/* PTM family feedback (2026-09-28). "active" is the one permanent QR:
              it opens whichever meeting is taking feedback for the student's
              class; the token route is what each PTM's printed QR carries.
              Static path first, dynamic second. Staff are admitted so a
              teacher testing a printed QR gets an explainer, not a bounce;
              the page gates itself on ptm_scheduling. */}
          <Route path="/ptm/feedback/active" element={
            <ProtectedRoute allowedRoles={["student", "teacher", "coordinator", "school_admin", "super_school_admin"]}>
              <PTMFeedbackPage mode="active" />
            </ProtectedRoute>
          } />
          <Route path="/ptm/feedback/:token" element={
            <ProtectedRoute allowedRoles={["student", "teacher", "coordinator", "school_admin", "super_school_admin"]}>
              <PTMFeedbackPage mode="token" />
            </ProtectedRoute>
          } />
          <Route path="/staff/my-salary" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin"]}>
              <MySalaryPage />
            </ProtectedRoute>
          } />
          
          {/* Appointments route */}
          <Route path="/appointments" element={
            <ProtectedRoute allowedRoles={["student", "teacher", "coordinator", "school_admin", "super_school_admin"]}>
              <AppointmentsPage />
            </ProtectedRoute>
          } />
          
          {/* Workforce Overview - management dashboard */}
          <Route path="/school/workforce" element={
            <ProtectedRoute allowedRoles={["super_school_admin", "school_admin", "coordinator", "super_admin"]}>
              <WorkforceOverviewPage />
            </ProtectedRoute>
          } />
          
          
          {/* Coordinator routes */}
          <Route path="/coordinator/exams" element={
            <ProtectedRoute allowedRoles={["coordinator"]}>
              <ExamsPage />
            </ProtectedRoute>
          } />
          <Route path="/coordinator/evaluations" element={<Navigate to="/exams" replace />} />
          <Route path="/coordinator/tasks" element={
            <ProtectedRoute allowedRoles={["coordinator"]}>
              <TasksPage />
            </ProtectedRoute>
          } />
          <Route path="/coordinator/students" element={
            <ProtectedRoute allowedRoles={["coordinator"]}>
              <SchoolStudentsPage />
            </ProtectedRoute>
          } />
          <Route path="/coordinator/teachers" element={
            <ProtectedRoute allowedRoles={["coordinator"]}>
              <SchoolTeachersPage />
            </ProtectedRoute>
          } />
          {/* Dedicated entry point for a staff_manager_overrides grant holder
              (a teacher given manage-teaching-staff rights, no role change).
              Admin/coordinator reach the same page via their own routes; this
              one adds the per-user override path. */}
          <Route path="/school/manage-teachers" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin", "coordinator"]} allowStaffManagerOverride>
              <SchoolTeachersPage />
            </ProtectedRoute>
          } />
          {/* Same, for a student_manager_overrides grant holder. /school/students
              redirects into the admin-only ManageUsersPage tabs, so the override
              holder needs this direct mount of the roster page. */}
          <Route path="/school/manage-students" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin", "coordinator"]} allowStudentManagerOverride>
              <SchoolStudentsPage />
            </ProtectedRoute>
          } />
          <Route path="/coordinator/classes" element={
            <ProtectedRoute allowedRoles={["coordinator"]}>
              <SchoolClassesPage />
            </ProtectedRoute>
          } />
          <Route path="/coordinator/analytics" element={
            <ProtectedRoute allowedRoles={["coordinator"]}>
              <AnalyticsPage />
            </ProtectedRoute>
          } />
          {/* Retired 2026-09-10 (see the /reports note below). Redirects rather
              than 404s so coordinator bookmarks and PWA shortcuts still land
              somewhere sensible. */}
          <Route path="/coordinator/reports" element={
            <ProtectedRoute>
              <Navigate to="/dashboard" replace />
            </ProtectedRoute>
          } />
          <Route path="/coordinator/rechecks" element={
            <ProtectedRoute allowedRoles={["coordinator"]}>
              <RecheckManagementPage />
            </ProtectedRoute>
          } />
          
          {/* Question Bank - accessible to school roles */}
          <Route path="/question-bank" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "coordinator", "teacher"]}>
              <QuestionBankPage />
            </ProtectedRoute>
          } />
          
          {/* Shared routes */}
          <Route path="/evaluations/hybrid" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
              <HybridEvaluationListPage />
            </ProtectedRoute>
          } />
          <Route path="/evaluations/hybrid/:attemptId" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
              <HybridEvaluatePage />
            </ProtectedRoute>
          } />
          <Route path="/ocr-review" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
              <EvaluationsPage />
            </ProtectedRoute>
          } />
          <Route path="/proctoring/live" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
              <LiveProctoringPage />
            </ProtectedRoute>
          } />
          <Route path="/performance" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin"]}>
              <AnalyticsPage />
            </ProtectedRoute>
          } />
          {/* Reports & Analytics retired 2026-09-10. It had already been narrowed
              twice (student destination 2026-06-22, teacher access 2026-08-18) and
              the admin/coordinator remainder was broken in ways nobody could see:
              the exam report's `profiles` embed on student_exam_attempts was
              ambiguous (PGRST201, two FKs) so EVERY exam returned "No results
              available"; the summary tiles gated "evaluated" on
              evaluation_status='finalized' and read 0% for every offline-marked
              exam; missing final_results rows rendered absent students as 0%
              failures; and Student Reports drew a "Subject Performance vs Class
              Average" radar from five hardcoded numbers. Every capability already
              exists on a maintained surface: one exam on /exams/:examId/results,
              one student on /school/student/:studentId, audit logs on
              /school/activity and /admin/activity, aggregates on
              /school/command-center and /school/snapshot. Redirect rather than
              404 so bookmarks and PWA shortcuts still land somewhere. */}
          <Route path="/reports" element={
            <ProtectedRoute>
              <Navigate to="/dashboard" replace />
            </ProtectedRoute>
          } />
          <Route path="/analytics" element={
            <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
              <AnalyticsPage />
            </ProtectedRoute>
          } />
          <Route path="/achievements" element={
            <ProtectedRoute>
              <AchievementsPage />
            </ProtectedRoute>
          } />
          <Route path="/leaderboard" element={
            <ProtectedRoute>
              <BadgeLeaderboardPage />
            </ProtectedRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute>
              <Suspense fallback={<div className="flex items-center justify-center min-h-dvh"><p>Loading...</p></div>}>
                <SettingsPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/profile" element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          } />
          
          {/* PRD Page - Public */}
          <Route path="/prd" element={
            <Suspense fallback={<div className="flex items-center justify-center min-h-dvh"><p>Loading...</p></div>}>
              <PRDPage />
            </Suspense>
          } />
          
          {/* Timetable */}
          <Route path="/school/timetable" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "coordinator", "super_admin"]} allowTimetableManagerOverride>
              <TimetablePageV2 />
            </ProtectedRoute>
          } />
          <Route path="/school/timetable/:classId" element={
            <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "coordinator", "super_admin"]} allowTimetableManagerOverride>
              <ClassWorkspaceV2 />
            </ProtectedRoute>
          } />
          <Route
            path="/school/timetable-v2"
            element={<Navigate to="/school/timetable" replace />}
          />
          <Route
            path="/school/timetable-v2/:classId"
            element={<Navigate to="/school/timetable" replace />}
          />

          {/* School Olympiad routes */}
          <Route path="/school/olympiad" element={
            <ProtectedRoute allowedRoles={["school_admin","super_school_admin","coordinator"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadSchoolShell />
              </Suspense>
            </ProtectedRoute>
          }>
            <Route index element={<OlympiadSchoolDashboardPage />} />
            <Route path="resource-planning" element={<OlympiadSchoolResourcePlanningPage />} />
            <Route path="onboarding" element={<Navigate to="/school/olympiad/resource-planning" replace />} />
            <Route path="exam-planning" element={<OlympiadSchoolExamPlanningPage />} />
            <Route path="revenue" element={<OlympiadSchoolRevenuePage />} />
            <Route path="report" element={<OlympiadSchoolReportPage />} />
            <Route path="marketing" element={<OlympiadSchoolMarketingPage />} />
          </Route>
          <Route path="/school/olympiad/teachers" element={
            <ProtectedRoute allowedRoles={["school_admin","super_school_admin","coordinator"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadSchoolTeachersPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/school/olympiad/students" element={
            <ProtectedRoute allowedRoles={["school_admin","super_school_admin","coordinator"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadSchoolStudentsPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/school/olympiad/students/:studentId/dashboard" element={
            <ProtectedRoute allowedRoles={["school_admin","super_school_admin","coordinator"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadSchoolStudentDashboardPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/school/olympiad/exam-paper" element={
            <ProtectedRoute allowedRoles={["school_admin","super_school_admin","coordinator"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadSchoolExamPaperPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/school/olympiad/study-material" element={
            <ProtectedRoute allowedRoles={["school_admin","super_school_admin","coordinator"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadSchoolStudyMaterialPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/school/olympiad/batches" element={
            <ProtectedRoute allowedRoles={["school_admin","super_school_admin","coordinator"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadSchoolBatchesPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/school/olympiad/batches/:batchId" element={
            <ProtectedRoute allowedRoles={["school_admin","super_school_admin","coordinator"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadSchoolBatchDetailPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/school/olympiad/pin-custody" element={
            <ProtectedRoute allowedRoles={["school_admin","super_school_admin"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadSchoolPinCustodyPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/school/olympiad/absentees" element={
            <ProtectedRoute allowedRoles={["school_admin","super_school_admin","coordinator"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadSchoolAbsenteesPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/school/olympiad/share" element={<Navigate to="/school/olympiad/marketing" replace />} />
          <Route path="/school/olympiad/labs" element={
            <ProtectedRoute allowedRoles={["school_admin","super_school_admin","coordinator"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadSchoolLabsPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/school/olympiad/publish-status" element={
            <ProtectedRoute allowedRoles={["school_admin","super_school_admin"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadSchoolPublishStatusPage />
              </Suspense>
            </ProtectedRoute>
          } />

          {/* Teacher Olympiad routes */}
          <Route path="/teacher/olympiad" element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadTeacherDashboardPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/teacher/olympiad/classes/:olySchoolId/:gradeLevelId" element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadTeacherClassPage />
              </Suspense>
            </ProtectedRoute>
          } />

          {/* Student Olympiad routes */}
          <Route path="/student/olympiad" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadStudentDashboardPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/student/olympiad/pin-entry" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadStudentPinEntryPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/student/olympiad/study/:subjectId" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadStudentStudyPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/student/olympiad/exam" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadExamAttemptPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/student/olympiad/exam/submitted" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadExamSubmittedPage />
              </Suspense>
            </ProtectedRoute>
          } />
          <Route path="/student/olympiad/review" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <OlympiadStudentReviewPage />
              </Suspense>
            </ProtectedRoute>
          } />

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
      </ActiveRoleProvider>
    </InstitutionProvider>
   </AuthProvider>
  </QueryClientProvider>
  );
};

export default App;
